import { validate, createCaseSchema } from '../middleware/validate.js';
import { audit, AUDIT_ACTIONS } from '../utils/audit.js';
import { auditLog } from '../utils/auditLog.js';
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

import { err400, truncateStr, err401, err403,
         err404, safeInt, sanitizeStr }    from '../utils/routeHelpers.js';
import { makeUserLimiter }                 from '../middleware/sharedAiLimiter.js';
import { Router }                          from 'express';
import { getDb }                           from '../db/index.js';
import { authRequired }                    from '../middleware/auth.js';
import { encrypt, decrypt }                from '../services/encryption.js';
import { randomBytes }                     from 'crypto';
import logger                              from '../utils/logger.js';
import { checkLegalHold }                  from '../services/retention.js';

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
  'Open', 'Closed', 'Dismissed', 'Pending', 'On Appeal',
  'Expunged', 'Transferred', 'Inactive',
]);

// ── GET / — list own cases (paginated) ───────────────────────────────────────
router.get('/', authRequired, async (req, res) => {
  try {
    const db     = await getDb();
    const page   = Math.max(1, safeInt(req.query.page  || '1'));
    const limit  = Math.min(50, Math.max(1, safeInt(req.query.limit || '20')));
    const offset = (page - 1) * limit;
    const status = req.query.status ? sanitizeStr(req.query.status, 30) : null;

    let sql    = `SELECT ${CASE_SAFE_COLS} FROM cases WHERE user_id=? AND deleted_at IS NULL`;
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
router.post('/', authRequired, validate(createCaseSchema), casesLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const {
      title        = '',
      status       = 'Open',
      next_court_date = null,
      notes        = '',
      state        = null,
    } = req.body || {};

    const safeTitle = truncateStr(sanitizeStr(String(title || ''), 300), 300);
    if (!safeTitle.trim()) return err400(res, 'title is required.');

    const safeStatus = VALID_STATUSES.has(status) ? status : 'Open';
    const safeNotes  = notes ? truncateStr(sanitizeStr(String(notes), 10_000), 10_000) : '';
    const safeState  = state ? sanitizeStr(String(state), 3).toUpperCase() : null;

    const r = await db.run(
      `INSERT INTO cases (user_id, title, status, next_court_date, notes, state)
       VALUES (?,?,?,?,?,?)`,
      [
        req.user.id, safeTitle.trim(), safeStatus,
        next_court_date ? sanitizeStr(String(next_court_date), 20) : null,
        safeNotes ? encrypt(safeNotes) : '',
        safeState,
      ]
    );

    let rawRow = await db.get(
      `SELECT ${CASE_SAFE_COLS} FROM cases WHERE id=?`,
      [r.lastID]
    );

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

    // Schedule court date reminders if date was provided
    if (next_court_date && rawRow) {
      scheduleCourtReminders(db, req.user.id, r.lastID, safeTitle.trim(), next_court_date)
        .catch(() => {});
    }

    res.status(201).json(rawRow ?? { id: r.lastID, title: safeTitle.trim(), status: safeStatus });
  } catch (e) {
    logger.error('[cases/create]', e.message);
    res.status(500).json({ error: 'Could not create case.' });
  }
});

// ── PUT /:id — update case ────────────────────────────────────────────────────
router.put('/:id', authRequired, casesLimiter, async (req, res) => {
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
    if (status !== undefined) {
      if (!VALID_STATUSES.has(status)) return err400(res, `Invalid status. Valid: ${[...VALID_STATUSES].join(', ')}`);
      updates.push('status=?'); vals.push(status);
    }
    if (next_court_date !== undefined) {
      updates.push('next_court_date=?');
      vals.push(next_court_date ? sanitizeStr(String(next_court_date), 20) : null);
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

    updates.push("updated_at=datetime('now')");
    vals.push(caseId, req.user.id);

    await db.run('BEGIN');
    await db.run(
      `UPDATE cases SET ${updates.join(',')} WHERE id=? AND user_id=?`,
      vals
    );
    const raw = await db.get(
      `SELECT ${CASE_COLS} FROM cases WHERE id=?`,
      [caseId]
    );
    await db.run('COMMIT');

    // Record status change (non-blocking)
    if (status !== undefined && existing.status !== status) {
      db.run(
        `INSERT INTO case_status_history (case_id, user_id, old_status, new_status)
         VALUES (?,?,?,?)`,
        [caseId, req.user.id, existing.status, status]
      ).catch(() => {});
    }

    const updated = { ...raw, notes: decrypt(raw?.notes || '') };

    // Expungement push when case closes/dismisses (fire once)
    const newStatus = status ?? existing.status;
    if (['Closed', 'Dismissed'].includes(newStatus) && !existing.expungement_notified) {
      triggerExpungementPush(db, req.user.id, updated).catch(() => {});
    }

    // Reschedule court reminders if date changed
    if (next_court_date !== undefined && next_court_date !== existing.next_court_date) {
      scheduleCourtReminders(
        db, req.user.id, caseId,
        updated.title || existing.title,
        next_court_date
      ).catch(() => {});
    }

    // Push to linked family members (non-blocking)
    notifyFamilyMembers(db, caseId, updated.title || existing.title).catch(() => {});

    res.json(updated);
  } catch (e) {
    await db.run('ROLLBACK').catch(() => {});
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

    await db.run("UPDATE cases SET deleted_at=datetime('now') WHERE id=? AND user_id=?", [caseId, req.user.id]);
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
  } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
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
       FROM cases WHERE share_token=? AND share_expires_at > datetime('now')`,
      [token]
    );
    if (!row) return err404(res, 'Share link expired or invalid.');
    res.json(row);
  } catch (e) {
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
  } catch (e) {
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
      'SELECT id, display_name FROM users WHERE email=? COLLATE NOCASE',
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
  } catch (e) {
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
       ORDER BY cfa.invited_at DESC`,
      [safeInt(req.params.id)]
    ).catch(() => []);
    res.json(members);
  } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
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
    `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at)
     VALUES (?,?,?,?,?,?)`,
    [userId, user?.push_token || null, title, body,
     JSON.stringify({ screen: 'Expungement', case_id: caseRow.id }), deliverAt]
  );
  await db.run('UPDATE cases SET expungement_notified=1 WHERE id=?', [caseRow.id]);
}

