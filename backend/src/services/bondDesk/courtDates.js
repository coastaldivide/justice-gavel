/**
 * services/bondDesk/courtDates.js — Bond Desk hearings and the texts about them
 * (docs/BOND_DESK.md "Court dates and reminders"; build plan A1, A6, A7).
 *
 * Hearings: bd_court_dates (many per bond). bd_bonds.court_date is kept as the next hearing
 * (syncBondCourtDate) so the bond list, forms (bond.court_date) and reports keep working.
 *
 * Who is texted: the defendant and every indemnitor whose CURRENT number the agent confirmed
 * ("the person gave me this number for texts about this bond": bd_bonds.defendant_text_consent_phone,
 * bd_indemnitors.text_consent_phone — a changed number needs a new confirmation), on an ACTIVE
 * bond with court reminders on (bd_bonds.court_reminders). Numbers that replied STOP are skipped
 * at send time. Each text is billed 5¢ (bd_texts → services/bondDesk/textBilling.js).
 *
 * Plan per hearing (bd_reminders, one row per number + step + court day, never sent twice):
 *   d7 / d3 / d1 / d0  COURT_REMINDER_PLAN (services/courtReminders.js): 7 and 3 days before at
 *                      09:00, the evening before at 18:00, the morning of at 06:30 — wall-clock
 *                      times in the bond's zone (county → state → agent's zone → default).
 *                      A hearing added too late for all of them gets one text right away ('now').
 *   ask                defendant only, 15:00 on the court day: "Did you make it to court? Reply 1 /
 *                      2 / 3" (replies: handleCourtReply, called by routes/webhooks/telnyx.js).
 *   missed             defendant only, 09:00 the day after, unless the hearing was marked attended /
 *                      rescheduled / cancelled by then: "If you missed court, act today…" with the
 *                      missed-court guide link. Marked missed (by the agent or a reply "3") → sent now.
 * The agent is alerted (push + e-mail) the morning after a hearing still not marked attended /
 * rescheduled, and right away when the defendant replies "missed" or "rescheduled".
 *
 * Everything is re-planned (planBondCourtDate) when a hearing, the bond's status, a number, a
 * confirmation or the switch changes; the job (runBondCourtReminders, every 5 minutes) re-checks
 * each text against the hearing and the bond at send time.
 */
import { toE164 } from '../sms.js';
import { msg, formatDay, formatDayShort, formatTime, normalizeLang } from '../../i18n/index.js';
import {
  DEFAULT_TIME_ZONE, isValidTimeZone, stateTimeZone, countyTimeZone, zonedDateTimeToUtc, addDays, todayInZone, daysBetween,
} from '../../utils/timezone.js';
import { planSteps, ASK_AT, FOLLOWUP_AT, missedCourtLink, dateOnly, timeOnly } from '../courtReminders.js';
import { fitSms } from '../smsText.js';
import { sendAgentTextRecord, sendAgentEmail, agencyFor } from './core.js';
import { sendPushToUser } from '../pushDelivery.js';
import logger from '../../utils/logger.js';
import { logIgnored } from '../../utils/ignored.js';

export const REMINDER_STEPS = Object.freeze(['d7', 'd3', 'd1', 'd0', 'now']);
export const COURT_STATUSES = Object.freeze(['scheduled', 'attended', 'missed', 'rescheduled', 'cancelled']);
/** Bond statuses whose hearings get texts (a prospect is not posted yet; closed / forfeited bonds stop). */
export const TEXTED_BOND_STATUSES = new Set(['active']);
const PURPOSE = { ask: 'court_ask', missed: 'court_missed' };
const purposeOf = (step) => PURPOSE[step] || 'court_reminder';
const STALE_CLAIM_MS = 10 * 60_000;

// ── Time zone ─────────────────────────────────────────────────────────────────

/** The bond's zone: its county → its state → the agent's zone → DEFAULT_TIME_ZONE. */
export function bondTimeZone({ state, county } = {}, agentTz = null) {
  return countyTimeZone(state, county) || stateTimeZone(state) || (isValidTimeZone(agentTz) ? agentTz : null) || DEFAULT_TIME_ZONE;
}

