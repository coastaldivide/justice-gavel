import { logIgnored } from '../utils/ignored.js';
import { validate, schemas } from '../validation/schemas.js';
import { audit, AUDIT_ACTIONS } from '../utils/audit.js';
/**
 * routes/cases.js — User case management
 *
 * Cases are the consumer-facing equivalent of Matters.
 * They belong to individual users (defendants, family members).
 * Notes and sensitive content are AES-256-GCM encrypted at rest.
 *
 * GET    /api/cases                           — paginated list (own cases)
 * POST   /api/cases                           — create case
 * PUT    /api/cases/:id                       — update case
 * DELETE /api/cases/:id                       — delete case
 * GET    /api/cases/:id/status-history        — status change log
 * GET    /api/cases/:id/events                — case timeline
 * POST   /api/cases/:id/events                — add timeline event
 * DELETE /api/cases/:id/events/:eventId       — remove event
 * POST   /api/cases/:id/share                 — generate 7-day read share link
 * GET    /api/cases/shared/:token             — public read (no auth, token only)
 * DELETE /api/cases/:id/share                 — revoke share token
 * POST   /api/cases/:id/followers             — invite a family follower (owner consent required) → code
 * GET    /api/cases/:id/followers             — who follows the case's court dates
 * DELETE /api/cases/:id/followers/:fid        — stop sharing (revocable any time)
 *        (/:id/invite, /:id/family-access[/:mid] = older names of the same three)
 * GET    /api/cases/family                    — cases I follow (court dates only, no notes)
 */

import { err400, truncateStr, err404, safeInt, sanitizeStr } from '../utils/routeHelpers.js';
import { makeUserLimiter }                 from '../middleware/sharedAiLimiter.js';
import { Router }                          from 'express';
import { getDb }                           from '../db/index.js';
import { authRequired }                    from '../middleware/auth.js';
import { encrypt, decrypt }                from '../services/encryption.js';
import { randomBytes }                     from 'crypto';
import logger                              from '../utils/logger.js';
import { checkLegalHold }                  from '../services/retention.js';
import {
  cancelCourtReminders, listPendingCourtReminders, scheduleForCourtDate, syncLegacyCourtDate,
  refreshNextCourtDate, rememberRequestPrefs, rescheduleUserCourtReminders, CLOSED_CASE_STATUSES,
} from '../services/courtReminders.js';
import {
  createInvite, listFollowers, revokeFollower, listFollowing, FollowError, notifyFollowersCourtDateChanged,
} from '../services/followers.js';
import { resolveLang, msg } from '../i18n/index.js';

const router       = Router();
const casesLimiter = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'Too many case operations. Slow down.' });

// Tightly-scoped column lists — never SELECT * /* intentional */ ──────────────────────────────── /* intentional separator comment */
const CASE_COLS = `id, user_id, title, status, next_court_date, notes,
                   state, created_at, updated_at, expungement_notified, share_token`;

const CASE_SAFE_COLS = `id, user_id, title, status, next_court_date,
                        state, created_at, expungement_notified, share_token`;

