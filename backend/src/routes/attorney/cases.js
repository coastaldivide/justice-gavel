/**
 * attorney/cases.js — Case assignment and office management
 *
 * GET  /api/attorney/cases                 — all active cases assigned to defender
 * POST /api/attorney/cases/:caseId/assign  — assign case to self or colleague
 * GET  /api/attorney/office                — office member list with case counts
 * POST /api/attorney/office/join           — join or create an office
 *
 * All endpoints require the user to be a verified defender (attorney flag).
 * Case assignment is scoped to the defender's own cases in GET — no leakage
 * of other attorneys' assigned cases.
 *
 * Pagination added to GET /cases (previously unbounded).
 */

import { err400, err404, safeInt, sanitizeStr, truncateStr } from '../../utils/routeHelpers.js';
import { makeUserLimiter }                    from '../../middleware/sharedAiLimiter.js';
import { Router }                             from 'express';
import { authRequired }                       from '../../middleware/auth.js';
import logger                                 from '../../utils/logger.js';
import { requireDefender, requireAttorney } from './_helpers.js';

const router        = Router();
const casesListLimiter = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'Too many requests.' });
const assignLimiter = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'Too many assignment operations.' });

// ── GET /api/attorney/cases ───────────────────────────────────────────────────
router.get('/cases', authRequired, casesListLimiter, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { db } = ctx;

    const page   = Math.max(1, safeInt(req.query.page  || '1'));
    const limit  = Math.min(50, Math.max(1, safeInt(req.query.limit || '20')));
    const offset = (page - 1) * limit;
    const status = req.query.status ? sanitizeStr(req.query.status, 30) : null;

    let sql    = `SELECT c.id, c.title, c.status, c.next_court_date, c.state,
                         c.created_at, c.updated_at,
                         c.charge, c.bail_amount_cents AS bail_amount,
                         ca.assigned_at, ca.status as assignment_status,
                         ca.notes as assignment_notes,
                         u.display_name as client_name, u.email as client_email, u.phone as client_phone,
                         (SELECT COUNT(*) FROM case_messages cm
                           WHERE cm.case_id = c.id
                             AND cm.read_at IS NULL
                             AND cm.sender_type = 'user') as unread_count,
                         (SELECT ce.description FROM case_events ce
                           WHERE ce.case_id = c.id
                             AND ce.event_date >= CURRENT_DATE
                           ORDER BY ce.event_date ASC LIMIT 1) as next_event_description,
                         (SELECT ce.event_date FROM case_events ce
                           WHERE ce.case_id = c.id
                             AND ce.event_date >= CURRENT_DATE
                           ORDER BY ce.event_date ASC LIMIT 1) as next_event_date
                  FROM cases c
                  JOIN case_assignments ca ON ca.case_id = c.id
                  LEFT JOIN users u ON u.id = c.user_id
                  WHERE ca.defender_id=? AND ca.status=?`;
    const args = [req.user.id, 'active'];

    if (status) { sql += ' AND c.status=?'; args.push(status); }
    sql += ' ORDER BY c.next_court_date ASC, ca.assigned_at DESC LIMIT ? OFFSET ?';
    args.push(limit, offset);

    const [cases, countRow] = await Promise.all([
      db.all(sql, args),
      db.get(
        `SELECT COUNT(*) as total FROM cases c
         JOIN case_assignments ca ON ca.case_id=c.id
         WHERE ca.defender_id=? AND ca.status='active'${status ? ' AND c.status=?' : ''}`,
        status ? [req.user.id, status] : [req.user.id]
      ),
    ]);

    const total = countRow?.total ?? 0;

    // Enrich cases with AI intake context so attorneys can review defendant's situation
    const enriched = await Promise.all(cases.map(async (cas) => {
      try {
        if (!cas.client_email) return { ...cas, ai_intake_context: null };
        const clientUser = await db.get(
          'SELECT id FROM users WHERE email = ? LIMIT 1', [cas.client_email]);
        if (!clientUser) return { ...cas, ai_intake_context: null };
        const session = await db.get(
          'SELECT id FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
          [clientUser.id]);
        if (!session) return { ...cas, ai_intake_context: null };
        const msg = await db.get(
          `SELECT content FROM chat_messages
            WHERE session_id = ? AND role = 'assistant'
            ORDER BY created_at DESC LIMIT 1`, [session.id]);
        return {
          ...cas,
          ai_intake_context: msg?.content
            ? msg.content.slice(0, 300).replace(/\n/g, ' ')
            : null,
        };
      } catch { return { ...cas, ai_intake_context: null }; }
    }));

    res.json({
      cases: enriched,
      count:      cases.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (e) {
    logger.error('[attorney/cases/list]', e.message);
    res.status(500).json({ error: 'Could not load assigned cases.' });
  }
});

// ── POST /api/attorney/cases/:caseId/assign ───────────────────────────────────
// Becoming counsel on a case requires a relationship the CLIENT created (C1):
//   self (no defender_id, or defender_id = caller):
//     • a pending invite from the case owner (POST /api/cases/:id/counsel) → accepted
//     • or a confirmed/completed consultation booking between the case owner and
//       this attorney → active
//   a colleague (defender_id ≠ caller):
//     • the caller must already be ACTIVE counsel on the case, and the colleague
//       must be an attorney in the same firm (firm_members) or office (office_members)
//   platform staff (admin / super_admin, live DB role) may assign any attorney.
// Anything else → 403 no_client_relationship. Existing assignments of other
// attorneys are never overwritten.
const STAFF = new Set(['admin', 'super_admin']);

// consultation_bookings.lawyer_id is a DIRECTORY id (lawyers.id), never a user
// id: the attorney account is linked to its listing only through
// attorney_profiles.lawyer_id / lawyers.user_id (set by operators after
// verification). Comparing lawyer_id with the caller's user id would let account
// #N claim every client who booked directory lawyer #N.
async function hasConsultationWith(db, clientId, attorneyId) {
  const row = await db.get(
    `SELECT cb.id FROM consultation_bookings cb
      WHERE cb.user_id = ?
        AND cb.status IN ('confirmed', 'completed')
        AND (cb.lawyer_id IN (SELECT ap.lawyer_id FROM attorney_profiles ap WHERE ap.user_id = ? AND ap.lawyer_id IS NOT NULL)
             OR cb.lawyer_id IN (SELECT l.id FROM lawyers l WHERE l.user_id = ?))
      LIMIT 1`,
    [clientId, attorneyId, attorneyId]).catch(() => null);
  return !!row;
}

async function sharesPractice(db, a, b) {
  const firm = await db.get(
    `SELECT 1 AS x FROM firm_members f1
       JOIN firm_members f2 ON f2.firm_id = f1.firm_id
      WHERE f1.user_id = ? AND f2.user_id = ?
        AND COALESCE(f1.active,1) = 1 AND COALESCE(f1.status,'active') = 'active'
        AND COALESCE(f2.active,1) = 1 AND COALESCE(f2.status,'active') = 'active'
      LIMIT 1`, [a, b]).catch(() => null);
  if (firm) return true;
  const office = await db.get(
    `SELECT 1 AS x FROM office_members o1
       JOIN office_members o2 ON o2.office_id = o1.office_id
      WHERE o1.user_id = ? AND o2.user_id = ? AND COALESCE(o1.active,1) = 1 AND COALESCE(o2.active,1) = 1
      LIMIT 1`, [a, b]).catch(() => null);
  return !!office;
}

async function upsertAssignment(db, { caseId, defenderId, assignedBy, officeId, notes, status }) {
  const existing = await db.get(
    'SELECT id FROM case_assignments WHERE case_id = ? AND defender_id = ? ORDER BY id DESC LIMIT 1',
    [caseId, defenderId]);
  if (existing) {
    await db.run(
      `UPDATE case_assignments
          SET status = ?, assigned_by = ?, office_id = COALESCE(?, office_id),
              notes = COALESCE(NULLIF(?, ''), notes),
              accepted_at = CASE WHEN ? = 'active' THEN NOW() ELSE accepted_at END,
              assigned_at = COALESCE(assigned_at, NOW())
        WHERE id = ?`,
      [status, assignedBy, officeId, notes, status, existing.id]);
    return existing.id;
  }
  const r = await db.run(
    `INSERT INTO case_assignments
       (case_id, defender_id, assigned_by, office_id, status, notes, assigned_at, accepted_at)
     VALUES (?,?,?,?,?,?,NOW(), CASE WHEN ? = 'active' THEN NOW() ELSE NULL END)`,
    [caseId, defenderId, assignedBy, officeId, status, notes, status]);
  return r.lastID;
}

router.post('/cases/:caseId/assign', authRequired, assignLimiter, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { db }       = ctx;
    const caseId       = safeInt(req.params.caseId);
    const { defender_id, notes = '' } = req.body || {};
    const assignTo     = defender_id ? safeInt(defender_id) : req.user.id;
    const safeNotes    = notes ? truncateStr(sanitizeStr(String(notes), 500), 500) : '';
    if (!caseId || !assignTo) return err400(res, 'Invalid case or attorney id.');

    const cas = await db.get('SELECT id, user_id FROM cases WHERE id=?', [caseId]);
    if (!cas) return err404(res, 'Case not found.');

    const isStaffCaller = STAFF.has(ctx.user.role);
    const self          = Number(assignTo) === Number(req.user.id);
    let status = null;

    if (isStaffCaller) {
      status = 'active';
    } else if (self) {
      const invite = await db.get(
        `SELECT id FROM case_assignments WHERE case_id = ? AND defender_id = ? AND status IN ('pending','active') LIMIT 1`,
        [caseId, req.user.id]);
      if (invite || await hasConsultationWith(db, cas.user_id, req.user.id)) status = 'active';
    } else {
      const callerActive = await db.get(
        `SELECT id FROM case_assignments WHERE case_id = ? AND defender_id = ? AND status = 'active' LIMIT 1`,
        [caseId, req.user.id]);
      if (callerActive && await sharesPractice(db, req.user.id, assignTo)) status = 'active';
    }

    if (!status) {
      logger.warn({ caseId, by: req.user.id, to: assignTo }, '[attorney/cases/assign] refused — no client relationship');
      return res.status(403).json({
        error: 'no_client_relationship',
        message: 'You can only be assigned to a case the client invited you to (or booked a consultation with you for).',
      });
    }

    // The colleague / staff target must be an attorney account.
    if (!self) {
      const target = await db.get('SELECT id, role, is_defender FROM users WHERE id = ?', [assignTo]);
      if (!target || (!['attorney', 'defender'].includes(target.role) && Number(target.is_defender) !== 1)) {
        return err400(res, 'defender_id must be an attorney account.');
      }
    }

    await upsertAssignment(db, {
      caseId, defenderId: assignTo, assignedBy: req.user.id,
      officeId: ctx.user.office_id || null, notes: safeNotes, status,
    });
    res.status(201).json({ ok: true, case_id: caseId, defender_id: assignTo, status });
  } catch (e) {
    logger.error('[attorney/cases/assign]', e.message);
    res.status(500).json({ error: 'Could not assign case.' });
  }
});

