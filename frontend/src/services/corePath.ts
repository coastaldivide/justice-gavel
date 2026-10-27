/**
 * corePath.ts — the "Just arrested?" path: 1) Know your rights · 2) Find a
 * lawyer and a bail agent · 3) Never miss a court date.
 *
 *  - Progress (current step + steps done) is kept on the device so a scared,
 *    interrupted person lands back where they were ("Step 2 of 3").
 *  - A route can be queued before the main tabs exist (first screen after
 *    install → browse mode → open the path) and is consumed by HomeScreen.
 *  - Offline copies: the rights card per state AND language (+ the general card), the
 *    court dates list and the cases this user follows. Court-date copies hold
 *    dates / places only — there are no case notes in them.
 * Every storage call is wrapped: a storage failure never breaks a screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { getLang, htDay, locale, t } from '../i18n';
import { stateName } from '../utils/userState';

export type CoreStep = 1 | 2 | 3;
export interface CoreProgress { current: CoreStep; done: { rights: boolean; help: boolean; court: boolean }; updatedAt: string | null }

const PROGRESS_KEY = 'core_path_progress';
const PENDING_KEY = 'core_path_pending_route';
// v3: one copy per language and state ('cache_rights_v3_es_TN'). v2 copies are
// English (the server served English only) and v1 copies could hold unreviewed
// state notes; both are still read for English (sanitised) and removed on save.
const RIGHTS_PREFIX = 'cache_rights_v3_';
const LEGACY_RIGHTS_PREFIXES = ['cache_rights_v2_', 'cache_rights_v1_'];
const rightsKey = (lang: string, state: string) => `${RIGHTS_PREFIX}${lang}_${state || 'US'}`;
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

export interface PendingRoute { screen: string; params?: Record<string, unknown> }

/** Queue a MoreTab screen (and its params) to open once the main app is mounted. */
export async function setPendingRoute(screen: string, params?: Record<string, unknown>): Promise<void> {
  try { await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(params ? { screen, params } : { screen })); } catch { /* non-critical */ }
}
export async function consumePendingRoute(): Promise<PendingRoute | null> {
  try {
    const v = await AsyncStorage.getItem(PENDING_KEY);
    if (!v) return null;
    await AsyncStorage.removeItem(PENDING_KEY);
    try {
      const p = JSON.parse(v) as Partial<PendingRoute>;
      if (p && typeof p.screen === 'string') return { screen: p.screen, params: p.params };
    } catch { /* a plain screen name (saved by an older version) */ }
    return { screen: v };
  } catch { return null; }
}

// ── Rights card (per state) ──────────────────────────────────────────────────
export interface RightsSection {
  key: string; topic?: string; heading: string; body: string; source: string | null; source_url?: string | null;
  last_reviewed: string | null; lawyer_reviewed: boolean; reviewed_by?: string | null; must_id?: boolean | null;
  language?: string;
}
export interface ScriptLine { key: string; text: string; from: string }
export interface RightsCardData {
  state: string; state_name: string | null; state_name_local?: string | null; language: string; mixed_language?: boolean;
  general: RightsSection[]; state_specific: RightsSection[]; state_specific_available: boolean;
  state_notice: string | null; disclaimer: string;
  script: { say: ScriptLine[]; dont: ScriptLine[]; source: string; last_reviewed: string | null; lawyer_reviewed: boolean };
}

/**
 * Owner rule (mirrors backend services/rightsContent.js): a state section is
 * shown only when it carries a real citation (source_url, or a specific
 * statute cite in its source) or a reviewer. Everything else is dropped —
 * from fresh responses and from copies saved on the phone.
 */
const STATUTE_CITE_RE = /§\s*\d|\b(?:Code|Stat|Stats|Ann|Laws|Rev|Penal|Crim|Proc|C\.R\.S|U\.S\.C|ILCS|RCW|ORS|MCL|CGS)\b\.?[^\n]{0,40}?\d/;
export function isReviewedStateSection(s: Partial<RightsSection> | null | undefined): boolean {
  return !!(s && (s.source_url || s.reviewed_by || STATUTE_CITE_RE.test(String(s.source || ''))));
}
export const reviewPendingNotice = (name: string): string => t('rc_state_pending', { state: name });
export function sanitizeRightsCard(card: RightsCardData): RightsCardData {
  const specific = (card?.state_specific || []).filter(isReviewedStateSection);
  const hasState = !!card?.state && card.state !== 'US';
  return {
    ...card,
    state_specific: specific,
    state_specific_available: specific.length > 0,
    state_notice: specific.length ? (card.state_notice ?? null)
      : hasState ? reviewPendingNotice(stateName(card.state, card.state_name_local || card.state_name)) : (card?.state_notice ?? null),
  };
}

