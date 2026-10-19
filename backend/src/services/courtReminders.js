/**
 * services/courtReminders.js — court-date reminders (the "never miss court" promise).
 *
 * Model
 *   A case can have many hearings (court_dates rows, migration 20). Each
 *   hearing is a date-only value ('YYYY-MM-DD') with an optional local time.
 *   Whenever a hearing is created or changed, the standard reminder set is
 *   (re)written to `scheduled_pushes` (notification_type 'court_reminder',
 *   court_date_id = the hearing, one row per reminder):
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
 *   Family followers who were invited WITH the owner's consent, accepted, and
 *   have share_reminders on get the same set (notification_type
 *   'follower_court_reminder') at wall-clock times in THEIR zone. Revoking the
 *   follow cancels theirs; the dispatcher re-checks the follow at send time.
 *
 *   cases.next_court_date is kept as the next upcoming scheduled hearing so
 *   the case list, share link and offline cache keep working.
 *
 *   Court reminders are free for every account and are delivered by
 *   services/reminderDispatcher.js (push → email → SMS). The dispatcher
 *   re-checks the hearing at send time, so a deleted/moved hearing or a
 *   closed case never produces a stale reminder.
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

/** '09:30' / '09:30:00' → '9:30 AM'; null when no time. */
export function formatCourtTime(t) {
  const m = /^(\d{2}):(\d{2})/.exec(String(t ?? ''));
  if (!m) return null;
  const h = Number(m[1]); const mm = m[2];
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

function bodyFor(caseTitle, courtDate, days, { time = null, place = null } = {}) {
  const day = formatCourtDay(courtDate);
  const at = time ? ` at ${formatCourtTime(time)}` : '';
  const where = place ? ` — ${String(place).slice(0, 120)}` : '';
  const t = String(caseTitle || 'Your case').slice(0, 120);
  if (days <= 0) return `${t} — your court appearance is today (${day}${at})${where}. Arrive early and bring your paperwork.`;
  if (days === 1) return `${t} — court is tomorrow, ${day}${at}${where}. Be on time and bring all documents.`;
  return `${t} — court on ${day}${at}${where}. Review your case and contact your lawyer.`;
}

function followerBodyFor(ownerName, courtDate, days, { time = null, place = null } = {}) {
  const who = String(ownerName || 'Your family member').slice(0, 60);
  const day = formatCourtDay(courtDate);
  const at = time ? ` at ${formatCourtTime(time)}` : '';
  const where = place ? ` — ${String(place).slice(0, 120)}` : '';
  if (days <= 0) return `${who} has court today (${day}${at})${where}.`;
  if (days === 1) return `${who} has court tomorrow, ${day}${at}${where}.`;
  return `${who} has court on ${day}${at}${where}.`;
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

function mapReminder(r) {
  let data = {};
  try { data = JSON.parse(r.data || '{}'); } catch { /* keep {} */ }
  return {
    id: Number(r.id), case_id: r.case_id == null ? null : Number(r.case_id),
    court_date_id: r.court_date_id == null ? null : Number(r.court_date_id),
    type: r.notification_type || 'court_reminder',
    title: r.title, body: r.body,
    deliver_at: r.deliver_at instanceof Date ? r.deliver_at.toISOString() : r.deliver_at,
    court_date: data.court_date || null, days_before: data.days_before ?? null, time_zone: data.time_zone || null,
  };
}

/** Pending court reminders of a user, optionally for one case and/or one hearing. */
export async function listPendingCourtReminders(db, userId, caseId = null, courtDateId = null) {
  const params = [userId];
  let sql = `SELECT id, case_id, court_date_id, notification_type, title, body, deliver_at, data
               FROM scheduled_pushes
              WHERE user_id = ? AND notification_type IN ('court_reminder', 'follower_court_reminder') AND status = 'pending'`;
  if (caseId) { sql += ' AND case_id = ?'; params.push(caseId); }
  if (courtDateId) { sql += ' AND court_date_id = ?'; params.push(courtDateId); }
  sql += ' ORDER BY deliver_at ASC LIMIT 200';
  return (await db.all(sql, params)).map(mapReminder);
}

/** Cancel every not-yet-sent court reminder of a case (owner's and followers'). */
export async function cancelCourtReminders(db, userId, caseId, reason = 'case_changed') {
  await db.run(
    `UPDATE scheduled_pushes SET status = 'cancelled', error = ?
      WHERE case_id = ? AND status = 'pending'
        AND ((notification_type = 'court_reminder' AND user_id = ?) OR notification_type = 'follower_court_reminder')`,
    [reason, caseId, userId]
  );
}

/** Cancel the not-yet-sent reminders (owner + followers) of one hearing. */
export async function cancelCourtDateReminders(db, courtDateId, reason = 'court_date_changed') {
  await db.run(
    `UPDATE scheduled_pushes SET status = 'cancelled', error = ?
      WHERE court_date_id = ? AND status = 'pending'
        AND notification_type IN ('court_reminder', 'follower_court_reminder')`,
    [reason, courtDateId]
  );
}

/** Cancel one follower's pending reminders for a case (follow revoked / left). */
export async function cancelFollowerReminders(db, followerUserId, caseId, reason = 'follow_revoked') {
  await db.run(
    `UPDATE scheduled_pushes SET status = 'cancelled', error = ?
      WHERE user_id = ? AND case_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending'`,
    [reason, followerUserId, caseId]
  );
}

/** The steps of the plan still ahead of `now` for a hearing on `date` in `tz`. */
function plannedSteps(date, tz, now) {
  const today = todayInZone(tz, now);
  const daysLeft = daysBetween(today, date);
  if (daysLeft === null || daysLeft < 0) return [];
  const planned = [];
  for (const step of COURT_REMINDER_PLAN) {
    const at = zonedDateTimeToUtc(addDays(date, -step.days), step.hh, step.mm, tz);
    if (at && at.getTime() > now.getTime()) planned.push({ ...step, at });
  }
  if (!planned.length) {
    // Date added late (e.g. the evening before): remind right away instead of never.
    planned.push({ days: daysLeft, at: now, title: titleForDaysLeft(daysLeft), immediate: true });
  }
  return planned;
}

async function insertReminder(db, { userId, type, title, body, data, at, caseId, courtDateId, dedupe }) {
  await db.run(
    `INSERT INTO scheduled_pushes
       (user_id, push_token, title, body, data, deliver_at, notification_type, case_id, court_date_id, status, priority, dedupe_key)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'pending', 'high', ?)`,
    [userId, title, body, JSON.stringify(data), at.toISOString(), type, caseId, courtDateId ?? null, dedupe]
  );
}

/** Active, consented followers of a case who asked for reminders. */
function reminderFollowers(db, caseId) {
  return db.all(
    `SELECT cfa.user_id, u.display_name, u.name
       FROM case_family_access cfa JOIN users u ON u.id = cfa.user_id
      WHERE cfa.case_id = ? AND cfa.status = 'active' AND cfa.share_reminders = 1
        AND cfa.owner_consent_at IS NOT NULL AND cfa.user_id IS NOT NULL
      LIMIT 20`, [caseId]).catch(() => []);
}

async function ownerFirstName(db, userId) {
  const u = await db.get('SELECT display_name, name FROM users WHERE id = ?', [userId]).catch(() => null);
  const n = String(u?.display_name || u?.name || '').trim();
  return n ? n.split(/\s+/)[0].slice(0, 40) : null;
}

/**
 * Run `fn(tx)` holding a per-hearing lock, so two re-plans of the same hearing
 * (a double-tapped save, a PATCH racing the backfill sweep or a time-zone
 * reschedule) cannot interleave their cancel-then-insert steps and leave two
 * pending reminder sets behind (independent review: 8 parallel PATCHes left
 * 5–8 copies of each reminder). The lock is a transaction-scoped Postgres
 * advisory lock — re-entrant inside the same transaction — and is released on
 * COMMIT/ROLLBACK. Other engines (local dev sql.js) run `fn` directly.
 */
export function withHearingLock(db, courtDateId, fn) {
  if (db?.engine !== 'postgres' || typeof db.transaction !== 'function' || !courtDateId) return fn(db);
  return db.transaction(async (tx) => {
    await tx.get(`SELECT pg_advisory_xact_lock(hashtext('court_date_reminders'), CAST(? AS integer)) AS locked`,
      [Number(courtDateId) % 2147483647]);
    return fn(tx);
  });
}

/** Plan one follower's reminders for one hearing (their own zone). */
export function scheduleFollowerReminders(db, args) {
  return withHearingLock(db, args?.courtDateId, (tx) => planFollowerReminders(tx, args));
}

async function planFollowerReminders(db, { followerId, ownerId, caseId, courtDateId, courtDate, courtTime = null, place = null, state = null, now = new Date() }) {
  await db.run(
    `UPDATE scheduled_pushes SET status = 'cancelled', error = 'rescheduled'
      WHERE user_id = ? AND court_date_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending'`,
    [followerId, courtDateId]);
  const date = parseDateOnly(courtDate) ? String(courtDate).slice(0, 10) : null;
  if (!date) return 0;
  const { tz } = await resolveReminderTimeZone(db, followerId, state);
  const owner = await ownerFirstName(db, ownerId);
  const steps = plannedSteps(date, tz, now);
  for (const p of steps) {
    await insertReminder(db, {
      userId: followerId, type: 'follower_court_reminder',
      title: p.days <= 0 ? `🏛️ ${owner || 'Family'}: court TODAY` : p.days === 1 ? `🚨 ${owner || 'Family'}: court TOMORROW` : `📅 ${owner || 'Family'}: court in ${p.days} days`,
      body: followerBodyFor(owner, date, p.days, { time: courtTime, place }),
      data: { type: 'follower_court_reminder', screen: 'Following', case_id: caseId, court_date_id: courtDateId, court_date: date, days_before: p.days, time_zone: tz },
      at: p.at, caseId, courtDateId,
      dedupe: `fcourt:${courtDateId}:${followerId}:${p.days}${p.immediate ? ':now' : ''}`,
    });
  }
  return steps.length;
}

/**
 * (Re)write the reminder set for one hearing (or, without courtDateId, the
 * legacy per-case set). Idempotent: pending reminders of the hearing are
 * cancelled first. Followers of the case get theirs re-planned too.
 * Returns { time_zone, tz_source, reminders: [...] } (the owner's).
 */
export async function scheduleCourtReminders(db, {
  userId, caseId, caseTitle, courtDate, state = null, now = new Date(),
  courtDateId = null, courtTime = null, place = null,
}) {
  if (courtDateId) await cancelCourtDateReminders(db, courtDateId, 'rescheduled');
  else await cancelCourtReminders(db, userId, caseId, 'rescheduled');
  const date = parseDateOnly(courtDate) ? String(courtDate).slice(0, 10) : null;
  const { tz, source } = await resolveReminderTimeZone(db, userId, state);
  if (!date) return { time_zone: tz, tz_source: source, reminders: [] };

  const planned = plannedSteps(date, tz, now);
  for (const p of planned) {
    await insertReminder(db, {
      userId, type: 'court_reminder', title: p.title,
      body: bodyFor(caseTitle, date, p.days, { time: courtTime, place }),
      data: {
        type: 'court_reminder', screen: 'Cases', case_id: caseId, court_date_id: courtDateId,
        court_date: date, days_before: p.days, time_zone: tz,
      },
      at: p.at, caseId, courtDateId,
      dedupe: courtDateId
        ? `court:${caseId}:${courtDateId}:${date}:${p.days}${p.immediate ? ':now' : ''}`
        : `court:${caseId}:${date}:${p.days}${p.immediate ? ':now' : ''}`,
    });
  }
  if (courtDateId && planned.length) {
    for (const f of await reminderFollowers(db, caseId)) {
      await scheduleFollowerReminders(db, {
        followerId: Number(f.user_id), ownerId: userId, caseId, courtDateId,
        courtDate: date, courtTime, place, state, now,
      }).catch(e => logger.warn({ caseId, err: e.message }, '[court-reminders] follower plan failed'));
    }
  }
  const reminders = (await listPendingCourtReminders(db, userId, caseId, courtDateId))
    .filter(r => r.type === 'court_reminder');
  logger.info({ userId, caseId, courtDateId, count: reminders.length, tz, tzSource: source }, '[court-reminders] scheduled');
  return { time_zone: tz, tz_source: source, reminders };
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

/** TIME column → 'HH:MM' or null. */
export function timeOnly(v) {
  if (v == null) return null;
  const m = /^(\d{2}):(\d{2})/.exec(String(v));
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Courthouse name for reminder text ("Davidson County Courthouse, 1 Public Sq"), or the free-text location. */
async function placeFor(db, cd) {
  if (cd.courthouse_id) {
    const ch = await db.get('SELECT name, address FROM courthouses WHERE id = ?', [cd.courthouse_id]).catch(() => null);
    if (ch) return [ch.name, ch.address].filter(Boolean).join(', ');
  }
  return cd.location || null;
}

/** Plan reminders for one court_dates row (looked up fresh, under the hearing lock). */
export function scheduleForCourtDate(db, courtDateId, now = new Date()) {
  return withHearingLock(db, courtDateId, (tx) => planForCourtDate(tx, courtDateId, now));
}

async function planForCourtDate(db, courtDateId, now) {
  const cd = await db.get(
    `SELECT cd.id, cd.case_id, cd.user_id, cd.court_date, cd.court_time, cd.courthouse_id, cd.location, cd.status, cd.deleted_at,
            c.title, c.state, c.status AS case_status, c.deleted_at AS case_deleted
       FROM court_dates cd JOIN cases c ON c.id = cd.case_id WHERE cd.id = ?`, [courtDateId]);
  if (!cd) return { time_zone: DEFAULT_TIME_ZONE, reminders: [] };
  if (cd.deleted_at || cd.case_deleted || cd.status !== 'scheduled' || CLOSED_CASE_STATUSES.has(cd.case_status)) {
    await cancelCourtDateReminders(db, courtDateId, cd.deleted_at ? 'court_date_deleted' : 'court_date_not_scheduled');
    const { tz } = await resolveReminderTimeZone(db, Number(cd.user_id), cd.state);
    return { time_zone: tz, reminders: [] };
  }
  return scheduleCourtReminders(db, {
    userId: Number(cd.user_id), caseId: Number(cd.case_id), caseTitle: cd.title,
    courtDate: dateOnly(cd.court_date), state: cd.state, now,
    courtDateId: Number(cd.id), courtTime: timeOnly(cd.court_time), place: await placeFor(db, cd),
  });
}

/**
 * Set cases.next_court_date to the case's next upcoming scheduled hearing
 * ("upcoming" in the owner's zone; null when none). Returns the date.
 */
export async function refreshNextCourtDate(db, caseId, now = new Date()) {
  const c = await db.get('SELECT user_id, state FROM cases WHERE id = ?', [caseId]);
  if (!c) return null;
  const { tz } = await resolveReminderTimeZone(db, Number(c.user_id), c.state);
  const today = todayInZone(tz, now);
  const row = await db.get(
    `SELECT MIN(court_date) AS d FROM court_dates
      WHERE case_id = ? AND deleted_at IS NULL AND status = 'scheduled' AND court_date >= CAST(? AS date)`,
    [caseId, today]);
  const next = row?.d ? dateOnly(row.d) : null;
  await db.run('UPDATE cases SET next_court_date = ? WHERE id = ?', [next, caseId]);
  return next;
}

/**
 * The case form still edits a single "next court date". Mirror that edit into
 * court_dates: moving the date moves the matching hearing, a new date adds a
 * hearing, clearing it removes the hearing it named. Returns the court_dates
 * id that now carries the date (or null).
 */
export async function syncLegacyCourtDate(db, { caseId, userId, oldDate, newDate }) {
  const find = (d) => db.get(
    `SELECT id FROM court_dates WHERE case_id = ? AND court_date = CAST(? AS date) AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    [caseId, d]);
  if (newDate && oldDate === newDate) {
    const same = await find(newDate);
    if (same) return Number(same.id);
  }
  const old = oldDate ? await find(oldDate) : null;
  if (newDate) {
    const existing = await find(newDate);
    if (existing) {
      if (old && Number(old.id) !== Number(existing.id)) {
        await db.run('UPDATE court_dates SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [old.id]);
        await cancelCourtDateReminders(db, Number(old.id), 'court_date_changed');
      }
      await db.run(`UPDATE court_dates SET status = 'scheduled', updated_at = NOW() WHERE id = ?`, [existing.id]);
      return Number(existing.id);
    }
    if (old) {
      await db.run(`UPDATE court_dates SET court_date = CAST(? AS date), status = 'scheduled', updated_at = NOW() WHERE id = ?`, [newDate, old.id]);
      return Number(old.id);
    }
    const ins = await db.get(
      `INSERT INTO court_dates (case_id, user_id, court_date) VALUES (?, ?, CAST(? AS date)) RETURNING id`,
      [caseId, userId, newDate]);
    return Number(ins.id);
  }
  if (old) {
    await db.run('UPDATE court_dates SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?', [old.id]);
    await cancelCourtDateReminders(db, Number(old.id), 'court_date_cleared');
  }
  return null;
}

/** Re-plan reminders for all of a user's upcoming hearings (after a time-zone change). */
export async function rescheduleUserCourtReminders(db, userId, now = new Date()) {
  const rows = await db.all(
    `SELECT cd.id FROM court_dates cd JOIN cases c ON c.id = cd.case_id
      WHERE cd.user_id = ? AND cd.deleted_at IS NULL AND cd.status = 'scheduled'
        AND c.deleted_at IS NULL AND cd.court_date >= CURRENT_DATE - 1
      ORDER BY cd.court_date LIMIT 200`,
    [userId]
  );
  let n = 0;
  for (const r of rows) { await scheduleForCourtDate(db, Number(r.id), now); n++; }
  // and anything this user follows (their wall-clock times moved too)
  const follows = await db.all(
    `SELECT cd.id, cd.case_id, cd.court_date, cd.court_time, cd.courthouse_id, cd.location, c.user_id AS owner_id, c.state
       FROM case_family_access cfa
       JOIN court_dates cd ON cd.case_id = cfa.case_id AND cd.deleted_at IS NULL AND cd.status = 'scheduled'
       JOIN cases c ON c.id = cfa.case_id AND c.deleted_at IS NULL
      WHERE cfa.user_id = ? AND cfa.status = 'active' AND cfa.share_reminders = 1
        AND cd.court_date >= CURRENT_DATE - 1
      LIMIT 200`, [userId]).catch(() => []);
  for (const f of follows) {
    await scheduleFollowerReminders(db, {
      followerId: userId, ownerId: Number(f.owner_id), caseId: Number(f.case_id), courtDateId: Number(f.id),
      courtDate: dateOnly(f.court_date), courtTime: timeOnly(f.court_time), place: await placeFor(db, f), state: f.state, now,
    });
  }
  return n;
}

/**
 * Self-healing sweep: (1) every open case court date that has no court_dates
 * row gets one; (2) every upcoming scheduled hearing with no reminder row for
 * its date gets its set planned. Covers legacy rows and any failed write.
 * Returns the number of hearings planned.
 */
export async function backfillCourtReminders(db, { now = new Date(), limit = 500 } = {}) {
  await db.run(
    `INSERT INTO court_dates (case_id, user_id, court_date)
     SELECT c.id, c.user_id, c.next_court_date FROM cases c
      WHERE c.next_court_date IS NOT NULL AND c.deleted_at IS NULL AND c.user_id IS NOT NULL
        AND c.next_court_date >= (CAST(? AS timestamptz) AT TIME ZONE 'UTC')::date - 1
        AND NOT EXISTS (SELECT 1 FROM court_dates cd WHERE cd.case_id = c.id AND cd.court_date = c.next_court_date)
      LIMIT 500
     ON CONFLICT DO NOTHING`, [now.toISOString()]).catch(e => logger.warn({ err: e.message }, '[court-reminders] backfill court_dates failed'));
  const rows = await db.all(
    `SELECT cd.id, c.status
       FROM court_dates cd JOIN cases c ON c.id = cd.case_id
      WHERE cd.deleted_at IS NULL AND cd.status = 'scheduled' AND c.deleted_at IS NULL
        AND cd.court_date >= (CAST(? AS timestamptz) AT TIME ZONE 'UTC')::date - 1
        AND NOT EXISTS (
              SELECT 1 FROM scheduled_pushes sp
               WHERE sp.court_date_id = cd.id AND sp.notification_type = 'court_reminder'
                 AND sp.status IN ('pending','sending','sent','skipped','failed')
                 AND sp.data LIKE '%"court_date":"' || CAST(cd.court_date AS text) || '"%')
      ORDER BY cd.court_date ASC
      LIMIT ?`,
    [now.toISOString(), limit]
  );
  let planned = 0;
  for (const r of rows) {
    if (CLOSED_CASE_STATUSES.has(r.status)) continue;
    try {
      const res = await scheduleForCourtDate(db, Number(r.id), now);
      if (res.reminders.length) planned++;
    } catch (e) {
      logger.warn({ courtDateId: r.id, err: e.message }, '[court-reminders] backfill failed for hearing');
    }
  }
  if (planned) logger.info({ planned }, '[court-reminders] backfill');
  return planned;
}
