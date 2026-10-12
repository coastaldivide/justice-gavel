/**
 * reminders.ts — client for the reminder API.
 *
 * Court dates: the server plans the reminder set for every case with a court
 * date (7 days / 3 days / the evening before / the morning of, in the user's
 * time zone) as soon as the date is saved. planCourtReminders() re-plans and
 * returns them so the UI can say exactly when the user will be reminded.
 *
 * Other reminders (deadlines, timeline events, expungement eligibility) are
 * one-off: scheduleReminder() posts the exact instant as `deliver_at`.
 * Delivery: push to the user's devices, email when push is not possible.
 */
import { api } from './api';
import { parseLocalDate } from '../utils/dateUtils';

export type PlannedReminder = {
  id: number; case_id: number | null; title: string; body?: string;
  deliver_at: string; court_date?: string | null; days_before?: number | null;
};

/** (Re)plan a case's court-date reminders; resolves to the pending reminders. */
export async function planCourtReminders(caseId: number | string): Promise<PlannedReminder[]> {
  const res = await api.post(`/cases/${caseId}/reminders`, {});
  return Array.isArray(res.data?.reminders) ? res.data.reminders : [];
}

/**
 * Local wall-clock instant `daysBefore` days before a date-only value
 * ('YYYY-MM-DD' is a calendar day, not UTC midnight), at hour:minute.
 */
export function localReminderInstant(date: string | Date, daysBefore: number, hour = 9, minute = 0): Date | null {
  const d = parseLocalDate(date as string);
  if (!d) return null;
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBefore, hour, minute, 0, 0);
  return isNaN(at.getTime()) ? null : at;
}

/** Schedule a one-off reminder at an exact instant. */
export async function scheduleReminder(opts: {
  title: string; body?: string; deliverAt: Date; caseId?: number | string | null;
}): Promise<{ id: number; deliver_at: string }> {
  const res = await api.post('/push/reminders', {
    title: opts.title,
    body: opts.body || '',
    deliver_at: opts.deliverAt.toISOString(),
    ...(opts.caseId ? { case_id: Number(opts.caseId) } : {}),
  });
  return res.data;
}

/** "Mon, Oct 5, 9:00 AM" in the device's zone. */
export function formatReminderTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