/** Save the copy under the language it is in (card.language, else the app's). */
export async function cacheRightsCard(state: string, card: RightsCardData): Promise<void> {
  const lang = card?.language || getLang();
  try { await AsyncStorage.setItem(rightsKey(lang, state), JSON.stringify({ card: sanitizeRightsCard(card), at: new Date().toISOString() })); } catch { /* non-critical */ }
  for (const p of LEGACY_RIGHTS_PREFIXES) {
    try { await AsyncStorage.removeItem(p + (state || 'US')); } catch { /* non-critical */ }
  }
}
/** This phone's copy of the state's card in `lang` (default: the app's language). */
export async function getCachedRightsCard(state: string, lang: string = getLang()): Promise<{ card: RightsCardData; at: string } | null> {
  try {
    let raw = await AsyncStorage.getItem(rightsKey(lang, state));
    if (!raw && lang === 'en') {
      for (const p of LEGACY_RIGHTS_PREFIXES) { raw = await AsyncStorage.getItem(p + (state || 'US')); if (raw) break; }
    }
    if (!raw) return null;
    const saved = JSON.parse(raw) as { card: RightsCardData; at: string };
    if (!saved?.card) return null;
    // A copy in another language is never shown as this language's card.
    if ((saved.card.language || 'en') !== lang) return null;
    return { card: sanitizeRightsCard(saved.card), at: saved.at };
  } catch { return null; }
}

/** Fetch the state's card in the app's language and keep a copy for airplane mode. Throws on network failure. */
export async function fetchRightsCard(state: string): Promise<RightsCardData> {
  const code = state || 'US';
  const lang = getLang();
  const res = await api.get<RightsCardData>(`/rights/${encodeURIComponent(code)}`, { params: { lang } });
  const card = sanitizeRightsCard({ ...res.data, language: res.data?.language || 'en' });
  await cacheRightsCard(code, card);
  return card;
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
export interface ReminderDelivery {
  undeliverable: number; last_undeliverable_at: string | null;
  channels: { push: boolean; email: boolean; sms: boolean };
  needs_attention: boolean; message: string | null;
}
export interface CourtDatesList { upcoming: CourtDate[]; past: CourtDate[]; time_zone?: string; today?: string; reminder_delivery?: ReminderDelivery }

// ── "We could not send your reminders" prompt — shown once per new problem ──
const DELIVERY_PROMPT_KEY = 'reminder_delivery_prompt_v1';
const deliveryMarker = (rd: ReminderDelivery) => rd.last_undeliverable_at || 'no_channel';
export async function shouldShowDeliveryPrompt(rd: ReminderDelivery | null | undefined): Promise<boolean> {
  if (!rd?.needs_attention) return false;
  try { return (await AsyncStorage.getItem(DELIVERY_PROMPT_KEY)) !== deliveryMarker(rd); } catch { return true; }
}
export async function dismissDeliveryPrompt(rd: ReminderDelivery): Promise<void> {
  try { await AsyncStorage.setItem(DELIVERY_PROMPT_KEY, deliveryMarker(rd)); } catch { /* non-critical */ }
}

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
  court_dates: Array<Pick<CourtDate, 'id' | 'court_date' | 'court_time' | 'court_time_label' | 'hearing_type' | 'location' | 'status' | 'is_past'> & {
    courthouse: CourtHouse | null;
    /** my ride offer for this date (A8), and whether I may offer one (I get reminders, it is upcoming) */
    ride_offer?: 'offered' | 'accepted' | 'declined' | null; can_offer_ride?: boolean;
  }>;
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

export const HEARING_TYPES = ['arraignment', 'preliminary_hearing', 'pretrial', 'motion', 'trial', 'sentencing', 'probation', 'status', 'other'] as const;
/** Hearing type code → label in the app's language (the code itself when unknown). */
export function hearingLabel(code: string | null | undefined): string {
  if (!code) return '';
  return (HEARING_TYPES as readonly string[]).includes(code) ? t(`hearing_${code}`) : code;
}
/** Court-date status code → label in the app's language. */
export function statusLabel(code: string | null | undefined): string {
  if (!code) return '';
  return ['scheduled', 'attended', 'missed', 'rescheduled', 'cancelled'].includes(code) ? t(`cd_status_${code}`) : code;
}

const NBSP = /[\u00a0\u202f]/g;
/** 'YYYY-MM-DD' → 'Thursday, November 5, 2026' / 'jueves, 5 de noviembre de 2026' … without any time-zone shift. */
export function formatCourtDay(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return d || '';
  if (getLang() === 'ht') return htDay(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)));
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).toLocaleDateString(locale(), {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).replace(NBSP, ' ');
}

/** 'HH:MM' → '9:30 AM' (en, tl) / '9:30 a.m.' (es) / '09:30' (pt, vi, ht, zh) / '9:30 ص' (ar); '' when no time. Same as the server's labels. */
export function formatCourtTime(tm: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})/.exec(String(tm ?? ''));
  if (!m) return '';
  const h = Number(m[1]); const mm = m[2];
  const lang = getLang();
  if (lang === 'en' || lang === 'tl') return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  if (lang === 'ht') return `${m[1]}:${mm}`;
  return new Date(Date.UTC(2000, 0, 1, h, Number(mm))).toLocaleTimeString(locale(), {
    hour: lang === 'es' || lang === 'ar' ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: lang === 'zh' ? 'h23' : undefined, timeZone: 'UTC',
  }).replace(NBSP, ' ');
}

/** Month + year ('April 2026' / 'abril de 2026'), or day + month + year when the date has a day. */
export function reviewedLabel(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(d);
  if (!m) return d;
  if (getLang() === 'ht') {
    const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 15)));
    return m[3] ? htDay(day, { weekday: false }) : htDay(day, { weekday: false }).replace(/^\d+ /, '');
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 15))).toLocaleDateString(locale(),
    m[3] ? { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .replace(NBSP, ' ');
}