// ── Wording ───────────────────────────────────────────────────────────────────

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

/**
 * The text for one step, within 2 segments. ctx: { lang, signerType, agency, agencyPhone,
 * defendant, courtDate, courtTime, courtName, room, daysLeft }
 */
export function bondCourtText(step, ctx) {
  const lang = normalizeLang(ctx.lang) || 'en';
  const day = formatDayShort(ctx.courtDate, lang);
  const time = formatTime(ctx.courtTime, lang);
  const at = time ? msg(lang, 'reminder.at_time', { time }) : '';
  const fields = { agency: ctx.agency || msg(lang, 'bd.sms.your_agent'), name: ctx.defendant || '', first: firstName(ctx.defendant), court: ctx.courtName || '' };
  const shrink = [['court', 0], ['agency', 16], ['name', 16], ['first', 10]];
  const where = (f) => (f.court ? msg(lang, 'bd.sms.at_court', { court: f.court, room: ctx.room ? msg(lang, 'bd.sms.room', { room: String(ctx.room).slice(0, 12) }) : '' }) : '');
  if (step === 'ask') return fitSms((f) => msg(lang, 'bd.sms.court_ask', { agency: f.agency, first: f.first }), fields, shrink, { lang });
  if (step === 'missed') {
    const phone = ctx.agencyPhone ? msg(lang, 'bd.sms.agent_phone', { phone: ctx.agencyPhone }) : '';
    return fitSms((f) => msg(lang, 'bd.sms.court_missed', { agency: f.agency, first: f.first, day, phone, link: missedCourtLink(lang) }), fields, shrink, { lang });
  }
  const d = Number(ctx.daysLeft);
  const when = d <= 0 ? msg(lang, 'bd.sms.when_today', { day, at }) : d === 1 ? msg(lang, 'bd.sms.when_tomorrow', { day, at })
    : msg(lang, 'bd.sms.when_days', { days: d, day, at });
  const key = ctx.signerType === 'indemnitor' ? 'bd.sms.court_indemnitor' : 'bd.sms.court_defendant';
  return fitSms((f) => msg(lang, key, { agency: f.agency, name: f.name, first: f.first, when, where: where(f) }).replace(/\.\.(?=\s|$)/g, '.'), fields, shrink, { lang });
}

/** The confirmation texted back after a reply 1 / 2 / 3. */
export function bondReplyText(answer, { lang, agency, defendant, courtDate }) {
  const l = normalizeLang(lang) || 'en';
  const key = { attended: 'bd.sms.reply_attended', rescheduled: 'bd.sms.reply_rescheduled', missed: 'bd.sms.reply_missed' }[answer] || 'bd.sms.reply_noted';
  return fitSms((f) => msg(l, key, { agency: f.agency, first: firstName(defendant), day: formatDayShort(courtDate, l), link: missedCourtLink(l) }),
    { agency: agency || msg(l, 'bd.sms.your_agent') }, [['agency', 14]], { lang: l });
}

// ── Loading ───────────────────────────────────────────────────────────────────

async function courtCtx(db, courtDateId) {
  return db.get(
    `SELECT cd.id, cd.bond_id, cd.court_date, cd.court_time, cd.court_name, cd.room, cd.status, cd.status_source, cd.asked_at,
            cd.followup_at, cd.deleted_at,
            b.agent_id, b.status AS bond_status, b.court_reminders, b.text_lang, b.state, b.county, b.defendant_name,
            b.defendant_phone, b.defendant_text_consent_phone, u.timezone AS agent_tz
       FROM bd_court_dates cd JOIN bd_bonds b ON b.id = cd.bond_id LEFT JOIN users u ON u.id = b.agent_id
      WHERE cd.id = ?`, [courtDateId]);
}

