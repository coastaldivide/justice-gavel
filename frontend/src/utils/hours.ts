/**
 * hours.ts — show a listing's stored opening hours in the app's language.
 *
 * Stored hours are Google's English weekday text joined with " | ":
 *   "Monday: 8:00 AM – 12:00 PM, 1:00 – 5:00 PM | … | Sunday: Closed"
 * Each day is re-written with localized day names and clock times; anything
 * that does not parse is not shown (never guessed). The times are the
 * provider's own wall clock.
 */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export type DayHours = { day: number; closed?: boolean; open24?: boolean; ranges?: [number, number][] };

function toMinutes(h: string, m: string | undefined, mer: string): number {
  let hh = Number(h) % 12;
  if (mer === 'PM') hh += 12;
  return hh * 60 + Number(m || 0);
}

function parseRange(txt: string): [number, number] | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i.exec(txt);
  if (!m) return null;
  const endMer = m[6].toUpperCase();
  const end = toMinutes(m[4], m[5], endMer);
  let start = m[3] ? toMinutes(m[1], m[2], m[3].toUpperCase()) : toMinutes(m[1], m[2], endMer);
  if (!m[3] && start > end) start = toMinutes(m[1], m[2], endMer === 'PM' ? 'AM' : 'PM');
  return [start, end];
}

/** Parsed week (Monday first) or null when the stored text is not the expected shape. */
export function parseWeek(hours: string | null | undefined): DayHours[] | null {
  if (!hours || typeof hours !== 'string') return null;
  const out: DayHours[] = [];
  for (const part of hours.split('|')) {
    const m = /^\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*:\s*(.+?)\s*$/i.exec(part);
    if (!m) return null;
    const day = DAYS.indexOf(m[1].toLowerCase());
    const val = m[2];
    if (/^closed$/i.test(val)) { out.push({ day, closed: true }); continue; }
    if (/^open 24 hours$/i.test(val)) { out.push({ day, open24: true }); continue; }
    const ranges: [number, number][] = [];
    for (const r of val.split(',')) {
      const pr = parseRange(r);
      if (!pr) return null;
      ranges.push(pr);
    }
    out.push({ day, ranges });
  }
  if (out.length !== 7 || new Set(out.map(d => d.day)).size !== 7) return null;
  return out.sort((a, b) => a.day - b.day);
}

/** Monday-first localized weekday name (2024-01-01 was a Monday). */
export function weekdayName(day: number, locale: string): string {
  return new Date(Date.UTC(2024, 0, 1 + day, 12)).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
}

export function clock(minutes: number, locale: string): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return new Date(Date.UTC(2024, 0, 1, Math.floor(m / 60), m % 60)).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}
