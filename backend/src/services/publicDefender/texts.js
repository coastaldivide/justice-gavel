/**
 * services/publicDefender/texts.js — texts between a public defender office and its clients
 * (A11 steps 3 and 4; docs/PUBLIC_DEFENDER.md "Reminders" and "Two-way messages").
 *
 * Reminders: every client hearing (pd_court_dates) gets the Bond Desk / app plan
 * (services/courtReminders.js COURT_REMINDER_PLAN: 7 and 3 days before at 09:00, the evening before
 * at 18:00, the morning of at 06:30; one text at once when added too late), "Did you make it to
 * court today? Reply 1 / 2 / 3" at 15:00 on the day and, unless the hearing is marked attended /
 * rescheduled / cancelled by then, the morning-after "act today" text at 09:00 — wall-clock times
 * in the office's zone (county → state → default). Every text starts with the office's name
 * ("{office}: …") and ends "Reply STOP to opt out". Nothing is texted before an office admin ticked
 * the consent basis, to a client whose reminders are off, or to a number that replied STOP.
 *
 * Texts are a platform cost included in the office's annual fee: they are NOT written to bd_texts
 * (no per-text billing). Each text sent or received is a pd_messages row (body encrypted,
 * services/encryption.js) with the carrier's id, so sms_delivery shows its delivery status.
 *
 * Replies (routes/webhooks/telnyx.js):
 *   1 / 2 / 3 answering the newest "Did you make it?" of the last 48 hours → that hearing's status
 *     (services/courtReplies.js picks the newest question among app users, Bond Desk and offices)
 *   anything else that is not STOP / START / HELP / 1 / 2 / 3 → the shared inbox of the office whose
 *     client has that number (several offices: the one that texted it most recently)
 */
import { toE164, sendSms, smsLive } from '../sms.js';
import { encrypt } from '../encryption.js';
import { msg, formatDayShort, formatTime, normalizeLang } from '../../i18n/index.js';
import { zonedDateTimeToUtc, addDays, todayInZone, daysBetween, DEFAULT_TIME_ZONE } from '../../utils/timezone.js';
import { planSteps, ASK_AT, FOLLOWUP_AT, missedCourtLink, dateOnly, timeOnly } from '../courtReminders.js';
import { parseCourtReply } from '../bondDesk/courtDates.js';
import { fitSms } from '../smsText.js';
import { sendPushToUser } from '../pushDelivery.js';
import { publicDefenderEnabled } from '../../utils/counselFlags.js';
import logger from '../../utils/logger.js';
import { logIgnored } from '../../utils/ignored.js';
import { PdError, officeTimeZone, firstName } from './common.js';

export const REMINDER_STEPS = Object.freeze(['d7', 'd3', 'd1', 'd0', 'now']);
const KIND = { ask: 'ask', missed: 'missed' };
const kindOf = (step) => KIND[step] || 'reminder';
const STALE_CLAIM_MS = 10 * 60_000;
export const STAFF_TEXT_MAX = 480;
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'UNSTOP']);
const HELP_WORDS = new Set(['HELP', 'INFO']);

// ── Wording ───────────────────────────────────────────────────────────────────

/**
 * The text for one step, within 2 segments in English (accents kept in es / pt / vi).
 * ctx: { lang, office, officePhone, client, courtDate, courtTime, courtName, room, daysLeft }
 */
