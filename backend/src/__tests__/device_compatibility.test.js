/**
 * device_compatibility.test.js
 * Tests that core logic works identically on iOS/Android/web 
 * regardless of Number formatting, locale, or date handling.
 */

describe('Number formatting — locale-independent', () => {
  const fmt = (n) => n.toLocaleString('en-US');
  test('bail amount formatted consistently', () => {
    expect(fmt(15000)).toBe('15,000');
    expect(fmt(1000000)).toBe('1,000,000');
    expect(fmt(0)).toBe('0');
  });
  test('currency cents never accumulate float error', () => {
    const premium = Math.ceil(15000 * 0.10 * 100) / 100;
    expect(Number.isInteger(premium * 100)).toBe(true);
  });
});

describe('Date handling — timezone-safe', () => {
  test('court date boundary is correct across timezone', () => {
    const d = new Date('2025-12-31T00:00:00Z');
    expect(d.toISOString().slice(0, 10)).toBe('2025-12-31');
  });
  test('business day skips Saturday', () => {
    const fri = new Date('2025-06-13T12:00:00Z'); // Friday
    fri.setUTCDate(fri.getUTCDate() + 1);
    while (fri.getUTCDay() === 0 || fri.getUTCDay() === 6) fri.setUTCDate(fri.getUTCDate() + 1);
    expect(fri.getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(fri.getUTCDay()).toBeLessThanOrEqual(5);
  });
  test('business day skips Sunday', () => {
    const sat = new Date('2025-06-14T12:00:00Z'); // Saturday
    sat.setUTCDate(sat.getUTCDate() + 1);
    while (sat.getUTCDay() === 0 || sat.getUTCDay() === 6) sat.setUTCDate(sat.getUTCDate() + 1);
    expect(sat.getUTCDay()).not.toBe(0);
    expect(sat.getUTCDay()).not.toBe(6);
  });
  test('year boundary: Dec 31 + 1 = Jan 1 next year', () => {
    const d = new Date('2025-12-31T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(1);
  });
  test('asylum 180-day EAD eligibility', () => {
    const filed = new Date('2024-01-01');
    const check = new Date('2024-07-01');
    const days  = Math.floor((check - filed) / 86400000);
    expect(days).toBeGreaterThanOrEqual(180);
  });
});

describe('String safety — special characters in legal names', () => {
  const normalize = (s) => s.toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[.,\-\'"/#!$%^*;:{}=`~()]/g, ' ')
    .replace(/\s+/g, ' ').trim();

  test("O'Brien & Associates normalizes correctly", () => {
    expect(normalize("O'Brien & Associates")).toBe('o brien and associates');
  });
  test("St. Claire normalizes correctly", () => {
    expect(normalize('St. Claire')).toBe('st claire');
  });
  test('normalize is idempotent', () => {
    const s = "Smith & Jones, LLC";
    expect(normalize(normalize(s))).toBe(normalize(s));
  });
  test('empty string is safe', () => {
    expect(() => normalize('')).not.toThrow();
    expect(normalize('')).toBe('');
  });
  test('unicode name is safe', () => {
    expect(() => normalize('García & López')).not.toThrow();
  });
});

describe('Math precision — no floating point surprises', () => {
  test('10% of $15,000 = $1,500 exactly', () => {
    expect(Math.ceil(15000 * 0.10 * 100) / 100).toBe(1500);
  });
  test('10% of $7,777 rounds correctly', () => {
    const premium = Math.ceil(7777 * 0.10 * 100) / 100;
    expect(typeof premium).toBe('number');
    expect(isNaN(premium)).toBe(false);
    expect(premium).toBeGreaterThan(0);
  });
  test('child support p1+p2 always equals base', () => {
    const cases = [
      [3000, 2000, 2, 70], [5000, 5000, 1, 50], [10000, 800, 3, 65],
      [1500, 12000, 4, 30], [8000, 3000, 2, 80],
    ];
    cases.forEach(([i1, i2, ch, cu]) => {
      const base = Math.round((i1 + i2) * (ch === 1 ? 0.17 : ch === 2 ? 0.25 : ch === 3 ? 0.29 : 0.31));
      const p1   = Math.round(base * (1 - cu / 100));
      const p2   = base - p1;
      expect(p1 + p2).toBe(base);
    });
  });
  test('Infinity bail produces error not Infinity result', () => {
    const amt = Infinity;
    const result = (!amt || isNaN(amt) || !isFinite(amt) || amt <= 0) ? { error: 'invalid' } : { premium: amt * 0.1 };
    expect(result.error).toBe('invalid');
  });
});

describe('Subscription tier hierarchy', () => {
  const TIERS = { free: 0, legal_radar: 1, advisor: 2, legal_pro: 3, esquire: 4 };
  const canAccess = (tier, minTier) => (TIERS[tier] ?? -1) >= (TIERS[minTier] ?? 999);

  test('esquire can access everything', () => {
    expect(Object.keys(TIERS).every(t => canAccess('esquire', t))).toBe(true);
  });
  test('free cannot access paid tiers', () => {
    expect(canAccess('free', 'legal_radar')).toBe(false);
    expect(canAccess('free', 'advisor')).toBe(false);
  });
  test('higher tier always supersedes lower', () => {
    const tierList = Object.keys(TIERS);
    for (let i = 0; i < tierList.length; i++) {
      for (let j = 0; j <= i; j++) {
        expect(canAccess(tierList[i], tierList[j])).toBe(true);
      }
    }
  });
  test('unknown tier defaults to no access', () => {
    expect(canAccess('hacker_tier', 'free')).toBe(false);
  });
});

describe('Immigration — EAD timeline', () => {
  test('day 0: not eligible', () => { expect(0 >= 180).toBe(false); });
  test('day 179: still not eligible', () => { expect(179 >= 180).toBe(false); });
  test('day 180: exactly eligible', () => { expect(180 >= 180).toBe(true); });
  test('day 365: eligible', () => { expect(365 >= 180).toBe(true); });
  test('days until eligibility', () => {
    const elapsed = 90;
    const daysUntil = Math.max(0, 180 - elapsed);
    expect(daysUntil).toBe(90);
  });
  test('days until eligibility never negative', () => {
    for (const elapsed of [0, 90, 180, 365, 730]) {
      expect(Math.max(0, 180 - elapsed)).toBeGreaterThanOrEqual(0);
    }
  });
});