// ── VALID STATUS SET ──────────────────────────────────────────────────────────
const VALID_STATUSES = new Set([
  'Open', 'Active', 'Closed', 'Dismissed', 'Pending', 'On Appeal',
  'Expunged', 'Transferred', 'Inactive',
]);
// Case-insensitive lookup so 'open' / 'OPEN' map to the canonical 'Open'
const STATUS_CANON = new Map([...VALID_STATUSES].map(s => [s.toLowerCase(), s]));
const canonStatus  = (s) => (s == null ? s : STATUS_CANON.get(String(s).trim().toLowerCase()) || s);
// Accept 'YYYY-MM-DD' or a full ISO timestamp; anything else → null.
// The column is a DATE (calendar day): keep the day exactly as the client wrote
// it (no UTC conversion, which would move evening times in the Americas to the
// next day) and reject impossible days such as 2026-02-30.
export function safeCourtDate(v) {
  if (!v) return null;
  const str = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.exec(str);
  if (!m || Number.isNaN(Date.parse(str))) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// ── GET / — list own cases (paginated) ───────────────────────────────────────
router.get('/', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    // The app expects a plain array (CaseScreen/HomeScreen/LawyersScreen).
    // Pass ?page= to get the paginated envelope { data, pagination } instead.
    const paginated = req.query.page !== undefined;
    const page   = Math.max(1, safeInt(req.query.page  || '1'));
    const limit  = Math.min(paginated ? 50 : 200, Math.max(1, safeInt(req.query.limit || (paginated ? '20' : '200'))));
    const offset = (page - 1) * limit;
    const status = req.query.status ? sanitizeStr(req.query.status, 30) : null;

    // notes are the owner's own (encrypted at rest) — returned decrypted so the
    // case editor starts from the saved text. Without them, editing any field
    // re-sent notes:'' and silently erased the user's notes.
    let sql    = `SELECT ${CASE_SAFE_COLS}, notes FROM cases WHERE user_id=? AND deleted_at IS NULL`;
    const args = [req.user.id];
    if (status) { sql += ' AND status=?'; args.push(status); }
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const [rows, countRow] = await Promise.all([
      db.all(sql, args),
      db.get(
        status
          ? 'SELECT COUNT(*) as total FROM cases WHERE user_id=? AND deleted_at IS NULL AND status=?'
          : 'SELECT COUNT(*) as total FROM cases WHERE user_id=? AND deleted_at IS NULL',
        status ? [req.user.id, status] : [req.user.id]
      ),
    ]);

    const total = countRow?.total ?? 0;
    for (const row of rows) row.notes = row.notes ? decrypt(row.notes) : '';
    res.setHeader('X-Total-Count', String(total));
    if (!paginated) return res.json(rows);
    res.json({
      data:       rows,
      pagination: {
        page, limit, total,
        pages:   Math.ceil(total / limit),
        hasMore: offset + rows.length < total,
      },
    });
  } catch (e) {
    logger.error('[cases/list]', e.message);
    res.status(500).json({ error: 'Could not load cases.' });
  }
});

// ── POST / — create case ──────────────────────────────────────────────────────
router.post('/', authRequired, validate(schemas.cases.create), casesLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const {
      title        = '',
      status       = 'Open',
      notes        = '',
      state        = null,
    } = req.body || {};
    const next_court_date = safeCourtDate(req.body?.next_court_date ?? req.body?.court_date);
    if ((req.body?.next_court_date || req.body?.court_date) && !next_court_date) {
      return err400(res, 'next_court_date must be YYYY-MM-DD');
    }

    const safeTitle = truncateStr(sanitizeStr(String(title || ''), 300), 300);
    if (!safeTitle.trim()) return err400(res, 'title is required.');

    const safeStatus = VALID_STATUSES.has(canonStatus(status)) ? canonStatus(status) : 'Open';
    const safeNotes  = notes ? truncateStr(sanitizeStr(String(notes), 10_000), 10_000) : '';
    const safeState  = state ? sanitizeStr(String(state), 3).toUpperCase() : null;

    // Idempotency: prevent duplicate case creation
    const recent = await db.get(
      `SELECT id FROM cases WHERE user_id = ? AND title = ?
       AND created_at > (NOW() - INTERVAL '10 seconds') LIMIT 1`,
      [req.user.id, (req.body.title || '').trim()]
    ).catch(() => null);
    if (recent) return res.status(409).json({ error: 'Duplicate case — please wait before submitting again', existingId: recent.id });

    const r = await db.run(
      `INSERT INTO cases (user_id, title, status, next_court_date, notes, state, charge, updated_at)
        VALUES (?,?,?,?,?,?,?, NOW())`,
      [
        req.user.id, safeTitle.trim(), safeStatus,
        next_court_date,
        safeNotes ? encrypt(safeNotes) : '',
        safeState,
        req.body?.charge ? truncateStr(sanitizeStr(String(req.body.charge), 500), 500) : null,
      ]
    );

    let rawRow = await db.get(
      `SELECT ${CASE_SAFE_COLS} FROM cases WHERE id=?`,
      [r.lastID]
    );
    if (rawRow) rawRow.notes = safeNotes || '';

    // Fallback: construct a minimal response if db.get returns undefined (sql.js timing)
    if (!rawRow && r.lastID) {
      rawRow = {
        id:             r.lastID,
        user_id:        req.user.id,
        title:          safeTitle.trim(),
        status:         safeStatus,
        state:          safeState,
        next_court_date: next_court_date || null,
        created_at:     new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      };
    }

    // Court-date reminders for every account (free included). Planned before
    // responding so the app can show them; a failure never fails the create —
    // the dispatcher's backfill sweep re-plans any case left without reminders.
    let reminders;
    if (next_court_date && rawRow) {
      reminders = await planReminders(db, req, {
        caseId: r.lastID, oldDate: null, newDate: next_court_date,
      });
    }

    const body = rawRow ?? { id: r.lastID, title: safeTitle.trim(), status: safeStatus };
    res.status(201).json(reminders ? { ...body, reminders } : body);
  } catch (e) {
    logger.error('[cases/create]', e.message);
    res.status(500).json({ error: 'Could not create case.' });
  }
});

