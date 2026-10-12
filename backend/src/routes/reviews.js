import { validate, createReviewSchema } from '../validation/schemas.js';
/**
 * routes/reviews.js — Provider reviews and ratings (Postgres `reviews` table)
 *
 * GET  /api/reviews            — list reviews for an entity
 * POST /api/reviews            — submit a review (auth required)
 * GET  /api/reviews/summary    — aggregate rating + top reviews
 *
 * NOTE: app reviews never overwrite the verified provider rows in `lawyers` /
 * `bail_agents`; aggregates are computed from `reviews` on read.
 *
 * `verified` means "the reviewer provably dealt with this provider through the
 * app", decided server-side at write time (see hasVerifiedRelationship). It is
 * never taken from the request. Everything else is stored as verified=0 and the
 * app labels it as an unverified review.
 */

import { err400, truncateStr, safeInt } from '../utils/routeHelpers.js';
import { sanitizeStr } from '../utils/sanitize.js';
import { makeUserLimiter }                   from '../middleware/sharedAiLimiter.js';
import logger                                from '../utils/logger.js';
import { Router }                            from 'express';
import { authRequired }                      from '../middleware/auth.js';
import { getDb }                             from '../db/index.js';

const router         = Router();
const reviewsLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 5, message: 'Review limit reached — you can submit 5 reviews per hour.' });

const VALID_ENTITY_TYPES = new Set(['lawyer', 'bail_agent', 'attorney']);
const REVIEW_COLS = 'id, entity_type, entity_id, rating, comment, anonymous, verified, created_at';

// ── GET /api/reviews ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    const limit  = Math.min(Math.max(safeInt(req.query.limit, 20), 1), 100);
    const offset = Math.max(safeInt(req.query.offset, 0), 0);
    if (!entity_type || !entity_id) {
      return err400(res, 'entity_type and entity_id required.');
    }
    if (!VALID_ENTITY_TYPES.has(entity_type)) {
      return err400(res, `entity_type must be one of: ${[...VALID_ENTITY_TYPES].join(', ')}.`);
    }
    const d = await getDb();
    const rows = await d.all(
      `SELECT ${REVIEW_COLS} FROM reviews WHERE entity_type=? AND entity_id=? ORDER BY id DESC LIMIT ? OFFSET ?`,
      [entity_type, safeInt(entity_id), limit, offset]
    );
    res.json({ reviews: rows, pagination: { limit, offset, count: rows.length } });
  } catch (e) {
    logger.error('[reviews/list]', e.message);
    res.status(500).json({ error: 'Could not load reviews.' });
  }
});

/**
 * True when `userId` has a real, app-recorded relationship with the provider:
 *
 *   lawyer   (entity_id = lawyers.id)
 *     · a consultation booking with that lawyer that has taken place
 *       (status 'completed', or 'confirmed' with a slot date before today), or
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
  if (entityType === 'lawyer') {
    const row = await db.get(
      `SELECT 1 AS ok WHERE
         EXISTS (SELECT 1 FROM consultation_bookings cb
                  WHERE cb.user_id = ? AND cb.lawyer_id = ?
                    AND (cb.status = 'completed'
                         OR (cb.status = 'confirmed' AND cb.date_slot < CURRENT_DATE)))
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
                  WHERE cb.user_id = ? AND COALESCE(l.user_id, ap.user_id) = ?
                    AND (cb.status = 'completed'
                         OR (cb.status = 'confirmed' AND cb.date_slot < CURRENT_DATE)))`,
      [userId, entityId, userId, entityId]
    );
    return !!row;
  }
  return false;
}

// ── POST /api/reviews ─────────────────────────────────────────────────────────
router.post('/', authRequired, validate(createReviewSchema), reviewsLimiter, async (req, res) => {
  try {
    const { entity_type, entity_id, rating, comment: rawComment = '', anonymous = 0 } = req.body || {};

    if (!entity_type || !entity_id || !rating) {
      return err400(res, 'entity_type, entity_id, and rating are required.');
    }
    if (!VALID_ENTITY_TYPES.has(entity_type)) {
      return err400(res, `entity_type must be one of: ${[...VALID_ENTITY_TYPES].join(', ')}.`);
    }

    const safeRating  = Math.max(1, Math.min(5, Number(rating) || 0));
    if (!safeRating) return err400(res, 'rating must be 1–5.');

    const safeComment = rawComment ? truncateStr(sanitizeStr(String(rawComment)), 1000) : '';

    const d = await getDb();
    const entityId = safeInt(entity_id);
    if (!entityId) return err400(res, 'entity_id must be a number.');

    // One review per user per entity
    const existing = await d.get('SELECT id FROM reviews WHERE user_id=? AND entity_type=? AND entity_id=?', [req.user.id, entity_type, entityId]);
    if (existing) return res.status(409).json({ error: 'You have already reviewed this.', code: 'duplicate_review' });

    const verified = await hasVerifiedRelationship(d, req.user.id, entity_type, entityId)
      .catch(e => { logger.warn('[reviews/verify]', e.message); return false; });

    const r = await d.run(
      `INSERT INTO reviews (user_id, entity_type, entity_id, provider_id, rating, comment, verified, anonymous)
       VALUES (?,?,?,?,?,?,?,?)`,
      [req.user.id, entity_type, entityId, entityId, safeRating, safeComment, verified ? 1 : 0, anonymous ? 1 : 0]
    );

    const row = await d.get(
      `SELECT ${REVIEW_COLS} FROM reviews WHERE id=?`,
      [r.lastID]
    );
    res.json(row);
  } catch (e) {
    logger.error('[reviews/create]', e.message);
    res.status(500).json({ error: 'Could not save review.' });
  }
});

// ── GET /api/reviews/summary ──────────────────────────────────────────────────
// Returns aggregate rating + top 2 text reviews for attorney cards.
router.get('/summary', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !entity_id) {
      return err400(res, 'entity_type and entity_id required.');
    }

    const d = await getDb();
    const safeType = String(entity_type).slice(0, 30);
    const safeId   = safeInt(entity_id);

    const [agg, top] = await Promise.all([
      d.get(
        'SELECT AVG(rating) as avg_rating, COUNT(*) as count, SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified_count FROM reviews WHERE entity_type=? AND entity_id=?',
        [safeType, safeId]
      ),
      d.all(
        `SELECT rating, comment, anonymous, verified, created_at FROM reviews
         WHERE entity_type=? AND entity_id=? AND comment != ''
         ORDER BY id DESC LIMIT 2`,
        [safeType, safeId]
      ),
    ]);

    res.json({
      avg_rating:  agg?.avg_rating ? Math.round(parseFloat(agg.avg_rating) * 10) / 10 : null,
      count:       Number(agg?.count || 0),
      verified_count: Number(agg?.verified_count || 0),
      top_reviews: top || [],
    });
  } catch (e) {
    logger.error('[reviews/summary]', e.message);
    res.status(500).json({ error: 'Could not load review summary.' });
  }
});

export default router;
