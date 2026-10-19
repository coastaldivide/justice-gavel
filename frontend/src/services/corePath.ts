/**
 * corePath.ts — the "Just arrested?" path: 1) Know your rights · 2) Find a
 * lawyer and a bail agent · 3) Never miss a court date.
 *
 *  - Progress (current step + steps done) is kept on the device so a scared,
 *    interrupted person lands back where they were ("Step 2 of 3").
 *  - A route can be queued before the main tabs exist (first screen after
 *    install → browse mode → open the path) and is consumed by HomeScreen.
 *  - Offline copies: the rights card per state (+ the general card), the
 *    court dates list and the cases this user follows. Court-date copies hold
 *    dates / places only — there are no case notes in them.
 * Every storage call is wrapped: a storage failure never breaks a screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

export type CoreStep = 1 | 2 | 3;
export interface CoreProgress { current: CoreStep; done: { rights: boolean; help: boolean; court: boolean }; updatedAt: string | null }

const PROGRESS_KEY = 'core_path_progress';
const PENDING_KEY = 'core_path_pending_route';
const RIGHTS_PREFIX = 'cache_rights_v1_';
const COURT_KEY = 'cache_court_dates_v1';
const FOLLOWING_KEY = 'cache_following_v1';

const DEFAULT: CoreProgress = { current: 1, done: { rights: false, help: false, court: false }, updatedAt: null };

export async function getCoreProgress(): Promise<CoreProgress> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    if (!raw) return { ...DEFAULT, done: { ...DEFAULT.done } };
    const p = JSON.parse(raw) as Partial<CoreProgress>;
    const cur = p.current === 2 || p.current === 3 ? p.current : 1;
    return { current: cur, done: { ...DEFAULT.done, ...(p.done || {}) }, updatedAt: p.updatedAt ?? null };
  } catch { return { ...DEFAULT, done: { ...DEFAULT.done } }; }
}

export async function saveCoreProgress(update: Partial<CoreProgress> & { mark?: keyof CoreProgress['done'] }): Promise<CoreProgress> {
  const prev = await getCoreProgress();
  const next: CoreProgress = {
    current: update.current ?? prev.current,
    done: { ...prev.done, ...(update.done || {}), ...(update.mark ? { [update.mark]: true } : {}) },
    updatedAt: new Date().toISOString(),
  };
  try { await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(next)); } catch { /* non-critical */ }
  return next;
}

/** Queue a MoreTab screen to open once the main app is mounted. */
export async function setPendingRoute(screen: string): Promise<void> {
  try { await AsyncStorage.setItem(PENDING_KEY, screen); } catch { /* non-critical */ }
}
export async function consumePendingRoute(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(PENDING_KEY);
    if (v) await AsyncStorage.removeItem(PENDING_KEY);
    return v;
  } catch { return null; }
}

// ── Rights card (per state) ──────────────────────────────────────────────────
export interface RightsSection {
  key: string; topic?: string; heading: string; body: string; source: string | null; source_url?: string | null;
  last_reviewed: string | null; lawyer_reviewed: boolean; reviewed_by?: string | null; must_id?: boolean | null;
}
export interface ScriptLine { key: string; text: string; from: string }
export interface RightsCardData {
  state: string; state_name: string | null; language: string;
  general: RightsSection[]; state_specific: RightsSection[]; state_specific_available: boolean;
  state_notice: string | null; disclaimer: string;
  script: { say: ScriptLine[]; dont: ScriptLine[]; source: string; last_reviewed: string | null; lawyer_reviewed: boolean };
}

