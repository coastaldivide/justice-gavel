/**
 * services/smsText.js — keep reminder texts short and cheap.
 *
 * A text is billed per segment. With the GSM-7 alphabet one segment holds 160 characters
 * (153 each when the text is split); a single character outside GSM-7 (é is in it; á, ã,
 * ơ, ư, "—", curly quotes are not) switches the whole text to UCS-2: 70 characters (67 when
 * split). Court reminders, the "Did you make it?" question and the morning-after text must
 * stay within 2 segments.
 *
 *   toGsm(text)         the text in GSM-7: dashes, quotes and spaces made plain, letters
 *                       outside GSM-7 written without their accent (á→a, ã→a, ơ→o, đ→d).
 *                       Spanish, Portuguese and Vietnamese texts are therefore sent without
 *                       accents (common practice for texts; the app and e-mails keep them).
 *   smsSegments(text)   { encoding: 'GSM-7'|'UCS-2', units, segments }
 *   fitSms(build, fields, shrink, { maxSegments })
 *                       builds the text from `fields`, then shortens the named fields
 *                       (longest first, never below their minimum) until it fits.
 */

// GSM 03.38 basic set (Ç left out: carriers disagree whether 0x09 is Ç or ç) and extension table.
const BASIC = new Set(
  ('@£$¥èéùìòØø\nÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà\r').split(''));
const EXT = new Set('^{}\\[~]|€'.split(''));

const PLAIN = [
  [/[‘’‚′`´]/g, "'"], [/[“”„″]/g, '"'], [/[‐-―−]/g, '-'],
  [/…/g, '...'], [/[     \t]/g, ' '], [/[​-‍﻿]/g, ''], [/[•·]/g, '-'],
  [/đ/g, 'd'], [/Đ/g, 'D'], [/ç/g, 'c'], [/Ç/g, 'C'], [/ł/g, 'l'], [/Ł/g, 'L'], [/œ/g, 'oe'], [/Œ/g, 'OE'],
];

export const isGsmChar = (c) => BASIC.has(c) || EXT.has(c);

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
 * Returns the GSM-7 text within `maxSegments`. Only when every field is already at its minimum
 * and the text is still too long is it cut at the segment limit (the wording tests make sure
 * that never happens with real values).
 */
export function fitSms(build, fields, shrink = [], { maxSegments = 2 } = {}) {
  const f = { ...fields };
  for (const [k] of shrink) f[k] = f[k] == null ? '' : String(f[k]);
  let text = toGsm(build(f));
  let guard = 0;
  while (smsSegments(text).segments > maxSegments && guard++ < 200) {
    const next = shrink.find(([k, min]) => f[k].length > min);
    if (!next) break;
    const [k, min] = next;
    f[k] = cut(f[k], Math.max(min, f[k].length - 8));
    text = toGsm(build(f));
  }
  if (smsSegments(text).segments > maxSegments) {
    const limit = maxSegments === 1 ? 160 : 153 * maxSegments;
    text = text.slice(0, limit);
  }
  return text;
}
