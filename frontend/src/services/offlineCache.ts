/**
 * offlineCache.ts — Offline-first caching for Justice Gavel
 *
 * Expanded cache layer covering the five highest-value offline surfaces:
 *   1. Saved lawyers        — attorney contact list
 *   2. Lessons              — legal education content
 *   3. Cases (30 days)      — active case list + details
 *   4. Generated motions    — AI-drafted motions already paid for
 *   5. Expungement state    — user's state eligibility result
 *
 * Pattern: write-through on every successful API response,
 *          read-through on network failure.
 *
 * All cache reads/writes are wrapped in try/catch — cache failure
 * is always silent. The app never crashes because the cache failed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo      from '@react-native-community/netinfo';

// ── TTL constants ─────────────────────────────────────────────────────────────
const TTL_30_DAYS  = 30 * 24 * 60 * 60 * 1000;
const TTL_7_DAYS   =  7 * 24 * 60 * 60 * 1000;
const TTL_24_HOURS =      24 * 60 * 60 * 1000;

// ── Cache keys ────────────────────────────────────────────────────────────────
export const CACHE_KEYS = {
  // Lawyers
  savedLawyers:      'cache_saved_lawyers',
  savedLawyersAt:    'cache_saved_lawyers_at',
  // Lessons
  lessons:           'cache_lessons',
  lessonsAt:         'cache_lessons_at',
  // Cases
  cases:             'cache_cases',
  casesAt:           'cache_cases_at',
  // Motions (array — last 30 generated)
  motions:           'cache_motions',
  motionsAt:         'cache_motions_at',
  // Expungement — keyed by state
  expungementPrefix: 'cache_expunge_',
  bailAgents:        'cache_bail_agents',
  bailAgentsAt:      'cache_bail_agents_at',
  resources:         'cache_resources',
  resourcesAt:       'cache_resources_at',
  // Offline status shown to user
  lastOnlineAt:      'cache_last_online_at',
};

// ── Connectivity ──────────────────────────────────────────────────────────────
export async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return !!(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return true;
  }
}

export async function markOnline() {
  try {
    await AsyncStorage.setItem(CACHE_KEYS.lastOnlineAt, new Date().toISOString());
  } catch {}
}

export async function getLastOnlineAt(): Promise<string | null> {
  try { return await AsyncStorage.getItem(CACHE_KEYS.lastOnlineAt); }
  catch { return null; }
}

// ── Generic read/write helpers ────────────────────────────────────────────────
async function write(key: string, data: unknown, timestampKey: string) {
  try {
    await AsyncStorage.multiSet([
      [key,          JSON.stringify(data)],
      [timestampKey, new Date().toISOString()],
    ]);
  } catch {}
}

async function read<T>(
  key: string,
  timestampKey: string,
  maxAge: number
): Promise<{ data: T | null; cachedAt: string | null; stale: boolean; isCache: boolean }> {
  try {
    const [[, raw], [, at]] = await AsyncStorage.multiGet([key, timestampKey]);
    if (!raw) return { data: null, cachedAt: null, stale: false, isCache: false };
    const age   = at ? Date.now() - new Date(at).getTime() : Infinity;
    const stale = age > maxAge;
    return { data: JSON.parse(raw) as T, cachedAt: at, stale, isCache: true };
  } catch {
    return { data: null, cachedAt: null, stale: false, isCache: false };
  }
}

// ── Saved lawyers ─────────────────────────────────────────────────────────────
export async function cacheSavedLawyers(lawyers: unknown[]) {
  await write(CACHE_KEYS.savedLawyers, lawyers, CACHE_KEYS.savedLawyersAt);
}
export async function getCachedLawyers() {
  const r = await read<any[]>(CACHE_KEYS.savedLawyers, CACHE_KEYS.savedLawyersAt, TTL_7_DAYS);
  return { lawyers: r.data ?? [], cachedAt: r.cachedAt, isCache: r.isCache, stale: r.stale };
}

// ── Lessons ───────────────────────────────────────────────────────────────────
export async function cacheLessons(lessons: unknown[]) {
  await write(CACHE_KEYS.lessons, lessons, CACHE_KEYS.lessonsAt);
}
export async function getCachedLessons() {
  const r = await read<any[]>(CACHE_KEYS.lessons, CACHE_KEYS.lessonsAt, TTL_7_DAYS);
  return { lessons: r.data ?? [], cachedAt: r.cachedAt, isCache: r.isCache };
}

// ── Cases (last 30 days) ──────────────────────────────────────────────────────
export async function cacheCases(cases: unknown[]) {
  // Only cache cases from the last 30 days to bound storage size
  const cutoff = Date.now() - TTL_30_DAYS;
  const recent = cases.filter(c => {
    const d = (c as any).next_court_date || (c as any).created_at;
    return !d || new Date(d).getTime() > cutoff;
  });
  await write(CACHE_KEYS.cases, recent, CACHE_KEYS.casesAt);
}
export async function getCachedCases() {
  const r = await read<any[]>(CACHE_KEYS.cases, CACHE_KEYS.casesAt, TTL_30_DAYS);
  return { cases: r.data ?? [], cachedAt: r.cachedAt, isCache: r.isCache, stale: r.stale };
}

// ── Generated motions (last 30) ───────────────────────────────────────────────
export async function cacheMotions(motions: unknown[]) {
  const latest = motions.slice(0, 30); // cap at 30 most recent
  await write(CACHE_KEYS.motions, latest, CACHE_KEYS.motionsAt);
}
export async function getCachedMotions() {
  const r = await read<any[]>(CACHE_KEYS.motions, CACHE_KEYS.motionsAt, TTL_30_DAYS);
  return { motions: r.data ?? [], cachedAt: r.cachedAt, isCache: r.isCache };
}
export async function addMotionToCache(motion: unknown) {
  try {
    const { motions } = await getCachedMotions();
    // Prepend new motion, dedupe by id, keep last 30
    const updated = [(motion as any), ...motions.filter((m: any) => m.id !== (motion as any).id)].slice(0, 30);
    await cacheMotions(updated);
  } catch {}
}

// ── Expungement results (per state) ──────────────────────────────────────────
export async function cacheExpungement(state: string, result: unknown) {
  if (!state) return;
  await write(
    CACHE_KEYS.expungementPrefix + state,
    result,
    CACHE_KEYS.expungementPrefix + state + '_at'
  );
}
export async function getCachedExpungement(state: string) {
  if (!state) return { data: null, isCache: false };
  const r = await read<Record<string, unknown>>(
    CACHE_KEYS.expungementPrefix + state,
    CACHE_KEYS.expungementPrefix + state + '_at',
    TTL_7_DAYS
  );
  return { data: r.data, cachedAt: r.cachedAt, isCache: r.isCache, stale: r.stale };
}

// ── Format cache age for display ─────────────────────────────────────────────
export function cacheAgeLabel(cachedAt: string | null): string {
  if (!cachedAt) return 'Never synced';
  const diff = Date.now() - new Date(cachedAt).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2)  return 'Just synced';
  if (mins < 60) return `Synced ${mins}m ago`;
  if (hrs  < 24) return `Synced ${hrs}h ago`;
  return `Synced ${days}d ago`;
}

// ── Clear all caches (on logout) ──────────────────────────────────────────────
export async function clearAllCaches() {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(k => k.startsWith('cache_'));
    if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys);
  } catch {}
}

// ── Bail agent cache (7-day TTL) ─────────────────────────────────────────────
export async function cacheBailAgents(agents: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEYS.bailAgents,   JSON.stringify(agents));
    await AsyncStorage.setItem(CACHE_KEYS.bailAgentsAt, String(Date.now()));
  } catch {}
}

export async function getCachedBailAgents(): Promise<{ agents: unknown[]; age: string }> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEYS.bailAgents);
    const at  = await AsyncStorage.getItem(CACHE_KEYS.bailAgentsAt);
    const agents = raw ? JSON.parse(raw) : [];
    const age = at ? cacheAgeLabel(String(Number(at))) : '';
    if (agents.length && at && Date.now() - Number(at) > TTL_7_DAYS) return { agents: [], age: '' };
    return { agents, age };
  } catch { return { agents: [], age: '' }; }
}

// ── Resources cache (1-day TTL) ───────────────────────────────────────────────
export async function cacheResources(items: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEYS.resources,   JSON.stringify(items));
    await AsyncStorage.setItem(CACHE_KEYS.resourcesAt, String(Date.now()));
  } catch {}
}

export async function getCachedResources(): Promise<any[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEYS.resources);
    const at  = await AsyncStorage.getItem(CACHE_KEYS.resourcesAt);
    if (!raw || !at || Date.now() - Number(at) > TTL_24_HOURS) return [];
    return JSON.parse(raw);
  } catch { return []; }
}


// ── Case timeline cache ───────────────────────────────────────────────────────
const TIMELINE_TTL = 1 * 60 * 60 * 1000; // 1 hour

export async function cacheTimeline(caseId: number, events: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `jg_timeline_${caseId}`,
      JSON.stringify({ data: events, ts: Date.now() })
    );
  } catch {}
}

export async function getCachedTimeline(
  caseId: number
): Promise<{ data: unknown[]; ts: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(`jg_timeline_${caseId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > TIMELINE_TTL) return null;
    return parsed;
  } catch { return null; }
}

// ── Search results cache (last query only) ───────────────────────────────────
const SEARCH_TTL = 5 * 60 * 1000; // 5 minutes

export async function cacheSearch(
  query: string, results: unknown
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      'jg_last_search',
      JSON.stringify({ query, results, ts: Date.now() })
    );
  } catch {}
}

export async function getCachedSearch(): Promise<{
  query: string; results: unknown; ts: number;
} | null> {
  try {
    const raw = await AsyncStorage.getItem('jg_last_search');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > SEARCH_TTL) return null;
    return parsed;
  } catch { return null; }
}

// ── Recent searches history (last 5 unique queries) ──────────────────────────
export async function saveRecentSearch(query: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('jg_recent_searches');
    const history: string[] = raw ? JSON.parse(raw) : [];
    const deduped = [query, ...history.filter(q => q !== query)].slice(0, 5);
    await AsyncStorage.setItem('jg_recent_searches', JSON.stringify(deduped));
  } catch {}
}

export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem('jg_recent_searches');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem('jg_recent_searches');
  } catch {}
}
