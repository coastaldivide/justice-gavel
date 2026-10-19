/**
 * services/providerHours.js — "Open now" / "24/7" from the hours a listing
 * already stores, and the honest ranking used by the combined results.
 *
 * Stored hours are Google's weekday text joined with " | ", e.g.
 *   "Monday: 8:00 AM – 12:00 PM, 1:00 – 5:00 PM | … | Sunday: Closed"
 *   "Monday: Open 24 hours | … | Sunday: Open 24 hours"
 * Times are wall-clock in the provider's own zone (the zone of its state).
 * Anything we cannot parse is "hours unknown" — never "open".
 *
 * Ranking (owner rule: never by payment/subscription): distance first, then
 * how complete the listing is (real phone, hours, website, address). Paid
 * flags (golden_gavel, sort_priority, subscription tiers…) are not read here.
 */
import { stateTimeZone, zonedParts, DEFAULT_TIME_ZONE } from '../utils/timezone.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MIN = 24 * 60;

function toMinutes(h, m, mer) {
  let hh = Number(h) % 12;
  if (mer === 'PM') hh += 12;
  return hh * 60 + Number(m || 0);
}

/** "8:00 AM – 12:00 PM" / "1:00 – 5:00 PM" → [startMin, endMin] (end may be > 1440 when it runs past midnight). */
function parseRange(txt) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i.exec(txt);
  if (!m) return null;
  const endMer = m[6].toUpperCase();
  const end = toMinutes(m[4], m[5], endMer);
  let start;
  if (m[3]) start = toMinutes(m[1], m[2], m[3].toUpperCase());
  else {
    // Google omits the start meridiem when it equals the end's ("1:00 – 5:00 PM").
    start = toMinutes(m[1], m[2], endMer);
    if (start > end) start = toMinutes(m[1], m[2], endMer === 'PM' ? 'AM' : 'PM');
  }
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return [start, end <= start ? end + DAY_MIN : end];
}

/**
 * Parse stored hours → { days: { monday: [[s,e],…] | 'closed' | 'open24' }, all24: bool } or null.
 * Returns null unless all seven days were understood (partial data is "unknown").
 */
export function parseHours(hours) {
  if (typeof hours !== 'string' || !hours.trim() || hours.length > 2000) return null;
  const days = {};
  for (const part of hours.split('|')) {
    const m = /^\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*:\s*(.+?)\s*$/i.exec(part);
    if (!m) return null;
    const day = m[1].toLowerCase();
    const val = m[2];
    if (/^closed$/i.test(val)) { days[day] = 'closed'; continue; }
    if (/^open 24 hours$/i.test(val)) { days[day] = 'open24'; continue; }
    const ranges = [];
    for (const r of val.split(',')) {
      const pr = parseRange(r);
      if (!pr) return null;
      ranges.push(pr);
    }
    days[day] = ranges;
  }
  if (DAYS.some(d => !(d in days))) return null;
  return { days, all24: DAYS.every(d => days[d] === 'open24') };
}

/** True when the stored hours say open 24 hours every day of the week. */
export function is24x7(hours) {
  const p = parseHours(hours);
  return !!(p && p.all24);
}

/**
 * Is the provider open at `now`? true / false, or null when hours are unknown.
 * Uses the provider's state zone (fallback DEFAULT_TIME_ZONE).
 */
export function isOpenNow(hours, state, now = new Date()) {
  const p = parseHours(hours);
  if (!p) return null;
  if (p.all24) return true;
  const tz = stateTimeZone(state) || DEFAULT_TIME_ZONE;
  const z = zonedParts(now, tz);
  const wd = new Date(Date.UTC(z.year, z.month - 1, z.day)).getUTCDay();
  const minute = (z.hour % 24) * 60 + z.minute;
  const today = p.days[DAYS[wd]];
  const yesterday = p.days[DAYS[(wd + 6) % 7]];
  if (today === 'open24') return true;
  if (Array.isArray(today) && today.some(([s, e]) => minute >= s && minute < e)) return true;
  // a range that started yesterday and runs past midnight
  if (Array.isArray(yesterday) && yesterday.some(([, e]) => e > DAY_MIN && minute < e - DAY_MIN)) return true;
  return false;
}

const realPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return ten.length === 10 && !/^\d{3}555\d{4}$/.test(ten);
};

/** 0–4: real phone, parseable hours, website, street address. */
export function completeness(p) {
  return (realPhone(p.phone) ? 1 : 0)
    + (parseHours(p.hours) ? 1 : 0)
    + (p.website && /^https?:\/\//i.test(String(p.website)) ? 1 : 0)
    + (p.address && String(p.address).trim().length > 5 ? 1 : 0);
}

/**
 * Sort key: distance bucket (5 km steps, so "same neighbourhood" listings are
 * compared on completeness), then completeness (desc), then exact distance,
 * then id for a stable order. Missing distance sorts after known distances.
 */
export function rankProviders(list) {
  const bucket = (d) => (Number.isFinite(d) ? Math.floor(d / 5) : 1e9);
  return [...list].sort((a, b) =>
    bucket(a.distance_km) - bucket(b.distance_km)
    || (b.completeness - a.completeness)
    || ((Number.isFinite(a.distance_km) ? a.distance_km : 1e9) - (Number.isFinite(b.distance_km) ? b.distance_km : 1e9))
    || (Number(a.id) - Number(b.id)));
}

export { realPhone as hasRealPhone };