/** The numbers of a bond that may get texts: [{ signer_type, indemnitor_id, name, phone }] (one row per number). */
export async function textRecipients(db, bond) {
  const out = [];
  const seen = new Set();
  const dp = toE164(bond.defendant_phone);
  if (dp && bond.defendant_text_consent_phone === dp) { out.push({ signer_type: 'defendant', indemnitor_id: null, name: bond.defendant_name, phone: dp }); seen.add(dp); }
  const inds = await db.all('SELECT id, full_name, phone, text_consent_phone FROM bd_indemnitors WHERE bond_id = ? ORDER BY id LIMIT 20', [bond.bond_id ?? bond.id]);
  for (const i of inds) {
    const p = toE164(i.phone);
    if (p && i.text_consent_phone === p && !seen.has(p)) { out.push({ signer_type: 'indemnitor', indemnitor_id: Number(i.id), name: i.full_name, phone: p }); seen.add(p); }
  }
  return out;
}

/** Run fn(tx) holding a per-hearing lock (two re-plans of one hearing never interleave). */
function withLock(db, courtDateId, fn) {
  if (db?.engine !== 'postgres' || typeof db.transaction !== 'function') return fn(db);
  return db.transaction(async (tx) => {
    await tx.get(`SELECT pg_advisory_xact_lock(hashtext('bd_court_date_reminders'), CAST(? AS integer)) AS locked`, [Number(courtDateId) % 2147483647]);
    return fn(tx);
  });
}

// ── Planning ──────────────────────────────────────────────────────────────────

/** (Re)plan the texts of one hearing. → { time_zone, planned } */
export function planBondCourtDate(db, courtDateId, now = new Date()) {
  return withLock(db, courtDateId, (tx) => plan(tx, courtDateId, now));
}

async function plan(db, courtDateId, now) {
  const c = await courtCtx(db, courtDateId);
  if (!c) return { time_zone: DEFAULT_TIME_ZONE, planned: 0 };
  const tz = bondTimeZone(c, c.agent_tz);
  const day = dateOnly(c.court_date);
  const today = todayInZone(tz, now);
  let reason = c.deleted_at ? 'court_date_deleted' : !TEXTED_BOND_STATUSES.has(c.bond_status) ? `bond_${c.bond_status}` : !c.court_reminders ? 'reminders_off' : null;
  const keep = [];
  if (!reason) {
    const people = await textRecipients(db, c);
    const want = [];
    if (c.status === 'scheduled') {
      const steps = planSteps(day, tz, now);
      for (const p of people) {
        for (const s of steps) {
          if (s.immediate) {
            const done = await db.get(
              `SELECT 1 AS x FROM bd_reminders WHERE court_date_id = ? AND phone = ? AND court_day = ? AND step IN ('d7','d3','d1','d0','now')
                 AND status IN ('sent','sending') LIMIT 1`, [c.id, p.phone, day]);
            if (done) continue;
          }
          want.push({ p, step: s.immediate ? 'now' : `d${s.days}`, at: s.at });
        }
      }
    }
    const def = people.find((p) => p.signer_type === 'defendant');
    if (def && c.status === 'scheduled') {
      const ask = zonedDateTimeToUtc(day, ASK_AT.hh, ASK_AT.mm, tz);
      if (ask && ask.getTime() > now.getTime()) want.push({ p: def, step: 'ask', at: ask });
      const fu = zonedDateTimeToUtc(addDays(day, 1), FOLLOWUP_AT.hh, FOLLOWUP_AT.mm, tz);
      if (fu && fu.getTime() > now.getTime()) want.push({ p: def, step: 'missed', at: fu });
    }
    if (def && c.status === 'missed') {
      const ago = daysBetween(day, today);
      if (ago !== null && ago >= 0 && ago <= 2) want.push({ p: def, step: 'missed', at: now });
    }
    for (const w of want) {
      const row = await db.get(
        `INSERT INTO bd_reminders (court_date_id, bond_id, signer_type, indemnitor_id, phone, step, court_day, send_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (court_date_id, phone, step, court_day) DO UPDATE
           SET send_at = EXCLUDED.send_at, signer_type = EXCLUDED.signer_type, indemnitor_id = EXCLUDED.indemnitor_id,
               status = 'pending', reason = NULL, claimed_at = NULL, updated_at = NOW()
           WHERE bd_reminders.status IN ('pending', 'cancelled', 'skipped')
         RETURNING id`,
        [c.id, c.bond_id, w.p.signer_type, w.p.indemnitor_id, w.p.phone, w.step, day, w.at.toISOString()]);
      if (row) keep.push(Number(row.id));
    }
    if (c.status !== 'scheduled') reason = `court_date_${c.status}`;
  }
  await db.run(
    `UPDATE bd_reminders SET status = 'cancelled', reason = ?, updated_at = NOW()
      WHERE court_date_id = ? AND status = 'pending' AND NOT (id = ANY(CAST(? AS bigint[])))`,
    [reason || 'replanned', c.id, `{${keep.join(',')}}`]);
  return { time_zone: tz, planned: keep.length };
}

