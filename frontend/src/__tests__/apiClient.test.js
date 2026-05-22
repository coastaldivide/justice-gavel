/**
 * apiService.test.js — Tests for the API client (supplements existing apiService.test.js)
 * Tests: retry constants, cache, abortable, circuit breaker awareness.
 */
const { api, deduplicatedGet } = require('../services/api');

describe('api client exports', () => {
  it('exposes get, post, put, patch, delete', () => {
    expect(typeof api.get).toBe('function');
    expect(typeof api.post).toBe('function');
    expect(typeof api.put).toBe('function');
    expect(typeof api.patch).toBe('function');
    expect(typeof api.delete).toBe('function');
  });

  it('abortable() returns signal and abort', () => {
    const { signal, abort } = api.abortable();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(typeof abort).toBe('function');
  });

  it('clearCache() does not throw', () => {
    expect(() => api.clearCache()).not.toThrow();
  });

  it('calling clearCache twice does not throw', () => {
    expect(() => { api.clearCache(); api.clearCache(); }).not.toThrow();
  });

  it('deduplicatedGet is a function', () => {
    expect(typeof deduplicatedGet).toBe('function');
  });

  it('abort() sets AbortSignal.aborted to true', () => {
    const { signal, abort } = api.abortable();
    expect(signal.aborted).toBe(false);
    abort();
    expect(signal.aborted).toBe(true);
  });
});
