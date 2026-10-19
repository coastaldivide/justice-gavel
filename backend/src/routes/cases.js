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
 * POST   /api/cases/:id/invite                — invite family member by email
 * GET    /api/cases/:id/family-access         — list who has access
 * DELETE /api/cases/:id/family-access/:mid    — revoke family access
 * GET    /api/cases/family                    — cases shared with me
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
  scheduleCourtReminders, cancelCourtReminders, listPendingCourtReminders,
  rememberTimeZone, rescheduleUserCourtReminders, CLOSED_CASE_STATUSES,
} from '../services/courtReminders.js';

const router       = Router();
const casesLimiter = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'Too many case operations. Slow down.' });

// ── Expo push singleton — lazy-initialized once ───────────────────────────────
let _expo = null;
async function getExpo() {
  if (_expo) return _expo;
  const { Expo } = await import('expo-server-sdk');
  _expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  return _expo;
}

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
        caseId: r.lastID, caseTitle: safeTitle.trim(), courtDate: next_court_date, state: safeState,
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
      triggerExpungementPush(db, req.user.id, updated).catch(() => {});
    }

    // Court reminders follow the case: re-plan when the date (or title/state,
    // which appear in / time the reminder) changes; cancel when the date is
    // cleared or the case is closed.
    const finalStatus = updated.status || existing.status;
    const finalDate   = updated.next_court_date ? String(updated.next_court_date).slice(0, 10) : null;
    if (!finalDate || CLOSED_CASE_STATUSES.has(finalStatus)) {
      await cancelCourtReminders(db, req.user.id, caseId, finalDate ? 'case_closed' : 'court_date_cleared')
        .catch(e => logger.warn('[cases/update] cancel reminders:', e.message));
    } else if (finalDate !== (existing.next_court_date ? String(existing.next_court_date).slice(0, 10) : null)
            || (title !== undefined && updated.title !== existing.title)
            || (state !== undefined && updated.state !== existing.state)
            || CLOSED_CASE_STATUSES.has(existing.status)) {
      const reminders = await planReminders(db, req, {
        caseId, caseTitle: updated.title || existing.title, courtDate: finalDate, state: updated.state,
      });
      if (reminders) updated.reminders = reminders;
    }

    // Push to linked family members (non-blocking)
    notifyFamilyMembers(db, caseId, updated.title || existing.title).catch(() => {});

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

// ── Family access ─────────────────────────────────────────────────────────────

router.post('/:id/invite', authRequired, casesLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const cas = await db.get('SELECT id, user_id FROM cases WHERE id=? AND user_id=?', [safeInt(req.params.id), req.user.id]);
    if (!cas) return err404(res, 'Case not found.');

    const { email } = req.body || {};
    if (!email?.trim()) return err400(res, 'email required.');

    const invitee = await db.get(
      'SELECT id, display_name FROM users WHERE LOWER(email)=LOWER(?)',
      [email.trim().toLowerCase()]
    );
    if (!invitee) return err404(res, 'No Justice Gavel account found for that email. They must create an account first.');
    if (invitee.id === req.user.id) return err400(res, 'You cannot invite yourself.');

    const existing = await db.get(
      'SELECT id FROM case_family_access WHERE case_id=? AND user_id=?',
      [safeInt(req.params.id), invitee.id]
    );
    if (existing) return res.status(409).json({ error: 'This person already has access to this case.' });

    await db.run(
      'INSERT INTO case_family_access (case_id, user_id, invited_by, role, accepted) VALUES (?,?,?,?,0)',
      [safeInt(req.params.id), invitee.id, req.user.id, 'family']
    );
    res.json({ ok: true, invitee_name: invitee.display_name || email, message: 'Invite sent.' });
  } catch {
    res.status(500).json({ error: 'Could not send invite.' });
  }
});

router.get('/:id/family-access', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const cas = await db.get('SELECT id FROM cases WHERE id=? AND user_id=?', [safeInt(req.params.id), req.user.id]);
    if (!cas) return res.status(403).json({ error: 'Access denied.' });
    const members = await db.all(
      `SELECT cfa.id, cfa.role, cfa.accepted, cfa.invited_at,
              u.display_name as name, u.email
       FROM case_family_access cfa
       LEFT JOIN users u ON u.id = cfa.user_id
       WHERE cfa.case_id=?
       ORDER BY cfa.invited_at DESC LIMIT 100`,
      [safeInt(req.params.id)]
    ).catch(() => []);
    res.json(members);
  } catch {
    res.status(500).json({ error: 'Could not load family access.' });
  }
});

