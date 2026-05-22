/**
 * offlineCacheService.test.js — Tests for offline cache service
 */
const {
  cacheCases, getCachedCases,
  cacheBailAgents, getCachedBailAgents,
  cacheSearch, getCachedSearch,
  isOnline,
} = require('../services/offlineCache');

describe('offlineCache service', () => {
  it('cacheCases resolves without throwing', async () => {
    await expect(cacheCases([])).resolves.not.toThrow();
  });

  it('getCachedCases returns an object with cases array', async () => {
    const result = await getCachedCases();
    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('cases');
    expect(Array.isArray(result.cases)).toBe(true);
  });

  it('cacheBailAgents resolves without throwing', async () => {
    await expect(cacheBailAgents({ agents: [] })).resolves.not.toThrow();
  });

  it('getCachedBailAgents returns object with agents array', async () => {
    const result = await getCachedBailAgents();
    expect(result).toHaveProperty('agents');
    expect(Array.isArray(result.agents)).toBe(true);
  });

  it('cacheSearch resolves without throwing', async () => {
    const empty = { cases: [], lawyers: [], messages: [], lessons: [] };
    await expect(cacheSearch('query_key', empty)).resolves.not.toThrow();
  });

  it('getCachedSearch returns null or object for unknown key', async () => {
    const result = await getCachedSearch('nonexistent_key_xyz');
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('isOnline returns a boolean', async () => {
    const online = await isOnline();
    expect(typeof online).toBe('boolean');
  });
});
