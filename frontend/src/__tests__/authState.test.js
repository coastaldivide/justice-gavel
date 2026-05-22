/**
 * authState.test.js — Tests for auth state management
 */
const auth = require('../services/auth');

describe('auth state management', () => {
  it('exports setAppAuth function', () => {
    expect(typeof auth.setAppAuth).toBe('function');
  });

  it('setAppAuth accepts role strings without throwing', () => {
    expect(() => auth.setAppAuth('consumer')).not.toThrow();
    expect(() => auth.setAppAuth('attorney')).not.toThrow();
    expect(() => auth.setAppAuth('bondsman')).not.toThrow();
    expect(() => auth.setAppAuth('guest')).not.toThrow();
  });

  it('registerAuthSetter is a function', () => {
    expect(typeof auth.registerAuthSetter).toBe('function');
  });

  it('registerAuthSetter accepts a callback', () => {
    const cb = jest.fn();
    expect(() => auth.registerAuthSetter(cb)).not.toThrow();
  });

  it('setAppAuth calls registered setter', () => {
    const cb = jest.fn();
    auth.registerAuthSetter(cb);
    auth.setAppAuth('attorney');
    expect(cb).toHaveBeenCalledWith('attorney');
  });
});
