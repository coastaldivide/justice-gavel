/**
 * services/custodyAlerts.js — release / transfer alerts for families (A9, ⚖ counsel question 6.3,
 * CUSTODY_ALERTS_ENABLED — off in production unless set). docs/CUSTODY_ALERTS.md.
 *
 * A signed-in person follows one booking (booking_follows) after agreeing to alerts; texts only
 * when they also opt in to texts — and only to the account's VERIFIED phone (services/
 * phoneVerification.js), never to a number typed in (review finding 5). STOP from that number
 * blocks every text. Texts are not sent at night (21:00–08:00 in the follower's zone): they are
 * held (custody_alerts.text_status = 'held') and the 'custody-held-texts' job sends them from 08:00
 * (sendHeldCustodyTexts). Push and e-mail go at once.
 *
 * During roster ingest (services/arrest_ingest.js), for followed bookings only:
 *   - the roster shows a different status or facility → a custody event that quotes what the
 *     roster says now and before ("status_changed" / "facility_changed");
 *   - the booking is not on a complete roster any more → "not_listed": "no longer listed on the
 *     {county} roster as of {time} — call {jail phone} to confirm". We never say "released"
 *     unless the roster's own status says so (and then we quote it);
 *   - listed again after that → "listed_again".
 * Each (follow, event) pair is claimed once in custody_alerts, so nobody is alerted twice for
 * the same change. Records that were taken down (arrest_records.suppressed) or are sample data
 * are never followed and never alerted (utils/arrestVisibility.js realArrestSql).
 */
import logger from '../utils/logger.js';
import { realArrestSql } from '../utils/arrestVisibility.js';
import { msg, normalizeLang, LOCALES } from '../i18n/index.js';
import { DEFAULT_TIME_ZONE, isValidTimeZone, zonedParts } from '../utils/timezone.js';
import { sendPushToUser } from './pushDelivery.js';
import { sendAgentEmail } from './bondDesk/core.js';
import { sendSms, smsLive, toE164 } from './sms.js';
import { fitSms } from './smsText.js';

export const CONSENT_VERSION = 'custody-alerts-2026-10';
export const MAX_FOLLOWS = 10;
/** No custody texts from 21:00 until 08:00 in the follower's zone (held, sent in the morning). */
export const TEXT_QUIET_FROM = 21;
export const TEXT_QUIET_UNTIL = 8;
const APP_URL = () => String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');

export class CustodyError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// ── Detecting changes (called by arrest_ingest.js) ─────────────────────────────

/** Arrest ids of `source` that someone follows (live follow, real record). */
async function followed(db, arrestId) {
  const r = await db.get(
    `SELECT 1 AS x FROM booking_follows f JOIN arrest_records a ON a.id = f.arrest_id
      WHERE f.arrest_id = ? AND f.ended_at IS NULL AND ${realArrestSql('a')} LIMIT 1`, [arrestId]);
  return !!r;
}

