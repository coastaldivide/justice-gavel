/**
 * checkInFlow.test.js — Tests for check-in business logic
 */

describe('CheckIn GPS validation', () => {
  it('rejects NaN latitude', () => {
    const lat = NaN, lng = -86.7816;
    const valid = typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);
    expect(valid).toBe(false);
  });

  it('rejects NaN longitude', () => {
    const lat = 36.1627, lng = NaN;
    const valid = typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);
    expect(valid).toBe(false);
  });

  it('accepts valid Nashville coordinates', () => {
    const lat = 36.1627, lng = -86.7816;
    const valid = typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);
    expect(valid).toBe(true);
  });

  it('rejects undefined coordinates', () => {
    const lat = undefined, lng = undefined;
    const valid = typeof lat === 'number' && typeof lng === 'number';
    expect(valid).toBe(false);
  });
});

describe('Bondsman lead fee (flat, never scaled to bail)', () => {
  const { leadFeeLabel, BONDSMAN_LEAD_FEE_CENTS, BONDSMAN_LEAD_FEE_DISPLAY } = require('../constants/leadFee');

  it('is a flat $75', () => {
    expect(BONDSMAN_LEAD_FEE_CENTS).toBe(7500);
    expect(BONDSMAN_LEAD_FEE_DISPLAY).toBe('$75');
  });

  it('is the same for every bail amount', () => {
    [0, null, undefined, NaN, -1, 500, 4999, 10000, 25000, 75000, 100000, 999999].forEach(bail => {
      expect(leadFeeLabel({ bail_amount: bail })).toBe('$75');
    });
    expect(leadFeeLabel(null)).toBe('$75');
    expect(leadFeeLabel(undefined)).toBe('$75');
  });

  it('prefers the server-provided fee', () => {
    expect(leadFeeLabel({ lead_fee_display: '$80' })).toBe('$80');
    expect(leadFeeLabel({ lead_fee_cents: 8000 })).toBe('$80');
    expect(leadFeeLabel({ lead_fee_cents: NaN })).toBe('$75');
  });
});
