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
import { err400 }          from '../../utils/routeHelpers.js';

const router = Router();
router.use('/', attorneysRouter);
router.use('/', checkRouter);
router.use('/', petitionRouter);

// POST /referral — track partner referral clicks
router.post('/referral', authRequired, async (req, res) => {
  try {
    const { case_id, state, charges, status, partner } = req.body || {};
    if (!partner) return res.status(400).json({ error: 'partner required' });
    const db = await getDb();
    await db.run(
      `INSERT OR IGNORE INTO expungement_referrals
         (user_id, case_id, state, partner, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [req.user.id, case_id || null, state || null, partner]
    ).catch(() => {});
    return res.json({ logged: true });
  } catch { res.json({ logged: false }); }
});


// ── POST /expungement/eligibility — full eligibility check with date ──────
router.post('/eligibility', authRequired, async (req, res) => {
  const { state, charges = [], conviction_date, dismissed } = req.body;
  if (!state) return res.status(400).json({ error: 'state required' });

  try {
    // Single charge backward-compat
    const chargeList = charges.length > 0 ? charges : [req.body];

    const results = chargeList.map(charge => {
      const result = getEligibility(state, charge);
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
      return { charge: charge.charge_type || charge, ...result };
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
router.get('/petition-checklist', authRequired, async (req, res) => {
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
});

export default router;

// Re-export helpers so test files and other modules can import from the index


// ── Expungement eligibility rules — all 50 states ───────────────────────────
// wait: years after sentence completion before petition allowed
// ok:   charge types that CAN be expunged
// no:   charge types that CANNOT be expunged
// Sources: NCSL Expungement/Sealing Database + individual state statutes
const STATE_RULES = {
  // ── Southeast ────────────────────────────────────────────────────────────
  TN: { wait: 5,  ok: ['misdemeanor','drug_possession','theft_under_500','felony_e_nonviolent'], no: ['violent','sexual','dui','murder','domestic_violence'] },
  GA: { wait: 4,  ok: ['misdemeanor','first_felony_nonviolent','drug_possession'],              no: ['violent','sexual','dui','murder'] },
  FL: { wait: 3,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','dui','murder','domestic_violence'] },
  AL: { wait: 5,  ok: ['misdemeanor','nonviolent_felony'],                                      no: ['violent','sexual','murder','dui'] },
  MS: { wait: 5,  ok: ['misdemeanor','first_offense_nonviolent'],                               no: ['violent','sexual','murder','trafficking'] },
  SC: { wait: 3,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','dui','murder'] },
  NC: { wait: 5,  ok: ['misdemeanor','nonviolent_felony'],                                      no: ['violent','sexual','dui','murder'] },
  VA: { wait: 7,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder','dui'] },
  WV: { wait: 1,  ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony'] },
  KY: { wait: 5,  ok: ['misdemeanor','class_d_felony_nonviolent'],                             no: ['violent','sexual','dui','murder'] },
  AR: { wait: 5,  ok: ['misdemeanor','drug_possession','first_nonviolent_felony'],              no: ['violent','sexual','murder','dui'] },
  LA: { wait: 5,  ok: ['misdemeanor','nonviolent_felony'],                                      no: ['violent','sexual','murder','trafficking'] },
  // ── Southwest ────────────────────────────────────────────────────────────
  TX: { wait: 2,  ok: ['misdemeanor','felony_c','drug_possession'],                             no: ['violent','sexual','murder'] },
  AZ: { wait: 3,  ok: ['misdemeanor','drug_possession','nonviolent_felony'],                    no: ['violent','sexual','murder','dui'] },
  NM: { wait: 4,  ok: ['misdemeanor','drug_possession','petty_misdemeanor'],                    no: ['violent','sexual','murder'] },
  OK: { wait: 5,  ok: ['misdemeanor','nonviolent_felony'],                                      no: ['violent','sexual','murder','trafficking'] },
  // ── West ─────────────────────────────────────────────────────────────────
  CA: { wait: 1,  ok: ['misdemeanor','felony_reduced','drug_possession'],                       no: ['sexual','murder'] },
  WA: { wait: 3,  ok: ['misdemeanor','class_b_c_felony_nonviolent'],                           no: ['violent','sexual','murder','dui'] },
  OR: { wait: 3,  ok: ['misdemeanor','drug_possession','class_c_felony'],                       no: ['violent','sexual','murder'] },
  CO: { wait: 3,  ok: ['misdemeanor','drug_possession','class_4_5_6_felony'],                  no: ['violent','sexual','murder'] },
  NV: { wait: 2,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder','dui'] },
  ID: { wait: 5,  ok: ['misdemeanor','nonviolent_felony'],                                      no: ['violent','sexual','murder','dui'] },
  MT: { wait: 5,  ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony'] },
  WY: { wait: 5,  ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony'] },
  UT: { wait: 3,  ok: ['misdemeanor','drug_possession','third_degree_felony'],                  no: ['violent','sexual','murder'] },
  AK: { wait: 10, ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony','dui'] },
  HI: { wait: 5,  ok: ['misdemeanor','nonviolent_felony'],                                      no: ['violent','sexual','murder'] },
  // ── Midwest ──────────────────────────────────────────────────────────────
  IL: { wait: 3,  ok: ['misdemeanor','drug_possession','nonviolent_felony'],                    no: ['violent','sexual','murder','dui'] },
  OH: { wait: 3,  ok: ['misdemeanor','felony_4_5','drug_possession'],                          no: ['violent','sexual','murder','dui'] },
  MI: { wait: 3,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder'] },
  IN: { wait: 5,  ok: ['misdemeanor','class_d_felony'],                                        no: ['violent','sexual','murder','dui'] },
  WI: { wait: 5,  ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony','dui'] },
  MN: { wait: 2,  ok: ['misdemeanor','drug_possession','gross_misdemeanor'],                    no: ['violent','sexual','murder','felony'] },
  IA: { wait: 8,  ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony'] },
  MO: { wait: 3,  ok: ['misdemeanor','drug_possession','class_c_d_felony'],                    no: ['violent','sexual','murder'] },
  KS: { wait: 3,  ok: ['misdemeanor','drug_possession','nonviolent_felony'],                    no: ['violent','sexual','murder','dui'] },
  NE: { wait: 3,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder'] },
  SD: { wait: 3,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder','felony'] },
  ND: { wait: 3,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder'] },
  // ── Northeast / Mid-Atlantic ──────────────────────────────────────────────
  NY: { wait: 3,  ok: ['misdemeanor','drug_possession','felony_b_c_e_nonviolent'],             no: ['violent','sexual','murder'] },
  PA: { wait: 10, ok: ['misdemeanor','summary_offense'],                                        no: ['violent','sexual','murder','felony','dui'] },
  NJ: { wait: 6,  ok: ['misdemeanor','drug_possession','indictable_crime'],                    no: ['violent','sexual','murder'] },
  CT: { wait: 3,  ok: ['misdemeanor','drug_possession','nonviolent_felony'],                    no: ['violent','sexual','murder'] },
  RI: { wait: 5,  ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony'] },
  MA: { wait: 3,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder','dui'] },
  VT: { wait: 5,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder','felony'] },
  NH: { wait: 5,  ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony','dui'] },
  ME: { wait: 3,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder'] },
  MD: { wait: 3,  ok: ['misdemeanor','drug_possession','nonviolent_felony'],                    no: ['violent','sexual','murder','dui'] },
  DE: { wait: 5,  ok: ['misdemeanor','drug_possession'],                                        no: ['violent','sexual','murder','felony'] },
  DC: { wait: 8,  ok: ['misdemeanor'],                                                          no: ['violent','sexual','murder','felony','dui'] },
};

export { classifyCharge, getEligibility, STATE_RULES, DEFAULT_RULES } from './rules.js';