// ── GET /api/attorney/office ──────────────────────────────────────────────────
router.get('/office', authRequired, casesListLimiter, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { db, user } = ctx;
    if (!user.office_id) return res.json({ members: [], office_id: null });

    const members = await db.all(
      `SELECT om.id, om.role, om.active, om.joined_at,
              u.display_name as name, u.email,
              COUNT(DISTINCT ca.case_id) as active_cases
       FROM office_members om
       JOIN users u ON u.id = om.user_id
       LEFT JOIN case_assignments ca
         ON ca.defender_id = om.user_id AND ca.status='active'
       WHERE om.office_id=? AND om.active=1
       GROUP BY om.id, u.display_name, u.email
       ORDER BY om.role DESC, u.display_name ASC
       LIMIT 100`,
      [user.office_id]
    );
    res.json({ members, office_id: user.office_id, count: members.length });
  } catch (e) {
    logger.error('[attorney/office]', e.message);
    res.status(500).json({ error: 'Could not load office.' });
  }
});

// ── POST /api/attorney/office/join ────────────────────────────────────────────

// ── POST /api/attorney/cases/:caseId/outcome — record case outcome ──────────
// Attorneys record the final result of a case. This feeds back into
// the match scoring algorithm — attorneys who achieve good outcomes
// surface higher in future defendant searches.
router.post('/cases/:caseId/outcome', authRequired, assignLimiter, async (req, res) => {
  const ctx = await requireDefender(req, res);
  if (!ctx) return;
  const { db } = ctx;

  const caseId  = safeInt(req.params.caseId);
  const { outcome, notes = '' } = req.body || {};

  const VALID_OUTCOMES = new Set([
    'dismissed', 'acquitted', 'not_guilty', 'plea_deal',
    'convicted', 'plea_guilty', 'deferred', 'expunged', 'other',
  ]);
  const POSITIVE_OUTCOMES = new Set(['dismissed','acquitted','not_guilty','deferred','expunged']);

  if (!outcome || !VALID_OUTCOMES.has(outcome)) {
    return res.status(400).json({ error: 'Valid outcome required', valid: [...VALID_OUTCOMES] });
  }

  try {
    // Verify assignment
    const assignment = await db.get(
      `SELECT ca.*, c.user_id AS client_id, l.id AS lawyer_id
         FROM case_assignments ca
         JOIN cases c ON c.id = ca.case_id
         LEFT JOIN attorney_profiles ap ON ap.user_id = ca.defender_id
         LEFT JOIN lawyers l ON l.id = ap.lawyer_id
        WHERE ca.case_id = ? AND ca.defender_id = ? AND ca.status = 'active'`,
      [caseId, req.user.id]
    );
    if (!assignment) return res.status(403).json({ error: 'Not assigned to this case' });

    // Update case with outcome
    await db.run(
      `UPDATE cases SET status = 'closed', outcome = ?, outcome_notes = ?,
                        outcome_recorded_by = ?, outcome_recorded_at = NOW()
        WHERE id = ?`,
      [outcome, sanitizeStr(notes, 500), req.user.id, caseId]
    );

    // Update attorney's platform_rating based on outcomes
    // Positive outcomes improve rating; negative outcomes don't penalize heavily
    if (assignment.lawyer_id) {
      const outcomes = await db.all(
        `SELECT c.outcome FROM cases c
           JOIN case_assignments ca ON ca.case_id = c.id
          WHERE ca.defender_id = ? AND c.outcome IS NOT NULL`,
        [req.user.id]
      );
      const total    = outcomes.length;
      const positive = outcomes.filter(o => POSITIVE_OUTCOMES.has(o.outcome)).length;
      const rate     = total > 0 ? positive / total : 0;
      // Outcome score: 3.0 base + up to 2.0 for 100% positive rate
      const outcomeScore = (3.0 + rate * 2.0).toFixed(1);

      await db.run(
        `UPDATE attorney_profiles SET outcome_score = ?, outcome_count = ? WHERE user_id = ?`,
        [outcomeScore, total, req.user.id]
      ).catch(() => {}); // Non-fatal if column doesn't exist yet
    }

    res.json({
      success: true,
      case_id: caseId,
      outcome,
      message: 'Case outcome recorded. Thank you — this helps defendants find effective attorneys.',
    });
  } catch (e) {
    logger.error('[cases/outcome]', e?.message);
    res.status(500).json({ error: 'Could not record outcome' });
  }
});