export function pdCourtText(step, ctx) {
  const lang = normalizeLang(ctx.lang) || 'en';
  const day = formatDayShort(ctx.courtDate, lang);
  const time = formatTime(ctx.courtTime, lang);
  const at = time ? msg(lang, 'reminder.at_time', { time }) : '';
  const fields = { office: ctx.office || msg(lang, 'pd.sms.your_office'), first: firstName(ctx.client), court: ctx.courtName || '' };
  const shrink = [['court', 0], ['office', 18], ['first', 10]];
  const where = (f) => (f.court ? msg(lang, 'bd.sms.at_court', { court: f.court, room: ctx.room ? msg(lang, 'bd.sms.room', { room: String(ctx.room).slice(0, 12) }) : '' }) : '');
  if (step === 'ask') return fitSms((f) => msg(lang, 'pd.sms.court_ask', { office: f.office, first: f.first }), fields, shrink);
  if (step === 'missed') {
    const phone = ctx.officePhone ? msg(lang, 'pd.sms.office_phone', { phone: ctx.officePhone }) : '';
    return fitSms((f) => msg(lang, 'pd.sms.court_missed', { office: f.office, first: f.first, day, phone, link: missedCourtLink(lang) }), fields, shrink);
  }
  const d = Number(ctx.daysLeft);
  const when = d <= 0 ? msg(lang, 'bd.sms.when_today', { day, at }) : d === 1 ? msg(lang, 'bd.sms.when_tomorrow', { day, at })
    : msg(lang, 'bd.sms.when_days', { days: d, day, at });
  return fitSms((f) => msg(lang, 'pd.sms.court', { office: f.office, first: f.first, when, where: where(f) }).replace(/\.\.(?=\s|$)/g, '.'), fields, shrink);
}

/** The confirmation texted back after a reply 1 / 2 / 3. */
export function pdReplyText(answer, { lang, office, client, courtDate, officePhone }) {
  const l = normalizeLang(lang) || 'en';
  const key = { attended: 'pd.sms.reply_attended', rescheduled: 'pd.sms.reply_rescheduled', missed: 'pd.sms.reply_missed' }[answer] || 'pd.sms.reply_noted';
  const phone = officePhone ? msg(l, 'pd.sms.office_phone', { phone: officePhone }) : '';
  return fitSms((f) => msg(l, key, { office: f.office, first: firstName(client), day: formatDayShort(courtDate, l), phone, link: missedCourtLink(l) }),
    { office: office || msg(l, 'pd.sms.your_office') }, [['office', 14]]);
}

// ── Sending one text ──────────────────────────────────────────────────────────

async function logMessage(db, { officeId, clientId, direction, kind, body, status, providerId = null, sentBy = null, read = false }) {
  const row = await db.get(
    `INSERT INTO pd_messages (office_id, pd_client_id, direction, kind, body, status, provider_id, sent_by, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${read || direction === 'out' ? 'NOW()' : 'NULL'}) RETURNING id`,
    [officeId, clientId, direction, kind, encrypt(String(body)), status, providerId, sentBy]);
  return Number(row.id);
}

/**
 * Text a client for an office. Never to a number that replied STOP. Logged (pd_messages) when the
 * carrier accepted it, or failed. → { status: 'sent'|'skipped'|'failed'|'opted_out', messageId, providerId }
 */
export async function sendOfficeText(db, { officeId, clientId, to, body, kind, sentBy = null }) {
  const dest = toE164(to);
  if (!dest) return { status: 'skipped', messageId: null, providerId: null, error: 'no_valid_number' };
  const out = await db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [dest]);
  if (out) return { status: 'opted_out', messageId: null, providerId: null };
  if (!smsLive()) return { status: 'skipped', messageId: null, providerId: null, error: 'sms_not_configured' };
  const r = await sendSms({ to: dest, body });
  if (!r?.ok) {
    if (r?.skipped) return { status: 'skipped', messageId: null, providerId: null, error: r.reason || null };
    const messageId = await logMessage(db, { officeId, clientId, direction: 'out', kind, body, status: 'failed', sentBy });
    return { status: 'failed', messageId, providerId: null, error: r?.error || null };
  }
  const messageId = await logMessage(db, { officeId, clientId, direction: 'out', kind, body, status: 'sent', providerId: r.id || null, sentBy });
  await db.run('UPDATE pd_clients SET last_texted_at = NOW(), last_message_at = NOW() WHERE id = ?', [clientId]);
  return { status: 'sent', messageId, providerId: r.id || null };
}

// ── Loading ───────────────────────────────────────────────────────────────────

async function courtCtx(db, courtDateId) {
  return db.get(
    `SELECT cd.id, cd.pd_client_id, cd.office_id, cd.court_date, cd.court_time, cd.court_name, cd.room, cd.status, cd.status_source,
            cd.asked_at, cd.deleted_at,
            c.name AS client_name, c.phone, c.lang, c.reminders_on,
            o.name AS office_name, o.phone AS office_phone, o.state, o.county, o.status AS office_status, o.consent_basis_at
       FROM pd_court_dates cd JOIN pd_clients c ON c.id = cd.pd_client_id JOIN pd_offices o ON o.id = cd.office_id
      WHERE cd.id = ?`, [courtDateId]);
}

