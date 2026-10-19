import { logIgnored } from '../../utils/ignored.js';
import { asyncRoute } from '../../utils/routeHelpers.js';
/**
 * expungement/index.js — Expungement module entry point
 *
 * Mounts at /api/expungement in app.js.
 *
 *   rules.js      — State eligibility data + classifyCharge/getEligibility helpers
 *   attorneys.js  — GET /attorneys
 *   check.js      — GET /check
 *   petition.js   — POST /petition (AI, requires subscription)
 */
import { Router } from 'express';
import attorneysRouter  from './attorneys.js';
import checkRouter      from './check.js';
import petitionRouter   from './petition.js';
import { authRequired }    from '../../middleware/auth.js';
import { getDb }           from '../../db/index.js';
import logger              from '../../utils/logger.js';
import { getEligibility, classifyCharge } from './rules.js';

const router = Router();
router.use('/', attorneysRouter);
router.use('/', checkRouter);
router.use('/', petitionRouter);



// ── POST /expungement/eligibility — full eligibility check with date ──────
router.post('/eligibility', authRequired, (req, res) => {
  const { state, charges = [], conviction_date, dismissed } = req.body;
  if (!state) return res.status(400).json({ error: 'state required' });

  try {
    // Single charge backward-compat
    const chargeList = charges.length > 0 ? charges : [req.body];

    const results = chargeList.map(charge => {
      const desc = typeof charge === 'string' ? charge : (charge.charge || charge.description || charge.charge_type || '');
      const known = ['felony','misdemeanor','dui','domestic','sexual','dismissed'];
      const type = (typeof charge === 'object' && known.includes(String(charge.charge_type || '').toLowerCase()))
        ? String(charge.charge_type).toLowerCase() : classifyCharge(String(desc));
      const result = { ...getEligibility(state, type, dismissed ? 'Dismissed' : undefined) };
      result.wait_years = result.wait_years ?? result.waitYears ?? result.waiting_years;
      // Calculate wait_until_date
      if (result.eligible && result.wait_years && conviction_date) {
        const base = new Date(conviction_date);
        base.setFullYear(base.getFullYear() + result.wait_years);
        result.wait_until_date    = base.toISOString().split('T')[0];
        result.wait_days_remaining = Math.max(0,
          Math.ceil((base - Date.now()) / (1000 * 60 * 60 * 24))
        );
        result.eligible_now = result.wait_days_remaining === 0;
      }
      return { charge: typeof charge === 'string' ? charge : (charge.charge_type || desc), ...result };
    });

    // Overall: eligible only if ALL charges eligible
    const allEligible = results.every(r => r.eligible);
    return res.json({
      state,
      overall_eligible: allEligible,
      results,
      next_step: allEligible
        ? 'You may be eligible. Download our petition checklist and consult an attorney.'
        : 'One or more charges are not eligible. An attorney can review your specific case.',
    });
  } catch (e) {
    logger?.warn('[expungement/eligibility]', e?.message);
    return res.status(500).json({ error: 'Eligibility check failed' });
  }
});

// ── GET /expungement/petition-checklist — documents needed by state ────────
router.get('/petition-checklist', authRequired, asyncRoute((req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).json({ error: 'state required' });

  const common = [
    'Certified copy of criminal record (from state police or court clerk)',
    'Copy of your conviction order or dismissal',
    'Government-issued photo ID',
    'Proof of completed sentence (probation certificate, discharge papers)',
    'Completed petition form (from your state court website)',
    'Filing fee payment (typically $50–$250)',
  ];

  const stateSpecific = {
    TN: ['TBI criminal history certificate', 'Petition for Expunction (TCA 40-32-101)'],
    TX: ['Texas DPS RAP sheet', 'Order of Non-Disclosure or Expunction petition'],
    FL: ['FDLE background check', 'Florida Rule 3.692 petition'],
    CA: ['PC 1203.4 petition', 'Proof of probation completion'],
    NY: ['CPL 160.50 motion (for sealed arrests)', 'Certificate of Relief from Disabilities'],
    GA: ['GCIC background report', 'Petition to restrict record'],
  };

    res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.json({
    state,
    checklist: [...common, ...(stateSpecific[state.toUpperCase()] || [])],
    note: 'Requirements vary by county. Consult with a local attorney for accuracy.',
    find_attorney: `/api/providers/lawyers?state=${state}&practice_area=expungement`,
  });

}));

// POST /api/expungement/log-visit — track that user visited ExpungementScreen
// Used by nightly scheduler to avoid re-sending expungement trigger push
router.post('/log-visit', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO expungement_check_log (user_id, source) VALUES (?, 'screen_visit')`,
      [req.user.id]
    ).catch(logIgnored('routes/expungement/index')); // Non-fatal — table may not exist in dev
    res.json({ logged: true });
  } catch { res.json({ logged: false }); }
});

export default router;

// Re-export helpers so test files and other modules can import from the index


// ── Expungement eligibility rules — all 50 states ───────────────────────────
// wait: years after sentence completion before petition allowed
// ok:   charge types that CAN be expunged
// no:   charge types that CANNOT be expunged
// Sources: NCSL Expungement/Sealing Database + individual state statutes

export { classifyCharge, getEligibility, STATE_RULES, DEFAULT_RULES } from './rules.js';