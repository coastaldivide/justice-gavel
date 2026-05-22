/**
 * dateUtils.ts — Shared date calculation utilities
 * Used across CaseScreen, CheckInScreen, AttorneyDashboard, CheckInManager,
 * ExpungementScreen, FirmVertical, HomeScreen
 */

/** Days until a date (negative = overdue). Returns null if date is invalid. */
export function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime();
  if (isNaN(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86_400_000);
}

/** Days since a date (negative = in future). Returns null if date is invalid. */
export function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime();
  if (isNaN(ms)) return null;
  return Math.ceil((Date.now() - ms) / 86_400_000);
}

/** Format a date string for display (e.g. "Jan 15, 2026") */
export function formatDate(
  dateStr: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--';
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
