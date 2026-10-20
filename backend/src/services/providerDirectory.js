/**
 * services/providerDirectory.js — the lawyer and bail-agent directory search
 * behind GET /api/providers/lawyers and /api/providers/bail.
 *
 * The rows are real, verified listings: this module only READS them.
 *
 * Where to search (first that applies):
 *   lat + lng            nearest first (distance from the person)
 *   q = ZIP (5 digits)   listings whose address carries that ZIP, then the rest
 *                        sorted by distance from that ZIP's listings (or from the
 *                        listings in the same 3-digit ZIP area)
 *   q = "City, ST" / city / state code / state name   that city / state
 *   q = anything else    listing name or firm contains the text
 *   city / state params  that city / state (older callers)
 *   nothing              the whole directory
 *
 * Filters always narrow (they are never dropped to fill a page). Case types for
 * criminal charges match every criminal-defence listing (a criminal defence
 * lawyer takes DUI / drug / assault / appeal cases); listings that name the case
 * type (e.g. "DWI lawyer") come first. Other case types (family, immigration …)
 * match only listings that name them.
 *
 * Order (owner rule — never by payment or subscription): by distance when there
 * is a point to measure from (5 km steps, then completeness of the listing),
 * otherwise by rating and number of reviews. Paid / badge flags are not read.
 */
import { haversineKm } from './geolink.js';
import { STATE_NAMES } from './rightsContent.js';
import { parseHours, is24x7, isOpenNow, completeness } from './providerHours.js';
import { safeJson } from '../utils/routeHelpers.js';

/** Radius steps (km) for "near me": the first one with a full page of results is used. */
export const RADIUS_STEPS_KM = [50, 100, 200, 500, Infinity];
export const PAGE_SIZE_MAX = 50;

const STATE_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([c, n]) => [n.toLowerCase(), c]));

/** Case types that are criminal charges: every criminal-defence listing handles them. */
const CRIMINAL_CASE_TYPES = {
  'DUI':               ['dui', 'dwi', 'owi', 'drunk driving'],
  'Drug Offenses':     ['drug', 'narcotic', 'controlled substance'],
  'Assault':           ['assault', 'battery'],
  'Domestic Violence': ['domestic violence'],
  'Theft':             ['theft', 'larceny', 'robbery', 'burglary', 'shoplift'],
  'Weapons Charges':   ['weapon', 'firearm', 'gun charge'],
  'Federal Crimes':    ['federal'],
  'Murder/Homicide':   ['murder', 'homicide', 'manslaughter'],
  'Sex Offenses':      ['sex crime', 'sex offense'],
  'Juvenile Defense':  ['juvenile'],
  'White Collar':      ['white collar', 'fraud', 'embezzlement'],
  'Traffic':           ['traffic', 'speeding'],
  'Appeals':           ['appeal', 'appellate', 'post-conviction', 'post conviction'],
  'Expungement':       ['expunge', 'record sealing', 'record clearing'],
};
/** Other case types: only listings that name them. */
const OTHER_CASE_TYPES = {
  'Family Law':      ['family', 'divorce', 'custody'],
  'Divorce':         ['divorce'],
  'Child Custody':   ['custody'],
  'Immigration':     ['immigration', 'deportation', 'visa'],
  'Personal Injury': ['personal injury', 'injury', 'accident'],
  'Employment':      ['employment', 'wrongful termination'],
  'Bankruptcy':      ['bankruptcy'],
  'Real Estate':     ['real estate', 'landlord', 'tenant'],
  'Civil Rights':    ['civil rights'],
};
export const KNOWN_CASE_TYPES = Object.freeze([...Object.keys(CRIMINAL_CASE_TYPES), ...Object.keys(OTHER_CASE_TYPES)]);

const list = (v, fallback = []) => {
  if (Array.isArray(v)) return v;
  if (!v) return fallback;
  try { const p = safeJson(v); return Array.isArray(p) ? p : fallback; } catch { return fallback; }
};
const bool = (v) => v === true || Number(v) === 1;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round1 = (v) => Math.round(v * 10) / 10;

/** 5-digit ZIP in an address ("…, Nashville, TN 37219, USA" → "37219"). */
export function addressZip(address) {
  const m = /\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/.exec(String(address || ''));
  return m ? m[2] : null;
}

/**
 * Read the free-text search box. Returns one of
 *   { kind: 'zip', zip } · { kind: 'place', city, state } · { kind: 'state', state }
 *   { kind: 'name', text } · null (empty).
 * A city that is not in the directory falls back to a name search in the caller.
 */
