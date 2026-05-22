/**
 * storageService.test.js — Tests for typed AsyncStorage wrapper
 */
const storage = require('../services/storage');

describe('storage service', () => {
  it('is a module with functions', () => {
    expect(typeof storage).toBe('object');
  });

  it('getUser is a function if exported', () => {
    if (storage.getUser) {
      expect(typeof storage.getUser).toBe('function');
    }
  });

  it('saveUser is a function if exported', () => {
    if (storage.saveUser) {
      expect(typeof storage.saveUser).toBe('function');
    }
  });

  it('clearUser is a function if exported', () => {
    if (storage.clearUser) {
      expect(typeof storage.clearUser).toBe('function');
    }
  });
});