/** A change the roster showed for a booking → [eventId] (none when nobody follows it). */
export async function recordChange(db, { arrestId, kind, old = null, new: now = null, source }) {
  if (!(await followed(db, arrestId))) return [];
  const r = await db.get(
    `INSERT INTO custody_events (arrest_id, kind, old_value, new_value, source) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    [arrestId, kind, old, now, source]);
  return [Number(r.id)];
}

/** Followed bookings of `source` missing from a complete roster → [eventId]. */
export async function markUnlisted(db, { source, seenKeys }) {
  const rows = await db.all(
    `SELECT DISTINCT a.id, a.source_key FROM arrest_records a JOIN booking_follows f ON f.arrest_id = a.id AND f.ended_at IS NULL
      WHERE a.source = ? AND a.source_key IS NOT NULL AND a.delisted_at IS NULL AND ${realArrestSql('a')} LIMIT 5000`, [source]);
  const out = [];
  for (const r of rows) {
    if (seenKeys.has(r.source_key)) continue;
    // only the run that flips delisted_at records the event (two runs at once never alert twice)
    const flipped = await db.get('UPDATE arrest_records SET delisted_at = NOW(), updated_at = NOW() WHERE id = ? AND delisted_at IS NULL RETURNING id', [r.id]);
    if (!flipped) continue;
    const ev = await db.get(`INSERT INTO custody_events (arrest_id, kind, source) VALUES (?, 'not_listed', ?) RETURNING id`, [r.id, source]);
    out.push(Number(ev.id));
  }
  return out;
}

// ── Wording ─────────────────────────────────────────────────────────────────────

const countyName = (c) => String(c || '').trim().replace(/\s+county$/i, '');

/** "Oct 27, 4:05 PM CDT" in the person's language and zone. */
export function whenText(at, lang, tz) {
  const zone = isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  return new Date(at).toLocaleString(LOCALES[normalizeLang(lang) || 'en'], {
    timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).replace(/[\u00a0\u202f]/g, ' ');
}

/**
 * The alert for one event: { title, body, sms, email_subject, email_body }.
 * ev: { kind, old_value, new_value, observed_at }; arrest: { name, county, jail_phone, source }.
 */
export function eventMessage(lang, ev, arrest, tz) {
  const l = normalizeLang(lang) || 'en';
  const county = countyName(arrest.county);
  const roster = county ? msg(l, 'custody.roster_county', { county }) : msg(l, 'custody.roster_generic');
  const call = arrest.jail_phone ? msg(l, 'custody.call_phone', { phone: arrest.jail_phone }) : msg(l, 'custody.call_jail');
  const time = whenText(ev.observed_at, l, tz);
  const p = { name: arrest.name, roster, time, call, old: ev.old_value || '', new: ev.new_value || '' };
  const key = `custody.${ev.kind}`;
  const body = msg(l, key, p);
  const title = msg(l, 'custody.title', { name: arrest.name });
  const sms = fitSms((f) => msg(l, 'custody.sms', { body: msg(l, key, { ...p, name: f.name, old: f.old, new: f.new }) }),
    { name: arrest.name, old: p.old, new: p.new }, [['old', 8], ['new', 12], ['name', 12]], { lang: l });
  return {
    title, body, sms,
    email_subject: title,
    email_body: `${body}\n\n${msg(l, 'custody.email_footer', { link: `${APP_URL()}/custody-alerts` })}`,
  };
}

// ── Alerts ──────────────────────────────────────────────────────────────────────

/** sendPushToUser → 'sent' | 'skipped' (no device) | 'failed'. */
export async function pushStatus(userId, payload) {
  try {
    const r = await sendPushToUser(userId, payload);
    if (r?.sent > 0) return 'sent';
    return r?.reason ? 'skipped' : 'failed';
  } catch (e) { logger.warn({ err: e?.message }, '[custody] push failed'); return 'failed'; }
}

/** Is it night (21:00–08:00) in `tz` at `now`? */
export function quietHours(now, tz) {
  const h = zonedParts(now, isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE).hour % 24;
  return h >= TEXT_QUIET_FROM || h < TEXT_QUIET_UNTIL;
}

/** The account's verified phone (E.164) or null. */
const verifiedPhone = (u) => (u?.phone_verified_at && u.phone_verified_phone && toE164(u.phone) === toE164(u.phone_verified_phone)
  ? toE164(u.phone_verified_phone) : null);

/**
 * One custody text. follow: { text_opt_in, text_phone, timezone, phone, phone_verified_phone,
 * phone_verified_at }. → { status: null | 'held' | 'skipped' | 'opted_out' | 'sent' | 'failed', providerId? }
 */
async function sendText(db, follow, body, { now = new Date(), hold = true } = {}) {
  if (!follow.text_opt_in) return { status: null };
  const to = toE164(follow.text_phone);
  // only the account's verified phone (it may have changed since the follow was made)
  if (!to || to !== verifiedPhone(follow)) return { status: 'skipped' };
  if (hold && quietHours(now, follow.timezone)) return { status: 'held' };
  const out = await db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [to]);
  if (out) return { status: 'opted_out' };
  if (!smsLive()) return { status: 'skipped' };
  const r = await sendSms({ to, body });
  if (r?.ok) return { status: 'sent', providerId: r.id || null };
  return { status: r?.skipped ? 'skipped' : 'failed' };
}

/** Alert every live follower of each event once (claimed in custody_alerts). → number alerted */
export async function notifyEvents(db, eventIds) {
  let n = 0;
  for (const eventId of eventIds) {
    const ev = await db.get(
      `SELECT e.id, e.kind, e.old_value, e.new_value, e.observed_at, a.id AS arrest_id, a.name, a.county, a.jail_phone, a.source
         FROM custody_events e JOIN arrest_records a ON a.id = e.arrest_id
        WHERE e.id = ? AND ${realArrestSql('a')}`, [eventId]);
    if (!ev) continue;   // taken down since: nobody is alerted
    const follows = await db.all(
      `SELECT f.id, f.user_id, f.text_opt_in, f.text_phone, u.email, u.timezone, u.preferred_language,
              u.phone, u.phone_verified_phone, u.phone_verified_at
         FROM booking_follows f JOIN users u ON u.id = f.user_id
        WHERE f.arrest_id = ? AND f.ended_at IS NULL AND f.created_at <= ? LIMIT 500`, [ev.arrest_id, ev.observed_at]);
    for (const f of follows) {
      const claim = await db.get(
        'INSERT INTO custody_alerts (follow_id, event_id) VALUES (?, ?) ON CONFLICT (follow_id, event_id) DO NOTHING RETURNING id', [f.id, ev.id]);
      if (!claim) continue;
      const lang = normalizeLang(f.preferred_language) || 'en';
      const m = eventMessage(lang, ev, ev, f.timezone);
      const push = await pushStatus(Number(f.user_id), { title: m.title, body: m.body, data: { screen: 'CustodyAlerts', followId: Number(f.id) }, channelId: 'case_updates' });
      const email = await sendAgentEmail({ to: f.email, subject: m.email_subject, text: m.email_body });
      let text = { status: null };
      try { text = await sendText(db, f, m.sms); } catch (e) { text = { status: 'failed' }; logger.warn({ err: e?.message }, '[custody] text failed'); }
      await db.run('UPDATE custody_alerts SET push_status = ?, email_status = ?, text_status = ?, provider_id = ? WHERE id = ?',
        [push, email, text.status, text.providerId || null, claim.id]);
      n++;
    }
  }
  return n;
}

/**
 * Job 'custody-held-texts' (every 15 minutes): send the texts held during the night once it is
 * 08:00 or later in the follower's zone. A follow that ended, a booking taken down or texts turned
 * off since → the held text is dropped ('cancelled'); the verified phone changed → 'skipped'.
 * → { checked, sent, cancelled, skipped }
 */
export async function sendHeldCustodyTexts(db, { now = new Date() } = {}) {
  const out = { checked: 0, sent: 0, cancelled: 0, skipped: 0 };
  const rows = await db.all(
    `SELECT ca.id AS alert_id, f.id, f.user_id, f.text_opt_in, f.text_phone, f.ended_at, u.timezone, u.preferred_language,
            u.phone, u.phone_verified_phone, u.phone_verified_at,
            e.kind, e.old_value, e.new_value, e.observed_at, a.name, a.county, a.jail_phone, a.source,
            CASE WHEN ${realArrestSql('a')} THEN TRUE ELSE FALSE END AS available
       FROM custody_alerts ca JOIN booking_follows f ON f.id = ca.follow_id JOIN users u ON u.id = f.user_id
       JOIN custody_events e ON e.id = ca.event_id JOIN arrest_records a ON a.id = e.arrest_id
      WHERE ca.text_status = 'held' ORDER BY ca.id LIMIT 1000`);
  for (const r of rows) {
    out.checked += 1;
    if (r.ended_at || !r.available || !r.text_opt_in) {
      await db.run(`UPDATE custody_alerts SET text_status = 'cancelled' WHERE id = ? AND text_status = 'held'`, [r.alert_id]);
      out.cancelled += 1;
      continue;
    }
    if (quietHours(now, r.timezone)) continue;
    // claim it (two runs at once never text twice)
    const claim = await db.get(`UPDATE custody_alerts SET text_status = 'sending' WHERE id = ? AND text_status = 'held' RETURNING id`, [r.alert_id]);
    if (!claim) continue;
    const lang = normalizeLang(r.preferred_language) || 'en';
    let text = { status: 'failed' };
    try { text = await sendText(db, r, eventMessage(lang, r, r, r.timezone).sms, { now, hold: false }); } catch (e) { logger.warn({ err: e?.message }, '[custody] held text failed'); }
    await db.run('UPDATE custody_alerts SET text_status = ?, provider_id = ? WHERE id = ?', [text.status || 'skipped', text.providerId || null, r.alert_id]);
    if (text.status === 'sent') out.sent += 1; else out.skipped += 1;
  }
  return out;
}

// ── Follows (routes/custody.js) ───────────────────────────────────────────────

/** The arrest a person may follow: real, not taken down, from a roster feed we re-read. */
export async function followableArrest(db, arrestId) {
  const a = await db.get(
    `SELECT id, name, county, state, jail_location, status, source, source_key, jail_phone, booking_date, delisted_at, last_seen_at
       FROM arrest_records WHERE id = ? AND ${realArrestSql()}`, [arrestId]);
  if (!a) throw new CustodyError(404, 'not_found');
  if (!a.source_key || !/^feed_/.test(String(a.source || ''))) throw new CustodyError(409, 'not_trackable');
  return a;
}

/** The person's verified phone (E.164) or null — the only number custody texts go to. */
export async function verifiedPhoneOf(db, userId) {
  return verifiedPhone(await db.get('SELECT phone, phone_verified_phone, phone_verified_at FROM users WHERE id = ?', [userId]));
}

/**
 * Validated text opt-in: { text_opt_in, text_phone, text_consent_at } (STOP checked). Texts go to
 * the account's verified phone only; a typed number that is not it is refused (phone_not_verified).
 */
async function textChoice(db, userId, body, now) {
  if (body.text_opt_in !== true) return { text_opt_in: false, text_phone: null, text_consent_at: null };
  const typed = body.phone === undefined || body.phone === null || String(body.phone).trim() === '' ? null : toE164(body.phone);
  if (body.phone != null && String(body.phone).trim() !== '' && !typed) throw new CustodyError(400, 'bad_phone');
  if (body.text_consent !== true) throw new CustodyError(400, 'text_consent_required');
  const phone = await verifiedPhoneOf(db, userId);
  if (!phone || (typed && typed !== phone)) throw new CustodyError(409, 'phone_not_verified');
  if (await db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [phone])) throw new CustodyError(409, 'opted_out');
  return { text_opt_in: true, text_phone: phone, text_consent_at: now };
}

async function ownCase(db, userId, caseId) {
  if (caseId === null || caseId === undefined || caseId === '') return null;
  const n = Number.parseInt(String(caseId), 10);
  if (!Number.isSafeInteger(n) || n <= 0) throw new CustodyError(400, 'bad_case');
  const c = await db.get('SELECT id FROM cases WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [n, userId]);
  if (!c) throw new CustodyError(400, 'bad_case');
  return n;
}

export async function followBooking(db, userId, body) {
  if (body.consent !== true) throw new CustodyError(400, 'consent_required');
  const arrestId = Number.parseInt(String(body.arrest_id ?? ''), 10);
  if (!Number.isSafeInteger(arrestId) || arrestId <= 0) throw new CustodyError(404, 'not_found');
  await followableArrest(db, arrestId);
  const now = new Date().toISOString();
  const caseId = await ownCase(db, userId, body.case_id);
  const t = await textChoice(db, userId, body, now);
  const live = await db.get('SELECT COUNT(*)::int AS n FROM booking_follows WHERE user_id = ? AND ended_at IS NULL', [userId]);
  if (live.n >= MAX_FOLLOWS) throw new CustodyError(409, 'too_many');
  const row = await db.get(
    `INSERT INTO booking_follows (user_id, arrest_id, case_id, consent_at, consent_version, text_opt_in, text_phone, text_consent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, arrest_id) WHERE ended_at IS NULL DO NOTHING RETURNING id`,
    [userId, arrestId, caseId, now, CONSENT_VERSION, t.text_opt_in, t.text_phone, t.text_consent_at]);
  if (!row) throw new CustodyError(409, 'already_following');
  // start from what the roster says now: earlier changes are not alerted
  await db.run('UPDATE arrest_records SET last_seen_at = COALESCE(last_seen_at, NOW()) WHERE id = ?', [arrestId]);
  return Number(row.id);
}

async function ownFollow(db, userId, followId) {
  const n = Number.parseInt(String(followId ?? ''), 10);
  if (!Number.isSafeInteger(n) || n <= 0) throw new CustodyError(404, 'not_found');
  const f = await db.get('SELECT id, arrest_id FROM booking_follows WHERE id = ? AND user_id = ? AND ended_at IS NULL', [n, userId]);
  if (!f) throw new CustodyError(404, 'not_found');
  return f;
}

export async function updateFollow(db, userId, followId, body) {
  const f = await ownFollow(db, userId, followId);
  const sets = []; const args = [];
  if (Object.prototype.hasOwnProperty.call(body, 'case_id')) { sets.push('case_id = ?'); args.push(await ownCase(db, userId, body.case_id)); }
  if (Object.prototype.hasOwnProperty.call(body, 'text_opt_in')) {
    const t = await textChoice(db, userId, body, new Date().toISOString());
    sets.push('text_opt_in = ?', 'text_phone = ?', 'text_consent_at = ?'); args.push(t.text_opt_in, t.text_phone, t.text_consent_at);
  }
  if (sets.length) await db.run(`UPDATE booking_follows SET ${sets.join(', ')} WHERE id = ?`, [...args, f.id]);
  return Number(f.id);
}

export async function unfollow(db, userId, followId) {
  const f = await ownFollow(db, userId, followId);
  await db.run(`UPDATE booking_follows SET ended_at = NOW(), ended_reason = 'unfollowed' WHERE id = ? AND ended_at IS NULL`, [f.id]);
}

const pubEvent = (e) => ({ id: Number(e.id), kind: e.kind, old_value: e.old_value, new_value: e.new_value, observed_at: e.observed_at });

/** The person's live follows. A booking that was taken down shows no details any more. */
export async function listFollows(db, userId) {
  const rows = await db.all(
    `SELECT f.id, f.arrest_id, f.case_id, f.text_opt_in, f.text_phone, f.created_at, c.title AS case_title,
            CASE WHEN ${realArrestSql('a')} THEN TRUE ELSE FALSE END AS available,
            a.name, a.county, a.state, a.jail_location, a.status, a.jail_phone, a.booking_date, a.delisted_at, a.last_seen_at
       FROM booking_follows f JOIN arrest_records a ON a.id = f.arrest_id LEFT JOIN cases c ON c.id = f.case_id AND c.user_id = f.user_id
      WHERE f.user_id = ? AND f.ended_at IS NULL ORDER BY f.created_at DESC LIMIT ${MAX_FOLLOWS}`, [userId]);
  const ids = rows.filter((r) => r.available).map((r) => Number(r.arrest_id));
  const events = ids.length
    ? await db.all(`SELECT id, arrest_id, kind, old_value, new_value, observed_at FROM custody_events WHERE arrest_id IN (${ids.map(() => '?').join(',')})
                     ORDER BY observed_at DESC LIMIT 200`, ids)
    : [];
  return rows.map((r) => {
    const base = { id: Number(r.id), arrest_id: Number(r.arrest_id), available: !!r.available, created_at: r.created_at,
      case_id: r.case_id == null ? null : Number(r.case_id), case_title: r.case_title || null,
      text_opt_in: !!r.text_opt_in, text_phone_last4: r.text_phone ? String(r.text_phone).slice(-4) : null };
    if (!r.available) return base;
    return { ...base,
      booking: { name: r.name, county: r.county, state: r.state, facility: r.jail_location || null, status: r.status || null,
        jail_phone: r.jail_phone || null, booking_date: r.booking_date, listed: !r.delisted_at, not_listed_since: r.delisted_at || null,
        last_seen_at: r.last_seen_at || null },
      events: events.filter((e) => Number(e.arrest_id) === Number(r.arrest_id) && new Date(e.observed_at) >= new Date(r.created_at)).slice(0, 20).map(pubEvent) };
  });
}

/** Follow state for one arrest (the record page): { follow_id | null }. */
export async function followFor(db, userId, arrestId) {
  const f = await db.get('SELECT id FROM booking_follows WHERE user_id = ? AND arrest_id = ? AND ended_at IS NULL', [userId, arrestId]);
  return f ? Number(f.id) : null;
}
