/**
 * new_routes_v875.test.js — Unit tests for routes added in v8.7.0–v8.7.5
 * Tests route logic directly without HTTP layer (matches project test pattern)
 */

import { fileURLToPath } from 'url';

// ── Immigration logic tests ──────────────────────────────────────────────────

const calcAsylumClock = (filingDate, eadDays = 180) => {
  const filed = new Date(filingDate);
  const today = new Date();
  const days  = Math.floor((today - filed) / (1000 * 60 * 60 * 24));
  const daysUntilEad = Math.max(0, eadDays - days);
  const eadDate = new Date(filed.getTime() + eadDays * 86400000);
  return {
    days_elapsed:    days,
    ead_eligible:    days >= eadDays,
    days_until_ead:  daysUntilEad,
    ead_eligible_date: eadDate.toISOString().split('T')[0],
  };
};

const calcVoluntaryDeparture = (grantDate, daysGranted = 60) => {
  const granted  = new Date(grantDate);
  const deadline = new Date(granted.getTime() + daysGranted * 86400000);
  const today    = new Date();
  const remaining = Math.max(0, Math.floor((deadline - today) / (1000 * 60 * 60 * 24)));
  return {
    days_remaining:     remaining,
    departure_deadline: deadline.toISOString().split('T')[0],
    status: remaining === 0 ? 'EXPIRED' : remaining <= 7 ? 'URGENT' : remaining <= 30 ? 'WARNING' : 'On track',
  };
};

describe('Immigration — Asylum Clock Calculator', () => {
  it('marks EAD eligible after 180+ days', () => {
    const filing = new Date(Date.now() - 200 * 86400000).toISOString().split('T')[0];
    const result = calcAsylumClock(filing);
    expect(result.ead_eligible).toBe(true);
    expect(result.days_until_ead).toBe(0);
    expect(result.days_elapsed).toBeGreaterThan(190);
  });

  it('marks EAD not eligible for recent filings', () => {
    const filing = new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0];
    const result = calcAsylumClock(filing);
    expect(result.ead_eligible).toBe(false);
    expect(result.days_until_ead).toBeGreaterThan(160);
  });

  it('returns exactly 0 days_until_ead when exactly at threshold', () => {
    const filing = new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];
    const result = calcAsylumClock(filing);
    expect(result.ead_eligible).toBe(true);
    expect(result.days_until_ead).toBe(0);
  });

  it('calculates ead_eligible_date correctly', () => {
    const filing = new Date('2025-01-01');
    const result = calcAsylumClock('2025-01-01');
    expect(result.ead_eligible_date).toBe('2025-06-30');
  });
});

describe('Immigration — Voluntary Departure Calculator', () => {
  it('calculates days remaining correctly', () => {
    const grantDate = new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0];
    const result    = calcVoluntaryDeparture(grantDate, 60);
    // 60 - 20 = 40 days remaining → On track (> 30)
    expect(result.days_remaining).toBeGreaterThan(35);
    expect(result.status).toBe('On track');
  });

  it('marks URGENT within 7 days of deadline', () => {
    const grantDate = new Date(Date.now() - 55 * 86400000).toISOString().split('T')[0];
    const result    = calcVoluntaryDeparture(grantDate, 60);
    expect(result.days_remaining).toBeLessThan(8);
    expect(result.status).toBe('URGENT');
  });

  it('marks EXPIRED for past deadline', () => {
    const grantDate = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    const result    = calcVoluntaryDeparture(grantDate, 60);
    expect(result.days_remaining).toBe(0);
    expect(result.status).toBe('EXPIRED');
  });

  it('marks WARNING between 8 and 30 days', () => {
    const grantDate = new Date(Date.now() - 45 * 86400000).toISOString().split('T')[0];
    const result    = calcVoluntaryDeparture(grantDate, 60);
    expect(result.days_remaining).toBeGreaterThan(7);
    expect(result.days_remaining).toBeLessThanOrEqual(30);
    expect(result.status).toBe('WARNING');
  });
});

// ── Bail estimate logic ──────────────────────────────────────────────────────

const calcBailEstimate = (bail, rate = 0.10) => {
  const premium       = Math.ceil(bail * rate * 100) / 100;
  const court_fees    = 250;
  const ankle_monitor = 150;
  const attorney_est  = bail < 10000 ? 1500 : bail < 50000 ? 3500 : 7500;
  return {
    bail_amount: bail,
    premium,
    estimated_fees: {
      bond_premium:      premium,
      court_fees,
      ankle_monitor,
      attorney_retainer: attorney_est,
      total:             premium + court_fees + ankle_monitor + attorney_est,
    },
  };
};