export function parseQuery(raw) {
  const q = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!q) return null;
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(q);
  if (zip) return { kind: 'zip', zip: zip[1] };
  const lower = q.toLowerCase().replace(/[.]/g, '');
  if (/^[a-z]{2}$/i.test(q) && STATE_NAMES[q.toUpperCase()]) return { kind: 'state', state: q.toUpperCase() };
  if (STATE_BY_NAME[lower]) return { kind: 'state', state: STATE_BY_NAME[lower] };
  // "Nashville, TN" / "Nashville TN 37219" / "Nashville, Tennessee"
  const cs = /^(.*?)[,\s]+([A-Za-z]{2}|[A-Za-z][A-Za-z .]+?)(?:\s+\d{5})?$/.exec(q);
  if (cs && cs[1].trim()) {
    const st = cs[2].trim();
    const code = st.length === 2 ? (STATE_NAMES[st.toUpperCase()] ? st.toUpperCase() : null) : STATE_BY_NAME[st.toLowerCase()] || null;
    if (code) return { kind: 'place', city: cs[1].replace(/,\s*$/, '').trim(), state: code, text: q };
  }
  return { kind: 'place', city: q, state: null, text: q };
}

function caseTypeMatcher(caseType) {
  if (!caseType) return null;
  const crim = CRIMINAL_CASE_TYPES[caseType];
  const other = OTHER_CASE_TYPES[caseType];
  const words = crim || other || [String(caseType).toLowerCase()];
  return (row) => {
    const specs = list(row.specialties).map(s => String(s).toLowerCase());
    const text = [row.name, row.firm, row.bio, ...specs].filter(Boolean).join(' ').toLowerCase();
    const named = words.some(w => text.includes(w));
    if (named) return 2;
    if (crim && specs.some(s => s.includes('criminal'))) return 1;
    return 0;
  };
}

/** Strict filters. Returns the rows that pass, each with `_caseRank` (2 named, 1 practice area, 0 no filter). */
export function applyFilters(rows, { caseType, language, proBonoOnly, slidingScaleOnly } = {}) {
  const ct = caseTypeMatcher(caseType);
  const lang = String(language || '').trim().toLowerCase();
  const out = [];
  for (const r of rows) {
    if (proBonoOnly && !bool(r.pro_bono)) continue;
    if (slidingScaleOnly && !bool(r.sliding_scale)) continue;
    if (lang && lang !== 'english') {
      const langs = list(r.languages, ['English']).map(l => String(l).toLowerCase());
      if (!langs.some(l => l.includes(lang))) continue;
    }
    let rank = 0;
    if (ct) { rank = ct(r); if (!rank) continue; }
    out.push(Object.assign(r, { _caseRank: rank }));
  }
  return out;
}

/** Hours / "open now" / 24-7 from the stored hours (never claimed when unknown). */
function hoursFields(r) {
  const parsed = parseHours(r.hours);
  return {
    hours: r.hours ? String(r.hours) : null,
    hours_known: !!parsed,
    open_now: parsed ? isOpenNow(r.hours, r.state) : null,
    open_24_7: parsed ? is24x7(r.hours) : false,
  };
}

const distanceFields = (km) => ({
  distanceKm: km != null && Number.isFinite(km) ? round1(km) : null,
  distanceMi: km != null && Number.isFinite(km) ? round1(km * 0.621371) : null,
});

/** Public shape of a lawyer listing (list rows and the profile use the same fields). */
export function formatLawyer(l, distanceKm = null) {
  return {
    id: Number(l.id),
    name: l.name,
    firm: l.firm || null,
    phone: l.phone || null,
    address: l.address || null,
    city: l.city || null,
    state: l.state || null,
    zip: addressZip(l.address),
    lat: num(l.lat),
    lng: num(l.lng),
    website: l.website || null,
    rating: num(l.rating),
    reviews: num(l.reviews) ?? num(l.review_count),
    specialties: list(l.specialties),
    languages: list(l.languages, ['English']),
    bio: l.bio || null,
    years_experience: num(l.years_experience),
    hourly_rate: num(l.hourly_rate),
    bar_number: l.bar_number || null,
    bar_state: l.bar_state || null,
    verified: bool(l.verified),
    bar_verified: bool(l.bar_verified),
    bar_verified_since: l.bar_verified_since || null,
    jtb_verified: bool(l.jtb_verified),
    jtb_verified_since: l.jtb_verified_since || null,
    golden_gavel: bool(l.golden_gavel),
    gavel_level: num(l.gavel_level) || (bool(l.golden_gavel) ? 3 : 0),
    data_verified: bool(l.data_verified),
    pro_bono: bool(l.pro_bono),
    sliding_scale: bool(l.sliding_scale),
    free_consultation: bool(l.free_consultation),
    avg_response_hrs: num(l.avg_response_hrs),
    accepting_leads: l.accepting_leads == null ? true : bool(l.accepting_leads),
    availability: l.availability || 'accepting',
    seed_data: l.source === 'seed',
    source: l.source || null,
    on_app: bool(l.on_app),
    ...hoursFields(l),
    ...distanceFields(distanceKm),
  };
}

/** Public shape of a bail-agent listing. */
export function formatBailAgent(a, distanceKm = null) {
  return {
    id: Number(a.id),
    name: a.name,
    company: a.company || null,
    phone: a.phone || null,
    address: a.address || null,
    city: a.city || null,
    state: a.state || null,
    zip: addressZip(a.address),
    lat: num(a.lat),
    lng: num(a.lng),
    website: a.website || null,
    rating: num(a.rating),
    reviews: num(a.reviews),
    license_number: a.license_number || null,
    license_type: a.license_type || null,
    verified: bool(a.verified) || bool(a.doi_verified),
    doi_verified: bool(a.doi_verified),
    payment_plans: bool(a.payment_plans),
    available_24_7: bool(a.available_24_7),
    jtb_verified: false,
    languages: list(a.languages, []),
    ...hoursFields(a),
    ...distanceFields(distanceKm),
  };
}

