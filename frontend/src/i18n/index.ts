/**
 * i18n — the app's eight languages (en, es, pt, vi, ht, zh, ar, tl). Arabic is right to left
 * (./direction.ts: a saved choice of Arabic, or of another language after Arabic, lays the
 * app out again — at once on the web, after a restart on iOS / Android).
 *
 *   t(key, params?)   text in the current language ({name} placeholders filled);
 *                     English when a key is missing (never in a release: the
 *                     parity test fails first), the key itself as a last resort
 *   getLang / setLang current language; setLang saves the choice and tells
 *                     every subscriber (useLang) so mounted screens re-render
 *   useLang()         React hook — call it in a screen so it re-renders on change
 *   locale()          'en-US' | 'es-US' | 'pt-BR' | 'vi-VN' | 'zh-CN' | 'ar-u-nu-latn' | 'fil-PH'
 *                     for dates, times and numbers (Haitian Creole: en-US numbers, and htDay()
 *                     for court dates — Intl has no Haitian Creole)
 *   initLang()        startup: the saved choice, else the device language
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';
import vi from './vi.json';
import ht from './ht.json';
import zh from './zh.json';
import ar from './ar.json';
import tagalog from './tl.json';
import { themeMode } from '../constants/theme';
import { applyDirection, isRtlLang } from './direction';

export { isRTL, isRtlLang, applyDirection } from './direction';

export type Lang = 'en' | 'es' | 'pt' | 'vi' | 'ht' | 'zh' | 'ar' | 'tl';
export const LANGS: readonly Lang[] = ['en', 'es', 'pt', 'vi', 'ht', 'zh', 'ar', 'tl'];
/** Each language's own name, for language pickers. */
export const ENDONYMS: Record<Lang, string> = {
  en: 'English', es: 'Español', pt: 'Português', vi: 'Tiếng Việt',
  ht: 'Kreyòl ayisyen', zh: '中文', ar: 'العربية', tl: 'Tagalog',
};
const LOCALES: Record<Lang, string> = {
  en: 'en-US', es: 'es-US', pt: 'pt-BR', vi: 'vi-VN', ht: 'en-US', zh: 'zh-CN', ar: 'ar-u-nu-latn', tl: 'fil-PH',
};
const dict: Record<Lang, Record<string, string>> = { en, es, pt, vi, ht, zh, ar, tl: tagalog };

let lang: Lang = 'en';
const listeners = new Set<() => void>();

export function isLang(l: unknown): l is Lang {
  return typeof l === 'string' && (LANGS as readonly string[]).includes(l);
}

export function getLang(): Lang { return lang; }
export function locale(l: Lang = lang): string { return LOCALES[l] || 'en-US'; }

/** Switch language. `persist: false` for a detected (not chosen) language. */
// Screens call initLang() too (Home, Onboarding, Bail search) in case they mount
// first; once the language is decided — at startup or by the person — those
// later calls must not switch it back.
let decided = false;

export function setLang(l: string, { persist = true }: { persist?: boolean } = {}): void {
  if (!isLang(l)) return;
  decided = true;
  const changed = l !== lang;
  lang = l;
  const saved = persist ? AsyncStorage.setItem('lang', l).catch(() => { /* non-fatal */ }) : Promise.resolve();
  if (changed) listeners.forEach(fn => { try { fn(); } catch { /* a listener must not break others */ } });
  // Layout direction: the web flips at once; iOS / Android restart, but only for a saved
  // choice (after it is saved, so the app comes back in that language).
  saved.then(() => applyDirection(l, { restart: persist }))
    .then(r => { if (r === 'needs_restart') directionListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } }); })
    .catch(() => { /* non-fatal */ });
}

const directionListeners = new Set<() => void>();
/** Called when the app could not restart itself to change direction (Settings asks the person to reopen it). */
export function onDirectionRestartNeeded(fn: () => void): () => void {
  directionListeners.add(fn);
  return () => { directionListeners.delete(fn); };
}

/** True when `l` (default: the current language) is written right to left. */
export function rtlLang(l: Lang = lang): boolean { return isRtlLang(l); }

