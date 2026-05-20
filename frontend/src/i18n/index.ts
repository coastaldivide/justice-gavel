import en from './en.json'; import es from './es.json';
import AsyncStorage from '@react-native-async-storage/async-storage';
let lang = 'en'; export function setLang(l:string){ lang = l; AsyncStorage.setItem('lang', l); }
export async function initLang(){ const s = await AsyncStorage.getItem('lang'); if(s) lang = s; }
const dict: unknown = { en, es, pt, vi };
export function t(key:string){
  // Primary: current language translation
  const primary = dict[lang] && dict[lang][key];
  if (primary) return primary;
  // Fallback 1: English (covers keys added to en.json before other langs are updated)
  const english = dict['en'] && dict['en'][key];
  if (english) return english;
  // Fallback 2: the key itself (last resort — should never show in production)
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (__DEV__) console.warn('[i18n] Missing translation for key:', key, '(lang:', lang, ')');
  }
  return key;
}

// ── Auto-detect device locale ──────────────────────────────────────────────────
// Maps device locale to our 4 supported languages.
// Call setLangFromDevice() at app startup to honor OS language preference.
const LOCALE_MAP: Record<string, string> = {
  'es': 'es', 'es-MX': 'es', 'es-US': 'es', 'es-419': 'es', 'es-AR': 'es',
  'pt': 'pt', 'pt-BR': 'pt', 'pt-PT': 'pt',
  'vi': 'vi', 'vi-VN': 'vi',
  'en': 'en', 'en-US': 'en', 'en-GB': 'en', 'en-AU': 'en', 'en-CA': 'en',
};

export function detectLang(): string {
  try {
    // React Native exposes locale via NativeModules or Intl
    const localeStr = typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().locale
      : 'en';
    const primary = localeStr.split('-')[0]; // 'es-MX' → 'es'
    return LOCALE_MAP[localeStr] || LOCALE_MAP[primary] || 'en';
  } catch {
    return 'en';
  }
}

// Call at startup: setLang(detectLang())
export function initLang(): void {
  const detected = detectLang();
  if (detected !== lang) setLang(detected as 'en'|'es'|'pt'|'vi');
}

