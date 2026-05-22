/**
 * dateUtils.test.js — Tests for shared date utility functions
 */
const { daysUntil, daysSince, formatDate, relativeDateLabel, MS_PER_DAY, MS_PER_HOUR } = require('../utils/dateUtils');

describe('daysUntil', () => {
  it('returns null for null input', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
    expect(daysUntil('')).toBeNull();
  });

  it('returns null for invalid date string', () => {
    expect(daysUntil('not-a-date')).toBeNull();
  });

  it('returns negative number for past date', () => {
    const past = new Date(Date.now() - 5 * MS_PER_DAY).toISOString();
    expect(daysUntil(past)).toBeLessThan(0);
  });

  it('returns positive number for future date', () => {
    const future = new Date(Date.now() + 10 * MS_PER_DAY).toISOString();
    expect(daysUntil(future)).toBeGreaterThan(0);
  });

  it('never returns NaN', () => {
    const result = daysUntil('2025-06-15');
    expect(isNaN(result)).toBe(false);
  });
});

describe('daysSince', () => {
  it('returns null for null input', () => {
    expect(daysSince(null)).toBeNull();
  });

  it('returns positive number for past date', () => {
    const past = new Date(Date.now() - 3 * MS_PER_DAY).toISOString();
    expect(daysSince(past)).toBeGreaterThan(0);
  });
});

describe('formatDate', () => {
  it('returns -- for null', () => {
    expect(formatDate(null)).toBe('--');
    expect(formatDate(undefined)).toBe('--');
    expect(formatDate('')).toBe('--');
  });

  it('returns -- for invalid date', () => {
    expect(formatDate('garbage')).toBe('--');
  });

  it('returns formatted string for valid date', () => {
    const result = formatDate('2025-01-15');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(3);
    expect(result).not.toBe('--');
  });
});

describe('relativeDateLabel', () => {
  it('returns -- for null', () => {
    expect(relativeDateLabel(null)).toBe('--');
  });

  it('returns "Today" for today', () => {
    const today = new Date().toISOString();
    expect(relativeDateLabel(today)).toBe('Today');
  });

  it('returns "Tomorrow" for tomorrow', () => {
    const tomorrow = new Date(Date.now() + MS_PER_DAY).toISOString();
    expect(relativeDateLabel(tomorrow)).toBe('Tomorrow');
  });

  it('returns "Yesterday" for yesterday', () => {
    const yesterday = new Date(Date.now() - MS_PER_DAY).toISOString();
    expect(relativeDateLabel(yesterday)).toBe('Yesterday');
  });

  it('returns "In X days" for future dates', () => {
    const inFiveDays = new Date(Date.now() + 5 * MS_PER_DAY).toISOString();
    const result = relativeDateLabel(inFiveDays);
    expect(result).toMatch(/In \d+ days/);
  });

  it('returns "X days ago" for past dates', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * MS_PER_DAY).toISOString();
    const result = relativeDateLabel(threeDaysAgo);
    expect(result).toMatch(/\d+ days ago/);
  });
});

describe('constants', () => {
  it('MS_PER_DAY is 86400000', () => {
    expect(MS_PER_DAY).toBe(86400000);
  });

  it('MS_PER_HOUR is 3600000', () => {
    expect(MS_PER_HOUR).toBe(3600000);
  });
});
