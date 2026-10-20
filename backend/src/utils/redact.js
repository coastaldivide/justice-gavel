/**
 * redact.js — scrub secrets and personal data before anything leaves the
 * process as a log line, an error report (Sentry) or an alert (e-mail/webhook).
 *
 *   redact(value)        deep copy with sensitive KEYS replaced and every
 *                        string scrubbed (cycles and depth are bounded)
 *   redactString(text)   scrubs secrets / e-mail addresses / phone numbers
 *                        that appear inside free text (error messages, SQL
 *                        errors, interpolated log lines)
 *   stripQuery(url)      a URL without its query string (search params carry
 *                        names, e-mails, counties)
 *
 * Masking keeps just enough to correlate (e-mail domain, last 2 phone digits)
 * without identifying anyone.
 */

export const REDACTED = '[REDACTED]';

// Keys whose VALUE is a secret or credential — always replaced outright.
// Matched on the END of the key so counters such as input_tokens / token_count
// stay readable, while password, refreshToken, x-api-key, client_secret… do not.
const SECRET_KEY = /(token|secret|password|passwd|passphrase|api[_-]?key|authorization|cookie|signature|ssn|social[_-]?security(_number)?|cvv|cvc|otp|jwt|private[_-]?key|card[_-]?number|admin[_-]?key|credentials?)$/i;
// Keys whose value is personal data — replaced outright.
const PII_KEY = /^(email|e_mail|to|from|recipient|recipients|phone|phone_number|mobile|sms_to|contact_phone|contact_email|defendant_phone|defendant_email|signer_email|customer_email|address|street|street_address|dob|date_of_birth|birth_date|ip|ip_address|lat|lng|latitude|longitude|location_lat|location_lng)$/i;
// Keys whose value is a person's own words about their case — replaced outright.
const PRIVATE_TEXT_KEY = /^(notes?|case_notes|private_notes|outcome_notes|narrative|transcript|transcription|description|message_body|ai_intake_context|charges?)$/i;

const PATTERNS = [
  // Bearer / Basic credentials
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ' + REDACTED],
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, REDACTED],
  // Provider API keys (Anthropic, OpenAI, Stripe, Resend, Google, GitHub, Slack)
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bre_[A-Za-z0-9]{16,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  // Expo push tokens identify a device
  [/ExponentPushToken\[[^\]]+\]/g, 'ExponentPushToken[' + REDACTED + ']'],
  // key=value / "key": "value" pairs for secret-looking keys inside text
  [/\b(password|passwd|secret|token|api[_-]?key|refresh[_-]?token|access[_-]?token)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi, '$1$2' + REDACTED],
  // Postgres quotes the value it rejected (it can be anything the person typed)
  [/(invalid input syntax for type [\w ]+|invalid input value for enum \w+|is out of range for type \w+|value too long for type [\w ()]+)(: )?"[^"]*"/gi, '$1$2"' + REDACTED + '"'],
  [/\bvalue "[^"]*" is out of range/gi, 'value "' + REDACTED + '" is out of range'],
  [/\bKey \(([^)]+)\)=\([^)]*\)/g, 'Key ($1)=(' + REDACTED + ')'],
  // e-mail addresses → "***@domain"
  [/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '***@$1'],
  // phone numbers written with separators or a leading +: +1 (615) 555-0100, 615-555-0100, +16155550100
  [/(?<![\w/.-])\+?1?[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w/-])/g, '[phone]'],
  [/(?<![\w/.-])\+\d{10,15}(?![\w/-])/g, '[phone]'],
];

// Longest string kept in a log line / report. Error messages can echo request
// input (Postgres quotes the bad value), so a 1 MB body must not become a 1 MB
// log line.
export const MAX_STRING = 2000;

export function redactString(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…[+${text.length - MAX_STRING} chars]` : text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function stripQuery(url) {
  return typeof url === 'string' ? url.split('?')[0] : url;
}

export function redact(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (depth > 6) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    return { message: redactString(value.message), ...(value.code ? { code: value.code } : {}) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1, seen));
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k) || PII_KEY.test(k) || PRIVATE_TEXT_KEY.test(k)) out[k] = v == null || v === '' ? v : REDACTED;
    else out[k] = redact(v, depth + 1, seen);
  }
  return out;
}
