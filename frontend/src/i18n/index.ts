/**
 * i18n — the app's four languages (en, es, pt, vi).
 *
 *   t(key, params?)   text in the current language ({name} placeholders filled);
 *                     English when a key is missing (never in a release: the
 *                     parity test fails first), the key itself as a last resort
 *   getLang / setLang current language; setLang saves the choice and tells
 *                     every subscriber (useLang) so mounted screens re-render
 *   useLang()         React hook — call it in a screen so it re-renders on change
 *   locale()          'en-US' | 'es-US' | 'pt-BR' | 'vi-VN' for dates and times
 *   initLang()        startup: the saved choice, else the device language
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';
import vi from './vi.json';
import { themeMode } from '../constants/theme';

export type Lang = 'en' | 'es' | 'pt' | 'vi';
export const LANGS: readonly Lang[] = ['en', 'es', 'pt', 'vi'];
const LOCALES: Record<Lang, string> = { en: 'en-US', es: 'es-US', pt: 'pt-BR', vi: 'vi-VN' };
const dict: Record<Lang, Record<string, string>> = { en, es, pt, vi };

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
  if (persist) AsyncStorage.setItem('lang', l).catch(() => { /* non-fatal */ });
  if (changed) listeners.forEach(fn => { try { fn(); } catch { /* a listener must not break others */ } });
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

// ── Device locale → one of our 4 languages ─────────────────────────────────────
const LOCALE_MAP: Record<string, Lang> = {
  'es': 'es', 'es-MX': 'es', 'es-US': 'es', 'es-419': 'es', 'es-AR': 'es',
  'pt': 'pt', 'pt-BR': 'pt', 'pt-PT': 'pt',
  'vi': 'vi', 'vi-VN': 'vi',
  'en': 'en', 'en-US': 'en', 'en-GB': 'en', 'en-AU': 'en', 'en-CA': 'en',
};

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
  if (isLang(saved)) { setLang(saved, { persist: false }); return; }
  setLang(detectLang(), { persist: false });
}
