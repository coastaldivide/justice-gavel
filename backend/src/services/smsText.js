/**
 * services/smsText.js — keep reminder texts short and cheap.
 *
 * A text is billed per segment. With the GSM-7 alphabet one segment holds 160 characters
 * (153 each when the text is split); a single character outside GSM-7 (é is in it; á, ã,
 * ơ, ư, "—", curly quotes are not) switches the whole text to UCS-2: 70 characters (67 when
 * split). Court reminders, the "Did you make it?" question and the morning-after text must
 * stay within 2 segments in GSM-7 (English) and within MAX_UNICODE_SEGMENTS when the language
 * needs accents (Spanish, Portuguese, Vietnamese, Chinese, Arabic are sent in their own letters —
 * owner decision, October 27 2026: correct spelling over the cheapest text). Haitian Creole and
 * Tagalog are usually plain GSM-7 but longer than English: a text in a language other than
 * English may use MAX_GSM_SEGMENTS_OTHER GSM-7 segments (3 × 153 = 459 characters, still fewer
 * segments than the 6 a Unicode text may use).
 *
 *   toGsm(text)         the text in GSM-7: dashes, quotes and spaces made plain, letters
 *                       outside GSM-7 written without their accent (á→a, ã→a, ơ→o, đ→d).
 *                       Kept for callers that need pure GSM-7; reminder texts do not use it.
 *   plainPunctuation(text)  only dashes, quotes, spaces and ellipses made plain (accents kept),
 *                       so an English text stays GSM-7.
 *   smsSegments(text)   { encoding: 'GSM-7'|'UCS-2', units, segments }
 *   fitSms(build, fields, shrink, { lang, maxSegments, maxUnicodeSegments })
 *                       builds the text from `fields`, then shortens the named fields
 *                       (longest first, never below their minimum) until it fits.
 */

/** Most segments a text with accents (UCS-2) may use. */
export const MAX_UNICODE_SEGMENTS = 6;
/** Most GSM-7 segments a text in a language other than English may use (English: 2). */
export const MAX_GSM_SEGMENTS_OTHER = 3;

// GSM 03.38 basic set (Ç left out: carriers disagree whether 0x09 is Ç or ç) and extension table.
const BASIC = new Set(
  ('@£$¥èéùìòØø\nÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà\r').split(''));
const EXT = new Set('^{}\\[~]|€'.split(''));

const PLAIN = [
  [/[‘’‚′`´]/g, "'"], [/[“”„″]/g, '"'], [/[‐-―−]/g, '-'],
  [/…/g, '...'], [/[\u00a0\u2007\u202f\u2009\u200a\t]/g, ' '], [/[\u200b-\u200d\ufeff]/g, ''], [/[•·]/g, '-'],
  [/đ/g, 'd'], [/Đ/g, 'D'], [/ç/g, 'c'], [/Ç/g, 'C'], [/ł/g, 'l'], [/Ł/g, 'L'], [/œ/g, 'oe'], [/Œ/g, 'OE'],
];

export const isGsmChar = (c) => BASIC.has(c) || EXT.has(c);

const PUNCT = PLAIN.slice(0, 7);

/** Dashes, quotes, spaces made plain; letters (and their accents) untouched. */
export function plainPunctuation(text) {
  let s = String(text ?? '').normalize('NFC');
  for (const [re, to] of PUNCT) s = s.replace(re, to);
  return s.replace(/ {2,}/g, ' ').trim();
}

/** The text in the GSM-7 alphabet (see header). */
export function toGsm(text) {
  let s = String(text ?? '').normalize('NFC');
  for (const [re, to] of PLAIN) s = s.replace(re, to);
  let out = '';
  for (const ch of s) {
    if (isGsmChar(ch)) { out += ch; continue; }
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    const plain = [...base].filter(isGsmChar).join('');
    out += plain || (/\s/.test(ch) ? ' ' : '');
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

/** Encoding, length in that encoding's units and the number of segments. */
export function smsSegments(text) {
  const s = String(text ?? '');
  const gsm = [...s].every(isGsmChar);
  if (gsm) {
    const units = [...s].reduce((n, c) => n + (EXT.has(c) ? 2 : 1), 0);
    return { encoding: 'GSM-7', units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const units = s.length;   // UTF-16 code units
  return { encoding: 'UCS-2', units, segments: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67) };
}

/** First `n` characters, ending at a word boundary when one is near. */
const cut = (v, n) => {
  const s = String(v ?? '');
  if (s.length <= n) return s;
  let t = s.slice(0, Math.max(0, n));
  const sp = t.lastIndexOf(' ');
  if (sp >= n * 0.6) t = t.slice(0, sp);
  return t.replace(/[\s,;:.(-]+$/, '');
};

/**
 * build(fields) → text. `shrink` = [[field, min], …]: the fields that may be shortened, in
 * order (the first is shortened down to its minimum before the next is touched).
 * Returns the text (accents kept) within `maxSegments` (GSM-7) or `maxUnicodeSegments`
 * (UCS-2). Only when every field is already at its minimum and the text is still too long is
 * it cut at the segment limit (the wording tests make sure that never happens with real values).
 */
export function fitSms(build, fields, shrink = [], { lang = 'en', maxSegments, maxUnicodeSegments = MAX_UNICODE_SEGMENTS } = {}) {
  if (maxSegments === undefined) maxSegments = String(lang || 'en').toLowerCase().startsWith('en') ? 2 : MAX_GSM_SEGMENTS_OTHER;
  const f = { ...fields };
  for (const [k] of shrink) f[k] = f[k] == null ? '' : String(f[k]);
  const limitFor = (t) => (smsSegments(t).encoding === 'GSM-7' ? maxSegments : maxUnicodeSegments);
  let text = plainPunctuation(build(f));
  let guard = 0;
  while (smsSegments(text).segments > limitFor(text) && guard++ < 200) {
    const next = shrink.find(([k, min]) => f[k].length > min);
    if (!next) break;
    const [k, min] = next;
    f[k] = cut(f[k], Math.max(min, f[k].length - 8));
    text = plainPunctuation(build(f));
  }
  const max = limitFor(text);
  if (smsSegments(text).segments > max) {
    const gsm = smsSegments(text).encoding === 'GSM-7';
    const limit = gsm ? (max === 1 ? 160 : 153 * max) : (max === 1 ? 70 : 67 * max);
    text = text.slice(0, limit);
  }
  return text;
}
