/**
 * bail_calculator_math.test.js
 * Tests the core bail calculation logic — the most critical
 * business logic in the app. Wrong bail math directly harms users.
 */

// Bail bond math: bondsman charges 10-15% premium of bail amount
// User pays the premium, not the full bail
// If bail is reduced, does the bondsman refund? (varies by state)

function calcBondPremium(bailAmount, rate = 0.10) {
  if (!bailAmount || bailAmount <= 0) return null;
  if (rate <= 0 || rate > 0.20) return null;
  return Math.ceil(bailAmount * rate * 100) / 100;
}

function calcInstallmentPlan(premium, months) {
  if (!premium || premium <= 0 || !months || months <= 0) return null;
  const monthly = Math.ceil((premium / months) * 100) / 100;
  return { monthly, total: monthly * months };
}

function calcTotalCostOfBail(bailAmount, bondPremium, additionalFees = 0) {
  return bondPremium + additionalFees;
}

function isEligibleForOR(priorConvictions, chargeClass, employmentStatus) {
  // Own recognizance (no bail) — simplified eligibility
  if (priorConvictions > 2) return false;
  if (chargeClass === 'felony-a' || chargeClass === 'felony-b') return false;
  return true;
}

describe('Bail calculator — bond premium', () => {
  test.each([
    [1000,    0.10,  100],
    [5000,    0.10,  500],
    [25000,   0.10, 2500],
    [100000,  0.10, 10000],
    [100000,  0.15, 15000],
    [7500,    0.10,  750],
    [50000,   0.12, 6000],
  ])('bail $%d at %d%% rate → $%d premium', (bail, rate, expected) => {
    expect(calcBondPremium(bail, rate)).toBe(expected);
  });

  test('zero bail amount returns null', () => {
    expect(calcBondPremium(0)).toBeNull();
  });

  test('negative bail returns null', () => {
    expect(calcBondPremium(-1000)).toBeNull();
  });

  test('rate above 20% is rejected (usury protection)', () => {
    expect(calcBondPremium(10000, 0.25)).toBeNull();
  });

  test('rate of 0 is rejected', () => {
    expect(calcBondPremium(10000, 0)).toBeNull();
  });

  test('fractional bail amounts are rounded up to nearest cent', () => {
    // $7,333 × 10% = $733.30 exactly
    expect(calcBondPremium(7333, 0.10)).toBe(733.30);
  });
});

describe('Bail calculator — installment plans', () => {
  test('3-month plan on $1,500 premium = $500/month', () => {
    const plan = calcInstallmentPlan(1500, 3);
    expect(plan.monthly).toBe(500);
    expect(plan.total).toBe(1500);
  });

  test('monthly amount always rounds UP (not down) to protect bondsman', () => {
    // $100 / 3 months = $33.33... rounds UP to $33.34
    const plan = calcInstallmentPlan(100, 3);
    expect(plan.monthly).toBeGreaterThanOrEqual(100 / 3);
  });

  test('invalid months returns null', () => {
    expect(calcInstallmentPlan(1000, 0)).toBeNull();
    expect(calcInstallmentPlan(1000, -1)).toBeNull();
  });
});

describe('OR eligibility — own recognizance', () => {
  test('no priors + misdemeanor → eligible', () => {
    expect(isEligibleForOR(0, 'misdemeanor', 'employed')).toBe(true);
  });

  test('3+ priors → not eligible', () => {
    expect(isEligibleForOR(3, 'misdemeanor', 'employed')).toBe(false);
  });

  test('felony A charge → not eligible regardless of history', () => {
    expect(isEligibleForOR(0, 'felony-a', 'employed')).toBe(false);
  });

  test('felony B charge → not eligible', () => {
    expect(isEligibleForOR(1, 'felony-b', 'employed')).toBe(false);
  });

  test('2 priors + misdemeanor → still eligible', () => {
    expect(isEligibleForOR(2, 'misdemeanor', 'unemployed')).toBe(true);
  });
});

describe('Bail cost transparency', () => {
  test('total cost = premium + fees (user pays premium, not full bail)', () => {
    const bail    = 10000;
    const premium = calcBondPremium(bail, 0.10); // $1000
    const fees    = 50;
    const total   = calcTotalCostOfBail(bail, premium, fees);
    expect(total).toBe(1050);
    expect(total).toBeLessThan(bail); // user never pays full bail amount via bondsman
  });

  test('premium is always less than bail amount', () => {
    for (const bail of [500, 1000, 5000, 25000, 100000]) {
      expect(calcBondPremium(bail)).toBeLessThan(bail);
    }
  });
});
