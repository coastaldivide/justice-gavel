/**
 * dataRefresh/normalize.js — pure helpers shared by every scraper / importer.
 *
 * Matching keys (used to decide "is this provider already in the table?"):
 *   sourceKey(source_id)        Google place ids are compared regardless of the
 *                               prefix a script used ('google_<id>',
 *                               'google_ra_<id>'), everything else verbatim.
 *   phoneKey(phone)             last 10 digits of a NANP number; placeholder
 *                               555-01xx numbers and junk never match.
 *   nameKey(name, city, state)  lower-case, punctuation-free, corporate
 *                               suffixes dropped, joined with city + state.
 *
 * Comparators (used to decide "is the scraped value different?") are lenient
 * on formatting so a re-scrape does not flood the review queue with
 * "(615) 555-1234" vs "+16155551234" style non-changes.
 */

export const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR',
]);

export function cleanText(v, max = 500) {
  if (v === undefined || v === null) return null;
  let raw = '';
  for (const ch of String(v)) {
    const c = ch.charCodeAt(0);
    raw += (c < 32 || c === 127) ? ' ' : ch;              // control characters → space
  }
  const s = raw.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/** '+1XXXXXXXXXX' for a 10/11-digit NANP number, otherwise null. */
export function normalizePhone(v) {
  if (v === undefined || v === null) return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
}

/** 10-digit matching key, or null for missing / placeholder numbers. */
export function phoneKey(v) {
  const p = normalizePhone(v);
  if (!p) return null;
  const ten = p.slice(-10);
  if (/^\d{3}55501\d{2}$/.test(ten)) return null;          // 555-01xx fiction numbers
  if (/^(\d)\1{9}$/.test(ten)) return null;                 // 000-000-0000 etc.
  return ten;
}

export function normalizeUrl(v) {
  const s = cleanText(v, 1000);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : 'https://' + s;
  try {
    const u = new URL(withScheme);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString();
  } catch { return null; }
}

/** Comparable form of a URL: host without www, path without trailing slash, no tracking params. */
export function urlKey(v) {
  const n = normalizeUrl(v);
  if (!n) return null;
  const u = new URL(n);
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|gclid|fbclid|y_source|msclkid)/i.test(k)) u.searchParams.delete(k);
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const p = u.pathname.replace(/\/+$/, '');
  const q = u.searchParams.toString();
  return host + p + (q ? '?' + q : '');
}

const NAME_SUFFIXES = /\b(llc|pllc|plc|llp|lllp|pc|p c|pa|p a|inc|incorporated|ltd|co|corp|corporation|company|esq|esquire|the)\b/g;

