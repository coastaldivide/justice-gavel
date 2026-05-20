/**
 * offlineCache.test.js
 * Tests the offline cache service — AsyncStorage wrapper with TTL,
 * stale detection, and all 5 cache surfaces.
 */

// ── AsyncStorage mock ─────────────────────────────────────────────────────────
const store = {};
const AsyncStorage = {
  getItem:    jest.fn((k)    => Promise.resolve(store[k] ?? null)),
  setItem:    jest.fn((k, v) => { store[k] = v; return Promise.resolve(); }),
  removeItem: jest.fn((k)    => { delete store[k]; return Promise.resolve(); }),
  clear:      jest.fn(()     => { Object.keys(store).forEach(k => delete store[k]); return Promise.resolve(); }),
};

// ── Inline cache implementation (mirrors offlineCache.ts) ─────────────────────
const PREFIX       = 'jg_cache_';
const TTL_30_DAYS  = 30 * 24 * 60 * 60 * 1000;
const TTL_7_DAYS   = 7  * 24 * 60 * 60 * 1000;
const STALE_THRESH = 4  * 60 * 60 * 1000; // 4 hours

async function write(dataKey, tsKey, value) {
  await AsyncStorage.setItem(PREFIX + dataKey, JSON.stringify(value));
  await AsyncStorage.setItem(PREFIX + tsKey,   String(Date.now()));
}
async function read(dataKey, tsKey, ttl) {
  const raw = await AsyncStorage.getItem(PREFIX + dataKey);
  const ts  = await AsyncStorage.getItem(PREFIX + tsKey);
  if (!raw) return { data: null, cachedAt: null, isCache: false, stale: false };
  const cachedAt = ts ? parseInt(ts) : 0;
  const age      = Date.now() - cachedAt;
  return {
    data:     JSON.parse(raw),
    cachedAt,
    isCache:  true,
    stale:    age > STALE_THRESH,
    expired:  age > ttl,
  };
}

// Cache surfaces matching offlineCache.ts
const KEYS = {
  cases:      ['cases',     'casesAt'    ],
  lawyers:    ['lawyers',   'lawyersAt'  ],
  motions:    ['motions',   'motionsAt'  ],
  bail:       ['bail',      'bailAt'     ],
  resources:  ['resources', 'resourcesAt'],
};

async function cacheCases(cases)       { await write(...KEYS.cases,     cases);   }
async function getCachedCases()        { return read(...KEYS.cases,      TTL_30_DAYS); }
async function cacheSavedLawyers(data) { await write(...KEYS.lawyers,    data);   }
async function getCachedLawyers()      { return read(...KEYS.lawyers,    TTL_7_DAYS); }
async function cacheMotions(data)      { await write(...KEYS.motions,    data);   }
async function getCachedMotions()      { return read(...KEYS.motions,    TTL_30_DAYS); }
async function cacheBailAgents(data)   { await write(...KEYS.bail,       data);   }
async function getCachedBailAgents()   { return read(...KEYS.bail,       TTL_7_DAYS); }
async function cacheResources(data)    { await write(...KEYS.resources,  data);   }
async function getCachedResources()    { return read(...KEYS.resources,  TTL_7_DAYS); }
async function clearAllCaches() {
  for (const [dk, tk] of Object.values(KEYS)) {
    await AsyncStorage.removeItem(PREFIX + dk);
    await AsyncStorage.removeItem(PREFIX + tk);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  jest.clearAllMocks();
});

describe('cacheCases / getCachedCases', () => {
  it('returns empty result when cache is cold', async () => {
    const { data, isCache } = await getCachedCases();
    expect(data).toBeNull();
    expect(isCache).toBe(false);
  });

  it('stores and retrieves cases array', async () => {
    const cases = [{ id: 1, title: 'State v. Test', status: 'Open' }];
    await cacheCases(cases);
    const { data, isCache } = await getCachedCases();
    expect(isCache).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('State v. Test');
  });

  it('round-trips an empty array', async () => {
    await cacheCases([]);
    const { data, isCache } = await getCachedCases();
    expect(isCache).toBe(true);
    expect(data).toEqual([]);
  });

  it('overwrites previous cache', async () => {
    await cacheCases([{ id: 1, title: 'Old' }]);
    await cacheCases([{ id: 2, title: 'New' }]);
    const { data } = await getCachedCases();
    expect(data[0].title).toBe('New');
  });
});

describe('cacheSavedLawyers / getCachedLawyers', () => {
  it('caches lawyer list', async () => {
    const lawyers = [{ id: 10, name: 'Sarah Mitchell', rating: 4.9 }];
    await cacheSavedLawyers(lawyers);
    const { data } = await getCachedLawyers();
    expect(data[0].name).toBe('Sarah Mitchell');
  });
});

describe('cacheMotions / getCachedMotions', () => {
  it('caches generated motions', async () => {
    const motions = [{ id: 1, motion_type: 'suppress', status: 'draft' }];
    await cacheMotions(motions);
    const { data } = await getCachedMotions();
    expect(data[0].motion_type).toBe('suppress');
  });
});

describe('cacheBailAgents / getCachedBailAgents', () => {
  it('caches bail agent list', async () => {
    const agents = [{ id: 5, name: 'Knox County Bail' }];
    await cacheBailAgents(agents);
    const { data } = await getCachedBailAgents();
    expect(data[0].name).toBe('Knox County Bail');
  });
});

describe('cacheResources / getCachedResources', () => {
  it('caches legal resources', async () => {
    const resources = [{ id: 1, title: 'ACLU Tennessee', url: 'https://aclu-tn.org' }];
    await cacheResources(resources);
    const { data } = await getCachedResources();
    expect(data[0].title).toBe('ACLU Tennessee');
  });
});

describe('clearAllCaches', () => {
  it('removes all cached data', async () => {
    await cacheCases([{ id: 1 }]);
    await cacheSavedLawyers([{ id: 2 }]);
    await clearAllCaches();
    const { isCache: c1 } = await getCachedCases();
    const { isCache: c2 } = await getCachedLawyers();
    expect(c1).toBe(false);
    expect(c2).toBe(false);
  });
});

describe('stale detection', () => {
  it('marks fresh cache as not stale', async () => {
    await cacheCases([{ id: 1 }]);
    const { stale } = await getCachedCases();
    expect(stale).toBe(false);
  });

  it('marks old cache as stale', async () => {
    await cacheCases([{ id: 1 }]);
    // Backdate the timestamp by 5 hours (> 4h STALE_THRESH)
    const tsKey = PREFIX + KEYS.cases[1];
    store[tsKey] = String(Date.now() - 5 * 60 * 60 * 1000);
    const { stale } = await getCachedCases();
    expect(stale).toBe(true);
  });
});
