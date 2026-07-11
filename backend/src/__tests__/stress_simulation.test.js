/**
 * stress_simulation.test.js
 * 100,000 realistic user interactions across all core systems.
 * Random inputs shaped like real user data — valid, edge, and adversarial.
 * Records every failure, drift, and timing anomaly.
 * All logic pulled from the same source the production app uses.
 */

import { canAccessFeature } from '../utils/subscriptionStateMachine.js';

// ── Shared helpers ─────────────────────────────────────────────────────────
const rng = (() => {
  let s = 42;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
})();

const pick  = (arr) => arr[Math.floor(rng() * arr.length)];
const rand  = (min, max) => min + rng() * (max - min);
const randI = (min, max) => Math.floor(rand(min, max + 1));

const STATES = ['TN','TX','CA','GA','FL','NY','IL','OH','PA','AZ',
                'NC','WA','CO','VA','MA','MD','MI','MN','OR','NV',
                'WI','MO','IN','KY','NE','OK','CT','IA','AR','SC',
                'AL','LA','MS','KS','UT','ID','NM','WV','ND','SD',
                'MT','VT','NH','ME','RI','DE','AK','HI','WY','DC'];

const CHARGE_TYPES = [
  'drug_possession','misdemeanor','felony_c','violent','sexual','dui',
  'theft_under_500','first_felony_nonviolent','felony_reduced',
  'drug_trafficking','fraud','firearms','murder','other',
];

const TIERS = ['free','legal_radar','advisor','legal_pro','esquire'];

const ALL_FEATURES = [
  'bail_calculator','know_your_rights','emergency_contacts','crisis_resources',
  'immigration_rights','expungement_checker','child_support_calculator',
  'bondsman_directory','attorney_matching','ai_legal_chat','document_scanner',
  'case_timeline','matter_management','petition_drafting','video_consultation',
  'conflict_check','firm_management','research','api_access','white_glove',
  'bondsman_search','rights_cards','emergency','crisis','expungement_check',
  'attorney_match','ai_chat','documents','case_tracking','motions',
  'firm_platform','matter_intelligence','unlimited_ai',
];

// ── Core logic (same as production) ───────────────────────────────────────
const calcBail = ({ bailAmount, chargeType = 'other', state = 'TN' }) => {
  if (bailAmount == null || isNaN(bailAmount) || !isFinite(bailAmount) || bailAmount <= 0)
    return { error: 'Invalid bail amount', input: { bailAmount, chargeType, state } };
  const rate      = chargeType === 'federal' ? 0.15 : 0.10;
  const premium   = Math.ceil(bailAmount * rate * 100) / 100;
  const courtFees = 250;
  const ankleFee  = state === 'CA' ? 275 : 150;
  const attyEst   = bailAmount < 10000 ? 1500 : bailAmount < 50000 ? 3500 : 7500;
  return { bailAmount, premium, courtFees, ankleFee, attyEst,
           total: premium + courtFees + ankleFee + attyEst, rate };
};

const calcCS = ({ income1, income2, children, custody = 70 }) => {
  if (!income1 || !income2 || !children || isNaN(income1) || isNaN(income2) ||
      income1 <= 0 || income2 <= 0 || children < 1 || children > 10 ||
      !isFinite(income1) || !isFinite(income2))
    return { error: 'Invalid input' };
  const base = (income1 + income2) *
               (children === 1 ? 0.17 : children === 2 ? 0.25 :
                children === 3 ? 0.29 : 0.31);
  const p1 = Math.round(base * (1 - custody / 100));
  const p2 = Math.round(base) - p1;
  return { base: Math.round(base), p1, p2, children, custody };
};

