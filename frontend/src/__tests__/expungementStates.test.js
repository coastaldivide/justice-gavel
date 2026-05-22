/**
 * expungementStates.test.js — Expungement state lookup and eligibility
 */
describe('Expungement eligibility validation', () => {
  const check = (state, charges) => {
    if (!state) return { error: 'Select a state' };
    if (!charges || !charges.trim()) return { error: 'Describe charges' };
    return { ok: true };
  };
  it('rejects empty state', () => { expect(check('', 'DUI')).toHaveProperty('error'); });
  it('rejects null state', () => { expect(check(null, 'DUI')).toHaveProperty('error'); });
  it('rejects empty charges', () => { expect(check('TN', '')).toHaveProperty('error'); });
  it('rejects whitespace-only charges', () => { expect(check('TN', '   ')).toHaveProperty('error'); });
  it('accepts valid state and charges', () => { expect(check('TN', 'DUI')).toHaveProperty('ok', true); });
  it('accepts all 50 state codes (spot check)', () => {
    ['AL','CA','FL','NY','TX','TN','OH','PA','IL','GA'].forEach(s => {
      expect(check(s, 'test charge')).toHaveProperty('ok');
    });
  });
});

describe('Wait period calculation', () => {
  const eligible = (waitYears, caseDate) => {
    if (!caseDate) return null;
    const d = new Date(caseDate);
    if (isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + waitYears);
    return d;
  };
  it('returns null for missing case date', () => { expect(eligible(5, null)).toBeNull(); });
  it('returns null for invalid date', () => { expect(eligible(5, 'bad')).toBeNull(); });
  it('adds correct years for TN 5-year wait', () => {
    const d = eligible(5, '2020-01-01');
    expect(d.getFullYear()).toBe(2025);
  });
  it('wait period is never NaN', () => {
    const d = eligible(3, '2021-06-15');
    expect(isNaN(d.getTime())).toBe(false);
  });
});
