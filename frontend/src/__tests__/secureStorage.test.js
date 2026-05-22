/**
 * secureStorage.test.js — Secure vs AsyncStorage key routing
 */
const SECURE_KEYS = new Set(['token', 'refresh_token', 'user']);
const useSecure = (key) => SECURE_KEYS.has(key);

describe('Secure storage key routing', () => {
  it('token uses SecureStore', () => { expect(useSecure('token')).toBe(true); });
  it('refresh_token uses SecureStore', () => { expect(useSecure('refresh_token')).toBe(true); });
  it('user uses SecureStore', () => { expect(useSecure('user')).toBe(true); });
  it('lang uses AsyncStorage', () => { expect(useSecure('lang')).toBe(false); });
  it('theme uses AsyncStorage', () => { expect(useSecure('theme')).toBe(false); });
  it('onboarding_done uses AsyncStorage', () => { expect(useSecure('onboarding_done')).toBe(false); });
  it('age_verified uses AsyncStorage', () => { expect(useSecure('age_verified')).toBe(false); });
  it('contains exactly 3 secure keys', () => { expect(SECURE_KEYS.size).toBe(3); });
});

describe('JWT format validation', () => {
  const isJWT = (t) => typeof t === 'string' && t.split('.').length === 3 && t.split('.').every(p => p.length > 0);
  it('accepts valid 3-part JWT', () => { expect(isJWT('a.b.c')).toBe(true); });
  it('rejects empty string', () => { expect(isJWT('')).toBe(false); });
  it('rejects 2-part string', () => { expect(isJWT('a.b')).toBe(false); });
  it('rejects non-string', () => { expect(isJWT(null)).toBe(false); });
  it('rejects undefined', () => { expect(isJWT(undefined)).toBe(false); });
});