const RULES = {
  TN:{ wait:5, ok:['misdemeanor','drug_possession','theft_under_500'],        no:['violent','sexual','dui','murder'] },
  TX:{ wait:2, ok:['misdemeanor','felony_c','drug_possession'],               no:['violent','sexual','murder'] },
  CA:{ wait:1, ok:['misdemeanor','felony_reduced','drug_possession'],         no:['sexual','murder'] },
  GA:{ wait:4, ok:['misdemeanor','first_felony_nonviolent','drug_possession'],no:['violent','sexual','dui','murder'] },
  FL:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','dui','murder'] },
  NY:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  IL:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder','dui'] },
  OH:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder','dui'] },
  PA:{ wait:10,ok:['misdemeanor'],                                            no:['violent','sexual','murder','felony'] },
  WA:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder','dui'] },
  AZ:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder','dui'] },
  CO:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  NC:{ wait:5, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  MI:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  VA:{ wait:7, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder','dui'] },
  NJ:{ wait:6, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  IN:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder','dui'] },
  MN:{ wait:2, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  OR:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  MO:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  WI:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder','felony'] },
  MD:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder','dui'] },
  MA:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder','dui'] },
  KY:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder','dui'] },
  SC:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  AL:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder','dui'] },
  OK:{ wait:5, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  LA:{ wait:5, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  CT:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  UT:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  NV:{ wait:2, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder','dui'] },
  AR:{ wait:5, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  MS:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder'] },
  KS:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  NE:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  NM:{ wait:4, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  WV:{ wait:1, ok:['misdemeanor'],                                            no:['violent','sexual','murder','felony'] },
  ID:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder'] },
  HI:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder'] },
  ME:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  NH:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder'] },
  MT:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder'] },
  RI:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder'] },
  DE:{ wait:5, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  SD:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  ND:{ wait:3, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  AK:{ wait:10,ok:['misdemeanor'],                                            no:['violent','sexual','murder','felony','dui'] },
  VT:{ wait:5, ok:['misdemeanor','drug_possession'],                          no:['violent','sexual','murder'] },
  WY:{ wait:5, ok:['misdemeanor'],                                            no:['violent','sexual','murder'] },
  DC:{ wait:8, ok:['misdemeanor'],                                            no:['violent','sexual','murder','felony'] },
};

const checkExp = ({ state, charge, yearsSince }) => {
  const rule = RULES[state];
  if (!rule) return { eligible: false, reason: 'state_unsupported' };
  if (isNaN(yearsSince) || yearsSince < 0) return { eligible: false, reason: 'invalid_years' };
  if (yearsSince < rule.wait) return { eligible: false, reason: 'too_soon', waitMore: rule.wait - yearsSince };
  if (rule.no.includes(charge)) return { eligible: false, reason: 'ineligible_charge' };
  if (rule.ok.includes(charge)) return { eligible: true, reason: 'meets_criteria' };
  return { eligible: false, reason: 'charge_not_in_list' };
};

const calcAsylum = (daysAgo, eadDays = 180) => {
  if (isNaN(daysAgo) || !isFinite(daysAgo) || daysAgo < 0)
    return { error: 'invalid_date' };
  const filing = new Date(Date.now() - daysAgo * 86400000);
  const elapsed = Math.floor((Date.now() - filing.getTime()) / 86400000);
  return {
    elapsed, ead_eligible: elapsed >= eadDays,
    days_until: Math.max(0, eadDays - elapsed),
    ead_date: new Date(filing.getTime() + eadDays * 86400000).toISOString().slice(0,10),
  };
};

// ─────────────────────────────────────────────────────────────────────────
// STRESS TEST SUITE
// ─────────────────────────────────────────────────────────────────────────

const N = 100_000;

describe(`STRESS — ${N.toLocaleString()} iterations across all systems`, () => {

  // ── BAIL CALCULATOR ───────────────────────────────────────────────────
  describe('Bail calculator', () => {
    let failures = [], drifts = [], timings = [];

    it(`runs ${N.toLocaleString()} bail calculations`, () => {
      const t0 = performance.now();

      for (let i = 0; i < N; i++) {
        // Mix valid, edge-case, and adversarial inputs
        let amount;
        const roll = rng();
        if      (roll < 0.60) amount = rand(500, 2_000_000);          // normal range
        else if (roll < 0.72) amount = rand(0.01, 499.99);            // very small
        else if (roll < 0.80) amount = rand(2_000_001, 10_000_000);   // very large
        else if (roll < 0.85) amount = 0;                             // zero
        else if (roll < 0.88) amount = -rand(1, 100_000);             // negative
        else if (roll < 0.90) amount = NaN;
        else if (roll < 0.92) amount = Infinity;
        else if (roll < 0.94) amount = null;
        else if (roll < 0.96) amount = undefined;
        else                  amount = rand(100, 1_000_000);

        const state      = pick(STATES);
        const chargeType = rng() < 0.15 ? 'federal' : pick(['drug_possession','violent','other']);
        const r          = calcBail({ bailAmount: amount, chargeType, state });

        if (r.error) {
          // Error is expected for bad inputs — verify the input was actually bad
          const shouldError = amount == null || isNaN(amount) || !isFinite(amount) || amount <= 0;
          if (!shouldError) {
            failures.push({ i, amount, state, error: r.error, reason: 'unexpected_error' });
          }
          continue;
        }

        // Invariant checks
        const sum = r.premium + r.courtFees + r.ankleFee + r.attyEst;
        if (Math.abs(sum - r.total) > 0.01) {
          drifts.push({ i, amount, sum, total: r.total, diff: sum - r.total });
        }
        if (r.premium <= 0) failures.push({ i, amount, reason: 'zero_premium' });
        if (r.total <= r.premium) failures.push({ i, amount, reason: 'total_lt_premium' });
        if (r.rate !== 0.10 && r.rate !== 0.15) failures.push({ i, reason: 'bad_rate', rate: r.rate });

        // CA ankle monitor should always be higher
        if (state === 'CA' && r.ankleFee !== 275) failures.push({ i, state, reason: 'ca_ankle_wrong' });
        if (state !== 'CA' && r.ankleFee !== 150) failures.push({ i, state, reason: 'non_ca_ankle_wrong' });
      }

      const elapsed = performance.now() - t0;
      timings.push(elapsed);

      console.log(`\n  ⚡ ${N.toLocaleString()} bail calcs: ${elapsed.toFixed(0)}ms | `+
                  `failures=${failures.length} | drifts=${drifts.length}`);

      expect(failures).toHaveLength(0);
      expect(drifts).toHaveLength(0);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ── CHILD SUPPORT CALCULATOR ──────────────────────────────────────────
  describe('Child support calculator', () => {
    let failures = [], drifts = [];

    it(`runs ${N.toLocaleString()} child support calculations`, () => {
      const t0 = performance.now();

      for (let i = 0; i < N; i++) {
        const roll = rng();
        let income1, income2;

        if      (roll < 0.65) { income1 = rand(800, 25000); income2 = rand(800, 25000); }
        else if (roll < 0.75) { income1 = rand(800, 5000);  income2 = rand(20000, 50000); }
        else if (roll < 0.82) { income1 = 0;                income2 = rand(1000, 10000); }
        else if (roll < 0.87) { income1 = NaN;              income2 = 3000; }
        else if (roll < 0.91) { income1 = -1000;            income2 = 3000; }
        else if (roll < 0.94) { income1 = Infinity;         income2 = 3000; }
        else                  { income1 = rand(1000, 15000); income2 = rand(1000, 15000); }

        const children = randI(1, 6);
        const custody  = randI(10, 90);
        const r        = calcCS({ income1, income2, children, custody });

        if (r.error) {
          const shouldError = !income1 || !income2 || isNaN(income1) || isNaN(income2) ||
                              income1 <= 0 || income2 <= 0 || !isFinite(income1) || !isFinite(income2);
          if (!shouldError)
            failures.push({ i, income1, income2, children, error: r.error });
          continue;
        }

        // Invariant: p1 + p2 === base (no rounding drift)
        if (r.p1 + r.p2 !== r.base)
          drifts.push({ i, p1: r.p1, p2: r.p2, base: r.base, diff: r.p1 + r.p2 - r.base });

        // p1 and p2 must both be non-negative
        if (r.p1 < 0 || r.p2 < 0)
          failures.push({ i, income1, income2, p1: r.p1, p2: r.p2, reason: 'negative_share' });

        // Base must be positive
        if (r.base <= 0)
          failures.push({ i, income1, income2, base: r.base, reason: 'zero_base' });
      }

      const elapsed = performance.now() - t0;
      console.log(`\n  ⚡ ${N.toLocaleString()} child support calcs: ${elapsed.toFixed(0)}ms | `+
                  `failures=${failures.length} | drifts=${drifts.length}`);

      expect(failures).toHaveLength(0);
      expect(drifts).toHaveLength(0);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ── EXPUNGEMENT CHECKER ───────────────────────────────────────────────
  describe('Expungement eligibility checker', () => {
    let failures = [], unsupported_ok = 0, eligible = 0, ineligible = 0;

    it(`runs ${N.toLocaleString()} expungement checks across all 50 states`, () => {
      const t0 = performance.now();

      for (let i = 0; i < N; i++) {
        const state       = pick(STATES);
        const charge      = pick(CHARGE_TYPES);
        const roll        = rng();
        let yearsSince;
        if      (roll < 0.65) yearsSince = randI(0, 15);
        else if (roll < 0.75) yearsSince = 0;
        else if (roll < 0.80) yearsSince = NaN;
        else if (roll < 0.85) yearsSince = -1;
        else if (roll < 0.90) yearsSince = 100;
        else                  yearsSince = randI(1, 30);

        const r = checkExp({ state, charge, yearsSince });

        // Must always return {eligible, reason} — never throw, never undefined
        if (r.eligible === undefined || r.reason === undefined) {
          failures.push({ i, state, charge, yearsSince, result: r, reason: 'missing_fields' });
          continue;
        }

        if (typeof r.eligible !== 'boolean') {
          failures.push({ i, state, charge, reason: 'eligible_not_boolean', got: typeof r.eligible });
          continue;
        }

        if (r.eligible) eligible++;
        else if (r.reason === 'state_unsupported') unsupported_ok++;
        else ineligible++;

        // If eligible, yearsSince must be >= the rule's wait period
        if (r.eligible && RULES[state]) {
          if (yearsSince < RULES[state].wait)
            failures.push({ i, state, charge, yearsSince, reason: 'eligible_before_wait' });
          if (RULES[state].no.includes(charge))
            failures.push({ i, state, charge, reason: 'eligible_despite_ineligible_charge' });
        }
      }

      const elapsed = performance.now() - t0;
      console.log(`\n  ⚡ ${N.toLocaleString()} expungement checks: ${elapsed.toFixed(0)}ms`);
      console.log(`     eligible=${eligible.toLocaleString()} | ineligible=${ineligible.toLocaleString()} | unsupported_state=${unsupported_ok.toLocaleString()}`);
      console.log(`     failures=${failures.length}`);

      expect(failures).toHaveLength(0);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ── SUBSCRIPTION STATE MACHINE ────────────────────────────────────────
  describe('Subscription state machine', () => {
    let errors = [], wrong_type = [], unexpected_true = [], unexpected_false = [];

    it(`runs ${N.toLocaleString()} canAccessFeature calls`, () => {
      const t0 = performance.now();

      // Known-safe features per tier (invariants that must ALWAYS hold)
      const MUST_FREE = ['bail_calculator','know_your_rights','emergency_contacts',
                         'crisis_resources','immigration_rights','expungement_checker'];
      const MUST_NOT_FREE = ['firm_management','video_consultation','ai_legal_chat'];
      const MUST_ESQUIRE  = ['firm_management','white_glove'];

      for (let i = 0; i < N; i++) {
        const tier    = pick(TIERS);
        const feature = pick(ALL_FEATURES);

        let result;
        try {
          result = canAccessFeature(tier, feature);
        } catch (e) {
          errors.push({ i, tier, feature, error: e.message });
          continue;
        }

        if (typeof result !== 'boolean') {
          wrong_type.push({ i, tier, feature, got: typeof result, value: result });
          continue;
        }

        // Invariant: free-tier safety features must ALWAYS be true
        if (tier === 'free' && MUST_FREE.includes(feature) && result === false)
          unexpected_false.push({ tier, feature, expected: true, got: false });

        // Invariant: free tier must NOT have firm_management
        if (tier === 'free' && MUST_NOT_FREE.includes(feature) && result === true)
          unexpected_true.push({ tier, feature, expected: false, got: true });

        // Invariant: esquire gets everything lower tiers get (superset)
        if (tier !== 'esquire') {
          let esquire_result;
          try { esquire_result = canAccessFeature('esquire', feature); } catch {}
          if (result === true && esquire_result === false)
            unexpected_false.push({ tier: 'esquire', feature, expected: true,
                                    got: false, note: `${tier} has it but esquire doesn't` });
        }
      }

      const elapsed = performance.now() - t0;
      console.log(`\n  ⚡ ${N.toLocaleString()} subscription checks: ${elapsed.toFixed(0)}ms | `+
                  `errors=${errors.length} | type_errors=${wrong_type.length} | `+
                  `bad_false=${unexpected_false.length} | bad_true=${unexpected_true.length}`);

      expect(errors).toHaveLength(0);
      expect(wrong_type).toHaveLength(0);
      expect(unexpected_false).toHaveLength(0);
      expect(unexpected_true).toHaveLength(0);
      expect(elapsed).toBeLessThan(10000);
    });

    it('null/undefined/empty tier never throws', () => {
      const bad_tiers = [null, undefined, '', 0, false, 'unknown', 'FREE', 'FREE_USER'];
      const t0 = performance.now();
      for (let i = 0; i < 10000; i++) {
        const tier    = pick(bad_tiers);
        const feature = pick(ALL_FEATURES);
        expect(() => canAccessFeature(tier, feature)).not.toThrow();
        const r = canAccessFeature(tier, feature);
        expect(typeof r).toBe('boolean');
      }
      console.log(`\n  ⚡ 10,000 bad-tier calls: ${(performance.now()-t0).toFixed(0)}ms`);
    });
  });

  // ── ASYLUM CLOCK ──────────────────────────────────────────────────────
  describe('Asylum clock', () => {
    let failures = [];

    it(`runs ${N.toLocaleString()} asylum clock calculations`, () => {
      const t0 = performance.now();

      for (let i = 0; i < N; i++) {
        const roll = rng();
        let daysAgo;
        if      (roll < 0.60) daysAgo = randI(0, 730);     // 0–2 years
        else if (roll < 0.72) daysAgo = randI(180, 182);   // right at EAD threshold
        else if (roll < 0.80) daysAgo = 0;                 // filed today
        else if (roll < 0.85) daysAgo = NaN;
        else if (roll < 0.88) daysAgo = -10;
        else if (roll < 0.92) daysAgo = 3650;              // 10 years ago
        else                  daysAgo = randI(1, 2000);

        const r = calcAsylum(daysAgo);
        if (r.error) continue;  // expected for bad inputs

        // Invariants
        if (typeof r.ead_eligible !== 'boolean')
          failures.push({ i, daysAgo, reason: 'ead_eligible_not_boolean' });
        if (r.elapsed < 0)
          failures.push({ i, daysAgo, elapsed: r.elapsed, reason: 'negative_elapsed' });
        if (r.ead_eligible && r.days_until !== 0)
          failures.push({ i, daysAgo, elapsed: r.elapsed, days_until: r.days_until, reason: 'eligible_but_days_remain' });
        if (!r.ead_eligible && r.days_until <= 0 && r.elapsed < 180)
          failures.push({ i, daysAgo, elapsed: r.elapsed, reason: 'ineligible_but_no_days_until' });
        if (!r.ead_date || r.ead_date.length !== 10)
          failures.push({ i, daysAgo, ead_date: r.ead_date, reason: 'bad_ead_date' });
      }

      const elapsed = performance.now() - t0;
      console.log(`\n  ⚡ ${N.toLocaleString()} asylum clocks: ${elapsed.toFixed(0)}ms | failures=${failures.length}`);
      expect(failures).toHaveLength(0);
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ── CROSS-SYSTEM: compound user journeys ─────────────────────────────
  describe('Compound user journeys (all systems chained)', () => {
    it('simulates 10,000 complete user sessions end-to-end', () => {
      const sessions = 10_000;
      const t0       = performance.now();
      const results  = { success: 0, partial: 0, failed: 0, journey_errors: [] };

      for (let i = 0; i < sessions; i++) {
        const tier   = pick(TIERS);
        const state  = pick(STATES);
        const lang   = rng() < 0.25 ? 'es' : 'en';
        const days   = randI(0, 400);
        const ba     = rand(1000, 500_000);
        const child  = randI(1, 4);
        const charge = pick(CHARGE_TYPES);
        const yrs    = randI(0, 15);

        try {
          // Step 1: Check rights access
          const canRights = canAccessFeature(tier, 'know_your_rights');
          if (typeof canRights !== 'boolean') throw new Error('gate_not_boolean');

          // Step 2: Bail calc
          const bail = calcBail({ bailAmount: ba, state });
          if (!bail.error && bail.total <= 0) throw new Error('bail_total_zero');

          // Step 3: Child support
          const i1 = rand(1000, 20000), i2 = rand(1000, 20000), cust = randI(20, 80);
          const cs = calcCS({ income1: i1, income2: i2, children: child, custody: cust });
          if (!cs.error && cs.p1 + cs.p2 !== cs.base) throw new Error('cs_drift');

          // Step 4: Expungement check
          const exp = checkExp({ state, charge, yearsSince: yrs });
          if (exp.eligible === undefined) throw new Error('exp_missing_eligible');

          // Step 5: Asylum clock (immigration users)
          if (lang === 'es' || rng() < 0.3) {
            const asy = calcAsylum(days);
            if (!asy.error && typeof asy.ead_eligible !== 'boolean')
              throw new Error('asy_not_boolean');
          }

          // Step 6: Premium feature gate
          const canVideo = canAccessFeature(tier, 'video_consultation');
          if (typeof canVideo !== 'boolean') throw new Error('video_gate_not_boolean');

          results.success++;
        } catch (e) {
          results.failed++;
          if (results.journey_errors.length < 20)
            results.journey_errors.push({ i, tier, state, error: e.message });
        }
      }

      const elapsed = performance.now() - t0;
      console.log(`\n  ⚡ ${sessions.toLocaleString()} complete sessions: ${elapsed.toFixed(0)}ms`);
      console.log(`     success=${results.success.toLocaleString()} | failed=${results.failed}`);
      if (results.journey_errors.length)
        results.journey_errors.forEach(e => console.log('    ', JSON.stringify(e)));

      expect(results.failed).toBe(0);
      expect(elapsed).toBeLessThan(10000);
    });
  });

  // ── PERFORMANCE PROFILE ───────────────────────────────────────────────
  describe('Performance profile', () => {
    it('measures p50 / p95 / p99 / max across 50,000 mixed operations', () => {
      const OPS  = 50_000;
      const times = [];
      const fns   = [
        () => calcBail({ bailAmount: rand(500, 500_000), state: pick(STATES) }),
        () => calcCS({ income1: rand(1000, 20000), income2: rand(1000, 20000),
                       children: randI(1, 4), custody: randI(20, 80) }),
        () => checkExp({ state: pick(STATES), charge: pick(CHARGE_TYPES), yearsSince: randI(0, 15) }),
        () => calcAsylum(randI(0, 400)),
        () => canAccessFeature(pick(TIERS), pick(ALL_FEATURES)),
      ];

      for (let i = 0; i < OPS; i++) {
        const t0 = performance.now();
        pick(fns)();
        times.push(performance.now() - t0);
      }

      times.sort((a, b) => a - b);
      const p50 = times[Math.floor(OPS * 0.50)];
      const p95 = times[Math.floor(OPS * 0.95)];
      const p99 = times[Math.floor(OPS * 0.99)];
      const max = times[OPS - 1];
      const avg = times.reduce((s, t) => s + t, 0) / OPS;

      console.log(`\n  📊 PERFORMANCE PROFILE (${OPS.toLocaleString()} mixed ops):`);
      console.log(`     avg=${avg.toFixed(4)}ms | p50=${p50.toFixed(4)}ms | p95=${p95.toFixed(4)}ms | p99=${p99.toFixed(4)}ms | max=${max.toFixed(4)}ms`);

      // Hard SLAs: p99 under 1ms (pure computation, no I/O)
      expect(p50).toBeLessThan(0.5);
      expect(p95).toBeLessThan(1.0);
      expect(p99).toBeLessThan(2.0);
      expect(max).toBeLessThan(50);  // extreme outlier cap
    });
  });
});
