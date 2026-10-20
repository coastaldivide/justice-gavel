/**
 * checkins.js — post-release check-ins (bail agent ↔ defendant).
 *
 * Bail agent (account type bail_agent, or a bondsman profile; staff too):
 *   POST /api/checkins/enroll                 enroll a defendant { defendant_name, defendant_phone?, defendant_email?,
 *                                             case_number?, court_date?, check_in_freq } → enrollment + the link to send
 *   GET  /api/checkins/enrollments            their defendants, each with today's status in the defendant's day
 *   PUT  /api/checkins/enrollments/:id        { active: boolean } — stop / restart monitoring
 *   PATCH /api/checkins/enrollments/:id/note  supervisor note
 *   GET  /api/checkins/history/:id            the check-in log + 30-day compliance
 * Defendant:
 *   GET  /api/checkins/mine                   my enrollments (an enrollment whose phone / e-mail matches my account
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
 * Billing: the per-defendant fee is not charged anywhere yet (no Stripe product exists for it);
 * the enrollment says so (billing_active: false) instead of pretending a subscription exists.
 * Text is in the request's language (?lang= / Accept-Language).
 */
import { timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { isStaff } from '../utils/staff.js';
import { safeInt, sanitizeStr, truncateStr } from '../utils/routeHelpers.js';
import { sendPushToUser } from '../services/pushDelivery.js';
import { toE164 } from '../services/sms.js';
import { rememberTimeZone } from '../services/courtReminders.js';
import { safeCourtDate } from './cases.js';
import { resolveLang, msg, userLang, rememberLanguage, requestedLang } from '../i18n/index.js';
import {
  CHECKIN_FREQS, checkinState, compliance, enrollmentTimeZone, localDay,
  planCheckinReminder, cancelCheckinReminders, backfillCheckinReminders,
} from '../services/checkinReminders.js';

const router = Router();
const say = (req, key, params) => msg(resolveLang(req), key, params);
const fail = (req, res, status, key, extra = {}) => res.status(status).json({ error: say(req, key), ...extra });

export const FEE_PER_DEFENDANT_CENTS = 999;   // the price shown to bail agents ($9.99 / month / defendant); not charged yet
const APP_URL = () => String(process.env.APP_URL || 'https://justicegavel.app').replace(/\/+$/, '');
export const checkinLink = (id) => `${APP_URL()}/checkin?enrollmentId=${Number(id)}`;

const writeLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 30, message: (req) => say(req, 'checkin.err.too_many') });
const remindAllLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 2, message: (req) => say(req, 'checkin.err.reminded_recently') });

const ENROLL_COLS = `id, bondsman_id, user_id, defendant_name, defendant_phone, defendant_email, case_number, court_date,
  check_in_freq, active, monthly_fee_cents, created_at, supervisor_note`;
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