export async function cacheRightsCard(state: string, card: RightsCardData): Promise<void> {
  try { await AsyncStorage.setItem(RIGHTS_PREFIX + (state || 'US'), JSON.stringify({ card, at: new Date().toISOString() })); } catch { /* non-critical */ }
}
export async function getCachedRightsCard(state: string): Promise<{ card: RightsCardData; at: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(RIGHTS_PREFIX + (state || 'US'));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Fetch the state's card and keep a copy for airplane mode. Throws on network failure. */
export async function fetchRightsCard(state: string): Promise<RightsCardData> {
  const code = state || 'US';
  const res = await api.get<RightsCardData>(`/rights/${encodeURIComponent(code)}`);
  await cacheRightsCard(code, res.data);
  return res.data;
}

/** Best effort: refresh the offline copy for the user's state and the general card. */
export async function prefetchRights(state: string | null | undefined): Promise<void> {
  const codes = state ? [state, 'US'] : ['US'];
  await Promise.all(codes.map(c => fetchRightsCard(c).catch(() => null)));
}

// ── Court dates / following (offline copies; no notes ever) ─────────────────
export interface CourtHouse { id: number; name: string; address: string | null; phone: string | null; hours?: string | null; lat: number | null; lng: number | null; url?: string | null; directions_url?: string | null }
export interface CourtDate {
  id: number; case_id: number; case_title: string; case_state?: string | null; court_date: string; court_time: string | null;
  court_time_label: string | null; hearing_type: string | null; status: string; location: string | null;
  courthouse: CourtHouse | null; is_past: boolean; archived: boolean;
}
export interface CourtDatesList { upcoming: CourtDate[]; past: CourtDate[]; time_zone?: string; today?: string }

const stripCourtDate = (d: CourtDate): CourtDate => ({
  id: d.id, case_id: d.case_id, case_title: d.case_title, case_state: d.case_state ?? null,
  court_date: d.court_date, court_time: d.court_time, court_time_label: d.court_time_label,
  hearing_type: d.hearing_type, status: d.status, location: d.location,
  courthouse: d.courthouse, is_past: d.is_past, archived: d.archived,
});

export async function cacheCourtDates(list: CourtDatesList): Promise<void> {
  try {
    await AsyncStorage.setItem(COURT_KEY, JSON.stringify({
      list: { upcoming: (list.upcoming || []).map(stripCourtDate), past: (list.past || []).slice(0, 50).map(stripCourtDate), time_zone: list.time_zone },
      at: new Date().toISOString(),
    }));
  } catch { /* non-critical */ }
}
export async function getCachedCourtDates(): Promise<{ list: CourtDatesList; at: string } | null> {
  try { const raw = await AsyncStorage.getItem(COURT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export interface FollowedCase {
  follow_id: number; case_id: number; case_title: string; state: string | null; owner_first_name: string | null;
  share_reminders: boolean; next_court_date: string | null;
  court_dates: Array<Pick<CourtDate, 'id' | 'court_date' | 'court_time' | 'court_time_label' | 'hearing_type' | 'location' | 'status' | 'is_past'> & { courthouse: CourtHouse | null }>;
}
export async function cacheFollowing(list: FollowedCase[]): Promise<void> {
  try { await AsyncStorage.setItem(FOLLOWING_KEY, JSON.stringify({ list, at: new Date().toISOString() })); } catch { /* non-critical */ }
}
export async function getCachedFollowing(): Promise<{ list: FollowedCase[]; at: string } | null> {
  try { const raw = await AsyncStorage.getItem(FOLLOWING_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** True for an axios-style error that never reached the server (offline / unreachable). */
export function isOfflineError(e: unknown): boolean {
  const err = e as { response?: unknown; code?: string; message?: string };
  return !err?.response && (err?.code === 'ERR_NETWORK' || /network|offline|timeout/i.test(String(err?.message || '')) || !err?.code);
}

export const HEARING_LABELS: Record<string, string> = {
  arraignment: 'Arraignment', preliminary_hearing: 'Preliminary hearing', pretrial: 'Pre-trial',
  motion: 'Motion hearing', trial: 'Trial', sentencing: 'Sentencing', probation: 'Probation hearing',
  status: 'Status hearing', other: 'Other hearing',
};

/** 'YYYY-MM-DD' → 'Thursday, November 5, 2026' without any time-zone shift. */
export function formatCourtDay(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return d || '';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}
