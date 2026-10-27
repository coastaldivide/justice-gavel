/**
 * checkins.js — post-release check-ins (bail agent ↔ defendant).
 *
 * Bail agent (account type bail_agent, or a bondsman profile; staff too):
 *   POST /api/checkins/enroll                 enroll a defendant { defendant_name, defendant_phone?, defendant_email?,
 *                                             case_number?, court_date?, check_in_freq } → enrollment + the link to send
 *   GET  /api/checkins/enrollments            their defendants, each with today's status in the defendant's day
 *   PUT  /api/checkins/enrollments/:id        { active: boolean } — stop / restart monitoring
 *   PATCH /api/checkins/enrollments/:id/note  supervisor note
 *   GET  /api/checkins/history/:id            the check-in log + 30-day compliance, missed days, texts sent
 *   POST /api/checkins/enrollments/:id/link   text channel: text the personal link again ({ rotate } = reset link)
 *   PATCH /api/checkins/enrollments/:id/settings  { channel, consent_confirmed, defendant_phone, missed_text_defendant, time_zone, lang }
 *   PUT/DELETE /api/checkins/enrollments/:id/home  location alerts (⚖ CHECKIN_LOCATION_ALERTS_ENABLED): home point + radius
 *   GET  /api/checkins/missed                 missed check-ins of the last 30 days
 *   PUT  /api/checkins/agent-settings         { missed_alert_text, alert_phone } — text me when a check-in is missed
 * Defendant without an account (text link https://<app>/c/<token>; services/checkinTexts.js):
 *   GET  /api/checkins/link/:token            agency name + phone, first name, today's status
 *   POST /api/checkins/link/:token            { lat?, lng?, note? } — check in (location only when shared, each time)
 * Defendant:
 *   GET  /api/checkins/mine                   my enrollments (an enrollment whose phone matches my VERIFIED phone
 *                                             is linked to me the first time I look) with today's status
 *   GET  /api/checkins/status/:id             one enrollment's status (defendant, its bail agent, or staff)
 *   GET  /api/checkins/my/:id                 my check-in history for one enrollment
 *   POST /api/checkins/submit                 { enrollment_id, lat?, lng?, location_label?, notes? } — the bail agent is notified
 *   GET  /api/checkins/compliance-report/:id  compliance summary (defendant or bail agent)
 * Scheduler / staff:
 *   POST /api/checkins/remind-all             plans any missing check-in reminders now (they are also planned on
 *                                             enroll, link and submit, and by the reminder dispatcher's sweep)
 *
 * "Today" is always the defendant's local calendar day (services/checkinReminders.js).
 * Location is sent only when the defendant turns it on for that check-in.
 * Channel 'sms' (no app): reminders and missed-check-in texts go out by text with a personal link
 * (5¢ each on the agent's plan invoice, like Bond Desk texts); check-ins stay free.
 * Billing: the per-defendant fee is not charged anywhere yet (no Stripe product exists for it);
 * the enrollment says so (billing_active: false) instead of pretending a subscription exists.
 * Text is in the request's language (?lang= / Accept-Language).
 */
import { timingSafeEqual, createHash } from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authRequired } from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { isStaff } from '../utils/staff.js';
import { safeInt, sanitizeStr, truncateStr } from '../utils/routeHelpers.js';
import { AGENT_TEXT_CENTS } from './billing/plans.js';
import { toE164 } from '../services/sms.js';
import { verifiedPhone } from '../services/phoneVerification.js';
import { helpLinksForCourtName } from '../services/courtDayHelp.js';
import { rememberTimeZone, dateOnly } from '../services/courtReminders.js';
import { safeCourtDate } from './cases.js';
import { resolveLang, msg, rememberLanguage, requestedLang, normalizeLang } from '../i18n/index.js';
import {
  CHECKIN_FREQS, checkinState, compliance, enrollmentTimeZone, localDay,
  planCheckinReminder, cancelCheckinReminders, backfillCheckinReminders,
} from '../services/checkinReminders.js';
import {
  CheckinLinkError, LINK_TOKEN_RE, agentCanText, firstName, locationAlertsEnabled, recordCheckin,
  rememberEnrollmentZone, resolveLinkToken, sendLinkText, textReady,
} from '../services/checkinTexts.js';
import { agencyFor } from '../services/bondDesk/core.js';
import { isValidTimeZone } from '../utils/timezone.js';

const router = Router();
const say = (req, key, params) => msg(resolveLang(req), key, params);
const fail = (req, res, status, key, extra = {}) => res.status(status).json({ error: say(req, key), ...extra });

// Oct 26 2026: check-ins are included in every bail-agent plan (eBail and Captira include them; no
// per-defendant fee). Kept as a named 0 so the enrollment rows and the API stay explicit about it.
export const FEE_PER_DEFENDANT_CENTS = 0;
const APP_URL = () => String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');
export const checkinLink = (id) => `${APP_URL()}/checkin?enrollmentId=${Number(id)}`;

const writeLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 30, message: (req) => say(req, 'checkin.err.too_many') });
const remindAllLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 2, message: (req) => say(req, 'checkin.err.reminded_recently') });

