/**
 * routes/caseCounsel.js — the CLIENT side of attorney ↔ case consent (C1).
 *
 * An attorney can only become counsel on a case (read the privileged thread,
 * message the client as "attorney") through a relationship the case owner
 * created. The owner invites an attorney here; the invite is a PENDING
 * case_assignments row; the attorney accepts it from the Attorney Inbox
 * (POST /api/attorney/inbox/accept/:assignmentId) or with
 * POST /api/attorney/cases/:caseId/assign. The owner can revoke at any time.
 *
 *   GET    /api/cases/:caseId/counsel                 — owner: list invited / active counsel
 *   POST   /api/cases/:caseId/counsel                 — owner: invite { attorney_user_id } or { lawyer_id }
 *   DELETE /api/cases/:caseId/counsel/:attorneyId     — owner: revoke an invite or remove counsel
 *
 * Only the case owner can use these routes; everyone else gets 404 (case ids
 * of other users are not confirmed).
 */
import { Router }        from 'express';
import { authRequired }  from '../middleware/auth.js';
import { getDb }         from '../db/index.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { truncateStr }   from '../utils/routeHelpers.js';
import logger            from '../utils/logger.js';
import { sendPushToUser } from '../services/pushDelivery.js';

const router  = Router();
const limiter = makeUserLimiter({ windowMs: 3_600_000, max: 30, message: 'Too many counsel changes — try again later.' });

const isId = (v) => /^\d{1,15}$/.test(String(v ?? ''));
const ATTORNEY_ROLES = new Set(['attorney', 'defender']);

async function ownedCase(db, req, res) {
  const caseId = req.params.caseId;
  if (!isId(caseId)) { res.status(404).json({ error: 'Case not found' }); return null; }
  const cas = await db.get('SELECT id, user_id, title FROM cases WHERE id = ?', [Number(caseId)]);
  if (!cas || Number(cas.user_id) !== Number(req.user.id)) {
    res.status(404).json({ error: 'Case not found' });
    return null;
  }
  return cas;
}

/** Resolve the attorney ACCOUNT being invited (by user id or by directory listing id). */
async function resolveAttorney(db, { attorney_user_id, lawyer_id }) {
  let userId = null;
  if (attorney_user_id != null && isId(attorney_user_id)) {
    userId = Number(attorney_user_id);
  } else if (lawyer_id != null && isId(lawyer_id)) {
    // Read-only lookup of the directory row's linked account (directory rows are never modified).
    const row = await db.get(
      `SELECT COALESCE(l.user_id, ap.user_id) AS uid
         FROM lawyers l LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
        WHERE l.id = ? LIMIT 1`, [Number(lawyer_id)]);
    userId = row?.uid ? Number(row.uid) : null;
  }
  if (!userId) return null;
  const u = await db.get(
    `SELECT id, display_name, role, is_defender, account_status FROM users WHERE id = ?`, [userId]);
  if (!u) return null;
  if (!ATTORNEY_ROLES.has(u.role) && Number(u.is_defender) !== 1) return null;
  if (['banned', 'suspended', 'deleted', 'disabled'].includes(String(u.account_status || 'active'))) return null;
  return u;
}

// ── GET /api/cases/:caseId/counsel ────────────────────────────────────────────
router.get('/:caseId/counsel', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const cas = await ownedCase(db, req, res);
    if (!cas) return;
    const rows = await db.all(
      `SELECT ca.id AS assignment_id, ca.defender_id AS attorney_id, ca.status,
              ca.assigned_at, ca.accepted_at, u.display_name AS attorney_name
         FROM case_assignments ca
         LEFT JOIN users u ON u.id = ca.defender_id
        WHERE ca.case_id = ? AND ca.status IN ('pending', 'active')
        ORDER BY ca.assigned_at DESC NULLS LAST`, [cas.id]);
    res.json({ case_id: cas.id, counsel: rows });
  } catch (e) {
    logger.error('[cases/counsel/list]', e?.message);
    res.status(500).json({ error: 'Could not load counsel.' });
  }
});

// ── POST /api/cases/:caseId/counsel — invite an attorney ──────────────────────
router.post('/:caseId/counsel', authRequired, limiter, async (req, res) => {
  try {
    const db  = await getDb();
    const cas = await ownedCase(db, req, res);
    if (!cas) return;
    const attorney = await resolveAttorney(db, req.body || {});
    if (!attorney) {
      return res.status(400).json({
        error: 'attorney_not_found',
        message: 'That attorney does not have a Justice Gavel attorney account yet.',
      });
    }
    if (Number(attorney.id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'You cannot invite yourself.' });
    }
    const note = req.body?.note ? truncateStr(String(req.body.note), 500) : null;

    const existing = await db.get(
      'SELECT id, status FROM case_assignments WHERE case_id = ? AND defender_id = ? ORDER BY id DESC LIMIT 1',
      [cas.id, attorney.id]);
    let assignmentId;
    if (existing && ['pending', 'active'].includes(existing.status)) {
      return res.status(200).json({ ok: true, assignment_id: existing.id, status: existing.status, already: true });
    }
    if (existing) {
      await db.run(
        `UPDATE case_assignments
            SET status = 'pending', assigned_by = ?, user_id = ?, notes = ?, assigned_at = NOW(),
                accepted_at = NULL, declined_at = NULL
          WHERE id = ?`,
        [req.user.id, req.user.id, note, existing.id]);
      assignmentId = existing.id;
    } else {
      const r = await db.run(
        `INSERT INTO case_assignments (case_id, defender_id, assigned_by, user_id, status, notes, assigned_at)
         VALUES (?, ?, ?, ?, 'pending', ?, NOW())`,
        [cas.id, attorney.id, req.user.id, req.user.id, note]);
      assignmentId = r.lastID;
    }

    sendPushToUser(attorney.id, {
      title: 'New case invitation',
      body:  'A client invited you to their case. Open your Attorney Inbox to accept.',
      data:  { screen: 'AttorneyInbox' },
      channelId: 'attorney_messages',
    }).catch(() => {});

    res.status(201).json({ ok: true, assignment_id: assignmentId, status: 'pending', attorney_id: attorney.id });
  } catch (e) {
    logger.error('[cases/counsel/invite]', e?.message);
    res.status(500).json({ error: 'Could not invite attorney.' });
  }
});

// ── DELETE /api/cases/:caseId/counsel/:attorneyId — revoke ────────────────────
router.delete('/:caseId/counsel/:attorneyId', authRequired, limiter, async (req, res) => {
  try {
    const db  = await getDb();
    const cas = await ownedCase(db, req, res);
    if (!cas) return;
    if (!isId(req.params.attorneyId)) return res.status(404).json({ error: 'Counsel not found' });
    const r = await db.run(
      `UPDATE case_assignments SET status = 'revoked', declined_at = NOW()
        WHERE case_id = ? AND defender_id = ? AND status IN ('pending', 'active')`,
      [cas.id, Number(req.params.attorneyId)]);
    if (!r.changes) return res.status(404).json({ error: 'Counsel not found' });
    res.json({ ok: true, case_id: cas.id, attorney_id: Number(req.params.attorneyId), status: 'revoked' });
  } catch (e) {
    logger.error('[cases/counsel/revoke]', e?.message);
    res.status(500).json({ error: 'Could not remove counsel.' });
  }
});

export default router;
