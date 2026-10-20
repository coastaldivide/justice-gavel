/**
 * services/ics.js — an RFC 5545 calendar file for one court date, so the date
 * survives even if the app is deleted ("Add to phone calendar").
 *
 *  - No time stored  → an all-day event on the court day
 *                      (DTSTART;VALUE=DATE / DTEND = next day). The day never
 *                      shifts, whatever zone the phone is in.
 *  - Time stored     → a timed event in the COURT's zone (the hearing's wall-clock
 *                      time is the court's; the caller passes the zone of the
 *                      courthouse / case state, else the user's):
 *                      DTSTART;TZID=<zone>:YYYYMMDDTHHMMSS (+1 h), with a
 *                      VTIMEZONE block generated from the zone's real UTC
 *                      offsets (DST transitions of the event's year and the
 *                      year before), as RFC 5545 §3.6.5 requires for TZID.
 *  - Alarms the day before (and 2 h before a timed event); their text is the
 *    caller's (the person's language).
 * Text is escaped (\\ ; , newline) and lines are folded at 75 octets.
 */
import { zonedParts, isValidTimeZone, parseDateOnly, addDays } from '../utils/timezone.js';

const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');

export function escapeIcsText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold one content line to ≤75 octets per physical line (continuations start with a space). */
export function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0; let first = true;
  while (start < bytes.length) {
    const max = first ? 75 : 74;
    let end = Math.min(start + max, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xC0) === 0x80) end--;   // never split a UTF-8 sequence
    out.push((first ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end; first = false;
  }
  return out.join('\r\n');
}

/** Offset of `tz` from UTC at `ms`, in minutes (east positive). */
function offsetMin(ms, tz) {
  const p = zonedParts(new Date(ms), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second || 0);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

const fmtOffset = (m) => `${m < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(m) / 60))}${pad(Math.abs(m) % 60)}`;

function localStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** VTIMEZONE lines for `tz` covering `year` (and the year before, for the governing transition). */
export function vtimezoneLines(tz, year) {
  const DAY = 86_400_000;
  const startMs = Date.UTC(year - 1, 0, 1);
  const endMs = Date.UTC(year + 1, 0, 1);
  const transitions = [];
  let prev = offsetMin(startMs, tz);
  for (let t = startMs + DAY; t <= endMs; t += DAY) {
    const cur = offsetMin(t, tz);
    if (cur !== prev) {
      let lo = t - DAY; let hi = t;            // binary search to the minute
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
        if (offsetMin(mid, tz) === prev) lo = mid; else hi = mid;
      }
      transitions.push({ at: hi, from: prev, to: cur });
      prev = cur;
    }
  }
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`];
  if (!transitions.length) {
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${fmtOffset(prev)}`, `TZOFFSETTO:${fmtOffset(prev)}`, 'END:STANDARD');
  } else {
    const std = Math.min(...transitions.flatMap(x => [x.from, x.to]));
    for (const x of transitions) {
      const kind = x.to > std ? 'DAYLIGHT' : 'STANDARD';
      // DTSTART is the local wall time of the onset, in the offset in effect before it
      lines.push(`BEGIN:${kind}`, `DTSTART:${localStamp(x.at + x.from * 60_000)}`,
        `TZOFFSETFROM:${fmtOffset(x.from)}`, `TZOFFSETTO:${fmtOffset(x.to)}`, `END:${kind}`);
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

const utcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/**
 * Build the .ics text. `courtDate` 'YYYY-MM-DD' (required), `courtTime`
 * 'HH:MM' or null, `tz` IANA zone (used only for a timed event).
 */
export function buildCourtDateIcs({ uid, courtDate, courtTime = null, tz = 'America/Chicago', summary, location = null, description = null, url = null,
  alarmDayBefore = null, alarmTwoHours = null, now = new Date() }) {
  const p = parseDateOnly(courtDate);
  if (!p) throw new Error('courtDate must be YYYY-MM-DD');
  const ymd = `${p.y}${pad(p.m)}${pad(p.d)}`;
  const timed = /^\d{2}:\d{2}$/.test(String(courtTime || '')) && isValidTimeZone(tz);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Justice Gavel//Court date//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (timed) lines.push(...vtimezoneLines(tz, p.y));
  lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utcStamp(now)}`);
  if (timed) {
    const [hh, mm] = courtTime.split(':').map(Number);
    const endH = hh + 1;
    const endDate = endH >= 24 ? addDays(courtDate, 1).replace(/-/g, '') : ymd;
    lines.push(`DTSTART;TZID=${tz}:${ymd}T${pad(hh)}${pad(mm)}00`, `DTEND;TZID=${tz}:${endDate}T${pad(endH % 24)}${pad(mm)}00`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${addDays(courtDate, 1).replace(/-/g, '')}`, 'TRANSP:TRANSPARENT');
  }
  lines.push(`SUMMARY:${escapeIcsText(summary || 'Court date')}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(alarmDayBefore || `${summary || 'Court date'} tomorrow`)}`, 'TRIGGER:-P1D', 'END:VALARM');
  if (timed) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(alarmTwoHours || `${summary || 'Court date'} in 2 hours`)}`, 'TRIGGER:-PT2H', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
