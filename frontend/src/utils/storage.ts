/**
 * utils/storage.ts — small key/value store with a synchronous read API.
 *
 * Previously backed by react-native-mmkv, which requires a custom dev build
 * and does not work in Expo Go or on web. This implementation keeps the same
 * synchronous surface (getString / set / delete / getBoolean / getNumber /
 * getAllKeys) using an in-memory cache that is written through to
 * AsyncStorage (localStorage on web) and hydrated at startup.
 *
 * Callers that must see persisted values on first render should
 * `await storageReady` before reading.
 *
 * NOTE: never store auth tokens here — use utils/secureStorage.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'jg_kv.';
const cache = new Map<string, string>();

async function hydrate(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX));
    if (keys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) {
      const key = k.slice(PREFIX.length);
      // Do not clobber values written before hydration finished
      if (v != null && !cache.has(key)) cache.set(key, v);
    }
  } catch {
    // Storage unavailable (private mode, tests) — keep in-memory only.
  }
}

/** Resolves once persisted values have been loaded into memory. */
export const storageReady: Promise<void> = hydrate();

function persist(key: string, value: string | null): void {
  const op = value == null
    ? AsyncStorage.removeItem(PREFIX + key)
    : AsyncStorage.setItem(PREFIX + key, value);
  op.catch(() => { /* best effort */ });
}

export const storage = {
  getString: (key: string): string | undefined => cache.get(key),
  getBoolean: (key: string): boolean | undefined => {
    const v = cache.get(key);
    return v === undefined ? undefined : v === 'true';
  },
  getNumber: (key: string): number | undefined => {
    const v = cache.get(key);
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  },
  set: (key: string, value: string | number | boolean): void => {
    const s = String(value);
    cache.set(key, s);
    persist(key, s);
  },
  delete: (key: string): void => {
    cache.delete(key);
    persist(key, null);
  },
  getAllKeys: (): string[] => Array.from(cache.keys()),
};

// ── Typed key-value helpers (non-sensitive data only) ─────────────────────
export const Storage = {
  // Preferences
  getLang:       ()        => storage.getString('pref.lang') ?? 'en',
  setLang:       (l: string) => storage.set('pref.lang', l),
  getOnboarded:  ()        => storage.getBoolean('pref.onboarded') ?? false,
  setOnboarded:  (v: boolean) => storage.set('pref.onboarded', v),
  getTier:       ()        => storage.getString('pref.tier') ?? 'free',
  setTier:       (t: string) => storage.set('pref.tier', t),
  getGavelPts:   ()        => storage.getNumber('gavel.points') ?? 0,
  setGavelPts:   (n: number) => storage.set('gavel.points', n),

  // Response cache (short-lived)
  setCache: (key: string, value: unknown, ttlMs = 300_000) => {
    const entry = { data: value, expires: Date.now() + ttlMs };
    storage.set('cache.' + key, JSON.stringify(entry));
  },
  getCache: <T>(key: string): T | null => {
    const raw = storage.getString('cache.' + key);
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw);
      if (Date.now() > entry.expires) { storage.delete('cache.' + key); return null; }
      return entry.data as T;
    } catch {
      storage.delete('cache.' + key);
      return null;
    }
  },
  clearCache: () => {
    storage.getAllKeys().filter(k => k.startsWith('cache.')).forEach(k => storage.delete(k));
  },
};

export default Storage;