// ── PUT /:id — update case ────────────────────────────────────────────────────
router.put('/:id', authRequired, validate(schemas.cases.update), casesLimiter, async (req, res) => {
  const db = await getDb();
  try {
    const caseId   = safeInt(req.params.id);
    const existing = await db.get(
      `SELECT ${CASE_COLS}, share_expires_at, expungement_notified FROM cases
       WHERE id=? AND user_id=?`,
      [caseId, req.user.id]
    );
    if (!existing) return err404(res, 'Case not found.');

    const {
      title, status, next_court_date, notes, state,
    } = req.body || {};

    const updates = []; const vals = [];

    if (title !== undefined) {
      const t = truncateStr(sanitizeStr(String(title || ''), 300), 300);
      if (!t.trim()) return err400(res, 'title cannot be empty.');
      updates.push('title=?'); vals.push(t.trim());
    }
    if (status !== undefined && status !== null) {
      if (!VALID_STATUSES.has(canonStatus(status))) return err400(res, `Invalid status. Valid: ${[...VALID_STATUSES].join(', ')}`);
      updates.push('status=?'); vals.push(canonStatus(status));
    }
    if (next_court_date !== undefined) {
      const d = safeCourtDate(next_court_date);
      if (next_court_date && !d) return err400(res, 'next_court_date must be YYYY-MM-DD');
      updates.push('next_court_date=?');
      vals.push(d);
    }
    if (notes !== undefined) {
      const n = notes ? truncateStr(sanitizeStr(String(notes), 10_000), 10_000) : '';
      updates.push('notes=?'); vals.push(n ? encrypt(n) : '');
    }
    if (state !== undefined) {
      updates.push('state=?');
      vals.push(state ? sanitizeStr(String(state), 3).toUpperCase() : null);
    }

    if (!updates.length) return err400(res, 'Nothing to update.');

    updates.push("updated_at=NOW()");
    vals.push(caseId, req.user.id);

    await db.run(
      `UPDATE cases SET ${updates.join(',')} WHERE id=? AND user_id=?`,
      vals
    );
    const raw = await db.get(
      `SELECT ${CASE_COLS} FROM cases WHERE id=?`,
      [caseId]
    );

    // Record status change (non-blocking)
    if (status != null && existing.status !== canonStatus(status)) {
      db.run(
        `INSERT INTO case_status_history (case_id, user_id, old_status, new_status)
         VALUES (?,?,?,?)`,
        [caseId, req.user.id, existing.status, canonStatus(status)]
      ).catch(e => logger.warn('[cases/update] status history:', e.message));
    }

    const updated = { ...raw, notes: decrypt(raw?.notes || '') };

    // Expungement push when case closes/dismisses (fire once)
    const newStatus = canonStatus(status) ?? existing.status;
    if (['Closed', 'Dismissed'].includes(newStatus) && !existing.expungement_notified) {
      triggerExpungementPush(db, req.user.id, updated).catch(logIgnored('routes/cases'));
    }

    // Court reminders follow the case. The form edits the case's single "next
    // court date": mirror it into court_dates (move / add / remove that
    // hearing), then re-plan; closing the case cancels every hearing's
    // reminders, re-opening it re-plans them.
    const finalStatus = updated.status || existing.status;
    const oldDate = existing.next_court_date ? String(existing.next_court_date).slice(0, 10) : null;
    const newDate = updated.next_court_date ? String(updated.next_court_date).slice(0, 10) : null;
    try {
      if (CLOSED_CASE_STATUSES.has(finalStatus)) {
        await cancelCourtReminders(db, req.user.id, caseId, 'case_closed');
      } else if (next_court_date !== undefined && newDate !== oldDate) {
        const reminders = await planReminders(db, req, { caseId, oldDate, newDate });
        if (reminders) updated.reminders = reminders;
      } else if ((title !== undefined && updated.title !== existing.title)
              || (state !== undefined && updated.state !== existing.state)
              || CLOSED_CASE_STATUSES.has(existing.status)) {
        const reminders = await replanCase(db, req, caseId);
        if (reminders) updated.reminders = reminders;
      }
    } catch (e) { logger.warn('[cases/update] reminders:', e.message); }

    // Followers hear about court-date changes ONLY (never other case edits),
    // with a fixed text (no title / place): services/followers.js.
    if (!CLOSED_CASE_STATUSES.has(finalStatus) && next_court_date !== undefined && newDate !== oldDate) {
      notifyFollowersCourtDateChanged(db, caseId, newDate ? 'changed' : 'cancelled').catch(logIgnored('routes/cases'));
    }

    res.json(updated);
  } catch (e) {
    logger.error('[cases/update]', e.message);
    res.status(500).json({ error: 'Could not update case.' });
  }
});