/** Re-plan every live hearing of a bond (status change, number, confirmation or switch changed). */
export async function planBond(db, bondId, now = new Date()) {
  const rows = await db.all('SELECT id FROM bd_court_dates WHERE bond_id = ? AND deleted_at IS NULL ORDER BY court_date DESC LIMIT 100', [bondId]);
  for (const r of rows) await planBondCourtDate(db, Number(r.id), now);
  return rows.length;
}

/**
 * bd_bonds.court_date = the next scheduled hearing (today or later in the bond's zone); with
 * none ahead, the latest hearing not cancelled; null when the bond has none.
 */
export async function syncBondCourtDate(db, bondId, now = new Date()) {
  const b = await db.get('SELECT b.state, b.county, u.timezone FROM bd_bonds b LEFT JOIN users u ON u.id = b.agent_id WHERE b.id = ?', [bondId]);
  if (!b) return null;
  const today = todayInZone(bondTimeZone(b, b.timezone), now);
  const next = await db.get(
    `SELECT court_date FROM bd_court_dates WHERE bond_id = ? AND deleted_at IS NULL AND status = 'scheduled' AND court_date >= CAST(? AS date)
      ORDER BY court_date, court_time NULLS FIRST LIMIT 1`, [bondId, today]);
  const last = next ? null : await db.get(
    `SELECT court_date FROM bd_court_dates WHERE bond_id = ? AND deleted_at IS NULL AND status <> 'cancelled' ORDER BY court_date DESC LIMIT 1`, [bondId]);
  const d = dateOnly((next || last)?.court_date) || null;
  await db.run('UPDATE bd_bonds SET court_date = ? WHERE id = ? AND court_date IS DISTINCT FROM CAST(? AS date)', [d, bondId, d]);
  return d;
}

/**
 * The bond form's single "court date" was set or changed: mirror it into bd_court_dates (moving
 * the hearing it named, else adding one). Returns the hearing id or null.
 */
export async function mirrorBondFormCourtDate(db, { bondId, oldDate, newDate, courtName }) {
  if (!newDate || oldDate === newDate) return null;
  const find = (d) => db.get(`SELECT id FROM bd_court_dates WHERE bond_id = ? AND court_date = CAST(? AS date) AND deleted_at IS NULL ORDER BY id LIMIT 1`, [bondId, d]);
  const exists = await find(newDate);
  if (exists) return Number(exists.id);
  const old = oldDate ? await db.get(
    `SELECT id FROM bd_court_dates WHERE bond_id = ? AND court_date = CAST(? AS date) AND deleted_at IS NULL AND status = 'scheduled' ORDER BY id LIMIT 1`,
    [bondId, oldDate]) : null;
  if (old) {
    await db.run('UPDATE bd_court_dates SET court_date = CAST(? AS date), updated_at = NOW() WHERE id = ?', [newDate, old.id]);
    return Number(old.id);
  }
  const ins = await db.get('INSERT INTO bd_court_dates (bond_id, court_date, court_name) VALUES (?, CAST(? AS date), ?) RETURNING id', [bondId, newDate, courtName || null]);
  return Number(ins.id);
}

// ── Sending ───────────────────────────────────────────────────────────────────

