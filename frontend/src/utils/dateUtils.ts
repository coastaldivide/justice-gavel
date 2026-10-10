/**
 * dateUtils.ts — Shared date calculation utilities
 * Used across CaseScreen, CheckInScreen, AttorneyDashboard, CheckInManager,
 * ExpungementScreen, FirmVertical, HomeScreen
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// Exactly midnight UTC: how a calendar date comes back from an API that stored it
// as a timestamp (e.g. "2026-11-20T00:00:00.000Z" / "+00:00"). Treated as that
// calendar day, not as an instant, so it is not shown as Nov 19 in the Americas.
const MIDNIGHT_UTC = /^(\d{4})-(\d{2})-(\d{2})[T ]00:00(?::00(?:\.0+)?)?(?:Z|[+-]00(?::?00)?)$/;

/**
 * Parse a date value. Date-only strings ("YYYY-MM-DD") — and midnight-UTC
 * timestamps, which is how date-only values come back from older API builds and
 * offline caches — are interpreted as a LOCAL calendar date (midnight local
 * time). `new Date('2020-01-01')` would parse them as UTC midnight, which is the
 * previous day in the Americas. Returns null for missing/invalid input.
 */
export function parseLocalDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value.trim()) || MIDNIGHT_UTC.exec(value.trim());
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      // Reject roll-overs such as 2025-02-31
      return d.getMonth() === Number(m[2]) - 1 ? d : null;
    }
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Format a Date as a local "YYYY-MM-DD" string (no UTC shift). */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Days until a date (negative = overdue). Returns null if date is invalid. */
export function daysUntil(dateStr: string | null | undefined): number | null {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** Days since a date (negative = in future). Returns null if date is invalid. */
export function daysSince(dateStr: string | null | undefined): number | null {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  return Math.ceil((Date.now() - d.getTime()) / 86_400_000);
}

/** Format a date string for display (e.g. "Jan 15, 2026") */
export function formatDate(
  dateStr: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
): string {
  const d = parseLocalDate(dateStr);
  if (!d) return '--';
  return d.toLocaleDateString('en-US', opts);
}

/** "Today", "Tomorrow", "In X days", "X days ago", or a date string */
export function relativeDateLabel(dateStr: string | null | undefined): string {
  const days = daysUntil(dateStr);
  if (days === null) return '--';
  if (days === 0)  return 'Today';
  if (days === 1)  return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1)    return `In ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export const MS_PER_DAY  = 86_400_000;
export const MS_PER_HOUR =  3_600_000;
export const MS_PER_WEEK = 604_800_000;