const ENROLL_COLS = `id, bondsman_id, user_id, defendant_name, defendant_phone, defendant_email, case_number, court_date,
  check_in_freq, active, monthly_fee_cents, created_at, supervisor_note, channel, sms_consent_at, sms_consent_phone,
  active_since, missed_text_defendant, time_zone, lang, home_lat, home_lng, home_radius_miles`;
export const CHANNELS = Object.freeze(['app', 'sms']);
/** What the agent sees of an enrollment row (no consent internals). */
const agentRow = (e) => ({
  ...e, sms_consent_phone: undefined, text_consent: !!e.sms_consent_at,
  missed_text_defendant: !!e.missed_text_defendant,
  home: e.home_lat == null ? null : { lat: Number(e.home_lat), lng: Number(e.home_lng), radius_miles: Number(e.home_radius_miles) },
  home_lat: undefined, home_lng: undefined, home_radius_miles: undefined,
});
const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const looksLikeEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Bail agents (account type or a bondsman profile) and staff may enroll defendants. */
async function isBailAgent(db, user) {
  const u = await db.get(
    `SELECT u.user_type, EXISTS (SELECT 1 FROM bondsman_profiles b WHERE b.user_id = u.id) AS has_profile
       FROM users u WHERE u.id = ?`, [user.id]).catch(() => null);
  if (u && (u.user_type === 'bail_agent' || u.has_profile === true || Number(u.has_profile) === 1)) return true;
  return isStaff(db, user);
}

/** The agent's name as the defendant sees it: company, else display name. */
async function agentName(db, bondsmanId) {
  const r = await db.get(
    `SELECT u.display_name, u.name, (SELECT company_name FROM bondsman_profiles b WHERE b.user_id = u.id LIMIT 1) AS company
       FROM users u WHERE u.id = ?`, [bondsmanId]).catch(() => null);
  return String(r?.company || r?.display_name || r?.name || '').trim() || null;
}

/**
 * Link enrollments whose defendant phone matches the signed-in account's VERIFIED phone.
 *
 * Only a phone number the account VERIFIED by texted code counts (services/phoneVerification.js,
 * migration 40). E-mail is never used: the app does not verify e-mail addresses. An enrollment
 * held by another account whose own verification of that number is gone (the number moved on,
 * or the link predates verification and was held by migration 40) moves to the verified account.
 */
export async function claimMatching(db, userId) {
  const phone = digits10(await verifiedPhone(db, userId));
  if (phone.length !== 10) return [];
  const rows = await db.all(
    `UPDATE checkin_enrollments e SET user_id = ?, held_user_id = NULL, held_at = NULL, updated_at = NOW()
      WHERE e.active = 1 AND e.bondsman_id <> ?
        AND RIGHT(regexp_replace(COALESCE(e.defendant_phone, ''), '[^0-9]', '', 'g'), 10) = ?
        AND (e.user_id IS NULL OR (e.user_id <> ? AND NOT EXISTS (
              SELECT 1 FROM users u WHERE u.id = e.user_id AND u.phone_verified_at IS NOT NULL
                 AND RIGHT(regexp_replace(COALESCE(u.phone_verified_phone, ''), '[^0-9]', '', 'g'), 10) = ?)))
      RETURNING id`, [userId, userId, phone, userId, phone]);
  return rows.map(r => Number(r.id));
}

/**
 * Who may see an enrollment: its bail agent, its linked defendant, or staff.
 * A not-yet-linked enrollment whose contact matches the caller is linked first.
 * Everyone else gets null (→ 404; ids are sequential and must not be confirmed).
 */
async function enrollmentAccess(db, user, enrollmentId) {
  const id = safeInt(enrollmentId);
  if (!id) return null;
  let e = await db.get(`SELECT ${ENROLL_COLS} FROM checkin_enrollments WHERE id = ?`, [id]);
  if (!e) return null;
  if (Number(e.bondsman_id) === Number(user.id)) return { e, as: 'bondsman' };
  if (e.user_id == null && (await claimMatching(db, user.id)).includes(id)) {
    e = { ...e, user_id: user.id };
    await planCheckinReminder(db, id).catch(err => logger.warn({ err: err.message }, '[checkins] plan after link'));
  }
  if (e.user_id != null && Number(e.user_id) === Number(user.id)) return { e, as: 'defendant' };
  if (await isStaff(db, user)) return { e, as: 'staff' };
  return null;
}

/** What the defendant sees (no bail agent internals, no billing). */
async function defendantView(db, e, state) {
  return {
    id: Number(e.id), defendant_name: e.defendant_name, case_number: e.case_number || null,
    court_date: e.court_date || null, check_in_freq: e.check_in_freq, active: Number(e.active) === 1,
    created_at: e.created_at, agent_name: await agentName(db, e.bondsman_id),
    checked_in_today: state.done && state.last_day === state.today, done_for_period: state.done,
    last_checkin_day: state.last_day, next_due: state.next_due, streak: state.streak, total_checkins: state.total,
    today: state.today, time_zone: state.tz,
  };
}

/** Remember the device zone / language the request carries (reminders follow them). */
async function rememberPrefs(db, req) {
  await rememberTimeZone(db, req.user.id, req.get('X-Timezone')).catch(() => false);
  await rememberLanguage(db, req.user.id, requestedLang(req)).catch(() => false);
}

