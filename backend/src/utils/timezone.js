/**
 * utils/timezone.js — calendar-day arithmetic in a user's IANA time zone.
 *
 * Court dates are stored as date-only values ('YYYY-MM-DD', no time, no zone):
 * they name a calendar day in the court's jurisdiction. Reminders must fire at a
 * wall-clock time on a calendar day *in the user's zone* (e.g. 09:00 local seven
 * days before), so the server converts "date + local time + zone" to a UTC
 * instant here, DST-correctly, with no dependency beyond Intl.
 */

/** Default when neither the user nor the case state gives a zone. */
export const DEFAULT_TIME_ZONE = 'America/Chicago';

/** Primary IANA zone for each state / territory (most-populous zone for split states). */
export const STATE_TIME_ZONES = Object.freeze({
  AL: 'America/Chicago',  AK: 'America/Anchorage', AZ: 'America/Phoenix',   AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York',  DC: 'America/New_York',
  DE: 'America/New_York', FL: 'America/New_York',  GA: 'America/New_York',  HI: 'Pacific/Honolulu',
  ID: 'America/Boise',    IL: 'America/Chicago',   IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago',  KY: 'America/New_York',  LA: 'America/Chicago',   ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York',  MI: 'America/Detroit',   MN: 'America/Chicago',
  MS: 'America/Chicago',  MO: 'America/Chicago',   MT: 'America/Denver',    NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York',  ND: 'America/Chicago',   OH: 'America/New_York',
  OK: 'America/Chicago',  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago',   TN: 'America/Chicago',   TX: 'America/Chicago',
  UT: 'America/Denver',   VT: 'America/New_York',  VA: 'America/New_York',  WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago',   WY: 'America/Denver',
  PR: 'America/Puerto_Rico', GU: 'Pacific/Guam',   VI: 'America/St_Thomas',
});

/**
 * Counties of split states whose zone differs from the state's primary zone above (whole
 * counties only; counties split down the middle keep the state's zone). Used for Bond Desk
 * court reminders, which follow the court's county.
 */
const C = (zone, list) => Object.fromEntries(list.split(',').map((n) => [n.trim().toLowerCase(), zone]));
export const COUNTY_TIME_ZONES = Object.freeze({
  TN: C('America/New_York', 'Anderson,Blount,Bradley,Campbell,Carter,Claiborne,Cocke,Grainger,Greene,Hamblen,Hamilton,Hancock,Hawkins,Jefferson,Johnson,Knox,Loudon,McMinn,Meigs,Monroe,Morgan,Polk,Rhea,Roane,Scott,Sevier,Sullivan,Unicoi,Union,Washington'),
  FL: C('America/Chicago', 'Escambia,Santa Rosa,Okaloosa,Walton,Holmes,Washington,Bay,Jackson,Calhoun'),
  TX: C('America/Denver', 'El Paso,Hudspeth'),
  KY: C('America/Chicago', 'Adair,Allen,Ballard,Barren,Breckinridge,Butler,Caldwell,Calloway,Carlisle,Christian,Clinton,Crittenden,Cumberland,Daviess,Edmonson,Fulton,Graves,Grayson,Green,Hancock,Hart,Henderson,Hickman,Hopkins,Livingston,Logan,Lyon,Marshall,McCracken,McLean,Metcalfe,Monroe,Muhlenberg,Ohio,Russell,Simpson,Todd,Trigg,Union,Warren,Webster'),
  IN: C('America/Chicago', 'Lake,Porter,LaPorte,Jasper,Newton,Starke,Vanderburgh,Posey,Warrick,Spencer,Gibson,Perry'),
  MI: C('America/Menominee', 'Gogebic,Iron,Dickinson,Menominee'),
  ID: C('America/Los_Angeles', 'Kootenai,Boundary,Bonner,Benewah,Shoshone,Latah,Clearwater,Nez Perce,Lewis'),
  OR: C('America/Boise', 'Malheur'),
  ND: C('America/Denver', 'Adams,Billings,Bowman,Golden Valley,Grant,Hettinger,Slope,Stark'),
  SD: C('America/Denver', 'Pennington,Meade,Lawrence,Butte,Custer,Fall River,Harding,Perkins'),
  NE: C('America/Denver', 'Scotts Bluff,Box Butte,Cheyenne,Dawes,Sioux,Kimball,Banner,Morrill,Sheridan,Garden,Deuel,Keith,Perkins,Chase,Dundy'),
  KS: C('America/Denver', 'Sherman,Wallace,Greeley,Hamilton'),
});

