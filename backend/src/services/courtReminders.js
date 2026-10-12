/**
 * services/courtReminders.js — court-date reminders (the "never miss court" promise).
 *
 * Model
 *   A case's court date is a date-only value ('YYYY-MM-DD'). Whenever a case is
 *   created or its court date changes, the standard reminder set is (re)written
 *   to `scheduled_pushes` (notification_type 'court_reminder', one row per
 *   reminder, dedupe_key court:<case>:<date>:<days>):
 *
 *     7 days before   09:00   "Court date in 7 days"
 *     3 days before   09:00   "Court date in 3 days"
 *     1 day before    18:00   "Court date TOMORROW"
 *     the day itself  06:30   "Court date TODAY"
 *
 *   Times are wall-clock times in the USER'S time zone (users.timezone, sent
 *   by the app), falling back to the zone of the case's state, then
 *   DEFAULT_TIME_ZONE. A reminder whose time has already passed is skipped; if
 *   that leaves none while the court date is still today or later, one is sent
 *   right away so a late-added date still gets a reminder.
 *
 *   Court reminders are free for every account (no subscription gate) and are
 *   delivered by services/reminderDispatcher.js: push to the user's registered
 *   devices, falling back to email when no push could be sent. The dispatcher
 *   re-checks the case at send time, so a deleted/closed case or a changed date
 *   never produces a stale reminder.
 */
import logger from '../utils/logger.js';
import {
  DEFAULT_TIME_ZONE, isValidTimeZone, stateTimeZone, zonedDateTimeToUtc,
  addDays, todayInZone, daysBetween, formatCourtDay, parseDateOnly,
} from '../utils/timezone.js';

export const COURT_REMINDER_PLAN = Object.freeze([
  { days: 7, hh: 9,  mm: 0,  title: '📅 Court date in 7 days' },
  { days: 3, hh: 9,  mm: 0,  title: '⚠️ Court date in 3 days' },
  { days: 1, hh: 18, mm: 0,  title: '🚨 Court date TOMORROW' },
  { days: 0, hh: 6,  mm: 30, title: '🏛️ Court date TODAY' },
]);

/** Case statuses after which no court reminder should go out. */
export const CLOSED_CASE_STATUSES = new Set(['Closed', 'Dismissed', 'Expunged', 'Transferred']);

function titleForDaysLeft(days) {
  if (days <= 0) return '🏛️ Court date TODAY';
  if (days === 1) return '🚨 Court date TOMORROW';
  return `📅 Court date in ${days} days`;
}

function bodyFor(caseTitle, courtDate, days) {
  const day = formatCourtDay(courtDate);
  const t = String(caseTitle || 'Your case').slice(0, 120);
  if (days <= 0) return `${t} — your court appearance is today (${day}). Arrive early and bring your paperwork.`;
  if (days === 1) return `${t} — court is tomorrow, ${day}. Be on time and bring all documents.`;
  return `${t} — court on ${day}. Review your case and contact your lawyer.`;
}

/** Remember the user's IANA zone if valid and new. Returns true when it changed. */
export async function rememberTimeZone(db, userId, tz) {
  if (!userId || !isValidTimeZone(tz)) return false;
  const row = await db.get('SELECT timezone FROM users WHERE id = ?', [userId]).catch(() => null);
  if (!row || row.timezone === tz) return false;
  await db.run('UPDATE users SET timezone = ? WHERE id = ?', [tz, userId]);
  return true;
}

/** Zone used for a user's reminders: stored user zone → case state zone → default. */
export async function resolveReminderTimeZone(db, userId, state) {
  const row = await db.get('SELECT timezone FROM users WHERE id = ?', [userId]).catch(() => null);
  if (row && isValidTimeZone(row.timezone)) return { tz: row.timezone, source: 'user' };
  const st = stateTimeZone(state);
  if (st) return { tz: st, source: 'state' };
  return { tz: DEFAULT_TIME_ZONE, source: 'default' };
}

/** Pending court reminders for a case (or all of a user's cases). */
export async function listPendingCourtReminders(db, userId, caseId = null) {
  const params = [userId];
  let sql = `SELECT id, case_id, title, body, deliver_at, data
               FROM scheduled_pushes
              WHERE user_id = ? AND notification_type = 'court_reminder' AND status = 'pending'`;
  if (caseId) { sql += ' AND case_id = ?'; params.push(caseId); }
  sql += ' ORDER BY deliver_at ASC';
  const rows = await db.all(sql, params);
  return rows.map(r => {
    let data = {};
    try { data = JSON.parse(r.data || '{}'); } catch { /* keep {} */ }
    return {
      id: Number(r.id), case_id: r.case_id == null ? null : Number(r.case_id),
      title: r.title, body: r.body,
      deliver_at: r.deliver_at instanceof Date ? r.deliver_at.toISOString() : r.deliver_at,
      court_date: data.court_date || null, days_before: data.days_before ?? null, time_zone: data.time_zone || null,
    };
  });
}

/** Cancel every not-yet-sent court reminder of a case. */
export async function cancelCourtReminders(db, userId, caseId, reason = 'case_changed') {
  await db.run(
    `UPDATE scheduled_pushes SET status = 'cancelled', error = ?
      WHERE user_id = ? AND case_id = ? AND notification_type = 'court_reminder' AND status = 'pending'`,
    [reason, userId, caseId]
  );
}

