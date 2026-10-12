/**
 * input_validation.test.js
 * Tests every user-facing input for XSS, injection, boundary conditions,
 * and malformed data. These tests run against the validation middleware
 * without needing a live database.
 */

import { sanitizeStr, escapeHtml, decodeLegacyEntities, truncateStr, validateEmail, normalizePhone } from '../utils/sanitize.js';

const XSS_VECTORS = [
  '<script>alert("xss")</script>',
  '"><img src=x onerror=alert(1)>',
  "'; DROP TABLE users; --",
  '<iframe src="javascript:alert(1)">',
  '{{7*7}}',                        // template injection
  '${7*7}',                         // JS template literal injection
  '\x00\x1f\x7f',                  // null bytes and control chars
  'a'.repeat(10001),                // overflow
  '😂🔥💯'.repeat(100),            // emoji overflow
  '\u202E',                         // RTL override
  '../../../etc/passwd',            // path traversal
  'SELECT * FROM users',            // SQL
  '<svg onload=alert(1)>',
];

const VALID_EMAILS = [
  'user@example.com',
  'user+tag@example.co.uk',
  'user.name@subdomain.example.com',
  'user123@example.org',
];

const INVALID_EMAILS = [
  '',
  'notanemail',
  '@example.com',
  'user@',
  'user @example.com',
  'user@.com',
  'a'.repeat(300) + '@example.com',
  'user@exam_ple.com',
  null,
  undefined,
  123,
];

const VALID_PHONES = [
  '+12125551234',
  '(212) 555-1234',
  '212-555-1234',
  '2125551234',
  '+1 (212) 555-1234',
];

const INVALID_PHONES = [
  '',
  'notaphone',
  '123',
  '99999999999999999',
  null,
];

// ── sanitizeStr ───────────────────────────────────────────────────────────────
describe('sanitizeStr (storage normalisation — never HTML-encodes)', () => {
  test.each(XSS_VECTORS)('stores the text as typed, minus control characters: %s', (input) => {
    if (typeof input !== 'string') return;
    const result = sanitizeStr(input);
    expect(result).not.toContain('\x00');
    expect(result).not.toContain('\u202E');
    // No HTML entities are introduced — React Native renders text literally.
    expect(result).not.toMatch(/&(lt|gt|quot|#x27|#x60|amp);/);
    expect(result).toBe(input.trim().replaceAll('\0', '').replace(/\u202E/g, ''));
  });

  test('keeps apostrophes, quotes and angle brackets intact (audit11 M1)', () => {
    expect(sanitizeStr('I don\'t know what "bail" means <3')).toBe('I don\'t know what "bail" means <3');
  });

  test('returns empty string for null/undefined', () => {
    expect(sanitizeStr(null)).toBe('');
    expect(sanitizeStr(undefined)).toBe('');
  });

  test('preserves normal text', () => {
    expect(sanitizeStr('Hello, World!')).toContain('Hello');
    expect(sanitizeStr('Aaron Hart')).toBe('Aaron Hart');
  });

  test('trims leading/trailing whitespace', () => {
    expect(sanitizeStr('  hello  ')).toBe('hello');
  });
});

describe('escapeHtml (output escaping for HTML sinks)', () => {
  test.each(XSS_VECTORS)('neutralises XSS vector: %s', (input) => {
    const result = escapeHtml(input);
    expect(result).not.toMatch(/<[a-z!/]/i);          // no raw tag can open
    expect(result).not.toMatch(/["'`]/);               // cannot break out of an attribute
  });

  test('escapes each special character exactly once', () => {
    expect(escapeHtml(`<a href="x">'&\``)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#96;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('decodeLegacyEntities (one-off repair of previously encoded text)', () => {
  test('restores single- and double-encoded text', () => {
    expect(decodeLegacyEntities('I don&#x27;t know what &quot;bail&quot; means &lt;3'))
      .toBe('I don\'t know what "bail" means <3');
    expect(decodeLegacyEntities('&amp;quot;hi&amp;quot; &amp;amp;lt;')).toBe('"hi" <');
  });

  test('leaves a user-typed &amp; alone unless asked (feedback encoded &)', () => {
    expect(decodeLegacyEntities('AT&amp;T')).toBe('AT&amp;T');
    expect(decodeLegacyEntities('AT&amp;T', { decodeAmp: true })).toBe('AT&T');
  });

  test('is idempotent and ignores non-strings', () => {
    const once = decodeLegacyEntities('&quot;x&quot; &#x2F; &#x60;');
    expect(decodeLegacyEntities(once)).toBe(once);
    expect(decodeLegacyEntities(null)).toBe(null);
    expect(decodeLegacyEntities(7)).toBe(7);
  });
});

// ── truncateStr ───────────────────────────────────────────────────────────────
describe('truncateStr', () => {
  test('truncates to max length', () => {
    expect(truncateStr('a'.repeat(500), 100).length).toBeLessThanOrEqual(100);
  });

  test('does not truncate short strings', () => {
    expect(truncateStr('hello', 100)).toBe('hello');
  });

  test('handles empty string', () => {
    expect(truncateStr('', 100)).toBe('');
  });

  test('handles null', () => {
    expect(truncateStr(null, 100)).toBe('');
  });
});

// ── validateEmail ─────────────────────────────────────────────────────────────
describe('validateEmail', () => {
  test.each(VALID_EMAILS)('accepts valid email: %s', (email) => {
    expect(validateEmail(email)).toBe(true);
  });

  test.each(INVALID_EMAILS)('rejects invalid email: %s', (email) => {
    expect(validateEmail(email)).toBe(false);
  });
});

// ── normalizePhone ────────────────────────────────────────────────────────────
describe('normalizePhone', () => {
  test.each(VALID_PHONES)('normalises valid phone: %s', (phone) => {
    const result = normalizePhone(phone);
    expect(typeof result).toBe('string');
    expect(result.replace(/\D/g, '').length).toBeGreaterThanOrEqual(10);
  });

  test.each(INVALID_PHONES)('rejects invalid phone: %s', (phone) => {
    const result = normalizePhone(phone);
    expect(result === null || result === '' || result === false).toBe(true);
  });
});

// ── Boundary conditions ───────────────────────────────────────────────────────
describe('Boundary conditions', () => {
  test('10,001 character string is safely handled', () => {
    const long = 'x'.repeat(10001);
    const result = sanitizeStr(truncateStr(long, 1000));
    expect(result.length).toBeLessThanOrEqual(1000);
  });

  test('emoji-heavy string does not cause exceptions', () => {
    const emoji = '😂🔥💯🎉🏛️⚖️'.repeat(200);
    expect(() => sanitizeStr(emoji)).not.toThrow();
  });

  test('null bytes are removed', () => {
    const nullByte = 'hello\x00world';
    const result = sanitizeStr(nullByte);
    expect(result).not.toContain('\x00');
  });

  test('RTL override character is removed', () => {
    const rtl = 'hello\u202Eworld';
    const result = sanitizeStr(rtl);
    expect(result).not.toContain('\u202E');
  });

  test('SQL keywords in input are treated as plain text', () => {
    const sql = "SELECT * FROM users WHERE id=1; DROP TABLE users;";
    const result = sanitizeStr(sql);
    // Should not throw, should return a string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