/** Why this text must not go out now (null = send). */
function staleReason(r, c, tz, now) {
  if (!c || c.deleted_at) return ['cancelled', 'court_date_deleted'];
  if (!TEXTED_BOND_STATUSES.has(c.bond_status)) return ['cancelled', `bond_${c.bond_status}`];
  if (!c.court_reminders) return ['cancelled', 'reminders_off'];
  if (dateOnly(c.court_date) !== dateOnly(r.court_day)) return ['cancelled', 'court_date_changed'];
  if (r.step === 'missed' ? !['scheduled', 'missed'].includes(c.status) : c.status !== 'scheduled') return ['cancelled', `court_date_${c.status}`];
  const left = daysBetween(todayInZone(tz, now), dateOnly(c.court_date));
  if (r.step === 'ask' && left !== 0) return ['skipped', 'too_late'];
  if (r.step === 'missed' && (left > 0 || left < -2)) return ['skipped', 'too_late'];
  if (REMINDER_STEPS.includes(r.step) && left < 0) return ['skipped', 'too_late'];
  return null;
}

async function currentConsent(db, r, c) {
  if (r.signer_type === 'defendant') {
    const p = toE164(c.defendant_phone);
    return p === r.phone && c.defendant_text_consent_phone === p;
  }
  if (!r.indemnitor_id) return false;
  const i = await db.get('SELECT phone, text_consent_phone FROM bd_indemnitors WHERE id = ? AND bond_id = ?', [r.indemnitor_id, c.bond_id]);
  const p = toE164(i?.phone);
  return !!p && p === r.phone && i.text_consent_phone === p;
}

async function sendOne(db, r, now) {
  const c = await courtCtx(db, r.court_date_id);
  const tz = c ? bondTimeZone(c, c.agent_tz) : DEFAULT_TIME_ZONE;
  const stale = staleReason(r, c, tz, now) || (!(await currentConsent(db, r, c)) ? ['cancelled', 'no_consent'] : null);
  if (stale) {
    await db.run(`UPDATE bd_reminders SET status = ?, reason = ?, updated_at = NOW() WHERE id = ?`, [stale[0], stale[1], r.id]);
    return stale[0];
  }
  const a = await agencyFor(db, Number(c.agent_id));
  const body = bondCourtText(r.step, {
    lang: c.text_lang, signerType: r.signer_type, agency: a.agency, agencyPhone: a.phone, defendant: c.defendant_name,
    courtDate: dateOnly(c.court_date), courtTime: timeOnly(c.court_time), courtName: c.court_name, room: c.room,
    daysLeft: daysBetween(todayInZone(tz, now), dateOnly(c.court_date)),
  });
  const res = await sendAgentTextRecord(db, { agentId: Number(c.agent_id), bondId: Number(c.bond_id), purpose: purposeOf(r.step), to: r.phone, body });
  if (res.status === 'sent') {
    await db.run(`UPDATE bd_reminders SET status = 'sent', text_id = ?, sent_at = ?, reason = NULL, updated_at = NOW() WHERE id = ?`, [res.textId, now.toISOString(), r.id]);
    if (r.step === 'ask') await db.run('UPDATE bd_court_dates SET asked_at = ? WHERE id = ?', [now.toISOString(), c.id]);
    return 'sent';
  }
  const status = res.status === 'failed' ? 'failed' : 'skipped';
  await db.run(`UPDATE bd_reminders SET status = ?, reason = ?, updated_at = NOW() WHERE id = ?`,
    [status, res.status === 'opted_out' ? 'opted_out' : (res.error || res.status).slice(0, 80), r.id]);
  return status;
}

/**
 * Send what is due (the 'bd-court-reminders' job, every 5 minutes; or one hearing right away).
 * Rows are claimed with FOR UPDATE SKIP LOCKED; a claim older than 10 minutes is retried.
 * → { claimed, sent, skipped, cancelled, failed, alerts }
 */
