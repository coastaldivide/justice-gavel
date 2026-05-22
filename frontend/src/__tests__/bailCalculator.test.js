/**
 * bailCalculator.test.js — Tests for bail calculator logic
 */

describe('Bail calculator fee computation', () => {
  // Premium bail bond fee = 10% of bail amount (industry standard)
  const calcFee = (bailAmount, pct = 10) => {
    if (!bailAmount || bailAmount <= 0 || isNaN(bailAmount)) return 0;
    return Math.round(bailAmount * (pct / 100));
  };

  it('calculates 10% fee correctly', () => {
    expect(calcFee(10000)).toBe(1000);
    expect(calcFee(50000)).toBe(5000);
    expect(calcFee(100000)).toBe(10000);
  });

  it('returns 0 for null/undefined bail amount', () => {
    expect(calcFee(null)).toBe(0);
    expect(calcFee(undefined)).toBe(0);
    expect(calcFee(0)).toBe(0);
  });

  it('returns 0 for negative bail amount', () => {
    expect(calcFee(-5000)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(calcFee(NaN)).toBe(0);
  });

  it('handles custom percentage', () => {
    expect(calcFee(10000, 15)).toBe(1500);
    expect(calcFee(10000, 8)).toBe(800);
  });

  it('rounds to nearest dollar', () => {
    expect(calcFee(9999)).toBe(1000); // 999.9 rounds to 1000
    expect(calcFee(1000)).toBe(100);
  });
});

describe('Bail schedule lookup', () => {
  const getBailRange = (amount, schedules) => {
    if (!schedules || !schedules.length) return null;
    return schedules.find(s =>
      amount >= (s.min ?? 0) && amount <= (s.max ?? Infinity)
    ) || null;
  };

  const mockSchedules = [
    { charge: 'Misdemeanor', min: 0, max: 9999 },
    { charge: 'Felony C', min: 10000, max: 49999 },
    { charge: 'Felony B', min: 50000, max: 199999 },
  ];

  it('finds correct schedule for low bail', () => {
    expect(getBailRange(5000, mockSchedules).charge).toBe('Misdemeanor');
  });

  it('finds correct schedule for felony bail', () => {
    expect(getBailRange(25000, mockSchedules).charge).toBe('Felony C');
  });

  it('returns null for empty schedules', () => {
    expect(getBailRange(5000, [])).toBeNull();
    expect(getBailRange(5000, null)).toBeNull();
  });

  it('returns null for amount outside all ranges', () => {
    expect(getBailRange(500000, mockSchedules)).toBeNull();
  });
});
