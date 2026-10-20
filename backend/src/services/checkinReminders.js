/**
 * services/checkinReminders.js — post-release check-ins: the defendant's local
 * day, what is due, and the reminder push.
 *
 * Every "today" here is the DEFENDANT'S calendar day in their own time zone
 * (users.timezone, sent by the app; else the bail agent's; else
 * DEFAULT_TIME_ZONE) — never the server's UTC day, which would move an
 * evening check-in in the Americas to the next day.
 *
 *   daily   one check-in per local day
 *   weekly  one check-in per 7 local days (counted from the last one)
 *
 * Reminders: one pending `scheduled_pushes` row per enrollment
 * (notification_type 'checkin_reminder'), at 10:00 local on the day the next
 * check-in is due (18:00 when it is already past 10:00 that day). The text is
 * written in the defendant's language. services/reminderDispatcher.js re-checks
 * the enrollment and the day before sending and plans the next one after.
 */
import logger from '../utils/logger.js';
import { DEFAULT_TIME_ZONE, isValidTimeZone, todayInZone, addDays, daysBetween, zonedDateTimeToUtc } from '../utils/timezone.js';
import { msg, userLang } from '../i18n/index.js';

export const CHECKIN_FREQS = Object.freeze(['daily', 'weekly']);
export const REMINDER_TIMES = Object.freeze([{ hh: 10, mm: 0 }, { hh: 18, mm: 0 }]);

/** Zone for an enrollment: the defendant's, else the bail agent's, else the default. */
export async function enrollmentTimeZone(db, e) {
  for (const uid of [e.user_id, e.bondsman_id]) {
    if (!uid) continue;
    const u = await db.get('SELECT timezone FROM users WHERE id = ?', [uid]).catch(() => null);
    if (u && isValidTimeZone(u.timezone)) return u.timezone;
  }
  return DEFAULT_TIME_ZONE;
}

/** Local calendar day ('YYYY-MM-DD') of an instant in `tz`. */
export const localDay = (instant, tz) => todayInZone(tz, instant instanceof Date ? instant : new Date(instant));

/** Distinct local days (newest first) on which the enrollment has a check-in. */
export async function checkinDays(db, enrollmentId, tz, limit = 120) {
  const rows = await db.all(
    'SELECT checked_in_at FROM checkin_records WHERE enrollment_id = ? ORDER BY checked_in_at DESC LIMIT ?',
    [enrollmentId, limit]);
  return [...new Set(rows.map(r => localDay(r.checked_in_at, tz)))];
}

/**
 * What is due for an enrollment right now.
 * Returns { tz, today, done, last_day, next_due, streak, total }.
 *   done      the current period's check-in is in (today for daily, the last 7 days for weekly)
 *   next_due  local day the next check-in is due (today when not done)
 *   streak    consecutive periods with a check-in, ending with the current or previous one
 */
export async function checkinState(db, e, now = new Date()) {
  const tz = await enrollmentTimeZone(db, e);
  const today = todayInZone(tz, now);
  const days = await checkinDays(db, e.id, tz);
  const totalRow = await db.get('SELECT COUNT(*) AS n FROM checkin_records WHERE enrollment_id = ?', [e.id]);
  const weekly = e.check_in_freq === 'weekly';
  const last = days[0] || null;
  const sinceLast = last ? daysBetween(last, today) : null;
  const done = !!last && (weekly ? sinceLast < 7 : sinceLast === 0);
  const nextDue = !done ? today : weekly ? addDays(last, 7) : addDays(today, 1);
  // streak: consecutive periods with a check-in, ending with the current or the previous one
  let streak = 0;
  if (!weekly) {
    let expect = done ? today : addDays(today, -1);
    for (const d of days) { if (d === expect) { streak++; expect = addDays(expect, -1); } else if (d < expect) break; }
  } else if (last && sinceLast < 14) {
    streak = 1;
    for (let i = 1; i < days.length && daysBetween(days[i], days[i - 1]) <= 7; i++) streak++;
  }
  return { tz, today, done, last_day: last, next_due: nextDue, streak, total: Number(totalRow?.n || 0) };
}

/**
 * Compliance over the last `windowDays` local days (bail agent's history view):
 * { expected, completed, missed, rate } — today counts as missed only once it is over.
 */