// Haitian Creole day and month names (Intl has none): "mèkredi 30 septanm 2026".
const HT_DAYS = ['dimanch', 'lendi', 'madi', 'mèkredi', 'jedi', 'vandredi', 'samdi'];
const HT_MONTHS = ['janvye', 'fevriye', 'mas', 'avril', 'me', 'jen', 'jiyè', 'out', 'septanm', 'oktòb', 'novanm', 'desanm'];
/** A UTC date in Haitian Creole: "mèkredi 30 septanm 2026" (weekday / year optional). */
export function htDay(d: Date, { weekday = true, year = true }: { weekday?: boolean; year?: boolean } = {}): string {
  return `${weekday ? `${HT_DAYS[d.getUTCDay()]} ` : ''}${d.getUTCDate()} ${HT_MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** Subscribe to language changes; returns the unsubscribe function. */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The current language; the calling component re-renders when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(onLangChange, getLang, getLang);
}

/** Placeholder values; null / undefined leave the {placeholder} visible (a bug to fix at the call site). */
export type TParams = Record<string, string | number | null | undefined>;
const fill = (s: string, params?: TParams) =>
  (params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m)) : s);

export function t(key: string, params?: TParams): string {
  const primary = dict[lang] && dict[lang][key];
  if (primary) return fill(primary, params);
  // Fallback: English (a key added to en.json before the others — the parity test blocks release)
  const english = dict.en[key];
  if (english) return fill(english, params);
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[i18n] Missing translation for key:', key, '(lang:', lang, ')');
  return key;
}

/** A key's text in a given language (no placeholders) — e.g. keyword lists matched in every language. */
export function tIn(l: Lang, key: string): string {
  return (dict[l] && dict[l][key]) || dict.en[key] || '';
}

/**
 * Module-level text (option lists, tile tables, templates) must not call t()
 * at import time — that freezes it in the start-up language. Wrap it:
 *   const TILES = perLang(() => [{ label: t('home_tile_x') }]);   …   TILES()
 * The value is built once per language (and theme) and rebuilt after a switch
 * (stable identity per language and theme, so it is safe in hook dependency lists).
 */
export function perLang<T>(build: () => T): () => T {
  // Cached per language and per theme: these lists hold translated labels and,
  // often, theme colours (read with themeColors() while building).
  const cache: Partial<Record<string, T>> = {};
  return () => {
    const key = `${lang}:${themeMode()}`;
    if (!(key in cache)) cache[key] = build();
    return cache[key] as T;
  };
}

/** t() in a given language (a page that shows one language on request, e.g. English for an officer). */
export function tl(l: Lang, key: string, params?: TParams): string {
  const v = (dict[l] && dict[l][key]) || dict.en[key];
  return v ? fill(v, params) : key;
}

// ── Device locale → one of our 8 languages ─────────────────────────────────────
const LOCALE_MAP: Record<string, Lang> = {
  'es': 'es', 'es-MX': 'es', 'es-US': 'es', 'es-419': 'es', 'es-AR': 'es',
  'pt': 'pt', 'pt-BR': 'pt', 'pt-PT': 'pt',
  'vi': 'vi', 'vi-VN': 'vi',
  'ht': 'ht', 'ht-HT': 'ht',
  'zh': 'zh', 'zh-CN': 'zh', 'zh-Hans': 'zh', 'zh-Hans-CN': 'zh', 'zh-Hans-US': 'zh', 'zh-SG': 'zh',
  'ar': 'ar',
  'fil': 'tl', 'fil-PH': 'tl', 'tl': 'tl', 'tl-PH': 'tl',
  'en': 'en', 'en-US': 'en', 'en-GB': 'en', 'en-AU': 'en', 'en-CA': 'en',
};

/** 'es_MX' / 'zh-Hans-CN' / 'fil_PH' / 'ar' → one of our languages, or null. */
export function langFromLocale(localeStr: string): Lang | null {
  const tag = String(localeStr || '').replace(/_/g, '-');
  const parts = tag.split('-');
  return LOCALE_MAP[tag] || LOCALE_MAP[`${parts[0]}-${parts[1] || ''}`] || LOCALE_MAP[parts[0].toLowerCase()] || null;
}

export function detectLang(): Lang {
  try {
    const localeStr = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : 'en';
    const primary = localeStr.split('-')[0];
    return LOCALE_MAP[localeStr] || LOCALE_MAP[primary] || 'en';
  } catch {
    return 'en';
  }
}

/** Startup: the language the person chose (saved), else the device language (not saved). */
export async function initLang(): Promise<void> {
  if (decided) return;
  const saved = await AsyncStorage.getItem('lang').catch(() => null);
  if (decided) return; // the person picked a language while storage was read
  decided = true;
  const l = isLang(saved) ? saved : detectLang();
  setLang(l, { persist: false });
  // The start-up language is stable (saved, or the device's), so the layout may follow it:
  // the first start in Arabic (or the first start after leaving Arabic) restarts once.
  applyDirection(l, { restart: true }).catch(() => { /* non-fatal */ });
}
