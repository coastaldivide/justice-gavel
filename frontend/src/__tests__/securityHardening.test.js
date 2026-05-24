/**
 * securityHardening.test.js
 * Tests for input validation, phone formatting, contact info validation
 */

// ── Phone number formatting ───────────────────────────────────────────────
describe('Phone number sanitization for tel: links', () => {
  // /\D/g removes all non-digits, making (555) 123-4567 → 5551234567
  // /\s/g only removes spaces, leaving 555)123-4567 (BROKEN tel: link)
  const sanitizePhone = (phone) => phone.replace(/\D/g, '');
  const badSanitize   = (phone) => phone.replace(/\s/g, '');

  it('strips parentheses and dashes correctly', () => {
    expect(sanitizePhone('(555) 123-4567')).toBe('5551234567');
  });

  it('strips dots from formatted numbers', () => {
    expect(sanitizePhone('555.123.4567')).toBe('5551234567');
  });

  it('/\s/g would leave parens (broken)', () => {
    expect(badSanitize('(555) 123-4567')).toBe('(555)123-4567');
    // tel:(555)123-4567 is invalid
  });

  it('handles E.164 format (keeps digits only)', () => {
    expect(sanitizePhone('+1 555 123 4567')).toBe('15551234567');
  });

  it('handles already-clean number', () => {
    expect(sanitizePhone('5551234567')).toBe('5551234567');
  });

  it('returns empty string for non-phone', () => {
    expect(sanitizePhone('not a phone')).toBe('');
  });
});

// ── Contact info validation ───────────────────────────────────────────────
describe('Contact info validation (phone or email)', () => {
  const isValidContact = (value) => {
    const trimmed = value.trim();
    if (trimmed.includes('@')) return trimmed.length > 5; // basic email check
    return trimmed.replace(/\D/g, '').length >= 7; // phone: 7+ digits
  };

  it('accepts valid email', () => {
    expect(isValidContact('user@example.com')).toBe(true);
  });

  it('accepts valid 10-digit phone', () => {
    expect(isValidContact('555-123-4567')).toBe(true);
  });

  it('accepts formatted phone with parens', () => {
    expect(isValidContact('(555) 123-4567')).toBe(true);
  });

  it('rejects too-short number', () => {
    expect(isValidContact('555-12')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidContact('')).toBe(false);
  });

  it('rejects gibberish', () => {
    expect(isValidContact('abc')).toBe(false);
  });

  it('accepts 7-digit local number', () => {
    expect(isValidContact('555-1234')).toBe(true);
  });
});

// ── Race condition prevention ─────────────────────────────────────────────
describe('mountedRef pattern', () => {
  const createMountedRef = () => {
    let mounted = true;
    return {
      current: true,
      unmount: () => { mounted = false; },
      isMounted: () => mounted,
    };
  };

  it('is true on mount', () => {
    const ref = createMountedRef();
    expect(ref.isMounted()).toBe(true);
  });

  it('is false after unmount', () => {
    const ref = createMountedRef();
    ref.unmount();
    expect(ref.isMounted()).toBe(false);
  });

  it('prevents setState after unmount', async () => {
    const ref = createMountedRef();
    let stateUpdated = false;
    const setState = (val) => { if (ref.isMounted()) stateUpdated = val; };

    const asyncOp = async () => {
      await new Promise(r => setTimeout(r, 0));
      setState(true); // would be called after unmount
    };

    const p = asyncOp();
    ref.unmount(); // unmount before async resolves
    await p;
    expect(stateUpdated).toBe(false);
  });
});
