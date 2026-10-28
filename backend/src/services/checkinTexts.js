/**
 * services/checkinTexts.js — check-ins by text link (A2), the missed-check-in alert (A3)
 * and location alerts (B1). docs/CHECKINS.md has the whole flow.
 *
 * Text link (channel 'sms'):
 *   - every text to the defendant carries a personal link https://<app>/c/<token>; the token is
 *     32 random bytes, only its SHA-256 is stored (checkin_link_tokens), valid LINK_DAYS days.
 *     "Reset link" revokes every earlier token of the enrollment.
 *   - texts go through services/bondDesk/core.js sendAgentTextDetailed: never to a number that
 *     replied STOP (sms_opt_outs), recorded in bd_texts (billed 5¢ on the agent's plan invoice by
 *     services/bondDesk/textBilling.js) with the provider id that sms_delivery reports on.
 *   - the agent needs a paid bail-agent plan to send texts (as in Bond Desk); without one a text
 *     is not sent ('no_plan') — check-ins themselves stay free.
 *   - reminders: one text per local day the check-in is due, the first job run at or after
 *     10:00 in the defendant's zone, never before 09:00 or after 21:00 (quiet hours).
 *
 * Missed check-ins (job checkin-missed, hourly):
 *   - for each active enrollment, each local day that has ENDED in the defendant's zone and on
 *     which a check-in was expected without one gets exactly one checkin_missed row (unique per
 *     enrollment + day, so two instances or two runs never alert twice);
 *   - daily: every day; weekly: the day 7, 14, … days after the last check-in (or the day
 *     monitoring started). The day monitoring started or restarted is never missed, so a paused
 *     and restarted enrollment is not alerted for the paused days.
 *   - the agent is told by push and e-mail, and by text when they turned that on (5¢);
 *   - the defendant gets a gentle text with their link when the enrollment says so (default on
 *     for the text channel), sent by the checkin-texts job inside quiet hours on the next day,
 *     and only while they still have not checked in.
 *
 * Location alerts (⚖ counsel question 2.4 — CHECKIN_LOCATION_ALERTS_ENABLED, off in production
 * unless set): when a check-in shares a location and the enrollment has a home point, the
 * great-circle distance is stored on the record and the agent is alerted (push + e-mail) when it
 * is outside the radius. Location is only ever taken at a check-in the defendant chose to share.
 */
import crypto from 'node:crypto';
import logger from '../utils/logger.js';
import { addDays, daysBetween, isValidTimeZone, todayInZone, zonedParts } from '../utils/timezone.js';
import { formatDay, msg, normalizeLang, userLang } from '../i18n/index.js';
import { haversineMiles } from './geolink.js';
import { sendPushToUser } from './pushDelivery.js';
import { agentAccess, agencyFor, sendAgentEmail, sendAgentTextDetailed } from './bondDesk/core.js';
import { checkinDays, checkinState, enrollmentTimeZone, localDay } from './checkinReminders.js';

export const LINK_DAYS = 30;
export const QUIET = Object.freeze({ from: 9, to: 21 });   // texts only from 09:00 to 20:59 local
export const REMINDER_HOUR = 10;
export const MISSED_LOOKBACK_DAYS = 2;                      // catch up after a short outage, never more

const APP_URL = () => String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');
export const hashLinkToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
export const newLinkToken = () => crypto.randomBytes(32).toString('base64url');
export const checkinTextLink = (token) => `${APP_URL()}/c/${token}`;
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

/** B1 is behind a setting until counsel answers question 2.4: explicit true/false wins; unset → off in production. */
export function locationAlertsEnabled({
  flag = process.env.CHECKIN_LOCATION_ALERTS_ENABLED, appEnv = process.env.APP_ENV, nodeEnv = process.env.NODE_ENV,
} = {}) {
  const v = String(flag ?? '').trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return String(appEnv || '').toLowerCase() !== 'production' && String(nodeEnv || '').toLowerCase() !== 'production';
}

export class CheckinLinkError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

const ENROLL_FIELDS = `id, bondsman_id, user_id, defendant_name, defendant_phone, defendant_email, case_number, court_date,
  check_in_freq, active, created_at, channel, sms_consent_at, sms_consent_phone, active_since, missed_text_defendant,
  time_zone, lang, home_lat, home_lng, home_radius_miles`;

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// ── Link tokens ────────────────────────────────────────────────────────────────

