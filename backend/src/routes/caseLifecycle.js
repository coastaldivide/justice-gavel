// Input size guard — applied globally to all POST handlers in this file
/**
 * routes/caseLifecycle.js — Case completion → retention flow
 *
 * When a case closes, instead of losing the user we:
 *  1. Trigger expungement eligibility check
 *  2. Show "What Now?" screen with reentry resources
 *  3. Offer record sealing timeline
 *  4. Present credit repair + housing resources
 *  5. Start a "Life After" email sequence
 */

import { logIgnored } from '../utils/ignored.js';
import { Router }     from 'express';
import { sharedAiLimiter } from '../middleware/sharedAiLimiter.js';
import { asyncRoute } from '../utils/routeHelpers.js';
import { authRequired } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';
import { cancelCourtReminders } from '../services/courtReminders.js';
import { resolveLang, msg } from '../i18n/index.js';

const router = Router();

/**
 * POST /api/cases/:id/close
 * Called when attorney or user marks a case as closed.
 * Triggers the retention flow.
 */
router.post('/:id/close', sharedAiLimiter, authRequired, asyncRoute(async (req, res) => {
  const { id }    = req.params;
  const { reason, outcome } = req.body || {};
  const userId    = req.user.id;
  if (!/^\d+$/.test(String(id))) return res.status(400).json({ error: 'Invalid case id' });

  // Verify ownership
  const caseRow = await req.db.get(
    'SELECT id, user_id, status, state, charge FROM cases WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [id, userId]);
  if (!caseRow) return res.status(404).json({ error: msg(resolveLang(req), 'case.err.not_found') });

  // Close the case: the canonical status the app and the reminder planner use ('Closed'),
  // with the status history and every pending court reminder cancelled.
  await req.db.run(`
    UPDATE cases
    SET status = 'Closed', close_reason = ?, close_outcome = ?, closed_at = NOW(), updated_at = NOW()
    WHERE id = ?
  `, [reason ? String(reason).slice(0, 200) : null, outcome ? String(outcome).slice(0, 60) : null, id]);
  if (caseRow.status !== 'Closed') {
    await req.db.run('INSERT INTO case_status_history (case_id, user_id, old_status, new_status) VALUES (?,?,?,?)',
      [id, userId, caseRow.status, 'Closed']).catch(logIgnored('routes/caseLifecycle'));
  }
  await cancelCourtReminders(req.db, userId, Number(id), 'case_closed').catch(logIgnored('routes/caseLifecycle'));

  // ── Trigger retention flow ──────────────────────────────────────────────
  const retention = await buildRetentionPayload(userId, caseRow, outcome);

  // Email: "Your case is closed — here's what comes next"
  await sendEmail({
    to:       req.user.email,
    template: 'case_closed_retention',
    data:     {
      name:                 req.user.name,
      outcome,
      expungement_eligible: retention.expungement_eligible,
      wait_years:           retention.wait_years,
      next_steps:           retention.next_steps,
    },
  }).catch(logIgnored('routes/caseLifecycle')); // non-critical

  return res.json({
    data: {
      case_id:   id,
      status:    'Closed',
      retention, // Sent to frontend to display "What Now?" screen
    },
  });
}));

async function buildRetentionPayload(userId, caseRow, outcome) {
  // Only what the expungement rules engine knows for the case's own state — no
  // assumed state, charge or waiting period (an unknown stays null).
  const expRules = caseRow.state ? await getExpungementRules(caseRow.state, caseRow.charge || '') : null;
  const yearsWait = Number.isFinite(expRules?.wait_years) ? expRules.wait_years : null;

  return {
    expungement_eligible: expRules ? (outcome !== 'convicted' || expRules.eligible) : null,
    wait_years:           yearsWait,
    eligible_date:        yearsWait == null ? null : new Date(
      Date.now() + yearsWait * 365.25 * 24 * 3600 * 1000
    ).toISOString().slice(0, 10),
    next_steps: [
      outcome === 'dismissed' && {
        title:       'Your record is clearable — start now',
        description: 'A dismissed case may still show on background checks. Expungement removes it.',
        action:      'START_EXPUNGEMENT',
        priority:    1,
      },
      {
        title:       'Download your case records',
        description: 'Get certified copies of your case for employment and housing applications.',
        action:      'DOWNLOAD_RECORDS',
        priority:    2,
      },
      {
        title:       'Credit repair resources',
        description: 'Arrests and court involvement can affect your credit. Here\'s how to address it.',
        action:      'CREDIT_REPAIR',
        priority:    3,
      },
      {
        title:       'Housing assistance',
        description: 'Many landlords run background checks. Know your rights and find fair-chance housing.',
        action:      'HOUSING_RESOURCES',
        priority:    4,
      },
    ].filter(Boolean),
  };
}

async function getExpungementRules(state, charge) {
  // Returns eligibility and wait period from the DB / rules engine
  try {
    const { getEligibility, classifyCharge } = await import('./expungement/rules.js');
    const known = ['felony','misdemeanor','dui','domestic','sexual','dismissed'];
    const type  = known.includes(String(charge).toLowerCase()) ? String(charge).toLowerCase() : classifyCharge(String(charge || ''));
    const r = getEligibility(state, type);
    return { eligible: r.eligible === true || r.eligible === 'conditional', wait_years: r.wait_years ?? r.waitYears ?? r.waiting_years ?? null };
  } catch { return null; }
}

export default router;