router.post('/office/join', authRequired, assignLimiter, async (req, res) => {
  try {
    const ctx = await requireAttorney(req, res);
    if (!ctx) return;
    const { db }                      = ctx;
    const { office_id, office_name, role = 'attorney' } = req.body || {};

    if (!office_id)   return err400(res, 'office_id is required.');
    if (!office_name) return err400(res, 'office_name is required.');

    const safeOfficeName = truncateStr(sanitizeStr(String(office_name), 200), 200);
    const VALID_ROLES    = new Set(['attorney','partner','associate','paralegal','admin']);
    const safeRole       = VALID_ROLES.has(role) ? role : 'attorney';

    const officeId = safeInt(office_id);
    if (!officeId) return err400(res, 'office_id must be a numeric office id.');
    // An existing office can't be joined by just knowing its id (that exposed the
    // member list and enabled colleague assignment). Only a brand-new office id,
    // or one the caller already belongs to, is accepted.
    const members = await db.get(
      'SELECT COUNT(*) AS n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine FROM office_members WHERE office_id = ? AND COALESCE(active,1) = 1',
      [req.user.id, officeId]);
    const firstMember = Number(members?.n || 0) === 0;
    if (!firstMember && !Number(members?.mine || 0)) {
      return res.status(403).json({ error: 'office_invite_required', message: 'This office already exists. Ask its administrator to add you.' });
    }
    await db.run('UPDATE users SET office_id=? WHERE id=?', [officeId, req.user.id]);
    await db.run(
      `INSERT INTO office_members (office_id, office_name, user_id, role)
       VALUES (?,?,?,?) ON CONFLICT DO NOTHING`,
      [officeId, safeOfficeName, req.user.id, firstMember ? 'admin' : safeRole]
    );
    res.status(201).json({ ok: true, office_id: officeId, role: firstMember ? 'admin' : safeRole });
  } catch (e) {
    logger.error('[attorney/office/join]', e.message);
    res.status(500).json({ error: 'Could not join office.' });
  }
});

export default router;