// ── DELETE /:id — delete case ─────────────────────────────────────────────────
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const caseId = safeInt(req.params.id);
    const cas    = await db.get('SELECT id FROM cases WHERE id=? AND user_id=?', [caseId, req.user.id]);
    if (!cas) return err404(res, 'Case not found.');

    // Legal hold check — users cannot delete cases that are frozen.
    // A family member or attorney may have placed a hold on this case.
    const hold = await checkLegalHold('case', caseId);
    if (hold) {
      return res.status(423).json({
        error: 'This case is under a legal hold and cannot be deleted.',
        hold_id:    hold.id,
        applied_at: hold.applied_at,
        reason:     hold.reason,
      });
    }

    await db.run("UPDATE cases SET deleted_at=NOW() WHERE id=? AND user_id=?", [caseId, req.user.id]);
    await cancelCourtReminders(db, req.user.id, caseId, 'case_deleted')
      .catch(e => logger.warn('[cases/delete] cancel reminders:', e.message));
    res.json({ ok: true });
  } catch (e) {
    logger.error('[cases/delete]', e.message);
    res.status(500).json({ error: 'Could not delete case.' });
  }
});

// ── GET /:id/status-history ───────────────────────────────────────────────────
router.get('/:id/status-history', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const caseId = safeInt(req.params.id);
    const cas    = await db.get('SELECT id FROM cases WHERE id=? AND user_id=?', [caseId, req.user.id]);
    if (!cas) return err404(res, 'Case not found.');
    const history = await db.all(
      `SELECT old_status, new_status, note, changed_at
       FROM case_status_history WHERE case_id=? ORDER BY changed_at DESC LIMIT 50`,
      [caseId]
    );
    res.json({ history });
  } catch {
    res.status(500).json({ error: 'Could not load status history.' });
  }
});

// ── Case timeline events ──────────────────────────────────────────────────────

const VALID_EVENT_TYPES = new Set([
  'arrest', 'bail_set', 'arraignment', 'hearing', 'motion_filed',
  'continuance', 'verdict', 'sentencing', 'appeal',
  'attorney_added', 'document_added', 'note', 'other',
]);

router.get('/:id/events', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const caseId = safeInt(req.params.id);
    const cas    = await db.get('SELECT id FROM cases WHERE id=? AND user_id=?', [caseId, req.user.id]);
    if (!cas) return err404(res, 'Case not found.');
    const events = await db.all(
      `SELECT id, event_type, title, description, event_date, amount_cents, location, created_at
       FROM case_events WHERE case_id=?
       ORDER BY COALESCE(event_date, created_at) DESC LIMIT 100`,
      [caseId]
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ events });
  } catch {
    res.status(500).json({ error: 'Could not load case timeline.' });
  }
});

