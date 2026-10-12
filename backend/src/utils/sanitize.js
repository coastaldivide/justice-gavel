/**
 * utils/sanitize.js — Input sanitization and validation utilities
 * Used by validation middleware and route handlers.
 */

/**
 * Normalise user-supplied text for STORAGE: trim, and drop characters that are
 * never legitimate in user text (NUL, RTL override, zero-width space, U+2028/9).
 *
 * It deliberately does NOT HTML-encode. User text is stored exactly as typed
 * and rendered natively by React Native (which never interprets HTML). HTML is
 * escaped at the few places that generate HTML — emails, printable web pages —
 * with escapeHtml() below. Encoding on input corrupted every name, note and
 * message ("I don&#x27;t …") and double-encoded anything later escaped again.
 */
export function sanitizeStr(input) {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str
    .trim()
    .replaceAll('\0', '')           // null bytes
    .replace(/\u202E/g, '')          // RTL override
    .replace(/\u200B/g, '')          // zero-width space
    .replace(/\u2028|\u2029/g, '');  // line/paragraph separators
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/**
 * Escape text for interpolation into HTML (element content or a quoted
 * attribute value). Use at OUTPUT time, only where HTML is generated.
 * null/undefined → ''.
 */
export function escapeHtml(input) {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[&<>"'`]/g, c => HTML_ESCAPES[c]);
}

// Entities the old input sanitisers produced (utils/sanitize.sanitizeStr and the
// feedback route's local sanitiser). Used only by the one-off data repair script.
const LEGACY_ENTITY_DECODE = {
  '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'",
  '&#x60;': '`', '&#96;': '`', '&#x2F;': '/', '&#47;': '/',
};

/**
 * Decode the HTML entities that the legacy input sanitisers wrote into stored
 * user text. Repeats until stable so double-encoded values (&amp;quot;) are
 * fully restored. `&amp;` is only decoded when `decodeAmp` is true (the
 * feedback sanitiser encoded '&'; utils/sanitize never did, so a literal
 * "&amp;" a user typed elsewhere is left alone) or when it prefixes one of the
 * legacy entities (i.e. it is itself an artefact of double encoding).
 * Returns the input unchanged when it is not a string.
 */
export function decodeLegacyEntities(input, { decodeAmp = false } = {}) {
  if (typeof input !== 'string' || !input.includes('&')) return input;
  let prev;
  let out = input;
  for (let i = 0; i < 5 && out !== prev; i++) {
    prev = out;
    out = out.replace(/&amp;(?=(?:lt|gt|quot|amp|#x27|#39|#x60|#96|#x2F|#47);)/g, '&');
    out = out.replace(/&(?:lt|gt|quot|#x27|#39|#x60|#96|#x2F|#47);/g, m => LEGACY_ENTITY_DECODE[m]);
    if (decodeAmp) out = out.replace(/&amp;/g, '&');
  }
  return out;
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
