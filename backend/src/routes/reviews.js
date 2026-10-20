import { validate, createReviewSchema } from '../validation/schemas.js';
/**
 * routes/reviews.js — Justice Gavel client reviews of lawyers and bail agents
 *
 * GET  /api/reviews?entity_type=&entity_id=   published reviews (+ `mine` for the caller)
 * GET  /api/reviews/summary                   average / count / two latest comments (published only)
 * POST /api/reviews                           one review per person per listing (auth)
 * POST /api/reviews/:id/report                report a review (auth; one report per person)
 * Moderation queue: GET/POST /api/admin/reviews (routes/admin.js).
 *
 * App reviews never overwrite the listing rows in `lawyers` / `bail_agents`;
 * aggregates are computed from `reviews` on read.
 *
 * `verified` means "the reviewer provably dealt with this provider through the
 * app", decided server-side at write time (see hasVerifiedRelationship); never
 * taken from the request.
 *
 * Moderation: a comment with a phone number, e-mail address or link is held as
 * 'pending' (it could carry someone's private details or be an ad) until an
 * admin publishes it. A review reported by REPORT_HOLD_THRESHOLD different
 * people is held as 'pending' until an admin decides. Only 'published' reviews
 * are shown or counted.
 */

import { truncateStr, safeInt } from '../utils/routeHelpers.js';
import { sanitizeStr } from '../utils/sanitize.js';
import { makeUserLimiter }                   from '../middleware/sharedAiLimiter.js';
import logger                                from '../utils/logger.js';
import { Router }                            from 'express';
import { authRequired, optionalAuth }        from '../middleware/auth.js';
import { getDb }                             from '../db/index.js';
import { resolveLang, msg }                  from '../i18n/index.js';

const router         = Router();
const reviewsLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 5, message: 'Review limit reached — you can submit 5 reviews per hour.' });
const reportLimiter  = makeUserLimiter({ windowMs: 3_600_000, max: 20, message: 'Too many reports — try again later.' });

const VALID_ENTITY_TYPES = new Set(['lawyer', 'bail_agent', 'attorney']);
const REPORT_REASONS = new Set(['false', 'offensive', 'private_info', 'spam', 'other']);
export const REPORT_HOLD_THRESHOLD = 3;
const REVIEW_COLS = 'id, entity_type, entity_id, rating, comment, anonymous, verified, created_at';

const err = (res, status, lang, key, code) => res.status(status).json({ error: msg(lang, key), code });

/** True when a comment carries a phone number, e-mail address or link. */
export function needsModeration(comment) {
  const s = String(comment || '');
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(s)) return true;                         // e-mail
  if (/\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|co|us|law|legal|info|biz)\b/i.test(s)) return true; // link
  return (s.match(/\d/g) || []).length >= 7 && /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(s);     // phone
}

async function entityExists(db, type, id) {
  if (type === 'lawyer') return !!(await db.get('SELECT 1 AS ok FROM lawyers WHERE id = ? AND COALESCE(active, 1) = 1', [id]));
  if (type === 'bail_agent') return !!(await db.get('SELECT 1 AS ok FROM bail_agents WHERE id = ? AND COALESCE(active, 1) = 1', [id]));
  return !!(await db.get("SELECT 1 AS ok FROM users WHERE id = ? AND (role IN ('attorney','defender') OR COALESCE(is_defender, 0) = 1)", [id]));
}

function readEntity(src, lang, res) {
  const type = String(src.entity_type || '');
  const id = safeInt(src.entity_id);
  if (!VALID_ENTITY_TYPES.has(type)) { err(res, 400, lang, 'reviews.err.bad_entity_type', 'bad_entity_type'); return null; }
  if (!id || id <= 0) { err(res, 400, lang, 'reviews.err.bad_entity_id', 'bad_entity_id'); return null; }
  return { type, id };
}