/** Link not-yet-linked enrollments whose contact matches the signed-in account. */
async function claimMatching(db, userId) {
  const me = await db.get('SELECT email, phone FROM users WHERE id = ?', [userId]);
  const email = me?.email ? String(me.email).trim().toLowerCase() : null;
  const phone = digits10(me?.phone);
  const conds = []; const args = [];
  if (email) { conds.push('LOWER(TRIM(defendant_email)) = ?'); args.push(email); }
  if (phone.length === 10) { conds.push(`RIGHT(regexp_replace(COALESCE(defendant_phone, ''), '[^0-9]', '', 'g'), 10) = ?`); args.push(phone); }
  if (!conds.length) return [];
  const rows = await db.all(
    `UPDATE checkin_enrollments SET user_id = ?, updated_at = NOW()
      WHERE user_id IS NULL AND active = 1 AND bondsman_id <> ? AND (${conds.join(' OR ')})
      RETURNING id`, [userId, userId, ...args]);
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
  try {
    const db = await getDb();
    if (!(await isBailAgent(db, req.user))) return fail(req, res, 403, 'checkin.err.agents_only', { code: 'bail_agents_only' });
    await rememberPrefs(db, req);
    const row = await db.get(
      `INSERT INTO checkin_enrollments
         (bondsman_id, defendant_name, defendant_phone, defendant_email, case_number, court_date, check_in_freq,
          active, monthly_fee_cents, stripe_sub_id, enrolled_by, enrolled_at, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, NOW(), 'active', NOW())
       RETURNING ${ENROLL_COLS}`,
      [req.user.id, name, phone, email, caseNumber, courtDate, freq, FEE_PER_DEFENDANT_CENTS, req.user.id]);
    const lang = resolveLang(req);
    const link = checkinLink(row.id);
    res.status(201).json({
      success: true, enrollment: row, checkin_link: link, billing_active: false,
      share_message: msg(lang, 'checkin.share_message', { name: name.split(/\s+/)[0], link }),
      message: msg(lang, 'checkin.enrolled', { name }),
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
    const enrollments = [];
    for (const e of rows) {
      const st = await checkinState(db, e);
      const last = await db.get('SELECT checked_in_at FROM checkin_records WHERE enrollment_id = ? ORDER BY checked_in_at DESC LIMIT 1', [e.id]);
      enrollments.push({
        ...e, id: Number(e.id), active: Number(e.active), linked: e.user_id != null, user_id: undefined,
        total_checkins: st.total, checkins_today: st.last_day === st.today ? 1 : 0, done_for_period: st.done,
        next_due: st.next_due, today: st.today, time_zone: st.tz, last_checkin: last?.checked_in_at || null,
        checkin_link: checkinLink(e.id),
      });
    }
    const totalActive = enrollments.filter(e => e.active).length;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enrollments, total_active: totalActive, fee_cents: FEE_PER_DEFENDANT_CENTS,
      monthly_cost_cents: totalActive * FEE_PER_DEFENDANT_CENTS, billing_active: false,
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
    const r = await db.run('UPDATE checkin_enrollments SET active = ?, updated_at = NOW() WHERE id = ? AND bondsman_id = ?',
      [req.body.active ? 1 : 0, id, req.user.id]);
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
  CAST(lat AS double precision) AS lat, CAST(lng AS double precision) AS lng`;

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
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enrollment: { ...e, linked: e.user_id != null, user_id: undefined }, records, time_zone: tz,
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
    const result = await db.transaction(async (tx) => {
      // one check-in per local day, even when two taps race
      await tx.get(`SELECT pg_advisory_xact_lock(hashtext('checkin_submit'), CAST(? AS integer)) AS locked`, [Number(e.id) % 2147483647]);
      const st = await checkinState(tx, e);
      if (st.last_day === st.today) return { dup: true, st };
      const row = await tx.get(
        `INSERT INTO checkin_records (enrollment_id, user_id, lat, lng, location_label, notes, status, device_info, checked_in_at)
         VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, NOW()) RETURNING id, checked_in_at`,
        [e.id, req.user.id, lat, lng, label || null, notes || null, truncateStr(String(b.device_info || ''), 200) || null]);
      return { row };
    });
    if (result.dup) return res.status(409).json({ error: say(req, 'checkin.err.already_today'), code: 'already_checked_in', already_done: true });
    const st = await checkinState(db, e);
    // tell the bail agent, in their language
    const agentLang = await userLang(db, e.bondsman_id);
    const notified = await sendPushToUser(e.bondsman_id, {
      title: msg(agentLang, 'checkin.push.agent_title', { name: e.defendant_name }),
      body: msg(agentLang, lat === null ? 'checkin.push.agent_body' : 'checkin.push.agent_body_location', { name: e.defendant_name }),
      data: { type: 'checkin_submitted', screen: 'CheckInManager', enrollment_id: Number(e.id) },
      channelId: 'default',
    }).catch(() => ({ sent: 0 }));
    await planCheckinReminder(db, e.id).catch(err => logger.warn({ err: err.message }, '[checkins] plan after submit'));
    res.status(201).json({
      success: true, record_id: Number(result.row.id), checked_in_at: result.row.checked_in_at,
      agent_notified: Number(notified?.sent || 0) > 0, next_due: st.next_due, streak: st.streak, total_checkins: st.total,
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