/**
 * (Re)write the reminder set for one case. Idempotent: pending reminders of the
 * case are cancelled first. Returns { time_zone, tz_source, reminders: [...] }.
 */
export async function scheduleCourtReminders(db, { userId, caseId, caseTitle, courtDate, state = null, now = new Date() }) {
  await cancelCourtReminders(db, userId, caseId, 'rescheduled');
  const date = parseDateOnly(courtDate) ? String(courtDate).slice(0, 10) : null;
  const { tz, source } = await resolveReminderTimeZone(db, userId, state);
  if (!date) return { time_zone: tz, tz_source: source, reminders: [] };

  const today = todayInZone(tz, now);
  const daysLeft = daysBetween(today, date);
  if (daysLeft === null || daysLeft < 0) return { time_zone: tz, tz_source: source, reminders: [] };

  const planned = [];
  for (const step of COURT_REMINDER_PLAN) {
    const at = zonedDateTimeToUtc(addDays(date, -step.days), step.hh, step.mm, tz);
    if (at && at.getTime() > now.getTime()) planned.push({ ...step, at });
  }
  if (!planned.length) {
    // Date added late (e.g. the evening before): remind right away instead of never.
    planned.push({ days: daysLeft, at: now, title: titleForDaysLeft(daysLeft), immediate: true });
  }

  for (const p of planned) {
    const data = {
      type: 'court_reminder', screen: 'Cases', case_id: caseId,
      court_date: date, days_before: p.days, time_zone: tz,
    };
    await db.run(
      `INSERT INTO scheduled_pushes
         (user_id, push_token, title, body, data, deliver_at, notification_type, case_id, status, priority, dedupe_key)
       VALUES (?, NULL, ?, ?, ?, ?, 'court_reminder', ?, 'pending', 'high', ?)`,
      [userId, p.title, bodyFor(caseTitle, date, p.days), JSON.stringify(data), p.at.toISOString(),
       caseId, `court:${caseId}:${date}:${p.days}${p.immediate ? ':now' : ''}`]
    );
  }
  const reminders = await listPendingCourtReminders(db, userId, caseId);
  logger.info({ userId, caseId, count: reminders.length, tz, tzSource: source }, '[court-reminders] scheduled');
  return { time_zone: tz, tz_source: source, reminders };
}

/** Re-plan reminders for all of a user's open cases with a future court date (after a time-zone change). */
export async function rescheduleUserCourtReminders(db, userId, now = new Date()) {
  const cases = await db.all(
    `SELECT id, title, next_court_date, state, status FROM cases
      WHERE user_id = ? AND deleted_at IS NULL AND next_court_date IS NOT NULL
        AND next_court_date >= CURRENT_DATE - 1`,
    [userId]
  );
  let n = 0;
  for (const c of cases) {
    if (CLOSED_CASE_STATUSES.has(c.status)) continue;
    await scheduleCourtReminders(db, {
      userId, caseId: Number(c.id), caseTitle: c.title, courtDate: dateOnly(c.next_court_date), state: c.state, now,
    });
    n++;
  }
  return n;
}

/** Normalise a DATE column value (pg may hand back a Date at local midnight) to 'YYYY-MM-DD'. */
export function dateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear(); const m = v.getMonth() + 1; const d = v.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

/**
 * Self-healing sweep: plan reminders for every open, non-deleted case whose
 * court date is still ahead (in any zone) and which has no reminder row for
 * that date yet. Covers cases created before this scheduler existed, cases of
 * users who were excluded by the old paid-tier gate, and any write that failed.
 * Returns the number of cases planned.
 */
export async function backfillCourtReminders(db, { now = new Date(), limit = 500 } = {}) {
  const rows = await db.all(
    `SELECT c.id, c.user_id, c.title, c.next_court_date, c.state, c.status
       FROM cases c
      WHERE c.deleted_at IS NULL
        AND c.next_court_date IS NOT NULL
        AND c.next_court_date >= (CAST(? AS timestamptz) AT TIME ZONE 'UTC')::date - 1
        AND c.user_id IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM scheduled_pushes sp
               WHERE sp.case_id = c.id AND sp.notification_type = 'court_reminder'
                 AND sp.status IN ('pending','sending','sent','skipped','failed')
                 AND sp.data LIKE '%"court_date":"' || CAST(c.next_court_date AS text) || '"%')
      ORDER BY c.next_court_date ASC
      LIMIT ?`,
    [now.toISOString(), limit]
  );
  let planned = 0;
  for (const c of rows) {
    if (CLOSED_CASE_STATUSES.has(c.status)) continue;
    try {
      const r = await scheduleCourtReminders(db, {
        userId: Number(c.user_id), caseId: Number(c.id), caseTitle: c.title,
        courtDate: dateOnly(c.next_court_date), state: c.state, now,
      });
      if (r.reminders.length) planned++;
    } catch (e) {
      logger.warn({ caseId: c.id, err: e.message }, '[court-reminders] backfill failed for case');
    }
  }
  if (planned) logger.info({ planned }, '[court-reminders] backfill');
  return planned;
}