export function normalizeName(v) {
  const s = cleanText(v, 300);
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(NAME_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCity(v) {
  return normalizeName(v).replace(/\bsaint\b/g, 'st').replace(/\bfort\b/g, 'ft');
}

export function normalizeState(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return US_STATES.has(s) ? s : null;
}

/** 'Nashville, TN' → { city: 'Nashville', state: 'TN' }. */
export function splitCityState(v, fallbackState = null) {
  const s = cleanText(v, 200) || '';
  const m = /^(.*?)[,\s]+([A-Za-z]{2})$/.exec(s);
  if (m && normalizeState(m[2])) return { city: cleanText(m[1], 120), state: normalizeState(m[2]) };
  return { city: cleanText(s, 120), state: normalizeState(fallbackState) };
}

export function nameKey(name, city, state) {
  const n = normalizeName(name);
  const c = normalizeCity(city);
  const st = normalizeState(state) || '';
  if (!n || !c || !st) return null;
  return `${n}|${c}|${st}`;
}

/** Google place ids match across script prefixes; other ids match verbatim. */
export function sourceKey(sourceId) {
  const s = cleanText(sourceId, 300);
  if (!s) return null;
  const g = /^google_(?:ra_)?(.+)$/.exec(s);
  return g ? `gplace:${g[1]}` : s;
}

function addressKey(v) {
  const s = cleanText(v, 500);
  if (!s) return null;
  return s.toLowerCase()
    .replace(/,?\s*(usa|united states)$/i, '')
    .replace(/\b\d{5}(-\d{4})?\b/g, '')
    .replace(/\b(suite|ste|unit|apt)\b\.?/g, 'ste')
    .replace(/\b(street)\b/g, 'st').replace(/\b(avenue)\b/g, 'ave').replace(/\b(boulevard)\b/g, 'blvd')
    .replace(/\b(drive)\b/g, 'dr').replace(/\b(road)\b/g, 'rd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Field comparators: `same(existing, incoming)` → true when the scraped value
 * says nothing new. `format(incoming)` → the TEXT stored as new_value and,
 * when applied, cast back by castForColumn().
 */
export const FIELD_RULES = {
  phone:          { kind: 'text', same: (a, b) => phoneKey(a) !== null && phoneKey(a) === phoneKey(b), format: normalizePhone },
  email:          { kind: 'text', same: (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase(), format: v => cleanText(v, 254)?.toLowerCase() ?? null },
  website:        { kind: 'text', same: (a, b) => urlKey(a) !== null && urlKey(a) === urlKey(b), format: normalizeUrl },
  address:        { kind: 'text', same: (a, b) => {
    const x = addressKey(a); const y = addressKey(b);
    return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
  }, format: v => cleanText(v, 500) },
  hours:          { kind: 'text', same: (a, b) => cleanText(a, 2000)?.toLowerCase() === cleanText(b, 2000)?.toLowerCase(), format: v => cleanText(v, 2000) },
  rating:         { kind: 'float', same: (a, b) => num(a) !== null && Math.abs(num(a) - num(b)) < 0.05, format: v => (num(v) === null || num(v) <= 0 || num(v) > 5 ? null : String(num(v))) },
  reviews:        { kind: 'int', same: (a, b) => num(a) !== null && Math.round(num(a)) === Math.round(num(b)), format: v => (num(v) === null || num(v) < 0 ? null : String(Math.round(num(v)))) },
  lat:            { kind: 'float', same: (a, b) => num(a) !== null && Math.abs(num(a) - num(b)) < 1e-4, format: v => (num(v) === null || Math.abs(num(v)) > 90 ? null : String(num(v))) },
  lng:            { kind: 'float', same: (a, b) => num(a) !== null && Math.abs(num(a) - num(b)) < 1e-4, format: v => (num(v) === null || Math.abs(num(v)) > 180 ? null : String(num(v))) },
  bar_number:     { kind: 'text', same: (a, b) => String(a ?? '').replace(/\s+/g, '').toUpperCase() === String(b ?? '').replace(/\s+/g, '').toUpperCase(), format: v => cleanText(v, 40) },
  license_number: { kind: 'text', same: (a, b) => String(a ?? '').replace(/\s+/g, '').toUpperCase() === String(b ?? '').replace(/\s+/g, '').toUpperCase(), format: v => cleanText(v, 60) },
  license_type:   { kind: 'text', same: (a, b) => cleanText(a, 120)?.toLowerCase() === cleanText(b, 120)?.toLowerCase(), format: v => cleanText(v, 120) },
  doi_verified:   { kind: 'int', same: (a, b) => Number(a || 0) === Number(b || 0), format: v => (num(v) === null ? null : String(num(v) ? 1 : 0)) },
  available_24_7: { kind: 'int', same: (a, b) => Number(a || 0) === Number(b || 0), format: v => (num(v) === null ? null : String(num(v) ? 1 : 0)) },
};

/** Cast a proposal's TEXT value to what the column holds. */
export function castForColumn(field, text) {
  const rule = FIELD_RULES[field];
  if (!rule) throw new Error(`unknown field ${field}`);
  if (text === null || text === undefined) return null;
  if (rule.kind === 'int') { const n = Number(text); return Number.isFinite(n) ? Math.round(n) : null; }
  if (rule.kind === 'float') { const n = Number(text); return Number.isFinite(n) ? n : null; }
  return String(text);
}

/** String form of an existing column value, for old_value / staleness checks. */
export function valueText(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
