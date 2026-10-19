/**
 * services/reminderDispatcher.js — delivers due rows of `scheduled_pushes`.
 *
 * Runs every minute in every API process (independent of LIVE_REFRESH, which
 * only gates the data-refresh / outbound-bot pipeline). Set REMINDERS_ENABLED=false
 * to turn it off for a process (e.g. a one-off worker or a read replica). Several
 * processes may run it at once: rows are claimed with FOR UPDATE SKIP LOCKED, and
 * a claim older than 10 minutes (a crashed process) is retried.
 *
 * Per row, by notification_type:
 *   court_reminder  re-validated against the hearing (court_dates row still
 *                   scheduled, same date, case open and not deleted) — or, for
 *                   legacy rows without court_date_id, against the case;
 *                   respects users.notif_court_reminders.
 *                   Push → email → SMS (each skipped when not configured).
 *   follower_court_reminder  the same check plus: the family follow is still
 *                   active (consented, not revoked) with reminders on.
 *   reminder        a reminder the user set (deadlines, follow-ups). Push → email.
 *   expungement     push only; respects users.notif_expungement.
 *   engagement      marketing-style nudges; push only and ONLY when the user
 *                   opted in (users.notif_marketing = 1).
 *
 * Push goes through services/expoPush.js (EXPO_PUSH_API_URL is injectable);
 * email through services/email.js (logged, not sent, without RESEND_API_KEY —
 * recorded as channel 'email_log_only' so nobody mistakes it for delivery).
 */
import { logIgnored } from '../utils/ignored.js';
import logger from '../utils/logger.js';
import { getDb } from '../db/index.js';
import { sendExpoPush, isExpoPushToken } from './expoPush.js';
import { escapeHtml } from '../utils/sanitize.js';
import { CLOSED_CASE_STATUSES, dateOnly, backfillCourtReminders } from './courtReminders.js';
import { sendSms, smsLive } from './sms.js';

const BATCH = 50;
const STALE_CLAIM_MINUTES = 10;
const EMAIL_FALLBACK_TYPES = new Set(['court_reminder', 'follower_court_reminder', 'reminder']);
const SMS_FALLBACK_TYPES = new Set(['court_reminder', 'follower_court_reminder']);
const COURT_TYPES = new Set(['court_reminder', 'follower_court_reminder']);
const DISABLED_ACCOUNT = new Set(['suspended', 'deleted', 'disabled', 'banned']);