// ── Bail agent: enroll ─────────────────────────────────────────────────────
router.post('/enroll', authRequired, writeLimiter, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const name = truncateStr(sanitizeStr(String(b.defendant_name || ''), 120), 120).trim();
  if (!name) return fail(req, res, 400, 'checkin.err.name_required');
  const phoneRaw = String(b.defendant_phone || '').trim();
  const phone = phoneRaw ? toE164(phoneRaw) : null;
  if (phoneRaw && !phone) return fail(req, res, 400, 'checkin.err.bad_phone');
  const email = String(b.defendant_email || '').trim().toLowerCase() || null;
  if (email && !looksLikeEmail(email)) return fail(req, res, 400, 'checkin.err.bad_email');
  if (!phone && !email) return fail(req, res, 400, 'checkin.err.contact_required');
  const courtDate = b.court_date ? safeCourtDate(b.court_date) : null;
  if (b.court_date && !courtDate) return fail(req, res, 400, 'checkin.err.bad_date');
  const freq = b.check_in_freq == null || b.check_in_freq === '' ? 'daily' : String(b.check_in_freq);
  if (!CHECKIN_FREQS.includes(freq)) return fail(req, res, 400, 'checkin.err.bad_freq');
  const caseNumber = truncateStr(sanitizeStr(String(b.case_number || ''), 60), 60).trim() || null;
  const channel = b.channel == null || b.channel === '' ? 'app' : String(b.channel);
  if (!CHANNELS.includes(channel)) return fail(req, res, 400, 'checkin.err.bad_channel', { code: 'bad_channel' });
  if (channel === 'sms' && !phone) return fail(req, res, 400, 'checkin.err.phone_required_for_text', { code: 'phone_required' });
  if (channel === 'sms' && b.consent_confirmed !== true) return fail(req, res, 400, 'checkin.err.consent_required', { code: 'consent_required' });
  const tz = b.time_zone ? String(b.time_zone) : null;
  if (tz && !isValidTimeZone(tz)) return fail(req, res, 400, 'checkin.err.bad_tz', { code: 'bad_time_zone' });
  const textLang = normalizeLang(b.lang) || resolveLang(req);
  const missedText = typeof b.missed_text_defendant === 'boolean' ? b.missed_text_defendant : channel === 'sms';
  try {
    const db = await getDb();
    if (!(await isBailAgent(db, req.user))) return fail(req, res, 403, 'checkin.err.agents_only', { code: 'bail_agents_only' });
    if (channel === 'sms' && !(await agentCanText(db, req.user.id))) return fail(req, res, 403, 'checkin.err.plan_required', { code: 'plan_required' });
    await rememberPrefs(db, req);
    const row = await db.get(
      `INSERT INTO checkin_enrollments
         (bondsman_id, defendant_name, defendant_phone, defendant_email, case_number, court_date, check_in_freq,
          active, monthly_fee_cents, stripe_sub_id, enrolled_by, enrolled_at, status, updated_at,
          channel, sms_consent_at, sms_consent_phone, active_since, missed_text_defendant, time_zone, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, NOW(), 'active', NOW(), ?, ?, ?, NOW(), ?, ?, ?)
       RETURNING ${ENROLL_COLS}`,
      [req.user.id, name, phone, email, caseNumber, courtDate, freq, FEE_PER_DEFENDANT_CENTS, req.user.id,
        channel, channel === 'sms' ? new Date().toISOString() : null, channel === 'sms' ? phone : null, missedText, tz, textLang]);
    const lang = resolveLang(req);
    let link = checkinLink(row.id);
    let textStatus = null;
    if (channel === 'sms') {
      const sent = await sendLinkText(db, row);
      link = sent.link; textStatus = sent.status;
    }
    res.status(201).json({
      success: true, enrollment: agentRow(row), checkin_link: link, billing_active: false, text_status: textStatus,
      share_message: msg(lang, channel === 'sms' ? 'checkin.share_message_text' : 'checkin.share_message', { name: name.split(/\s+/)[0], link }),
      message: msg(lang, channel === 'sms' ? 'checkin.enrolled_text' : 'checkin.enrolled', { name }),
    });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/enroll]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

// ── Bail agent: list ───────────────────────────────────────────────────────
router.get('/enrollments', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT ${ENROLL_COLS} FROM checkin_enrollments WHERE bondsman_id = ? ORDER BY active DESC, created_at DESC LIMIT 500`,
      [req.user.id]);
    const ids = rows.map(r => Number(r.id));
    const missedBy = new Map(); const textBy = new Map();
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      for (const m of await db.all(
        `SELECT enrollment_id, local_day FROM checkin_missed WHERE enrollment_id IN (${ph}) AND local_day >= CURRENT_DATE - 14
          ORDER BY local_day DESC LIMIT 2000`, ids)) {
        const k = Number(m.enrollment_id);
        if (!missedBy.has(k)) missedBy.set(k, []);
        missedBy.get(k).push(m.local_day);
      }
      for (const t of await db.all(
        `SELECT DISTINCT ON (t.enrollment_id) t.enrollment_id, t.kind, t.status, t.created_at, d.status AS delivery_status
           FROM checkin_texts t LEFT JOIN sms_delivery d ON d.provider_id = t.provider_id
          WHERE t.enrollment_id IN (${ph}) ORDER BY t.enrollment_id, t.created_at DESC, t.id DESC LIMIT 500`, ids)) {
        textBy.set(Number(t.enrollment_id), { kind: t.kind, status: t.status, at: t.created_at, delivery_status: t.delivery_status || null });
      }
    }
    const enrollments = [];
    for (const e of rows) {
      const st = await checkinState(db, e);
      const last = await db.get('SELECT checked_in_at FROM checkin_records WHERE enrollment_id = ? ORDER BY checked_in_at DESC LIMIT 1', [e.id]);
      enrollments.push({
        ...agentRow(e), id: Number(e.id), active: Number(e.active), linked: e.user_id != null, user_id: undefined,
        total_checkins: st.total, checkins_today: st.last_day === st.today ? 1 : 0, done_for_period: st.done,
        next_due: st.next_due, today: st.today, time_zone: st.tz, last_checkin: last?.checked_in_at || null,
        // the text link exists only in the texts (its token is stored hashed): resend it to get a new one
        checkin_link: e.channel === 'sms' ? null : checkinLink(e.id),
        recent_missed: missedBy.get(Number(e.id)) || [], last_text: textBy.get(Number(e.id)) || null,
        text_ready: textReady(e),
      });
    }
    const totalActive = enrollments.filter(e => e.active).length;
    const settings = await db.get('SELECT missed_alert_text, alert_phone FROM checkin_agent_settings WHERE agent_id = ?', [req.user.id]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enrollments, total_active: totalActive, fee_cents: FEE_PER_DEFENDANT_CENTS,
      monthly_cost_cents: totalActive * FEE_PER_DEFENDANT_CENTS, billing_active: false, included_in_plan: true,
      can_text: await agentCanText(db, req.user.id), text_cents: AGENT_TEXT_CENTS,
      location_alerts_enabled: locationAlertsEnabled(),
      agent_settings: { missed_alert_text: !!settings?.missed_alert_text, alert_phone: settings?.alert_phone || null },
    });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/enrollments]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

// ── Bail agent: stop / restart ─────────────────────────────────────────────
router.put('/enrollments/:id', authRequired, writeLimiter, async (req, res) => {
  if (typeof req.body?.active !== 'boolean') return fail(req, res, 400, 'checkin.err.active_bool');
  try {
    const db = await getDb();
    const id = safeInt(req.params.id);
    // a restart starts a new monitoring period: the paused days are never "missed"
    const r = await db.run(
      `UPDATE checkin_enrollments SET active = ?, updated_at = NOW(),
              active_since = CASE WHEN ? = 1 AND active <> 1 THEN NOW() ELSE active_since END
        WHERE id = ? AND bondsman_id = ?`,
      [req.body.active ? 1 : 0, req.body.active ? 1 : 0, id, req.user.id]);
    if (!r.changes) return fail(req, res, 404, 'checkin.err.not_found');
    if (req.body.active) await planCheckinReminder(db, id);
    else await cancelCheckinReminders(db, id, 'enrollment_inactive');
    res.json({ success: true, id, active: req.body.active });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/enrollments/update]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

router.patch('/enrollments/:id/note', authRequired, writeLimiter, async (req, res) => {
  const id = safeInt(req.params.id);
  const note = truncateStr(sanitizeStr(String(req.body?.note || ''), 1000), 1000).trim();
  if (!id || !note) return fail(req, res, 400, 'checkin.err.note_required');
  try {
    const db = await getDb();
    const r = await db.run('UPDATE checkin_enrollments SET supervisor_note = ?, updated_at = NOW() WHERE id = ? AND bondsman_id = ?',
      [note, id, req.user.id]);
    if (!r.changes) return fail(req, res, 404, 'checkin.err.not_found');
    res.json({ updated: true, enrollment_id: id });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/note]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

const RECORD_COLS = `id, enrollment_id, checked_in_at, notes, status, location_label,
  CAST(lat AS double precision) AS lat, CAST(lng AS double precision) AS lng, via, counted, distance_miles, outside_radius`;

// ── Bail agent: history + compliance ───────────────────────────────────────
router.get('/history/:enrollmentId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const e = await db.get(`SELECT ${ENROLL_COLS} FROM checkin_enrollments WHERE id = ? AND bondsman_id = ?`,
      [safeInt(req.params.enrollmentId), req.user.id]);
    if (!e) return fail(req, res, 404, 'checkin.err.not_found');
    const tz = await enrollmentTimeZone(db, e);
    const records = (await db.all(`SELECT ${RECORD_COLS} FROM checkin_records WHERE enrollment_id = ? ORDER BY checked_in_at DESC LIMIT 60`, [e.id]))
      .map(r => ({ ...r, local_day: localDay(r.checked_in_at, tz) }));
    const c = await compliance(db, e);
    const missed = await db.all('SELECT local_day, agent_push, agent_email, agent_text, defendant_text FROM checkin_missed WHERE enrollment_id = ? ORDER BY local_day DESC LIMIT 60', [e.id]);
    const texts = await db.all(
      `SELECT t.kind, t.local_day, t.status, t.created_at, d.status AS delivery_status FROM checkin_texts t
         LEFT JOIN sms_delivery d ON d.provider_id = t.provider_id WHERE t.enrollment_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 60`, [e.id]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enrollment: { ...agentRow(e), linked: e.user_id != null, user_id: undefined }, records, time_zone: tz, missed,
      texts: texts.map(t => ({ ...t, delivery_status: t.delivery_status || null })),
      location_alerts_enabled: locationAlertsEnabled(),
      compliance: { window_days: 30, expected: c.expected, completed: c.completed, missed: c.missed, rate: c.rate,
        last_checkin: records[0]?.checked_in_at || null },
    });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/history]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

// ── Defendant: my enrollments ──────────────────────────────────────────────
router.get('/mine', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    await rememberPrefs(db, req);
    for (const id of await claimMatching(db, req.user.id)) await planCheckinReminder(db, id).catch(() => null);
    const rows = await db.all(
      `SELECT ${ENROLL_COLS} FROM checkin_enrollments WHERE user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 20`, [req.user.id]);
    const out = [];
    for (const e of rows) out.push(await defendantView(db, e, await checkinState(db, e)));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ enrollments: out });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/mine]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

router.get('/status/:enrollmentId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    await rememberPrefs(db, req);
    const access = await enrollmentAccess(db, req.user, req.params.enrollmentId);
    if (!access) return fail(req, res, 404, 'checkin.err.not_found');
    const st = await checkinState(db, access.e);
    const view = await defendantView(db, access.e, st);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enrollment: view, as: access.as, checked_in_today: view.checked_in_today, done_for_period: st.done,
      total_checkins: st.total, streak: st.streak, next_due: st.next_due, today: st.today, time_zone: st.tz,
    });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/status]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

router.get('/my/:enrollmentId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const access = await enrollmentAccess(db, req.user, req.params.enrollmentId);
    if (!access) return fail(req, res, 404, 'checkin.err.not_found');
    const tz = await enrollmentTimeZone(db, access.e);
    const rows = await db.all(`SELECT ${RECORD_COLS} FROM checkin_records WHERE enrollment_id = ? ORDER BY checked_in_at DESC LIMIT 30`, [access.e.id]);
    res.json(rows.map(r => ({ ...r, local_day: localDay(r.checked_in_at, tz) })));
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/my]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

// ── Defendant: check in ────────────────────────────────────────────────────
function coord(v, max) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : NaN;
}
router.post('/submit', authRequired, writeLimiter, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (!safeInt(b.enrollment_id)) return fail(req, res, 400, 'checkin.err.enrollment_required');
  const lat = coord(b.lat, 90); const lng = coord(b.lng, 180);
  if (Number.isNaN(lat) || Number.isNaN(lng) || (lat === null) !== (lng === null)) return fail(req, res, 400, 'checkin.err.bad_location');
  const notes = truncateStr(sanitizeStr(String(b.notes ?? b.note ?? ''), 2000), 2000).trim();
  const label = truncateStr(sanitizeStr(String(b.location_label ?? b.location ?? ''), 200), 200).trim();
  try {
    const db = await getDb();
    await rememberPrefs(db, req);
    const access = await enrollmentAccess(db, req.user, b.enrollment_id);
    if (!access || access.as !== 'defendant' || !Number(access.e.active)) return fail(req, res, 404, 'checkin.err.not_found');
    const e = access.e;
    // one check-in per local day; the bail agent is told (push), location alert when set (B1)
    const result = await recordCheckin(db, e, {
      userId: req.user.id, via: 'app', lat, lng, label: label || null, notes: notes || null,
      device: truncateStr(String(b.device_info || ''), 200) || null,
    });
    if (result.dup) return res.status(409).json({ error: say(req, 'checkin.err.already_today'), code: 'already_checked_in', already_done: true });
    const st = result.st;
    await planCheckinReminder(db, e.id).catch(err => logger.warn({ err: err.message }, '[checkins] plan after submit'));
    res.status(201).json({
      success: true, record_id: Number(result.row.id), checked_in_at: result.row.checked_in_at,
      agent_notified: result.agent_notified, next_due: st.next_due, streak: st.streak, total_checkins: st.total,
      today: st.today, time_zone: st.tz, message: say(req, 'checkin.submitted'),
    });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/submit]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

router.get('/compliance-report/:enrollmentId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const access = await enrollmentAccess(db, req.user, req.params.enrollmentId);
    if (!access) return fail(req, res, 404, 'checkin.err.not_found');
    const c = await compliance(db, access.e);
    res.json({
      enrollment_id: Number(access.e.id), window_days: 30, ...c,
      status: c.rate == null ? 'new' : c.rate >= 90 ? 'good' : c.rate >= 70 ? 'warning' : 'critical',
    });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/compliance]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

// ── Bail agent: text link, channel, alerts, home point ─────────────────────
function agentEnrollment(db, req) {
  const id = safeInt(req.params.id);
  if (!id) return Promise.resolve(null);
  return db.get(`SELECT ${ENROLL_COLS} FROM checkin_enrollments WHERE id = ? AND bondsman_id = ?`, [id, req.user.id]);
}
const TEXT_FAIL = { opted_out: 'checkin.err.opted_out', no_plan: 'checkin.err.plan_required' };

/** Text the personal link again ({ rotate: true } = reset: every earlier link stops working). */
router.post('/enrollments/:id/link', authRequired, writeLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const e = await agentEnrollment(db, req);
    if (!e) return fail(req, res, 404, 'checkin.err.not_found');
    if (!Number(e.active)) return fail(req, res, 409, 'checkin.err.enrollment_stopped', { code: 'enrollment_stopped' });
    if (e.channel !== 'sms') return fail(req, res, 409, 'checkin.err.not_text_channel', { code: 'not_text_channel' });
    if (!textReady(e)) return fail(req, res, 400, 'checkin.err.consent_required', { code: 'consent_required' });
    if (!(await agentCanText(db, req.user.id))) return fail(req, res, 403, 'checkin.err.plan_required', { code: 'plan_required' });
    const r = await sendLinkText(db, e, { revokeOthers: req.body?.rotate === true });
    if (TEXT_FAIL[r.status]) return fail(req, res, r.status === 'no_plan' ? 403 : 409, TEXT_FAIL[r.status], { code: r.status, link: r.link });
    res.json({ status: r.status, link: r.link, rotated: req.body?.rotate === true });
  } catch (err) {
    logger.error({ err: err.message }, '[checkins/link]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

/** Change the channel and the defendant-text settings of an enrollment. */
router.patch('/enrollments/:id/settings', authRequired, writeLimiter, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    const db = await getDb();
    const e = await agentEnrollment(db, req);
    if (!e) return fail(req, res, 404, 'checkin.err.not_found');
    const f = {};
    if (b.defendant_phone !== undefined) {
      const raw = String(b.defendant_phone || '').trim();
      const ph = raw ? toE164(raw) : null;
      if (raw && !ph) return fail(req, res, 400, 'checkin.err.bad_phone');
      if (!ph && !e.defendant_email) return fail(req, res, 400, 'checkin.err.contact_required');
      f.defendant_phone = ph;
    }
    if (b.channel !== undefined) {
      if (!CHANNELS.includes(b.channel)) return fail(req, res, 400, 'checkin.err.bad_channel', { code: 'bad_channel' });
      f.channel = b.channel;
    }
    if (b.missed_text_defendant !== undefined) {
      if (typeof b.missed_text_defendant !== 'boolean') return fail(req, res, 400, 'checkin.err.bad_setting', { code: 'invalid' });
      f.missed_text_defendant = b.missed_text_defendant;
    }
    if (b.time_zone !== undefined) {
      if (b.time_zone !== null && !isValidTimeZone(String(b.time_zone))) return fail(req, res, 400, 'checkin.err.bad_tz', { code: 'bad_time_zone' });
      f.time_zone = b.time_zone || null;
    }
    if (b.lang !== undefined) {
      if (!normalizeLang(b.lang)) return fail(req, res, 400, 'checkin.err.bad_setting', { code: 'invalid' });
      f.lang = normalizeLang(b.lang);
    }
    const next = { ...e, ...f };
    const phoneChanged = f.defendant_phone !== undefined && f.defendant_phone !== e.defendant_phone;
    if (b.consent_confirmed === true && next.defendant_phone) { f.sms_consent_at = new Date().toISOString(); f.sms_consent_phone = next.defendant_phone; }
    else if (phoneChanged) { f.sms_consent_at = null; f.sms_consent_phone = null; }   // consent covers one number
    const after = { ...next, ...f };
    if (after.channel === 'sms') {
      if (!after.defendant_phone) return fail(req, res, 400, 'checkin.err.phone_required_for_text', { code: 'phone_required' });
      if (!textReady(after)) return fail(req, res, 400, 'checkin.err.consent_required', { code: 'consent_required' });
      if (e.channel !== 'sms' && !(await agentCanText(db, req.user.id))) return fail(req, res, 403, 'checkin.err.plan_required', { code: 'plan_required' });
    }
    const keys = Object.keys(f);
    if (!keys.length) return fail(req, res, 400, 'checkin.err.bad_setting', { code: 'invalid' });
    await db.run(`UPDATE checkin_enrollments SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = NOW() WHERE id = ? AND bondsman_id = ?`,
      [...keys.map(k => f[k]), e.id, req.user.id]);
    const row = await db.get(`SELECT ${ENROLL_COLS} FROM checkin_enrollments WHERE id = ?`, [e.id]);
    // switching to text: send the link now; switching back to the app: push reminders again
    let text = null;
    if (row.channel === 'sms' && e.channel !== 'sms' && Number(row.active)) {
      text = await sendLinkText(db, row);
      await cancelCheckinReminders(db, row.id, 'channel_sms');
    } else if (row.channel === 'app' && e.channel === 'sms' && Number(row.active)) {
      await planCheckinReminder(db, row.id).catch(() => null);
    }
    res.json({ enrollment: agentRow(row), text_status: text?.status || null, link: text?.link || null });
  } catch (err) {
    logger.error({ err: err.message }, '[checkins/settings]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

/** B1 (⚖ counsel 2.4): the home point and radius. 503 while CHECKIN_LOCATION_ALERTS_ENABLED is off. */
function locationAlertsOn(req, res, next) {
  if (locationAlertsEnabled()) return next();
  return res.status(503).json({ error: say(req, 'checkin.err.location_alerts_off'), code: 'feature_unavailable' });
}
router.put('/enrollments/:id/home', authRequired, locationAlertsOn, writeLimiter, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const radius = Number(b.radius_miles);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 500) return fail(req, res, 400, 'checkin.err.bad_home', { code: 'bad_radius' });
  try {
    const db = await getDb();
    const e = await agentEnrollment(db, req);
    if (!e) return fail(req, res, 404, 'checkin.err.not_found');
    let lat; let lng;
    if (b.record_id != null) {
      const r = await db.get('SELECT CAST(lat AS double precision) AS lat, CAST(lng AS double precision) AS lng FROM checkin_records WHERE id = ? AND enrollment_id = ?',
        [safeInt(b.record_id), e.id]);
      if (!r || r.lat == null || r.lng == null) return fail(req, res, 400, 'checkin.err.bad_home', { code: 'no_location' });
      lat = Number(r.lat); lng = Number(r.lng);
    } else {
      lat = coord(b.lat, 90); lng = coord(b.lng, 180);
      if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) return fail(req, res, 400, 'checkin.err.bad_home', { code: 'bad_location' });
    }
    await db.run('UPDATE checkin_enrollments SET home_lat = ?, home_lng = ?, home_radius_miles = ?, updated_at = NOW() WHERE id = ?',
      [lat, lng, Math.round(radius * 100) / 100, e.id]);
    res.json({ home: { lat, lng, radius_miles: Math.round(radius * 100) / 100 } });
  } catch (err) {
    logger.error({ err: err.message }, '[checkins/home]');
    fail(req, res, 500, 'checkin.err.server');
  }
});
router.delete('/enrollments/:id/home', authRequired, locationAlertsOn, writeLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const e = await agentEnrollment(db, req);
    if (!e) return fail(req, res, 404, 'checkin.err.not_found');
    await db.run('UPDATE checkin_enrollments SET home_lat = NULL, home_lng = NULL, home_radius_miles = NULL, updated_at = NOW() WHERE id = ?', [e.id]);
    res.json({ home: null });
  } catch (err) {
    logger.error({ err: err.message }, '[checkins/home/delete]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

/** The agent's missed check-ins (A3), newest first. */
router.get('/missed', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT m.enrollment_id, m.local_day, m.detected_at, e.defendant_name, e.channel, e.active
         FROM checkin_missed m JOIN checkin_enrollments e ON e.id = m.enrollment_id
        WHERE e.bondsman_id = ? AND m.local_day >= CURRENT_DATE - 30 ORDER BY m.local_day DESC, m.id DESC LIMIT 100`, [req.user.id]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ missed: rows.map(r => ({ ...r, enrollment_id: Number(r.enrollment_id), active: Number(r.active) })) });
  } catch (err) {
    logger.error({ err: err.message }, '[checkins/missed]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

/** The agent's own alert choice: text me when a check-in is missed (5¢ each, needs a plan). */
router.put('/agent-settings', authRequired, writeLimiter, async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof b.missed_alert_text !== 'boolean') return fail(req, res, 400, 'checkin.err.bad_setting', { code: 'invalid' });
  const raw = String(b.alert_phone || '').trim();
  const phone = raw ? toE164(raw) : null;
  if (raw && !phone) return fail(req, res, 400, 'checkin.err.bad_phone');
  if (b.missed_alert_text && !phone) return fail(req, res, 400, 'checkin.err.alert_phone_required', { code: 'phone_required' });
  try {
    const db = await getDb();
    if (!(await isBailAgent(db, req.user))) return fail(req, res, 403, 'checkin.err.agents_only', { code: 'bail_agents_only' });
    if (b.missed_alert_text && !(await agentCanText(db, req.user.id))) return fail(req, res, 403, 'checkin.err.plan_required', { code: 'plan_required' });
    await db.run(
      `INSERT INTO checkin_agent_settings (agent_id, missed_alert_text, alert_phone, updated_at) VALUES (?, ?, ?, NOW())
       ON CONFLICT (agent_id) DO UPDATE SET missed_alert_text = EXCLUDED.missed_alert_text, alert_phone = EXCLUDED.alert_phone, updated_at = NOW()`,
      [req.user.id, b.missed_alert_text, phone]);
    res.json({ agent_settings: { missed_alert_text: b.missed_alert_text, alert_phone: phone } });
  } catch (err) {
    logger.error({ err: err.message }, '[checkins/agent-settings]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

// ── Defendant, no account: the text link (/c/:token) ───────────────────────
// The link is the credential (32 random bytes; only its SHA-256 is stored). IP limit for every
// call; a tighter limit per link for check-ins.
const linkIpLimiter = rateLimit({
  windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: (req) => ({ error: say(req, 'checkin.err.too_many'), code: 'too_many_requests' }),
});
const linkTokenLimiter = rateLimit({
  windowMs: 3_600_000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `ck:${createHash('sha256').update(String(req.params.token || '')).digest('hex').slice(0, 32)}`,
  message: (req) => ({ error: say(req, 'checkin.err.too_many'), code: 'too_many_requests' }),
});
function linkFail(req, res, err) {
  if (err instanceof CheckinLinkError) return res.status(err.status).json({ error: say(req, `checkin.err.${err.code}`), code: err.code });
  logger.error({ err: err?.message }, '[checkins/link-page]');
  return fail(req, res, 500, 'checkin.err.server');
}
/**
 * The next court date the link page shows with "Help getting to court" (A8): the Bond Desk bond's
 * next hearing when the agent attached a bond (court name, room, county), else the enrollment's
 * court date. Date, court name and room only — nothing else about the case.
 */
async function linkCourt(db, e, today) {
  const b = await db.get(
    `SELECT cd.court_date, cd.court_time, COALESCE(cd.court_name, b.court_name) AS court_name, cd.room, b.county, b.state
       FROM bd_bonds b JOIN bd_court_dates cd ON cd.bond_id = b.id AND cd.deleted_at IS NULL AND cd.status = 'scheduled'
      WHERE b.checkin_enrollment_id = ? AND b.agent_id = ? AND cd.court_date >= CAST(? AS date)
      ORDER BY cd.court_date, cd.court_time NULLS FIRST LIMIT 1`, [e.id, e.bondsman_id, today]);
  if (b) {
    return { date: dateOnly(b.court_date),
      time: b.court_time ? String(b.court_time).slice(0, 5) : null, court_name: b.court_name || null, room: b.room || null,
      help: helpLinksForCourtName(b) };
  }
  const d = e.court_date ? dateOnly(e.court_date) : null;
  if (!d || d < today) return null;
  return { date: d, time: null, court_name: null, room: null, help: helpLinksForCourtName({}) };
}
async function linkView(db, e, st) {
  const a = await agencyFor(db, e.bondsman_id);
  return {
    court: await linkCourt(db, e, st.today),
    agency: { name: String(a.agency || a.agent_name || '').trim() || null, phone: a.phone || null },
    first_name: firstName(e.defendant_name), frequency: e.check_in_freq,
    checked_in_today: st.last_day === st.today, done_for_period: st.done, next_due: st.next_due,
    today: st.today, time_zone: st.tz,
    // location is asked at each check-in and is optional; the agent is alerted when it is far from home (B1)
    location: { optional: true, distance_alerts: locationAlertsEnabled() && e.home_lat != null },
  };
}
router.get('/link/:token', linkIpLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const { e } = await resolveLinkToken(db, req.params.token);
    await rememberEnrollmentZone(db, e, req.get('X-Timezone')).catch(() => false);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await linkView(db, e, await checkinState(db, e)));
  } catch (err) { linkFail(req, res, err); }
});
router.post('/link/:token', linkIpLimiter, (req, res, next) => (LINK_TOKEN_RE.test(String(req.params.token || '')) ? next() : linkFail(req, res, new CheckinLinkError(404, 'link_invalid'))),
  linkTokenLimiter, async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const lat = coord(b.lat, 90); const lng = coord(b.lng, 180);
    if (Number.isNaN(lat) || Number.isNaN(lng) || (lat === null) !== (lng === null)) return fail(req, res, 400, 'checkin.err.bad_location', { code: 'bad_location' });
    const notes = truncateStr(sanitizeStr(String(b.note ?? b.notes ?? ''), 500), 500).trim();
    try {
      const db = await getDb();
      const { e, tokenId } = await resolveLinkToken(db, req.params.token);
      await rememberEnrollmentZone(db, e, req.get('X-Timezone') || b.time_zone).catch(() => false);
      const r = await recordCheckin(db, e, { via: 'link', lat, lng, notes: notes || null,
        device: truncateStr(String(req.get('user-agent') || ''), 200) || null, allowExtra: true });
      await db.run('UPDATE checkin_link_tokens SET last_used_at = NOW() WHERE id = ?', [tokenId]);
      res.status(201).json({
        success: true, counted: r.counted, checked_in_at: r.row.checked_in_at, location_shared: lat !== null,
        ...(await linkView(db, e, r.st)),
        message: say(req, r.counted ? 'checkin.submitted' : 'checkin.submitted_extra'),
      });
    } catch (err) { linkFail(req, res, err); }
  });

// ── Scheduler / staff ──────────────────────────────────────────────────────
function adminKeyOk(req) {
  const provided = String(req.headers['x-admin-key'] || '');
  const expected = process.env.ADMIN_KEY || '';
  if (!expected || provided.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(provided), Buffer.from(expected)); } catch { return false; }
}
function requireStaffOrAdminKey(req, res, next) {
  if (adminKeyOk(req)) return next();
  authRequired(req, res, async () => {
    try {
      if (await isStaff(await getDb(), req.user)) return next();
      return res.status(403).json({ error: say(req, 'checkin.err.staff_only'), code: 'forbidden' });
    } catch {
      return res.status(503).json({ error: say(req, 'checkin.err.server') });
    }
  });
}
router.post('/remind-all', requireStaffOrAdminKey, remindAllLimiter, async (req, res) => {
  try {
    res.json({ planned: await backfillCheckinReminders(await getDb()) });
  } catch (e) {
    logger.error({ err: e.message }, '[checkins/remind-all]');
    fail(req, res, 500, 'checkin.err.server');
  }
});

export default router;