function centroid(rows) {
  const pts = rows.filter(r => Number.isFinite(num(r.lat)) && Number.isFinite(num(r.lng)));
  if (!pts.length) return null;
  return { lat: pts.reduce((s, r) => s + Number(r.lat), 0) / pts.length, lng: pts.reduce((s, r) => s + Number(r.lng), 0) / pts.length };
}

const byRating = (a, b) => (b._caseRank - a._caseRank)
  || ((num(b.rating) ?? 0) - (num(a.rating) ?? 0))
  || ((num(b.reviews) ?? 0) - (num(a.reviews) ?? 0))
  || (Number(a.id) - Number(b.id));

const byDistance = (a, b) => {
  const bucket = (d) => (Number.isFinite(d) ? Math.floor(d / 5) : 1e9);
  return (bucket(a._dist) - bucket(b._dist))
    || (b._caseRank - a._caseRank)
    || (b._complete - a._complete)
    || ((Number.isFinite(a._dist) ? a._dist : 1e9) - (Number.isFinite(b._dist) ? b._dist : 1e9))
    || (Number(a.id) - Number(b.id));
};

/**
 * Search `rows` (all active listings of one table). Returns
 * { rows: [{...row, _dist}], total, center, matched } — `matched` says how the
 * place was understood ('near' | 'zip' | 'city' | 'state' | 'name' | 'all' | 'none').
 */
export function searchDirectory(rows, opts = {}) {
  const { lat, lng, q, city, state, radiusKm, filters = {} } = opts;
  let pool = rows;
  let center = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  let matched = center ? 'near' : 'all';
  const parsed = center ? null : parseQuery(q);

  if (parsed?.kind === 'zip') {
    const exact = rows.filter(r => addressZip(r.address) === parsed.zip);
    const area = exact.length ? exact : rows.filter(r => (addressZip(r.address) || '').startsWith(parsed.zip.slice(0, 3)));
    center = centroid(area);
    matched = center ? 'zip' : 'none';
    if (!center) pool = [];
  } else if (parsed?.kind === 'state') {
    pool = rows.filter(r => String(r.state || '').toUpperCase() === parsed.state);
    matched = 'state';
  } else if (parsed?.kind === 'place') {
    const c = parsed.city.toLowerCase();
    const inPlace = rows.filter(r => String(r.city || '').toLowerCase() === c && (!parsed.state || String(r.state || '').toUpperCase() === parsed.state));
    // "Brooklyn" is stored as city "New York City" with "…, Brooklyn, NY 11242" in the address.
    const inAddress = inPlace.length ? [] : rows.filter(r => String(r.address || '').toLowerCase().includes(`, ${c},`)
      && (!parsed.state || String(r.state || '').toUpperCase() === parsed.state));
    if (inPlace.length) { pool = inPlace; matched = 'city'; }
    else if (inAddress.length) { pool = inAddress; matched = 'city'; }
    else {
      const needle = parsed.text.toLowerCase();
      pool = rows.filter(r => [r.name, r.firm, r.company].some(v => v && String(v).toLowerCase().includes(needle)));
      matched = pool.length ? 'name' : 'none';
    }
  } else if (!center && (city || state)) {
    const m = /^(.*?),\s*([A-Za-z]{2})$/.exec(String(city || '').trim());
    const cName = (m ? m[1] : String(city || '')).trim().toLowerCase();
    const sCode = String((m && m[2]) || state || '').trim().toUpperCase().slice(0, 2);
    pool = rows.filter(r => (!cName || String(r.city || '').toLowerCase() === cName) && (!sCode || String(r.state || '').toUpperCase() === sCode));
    matched = cName ? 'city' : 'state';
  }

  let result = applyFilters(pool.slice(), filters);

  if (center) {
    for (const r of result) {
      r._dist = Number.isFinite(num(r.lat)) && Number.isFinite(num(r.lng)) ? haversineKm(center.lat, center.lng, Number(r.lat), Number(r.lng)) : Infinity;
      r._complete = completeness(r);
    }
    if (Number.isFinite(radiusKm) && radiusKm > 0) {
      result = result.filter(r => r._dist <= radiusKm);
    } else {
      const minPage = opts.minResults || 20;
      for (const step of RADIUS_STEPS_KM) {
        const inside = result.filter(r => r._dist <= step);
        if (inside.length >= minPage || step === Infinity) { result = inside; break; }
      }
    }
    result.sort(byDistance);
  } else {
    result.sort(byRating);
  }
  return { rows: result, total: result.length, center, matched };
}

/** Page slice. */
export function pageOf(rows, page, limit) {
  const l = Math.min(Math.max(Number(limit) || 20, 1), PAGE_SIZE_MAX);
  const p = Math.max(Number(page) || 1, 1);
  return rows.slice((p - 1) * l, p * l);
}
