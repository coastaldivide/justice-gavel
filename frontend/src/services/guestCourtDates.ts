/**
 * guestCourtDates.ts — court reminders with no account (core path step 4).
 *
 * Someone who has just been released should not have to create an account
 * before the app reminds them of court. Signed out, a court date is kept on
 * this phone (AsyncStorage) and the same reminder set the server uses
 * (7 days, 3 days, the evening before, the morning of — backend
 * services/courtReminders) is scheduled as local notifications.
 *
 * After sign-in, migrateGuestCourtDates() moves each date to the account
 * (POST /court-dates, which plans push / e-mail / text reminders on the server)
 * and cancels the local notifications so nobody gets two of each.
 *
 * Web has no local notifications: dates are still saved, and the screen says
 * reminders need the phone app or an account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';   // static, like services/push.ts (web: no-op paths below)
import { parseLocalDate } from '../utils/dateUtils';

export const GUEST_KEY = 'guest_court_dates_v1';
export const MAX_GUEST_DATES = 20;

export interface GuestCourtDate {
  id: string;
  court_date: string;          // 'YYYY-MM-DD' (a calendar day, not UTC midnight)
  court_time: string | null;   // 'HH:MM' 24h, optional
  place: string | null;        // courthouse / room, free text
  notification_ids: string[];
  created_at: string;
}

export interface PlannedLocal { at: Date; kind: 'week' | 'three_days' | 'evening' | 'morning' }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A real calendar day ('2026-02-31' is not). */
export function isValidCourtDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const x = parseLocalDate(d);
  const [y, m, day] = d.split('-').map(Number);
  return !!x && x.getFullYear() === y && x.getMonth() + 1 === m && x.getDate() === day;
}
export const isValidCourtTime = (t: string): boolean => TIME_RE.test(t);

function at(day: Date, offsetDays: number, h: number, m = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offsetDays, h, m, 0, 0);
}

/**
 * The local instants to remind at, in the phone's time zone, skipping any that
 * have passed. Same times as the server (backend services/courtReminders.js COURT_REMINDER_PLAN):
 * 09:00 seven and three days before, 18:00 the evening before, 06:30 the morning of — or 1 hour
 * before a hearing that starts earlier than 07:30.
 */
export function planGuestReminders(courtDate: string, courtTime: string | null, now: Date = new Date()): PlannedLocal[] {
  const day = parseLocalDate(courtDate);
  if (!day) return [];
  let morning = at(day, 0, 6, 30);
  if (courtTime && TIME_RE.test(courtTime)) {
    const [h, m] = courtTime.split(':').map(Number);
    const hearing = at(day, 0, h, m);
    if (hearing.getTime() - 60 * 60 * 1000 < morning.getTime()) morning = new Date(hearing.getTime() - 60 * 60 * 1000);
  }
  const plan: PlannedLocal[] = [
    { at: at(day, -7, 9), kind: 'week' },
    { at: at(day, -3, 9), kind: 'three_days' },
    { at: at(day, -1, 18), kind: 'evening' },
    { at: morning, kind: 'morning' },
  ];
  return plan.filter(p => p.at.getTime() > now.getTime());
}

export async function listGuestCourtDates(): Promise<GuestCourtDate[]> {
  try {
    const raw = await AsyncStorage.getItem(GUEST_KEY);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows.filter((r: any) => r && typeof r.court_date === 'string')
      .sort((a: GuestCourtDate, b: GuestCourtDate) => (a.court_date + (a.court_time || '')).localeCompare(b.court_date + (b.court_time || ''))) : [];
  } catch { return []; }
}

async function saveAll(rows: GuestCourtDate[]): Promise<void> {
  await AsyncStorage.setItem(GUEST_KEY, JSON.stringify(rows));
}

/** Notification text builder (i18n is passed in so this file stays testable without the bundle). */
export type ReminderText = (kind: PlannedLocal['kind'], d: GuestCourtDate) => { title: string; body: string };

export interface Scheduler {
  schedule(at: Date, title: string, body: string): Promise<string>;
  cancel(id: string): Promise<void>;
}

