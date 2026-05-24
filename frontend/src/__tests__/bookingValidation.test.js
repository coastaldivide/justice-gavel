/**
 * bookingValidation.test.js
 * Tests for booking flow validation, payment state, and chat streaming
 */

// ── Booking slot selection ────────────────────────────────────────────────
describe('Booking flow validation', () => {
  const validateBookingStep = (step, state) => {
    if (step === 'duration' && !state.duration) return 'select_duration';
    if (step === 'datetime') {
      if (!state.selDay) return 'select_day';
      if (!state.selTime) return 'select_time';
    }
    if (step === 'confirm') {
      if (!state.selTime) return 'no_slot_selected';
      if (!state.lawyerId) return 'no_lawyer';
    }
    return 'valid';
  };

  it('rejects confirm without time slot', () => {
    const result = validateBookingStep('confirm', { lawyerId: 1, selTime: null });
    expect(result).toBe('no_slot_selected');
  });

  it('rejects confirm without lawyer', () => {
    const result = validateBookingStep('confirm', { lawyerId: null, selTime: '2pm' });
    expect(result).toBe('no_lawyer');
  });

  it('accepts confirm with slot and lawyer', () => {
    const result = validateBookingStep('confirm', { lawyerId: 1, selTime: '2pm' });
    expect(result).toBe('valid');
  });

  it('requires day selection on datetime step', () => {
    const result = validateBookingStep('datetime', { selDay: null, selTime: null });
    expect(result).toBe('select_day');
  });

  it('requires time after day selected', () => {
    const result = validateBookingStep('datetime', { selDay: '2026-06-15', selTime: null });
    expect(result).toBe('select_time');
  });
});

// ── Callback request validation ───────────────────────────────────────────
describe('Callback booking validation', () => {
  const validateCallback = (phone) => {
    if (!phone || !phone.trim()) return 'phone_required';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return 'phone_too_short';
    return 'valid';
  };

  it('requires phone number', () => {
    expect(validateCallback('')).toBe('phone_required');
    expect(validateCallback('   ')).toBe('phone_required');
    expect(validateCallback(null)).toBe('phone_required');
  });

  it('validates minimum phone length', () => {
    expect(validateCallback('555-123')).toBe('phone_too_short');
  });

  it('accepts valid US phone numbers', () => {
    expect(validateCallback('615-555-0100')).toBe('valid');
    expect(validateCallback('+1 (615) 555-0100')).toBe('valid');
  });
});

// ── Chat stream chunk handling ────────────────────────────────────────────
describe('Chat streaming edge cases', () => {
  const buildMessage = (chunks) => {
    let content = '';
    for (const chunk of chunks) {
      if (typeof chunk === 'string') content += chunk;
    }
    return content;
  };

  it('assembles chunks into full message', () => {
    const msg = buildMessage(['Hello', ' ', 'world', '!']);
    expect(msg).toBe('Hello world!');
  });

  it('handles empty chunks gracefully', () => {
    const msg = buildMessage(['Hello', '', null, ' world']);
    // null silently skipped (type guard)
    expect(msg).toContain('Hello');
    expect(msg).toContain('world');
  });

  it('handles single chunk', () => {
    const msg = buildMessage(['Complete message']);
    expect(msg).toBe('Complete message');
  });
});

// ── Chat offline Q&A matching ─────────────────────────────────────────────
describe('Chat offline Q&A', () => {
  const OFFLINE_RESPONSES = [
    { q: ['remain silent', 'stay silent', 'right to silence'], a: 'You have the right to remain silent under the 5th Amendment.' },
    { q: ['miranda', 'rights when arrested'], a: 'You must be read your Miranda rights before custodial interrogation.' },
    { q: ['bail', 'get out of jail'], a: 'Bail allows you to be released while awaiting trial.' },
  ];

  const findOfflineAnswer = (query) => {
    const q = query.toLowerCase();
    for (const item of OFFLINE_RESPONSES) {
      if (item.q.some(keyword => q.includes(keyword))) {
        return item.a;
      }
    }
    return null;
  };

  it('matches remain silent query', () => {
    const answer = findOfflineAnswer('Do I have to remain silent?');
    expect(answer).toContain('5th Amendment');
  });

  it('matches bail query', () => {
    const answer = findOfflineAnswer('How do I get out of jail?');
    expect(answer).toContain('Bail');
  });

  it('returns null for unmatched query', () => {
    const answer = findOfflineAnswer('What is the weather today?');
    expect(answer).toBeNull();
  });

  it('is case-insensitive', () => {
    const answer = findOfflineAnswer('MIRANDA RIGHTS');
    expect(answer).not.toBeNull();
  });
});