export async function runBondCourtReminders(db, { now = new Date(), courtDateId = null, limit = 200 } = {}) {
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const only = courtDateId ? 'AND court_date_id = ?' : '';
  const claimed = await db.all(
    `UPDATE bd_reminders SET status = 'sending', claimed_at = ?
      WHERE id IN (SELECT id FROM bd_reminders
                    WHERE ((status = 'pending' AND send_at <= ?) OR (status = 'sending' AND claimed_at < ?)) ${only}
                    ORDER BY send_at LIMIT ? FOR UPDATE SKIP LOCKED)
      RETURNING id, court_date_id, bond_id, signer_type, indemnitor_id, phone, step, court_day`,
    courtDateId ? [nowIso, nowIso, staleIso, courtDateId, limit] : [nowIso, nowIso, staleIso, limit]);
  const counts = { claimed: claimed.length, sent: 0, skipped: 0, cancelled: 0, failed: 0, alerts: 0 };
  for (const r of claimed) {
    try {
      const out = await sendOne(db, r, now);
      counts[out] = (counts[out] || 0) + 1;
    } catch (e) {
      counts.failed += 1;
      logger.error({ id: r.id, err: e.message }, '[bd-court] text failed');
      await db.run(`UPDATE bd_reminders SET status = 'failed', reason = ?, updated_at = NOW() WHERE id = ?`, [String(e.message).slice(0, 80), r.id]).catch(logIgnored('services/bondDesk/courtDates'));
    }
  }
  if (!courtDateId) counts.alerts = await morningAfterAlerts(db, now);
  if (counts.claimed || counts.alerts) logger.info(counts, '[bd-court] run');
  return counts;
}

// ── Agent alerts ──────────────────────────────────────────────────────────────

const bondLink = (bondId) => `${String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '')}/bond-desk/bond/${bondId}`;

/** Push + e-mail to the agent, in the agent's language. kind: 'unconfirmed' | 'missed' | 'rescheduled' */
export async function alertAgent(db, c, kind) {
  const agentId = Number(c.agent_id);
  const u = await db.get('SELECT preferred_language FROM users WHERE id = ?', [agentId]).catch(() => null);
  const lang = normalizeLang(u?.preferred_language) || 'en';
  const p = { name: c.defendant_name, day: formatDay(dateOnly(c.court_date), lang) };
  const title = msg(lang, `bd.alert.${kind}_title`, p);
  const body = msg(lang, `bd.alert.${kind}_body`, p);
  const push = await sendPushToUser(agentId, { title, body, data: { type: 'bd_court_alert', screen: 'BondDetail', bond_id: Number(c.bond_id), court_date_id: Number(c.id) } })
    .catch(() => ({ sent: 0 }));
  const a = await agencyFor(db, agentId);
  const mail = await sendAgentEmail({ to: a.email, subject: title, text: `${body}\n\n${msg(lang, 'bd.alert.open', { link: bondLink(Number(c.bond_id)) })}` });
  return { push: Number(push?.sent || 0) > 0, email: mail === 'sent' };
}

/**
 * The morning after (09:00 in the bond's zone, until the next morning) a hearing of an active bond
 * that is still not marked attended / rescheduled / cancelled: alert the agent, once per hearing.
 */
async function morningAfterAlerts(db, now) {
  const rows = await db.all(
    `SELECT cd.id FROM bd_court_dates cd JOIN bd_bonds b ON b.id = cd.bond_id
      WHERE cd.deleted_at IS NULL AND cd.followup_at IS NULL AND cd.status IN ('scheduled','missed') AND b.status = 'active'
        AND cd.court_date BETWEEN (CAST(? AS timestamptz) AT TIME ZONE 'UTC')::date - 3 AND (CAST(? AS timestamptz) AT TIME ZONE 'UTC')::date
      ORDER BY cd.court_date LIMIT 500`, [now.toISOString(), now.toISOString()]);
  let n = 0;
  for (const r of rows) {
    const c = await courtCtx(db, r.id);
    const tz = bondTimeZone(c, c.agent_tz);
    const day = dateOnly(c.court_date);
    const from = zonedDateTimeToUtc(addDays(day, 1), FOLLOWUP_AT.hh, FOLLOWUP_AT.mm, tz);
    const until = zonedDateTimeToUtc(addDays(day, 2), FOLLOWUP_AT.hh, FOLLOWUP_AT.mm, tz);
    if (!from || now < from) continue;
    const claim = await db.get('UPDATE bd_court_dates SET followup_at = ? WHERE id = ? AND followup_at IS NULL RETURNING id', [now.toISOString(), r.id]);
    if (!claim || now >= until) continue;   // too late to be useful: marked done without an alert
    try { await alertAgent(db, c, c.status === 'missed' ? 'missed' : 'unconfirmed'); n += 1; } catch (e) { logger.warn({ err: e.message }, '[bd-court] agent alert failed'); }
  }
  return n;
}