function withLock(db, courtDateId, fn) {
  if (db?.engine !== 'postgres' || typeof db.transaction !== 'function') return fn(db);
  return db.transaction(async (tx) => {
    await tx.get(`SELECT pg_advisory_xact_lock(hashtext('pd_court_date_reminders'), CAST(? AS integer)) AS locked`, [Number(courtDateId) % 2147483647]);
    return fn(tx);
  });
}

/** Why nothing may be texted about this hearing at all (null = it may). */
function blockReason(c) {
  if (!c || c.deleted_at) return 'court_date_deleted';
  if (c.office_status !== 'active') return 'office_closed';
  if (!c.consent_basis_at) return 'no_consent_basis';
  if (!c.reminders_on) return 'reminders_off';
  return null;
}

// ── Planning ──────────────────────────────────────────────────────────────────

/** (Re)plan the texts of one hearing. → { time_zone, planned } */
export function planPdCourtDate(db, courtDateId, now = new Date()) {
  return withLock(db, courtDateId, (tx) => plan(tx, courtDateId, now));
}

async function plan(db, courtDateId, now) {
  const c = await courtCtx(db, courtDateId);
  if (!c) return { time_zone: DEFAULT_TIME_ZONE, planned: 0 };
  const tz = officeTimeZone(c);
  const day = dateOnly(c.court_date);
  const today = todayInZone(tz, now);
  let reason = blockReason(c);
  const phone = toE164(c.phone);
  const keep = [];
  if (!reason && phone) {
    const want = [];
    if (c.status === 'scheduled') {
      for (const s of planSteps(day, tz, now)) {
        if (s.immediate) {
          const done = await db.get(
            `SELECT 1 AS x FROM pd_reminders WHERE court_date_id = ? AND phone = ? AND court_day = ? AND step IN ('d7','d3','d1','d0','now')
               AND status IN ('sent','sending') LIMIT 1`, [c.id, phone, day]);
          if (done) continue;
        }
        want.push({ step: s.immediate ? 'now' : `d${s.days}`, at: s.at });
      }
      const ask = zonedDateTimeToUtc(day, ASK_AT.hh, ASK_AT.mm, tz);
      if (ask && ask.getTime() > now.getTime()) want.push({ step: 'ask', at: ask });
      const fu = zonedDateTimeToUtc(addDays(day, 1), FOLLOWUP_AT.hh, FOLLOWUP_AT.mm, tz);
      if (fu && fu.getTime() > now.getTime()) want.push({ step: 'missed', at: fu });
    }
    if (c.status === 'missed') {
      const ago = daysBetween(day, today);
      if (ago !== null && ago >= 0 && ago <= 2) want.push({ step: 'missed', at: now });
    }
    for (const w of want) {
      const row = await db.get(
        `INSERT INTO pd_reminders (court_date_id, pd_client_id, office_id, phone, step, court_day, send_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (court_date_id, phone, step, court_day) DO UPDATE
           SET send_at = EXCLUDED.send_at, status = 'pending', reason = NULL, claimed_at = NULL, updated_at = NOW()
           WHERE pd_reminders.status IN ('pending', 'cancelled', 'skipped')
         RETURNING id`,
        [c.id, c.pd_client_id, c.office_id, phone, w.step, day, w.at.toISOString()]);
      if (row) keep.push(Number(row.id));
    }
    if (c.status !== 'scheduled') reason = `court_date_${c.status}`;
  }
  if (!phone && !reason) reason = 'no_valid_number';
  await db.run(
    `UPDATE pd_reminders SET status = 'cancelled', reason = ?, updated_at = NOW()
      WHERE court_date_id = ? AND status = 'pending' AND NOT (id = ANY(CAST(? AS bigint[])))`,
    [reason || 'replanned', c.id, `{${keep.join(',')}}`]);
  await db.run('UPDATE pd_court_dates SET plan_needed = FALSE WHERE id = ?', [c.id]);
  return { time_zone: tz, planned: keep.length };
}