export async function compliance(db, e, { now = new Date(), windowDays = 30 } = {}) {
  const tz = await enrollmentTimeZone(db, e);
  const today = todayInZone(tz, now);
  const windowStart = addDays(today, -(windowDays - 1));
  const enrolled = localDay(e.created_at || now, tz);
  const from = enrolled > windowStart ? enrolled : windowStart;
  const span = daysBetween(from, today) + 1;               // local days in the window, today included
  const days = (await checkinDays(db, e.id, tz, 400)).filter(d => d >= from && d <= today);
  if (e.check_in_freq === 'weekly') {
    const buckets = new Set(days.map(d => Math.floor(daysBetween(from, d) / 7)));
    const expected = Math.ceil(span / 7);
    const finished = Math.floor(span / 7);
    let missed = 0;
    for (let b = 0; b < finished; b++) if (!buckets.has(b)) missed++;
    return { expected, completed: buckets.size, missed, rate: pct(buckets.size, expected) };
  }
  const doneToday = days.includes(today);
  const closedDone = days.length - (doneToday ? 1 : 0);
  const missed = Math.max(0, (span - 1) - closedDone);    // today is not missed while it is still today
  const expected = span - 1 + (doneToday ? 1 : 0);
  return { expected, completed: days.length, missed, rate: pct(days.length, expected) };
}
const pct = (a, b) => (b > 0 ? Math.round((Math.min(a, b) / b) * 100) : null);

/** Cancel the enrollment's pending check-in reminder(s). */
export async function cancelCheckinReminders(db, enrollmentId, reason = 'rescheduled') {
  await db.run(
    `UPDATE scheduled_pushes SET status = 'cancelled', error = ?
      WHERE notification_type = 'checkin_reminder' AND status = 'pending' AND data LIKE ?`,
    [reason, `%"enrollment_id":${Number(enrollmentId)},%`]);
}

/**
 * (Re)plan the next check-in reminder of one enrollment. No reminder when the
 * enrollment is inactive, not linked to a defendant account yet, or the
 * defendant turned check-in reminders off. Returns the planned row or null.
 */
export async function planCheckinReminder(db, enrollmentId, now = new Date()) {
  const e = await db.get(
    'SELECT id, bondsman_id, user_id, defendant_name, check_in_freq, active, created_at FROM checkin_enrollments WHERE id = ?',
    [enrollmentId]);
  await cancelCheckinReminders(db, enrollmentId);
  if (!e || !Number(e.active) || !e.user_id) return null;
  const u = await db.get('SELECT notif_checkin_reminders FROM users WHERE id = ?', [e.user_id]);
  if (!u || (u.notif_checkin_reminders != null && Number(u.notif_checkin_reminders) !== 1)) return null;
  const st = await checkinState(db, e, now);
  let day = st.next_due;
  let at = null;
  for (let guard = 0; guard < 3 && !at; guard++) {
    for (const t of REMINDER_TIMES) {
      const cand = zonedDateTimeToUtc(day, t.hh, t.mm, st.tz);
      if (cand && cand.getTime() > now.getTime()) { at = cand; break; }
    }
    if (!at) day = addDays(day, 1);
  }
  if (!at) return null;
  const lang = await userLang(db, e.user_id);
  const data = { type: 'checkin_reminder', screen: 'CheckIn', enrollment_id: Number(e.id), enrollmentId: Number(e.id), day, time_zone: st.tz, lang };
  await db.run(
    `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at, notification_type, status, priority, dedupe_key)
     VALUES (?, NULL, ?, ?, ?, ?, 'checkin_reminder', 'pending', 'high', ?)`,
    [e.user_id, msg(lang, 'checkin.push.reminder_title'), msg(lang, e.check_in_freq === 'weekly' ? 'checkin.push.reminder_body_weekly' : 'checkin.push.reminder_body'),
      JSON.stringify(data), at.toISOString(), `checkin:${e.id}:${day}:${at.toISOString().slice(11, 16)}`]);
  return { enrollment_id: Number(e.id), day, deliver_at: at.toISOString(), time_zone: st.tz };
}

/** Why a planned check-in reminder must not go out (or null when it should). */
export async function checkinReminderStale(db, row, data, now = new Date()) {
  const e = await db.get(
    'SELECT id, bondsman_id, user_id, check_in_freq, active, created_at FROM checkin_enrollments WHERE id = ?',
    [Number(data.enrollment_id) || 0]);
  if (!e) return 'enrollment_missing';
  if (!Number(e.active)) return 'enrollment_inactive';
  if (Number(e.user_id) !== Number(row.user_id)) return 'enrollment_unlinked';
  const st = await checkinState(db, e, now);
  if (st.done) return 'already_checked_in';
  return null;
}

/** Plan a reminder for every active, linked enrollment that has none pending (self-healing sweep). */
export async function backfillCheckinReminders(db, { now = new Date(), limit = 500 } = {}) {
  const rows = await db.all(
    `SELECT e.id FROM checkin_enrollments e
      WHERE e.active = 1 AND e.user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM scheduled_pushes sp
                         WHERE sp.notification_type = 'checkin_reminder' AND sp.status IN ('pending', 'sending')
                           AND sp.data LIKE '%"enrollment_id":' || e.id || ',%')
      ORDER BY e.id LIMIT ?`, [limit]);
  let planned = 0;
  for (const r of rows) {
    try { if (await planCheckinReminder(db, Number(r.id), now)) planned++; }
    catch (err) { logger.warn({ enrollmentId: r.id, err: err.message }, '[checkins] reminder plan failed'); }
  }
  return planned;
}