/** expo-notifications on iOS / Android; nothing on web. */
export const deviceScheduler: Scheduler = {
  async schedule(when, title, body) {
    if (Platform.OS === 'web') return '';
    return Notifications.scheduleNotificationAsync({
      // screen: a tap opens Court dates (services/notificationRoute.ts).
      content: { title, body, data: { kind: 'guest_court_reminder', screen: 'CourtDates' } },
      // Android: the high-importance channel the server's court reminders use (services/push.ts).
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: 'court_reminders' },
    });
  },
  async cancel(id) {
    if (Platform.OS === 'web' || !id) return;
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  },
};

export const localRemindersSupported = (): boolean => Platform.OS !== 'web';

export class GuestCourtDateError extends Error {
  constructor(public code: 'bad_date' | 'bad_time' | 'past' | 'duplicate' | 'full') { super(code); }
}

/** Save a court date on this phone and schedule its reminders. → the saved row and how many reminders were set. */
export async function addGuestCourtDate(
  input: { court_date: string; court_time?: string | null; place?: string | null },
  text: ReminderText,
  scheduler: Scheduler = deviceScheduler,
  now: Date = new Date(),
): Promise<{ row: GuestCourtDate; reminders: number }> {
  const court_date = String(input.court_date || '').trim();
  const court_time = (input.court_time || '').trim() || null;
  if (!isValidCourtDate(court_date)) throw new GuestCourtDateError('bad_date');
  if (court_time && !isValidCourtTime(court_time)) throw new GuestCourtDateError('bad_time');
  const day = parseLocalDate(court_date);
  if (!day) throw new GuestCourtDateError('bad_date');
  if (at(day, 1, 0).getTime() <= now.getTime()) throw new GuestCourtDateError('past');
  const rows = await listGuestCourtDates();
  if (rows.length >= MAX_GUEST_DATES) throw new GuestCourtDateError('full');
  if (rows.some(r => r.court_date === court_date && (r.court_time || null) === court_time)) throw new GuestCourtDateError('duplicate');

  const row: GuestCourtDate = {
    id: `g${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    court_date, court_time, place: (input.place || '').trim().slice(0, 200) || null,
    notification_ids: [], created_at: now.toISOString(),
  };
  for (const p of planGuestReminders(court_date, court_time, now)) {
    const { title, body } = text(p.kind, row);
    try {
      const id = await scheduler.schedule(p.at, title, body);
      if (id) row.notification_ids.push(id);
    } catch { /* permission refused: the date is still saved and shown */ }
  }
  await saveAll([...rows, row]);
  return { row, reminders: row.notification_ids.length };
}

export async function removeGuestCourtDate(id: string, scheduler: Scheduler = deviceScheduler): Promise<void> {
  const rows = await listGuestCourtDates();
  const row = rows.find(r => r.id === id);
  if (row) for (const n of row.notification_ids) await scheduler.cancel(n);
  await saveAll(rows.filter(r => r.id !== id));
}

/**
 * Move every guest date to the signed-in account. `post` creates one server
 * court date (POST /court-dates). A date the server already has (409) counts
 * as moved. Dates that fail for another reason stay on the phone, reminders intact.
 */
export async function migrateGuestCourtDates(
  post: (body: Record<string, unknown>) => Promise<void>,
  caseTitle: string,
  scheduler: Scheduler = deviceScheduler,
): Promise<{ moved: number; kept: number }> {
  const rows = await listGuestCourtDates();
  const kept: GuestCourtDate[] = [];
  let moved = 0;
  for (const r of rows) {
    try {
      await post({ case_title: caseTitle, court_date: r.court_date, court_time: r.court_time || undefined, location: r.place || undefined });
      moved += 1;
    } catch (e: any) {
      if (e?.response?.status === 409) moved += 1; else { kept.push(r); continue; }
    }
    for (const n of r.notification_ids) await scheduler.cancel(n);
  }
  await saveAll(kept);
  return { moved, kept: kept.length };
}