router.delete('/:id/family-access/:memberId', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const cas = await db.get('SELECT id FROM cases WHERE id=? AND user_id=?', [safeInt(req.params.id), req.user.id]);
    if (!cas) return res.status(403).json({ error: 'Access denied.' });
    await db.run(
      'DELETE FROM case_family_access WHERE id=? AND case_id=?',
      [safeInt(req.params.memberId), safeInt(req.params.id)]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not revoke access.' });
  }
});

router.get('/family', authRequired, async (req, res) => {
  try {
    const db   = await getDb();
    const rows = await db.all(
      `SELECT c.id, c.title, c.status, c.next_court_date, c.created_at, c.state,
              cfa.role, cfa.invited_at,
              u.display_name as owner_name, u.email as owner_email
       FROM cases c
       JOIN case_family_access cfa ON cfa.case_id = c.id
       LEFT JOIN users u ON u.id = c.user_id
       WHERE cfa.user_id=? AND cfa.accepted=1
       ORDER BY c.next_court_date ASC, c.created_at DESC
       LIMIT 50`,
      [req.user.id]
    ).catch(() => []);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Could not load shared cases.' });
  }
});

// ── Private helpers ───────────────────────────────────────────────────────────

async function notifyFamilyMembers(db, caseId, caseTitle) {
  const familyRows = await db.all(
    `SELECT u.push_token FROM case_family_access cfa
     JOIN users u ON u.id = cfa.user_id
     WHERE cfa.case_id=? AND cfa.accepted=1 AND u.push_token IS NOT NULL`,
    [caseId]
  ).catch(() => []);
  if (!familyRows.length) return;
  const expo = await getExpo();
  const msgs = familyRows
    .filter(r => expo.constructor.isExpoPushToken(r.push_token))
    .map(r => ({
      to: r.push_token, sound: 'default',
      title: '⚖️ Case updated',
      body:  `"${caseTitle}" was updated.`,
      data:  { type: 'case_update', case_id: caseId },
    }));
  if (msgs.length) expo.sendPushNotificationsAsync(msgs).catch(e => logger.warn('[cases/push]', e.message));
}

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
 * Plan the court reminders for one case, first remembering the device time
 * zone the app sent (X-Timezone). Returns the pending reminders, or undefined
 * when planning failed (logged; the backfill sweep retries later).
 */
async function planReminders(db, req, { caseId, caseTitle, courtDate, state }) {
  try {
    const tzChanged = await rememberTimeZone(db, req.user.id, req.get('X-Timezone'));
    if (tzChanged) await rescheduleUserCourtReminders(db, req.user.id);
    const r = await scheduleCourtReminders(db, {
      userId: req.user.id, caseId: Number(caseId), caseTitle, courtDate, state,
    });
    return r.reminders;
  } catch (e) {
    logger.warn({ caseId, err: e.message }, '[cases] court reminders not planned');
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
    await rememberTimeZone(db, req.user.id, req.get('X-Timezone'));
    const r = await scheduleCourtReminders(db, {
      userId: req.user.id, caseId, caseTitle: cas.title,
      courtDate: String(cas.next_court_date).slice(0, 10), state: cas.state,
    });
    if (!r.reminders.length) return err400(res, 'This court date has already passed.');
    res.json({ case_id: caseId, time_zone: r.time_zone, reminders: r.reminders });
  } catch (e) {
    logger.error('[cases/reminders/plan]', e.message);
    res.status(500).json({ error: 'Could not set reminders.' });
  }
});


// GET /family/contacts — emergency contacts for user's cases
router.get('/family/contacts', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const contacts = await db.all(
      `SELECT cfa.id, cfa.user_id, u.name, u.email, u.phone, cfa.role, cfa.case_id,
              c.title as case_title, c.status as case_status
       FROM case_family_access cfa
       LEFT JOIN users u ON u.id = cfa.user_id
       LEFT JOIN cases c ON c.id = cfa.case_id
       WHERE cfa.case_id IN (SELECT id FROM cases WHERE user_id = ?)
       ORDER BY cfa.created_at DESC LIMIT 200`,
      [req.user.id]
    );
    res.json(contacts || []);
  } catch (e) {
    logger.error('[GET /family/contacts]', e.message);
    res.status(500).json({ error: 'Could not load family contacts' });
  }
});

export default router;