// ── GET /api/reviews ──────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  const lang = resolveLang(req);
  const e = readEntity(req.query, lang, res);
  if (!e) return;
  try {
    const limit  = Math.min(Math.max(safeInt(req.query.limit, 20), 1), 100);
    const offset = Math.max(safeInt(req.query.offset, 0), 0);
    const d = await getDb();
    const rows = await d.all(
      `SELECT ${REVIEW_COLS} FROM reviews WHERE entity_type=? AND entity_id=? AND status = 'published'
        ORDER BY id DESC LIMIT ? OFFSET ?`,
      [e.type, e.id, limit, offset]
    );
    const mine = req.user?.id
      ? await d.get(`SELECT ${REVIEW_COLS}, status FROM reviews WHERE user_id=? AND entity_type=? AND entity_id=?`, [req.user.id, e.type, e.id])
      : null;
    res.json({ reviews: rows, mine: mine || null, pagination: { limit, offset, count: rows.length } });
  } catch (ex) {
    logger.error('[reviews/list]', ex.message);
    err(res, 500, lang, 'reviews.err.load_failed', 'server_error');
  }
});

/**
 * True when `userId` has a real, app-recorded relationship with the provider:
 *
 *   lawyer   (entity_id = lawyers.id)
 *     · a consultation booking with that lawyer that has taken place
 *       (status 'completed', or 'confirmed' with a start before now), or
 *     · a completed row in `consultations` with that lawyer, or
 *     · one of the user's cases is/was assigned to the lawyer's linked account
 *       (case_assignments active/completed/closed).
 *   attorney (entity_id = users.id of the attorney account)
 *     · one of the user's cases is/was assigned to that account, or a
 *       completed consultation with a lawyer row linked to that account.
 *   bail_agent — the directory has no link from bail agents to app accounts or
 *     bookings, so these reviews are never marked verified.
 */
export async function hasVerifiedRelationship(db, userId, entityType, entityId) {
  const ASSIGNED = "('active','completed','closed')";
  const PAST = "(cb.status = 'completed' OR (cb.status = 'confirmed' AND COALESCE(cb.starts_at, cb.date_slot::timestamptz) < NOW()))";
  if (entityType === 'lawyer') {
    const row = await db.get(
      `SELECT 1 AS ok WHERE
         EXISTS (SELECT 1 FROM consultation_bookings cb
                  WHERE cb.user_id = ? AND cb.lawyer_id = ? AND ${PAST})
      OR EXISTS (SELECT 1 FROM consultations co
                  WHERE co.user_id = ? AND co.lawyer_id = ? AND co.status = 'completed')
      OR EXISTS (SELECT 1 FROM case_assignments ca
                   JOIN cases c   ON c.id = ca.case_id
                   JOIN lawyers l ON l.id = ?
                   LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
                  WHERE c.user_id = ? AND ca.status IN ${ASSIGNED}
                    AND ca.defender_id = COALESCE(l.user_id, ap.user_id))`,
      [userId, entityId, userId, entityId, entityId, userId]
    );
    return !!row;
  }
  if (entityType === 'attorney') {
    const row = await db.get(
      `SELECT 1 AS ok WHERE
         EXISTS (SELECT 1 FROM case_assignments ca JOIN cases c ON c.id = ca.case_id
                  WHERE c.user_id = ? AND ca.defender_id = ? AND ca.status IN ${ASSIGNED})
      OR EXISTS (SELECT 1 FROM consultation_bookings cb
                   JOIN lawyers l ON l.id = cb.lawyer_id
                   LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
                  WHERE cb.user_id = ? AND COALESCE(l.user_id, ap.user_id) = ? AND ${PAST})`,
      [userId, entityId, userId, entityId]
    );
    return !!row;
  }
  return false;
}

