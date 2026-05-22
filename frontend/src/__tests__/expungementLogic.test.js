/**
 * expungementLogic.test.js — Tests for expungement eligibility logic
 */

describe('Expungement wait period logic', () => {
  const daysUntilEligible = (waitYears, caseDateStr) => {
    if (!caseDateStr || isNaN(new Date(caseDateStr).getTime())) return null;
    const eligible = new Date(caseDateStr);
    eligible.setFullYear(eligible.getFullYear() + waitYears);
    return Math.ceil((eligible.getTime() - Date.now()) / 86400000);
  };

  it('returns null for missing case date', () => {
    expect(daysUntilEligible(3, null)).toBeNull();
    expect(daysUntilEligible(3, '')).toBeNull();
    expect(daysUntilEligible(3, 'invalid')).toBeNull();
  });

  it('returns negative days for past-eligible cases', () => {
    const pastDate = '2015-01-01';
    const days = daysUntilEligible(3, pastDate);
    expect(days).toBeLessThan(0);
  });

  it('returns positive days for future-eligible cases', () => {
    const recentDate = new Date();
    recentDate.setFullYear(recentDate.getFullYear() - 1);
    const days = daysUntilEligible(5, recentDate.toISOString());
    expect(days).toBeGreaterThan(0);
  });

  it('never returns NaN', () => {
    const result = daysUntilEligible(3, '2020-06-15');
    expect(isNaN(result)).toBe(false);
  });
});

describe('State validation', () => {
  it('requires a state before checking eligibility', () => {
    const validate = (state, charges) => {
      if (!state) return { error: 'Please select your state first.' };
      if (!charges || !charges.trim()) return { error: 'Describe your charges.' };
      return { ok: true };
    };
    expect(validate('', 'DUI')).toHaveProperty('error');
    expect(validate('TN', '')).toHaveProperty('error');
    expect(validate('TN', 'DUI')).toHaveProperty('ok', true);
  });
});