router.post('/:id/events', authRequired, casesLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    const caseId = safeInt(req.params.id);
    const cas    = await db.get('SELECT id FROM cases WHERE id=? AND user_id=?', [caseId, req.user.id]);
    if (!cas) return err404(res, 'Case not found.');

    const {
      event_type   = 'note',
      title,
      description  = null,
      event_date   = null,
      amount_cents = null,
      location     = null,
    } = req.body || {};

    if (!title || !String(title).trim()) return err400(res, 'Event title is required.');

    const safeType  = VALID_EVENT_TYPES.has(event_type) ? event_type : 'note';
    const safeTitle = truncateStr(sanitizeStr(String(title), 200), 200);
    const safeDesc  = description ? truncateStr(sanitizeStr(String(description), 1000), 1000) : null;
    const safeLoc   = location    ? truncateStr(sanitizeStr(String(location),    200 ), 200 ) : null;
    const safeAmt   = amount_cents != null ? safeInt(amount_cents, 0) : null;
    const safeDate  = event_date ? sanitizeStr(String(event_date), 20) : null;

    const result = await db.run(
      `INSERT INTO case_events
         (case_id, user_id, event_type, title, description, event_date, amount_cents, location)
       VALUES (?,?,?,?,?,?,?,?)`,
      [caseId, req.user.id, safeType, safeTitle, safeDesc, safeDate, safeAmt, safeLoc]
    );

    const created = await db.get(
      `SELECT id, event_type, title, description, event_date, amount_cents, location, created_at
       FROM case_events WHERE id=?`,
      [result.lastID]
    );
    await audit(AUDIT_ACTIONS.CASE_CREATED, { req, entityType: 'case', entityId: String(caseId || '') });
    res.status(201).json({ event: created });
  } catch (e) {
    logger.error('[cases/events/create]', e.message);
    res.status(500).json({ error: 'Could not add event.' });
  }
});

router.delete('/:id/events/:eventId', authRequired, async (req, res) => {
  try {
    const db      = await getDb();
    const caseId  = safeInt(req.params.id);
    const eventId = safeInt(req.params.eventId);
    const cas     = await db.get('SELECT id FROM cases WHERE id=? AND user_id=?', [caseId, req.user.id]);
    if (!cas) return err404(res, 'Case not found.');
    await db.run('DELETE FROM case_events WHERE id=? AND case_id=? AND user_id=?', [eventId, caseId, req.user.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not delete event.' });
  }
});

// ── Case sharing ──────────────────────────────────────────────────────────────

router.post('/:id/share', authRequired, casesLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const cas = await db.get(`SELECT ${CASE_SAFE_COLS} FROM cases WHERE id=? AND user_id=?`, [safeInt(req.params.id), req.user.id]);
    if (!cas) return err404(res, 'Case not found.');

    // Cryptographically random token — NOT Math.random()
    const token   = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(
      'UPDATE cases SET share_token=?, share_expires_at=? WHERE id=?',
      [token, expires, safeInt(req.params.id)]
    );
    res.json({ token, expires_at: expires, share_url: `justicegavel.app/case/${token}` });
  } catch {
    res.status(500).json({ error: 'Could not generate share link.' });
  }
});

// Public endpoint — no auth — token IS the credential
router.get('/shared/:token', async (req, res) => {
  try {
    const db    = await getDb();
    const token = sanitizeStr(req.params.token, 80);
    const row   = await db.get(
      `SELECT id, title, status, next_court_date, created_at, state
       FROM cases WHERE share_token=? AND share_expires_at > NOW()`,
      [token]
    );
    if (!row) return err404(res, 'Share link expired or invalid.');
    res.json(row);
  } catch {
    res.status(500).json({ error: 'Could not load shared case.' });
  }
});

router.delete('/:id/share', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    await db.run(
      'UPDATE cases SET share_token=NULL, share_expires_at=NULL WHERE id=? AND user_id=?',
      [safeInt(req.params.id), req.user.id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not revoke share link.' });
  }
});

// ── Family followers (consented, revocable — services/followers.js) ─────────
// POST   /:id/followers            { consent: true, email?, name?, share_reminders? } → invite code
// GET    /:id/followers            who follows / is invited
// DELETE /:id/followers/:followId  stop sharing
// /:id/invite, /:id/family-access and GET /family are the older names of the
// same endpoints (kept so existing app builds keep working). The follower's
// side is /api/following.

