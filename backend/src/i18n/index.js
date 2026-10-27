/**
 * i18n/index.js — server-side text in the app's eight languages (en, es, pt, vi, ht, zh,
 * ar, tl). Arabic is written right to left: e-mails use langAttrs() for dir="rtl".
 *
 *   resolveLang(req)        ?lang= → Accept-Language → 'en'
 *   msg(lang, key, params)  catalog text with {placeholders}; English fallback
 *   formatDay / formatTime  court-date day and time in the language's locale
 *   stateName(code, lang)   localized state name
 *   userLang / rememberLanguage  users.preferred_language (reminders and
 *                           e-mails go out in the person's saved language)
 *
 * The catalogs live in ./messages/<lang>.js (same keys, same placeholders —
 * enforced by __tests__/i18n_server_content.test.js).
 */
import en from './messages/en.js';
import es from './messages/es.js';
import pt from './messages/pt.js';
import vi from './messages/vi.js';
import ht from './messages/ht.js';
import zh from './messages/zh.js';
import ar from './messages/ar.js';
import tl from './messages/tl.js';
import { STATE_NAMES_I18N } from './stateNames.js';

export const SUPPORTED_LANGS = Object.freeze(['en', 'es', 'pt', 'vi', 'ht', 'zh', 'ar', 'tl']);
export const CATALOGS = Object.freeze({ en, es, pt, vi, ht, zh, ar, tl });
/**
 * Intl locale per language. ICU has no Haitian Creole data, so `ht` dates are written by
 * htDay() below and Intl only formats its numbers (en-US: "$12.50", not a French "12,50 $").
 * Arabic keeps Western digits (court dates, prices and phone numbers read the same as on
 * the paperwork).
 */
export const LOCALES = Object.freeze({ en: 'en-US', es: 'es-US', pt: 'pt-BR', vi: 'vi-VN', ht: 'en-US', zh: 'zh-CN', ar: 'ar-u-nu-latn', tl: 'fil-PH' });
/** English name of each language — AI prompts ("answer in …") and records ("shown in …"). */
export const LANG_NAMES = Object.freeze({
  en: 'English', es: 'Spanish', pt: 'Brazilian Portuguese', vi: 'Vietnamese',
  ht: 'Haitian Creole', zh: 'Simplified Chinese', ar: 'Arabic', tl: 'Tagalog (Filipino)',
});
/**
 * Stripe Checkout page language. Stripe has Chinese ('zh') and Filipino ('fil') but no
 * Haitian Creole or Arabic checkout page: those payers see Stripe's English page (our own
 * pages around it are in their language).
 */
export function stripeLocale(lang) {
  return { es: 'es', pt: 'pt-BR', vi: 'vi', zh: 'zh', tl: 'fil' }[normalizeLang(lang)] || 'en';
}
/** Languages written right to left. */
export const RTL_LANGS = Object.freeze(['ar']);
export const isRtl = (lang) => RTL_LANGS.includes(normalizeLang(lang));
/** HTML attributes for a block of text in `lang`: lang="…" plus dir="rtl" for Arabic. */
export function langAttrs(lang) {
  const l = normalizeLang(lang) || 'en';
  return `lang="${l}"${isRtl(l) ? ' dir="rtl"' : ''}`;
}

// Other spellings people and devices use for the same languages.
const LANG_ALIASES = Object.freeze({ fil: 'tl', hat: 'ht', cmn: 'zh', zho: 'zh', ara: 'ar', tgl: 'tl' });

/** 'es-MX' / 'PT_br' / 'zh-Hans-CN' / 'fil' → 'es' / 'pt' / 'zh' / 'tl'; anything unsupported → null. */
export function normalizeLang(v) {
  const p = String(v ?? '').trim().toLowerCase().split(/[-_;,\s]/)[0];
  const l = LANG_ALIASES[p] || p;
  return SUPPORTED_LANGS.includes(l) ? l : null;
}

/** First supported language of an Accept-Language header, by q-value; null when none. */
export function parseAcceptLanguage(header) {
  if (!header) return null;
  const parts = String(header).split(',').map((s, i) => {
    const [tag, ...params] = s.trim().split(';');
    const q = params.map(x => x.trim()).find(x => x.startsWith('q='));
    const qv = q ? Number(q.slice(2)) : 1;
    return { lang: normalizeLang(tag), q: Number.isFinite(qv) ? qv : 0, i };
  }).filter(p => p.lang && p.q > 0);
  parts.sort((a, b) => b.q - a.q || a.i - b.i);
  return parts[0]?.lang || null;
}

/** The language a request asked for: ?lang= wins, then Accept-Language, then `fallback`. */
export function resolveLang(req, fallback = 'en') {
  return normalizeLang(req?.query?.lang)
    || parseAcceptLanguage(typeof req?.get === 'function' ? req.get('Accept-Language') : req?.headers?.['accept-language'])
    || fallback;
}