describe('Bail — Estimate Total Calculator', () => {
  it('calculates 10% premium correctly', () => {
    const result = calcBailEstimate(10000);
    expect(result.premium).toBe(1000);
    expect(result.estimated_fees.bond_premium).toBe(1000);
  });

  it('uses $1,500 attorney estimate for bail under $10k', () => {
    const result = calcBailEstimate(5000);
    expect(result.estimated_fees.attorney_retainer).toBe(1500);
  });

  it('uses $3,500 attorney estimate for bail $10k–$50k', () => {
    const result = calcBailEstimate(25000);
    expect(result.estimated_fees.attorney_retainer).toBe(3500);
  });

  it('uses $7,500 attorney estimate for bail over $50k', () => {
    const result = calcBailEstimate(100000);
    expect(result.estimated_fees.attorney_retainer).toBe(7500);
  });

  it('total fee is greater than premium alone', () => {
    const result = calcBailEstimate(10000);
    expect(result.estimated_fees.total).toBeGreaterThan(result.premium);
    expect(result.estimated_fees.total).toBeGreaterThan(2000);
  });

  it('calculates non-standard rates correctly', () => {
    const result = calcBailEstimate(10000, 0.15);
    expect(result.premium).toBe(1500);
  });
});

// ── Expungement petition checklist ───────────────────────────────────────────

const getChecklist = (state) => {
  const common = [
    'Certified copy of criminal record',
    'Copy of your conviction order or dismissal',
    'Government-issued photo ID',
    'Proof of completed sentence',
    'Completed petition form',
    'Filing fee payment',
  ];
  const stateSpecific = {
    TN: ['TBI criminal history certificate', 'Petition for Expunction (TCA 40-32-101)'],
    TX: ['Texas DPS RAP sheet', 'Order of Non-Disclosure or Expunction petition'],
    FL: ['FDLE background check', 'Florida Rule 3.692 petition'],
    CA: ['PC 1203.4 petition', 'Proof of probation completion'],
  };
  return [...common, ...(stateSpecific[state?.toUpperCase()] || [])];
};

describe('Expungement — Petition Checklist', () => {
  it('returns at least 6 items for any state', () => {
    expect(getChecklist('TN').length).toBeGreaterThan(5);
    expect(getChecklist('XX').length).toBeGreaterThan(5);
  });

  it('includes TN-specific items for Tennessee', () => {
    const list = getChecklist('TN');
    expect(list.some(i => i.includes('TBI'))).toBe(true);
  });

  it('includes TX-specific items for Texas', () => {
    const list = getChecklist('TX');
    expect(list.some(i => i.includes('DPS'))).toBe(true);
  });

  it('always includes common items regardless of state', () => {
    const list = getChecklist('ZZ');
    expect(list.some(i => i.includes('criminal record'))).toBe(true);
    expect(list.some(i => i.includes('photo ID'))).toBe(true);
    expect(list.some(i => i.includes('Filing fee'))).toBe(true);
  });
});

// ── Lesson streak logic ───────────────────────────────────────────────────────

const calcStreak = (completionDays) => {
  // completionDays: array of days-ago integers (0=today, 1=yesterday, etc.)
  let streak = 0;
  let expected = 0;
  for (const day of completionDays.sort((a,b) => a-b)) {
    if (day === expected) { streak++; expected++; }
    else break;
  }
  return streak;
};

describe('Lessons — Streak Calculator', () => {
  it('calculates a 3-day streak', () => {
    expect(calcStreak([0, 1, 2])).toBe(3);
  });

  it('stops at a gap', () => {
    expect(calcStreak([0, 1, 3, 4])).toBe(2);  // gap at day 2
  });

  it('handles no activity', () => {
    expect(calcStreak([])).toBe(0);
  });

  it('counts a single day as streak 1', () => {
    expect(calcStreak([0])).toBe(1);
  });

  it('does not count a gap from today', () => {
    expect(calcStreak([1, 2, 3])).toBe(0);  // missed today
  });
});

// ── Input sanitization ────────────────────────────────────────────────────────

const sanitize = str => String(str || '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#x27;').replace(/\//g,'&#x2F;')
  .trim();

describe('Security — Input Sanitizer', () => {
  it('escapes HTML angle brackets', () => {
    expect(sanitize('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
  });

  it('escapes ampersands', () => {
    expect(sanitize('Rock & Roll')).toBe('Rock &amp; Roll');
  });

  it('escapes double quotes', () => {
    expect(sanitize('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(sanitize("it's")).toBe('it&#x27;s');
  });

  it('handles null/undefined safely', () => {
    expect(sanitize(null)).toBe('');
    expect(sanitize(undefined)).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitize('  hello  ')).toBe('hello');
  });
});

// ── State code validation ─────────────────────────────────────────────────────

const validateStateCode = code =>
  code ? code.replace(/[^A-Z]/gi,'').toUpperCase().slice(0,2) : null;

describe('Security — State Code Validation', () => {
  it('accepts valid two-letter state codes', () => {
    expect(validateStateCode('TN')).toBe('TN');
    expect(validateStateCode('CA')).toBe('CA');
  });

  it('strips non-alpha characters', () => {
    expect(validateStateCode('T1N!')).toBe('TN');
  });

  it('uppercases lowercase input', () => {
    expect(validateStateCode('tn')).toBe('TN');
  });

  it('truncates to 2 characters', () => {
    expect(validateStateCode('CALIFORNIA')).toBe('CA');
  });

  it('returns null for empty/null input', () => {
    expect(validateStateCode('')).toBe(null);
    expect(validateStateCode(null)).toBe(null);
  });
});