/** Mint a link token for an enrollment (→ the token, shown once). `revokeOthers` = reset link. */
export async function issueLinkToken(db, enrollmentId, { revokeOthers = false, now = new Date() } = {}) {
  if (revokeOthers) {
    await db.run('UPDATE checkin_link_tokens SET revoked_at = ? WHERE enrollment_id = ? AND revoked_at IS NULL', [now.toISOString(), enrollmentId]);
  }
  const token = newLinkToken();
  await db.run('INSERT INTO checkin_link_tokens (enrollment_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [enrollmentId, hashLinkToken(token), now.toISOString(), new Date(now.getTime() + LINK_DAYS * 86_400_000).toISOString()]);
  return token;
}

/** Token → { e, tokenId }. Throws CheckinLinkError 404 link_invalid / 410 link_expired / 410 enrollment_stopped. */
export async function resolveLinkToken(db, token, now = new Date()) {
  if (!LINK_TOKEN_RE.test(String(token || ''))) throw new CheckinLinkError(404, 'link_invalid');
  const t = await db.get('SELECT id, enrollment_id, expires_at, revoked_at FROM checkin_link_tokens WHERE token_hash = ?', [hashLinkToken(token)]);
  if (!t) throw new CheckinLinkError(404, 'link_invalid');
  if (t.revoked_at || new Date(t.expires_at) <= now) throw new CheckinLinkError(410, 'link_expired');
  const e = await db.get(`SELECT ${ENROLL_FIELDS} FROM checkin_enrollments WHERE id = ?`, [t.enrollment_id]);
  if (!e || e.bondsman_id == null) throw new CheckinLinkError(404, 'link_invalid');
  if (!Number(e.active)) throw new CheckinLinkError(410, 'enrollment_stopped');
  return { e, tokenId: Number(t.id) };
}

// ── Texts ──────────────────────────────────────────────────────────────────────

/** May this agent send texts (a paid bail-agent plan, or staff)? */
export async function agentCanText(db, agentId) {
  if (!agentId) return false;
  const u = await db.get('SELECT id, role FROM users WHERE id = ?', [agentId]);
  if (!u) return false;
  const a = await agentAccess(db, u).catch(() => ({ allowed: false }));
  return !!a.allowed;
}

/** The text channel is usable: a phone the agent confirmed consent for. */
export const textReady = (e) => e.channel === 'sms' && !!e.defendant_phone && !!e.sms_consent_at
  && String(e.sms_consent_phone || '') === String(e.defendant_phone || '');

async function bondIdFor(db, e) {
  const b = await db.get('SELECT id FROM bd_bonds WHERE checkin_enrollment_id = ? AND agent_id = ? ORDER BY id DESC LIMIT 1', [e.id, e.bondsman_id]).catch(() => null);
  return b ? Number(b.id) : null;
}

/**
 * Text the defendant for an enrollment. `kind` link | reminder | missed. For reminder / missed the
 * (enrollment, kind, day) row is claimed first, so a text can never go out twice.
 * → 'sent' | 'skipped' | 'failed' | 'opted_out' | 'no_plan' | 'duplicate'
 */
export async function textDefendant(db, e, { kind, day = null, body, purpose }) {
  let rowId;
  if (kind === 'link') {
    rowId = (await db.get(`INSERT INTO checkin_texts (enrollment_id, kind, local_day) VALUES (?, 'link', ?) RETURNING id`, [e.id, day])).id;
  } else {
    const claimed = await db.get(
      `INSERT INTO checkin_texts (enrollment_id, kind, local_day) VALUES (?, ?, ?)
       ON CONFLICT (enrollment_id, kind, local_day) WHERE kind IN ('reminder', 'missed') DO NOTHING RETURNING id`, [e.id, kind, day]);
    if (!claimed) return 'duplicate';
    rowId = claimed.id;
  }
  let r = { status: 'no_plan', providerId: null, bdTextId: null };
  try {
    if (await agentCanText(db, e.bondsman_id)) {
      r = await sendAgentTextDetailed(db, { agentId: e.bondsman_id, bondId: await bondIdFor(db, e), purpose, to: e.defendant_phone, body });
    }
  } catch (err) {
    logger.warn({ err: err.message, enrollmentId: e.id }, '[checkins] text failed');
    r = { status: 'failed', providerId: null, bdTextId: null };
  }
  await db.run('UPDATE checkin_texts SET status = ?, bd_text_id = ?, provider_id = ? WHERE id = ?', [r.status, r.bdTextId, r.providerId, rowId]);
  return r.status;
}

async function agencyName(db, agentId) {
  const a = await agencyFor(db, agentId);
  return String(a.agency || a.agent_name || '').trim() || 'Justice Gavel';
}
const langOf = (e) => normalizeLang(e.lang) || 'en';

/** Send (or resend) the personal link by text. → { status, link } (the link is returned once, for the agent). */
export async function sendLinkText(db, e, { revokeOthers = false, now = new Date() } = {}) {
  const token = await issueLinkToken(db, e.id, { revokeOthers, now });
  const link = checkinTextLink(token);
  if (!textReady(e)) return { status: 'skipped', link };
  const body = msg(langOf(e), 'checkin.sms.link', { agency: await agencyName(db, e.bondsman_id), name: firstName(e.defendant_name), link });
  const status = await textDefendant(db, e, { kind: 'link', day: todayInZone(await enrollmentTimeZone(db, e), now), body, purpose: 'checkin_link' });
  return { status, link };
}

const localHour = (tz, now) => zonedParts(now, tz).hour;
const inQuietWindow = (tz, now) => { const h = localHour(tz, now); return h >= QUIET.from && h < QUIET.to; };

/**
 * The checkin-texts job (every 15 minutes): reminder texts for text-link enrollments whose
 * check-in is due today, and the gentle missed-check-in texts waiting for daytime.
 * → { reminders, missed, pruned }
 */
export async function runCheckinTexts(db, { now = new Date(), limit = 1000 } = {}) {
  let reminders = 0; let missed = 0;
  const rows = await db.all(
    `SELECT ${ENROLL_FIELDS} FROM checkin_enrollments
      WHERE active = 1 AND channel = 'sms' AND bondsman_id IS NOT NULL AND defendant_phone IS NOT NULL AND sms_consent_at IS NOT NULL
      ORDER BY id LIMIT ?`, [limit]);
  for (const e of rows) {
    try {
      if (!textReady(e)) continue;
      const tz = await enrollmentTimeZone(db, e);
      if (!inQuietWindow(tz, now)) continue;
      const st = await checkinState(db, e, now);
      const since = localDay(e.active_since || e.created_at || now, tz);
      // 1. today's reminder (not on the day monitoring started — the link text went out then)
      if (!st.done && st.today > since && localHour(tz, now) >= REMINDER_HOUR) {
        const sent = await db.get(`SELECT 1 AS x FROM checkin_texts WHERE enrollment_id = ? AND kind = 'reminder' AND local_day = ?`, [e.id, st.today]);
        if (!sent) {
          const token = await issueLinkToken(db, e.id, { now });
          const body = msg(langOf(e), e.check_in_freq === 'weekly' ? 'checkin.sms.reminder_weekly' : 'checkin.sms.reminder',
            { agency: await agencyName(db, e.bondsman_id), name: firstName(e.defendant_name), link: checkinTextLink(token) });
          if (await textDefendant(db, e, { kind: 'reminder', day: st.today, body, purpose: 'checkin_reminder' }) === 'sent') reminders++;
        }
      }
      // 2. the gentle "you missed your check-in" text, the day after, while still not checked in
      const pending = await db.all(`SELECT id, local_day FROM checkin_missed WHERE enrollment_id = ? AND defendant_text = 'pending' ORDER BY local_day`, [e.id]);
      for (const m of pending) {
        const day = typeof m.local_day === 'string' ? m.local_day.slice(0, 10) : localDay(m.local_day, 'UTC');
        let outcome;
        if (!e.missed_text_defendant) outcome = 'off';
        else if (day !== addDays(st.today, -1)) outcome = 'stale';
        else if (st.last_day === st.today) outcome = 'checked_in';
        else {
          const token = await issueLinkToken(db, e.id, { now });
          const lang = langOf(e);
          outcome = await textDefendant(db, e, { kind: 'missed', day, purpose: 'checkin_missed',
            body: msg(lang, 'checkin.sms.missed', { agency: await agencyName(db, e.bondsman_id), name: firstName(e.defendant_name), day: formatDay(day, lang), link: checkinTextLink(token) }) });
          if (outcome === 'sent') missed++;
        }
        await db.run('UPDATE checkin_missed SET defendant_text = ? WHERE id = ?', [outcome, m.id]);
      }
    } catch (err) {
      logger.warn({ err: err.message, enrollmentId: e.id }, '[checkins] text run failed for one enrollment');
    }
  }
  const pruned = await db.run(`DELETE FROM checkin_link_tokens WHERE expires_at < ?`, [new Date(now.getTime() - LINK_DAYS * 86_400_000).toISOString()]);
  return { reminders, missed, pruned: Number(pruned?.changes || 0) };
}

// ── Missed check-ins ──────────────────────────────────────────────────────────

/**
 * Which ended local days were missed (pure). `days` = local days with a check-in, `since` = the
 * local day monitoring started or restarted (never missed itself), `today` = the local day now.
 * Daily: every ended day after `since` without a check-in. Weekly: an ended day that is a multiple
 * of 7 days after the last check-in before it (or after `since`) without a check-in in the 7 days
 * ending on it.
 */
export function missedDays({ freq, today, since, days, lookback = MISSED_LOOKBACK_DAYS }) {
  const have = new Set(days);
  const sorted = [...have].sort();
  const out = [];
  for (let k = lookback; k >= 1; k--) {
    const d = addDays(today, -k);
    if (!d || d <= since) continue;
    if (freq !== 'weekly') { if (!have.has(d)) out.push(d); continue; }
    const last = sorted.filter((x) => x <= d).pop() || null;
    if (last && daysBetween(last, d) < 7) continue;           // done for that week
    const anchor = last && last > since ? last : since;
    const gap = daysBetween(anchor, d);
    if (gap > 0 && gap % 7 === 0) out.push(d);
  }
  return out;
}

async function agentSettings(db, agentId) {
  const s = await db.get('SELECT missed_alert_text, alert_phone FROM checkin_agent_settings WHERE agent_id = ?', [agentId]).catch(() => null);
  return { missed_alert_text: !!s?.missed_alert_text, alert_phone: s?.alert_phone || null };
}

/** Tell the agent: push + e-mail (+ text when they turned it on). → { push, email, text } */
async function alertAgent(db, e, { kind, params, purpose }) {
  const lang = await userLang(db, e.bondsman_id);
  const push = await sendPushToUser(e.bondsman_id, {
    title: msg(lang, `checkin.push.${kind}_title`, params), body: msg(lang, `checkin.push.${kind}_body`, params),
    data: { type: `checkin_${kind}`, screen: 'CheckInManager', enrollment_id: Number(e.id) }, channelId: 'default',
  }).catch(() => ({ sent: 0 }));
  const u = await db.get('SELECT email FROM users WHERE id = ?', [e.bondsman_id]);
  const email = await sendAgentEmail({ to: u?.email, subject: msg(lang, `checkin.email.${kind}_subject`, params), text: msg(lang, `checkin.email.${kind}_body`, params) });
  let text = null;
  if (purpose) {
    const s = await agentSettings(db, e.bondsman_id);
    if (s.missed_alert_text && s.alert_phone) {
      text = (await agentCanText(db, e.bondsman_id))
        ? (await sendAgentTextDetailed(db, { agentId: e.bondsman_id, bondId: await bondIdFor(db, e), purpose, to: s.alert_phone, body: msg(lang, `checkin.sms.agent_${kind}`, params) })).status
        : 'no_plan';
    }
  }
  return { push: Number(push?.sent || 0) > 0 ? 'sent' : 'skipped', email, text };
}

/**
 * The checkin-missed job (hourly). → { checked, missed }
 */
export async function runMissedCheckins(db, { now = new Date(), limit = 2000 } = {}) {
  let checked = 0; let missed = 0;
  const rows = await db.all(`SELECT ${ENROLL_FIELDS} FROM checkin_enrollments WHERE active = 1 AND bondsman_id IS NOT NULL ORDER BY id LIMIT ?`, [limit]);
  for (const e of rows) {
    try {
      checked++;
      const tz = await enrollmentTimeZone(db, e);
      const today = todayInZone(tz, now);
      const since = localDay(e.active_since || e.created_at || now, tz);
      const days = await checkinDays(db, e.id, tz, 60);
      for (const day of missedDays({ freq: e.check_in_freq, today, since, days })) {
        const wantsText = e.channel === 'sms' && !!e.missed_text_defendant && textReady(e) && day === addDays(today, -1);
        const ins = await db.get(
          `INSERT INTO checkin_missed (enrollment_id, local_day, time_zone, defendant_text) VALUES (?, ?, ?, ?)
           ON CONFLICT (enrollment_id, local_day) DO NOTHING RETURNING id`, [e.id, day, tz, wantsText ? 'pending' : null]);
        if (!ins) continue;                                     // already recorded (and alerted)
        missed++;
        const lang = await userLang(db, e.bondsman_id);
        const r = await alertAgent(db, e, { kind: 'missed', purpose: 'checkin_alert', params: { name: e.defendant_name, day: formatDay(day, lang) } });
        await db.run('UPDATE checkin_missed SET agent_push = ?, agent_email = ?, agent_text = ? WHERE id = ?', [r.push, r.email, r.text, ins.id]);
      }
    } catch (err) {
      logger.warn({ err: err.message, enrollmentId: e.id }, '[checkins] missed check failed for one enrollment');
    }
  }
  return { checked, missed };
}

// ── Recording a check-in (app and text link) ─────────────────────────────────

/**
 * Write one check-in. The first one of the period counts; another on a day already done is
 * recorded with counted = false when `allowExtra` (the text link), else → { dup: true }.
 * Then the location alert (B1) and the agent's push. → { row, counted, st, location }
 */
export async function recordCheckin(db, e, { userId = null, via = 'app', lat = null, lng = null, label = null, notes = null, device = null, allowExtra = false, now = new Date() }) {
  const result = await db.transaction(async (tx) => {
    // one counted check-in per local day, even when two taps race
    await tx.get(`SELECT pg_advisory_xact_lock(hashtext('checkin_submit'), CAST(? AS integer)) AS locked`, [Number(e.id) % 2147483647]);
    const st = await checkinState(tx, e, now);
    const already = st.last_day === st.today;
    if (already && !allowExtra) return { dup: true, st };
    const row = await tx.get(
      `INSERT INTO checkin_records (enrollment_id, user_id, lat, lng, location_label, notes, status, device_info, checked_in_at, via, counted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, checked_in_at`,
      [e.id, userId, lat, lng, label, notes, already ? 'extra' : 'submitted', device, now.toISOString(), via, !already]);
    return { row, counted: !already };
  });
  if (result.dup) return result;
  const location = lat != null && lng != null ? await checkLocation(db, e, { recordId: Number(result.row.id), lat, lng }) : null;
  const st = await checkinState(db, e, now);
  const agentLang = await userLang(db, e.bondsman_id);
  const outside = location?.outside === true;
  const notified = e.bondsman_id == null ? { sent: 0 } : await sendPushToUser(e.bondsman_id, {
    title: msg(agentLang, 'checkin.push.agent_title', { name: e.defendant_name }),
    body: msg(agentLang, lat === null ? 'checkin.push.agent_body' : 'checkin.push.agent_body_location', { name: e.defendant_name }),
    data: { type: 'checkin_submitted', screen: 'CheckInManager', enrollment_id: Number(e.id) },
    channelId: 'default',
  }).catch(() => ({ sent: 0 }));
  return { row: result.row, counted: result.counted, st, location, outside, agent_notified: Number(notified?.sent || 0) > 0 };
}

/** Pure: is (lat, lng) outside the enrollment's home radius? → { distance_miles, outside } | null */
export function distanceFromHome(e, lat, lng) {
  const hl = e.home_lat == null ? null : Number(e.home_lat);
  const hg = e.home_lng == null ? null : Number(e.home_lng);
  const r = e.home_radius_miles == null ? null : Number(e.home_radius_miles);
  if (![hl, hg, r, lat, lng].every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const d = haversineMiles(hl, hg, lat, lng);
  return { distance_miles: Math.round(d * 100) / 100, outside: d > r, radius_miles: r };
}

/** B1: store the distance on the record and alert the agent when outside the radius. */
export async function checkLocation(db, e, { recordId, lat, lng }) {
  if (!locationAlertsEnabled()) return null;
  const home = await db.get('SELECT home_lat, home_lng, home_radius_miles FROM checkin_enrollments WHERE id = ?', [e.id]);
  const d = distanceFromHome(home || {}, lat, lng);
  if (!d) return null;
  await db.run('UPDATE checkin_records SET distance_miles = ?, outside_radius = ? WHERE id = ?', [d.distance_miles, d.outside, recordId]);
  if (d.outside && e.bondsman_id != null) {
    try {
      const lang = await userLang(db, e.bondsman_id);
      const fmt = (n) => Number(n).toLocaleString(lang === 'en' ? 'en-US' : lang, { maximumFractionDigits: 1 });
      await alertAgent(db, e, { kind: 'location', purpose: null, params: { name: e.defendant_name, miles: fmt(d.distance_miles), radius: fmt(d.radius_miles) } });
      await db.run('UPDATE checkin_records SET location_alert_at = NOW() WHERE id = ?', [recordId]);
    } catch (err) {
      logger.warn({ err: err.message, enrollmentId: e.id }, '[checkins] location alert failed');
    }
  }
  return d;
}

/**
 * Remember the defendant's zone on a text-link enrollment (no account to hold it) — only when none
 * is set: a zone the agent chose is never replaced by the phone that opens the link (review
 * finding 12).
 */
export async function rememberEnrollmentZone(db, e, tz) {
  if (!isValidTimeZone(tz) || e.user_id || e.time_zone) return false;
  const r = await db.run('UPDATE checkin_enrollments SET time_zone = ? WHERE id = ? AND time_zone IS NULL', [tz, e.id]);
  if (!r?.changes) return false;
  e.time_zone = tz;
  return true;
}
