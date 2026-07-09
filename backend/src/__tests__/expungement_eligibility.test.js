/**
 * expungement_eligibility.test.js
 * Tests expungement eligibility logic — critical because
 * wrong results could give users false hope or deny real opportunities.
 */

// Simplified eligibility engine (mirrors the real logic in the app)
function checkExpungementEligibility({ state, chargeType, conviction, sentenceComplete,
  yearsWaiting, subsequentOffenses }) {

  // Universal disqualifiers
  if (['murder','manslaughter','rape','child_abuse','terrorism'].includes(chargeType)) {
    return { eligible: false, reason: 'Charge type is permanently ineligible for expungement' };
  }
  if (subsequentOffenses > 0) {
    return { eligible: false, reason: 'Subsequent offenses disqualify expungement in most states' };
  }
  if (!sentenceComplete) {
    return { eligible: false, reason: 'Sentence must be fully completed including probation/parole' };
  }

  // State-specific waiting periods (simplified subset)
  const waitingPeriods = {
    TN: { misdemeanor: 5, felony: 8, dismissed: 0 },
    GA: { misdemeanor: 4, felony: null, dismissed: 0 },  // GA: no felony expungement
    TX: { misdemeanor: 3, felony: null, dismissed: 0 },  // TX: no felony expungement (generally)
    CA: { misdemeanor: 1, felony: 3, dismissed: 0 },
    FL: { misdemeanor: 10, felony: null, dismissed: 0 },
  };

  const stateRules = waitingPeriods[state];
  if (!stateRules) {
    return { eligible: null, reason: 'State rules not yet available — consult an attorney' };
  }

  const requiredWait = conviction ? stateRules[chargeType] : stateRules.dismissed;

  if (requiredWait === null) {
    return { eligible: false, reason: `${chargeType} charges are not expungeable in ${state}` };
  }
  if (yearsWaiting < requiredWait) {
    return { eligible: false,
      reason: `Must wait ${requiredWait} years after sentence completion (${yearsWaiting} years elapsed)`,
      yearsRemaining: requiredWait - yearsWaiting };
  }

  return { eligible: true, reason: 'You may qualify for expungement. Consult an attorney to confirm.' };
}

describe('Expungement — permanent ineligibility', () => {
  test.each(['murder','manslaughter','rape','child_abuse','terrorism'])(
    '%s is never expungeable', (charge) => {
      const r = checkExpungementEligibility({
        state: 'CA', chargeType: charge, conviction: true,
        sentenceComplete: true, yearsWaiting: 20, subsequentOffenses: 0
      });
      expect(r.eligible).toBe(false);
    }
  );

  test('subsequent offense disqualifies', () => {
    const r = checkExpungementEligibility({
      state: 'CA', chargeType: 'misdemeanor', conviction: true,
      sentenceComplete: true, yearsWaiting: 5, subsequentOffenses: 1
    });
    expect(r.eligible).toBe(false);
  });

  test('incomplete sentence disqualifies', () => {
    const r = checkExpungementEligibility({
      state: 'CA', chargeType: 'misdemeanor', conviction: true,
      sentenceComplete: false, yearsWaiting: 10, subsequentOffenses: 0
    });
    expect(r.eligible).toBe(false);
  });
});

describe('Expungement — state-specific waiting periods', () => {
  test('TN misdemeanor: eligible after 5 years', () => {
    const eligible = checkExpungementEligibility({
      state: 'TN', chargeType: 'misdemeanor', conviction: true,
      sentenceComplete: true, yearsWaiting: 6, subsequentOffenses: 0
    });
    expect(eligible.eligible).toBe(true);
  });

  test('TN misdemeanor: NOT eligible before 5 years', () => {
    const r = checkExpungementEligibility({
      state: 'TN', chargeType: 'misdemeanor', conviction: true,
      sentenceComplete: true, yearsWaiting: 3, subsequentOffenses: 0
    });
    expect(r.eligible).toBe(false);
    expect(r.yearsRemaining).toBe(2);
  });

  test('GA felony: never expungeable', () => {
    const r = checkExpungementEligibility({
      state: 'GA', chargeType: 'felony', conviction: true,
      sentenceComplete: true, yearsWaiting: 20, subsequentOffenses: 0
    });
    expect(r.eligible).toBe(false);
  });

  test('dismissed charge has 0-year wait', () => {
    const r = checkExpungementEligibility({
      state: 'TN', chargeType: 'misdemeanor', conviction: false,
      sentenceComplete: true, yearsWaiting: 0, subsequentOffenses: 0
    });
    expect(r.eligible).toBe(true);
  });

  test('unknown state returns null (not false) with attorney referral', () => {
    const r = checkExpungementEligibility({
      state: 'WY', chargeType: 'misdemeanor', conviction: true,
      sentenceComplete: true, yearsWaiting: 5, subsequentOffenses: 0
    });
    expect(r.eligible).toBeNull();
    expect(r.reason).toMatch(/attorney/i);
  });
});

describe('Expungement — user-facing results', () => {
  test('eligible result always recommends attorney consultation', () => {
    const r = checkExpungementEligibility({
      state: 'CA', chargeType: 'misdemeanor', conviction: true,
      sentenceComplete: true, yearsWaiting: 3, subsequentOffenses: 0
    });
    expect(r.reason).toMatch(/attorney|lawyer/i);
  });

  test('result always includes a reason string', () => {
    const scenarios = [
      { state: 'TN', chargeType: 'murder',       conviction: true,  sentenceComplete: true,  yearsWaiting: 20, subsequentOffenses: 0 },
      { state: 'CA', chargeType: 'misdemeanor',  conviction: true,  sentenceComplete: true,  yearsWaiting: 2,  subsequentOffenses: 0 },
      { state: 'GA', chargeType: 'misdemeanor',  conviction: false, sentenceComplete: true,  yearsWaiting: 0,  subsequentOffenses: 0 },
    ];
    for (const s of scenarios) {
      const r = checkExpungementEligibility(s);
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(10);
    }
  });
});