/** Plan every hearing marked plan_needed (bulk uploads, consent, office changes). → number planned */
export async function planPending(db, { now = new Date(), limit = 1000 } = {}) {
  const rows = await db.all('SELECT id FROM pd_court_dates WHERE plan_needed ORDER BY id LIMIT ?', [limit]);
  for (const r of rows) await planPdCourtDate(db, Number(r.id), now);
  return rows.length;
}

/** Re-plan every live hearing of one client. */
export async function planClient(db, clientId, now = new Date()) {
  const rows = await db.all('SELECT id FROM pd_court_dates WHERE pd_client_id = ? AND deleted_at IS NULL ORDER BY court_date DESC LIMIT 200', [clientId]);
  for (const r of rows) await planPdCourtDate(db, Number(r.id), now);
  return rows.length;
}

// ── Sending what is due ───────────────────────────────────────────────────────

function staleReason(r, c, tz, now) {
  const block = blockReason(c);
  if (block) return ['cancelled', block];
  if (toE164(c.phone) !== r.phone) return ['cancelled', 'number_changed'];
  if (dateOnly(c.court_date) !== dateOnly(r.court_day)) return ['cancelled', 'court_date_changed'];
  if (r.step === 'missed' ? !['scheduled', 'missed'].includes(c.status) : c.status !== 'scheduled') return ['cancelled', `court_date_${c.status}`];
  const left = daysBetween(todayInZone(tz, now), dateOnly(c.court_date));
  if (r.step === 'ask' && left !== 0) return ['skipped', 'too_late'];
  if (r.step === 'missed' && (left > 0 || left < -2)) return ['skipped', 'too_late'];
  if (REMINDER_STEPS.includes(r.step) && left < 0) return ['skipped', 'too_late'];
  return null;
}

async function sendOne(db, r, now) {
  const c = await courtCtx(db, r.court_date_id);
  const tz = c ? officeTimeZone(c) : DEFAULT_TIME_ZONE;
  const stale = staleReason(r, c, tz, now);
  if (stale) {
    await db.run('UPDATE pd_reminders SET status = ?, reason = ?, updated_at = NOW() WHERE id = ?', [stale[0], stale[1], r.id]);
    return stale[0];
  }
  const body = pdCourtText(r.step, {
    lang: c.lang, office: c.office_name, officePhone: c.office_phone, client: c.client_name,
    courtDate: dateOnly(c.court_date), courtTime: timeOnly(c.court_time), courtName: c.court_name, room: c.room,
    daysLeft: daysBetween(todayInZone(tz, now), dateOnly(c.court_date)),
  });
  const res = await sendOfficeText(db, { officeId: Number(c.office_id), clientId: Number(c.pd_client_id), to: r.phone, body, kind: kindOf(r.step) });
  if (res.status === 'sent') {
    await db.run(`UPDATE pd_reminders SET status = 'sent', message_id = ?, sent_at = ?, reason = NULL, updated_at = NOW() WHERE id = ?`, [res.messageId, now.toISOString(), r.id]);
    if (r.step === 'ask') await db.run('UPDATE pd_court_dates SET asked_at = ? WHERE id = ?', [now.toISOString(), c.id]);
    return 'sent';
  }
  const status = res.status === 'failed' ? 'failed' : 'skipped';
  await db.run('UPDATE pd_reminders SET status = ?, reason = ?, message_id = ?, updated_at = NOW() WHERE id = ?',
    [status, res.status === 'opted_out' ? 'opted_out' : String(res.error || res.status).slice(0, 80), res.messageId, r.id]);
  return status;
}

/**
 * The 'pd-court-reminders' job (every 5 minutes), or one hearing right away. Plans what bulk
 * changes left to plan, then sends what is due (rows claimed FOR UPDATE SKIP LOCKED; a claim older
 * than 10 minutes is retried). Does nothing while PUBLIC_DEFENDER_CHANNEL_ENABLED is off.
 * → { planned, claimed, sent, skipped, cancelled, failed }
 */