// ── POST /api/reviews ─────────────────────────────────────────────────────────
router.post('/', authRequired, validate(createReviewSchema), reviewsLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const e = readEntity(req.body || {}, lang, res);
  if (!e) return;
  try {
    const { rating, comment: rawComment = '', anonymous = 0 } = req.body;
    const safeComment = rawComment ? truncateStr(sanitizeStr(String(rawComment)), 1000).trim() : '';
    const d = await getDb();
    if (!(await entityExists(d, e.type, e.id))) return err(res, 404, lang, 'reviews.err.not_found', 'not_found');
    if (e.type === 'attorney' && Number(e.id) === Number(req.user.id)) return err(res, 400, lang, 'reviews.err.self', 'self_review');

    // One review per user per listing
    const existing = await d.get('SELECT id FROM reviews WHERE user_id=? AND entity_type=? AND entity_id=?', [req.user.id, e.type, e.id]);
    if (existing) return err(res, 409, lang, 'reviews.err.duplicate', 'duplicate_review');

    const verified = await hasVerifiedRelationship(d, req.user.id, e.type, e.id)
      .catch(ex => { logger.warn('[reviews/verify]', ex.message); return false; });
    const status = needsModeration(safeComment) ? 'pending' : 'published';

    let r;
    try {
      r = await d.run(
        `INSERT INTO reviews (user_id, entity_type, entity_id, provider_id, rating, comment, verified, anonymous, status)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [req.user.id, e.type, e.id, e.id, rating, safeComment, verified ? 1 : 0, anonymous ? 1 : 0, status]
      );
    } catch (ex) {
      // Two taps raced past the check: the unique index kept one row.
      if (ex?.code === '23505') return err(res, 409, lang, 'reviews.err.duplicate', 'duplicate_review');
      throw ex;
    }
    const row = await d.get(`SELECT ${REVIEW_COLS}, status FROM reviews WHERE id=?`, [r.lastID]);
    res.status(201).json({ ...row, message: msg(lang, status === 'pending' ? 'reviews.held' : 'reviews.posted') });
  } catch (ex) {
    logger.error('[reviews/create]', ex.message);
    err(res, 500, lang, 'reviews.err.save_failed', 'server_error');
  }
});

// ── POST /api/reviews/:id/report ──────────────────────────────────────────────
router.post('/:id/report', authRequired, reportLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const id = safeInt(req.params.id);
  if (!id || id <= 0) return err(res, 400, lang, 'reviews.err.bad_review_id', 'bad_id');
  const reason = String(req.body?.reason || '');
  if (!REPORT_REASONS.has(reason)) return err(res, 400, lang, 'reviews.err.bad_reason', 'bad_reason');
  const details = req.body?.details ? truncateStr(sanitizeStr(String(req.body.details)), 500) : null;
  try {
    const d = await getDb();
    const review = await d.get(`SELECT id, user_id, status FROM reviews WHERE id = ?`, [id]);
    if (!review || review.status !== 'published') return err(res, 404, lang, 'reviews.err.review_not_found', 'not_found');
    if (Number(review.user_id) === Number(req.user.id)) return err(res, 400, lang, 'reviews.err.own_report', 'own_review');
    const ins = await d.get(
      `INSERT INTO review_reports (review_id, user_id, reason, details) VALUES (?,?,?,?)
       ON CONFLICT (review_id, user_id) DO NOTHING RETURNING id`, [id, req.user.id, reason, details]);
    const open = await d.get(`SELECT COUNT(DISTINCT user_id) AS n FROM review_reports WHERE review_id = ? AND status = 'open'`, [id]);
    if (Number(open?.n || 0) >= REPORT_HOLD_THRESHOLD) {
      await d.run(`UPDATE reviews SET status = 'pending' WHERE id = ? AND status = 'published'`, [id]);
    }
    res.status(ins ? 201 : 200).json({ ok: true, duplicate: !ins, message: msg(lang, 'reviews.reported') });
  } catch (ex) {
    logger.error('[reviews/report]', ex.message);
    err(res, 500, lang, 'reviews.err.report_failed', 'server_error');
  }
});

// ── GET /api/reviews/summary ──────────────────────────────────────────────────
// Aggregate rating + latest 2 text reviews (published only) for attorney cards.
router.get('/summary', async (req, res) => {
  const lang = resolveLang(req);
  const e = readEntity(req.query, lang, res);
  if (!e) return;
  try {
    const d = await getDb();
    const [agg, top] = await Promise.all([
      d.get(
        `SELECT AVG(rating) as avg_rating, COUNT(*) as count, SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified_count
           FROM reviews WHERE entity_type=? AND entity_id=? AND status = 'published'`,
        [e.type, e.id]
      ),
      d.all(
        `SELECT rating, comment, anonymous, verified, created_at FROM reviews
         WHERE entity_type=? AND entity_id=? AND status = 'published' AND comment != ''
         ORDER BY id DESC LIMIT 2`,
        [e.type, e.id]
      ),
    ]);
    res.json({
      avg_rating:  agg?.avg_rating ? Math.round(parseFloat(agg.avg_rating) * 10) / 10 : null,
      count:       Number(agg?.count || 0),
      verified_count: Number(agg?.verified_count || 0),
      top_reviews: top || [],
    });
  } catch (ex) {
    logger.error('[reviews/summary]', ex.message);
    err(res, 500, lang, 'reviews.err.load_failed', 'server_error');
  }
});

export default router;
