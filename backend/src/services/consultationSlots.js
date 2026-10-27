/**
 * services/consultationSlots.js — consultation prices and bookable slots.
 *
 * Slots are offered in the LAWYER's time zone (the primary zone of the
 * listing's state, utils/timezone.js): "9:00 AM" means 9:00 on the lawyer's
 * wall clock. Every slot also carries `starts_at`, the exact UTC instant, so the
 * app can show it in the person's own zone and the booking is stored exactly
 * (consultation_bookings.starts_at + time_zone). DST is handled by
 * zonedDateTimeToUtc.
 *
 * The attorney's weekly schedule (attorney_profiles.availability_schedule, JSON
 * { mon: ['morning','afternoon'], … }) decides the days and parts of the day;
 * without one, Monday–Friday morning + afternoon.
 */
import { stateTimeZone, DEFAULT_TIME_ZONE, zonedDateTimeToUtc, todayInZone, addDays, isValidTimeZone } from '../utils/timezone.js';
import { LOCALES, normalizeLang, htDay } from '../i18n/index.js';

/** Platform fee (cents) per duration (minutes) — the only prices the app shows or charges. */
export const FEE_BY_DURATION = Object.freeze({ 15: 1000, 30: 1500, 60: 2500 });
/** Full refund when cancelled more than this many hours before the start. */
export const REFUND_CUTOFF_HOURS = 0;   // 0 = platform fee non-refundable once confirmed (owner decision, Oct 26 2026)
/** A booking waiting for its payment holds the slot this long. */
export const PENDING_HOLD_MINUTES = 30;
/** Earliest bookable start: this long from now. */
const MIN_LEAD_MINUTES = 60;

export const usd = (cents) => `$${(cents / 100).toFixed(2)}`;

/** "Monday, May 4 · 9:00 AM CDT" in `lang`, in the zone the booking was made in. */
export function slotLabel(startsAt, timeZone, lang = 'en') {
  const d = new Date(startsAt);
  const l = normalizeLang(lang) || 'en';
  const loc = LOCALES[l];
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const time = d.toLocaleTimeString(loc, { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  if (l === 'ht') {
    // ICU has no Haitian Creole: the day in the booking's zone, written by htDay().
    const [y, m, dd] = d.toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
    return `${htDay(new Date(Date.UTC(y, m - 1, dd, 12)))} · ${time}`;
  }
  return `${d.toLocaleDateString(loc, { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' })} · ${time}`;
}

export function pricing() {
  return Object.entries(FEE_BY_DURATION).map(([min, cents]) => ({ duration_min: Number(min), fee_cents: cents, fee_display: usd(cents) }));
}

const SLOT_TIMES = {
  morning:   ['9:00 AM', '10:00 AM', '11:00 AM'],
  afternoon: ['1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM'],
  evening:   ['5:00 PM', '6:00 PM'],
};
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_SCHEDULE = { mon: ['morning', 'afternoon'], tue: ['morning', 'afternoon'], wed: ['morning', 'afternoon'], thu: ['morning', 'afternoon'], fri: ['morning', 'afternoon'] };

/** "9:00 AM" → [9, 0]; anything else → null. */
export function parseSlotTime(slot) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(String(slot || ''));
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  const min = Number(m[2]);
  return min < 60 ? [h, min] : null;
}

export function lawyerTimeZone(state) {
  return stateTimeZone(state) || DEFAULT_TIME_ZONE;
}

export function parseSchedule(raw) {
  if (!raw) return null;
  try {
    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch { return null; }
}

/**
 * Days with slots for the next `days` days (from tomorrow in the lawyer's zone).
 * `booked` = Set of 'YYYY-MM-DD|9:00 AM'. Returns
 * { time_zone, days: [{ date, times: [{ time, starts_at, available }] }] }.
 */
export function generateSlots({ timeZone, schedule = null, booked = new Set(), now = new Date(), days = 14 } = {}) {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const sched = parseSchedule(schedule) || DEFAULT_SCHEDULE;
  const today = todayInZone(tz, now);
  const out = [];
  for (let d = 1; d <= days; d++) {
    const date = addDays(today, d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const parts = Array.isArray(sched[DAY_KEYS[dow]]) ? sched[DAY_KEYS[dow]] : [];
    const times = [];
    for (const part of parts) {
      for (const time of SLOT_TIMES[part] || []) {
        const [h, m] = parseSlotTime(time);
        const start = zonedDateTimeToUtc(date, h, m, tz);
        times.push({
          time,
          starts_at: start.toISOString(),
          available: !booked.has(`${date}|${time}`) && start.getTime() - now.getTime() >= MIN_LEAD_MINUTES * 60_000,
        });
      }
    }
    if (times.length) out.push({ date, times });
  }
  return { time_zone: tz, days: out };
}

/** The slot `date` + `time` if it is one this lawyer offers (available or not), else null. */
export function findSlot(slots, date, time) {
  const day = slots.days.find(d => d.date === date);
  return day?.times.find(t => t.time === String(time || '').trim().toUpperCase().replace(/\s+/g, ' ')) || null;
}