export async function runPdCourtReminders(db, { now = new Date(), courtDateId = null, limit = 200 } = {}) {
  if (!publicDefenderEnabled()) return { skipped_job: 'feature_off', planned: 0, claimed: 0, sent: 0, skipped: 0, cancelled: 0, failed: 0 };
  const planned = courtDateId ? 0 : await planPending(db, { now });
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const only = courtDateId ? 'AND court_date_id = ?' : '';
  const claimed = await db.all(
    `UPDATE pd_reminders SET status = 'sending', claimed_at = ?
      WHERE id IN (SELECT id FROM pd_reminders
                    WHERE ((status = 'pending' AND send_at <= ?) OR (status = 'sending' AND claimed_at < ?)) ${only}
                    ORDER BY send_at LIMIT ? FOR UPDATE SKIP LOCKED)
      RETURNING id, court_date_id, pd_client_id, phone, step, court_day`,
    courtDateId ? [nowIso, nowIso, staleIso, courtDateId, limit] : [nowIso, nowIso, staleIso, limit]);
  const counts = { planned, claimed: claimed.length, sent: 0, skipped: 0, cancelled: 0, failed: 0 };
  for (const r of claimed) {
    try {
      const out = await sendOne(db, r, now);
      counts[out] = (counts[out] || 0) + 1;
    } catch (e) {
      counts.failed += 1;
      logger.error({ id: r.id, err: e.message }, '[pd-court] text failed');
      await db.run(`UPDATE pd_reminders SET status = 'failed', reason = ?, updated_at = NOW() WHERE id = ?`, [String(e.message).slice(0, 80), r.id]).catch(logIgnored('services/publicDefender/texts'));
    }
  }
  if (counts.claimed || counts.planned) logger.info(counts, '[pd-court] run');
  return counts;
}

// ── Replies 1 / 2 / 3 ─────────────────────────────────────────────────────────

/** The newest "Did you make it?" an office texted to `phone` in the last 48 hours → { court_date_id, sent_at } | null */
export async function lastPdAsk(db, phone, now = new Date()) {
  if (!publicDefenderEnabled()) return null;
  const r = await db.get(
    `SELECT r.court_date_id, r.sent_at FROM pd_reminders r JOIN pd_court_dates cd ON cd.id = r.court_date_id AND cd.deleted_at IS NULL
      WHERE r.phone = ? AND r.step = 'ask' AND r.status = 'sent' AND r.sent_at > CAST(? AS timestamptz) - INTERVAL '48 hours'
      ORDER BY r.sent_at DESC LIMIT 1`, [phone, now.toISOString()]);
  return r ? { court_date_id: Number(r.court_date_id), sent_at: new Date(r.sent_at) } : null;
}

/**
 * A client answered "Did you make it?". Sets the hearing's status (unless office staff already set
 * it), logs the reply in the conversation, texts a confirmation (the "act today" text for missed).
 * → { handled, court_date_id, status, applied }
 */
export async function handlePdReply(db, { from, text, answer, courtDateId, now = new Date() }) {
  const c = await courtCtx(db, courtDateId);
  if (!c) return { handled: false };
  await logMessage(db, { officeId: Number(c.office_id), clientId: Number(c.pd_client_id), direction: 'in', kind: 'inbound', body: String(text ?? '').slice(0, 1600), status: 'received', read: true });
  await db.run('UPDATE pd_clients SET last_message_at = NOW() WHERE id = ?', [c.pd_client_id]);
  const upd = await db.run(
    `UPDATE pd_court_dates SET status = ?, status_source = 'reply', status_at = ?, updated_at = NOW()
      WHERE id = ? AND deleted_at IS NULL AND (status = 'scheduled' OR status_source = 'reply')`, [answer, now.toISOString(), c.id]);
  const applied = !!upd?.changes;
  if (applied) await planPdCourtDate(db, c.id, now);
  let missedSent = false;
  if (applied && answer === 'missed') missedSent = (await runPdCourtReminders(db, { now, courtDateId: c.id })).sent > 0;
  if (!missedSent) {
    const body = pdReplyText(applied ? answer : 'noted', { lang: c.lang, office: c.office_name, client: c.client_name, courtDate: dateOnly(c.court_date), officePhone: c.office_phone });
    await sendOfficeText(db, { officeId: Number(c.office_id), clientId: Number(c.pd_client_id), to: from, body, kind: 'reply_confirm' });
  }
  const fresh = await db.get('SELECT status FROM pd_court_dates WHERE id = ?', [c.id]);
  return { handled: true, court_date_id: Number(c.id), status: fresh.status, applied };
}