function followFail(req, res, e, where) {
  const lang = resolveLang(req);
  if (e instanceof FollowError) return res.status(e.status).json({ error: e.localizedMessage(lang), code: e.code });
  logger.error({ err: e.message }, `[cases/followers${where}]`);
  return res.status(500).json({ error: msg(lang, 'follow.err.sharing') });
}

async function createFollowerHandler(req, res) {
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const lang = resolveLang(req);
    const out = await createInvite(await getDb(), {
      ownerId: req.user.id, caseId: safeInt(req.params.id), email: b.email ?? null, name: b.name ?? null,
      consent: b.consent, shareReminders: b.share_reminders !== false, lang,
    });
    // The invite code is a one-time secret (only its hash is stored): keep it
    // out of the idempotency replay cache too.
    res.locals.idempotencyNoStore = true;
    res.status(201).json({ ok: true, ...out, message: msg(lang, 'follow.invite_created') });
  } catch (e) { followFail(req, res, e, '/create'); }
}
async function listFollowersHandler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await listFollowers(await getDb(), req.user.id, safeInt(req.params.id)));
  } catch (e) { followFail(req, res, e, '/list'); }
}
async function revokeFollowerHandler(req, res) {
  try {
    res.json(await revokeFollower(await getDb(), req.user.id, safeInt(req.params.id), safeInt(req.params.memberId)));
  } catch (e) { followFail(req, res, e, '/revoke'); }
}

router.post('/:id/followers', authRequired, casesLimiter, createFollowerHandler);
router.get('/:id/followers', authRequired, listFollowersHandler);
router.delete('/:id/followers/:memberId', authRequired, revokeFollowerHandler);
router.post('/:id/invite', authRequired, casesLimiter, createFollowerHandler);
router.get('/:id/family-access', authRequired, listFollowersHandler);
router.delete('/:id/family-access/:memberId', authRequired, revokeFollowerHandler);

router.get('/family', authRequired, async (req, res) => {
  try {
    const rows = await listFollowing(await getDb(), req.user.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows.map(r => ({
      id: r.case_id, follow_id: r.follow_id, title: r.case_title, state: r.state,
      next_court_date: r.next_court_date, owner_name: r.owner_first_name, role: 'follower', court_dates: r.court_dates,
    })));
  } catch (e) { followFail(req, res, e, '/family'); }
});

// ── Private helpers ───────────────────────────────────────────────────────────

