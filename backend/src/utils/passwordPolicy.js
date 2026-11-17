/**
 * passwordPolicy.js — one rule for every place a password is chosen
 * (sign-up, password reset, change password). Sandbox review 2026-11-12, bug 3.
 *
 * The old Quick Sign Up sent a 4-digit PIN twice ("12341234"): 8 characters,
 * but only 10,000 possible values. Such passwords, and the handful of
 * passwords attackers try first, are refused.
 *
 * passwordProblem(pw) → null when acceptable, else a reason code:
 *   'short'  fewer than 8 characters
 *   'long'   more than 72 bytes in UTF-8 (sandbox review 2026-11-17, finding 9): bcrypt
 *            only uses the first 72 bytes, so anything after them was silently ignored
 *            (two long passwords that start alike were the same password). 72 bytes is
 *            72 plain letters, digits and symbols; accented letters and emoji take 2–4.
 *   'weak'   a doubled 4-digit PIN, one repeated character, a simple digit run,
 *            or a very common password
 *
 * Changing a password to the one already in use is refused in routes/auth.js
 * (change-password: 'password_same').
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

/** The pattern the old Quick Sign Up produced: a 4-digit PIN typed twice. */
export const DOUBLED_PIN = /^(\d{4})\1$/;

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'iloveyou', 'abc12345', 'abcd1234',
  'letmein1', 'welcome1', 'sunshine', 'princess', 'football', 'baseball', 'dragon123',
  'monkey123', 'trustno1', 'superman', 'whatever', 'justicegavel',
]);

const isDigitRun = (s) => {
  if (!/^\d+$/.test(s)) return false;
  const up = '01234567890123456789', down = '98765432109876543210';
  return up.includes(s) || down.includes(s);
};

export function passwordProblem(password) {
  const pw = String(password ?? '');
  if (pw.length < MIN_PASSWORD_LENGTH) return 'short';
  if (Buffer.byteLength(pw, 'utf8') > MAX_PASSWORD_BYTES) return 'long';
  const lower = pw.toLowerCase();
  if (DOUBLED_PIN.test(pw)) return 'weak';
  if (/^(.)\1+$/.test(pw)) return 'weak';
  if (isDigitRun(pw)) return 'weak';
  if (COMMON.has(lower)) return 'weak';
  return null;
}

/** i18n key for a reason code (backend messages: auth.err.*). */
export const passwordProblemKey = (code) => (
  code === 'short' ? 'auth.err.password_short' : code === 'long' ? 'auth.err.password_long' : 'auth.err.password_weak');