// ── The shared inbox ──────────────────────────────────────────────────────────

/** Does this inbound text belong in an office inbox? (not STOP / START / HELP / 1 / 2 / 3, not empty) */
export function isInboxText(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  const word = s.toUpperCase().replace(/[^A-Z]/g, '');
  if (STOP_WORDS.has(word) || START_WORDS.has(word) || HELP_WORDS.has(word)) return false;
  return !parseCourtReply(s);
}

/**
 * An inbound text from a client's number → the inbox of the office that texted that number most
 * recently (one client of that office: the most recently texted one with this number).
 * Office members get a push without the message content. → { handled, office_id?, client_id?, message_id? }
 */
export async function routeInbound(db, { from, text, now = new Date() }) {
  if (!publicDefenderEnabled() || !isInboxText(text)) return { handled: false };
  const phone = toE164(from);
  if (!phone) return { handled: false };
  const c = await db.get(
    `SELECT c.id, c.office_id FROM pd_clients c JOIN pd_offices o ON o.id = c.office_id
      WHERE c.phone = ? AND o.status = 'active'
      ORDER BY c.last_texted_at DESC NULLS LAST, c.id DESC LIMIT 1`, [phone]);
  if (!c) return { handled: false };
  const officeId = Number(c.office_id);
  const messageId = await logMessage(db, { officeId, clientId: Number(c.id), direction: 'in', kind: 'inbound', body: String(text).slice(0, 1600), status: 'received' });
  await db.run('UPDATE pd_clients SET last_inbound_at = ?, last_message_at = ? WHERE id = ?', [now.toISOString(), now.toISOString(), c.id]);
  const members = await db.all('SELECT s.user_id, u.preferred_language FROM pd_staff s JOIN users u ON u.id = s.user_id WHERE s.office_id = ? LIMIT 100', [officeId]);
  for (const m of members) {
    const l = normalizeLang(m.preferred_language) || 'en';
    sendPushToUser(Number(m.user_id), { title: msg(l, 'pd.push.inbound_title'), body: msg(l, 'pd.push.inbound_body'), data: { type: 'pd_inbound', screen: 'PdClient', client_id: Number(c.id) } })
      .catch(logIgnored('services/publicDefender/texts'));
  }
  return { handled: true, office_id: officeId, client_id: Number(c.id), message_id: messageId };
}

/**
 * Office staff text a client (POST /api/pd/clients/:id/messages). The office's name goes first;
 * never to a STOP number; nothing before the consent basis is recorded. → the message row
 */
export async function staffReply(db, { officeId, clientId, userId, text }) {
  const body = String(text ?? '').normalize('NFC').replace(/\p{Cc}/gu, (ch) => (ch === '\n' ? ch : '')).trim();
  if (!body) throw new PdError(400, 'required', { field: 'body' });
  if (body.length > STAFF_TEXT_MAX) throw new PdError(400, 'too_long', { field: 'body', max: STAFF_TEXT_MAX });
  const c = await db.get(
    `SELECT c.id, c.phone, o.name AS office_name, o.consent_basis_at FROM pd_clients c JOIN pd_offices o ON o.id = c.office_id
      WHERE c.id = ? AND c.office_id = ?`, [clientId, officeId]);
  if (!c) throw new PdError(404, 'not_found');
  if (!c.consent_basis_at) throw new PdError(409, 'consent_basis_required');
  if (await db.get('SELECT 1 AS x FROM sms_opt_outs WHERE phone = ?', [c.phone])) throw new PdError(409, 'opted_out');
  if (!smsLive()) throw new PdError(503, 'texts_unavailable');
  const res = await sendOfficeText(db, { officeId, clientId: Number(c.id), to: c.phone, body: `${c.office_name}: ${body}`, kind: 'staff', sentBy: userId });
  if (res.status === 'opted_out') throw new PdError(409, 'opted_out');
  if (res.status !== 'sent') throw new PdError(502, 'text_failed');
  return { id: res.messageId, status: res.status };
}