/** Zone for a county of a state ("Knox County", "knox", "Knox Co."), or null when it is the state's zone / unknown. */
export function countyTimeZone(state, county) {
  const st = String(state || '').trim().toUpperCase();
  const map = COUNTY_TIME_ZONES[st];
  if (!map || !county) return null;
  const name = String(county).trim().toLowerCase().replace(/\./g, '').replace(/\s+(county|parish|co)$/i, '').replace(/\s+/g, ' ').trim();
  return map[name] || null;
}

const _validCache = new Map();

/** True for a zone name Intl understands (e.g. 'America/New_York', 'UTC'). */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  if (_validCache.has(tz)) return _validCache.get(tz);
  let ok = false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); ok = true; } catch { ok = false; }
  _validCache.set(tz, ok);
  return ok;
}

/** Zone for a two-letter state code, or null. */
export function stateTimeZone(state) {
  if (!state) return null;
  return STATE_TIME_ZONES[String(state).trim().toUpperCase()] || null;
}

const _fmtCache = new Map();
function partsFormatter(tz) {
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of `instant` in `tz`. */
export function zonedParts(instant, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out; // { year, month, day, hour, minute, second }
}

/** Offset (ms) of `tz` from UTC at `instant` (positive east of UTC). */
function offsetMs(instant, tz) {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/** Parse 'YYYY-MM-DD' (anything after the 10th char ignored) → {y,m,d} or null. */
export function parseDateOnly(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? ''));
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** 'YYYY-MM-DD' shifted by `days` calendar days. */
export function addDays(dateStr, days) {
  const p = parseDateOnly(dateStr);
  if (!p) return null;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * The UTC instant at which the wall clock in `tz` reads `dateStr hh:mm`.
 * For a time skipped by a DST jump the result lands just after the gap; for a
 * repeated time it is the first occurrence.
 */
export function zonedDateTimeToUtc(dateStr, hh, mm, tz) {
  const p = parseDateOnly(dateStr);
  if (!p || !isValidTimeZone(tz)) return null;
  const guess = Date.UTC(p.y, p.m - 1, p.d, hh, mm, 0);
  const t1 = guess - offsetMs(new Date(guess), tz);
  // Second pass corrects the offset when the guess and the answer straddle a DST change.
  const t2 = guess - offsetMs(new Date(t1), tz);
  const reads = (t) => { const z = zonedParts(new Date(t), tz); return z.day === p.d && z.hour === hh && z.minute === mm; };
  if (reads(Math.min(t1, t2))) return new Date(Math.min(t1, t2));   // first occurrence of a repeated time
  if (reads(Math.max(t1, t2))) return new Date(Math.max(t1, t2));
  return new Date(Math.max(t1, t2));                                  // skipped time → just after the gap
}

/** Today's calendar date ('YYYY-MM-DD') in `tz`. */
export function todayInZone(tz, now = new Date()) {
  const p = zonedParts(now, isValidTimeZone(tz) ? tz : 'UTC');
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Whole calendar days from `fromDate` to `toDate` (both 'YYYY-MM-DD'). */
export function daysBetween(fromDate, toDate) {
  const a = parseDateOnly(fromDate); const b = parseDateOnly(toDate);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** "Monday, October 12" for a date-only value (no zone shift). */
export function formatCourtDay(dateStr) {
  const p = parseDateOnly(dateStr);
  if (!p) return String(dateStr ?? '');
  return new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}