async function triggerExpungementPush(db, userId, caseRow) {
  const user      = await db.get('SELECT push_token FROM users WHERE id=?', [userId]).catch(() => null);
  const title     = caseRow.status === 'Dismissed' ? '📋 Your charge was dismissed' : '📋 Your case is closed';
  const body      = 'You may be eligible to expunge this from your record — seal it permanently. Tap to check eligibility.';
  const deliverAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at, notification_type, case_id)
     VALUES (?,?,?,?,?,?,'expungement',?)`,
    [userId, user?.push_token || null, title, body,
     JSON.stringify({ screen: 'Expungement', case_id: caseRow.id }), deliverAt, caseRow.id]
  );
  await db.run('UPDATE cases SET expungement_notified=1 WHERE id=?', [caseRow.id]);
}

/**
 * Mirror the case form's "next court date" into court_dates and plan that
 * hearing's reminders, first remembering the device time zone the app sent
 * (X-Timezone). Returns the pending reminders of that hearing, or undefined
 * when planning failed (logged; the backfill sweep retries later).
 */
async function planReminders(db, req, { caseId, oldDate, newDate }) {
  try {
    const changed = await rememberRequestPrefs(db, req.user.id, req);
    if (changed) await rescheduleUserCourtReminders(db, req.user.id);
    const courtDateId = await syncLegacyCourtDate(db, { caseId: Number(caseId), userId: req.user.id, oldDate, newDate });
    await refreshNextCourtDate(db, Number(caseId));
    if (!courtDateId) return [];
    const r = await scheduleForCourtDate(db, courtDateId);
    return r.reminders;
  } catch (e) {
    logger.warn({ caseId, err: e.message }, '[cases] court reminders not planned');
    return undefined;
  }
}

/** Re-plan every upcoming hearing of a case; returns all pending owner reminders of the case. */
async function replanCase(db, req, caseId) {
  try {
    if (await rememberRequestPrefs(db, req.user.id, req)) await rescheduleUserCourtReminders(db, req.user.id);
    const rows = await db.all(
      `SELECT id FROM court_dates WHERE case_id = ? AND user_id = ? AND deleted_at IS NULL AND status = 'scheduled'
          AND court_date >= CURRENT_DATE - 1 ORDER BY court_date LIMIT 50`, [caseId, req.user.id]);
    for (const r of rows) await scheduleForCourtDate(db, Number(r.id));
    return (await listPendingCourtReminders(db, req.user.id, caseId)).filter(x => x.type === 'court_reminder');
  } catch (e) {
    logger.warn({ caseId, err: e.message }, '[cases] court reminders not re-planned');
    return undefined;
  }
}

// GET /:id/reminders — the case's pending court reminders.
// POST /:id/reminders — (re)plan them now (idempotent; used by "Remind me").
router.get('/:id/reminders', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const caseId = safeInt(req.params.id);
    const cas = await db.get('SELECT id FROM cases WHERE id=? AND user_id=? AND deleted_at IS NULL', [caseId, req.user.id]);
    if (!cas) return err404(res, 'Case not found.');
    res.json({ reminders: await listPendingCourtReminders(db, req.user.id, caseId) });
  } catch (e) {
    logger.error('[cases/reminders]', e.message);
    res.status(500).json({ error: 'Could not load reminders.' });
  }
});

router.post('/:id/reminders', authRequired, casesLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const caseId = safeInt(req.params.id);
    const cas = await db.get(
      'SELECT id, title, status, next_court_date, state FROM cases WHERE id=? AND user_id=? AND deleted_at IS NULL',
      [caseId, req.user.id]);
    if (!cas) return err404(res, 'Case not found.');
    if (!cas.next_court_date) return err400(res, 'This case has no court date. Add one to get reminders.');
    if (CLOSED_CASE_STATUSES.has(cas.status)) return err400(res, 'This case is closed.');
    if (await rememberRequestPrefs(db, req.user.id, req)) await rescheduleUserCourtReminders(db, req.user.id);
    // a case whose date predates court_dates gets its hearing row now
    const nextDate = String(cas.next_court_date).slice(0, 10);
    await syncLegacyCourtDate(db, { caseId, userId: req.user.id, oldDate: nextDate, newDate: nextDate });
    const reminders = await replanCase(db, req, caseId);
    const { resolveReminderTimeZone } = await import('../services/courtReminders.js');
    const r = { reminders: reminders || [], time_zone: (await resolveReminderTimeZone(db, req.user.id, cas.state)).tz };
    if (!r.reminders.length) return err400(res, 'This court date has already passed.');
    res.json({ case_id: caseId, time_zone: r.time_zone, reminders: r.reminders });
  } catch (e) {
    logger.error('[cases/reminders/plan]', e.message);
    res.status(500).json({ error: 'Could not set reminders.' });
  }
});


// GET /family/contacts — the people following the user's cases.
// Only ACTIVE (accepted, not revoked / expired / pending) follows, and only
// what the owner entered or the follower agreed to by accepting: the name and
// e-mail the owner typed on the invite. The follower's own account details
// (account e-mail, phone, display name) are never returned.
router.get('/family/contacts', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT cfa.id, cfa.case_id, cfa.invite_name, cfa.invite_email, cfa.accepted_at, cfa.share_reminders,
              c.title AS case_title, c.status AS case_status
         FROM case_family_access cfa
         JOIN cases c ON c.id = cfa.case_id AND c.user_id = ? AND c.deleted_at IS NULL
        WHERE cfa.status = 'active' AND cfa.user_id IS NOT NULL
        ORDER BY cfa.accepted_at DESC NULLS LAST LIMIT 200`,
      [req.user.id]
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows.map(r => ({
      id: Number(r.id), case_id: Number(r.case_id), case_title: r.case_title, case_status: r.case_status,
      role: 'follower', name: r.invite_name || null, email: r.invite_email || null,
      accepted_at: r.accepted_at, share_reminders: Number(r.share_reminders) === 1,
    })));
  } catch (e) {
    logger.error('[GET /family/contacts]', e.message);
    res.status(500).json({ error: 'Could not load family contacts' });
  }
});

export default router;