/**
 * utils/storage.ts — MMKV storage wrapper
 *
 * Replaces AsyncStorage for all auth tokens and cached data.
 * MMKV is 30× faster, synchronous where needed, and runs off the JS thread.
 *
 * AsyncStorage replacement: swap import, same API.
 * For legacy code: mmkvStorage is an AsyncStorage-compatible adapter.
 */

import { MMKV } from 'react-native-mmkv';

// ── Primary storage instance ──────────────────────────────────────────────
export const storage = new MMKV({ id: 'justice-gavel-storage' });

// ── Typed key-value helpers ───────────────────────────────────────────────
export const Storage = {
  // Auth
  getAccessToken:   ()        => storage.getString('auth.access_token') ?? null,
  setAccessToken:   (t: string) => storage.set('auth.access_token', t),
  getRefreshToken:  ()        => storage.getString('auth.refresh_token') ?? null,
  setRefreshToken:  (t: string) => storage.set('auth.refresh_token', t),
  clearAuth:        ()        => {
    storage.delete('auth.access_token');
    storage.delete('auth.refresh_token');
    storage.delete('auth.user');
  },

  // User profile
  getUser: () => {
    const raw = storage.getString('auth.user');
    return raw ? JSON.parse(raw) : null;
  },
  setUser: (user: object) => storage.set('auth.user', JSON.stringify(user)),

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
    const entry = JSON.parse(raw);
    if (Date.now() > entry.expires) { storage.delete('cache.' + key); return null; }
    return entry.data as T;
  },
  clearCache: () => {
    const keys = storage.getAllKeys().filter(k => k.startsWith('cache.'));
    keys.forEach(k => storage.delete(k));
  },
};

// ── AsyncStorage-compatible adapter for legacy code ───────────────────────
export const mmkvStorage = {
  getItem:    (key: string) => Promise.resolve(storage.getString(key) ?? null),
  setItem:    (key: string, value: string) => { storage.set(key, value); return Promise.resolve(); },
  removeItem: (key: string) => { storage.delete(key); return Promise.resolve(); },
};

export default Storage;
