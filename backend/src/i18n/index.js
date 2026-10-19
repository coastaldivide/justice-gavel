/**
 * i18n/index.js — server-side text in the app's four languages (en, es, pt, vi).
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
import { STATE_NAMES_I18N } from './stateNames.js';

export const SUPPORTED_LANGS = Object.freeze(['en', 'es', 'pt', 'vi']);
export const CATALOGS = Object.freeze({ en, es, pt, vi });
export const LOCALES = Object.freeze({ en: 'en-US', es: 'es-US', pt: 'pt-BR', vi: 'vi-VN' });

/** 'es-MX' / 'PT_br' / 'vi' → 'es' / 'pt' / 'vi'; anything unsupported → null. */
export function normalizeLang(v) {
  const p = String(v ?? '').trim().toLowerCase().split(/[-_;,\s]/)[0];
  return SUPPORTED_LANGS.includes(p) ? p : null;
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

/** 'YYYY-MM-DD' → 'Thursday, November 5' / 'jueves, 5 de noviembre' … (no time-zone shift). */
export function formatDay(dateStr, lang = 'en', { year = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? ''));
  if (!m) return String(dateStr ?? '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return d.toLocaleDateString(LOCALES[normalizeLang(lang) || 'en'], {
    weekday: 'long', month: 'long', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).replace(NBSP, ' ');
}

/** '09:30' → '9:30 AM' (en) / '9:30 a. m.' (es) / '09:30' (pt, vi); null when no time. */
export function formatTime(t, lang = 'en') {
  const m = /^(\d{2}):(\d{2})/.exec(String(t ?? ''));
  if (!m) return null;
  const h = Number(m[1]); const mm = m[2];
  const l = normalizeLang(lang) || 'en';
  if (l === 'en') return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  return new Date(Date.UTC(2000, 0, 1, h, Number(mm))).toLocaleTimeString(LOCALES[l], {
    hour: l === 'es' ? 'numeric' : '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).replace(NBSP, ' ');
}

/** Localized state name (English names are the fallback, e.g. for Vietnamese). */
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