/** True when the request named a language explicitly (?lang= or a supported Accept-Language). */
export function requestedLang(req) {
  return normalizeLang(req?.query?.lang)
    || parseAcceptLanguage(typeof req?.get === 'function' ? req.get('Accept-Language') : req?.headers?.['accept-language'])
    || null;
}

const fill = (s, params) => (params ? String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m)) : s);

/** Catalog text for `key` in `lang` (English when the key is missing), placeholders filled. */
export function msg(lang, key, params) {
  const l = normalizeLang(lang) || 'en';
  const s = CATALOGS[l][key] ?? en[key];
  if (s === undefined) return key;
  return fill(s, params);
}

/** (key, params) → text in the request's language. */
export function reqMsg(req) {
  const lang = resolveLang(req);
  return (key, params) => msg(lang, key, params);
}

const NBSP = /[\u00a0\u202f]/g;

// Haitian Creole day and month names (ICU has none): "mèkredi 30 septanm".
const HT_DAYS = ['dimanch', 'lendi', 'madi', 'mèkredi', 'jedi', 'vandredi', 'samdi'];
const HT_DAYS_SHORT = ['dim', 'len', 'mad', 'mèk', 'jed', 'van', 'sam'];
const HT_MONTHS = ['janvye', 'fevriye', 'mas', 'avril', 'me', 'jen', 'jiyè', 'out', 'septanm', 'oktòb', 'novanm', 'desanm'];
const HT_MONTHS_SHORT = ['jan', 'fev', 'mas', 'avr', 'me', 'jen', 'jiy', 'out', 'sept', 'okt', 'nov', 'des'];
/** Haitian Creole date for a UTC Date: long → "mèkredi 30 septanm[ 2026]", short → "mèk 30 sept". */
export function htDay(d, { short = false, year = false, weekday = true } = {}) {
  const wd = (short ? HT_DAYS_SHORT : HT_DAYS)[d.getUTCDay()];
  const mo = (short ? HT_MONTHS_SHORT : HT_MONTHS)[d.getUTCMonth()];
  return `${weekday ? `${wd} ` : ''}${d.getUTCDate()} ${mo}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** 'YYYY-MM-DD' → 'Thursday, November 5' / 'jueves, 5 de noviembre' … (no time-zone shift). */
export function formatDay(dateStr, lang = 'en', { year = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? ''));
  if (!m) return String(dateStr ?? '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (normalizeLang(lang) === 'ht') return htDay(d, { year });
  return d.toLocaleDateString(LOCALES[normalizeLang(lang) || 'en'], {
    weekday: 'long', month: 'long', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).replace(NBSP, ' ');
}

/** 'YYYY-MM-DD' → 'Wed, Sep 30' / 'mié, 30 sept' … — the short day used in texts. */
export function formatDayShort(dateStr, lang = 'en') {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? ''));
  if (!m) return String(dateStr ?? '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (normalizeLang(lang) === 'ht') return htDay(d, { short: true });
  return d.toLocaleDateString(LOCALES[normalizeLang(lang) || 'en'], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(NBSP, ' ');
}

/** '09:30' → '9:30 AM' (en, tl) / '9:30 a. m.' (es) / '09:30' (pt, vi, ht, zh) / '9:30 ص' (ar); null when no time. */
export function formatTime(t, lang = 'en') {
  const m = /^(\d{2}):(\d{2})/.exec(String(t ?? ''));
  if (!m) return null;
  const h = Number(m[1]); const mm = m[2];
  const l = normalizeLang(lang) || 'en';
  if (l === 'en' || l === 'tl') return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  if (l === 'ht') return `${m[1]}:${mm}`;
  return new Date(Date.UTC(2000, 0, 1, h, Number(mm))).toLocaleTimeString(LOCALES[l], {
    hour: l === 'es' || l === 'ar' ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: l === 'zh' ? 'h23' : undefined, timeZone: 'UTC',
  }).replace(NBSP, ' ');
}

/** Localized state name (English names are the fallback, e.g. for Vietnamese and Tagalog). */
export function stateName(code, englishName, lang = 'en') {
  const l = normalizeLang(lang) || 'en';
  return (STATE_NAMES_I18N[l] && STATE_NAMES_I18N[l][code]) || englishName || code;
}

/** The user's saved language ('en' when none / unknown / no DB). */
export async function userLang(db, userId) {
  if (!db || !userId) return 'en';
  const row = await db.get('SELECT preferred_language FROM users WHERE id = ?', [userId]).catch(() => null);
  return normalizeLang(row?.preferred_language) || 'en';
}

/** Save the user's language when valid and new. Returns true when it changed. */
export async function rememberLanguage(db, userId, lang) {
  const l = normalizeLang(lang);
  if (!db || !userId || !l) return false;
  const row = await db.get('SELECT preferred_language FROM users WHERE id = ?', [userId]).catch(() => null);
  if (!row || row.preferred_language === l) return false;
  await db.run('UPDATE users SET preferred_language = ? WHERE id = ?', [l, userId]);
  return true;
}
