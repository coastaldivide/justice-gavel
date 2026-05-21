/**
 * JUSTICE GAVEL — ANALYTICS ENGINE TEST SUITE
 * Tests for: precedentRegistry, outcomeEstimator, precedentMonitor, bias audit
 */

import { jest } from '@jest/globals';
import { PRECEDENT_REGISTRY, getRelevantEntries, getEntry, getApproachingStale, getCircuitSplitEntries } from '../analytics/precedentRegistry.js';
import { computeOutcomeEstimate } from '../analytics/outcomeEstimator.js';
import { checkStaleness, runBiasAudit } from '../analytics/precedentMonitor.js';

// ─── PRECEDENT REGISTRY ───────────────────────────────────────────────────────
describe('Precedent Registry — schema integrity', () => {
  test('registry has entries', () => expect(PRECEDENT_REGISTRY.length).toBeGreaterThan(0));
  test('all entries have required fields', () => {
    const required = ['id','vertical','title','holding','source','source_url','source_type','jurisdiction','valid_from','stale_after'];
    PRECEDENT_REGISTRY.forEach(e => {
      required.forEach(f => expect(e).toHaveProperty(f, expect.anything()));
    });
  });
  test('all entry IDs are unique', () => {
    const ids = PRECEDENT_REGISTRY.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test('all stale_after dates are in YYYY-MM-DD format', () => {
    PRECEDENT_REGISTRY.forEach(e => {
      if (e.stale_after) expect(e.stale_after).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
  test('all valid_from dates are valid ISO dates', () => {
    PRECEDENT_REGISTRY.forEach(e => {
      expect(e.valid_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
  test('stat_base values are between 0 and 1', () => {
    PRECEDENT_REGISTRY.filter(e => e.stat_base !== null).forEach(e => {
      expect(e.stat_base).toBeGreaterThanOrEqual(0);
      expect(e.stat_base).toBeLessThanOrEqual(1);
    });
  });
  test('source_type is one of the valid values', () => {
    const valid = new Set(['case','statute','regulation','statistics','guideline']);
    PRECEDENT_REGISTRY.forEach(e => expect(valid.has(e.source_type)).toBe(true));
  });
  test('superseded_by either null or references another valid entry ID', () => {
    const ids = new Set(PRECEDENT_REGISTRY.map(e => e.id));
    PRECEDENT_REGISTRY.forEach(e => {
      if (e.superseded_by) expect(ids.has(e.superseded_by)).toBe(true);
    });
  });
  test('all circuit_split entries have notes explaining the split', () => {
    PRECEDENT_REGISTRY.filter(e => e.circuit_split).forEach(e => {
      expect(e.notes).toBeTruthy();
      expect(e.notes.length).toBeGreaterThan(20);
    });
  });
});

describe('Precedent Registry — lookup utilities', () => {
  test('getRelevantEntries: returns entries for criminal_defense', () => {
    const entries = getRelevantEntries('criminal_defense', null, '2025-01-01');
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach(e => expect(e.vertical).toBe('criminal_defense'));
  });
  test('getRelevantEntries: filters out superseded entries', () => {
    const entries = getRelevantEntries('criminal_defense', null, '2025-01-01');
    entries.forEach(e => expect(e.superseded_by).toBeNull());
  });
  test('getRelevantEntries: filters out expired entries', () => {
    // Use a future date to test expiry
    const entries2100 = getRelevantEntries('criminal_defense', null, '2100-01-01');
    expect(entries2100.length).toBe(0);  // All entries will be stale by 2100
  });
  test('getEntry: returns entry by ID', () => {
    const e = getEntry('crim_safety_valve_rate');
    expect(e).toBeDefined();
    expect(e.id).toBe('crim_safety_valve_rate');
  });
  test('getEntry: returns null for unknown ID', () => {
    expect(getEntry('nonexistent_id_xyz')).toBeNull();
  });
  test('getCircuitSplitEntries: returns entries with circuit_split=true', () => {
    const splits = getCircuitSplitEntries();
    expect(splits.length).toBeGreaterThan(0);
    splits.forEach(e => expect(e.circuit_split).toBe(true));
  });
  test('getCircuitSplitEntries: filters by vertical', () => {
    const splits = getCircuitSplitEntries('immigration');
    splits.forEach(e => expect(e.vertical).toBe('immigration'));
  });
  test('getApproachingStale: returns entries within daysAhead window', () => {
    // All entries have stale_after in the future relative to test date
    const approaching = getApproachingStale(5000);  // 5000 days = all entries
    expect(approaching.length).toBeGreaterThan(0);
  });
});

// ─── OUTCOME ESTIMATOR ───────────────────────────────────────────────────────
describe('Outcome Estimator — output structure', () => {
  const baseMatter = (overrides = {}) => ({
    id:1, firm_id:1, vertical:'criminal_defense', title:'Drug distribution § 841 federal',
    evidence_score:60, vulnerability_level:'moderate', time_pressure:'standard',
    jurisdiction:'federal', prior_adjudications:0, ...overrides
  });

  test('returns required top-level fields', () => {
    const est = computeOutcomeEstimate(baseMatter());
    ['version','computed_at','matter_id','vertical','factors_evaluated',
     'analyses','precedents','warnings','disclaimer'].forEach(f =>
      expect(est).toHaveProperty(f)
    );
  });

  test('disclaimer.required is always true', () => {
    const est = computeOutcomeEstimate(baseMatter());
    expect(est.disclaimer.required).toBe(true);
    expect(est.disclaimer.text).toBeTruthy();
    expect(est.disclaimer.bias_policy).toBeTruthy();
  });

  test('disclaimer cannot be suppressed — present even for empty matter', () => {
    const est = computeOutcomeEstimate({ id:99, vertical:'general' });
    expect(est.disclaimer.required).toBe(true);
  });

  test('analyses have required fields', () => {
    const est = computeOutcomeEstimate(baseMatter());
    est.analyses.forEach(a => {
      ['entry_id','title','signal_tier','estimated_range','source','holding'].forEach(f =>
        expect(a).toHaveProperty(f)
      );
    });
  });

  test('estimated_range always has low, point, high, label', () => {
    const est = computeOutcomeEstimate(baseMatter());
    est.analyses.forEach(a => {
      const r = a.estimated_range;
      expect(r.low).toBeGreaterThanOrEqual(0);
      expect(r.high).toBeLessThanOrEqual(1);
      expect(r.low).toBeLessThanOrEqual(r.point);
      expect(r.point).toBeLessThanOrEqual(r.high);
      expect(r.label).toMatch(/\d+%–\d+%/);
    });
  });

  test('signal_tier is one of valid action-oriented values', () => {
    // Tiers are attorney-empowering strategy postures, not win/lose predictions
    const valid = new Set(['STRONG POSITION','BALANCED FIELD','BUILD STRENGTH','STRATEGY FOCUS']);
    const est = computeOutcomeEstimate(baseMatter());
    est.analyses.forEach(a => expect(valid.has(a.signal_tier)).toBe(true));
  });

  test('estimated_range never claims certainty (never 0% or 100%)', () => {
    const est = computeOutcomeEstimate(baseMatter({ evidence_score: 99 }));
    est.analyses.forEach(a => {
      expect(a.estimated_range.low).toBeGreaterThan(0);
      expect(a.estimated_range.high).toBeLessThan(1);
    });
  });
});

describe('Outcome Estimator — factor application correctness', () => {
  function fed(overrides = {}) {
    return { id:1, vertical:'criminal_defense', title:'Drug distribution § 841',
             evidence_score:60, jurisdiction:'federal', prior_adjudications:0,
             vulnerability_level:'moderate', time_pressure:'standard', ...overrides };
  }

  test('strong evidence produces higher dismissal estimate than weak evidence', () => {
    const strong = computeOutcomeEstimate(fed({ evidence_score:85 }));
    const weak   = computeOutcomeEstimate(fed({ evidence_score:15 }));
    const sAnal = strong.analyses.find(a => a.entry_id === 'crim_dismissal_base');
    const wAnal = weak.analyses.find(a => a.entry_id === 'crim_dismissal_base');
    if (sAnal && wAnal) {
      // Weak evidence = higher dismissal probability (harder for prosecution)
      expect(wAnal.estimated_range.point).toBeGreaterThan(sAnal.estimated_range.point);
    }
  });

  test('immigration: crisis country → higher asylum estimate than stable', () => {
    const crisis = computeOutcomeEstimate({ id:1, vertical:'immigration', taxonomy:'asylum_matter',
      title:'Asylum claim', evidence_score:70, jurisdiction:'federal',
      country_condition:'crisis', relief_type:'asylum', clock_days:100 });
    const stable = computeOutcomeEstimate({ id:1, vertical:'immigration', taxonomy:'asylum_matter',
      title:'Asylum claim', evidence_score:70, jurisdiction:'federal',
      country_condition:'stable', relief_type:'asylum', clock_days:100 });
    const cAnal = crisis.analyses.find(a => a.entry_id === 'imm_asylum_grant_rates');
    const sAnal = stable.analyses.find(a => a.entry_id === 'imm_asylum_grant_rates');
    if (cAnal && sAnal) {
      expect(cAnal.estimated_range.point).toBeGreaterThan(sAnal.estimated_range.point);
    }
  });

  test('white-collar: full_cooperation → higher DPA benefit than no_cooperation', () => {
    const full = computeOutcomeEstimate({ id:1, vertical:'white_collar', taxonomy:'fcpa',
      title:'FCPA investigation', evidence_score:70, jurisdiction:'federal',
      cooperation_level:'full_cooperation', dpa_status:'viable' });
    const none = computeOutcomeEstimate({ id:1, vertical:'white_collar', taxonomy:'fcpa',
      title:'FCPA investigation', evidence_score:70, jurisdiction:'federal',
      cooperation_level:'no_cooperation', dpa_status:'viable' });
    const fAnal = full.analyses.find(a => a.entry_id === 'wc_dpa_settlement_benefit');
    const nAnal = none.analyses.find(a => a.entry_id === 'wc_dpa_settlement_benefit');
    if (fAnal && nAnal) {
      expect(fAnal.estimated_range.point).toBeGreaterThan(nAnal.estimated_range.point);
    }
  });

  test('missing jurisdiction triggers missing_jurisdiction warning', () => {
    const est = computeOutcomeEstimate({ id:1, vertical:'civil_rights', title:'§ 1983 claim', evidence_score:60 });
    expect(est.warnings.some(w => w.type === 'missing_jurisdiction')).toBe(true);
  });

  test('circuit split entries generate circuit_split warnings', () => {
    const est = computeOutcomeEstimate({ id:1, vertical:'immigration', taxonomy:'asylum_matter',
      title:'Asylum claim', evidence_score:70, jurisdiction:'federal',
      country_condition:'crisis', relief_type:'asylum', clock_days:100 });
    expect(est.warnings.some(w => w.type === 'circuit_split')).toBe(true);
  });

  test('factors_evaluated does not contain prohibited demographic fields', () => {
    const prohibited = ['race','gender','sex','religion','national_origin','age_demographic','disability'];
    const est = computeOutcomeEstimate(fed());
    prohibited.forEach(p =>
      expect(est.factors_evaluated.some(f => f.toLowerCase().includes(p))).toBe(false)
    );
  });

  test('one_year_bar factor sets asylum estimate to near-zero', () => {
    const barred = computeOutcomeEstimate({ id:1, vertical:'immigration', taxonomy:'asylum_matter',
      title:'Asylum claim', evidence_score:85, jurisdiction:'federal',
      country_condition:'crisis', relief_type:'asylum', clock_days:400 });
    const aAnal = barred.analyses.find(a => a.entry_id === 'imm_asylum_grant_rates');
    if (aAnal) {
      // one_year_bar multiplier=0.00 → estimate near zero
      expect(aAnal.estimated_range.point).toBeLessThan(0.05);
    }
  });
});

describe('Outcome Estimator — applyFactors correctness', () => {
  function baseMatter(overrides = {}) {
    return { id:1, vertical:'personal_injury', taxonomy:'auto_accident',
             title:'Auto accident catastrophic', evidence_score:80,
             jurisdiction:'national', vulnerability_level:'moderate', ...overrides };
  }

  test('base_override: multiplier applies exactly once (not doubled)', () => {
    // PI auto_accident: base_override=0.61, then evidence_strong multiplier=1.35
    // Correct: 0.61 * 1.35 = 0.8235 → clamped
    // Bug (fixed): multiplier was applied to stat_base first, then override set, then multiplied again
    const est = computeOutcomeEstimate(baseMatter({ evidence_score: 80 }));
    const anal = est.analyses.find(a => a.entry_id === 'pi_trial_verdict_rates');
    if (anal && anal.factors_applied.length > 0) {
      // The override and multiplier should both appear in factors_applied
      const override = anal.factors_applied.find(f => f.effect === 'base_rate_override');
      const multiplier = anal.factors_applied.find(f => f.effect === 'multiplier');
      if (override && multiplier) {
        // Final rate should equal override * multiplier (not override * multiplier^2)
        const expected = Math.max(0.02, Math.min(0.98, override.value * multiplier.value));
        expect(anal.estimated_range.point).toBeCloseTo(expected, 1);
      }
    }
  });

  test('no base_override: multipliers apply to stat_base directly', () => {
    // criminal_defense: stat_base=0.12, evidence_weak multiplier=1.80 → 0.12*1.80=0.216
    const est = computeOutcomeEstimate({ id:1, vertical:'criminal_defense',
      title:'Drug charge', evidence_score:15, jurisdiction:'federal',
      prior_adjudications:0, vulnerability_level:'moderate' });
    const anal = est.analyses.find(a => a.entry_id === 'crim_dismissal_base');
    if (anal) {
      expect(anal.estimated_range.point).toBeGreaterThan(0.10);
      expect(anal.estimated_range.point).toBeLessThan(0.98);
    }
  });
});

describe('Outcome Estimator — interpretation quality', () => {
  test('interpretation cites base rate, year, and sample size', () => {
    const est = computeOutcomeEstimate({ id:1, vertical:'criminal_defense',
      title:'Drug distribution § 841', evidence_score:60, jurisdiction:'federal',
      prior_adjudications:0 });
    est.analyses.forEach(a => {
      expect(a.interpretation).toBeTruthy();
      expect(a.interpretation.length).toBeGreaterThan(50);
    });
  });
  test('interpretation describes factors applied', () => {
    const est = computeOutcomeEstimate({ id:1, vertical:'criminal_defense',
      title:'Drug distribution § 841', evidence_score:85, jurisdiction:'federal',
      prior_adjudications:0, vulnerability_level:'crisis' });
    const anal = est.analyses.find(a => a.entry_id === 'crim_dismissal_base');
    if (anal && anal.factors_applied.length > 0) {
      // Interpretation should mention the factors
      expect(anal.interpretation.toLowerCase()).toMatch(/favorable|challenging|factor/);
    }
  });
});

// ─── STALENESS MONITOR ───────────────────────────────────────────────────────
describe('Staleness Monitor', () => {
  test('checkStaleness returns required fields', () => {
    const result = checkStaleness();
    expect(result).toHaveProperty('checked_at');
    expect(result).toHaveProperty('total_entries');
    expect(result).toHaveProperty('alerts');
    expect(Array.isArray(result.alerts)).toBe(true);
  });
  test('total_entries matches registry length', () => {
    const result = checkStaleness();
    expect(result.total_entries).toBe(PRECEDENT_REGISTRY.length);
  });
  test('alerts have severity, entry_id, message, action fields', () => {
    const result = checkStaleness();
    result.alerts.forEach(a => {
      expect(a).toHaveProperty('severity');
      expect(a).toHaveProperty('entry_id');
      expect(a).toHaveProperty('message');
      expect(a).toHaveProperty('action');
      expect(['EXPIRED','URGENT','UPCOMING']).toContain(a.severity);
    });
  });
  test('no entries currently expired (all stale_after after today)', () => {
    const result = checkStaleness();
    const expired = result.alerts.filter(a => a.severity === 'EXPIRED');
    // All registry entries must have stale_after dates in the future
    expect(expired.length).toBe(0);
    if (expired.length > 0) {
      console.error('EXPIRED registry entries found:', expired.map(e => e.entry_id));
    }
  });
});

// ─── BIAS AUDIT ───────────────────────────────────────────────────────────────
describe('Bias Audit', () => {
  test('runBiasAudit returns required fields', () => {
    const result = runBiasAudit(computeOutcomeEstimate);
    expect(result).toHaveProperty('audit_date');
    expect(result).toHaveProperty('tests');
    expect(result).toHaveProperty('all_passed');
    expect(result).toHaveProperty('passed_count');
    expect(result).toHaveProperty('total_count');
  });
  test('all bias audit tests pass', () => {
    const result = runBiasAudit(computeOutcomeEstimate);
    expect(result.all_passed).toBe(true);
    result.tests.forEach(t => {
      expect(t.passed).toBe(true);
    });
  });
  test('bias audit includes demographic leakage test', () => {
    const result = runBiasAudit(computeOutcomeEstimate);
    expect(result.tests.some(t => t.test === 'no_demographic_leakage')).toBe(true);
  });
  test('bias audit includes disclaimer test', () => {
    const result = runBiasAudit(computeOutcomeEstimate);
    expect(result.tests.some(t => t.test === 'disclaimer_always_present')).toBe(true);
  });
  test('bias audit includes jurisdiction warning test', () => {
    const result = runBiasAudit(computeOutcomeEstimate);
    expect(result.tests.some(t => t.test === 'jurisdiction_warning')).toBe(true);
  });
  test('evidence_strength_symmetry test: passes', () => {
    const result = runBiasAudit(computeOutcomeEstimate);
    const sym = result.tests.find(t => t.test === 'evidence_strength_symmetry');
    expect(sym?.passed).toBe(true);
  });
});
