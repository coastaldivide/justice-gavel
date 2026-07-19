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
  if (!input && input !== 0) return null;
  const str    = String(input);
  const digits = str.replace(/\D/g, '');
  if (digits.length === 0) return null;
  // E.164: 10-digit US number → +1XXXXXXXXXX, 11-digit with leading 1 → +1XXXXXXXXXX
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  // International: 7–15 digits
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Strip all HTML tags from a string (for plain text contexts).
 */
export function sanitizeHtml(input) {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * parseIntent — lightweight keyword-to-intent classifier for outbound bot
 * and recovery agent scripts. Returns the most likely user intent string.
 */
export function parseIntent(text) {
  if (!text) return 'unknown';
  const t = String(text).toLowerCase().trim();
  // TCPA compliance: stop words MUST return 'stop' (never mis-classify)
  if (/^(stop|stopall|stopalerts|cancel|unsubscribe|quit|end|optout|opt-out|opt out|remove|delete|revoke)$/.test(t)) return 'stop';
  if (/^(help|info|information)$/.test(t)) return 'help';
  if (/^(start|yes|subscribe|optin|opt-in)$/.test(t)) return 'start';
  // Content intents
  if (/bail|bond|release|jailed|arrested|locked/.test(t)) return 'bail';
  if (/lawyer|attorney|legal|defense|represent/.test(t)) return 'legal_help';
  if (/expunge|record|clean|seal/.test(t)) return 'expungement';
  if (/right|miranda|silent|refuse/.test(t)) return 'rights';
  if (/court|date|hearing|appearance/.test(t)) return 'court';
  if (/family|contact|notify|call/.test(t)) return 'family';
  return 'general';
}
