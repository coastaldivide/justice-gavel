/**
 * identifier.ts — the sign-up / sign-in identifier rules the server applies
 * (routes/auth.js normalizeIdentifier): an e-mail address, or a phone number
 * of 7–15 digits.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

/** Email, or a phone number of 7–15 digits (same rule as the server). */
export function isValidIdentifier(v: string): boolean {
  const s = v.trim();
  if (s.includes('@')) return isEmail(s);
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && !/[a-z]/i.test(s);
}