// ── Replies "1 / 2 / 3" ───────────────────────────────────────────────────────

export const ANSWERS = Object.freeze({ 1: 'attended', 2: 'rescheduled', 3: 'missed' });
/** "1", " 2 ", "3." → 'attended' | 'rescheduled' | 'missed'; anything else → null. */
export function parseCourtReply(text) {
  const m = /^\s*([123])\s*[.!)]?\s*$/.exec(String(text ?? ''));
  return m ? ANSWERS[m[1]] : null;
}

/**
 * A Bond Desk defendant answered (the newest "Did you make it?" sent to `from` in the last 48 hours).
 * Sets the hearing's status (unless the agent already set it), texts a confirmation, sends the
 * missed-court text right away for "missed", and alerts the agent for missed / rescheduled.
 * → { handled, court_date_id, status, applied } or { handled: false }
 */
export async function handleBondReply(db, { from, answer, courtDateId, now = new Date() }) {
  const c = await courtCtx(db, courtDateId);
  if (!c) return { handled: false };
  const upd = await db.run(
    `UPDATE bd_court_dates SET status = ?, status_source = 'reply', status_at = ?, updated_at = NOW()
      WHERE id = ? AND deleted_at IS NULL AND (status = 'scheduled' OR status_source = 'reply')`, [answer, now.toISOString(), c.id]);
  const applied = !!upd?.changes;
  if (applied) {
    await planBondCourtDate(db, c.id, now);
    await syncBondCourtDate(db, Number(c.bond_id), now);
  }
  const fresh = await courtCtx(db, c.id);
  let missedSent = false;
  if (applied && answer === 'missed') {
    const r = await runBondCourtReminders(db, { now, courtDateId: c.id });
    missedSent = r.sent > 0;
  }
  if (!missedSent) {
    const a = await agencyFor(db, Number(c.agent_id));
    // the agent already set the status: just acknowledge
    const text = bondReplyText(applied ? answer : 'noted', { lang: c.text_lang, agency: a.agency, defendant: c.defendant_name, courtDate: dateOnly(c.court_date) });
    await sendAgentTextRecord(db, { agentId: Number(c.agent_id), bondId: Number(c.bond_id), purpose: 'court_reply', to: from, body: text });
  }
  if (applied && (answer === 'missed' || answer === 'rescheduled')) {
    await db.run('UPDATE bd_court_dates SET followup_at = COALESCE(followup_at, ?) WHERE id = ?', [now.toISOString(), c.id]);
    await alertAgent(db, fresh, answer).catch((e) => logger.warn({ err: e.message }, '[bd-court] agent alert failed'));
  }
  return { handled: true, court_date_id: Number(c.id), status: fresh.status, applied };
}

/** The newest "Did you make it?" texted to `phone` in the last 48 hours → { court_date_id, sent_at } | null */
export async function lastBondAsk(db, phone, now = new Date()) {
  const r = await db.get(
    `SELECT r.court_date_id, r.sent_at FROM bd_reminders r JOIN bd_court_dates cd ON cd.id = r.court_date_id AND cd.deleted_at IS NULL
      WHERE r.phone = ? AND r.step = 'ask' AND r.status = 'sent' AND r.sent_at > CAST(? AS timestamptz) - INTERVAL '48 hours'
      ORDER BY r.sent_at DESC LIMIT 1`, [phone, now.toISOString()]);
  return r ? { court_date_id: Number(r.court_date_id), sent_at: new Date(r.sent_at) } : null;
}
