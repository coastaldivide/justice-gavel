import { validate, validateQuery, schemas } from '../../validation/schemas.js';
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

import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr }           from '../../utils/routeHelpers.js';
import { makeUserLimiter }                    from '../../middleware/sharedAiLimiter.js';
import { Router }                             from 'express';
import { authRequired }                       from '../../middleware/auth.js';
import { getDb }                              from '../../db/index.js';
import logger                                 from '../../utils/logger.js';
import { sanitiseField, requireDefender }     from './_helpers.js';

const router        = Router();
const casesListLimiter = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'Too many requests.' });
const assignLimiter = makeUserLimiter({ windowMs: 60_000, max: 20, message: 'Too many assignment operations.' });

// ── GET /api/attorney/cases ───────────────────────────────────────────────────
router.get('/cases', authRequired, casesListLimiter, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db } = ctx;

    const page   = Math.max(1, safeInt(req.query.page  || '1'));
    const limit  = Math.min(50, Math.max(1, safeInt(req.query.limit || '20')));
    const offset = (page - 1) * limit;
    const status = req.query.status ? sanitizeStr(req.query.status, 30) : null;

    let sql    = `SELECT c.id, c.title, c.status, c.next_court_date, c.state,
                         c.created_at, c.updated_at,
                         c.charge_description, c.bail_amount,
                         ca.assigned_at, ca.status as assignment_status,
                         ca.notes as assignment_notes,
                         u.display_name as client_name, u.email as client_email, u.phone as client_phone,
                         (SELECT COUNT(*) FROM case_messages cm
                           WHERE cm.case_id = c.id
                             AND cm.read_at IS NULL
                             AND cm.sender_type = 'user') as unread_count,
                         (SELECT ce.description FROM case_events ce
                           WHERE ce.case_id = c.id
                             AND ce.event_date >= date('now')
                           ORDER BY ce.event_date ASC LIMIT 1) as next_event_description,
                         (SELECT ce.event_date FROM case_events ce
                           WHERE ce.case_id = c.id
                             AND ce.event_date >= date('now')
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
router.post('/cases/:caseId/assign', authRequired, assignLimiter, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db }       = ctx;
    const caseId       = safeInt(req.params.caseId);
    const { defender_id, notes = '' } = req.body || {};
    const assignTo     = defender_id ? safeInt(defender_id) : req.user.id;
    const safeNotes    = notes ? truncateStr(sanitizeStr(String(notes), 500), 500) : '';

    const cas = await db.get(
      'SELECT id FROM cases WHERE id=?',
      [caseId]
    );
    if (!cas) return err404(res, 'Case not found.');

    await db.run(
      `INSERT OR REPLACE INTO case_assignments
         (case_id, defender_id, assigned_by, office_id, status, notes, assigned_at)
       VALUES (?,?,?,?,?,?,datetime('now'))`,
      [caseId, assignTo, req.user.id, ctx.user.office_id || null, 'active', safeNotes]
    );
    res.status(201).json({ ok: true, case_id: caseId, defender_id: assignTo });
  } catch (e) {
    logger.error('[attorney/cases/assign]', e.message);
    res.status(500).json({ error: 'Could not assign case.' });
  }
});

// ── GET /api/attorney/office ──────────────────────────────────────────────────
router.get('/office', authRequired, casesListLimiter, async (req, res) => {
  try {
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
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
       GROUP BY om.id
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
        WHERE ca.case_id = ? AND ca.defender_id = ?`,
      [caseId, req.user.id]
    );
    if (!assignment) return res.status(403).json({ error: 'Not assigned to this case' });

    // Update case with outcome
    await db.run(
      `UPDATE cases SET status = 'closed', outcome = ?, outcome_notes = ?,
                        outcome_recorded_by = ?, outcome_recorded_at = datetime('now')
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
    const ctx = await req.user?.role !== 'attorney' ? res.status(403).json({ error: 'Attorney access required' }) : null;
    if (!ctx) return;
    const { db }                      = ctx;
    const { office_id, office_name, role = 'attorney' } = req.body || {};

    if (!office_id)   return err400(res, 'office_id is required.');
    if (!office_name) return err400(res, 'office_name is required.');

    const safeOfficeName = truncateStr(sanitizeStr(String(office_name), 200), 200);
    const VALID_ROLES    = new Set(['attorney','partner','associate','paralegal','admin']);
    const safeRole       = VALID_ROLES.has(role) ? role : 'attorney';

    await db.run('UPDATE users SET office_id=? WHERE id=?', [office_id, req.user.id]);
    await db.run(
      `INSERT OR IGNORE INTO office_members (office_id, office_name, user_id, role)
       VALUES (?,?,?,?)`,
      [office_id, safeOfficeName, req.user.id, safeRole]
    );
    res.status(201).json({ ok: true, office_id, role: safeRole });
  } catch (e) {
    logger.error('[attorney/office/join]', e.message);
    res.status(500).json({ error: 'Could not join office.' });
  }
});

export default router;