function parseData(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

const looksLikeEmail = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function finish(db, id, fields) {
  const sets = Object.keys(fields).map(k => `${k} = ?`);
  await db.run(`UPDATE scheduled_pushes SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(fields), id]);
}

/** Why a court reminder must not go out any more (or null when it still should). */
async function courtReminderStale(db, row, data) {
  if (!row.case_id) return 'no_case';
  const follower = row.notification_type === 'follower_court_reminder';
  if (row.court_date_id) {
    const cd = await db.get(
      `SELECT cd.court_date, cd.status, cd.deleted_at, cd.case_id, c.user_id, c.status AS case_status, c.deleted_at AS case_deleted
         FROM court_dates cd JOIN cases c ON c.id = cd.case_id WHERE cd.id = ?`, [row.court_date_id]);
    if (!cd || Number(cd.case_id) !== Number(row.case_id)) return 'court_date_missing';
    if (cd.deleted_at) return 'court_date_deleted';
    if (cd.case_deleted) return 'case_deleted';
    if (CLOSED_CASE_STATUSES.has(cd.case_status)) return 'case_closed';
    if (cd.status !== 'scheduled') return 'court_date_not_scheduled';
    if (data.court_date && dateOnly(cd.court_date) !== data.court_date) return 'court_date_changed';
    if (!follower) return Number(cd.user_id) === Number(row.user_id) ? null : 'case_missing';
    const f = await db.get(
      `SELECT id FROM case_family_access
        WHERE case_id = ? AND user_id = ? AND status = 'active' AND share_reminders = 1 AND owner_consent_at IS NOT NULL
        LIMIT 1`, [row.case_id, row.user_id]);
    return f ? null : 'follow_revoked';
  }
  if (follower) return 'court_date_missing';
  const c = await db.get('SELECT user_id, next_court_date, status, deleted_at FROM cases WHERE id = ?', [row.case_id]);
  if (!c || Number(c.user_id) !== Number(row.user_id)) return 'case_missing';
  if (c.deleted_at) return 'case_deleted';
  if (CLOSED_CASE_STATUSES.has(c.status)) return 'case_closed';
  if (data.court_date && dateOnly(c.next_court_date) !== data.court_date) return 'court_date_changed';
  return null;
}

function preferenceBlocks(type, user) {
  const on = v => v === null || v === undefined || Number(v) === 1;
  if (COURT_TYPES.has(type)) return !on(user.notif_court_reminders);
  if (type === 'expungement')    return !on(user.notif_expungement);
  if (type === 'engagement')     return Number(user.notif_marketing) !== 1;
  return false;
}

async function userPushTokens(db, userId, user) {
  const rows = await db.all('SELECT token FROM push_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 5', [userId]).catch(() => []);
  const tokens = [...rows.map(r => r.token), user.push_token].filter(isExpoPushToken);
  return [...new Set(tokens)];
}

async function sendReminderEmail(user, row, data) {
  const { sendEmail, emailLive } = await import('./email.js');
  const isCourt = COURT_TYPES.has(row.notification_type);
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#042C53;margin:0 0 12px">${escapeHtml(row.title)}</h2>
      <p style="font-size:15px;line-height:1.5">${escapeHtml(row.body || '')}</p>
      ${isCourt ? `<p style="font-size:13px;color:#555">Court date: <strong>${escapeHtml(data.court_date || '')}</strong>.
        Missing court can lead to a bench warrant — if you cannot attend, contact the court clerk or your lawyer before the date.</p>` : ''}
      <p style="font-size:12px;color:#888">You get this because reminders are on in Justice Gavel.
        Turn them off any time in Settings → Notifications. Justice Gavel is not a law firm.</p>
    </div>`;
  const text = `${row.title}\n\n${row.body || ''}${isCourt && data.court_date ? `\n\nCourt date: ${data.court_date}` : ''}`;
  const result = await sendEmail({ to: user.email, subject: String(row.title).replace(/[\r\n]+/g, ' '), html, text });
  return emailLive() && !result?.mock ? 'email' : 'email_log_only';
}

async function deliverOne(db, row, now) {
  const data = parseData(row.data);
  const type = row.notification_type || 'reminder';

  const user = await db.get(
    `SELECT id, email, phone, sms_reminders, push_token, account_status, notif_court_reminders, notif_expungement, notif_marketing
       FROM users WHERE id = ?`, [row.user_id]);
  if (!user || DISABLED_ACCOUNT.has(String(user.account_status || '').toLowerCase())) {
    return finish(db, row.id, { status: 'cancelled', error: 'user_unavailable' }).then(() => 'cancelled');
  }
  if (COURT_TYPES.has(type)) {
    const stale = await courtReminderStale(db, row, data);
    if (stale) return finish(db, row.id, { status: 'cancelled', error: stale }).then(() => 'cancelled');
  }
  if (preferenceBlocks(type, user)) {
    return finish(db, row.id, { status: 'skipped', error: 'user_preference' }).then(() => 'skipped');
  }

  // ── Push ────────────────────────────────────────────────────────────────
  const tokens = await userPushTokens(db, row.user_id, user);
  let pushError = tokens.length ? null : 'no_push_token';
  if (tokens.length) {
    const payload = { ...data, type, case_id: row.case_id ?? data.case_id ?? null, push_id: Number(row.id) };
    const tickets = await sendExpoPush(tokens.map(to => ({
      to, title: row.title, body: row.body || '', data: payload,
      sound: 'default', priority: 'high', channelId: COURT_TYPES.has(type) ? 'court_reminders' : 'default',
    })));
    const ok = tickets.find(t => t?.status === 'ok');
    if (ok) {
      await finish(db, row.id, {
        status: 'sent', channel: 'push', delivered: 1, sent_at: now.toISOString(),
        expo_ticket_id: ok.id || null, error: null,
      });
      return 'sent';
    }
    pushError = tickets.map(t => t?.message || t?.details?.error).filter(Boolean)[0] || 'push_failed';
    // Tokens Expo says are dead are removed so they are not retried forever.
    for (let i = 0; i < tickets.length; i++) {
      if (tickets[i]?.details?.error === 'DeviceNotRegistered') {
        await db.run('DELETE FROM push_tokens WHERE token = ?', [tokens[i]]).catch(logIgnored('services/reminderDispatcher'));
        await db.run('UPDATE users SET push_token = NULL WHERE push_token = ?', [tokens[i]]).catch(logIgnored('services/reminderDispatcher'));
      }
    }
  }

  // ── Fallback chain: email (when Resend is configured) → SMS (when Twilio
  //    is configured and the user opted in) → logged e-mail (dev / no
  //    provider: recorded as 'email_log_only' so nobody mistakes it for delivery).
  const canEmail = EMAIL_FALLBACK_TYPES.has(type) && looksLikeEmail(user.email);
  const { emailLive } = await import('./email.js');
  if (canEmail && emailLive()) {
    try {
      const channel = await sendReminderEmail(user, row, data);
      await finish(db, row.id, { status: 'sent', channel, delivered: 1, sent_at: now.toISOString(), error: pushError });
      return 'sent';
    } catch (e) {
      pushError = `${pushError}; email: ${e.message}`;
    }
  }
  if (SMS_FALLBACK_TYPES.has(type) && smsLive() && Number(user.sms_reminders) === 1 && user.phone) {
    const r = await sendSms({ to: user.phone, body: `${row.title} — ${row.body || ''} Reply STOP to opt out.` });
    if (r.ok) {
      await finish(db, row.id, { status: 'sent', channel: 'sms', delivered: 1, sent_at: now.toISOString(), error: pushError });
      return 'sent';
    }
    pushError = `${pushError}; sms: ${r.error || r.reason}`;
  }
  if (canEmail && !emailLive()) {
    try {
      const channel = await sendReminderEmail(user, row, data);
      await finish(db, row.id, { status: 'sent', channel, delivered: 1, sent_at: now.toISOString(), error: pushError });
      return 'sent';
    } catch (e) {
      pushError = `${pushError}; email: ${e.message}`;
    }
  }

  // ── Retry transient failures, otherwise give up ─────────────────────────
  const retries = Number(row.retry_count || 0);
  const max = Number(row.max_retries ?? 3);
  if (pushError !== 'no_push_token' && retries < max) {
    const next = new Date(now.getTime() + 5 * 60_000 * 2 ** retries);
    await finish(db, row.id, { status: 'pending', retry_count: retries + 1, deliver_at: next.toISOString(), error: pushError, claimed_at: null });
    return 'retry';
  }
  await finish(db, row.id, { status: 'failed', error: pushError });
  return 'failed';
}

/**
 * Deliver every due reminder (deliver_at <= now). `now` is injectable for tests.
 * Returns counts { claimed, sent, failed, cancelled, skipped, retry }.
 */
export async function dispatchDueReminders({ db: dbArg, now = new Date(), limit = BATCH } = {}) {
  const db = dbArg || await getDb();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  const claimed = await db.all(
    `UPDATE scheduled_pushes SET status = 'sending', claimed_at = ?
      WHERE id IN (
        SELECT id FROM scheduled_pushes
         WHERE (status = 'pending' AND deliver_at <= ?)
            OR (status = 'sending' AND claimed_at < ?)
         ORDER BY deliver_at ASC
         LIMIT ?
         FOR UPDATE SKIP LOCKED)
      RETURNING id, user_id, title, body, data, deliver_at, notification_type, case_id, court_date_id, retry_count, max_retries`,
    [nowIso, nowIso, staleIso, limit]
  );
  const counts = { claimed: claimed.length, sent: 0, failed: 0, cancelled: 0, skipped: 0, retry: 0 };
  for (const row of claimed) {
    try {
      const outcome = await deliverOne(db, row, now);
      counts[outcome] = (counts[outcome] || 0) + 1;
    } catch (e) {
      counts.failed++;
      logger.error({ id: row.id, err: e.message }, '[reminders] delivery error');
      await finish(db, row.id, { status: 'failed', error: String(e.message).slice(0, 300) }).catch(logIgnored('services/reminderDispatcher'));
    }
  }
  if (claimed.length) logger.info(counts, '[reminders] dispatch');
  return counts;
}

// ── Process-level loop ───────────────────────────────────────────────────────
let _timer = null;
let _backfillTimer = null;
let _running = false;

export function remindersEnabled() {
  return String(process.env.REMINDERS_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export function startReminderDispatcher({ intervalMs = 60_000 } = {}) {
  if (_timer) return true;
  if (!remindersEnabled()) {
    logger.info('[reminders] REMINDERS_ENABLED=false — reminder delivery is off in this process');
    return false;
  }
  const tick = async () => {
    if (_running) return;
    _running = true;
    try { await dispatchDueReminders(); }
    catch (e) { logger.warn('[reminders] dispatch failed:', e.message); }
    finally { _running = false; }
  };
  _timer = setInterval(tick, intervalMs);
  _timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
  // Plan reminders for any open case with a future court date that has none
  // (legacy rows, failed writes) — shortly after boot, then every 6 hours.
  const backfill = async () => {
    try { await backfillCourtReminders(await getDb()); }
    catch (e) { logger.warn('[reminders] backfill failed:', e.message); }
  };
  setTimeout(backfill, 15_000).unref?.();
  _backfillTimer = setInterval(backfill, 6 * 3_600_000);
  _backfillTimer.unref?.();
  logger.info(`[reminders] dispatcher running every ${Math.round(intervalMs / 1000)}s`);
  return true;
}

export function stopReminderDispatcher() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_backfillTimer) { clearInterval(_backfillTimer); _backfillTimer = null; }
}
