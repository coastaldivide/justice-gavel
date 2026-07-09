/**
 * utils/sanitize.js — Input sanitization and validation utilities
 * Used by validation middleware and route handlers.
 */

/**
 * Sanitize a string: trim whitespace, remove null bytes, RTL overrides,
 * and neutralise basic XSS vectors by escaping HTML special characters.
 */
export function sanitizeStr(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str
    .trim()
    .replace(/\x00/g, '')           // null bytes
    .replace(/\u202E/g, '')          // RTL override
    .replace(/\u200B/g, '')          // zero-width space
    .replace(/\u2028|\u2029/g, '')   // line/paragraph separators
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/`/g, '&#x60;');
}

/**
 * Truncate a string to maxLen characters.
 */
export function truncateStr(input, maxLen) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

/**
 * Validate an email address.
 * Returns true if valid, false otherwise.
 */
export function validateEmail(input) {
  if (!input || typeof input !== 'string') return false;
  if (input.length > 254) return false;
  if (input.includes(' ')) return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(input)) return false;
  const parts = input.split('@');
  if (parts[0].length === 0) return false;
  const domainParts = parts[1].split('.');
  if (domainParts.some(p => p.length === 0)) return false;
  return true;
}

/**
 * Normalise a phone number to digits only (or null if invalid).
 */
export function normalizePhone(input) {
  if (!input || typeof input !== 'string') return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/**
 * Strip all HTML tags from a string (for plain text contexts).
 */
export function sanitizeHtml(input) {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').trim();
}
