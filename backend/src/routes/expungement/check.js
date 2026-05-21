/**
 * expungement/check.js — GET /check — record expungement eligibility check
 *
 * Stateless — no database reads, no auth required.
 * Pure deterministic computation from state rules + charge classification.
 *
 * Query params:
 *   state   — 2-letter state code (default: TN)
 *   charges — description of the charge(s)
 *   status  — case status: Closed | Dismissed | Convicted (default: Closed)
 *
 * Returns:
 *   eligibility — { likely, conditional, notEligible, waitYears, note }
 *   partners    — referral links to expungement services
 *   disclaimer  — mandatory legal notice
 */

import { Router }         from 'express';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { sanitizeStr }    from '../../utils/routeHelpers.js';
import logger             from '../../utils/logger.js';
import { STATE_RULES, classifyCharge, getEligibility } from './rules.js';

const router      = Router();
const checkLimiter = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'Eligibility check limit reached.' });

// ── Referral partners — update periodically ───────────────────────────────────
const PARTNERS = [
  {
    key:           'general',
    name:          'Expungement Attorney',
    description:   'Connect with a local attorney who specializes in record sealing and expungement.',
    estimatedCost: '$500–$1,500',
    referralFee:   '$75 (paid by attorney after retention)',
    cta:           'Get Free Consultation',
    url:           'https://justicegavel.app/expunge',
  },
  {
    key:           'recordseal',
    name:          'RecordSeal.com',
    description:   'Online expungement service. Flat fee, no hourly billing.',
    estimatedCost: '$179–$399',
    referralFee:   'Revenue share on completed orders',
    cta:           'Check Eligibility Free',
    url:           'https://recordseal.com/?ref=justicegavel',
  },
];

const DISCLAIMER =
  'IMPORTANT: This eligibility result is general information only — not legal advice. ' +
  'Expungement eligibility depends on your full criminal history, the specific statute in ' +
  'your state, and recent case law. Consult a licensed attorney in your state before ' +
  'filing any petition. Laws change frequently — verify current rules with your state court.';

// Valid case-status values — declared at module level (constant across all requests)
const VALID_STATUSES = new Set(['Closed', 'Dismissed', 'Convicted', 'Pending', 'Open', 'Expunged', 'Transferred']);

// ── GET /check ────────────────────────────────────────────────────────────────
router.get('/check', checkLimiter, async (req, res) => {
  try {
    const rawState = sanitizeStr(String(req.query.state || 'TN'), 2).toUpperCase();
    // Validate state is exactly 2 alpha chars — otherwise fall back to TN defaults
    const state = /^[A-Z]{2}$/.test(rawState) ? rawState : 'TN';
    if (state !== rawState) logger.warn(`[expungement/check] invalid state '${rawState}' — defaulting to TN`);
    const charges = sanitizeStr(String(req.query.charges || ''), 500).trim();
    const rawStatus = sanitizeStr(String(req.query.status || 'Closed'), 30);
    // Normalize to Title Case so 'dismissed' matches 'Dismissed' in VALID_STATUSES
    const status = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();

    const safeStatus = VALID_STATUSES.has(status) ? status : 'Closed';

    const chargeType  = classifyCharge(charges);
    const eligibility = getEligibility(state, chargeType, safeStatus);
    const stateInfo   = STATE_RULES[state] || { name: state };

    res.json({
      state,
      stateName: stateInfo.name,
      chargeType,
      status:    safeStatus,
      eligibility: {
        likely:       eligibility.eligible === true,
        conditional:  eligibility.eligible === 'conditional',
        notEligible:  eligibility.eligible === false,
        waitYears:    eligibility.waitYears ?? 0,
        note:         eligibility.note || null,
      },
      partners:   PARTNERS,
      disclaimer: DISCLAIMER,
    });
  } catch (e) {
    logger.error('[expungement/check]', e.message);
    res.status(500).json({ error: 'Could not compute eligibility. Please try again.' });
  }
});

export default router;
