/**
 * bookingValidation.test.js — Tests for consultation booking flow validation
 */

describe('Booking step validation', () => {
  const validateStep = (step, selTime, selDay, phone) => {
    if (step === 'datetime') {
      if (!selDay) return 'Select a date to continue.';
      if (!selTime) return 'Select a time slot to continue.';
    }
    if (step === 'callback') {
      const digits = (phone || '').replace(/\D/g, '');
      if (digits.length < 10) return 'Enter a valid 10-digit phone number.';
    }
    return null;
  };

  it('requires day before proceeding', () => { expect(validateStep('datetime', null, null, null)).toContain('date'); });
  it('requires time after day selected', () => { expect(validateStep('datetime', null, { date: '2026-06-01' }, null)).toContain('time'); });
  it('passes when both selected', () => { expect(validateStep('datetime', '10:00 AM', { date: '2026-06-01' }, null)).toBeNull(); });
  it('requires valid phone for callback', () => { expect(validateStep('callback', null, null, '555')).toBeTruthy(); });
  it('accepts 10-digit phone', () => { expect(validateStep('callback', null, null, '6155550100')).toBeNull(); });
  it('strips non-digit chars when validating', () => { expect(validateStep('callback', null, null, '(615) 555-0100')).toBeNull(); });
});

describe('Available time slots', () => {
  const getAvailable = (times) => (times || []).filter(t => t.available);

  it('returns empty for null', () => { expect(getAvailable(null)).toEqual([]); });
  it('filters unavailable slots', () => {
    expect(getAvailable([{ available: true }, { available: false }, { available: true }])).toHaveLength(2);
  });
  it('returns all when all available', () => {
    expect(getAvailable([{ available: true }, { available: true }])).toHaveLength(2);
  });
});
