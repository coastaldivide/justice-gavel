/**
 * services/courtReplies.js — text replies to "Did you make it to court today?" (build plan A7).
 *
 * routes/webhooks/telnyx.js hands every inbound text that is not STOP / START here. Only a
 * reply of exactly 1, 2 or 3 counts, and only from a number that was asked in the last 48
 * hours; it answers the NEWEST question sent to that number — an app user's hearing
 * (court_dates.asked_phone) or a Bond Desk defendant's (bd_reminders step 'ask'):
 *   1 → attended, 2 → rescheduled, 3 → missed (the morning-after "act today" message is sent now).
 * Anything else changes nothing. A short confirmation is texted back (never to a STOP number).
 */
import { getDb } from '../db/index.js';
import { sendSms, smsLive } from './sms.js';
import { msg, formatDay, userLang } from '../i18n/index.js';
import { fitSms } from './smsText.js';
import { scheduleForCourtDate, refreshNextCourtDate, dateOnly, missedCourtLink } from './courtReminders.js';
import { parseCourtReply, lastBondAsk, handleBondReply } from './bondDesk/courtDates.js';
import logger from '../utils/logger.js';
import { logIgnored } from '../utils/ignored.js';

async function lastAppAsk(db, phone, now) {
  const r = await db.get(
    `SELECT cd.id, cd.asked_at FROM court_dates cd JOIN cases c ON c.id = cd.case_id
      WHERE cd.asked_phone = ? AND cd.asked_at > CAST(? AS timestamptz) - INTERVAL '48 hours'
        AND cd.deleted_at IS NULL AND c.deleted_at IS NULL
      ORDER BY cd.asked_at DESC LIMIT 1`, [phone, now.toISOString()]);
  return r ? { court_date_id: Number(r.id), sent_at: new Date(r.asked_at) } : null;
}

async function textBack(db, to, body) {
  if (!smsLive()) return false;
  const out = await db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [to]);
  if (out) return false;
  const r = await sendSms({ to, body });
  return !!r?.ok;
}

/** An app user answered by text. */
async function handleAppReply(db, { from, answer, courtDateId, now }) {
  const cd = await db.get(
    `SELECT cd.id, cd.case_id, cd.user_id, cd.court_date, cd.status, c.title, c.state
       FROM court_dates cd JOIN cases c ON c.id = cd.case_id WHERE cd.id = ?`, [courtDateId]);
  if (!cd) return { handled: false };
  const upd = await db.run(
    `UPDATE court_dates SET status = ?, status_source = 'reply', status_at = ?, updated_at = NOW()
      WHERE id = ? AND deleted_at IS NULL AND status <> 'cancelled'`, [answer, now.toISOString(), cd.id]);
  const applied = !!upd?.changes;
  const lang = await userLang(db, Number(cd.user_id));
  const day = formatDay(dateOnly(cd.court_date), lang);
  if (applied) {
    await scheduleForCourtDate(db, cd.id, now);   // cancels what is left; "missed" queues the morning-after message now
    await refreshNextCourtDate(db, Number(cd.case_id), now);
    if (answer === 'rescheduled') {
      const { notifyFollowersCourtDateChanged } = await import('./followers.js');
      notifyFollowersCourtDateChanged(db, Number(cd.case_id), 'changed').catch(logIgnored('services/courtReplies'));
    }
  }
  if (applied && answer === 'missed') {
    const { dispatchDueReminders } = await import('./reminderDispatcher.js');
    await dispatchDueReminders({ db, now, courtDateId: cd.id });
    const sent = await db.get(
      `SELECT channel FROM scheduled_pushes WHERE court_date_id = ? AND notification_type = 'court_missed_followup' AND status = 'sent'
        ORDER BY id DESC LIMIT 1`, [cd.id]);
    if (String(sent?.channel || '').includes('sms')) return { handled: true, court_date_id: cd.id, status: answer, applied };
  }
  const key = applied ? `reminder.reply.${answer}` : 'reminder.reply.noted';
  await textBack(db, from, fitSms(() => msg(lang, key, { day, link: missedCourtLink(lang) }), {}, []));
  return { handled: true, court_date_id: cd.id, status: applied ? answer : cd.status, applied };
}

/**
 * → { handled: false } for anything that is not an answer to a recent question, else
 *   { handled: true, kind: 'app'|'bond_desk', court_date_id, status, applied }.
 */
export async function handleCourtReplyText({ from, text, now = new Date(), db: dbArg } = {}) {
  const answer = parseCourtReply(text);
  if (!answer || !from) return { handled: false };
  const db = dbArg || await getDb();
  const [bd, app] = await Promise.all([lastBondAsk(db, from, now), lastAppAsk(db, from, now)]);
  if (!bd && !app) return { handled: false };
  try {
    if (bd && (!app || bd.sent_at >= app.sent_at)) {
      return { kind: 'bond_desk', ...(await handleBondReply(db, { from, answer, courtDateId: bd.court_date_id, now })) };
    }
    return { kind: 'app', ...(await handleAppReply(db, { from, answer, courtDateId: app.court_date_id, now })) };
  } catch (e) {
    logger.error({ err: e.message }, '[court-reply] not handled');
    return { handled: false, error: true };
  }
}