async function scheduleCourtReminders(db, userId, caseId, caseTitle, courtDateStr) {
  if (!courtDateStr) return;
  const STARTER_TIERS = new Set(['advisor','legal_pro','legal_radar','starter_annual','pro_annual','legal_radar_annual']);
  try {
    const sub = await db.get(
      "SELECT tier FROM subscriptions WHERE user_id=? AND status IN ('active','trialing') ORDER BY id DESC LIMIT 1",
      [userId]
    );
    if (!sub || !STARTER_TIERS.has(sub.tier)) return;
  } catch (e) { logger.warn('[cases/court-reminder]', e?.message); return; }

  const courtDate = new Date(courtDateStr);
  if (isNaN(courtDate.getTime()) || courtDate < new Date()) return;

  // Remove stale reminders for this case before inserting new ones
  await db.run(
    "DELETE FROM scheduled_pushes WHERE user_id=? AND data LIKE ?",
    [userId, `%"case_id":${caseId}%`]
  ).catch(() => {});

  const user  = await db.get('SELECT push_token FROM users WHERE id=?', [userId]).catch(() => null);
  const token = user?.push_token || null;

  const reminders = [
    { days: 7, title: '📅 Court date in 7 days',   body: `${caseTitle} — Court on ${courtDate.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}` },
    { days: 3, title: '⚠️ Court date in 3 days',   body: `${caseTitle} — Review your case and contact your lawyer.` },
    { days: 1, title: '🚨 Court date TOMORROW',    body: `${caseTitle} — Be on time and bring all documents.` },
    { days: 0, title: '🏛️ Court date TODAY',       body: `${caseTitle} — Your court appearance is today. Good luck.` },
  ];

  await Promise.all(reminders.map(async r => {
    const deliverAt = new Date(courtDate);
    deliverAt.setDate(deliverAt.getDate() - r.days);
    deliverAt.setHours(8, 0, 0, 0);
    if (deliverAt <= new Date()) return;
    await db.run(
      `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at)
       VALUES (?,?,?,?,?,?)`,
      [userId, token, r.title, r.body,
       JSON.stringify({ screen: 'CasesTab', case_id: caseId }),
       deliverAt.toISOString()]
    ).catch(() => {});
  }));
}


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
       ORDER BY cfa.created_at DESC`,
      [req.user.id]
    );
    res.json(contacts || []);
  } catch (e) {
    logger.error('[GET /family/contacts]', e.message);
    res.status(500).json({ error: 'Could not load family contacts' });
  }
});

export default router;
