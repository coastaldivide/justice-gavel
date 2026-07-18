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

import { Router }     from 'express';
import { asyncRoute } from '../utils/routeHelpers.js';
import { authRequired } from '../middleware/auth.js';
import { sendTransactionalEmail } from '../services/email.js';

const router = Router();

/**
 * POST /api/cases/:id/close
 * Called when attorney or user marks a case as closed.
 * Triggers the retention flow.
 */
router.post('/:id/close', authRequired, asyncRoute(async (req, res) => {
  const { id }    = req.params;
  const { reason, outcome } = req.body;
  const userId    = req.user.id;

  // Verify ownership
  const caseRow = await req.db.get(
    'SELECT * FROM cases WHERE id = ? AND user_id = ?', [id, userId]
  );
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });

  // Close the case
  await req.db.run(`
    UPDATE cases
    SET status = 'closed', close_reason = ?, close_outcome = ?, closed_at = NOW()
    WHERE id = ?
  `, [reason, outcome, id]);

  // ── Trigger retention flow ──────────────────────────────────────────────
  const retention = await buildRetentionPayload(userId, caseRow, outcome);

  // Email: "Your case is closed — here's what comes next"
  await sendTransactionalEmail({
    to:       req.user.email,
    template: 'case_closed_retention',
    data:     {
      name:                 req.user.name,
      case_type:            caseRow.case_type,
      outcome,
      expungement_eligible: retention.expungement_eligible,
      wait_years:           retention.wait_years,
      next_steps:           retention.next_steps,
    },
  }).catch(() => {}); // non-critical

  return res.json({
    data: {
      case_id:   id,
      status:    'closed',
      retention, // Sent to frontend to display "What Now?" screen
    },
  });
}));

async function buildRetentionPayload(userId, caseRow, outcome) {
  const state    = caseRow.state ?? 'CA';
  const charge   = caseRow.charge_type ?? 'misdemeanor';

  // Expungement eligibility (immediate check at case close)
  const expRules = await getExpungementRules(state, charge);
  const yearsWait = expRules?.wait_years ?? 3;

  return {
    expungement_eligible: outcome !== 'convicted' || expRules?.eligible,
    wait_years:           yearsWait,
    eligible_date:        new Date(
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
    return await require('../utils/expungementRules.js').checkEligibility(state, charge, 0);
  } catch { return { eligible: false, wait_years: 5 }; }
}

export default router;
