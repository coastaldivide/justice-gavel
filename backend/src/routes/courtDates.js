/**
 * routes/courtDates.js — core path step 3: "Never miss a court date".
 * Signed-in only (a court date is personal data); the guidance is public.
 *
 * GET    /api/court-dates/guidance        — court-day checklist + missed-date guidance (public)
 * GET    /api/court-dates?case_id=        — { upcoming: [...], past: [...] } (past = archive)
 * POST   /api/court-dates                 — add a hearing { case_id | case_title, court_date,
 *                                           court_time?, hearing_type?, courthouse_id?, location?, state? }
 *                                           → plans the 7d / 3d / 1d / morning-of reminders
 * GET    /api/court-dates/:id             — one hearing with courthouse, reminders, guidance
 * PATCH  /api/court-dates/:id             — move it / change details / mark attended|missed|cancelled
 * DELETE /api/court-dates/:id             — remove it (reminders cancelled)
 * GET    /api/court-dates/:id/ics         — text/calendar file for the phone calendar
 * GET    /api/court-dates/:id/reminders   — the planned reminder rows
 * PUT    /api/court-dates/preferences     — { sms_reminders: bool, phone? } (texts only when Telnyx is configured — services/sms.js)
 * PUT    /api/court-dates/:id/plan        — "Plan your court day" { items: { ride|time_off|child_care|documents|address_room: { done, note } } }
 * POST   /api/court-dates/:id/ride-offers/:offerId — { decision: 'accept'|'decline' } a family follower's ride offer
 *                                           (GET /:id carries `plan`, `help` links and `ride_offers`; services/courtDayHelp.js)
 *
 * Text (errors, guidance, time labels, .ics) is in the request's language
 * (?lang= / Accept-Language: en, es, pt, vi, ht, zh, ar, tl); the person's language is saved
 * on create / update so reminders go out in it.
 *
 * Every read and write is scoped to the owner (user_id = req.user.id); a
 * family follower reads court dates only through /api/following.
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { sanitizeStr, truncateStr } from '../utils/routeHelpers.js';
import { safeCourtDate } from './cases.js';
import {
  scheduleForCourtDate, cancelCourtDateReminders, refreshNextCourtDate, listPendingCourtReminders,
  rememberRequestPrefs, rescheduleUserCourtReminders, resolveReminderTimeZone, dateOnly, timeOnly, formatCourtTime,
  SMS_CONSENT_TEXT_VERSION,
} from '../services/courtReminders.js';
import { buildCourtDateIcs } from '../services/ics.js';
import { courtDayGuidance } from '../services/courtDayGuidance.js';
import { normalizeState } from '../services/rightsContent.js';
import { smsLive, toE164 } from '../services/sms.js';

/** Version of the opt-in wording shown at consent (frontend i18n cdd_sms_consent). Bump when it changes. */
export { SMS_CONSENT_TEXT_VERSION };
import { todayInZone, stateTimeZone } from '../utils/timezone.js';
import { notifyFollowersCourtDateChanged } from '../services/followers.js';
import { isExpoPushToken } from '../services/expoPush.js';
import { logIgnored } from '../utils/ignored.js';
import { resolveLang, msg } from '../i18n/index.js';
import { phoneLineNumber } from '../services/phoneLine.js';
import { normalizePlan, planView, helpLinks, rideOffersForOwner, decideRide, HelpError } from '../services/courtDayHelp.js';

const router = Router();
const writeLimiter = makeUserLimiter({ windowMs: 60_000, max: 30, message: (req) => msg(resolveLang(req), 'cd.err.too_many_changes') });

export const HEARING_TYPES = Object.freeze(['arraignment', 'preliminary_hearing', 'pretrial', 'motion', 'trial', 'sentencing', 'probation', 'status', 'other']);
const STATUSES = new Set(['scheduled', 'attended', 'missed', 'rescheduled', 'cancelled']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const COURT_COLS = `cd.id, cd.case_id, cd.court_date, cd.court_time, cd.hearing_type, cd.courthouse_id, cd.location, cd.status,
  cd.created_at, cd.updated_at, cd.plan, cd.plan_updated_at, c.title AS case_title, c.state AS case_state,
  ch.name AS ch_name, ch.address AS ch_address, ch.phone AS ch_phone, ch.hours AS ch_hours, ch.lat AS ch_lat, ch.lng AS ch_lng,
  ch.url AS ch_url, ch.city AS ch_city, ch.state AS ch_state, ch.county AS ch_county`;

export function serializeCourtDate(r, today, lang = 'en') {
  const date = dateOnly(r.court_date);
  const courthouse = r.courthouse_id && r.ch_name ? {
    id: Number(r.courthouse_id), name: r.ch_name, address: r.ch_address || null, phone: r.ch_phone || null,
    hours: r.ch_hours || null, lat: r.ch_lat ?? null, lng: r.ch_lng ?? null, url: r.ch_url || null,
    city: r.ch_city || null, state: r.ch_state || null, county: r.ch_county || null,
    directions_url: r.ch_lat != null && r.ch_lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${r.ch_lat},${r.ch_lng}`
      : r.ch_address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.ch_address)}` : null,
  } : null;
  return {
    id: Number(r.id), case_id: Number(r.case_id), case_title: r.case_title, case_state: r.case_state || null,
    court_date: date, court_time: timeOnly(r.court_time), court_time_label: formatCourtTime(r.court_time, lang),
    hearing_type: r.hearing_type || null, hearing_label: r.hearing_type ? msg(lang, `hearing.${r.hearing_type}`) : null, status: r.status, location: r.location || null, courthouse,
    is_past: !!(date && today && date < today),
    archived: !!(date && today && date < today) || ['attended', 'missed', 'cancelled'].includes(r.status),
  };
}

function loadOwned(db, userId, id) {
  return db.get(
    `SELECT ${COURT_COLS} FROM court_dates cd
       JOIN cases c ON c.id = cd.case_id
       LEFT JOIN courthouses ch ON ch.id = cd.courthouse_id
      WHERE cd.id = ? AND cd.user_id = ? AND cd.deleted_at IS NULL AND c.deleted_at IS NULL`, [id, userId]);
}

async function userToday(db, userId, state) {
  const { tz } = await resolveReminderTimeZone(db, userId, state);
  return { tz, today: todayInZone(tz) };
}

function parseFields(b, { partial }, lang = 'en') {
  const out = {}; const errors = [];
  if (!partial || b.court_date !== undefined) {
    const d = safeCourtDate(b.court_date);
    if (!d) errors.push(msg(lang, 'cd.err.bad_date'));
    else out.court_date = d;
  }
  if (b.court_time !== undefined) {
    if (b.court_time === null || b.court_time === '') out.court_time = null;
    else if (typeof b.court_time === 'string' && TIME_RE.test(b.court_time)) out.court_time = b.court_time;
    else errors.push(msg(lang, 'cd.err.bad_time'));
  }
  if (b.hearing_type !== undefined) {
    if (b.hearing_type === null || b.hearing_type === '') out.hearing_type = null;
    else if (HEARING_TYPES.includes(b.hearing_type)) out.hearing_type = b.hearing_type;
    else errors.push(msg(lang, 'cd.err.bad_hearing', { list: HEARING_TYPES.join(', ') }));
  }
  if (b.location !== undefined) {
    out.location = b.location == null || b.location === '' ? null : truncateStr(sanitizeStr(String(b.location), 200), 200);
  }
  if (b.courthouse_id !== undefined) {
    if (b.courthouse_id === null || b.courthouse_id === '') out.courthouse_id = null;
    else {
      const n = Number.parseInt(b.courthouse_id, 10);
      if (!Number.isSafeInteger(n) || n <= 0) errors.push(msg(lang, 'cd.err.bad_courthouse_id'));
      else out.courthouse_id = n;
    }
  }
  if (partial && b.status !== undefined) {
    if (STATUSES.has(b.status)) out.status = b.status;
    else errors.push(msg(lang, 'cd.err.bad_status', { list: [...STATUSES].join(', ') }));
  }
  return { out, errors };
}

// ── public guidance ─────────────────────────────────────────────────────────
router.get('/guidance', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'Accept-Language');
  const g = courtDayGuidance(resolveLang(req));
  res.setHeader('Content-Language', g.language);
  // the court-date phone line (A10), when it is on: its number, English and Spanish
  res.json({ ...g, phone_line: phoneLineNumber() ? { number: phoneLineNumber(), languages: ['en', 'es'] } : null });
});

// ── reminder preferences (SMS opt-in) ───────────────────────────────────────
router.put('/preferences', authRequired, writeLimiter, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof b.sms_reminders !== 'boolean') return res.status(400).json({ error: msg(lang, 'cd.err.sms_bool') });
    const db = await getDb();
    let phone;
    if (b.phone !== undefined && b.phone !== null && b.phone !== '') {
      phone = toE164(b.phone);
      if (!phone) return res.status(400).json({ error: msg(lang, 'cd.err.bad_phone') });
    }
    if (b.sms_reminders && !phone) {
      const u = await db.get('SELECT phone FROM users WHERE id = ?', [req.user.id]);
      if (!toE164(u?.phone)) return res.status(400).json({ error: msg(lang, 'cd.err.need_phone') });
    }
    if (phone) await db.run('UPDATE users SET sms_reminders = ?, phone = ? WHERE id = ?', [b.sms_reminders ? 1 : 0, phone, req.user.id]);
    else await db.run('UPDATE users SET sms_reminders = ? WHERE id = ?', [b.sms_reminders ? 1 : 0, req.user.id]);
    // Consent record (migration 31): when, which number, which wording, which language.
    if (b.sms_reminders) {
      const u = await db.get('SELECT phone FROM users WHERE id = ?', [req.user.id]).catch(() => null);
      await db.run(
        `UPDATE users SET sms_consent_at = NOW(), sms_consent_phone = ?, sms_consent_text_v = ?, sms_consent_lang = ?, sms_opt_out_at = NULL WHERE id = ?`,
        [toE164(u?.phone), SMS_CONSENT_TEXT_VERSION, lang, req.user.id]).catch(e => logger.warn({ err: e.message }, '[court-dates] consent record failed'));
    } else {
      await db.run('UPDATE users SET sms_opt_out_at = NOW() WHERE id = ?', [req.user.id]).catch(logIgnored('routes/courtDates'));
    }
    res.json({ ok: true, sms_reminders: b.sms_reminders, sms_available: smsLive(),
      note: smsLive() ? null : msg(lang, 'cd.sms_not_configured') });
  } catch (e) {
    logger.error({ err: e.message }, '[court-dates/preferences]');
    res.status(500).json({ error: msg(lang, 'cd.err.save_prefs') });
  }
});

router.get('/preferences', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const u = await db.get('SELECT sms_reminders, phone FROM users WHERE id = ?', [req.user.id]);
    res.json({ sms_reminders: Number(u?.sms_reminders) === 1, has_phone: !!toE164(u?.phone), sms_available: smsLive() });
  } catch {
    res.status(500).json({ error: msg(resolveLang(req), 'cd.err.load_prefs') });
  }
});

/**
 * Can we reach this person with their court reminders? `undeliverable` counts
 * their court reminders of the last 30 days that reached no channel
 * (reminderDispatcher → status 'undeliverable'); `channels` is what would be
 * tried now. The court-date screen shows a one-time "turn on notifications or
 * add an e-mail" prompt when `needs_attention` is true.
 */
async function reminderDelivery(db, userId, upcomingCount, lang = 'en') {
  const u = await db.get('SELECT email, phone, sms_reminders, push_token FROM users WHERE id = ?', [userId]).catch(() => null);
  const toks = await db.all('SELECT token FROM push_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 5', [userId]).catch(() => []);
  const und = await db.get(
    `SELECT COUNT(*) AS n, MAX(deliver_at) AS last_at FROM scheduled_pushes
      WHERE user_id = ? AND status = 'undeliverable' AND notification_type IN ('court_reminder', 'follower_court_reminder')
        AND deliver_at > NOW() - INTERVAL '30 days'`, [userId]).catch(() => null);
  const { emailLive } = await import('../services/email.js');
  const { webPushLive } = await import('../services/webPush.js');
  const web = webPushLive()
    ? await db.get('SELECT COUNT(*) AS n FROM web_push_subscriptions WHERE user_id = ?', [userId]).catch(() => null) : null;
  const channels = {
    push: [...toks.map(t => t.token), u?.push_token].some(isExpoPushToken),
    web_push: Number(web?.n || 0) > 0,
    email: emailLive() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(u?.email || '')),
    sms: smsLive() && Number(u?.sms_reminders) === 1 && !!toE164(u?.phone),
  };
  const undeliverable = Number(und?.n || 0);
  const lastAt = und?.last_at ? new Date(und.last_at).toISOString() : null;
  const noChannel = !channels.push && !channels.web_push && !channels.email && !channels.sms;
  return {
    undeliverable, last_undeliverable_at: lastAt, channels,
    needs_attention: undeliverable > 0 || (noChannel && upcomingCount > 0),
    message: undeliverable > 0 || noChannel ? msg(lang, 'cd.delivery_problem') : null,
  };
}

// ── list ────────────────────────────────────────────────────────────────────
router.get('/', authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const caseId = req.query.case_id ? Number.parseInt(req.query.case_id, 10) : null;
    if (req.query.case_id && (!Number.isSafeInteger(caseId) || caseId <= 0)) return res.status(400).json({ error: msg(lang, 'cd.err.bad_case_id') });
    const rows = await db.all(
      `SELECT ${COURT_COLS} FROM court_dates cd
         JOIN cases c ON c.id = cd.case_id
         LEFT JOIN courthouses ch ON ch.id = cd.courthouse_id
        WHERE cd.user_id = ? AND cd.deleted_at IS NULL AND c.deleted_at IS NULL ${caseId ? 'AND cd.case_id = ?' : ''}
        ORDER BY cd.court_date ASC, cd.court_time ASC NULLS FIRST
        LIMIT 400`, caseId ? [req.user.id, caseId] : [req.user.id]);
    const { today, tz } = await userToday(db, req.user.id, null);
    const all = rows.map(r => serializeCourtDate(r, today, lang));
    const upcoming = all.filter(x => !x.archived);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      time_zone: tz, today, language: lang,
      upcoming,
      past: all.filter(x => x.archived).reverse(),
      reminder_delivery: await reminderDelivery(db, req.user.id, upcoming.length, lang),
    });
  } catch (e) {
    logger.error({ err: e.message }, '[court-dates/list]');
    res.status(500).json({ error: msg(lang, 'cd.err.load_list') });
  }
});

// ── create ──────────────────────────────────────────────────────────────────
router.post('/', authRequired, writeLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { out, errors } = parseFields(b, { partial: false }, lang);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  try {
    const db = await getDb();
    await rememberRequestPrefs(db, req.user.id, req).then(changed => changed && rescheduleUserCourtReminders(db, req.user.id));
    if (out.courthouse_id) {
      const ch = await db.get('SELECT id FROM courthouses WHERE id = ?', [out.courthouse_id]);
      if (!ch) return res.status(400).json({ error: msg(lang, 'cd.err.courthouse_unknown') });
    }
    let caseId = b.case_id != null && b.case_id !== '' ? Number.parseInt(b.case_id, 10) : null;
    if (b.case_id != null && b.case_id !== '' && (!Number.isSafeInteger(caseId) || caseId <= 0)) return res.status(400).json({ error: msg(lang, 'cd.err.bad_case_id') });
    const state = normalizeState(b.state);
    const result = await db.transaction(async (tx) => {
      if (caseId) {
        const c = await tx.get('SELECT id FROM cases WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [caseId, req.user.id]);
        if (!c) return { status: 404, body: { error: msg(lang, 'cd.err.case_not_found') } };
      } else {
        const fallbackTitle = msg(lang, 'cd.default_case_title');
        const title = truncateStr(sanitizeStr(String(b.case_title || fallbackTitle), 300), 300).trim() || fallbackTitle;
        const c = await tx.get(
          `INSERT INTO cases (user_id, title, status, state, notes, updated_at) VALUES (?, ?, 'Open', ?, '', NOW()) RETURNING id`,
          [req.user.id, title, state]);
        caseId = Number(c.id);
      }
      const dup = await tx.get(
        `SELECT id FROM court_dates WHERE case_id = ? AND court_date = CAST(? AS date)
            AND COALESCE(court_time, TIME '00:00') = COALESCE(CAST(? AS time), TIME '00:00') AND deleted_at IS NULL`,
        [caseId, out.court_date, out.court_time ?? null]);
      if (dup) return { status: 409, body: { error: msg(lang, 'cd.err.duplicate'), code: 'duplicate', existing_id: Number(dup.id) } };
      const ins = await tx.get(
        `INSERT INTO court_dates (case_id, user_id, court_date, court_time, hearing_type, courthouse_id, location)
         VALUES (?, ?, CAST(? AS date), CAST(? AS time), ?, ?, ?) RETURNING id`,
        [caseId, req.user.id, out.court_date, out.court_time ?? null, out.hearing_type ?? null, out.courthouse_id ?? null, out.location ?? null]);
      return { id: Number(ins.id) };
    });
    if (result.status) return res.status(result.status).json(result.body);
    await refreshNextCourtDate(db, caseId);
    const plan = await scheduleForCourtDate(db, result.id);
    notifyFollowersCourtDateChanged(db, caseId, 'added').catch(logIgnored('routes/courtDates'));
    const row = await loadOwned(db, req.user.id, result.id);
    const { today } = await userToday(db, req.user.id, row?.case_state);
    res.status(201).json({ ...serializeCourtDate(row, today, lang), time_zone: plan.time_zone, reminders: plan.reminders });
  } catch (e) {
    logger.error({ err: e.message }, '[court-dates/create]');
    res.status(500).json({ error: msg(lang, 'cd.err.save') });
  }
});

// ── one ─────────────────────────────────────────────────────────────────────
function idParam(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: msg(resolveLang(req), 'cd.err.bad_id') }); return null; }
  return id;
}

router.get('/:id', authRequired, async (req, res) => {
  const id = idParam(req, res); if (!id) return;
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const row = await loadOwned(db, req.user.id, id);
    if (!row) return res.status(404).json({ error: msg(lang, 'cd.err.not_found') });
    const { today, tz } = await userToday(db, req.user.id, row.case_state);
    const reminders = (await listPendingCourtReminders(db, req.user.id, null, id)).filter(r => r.type === 'court_reminder');
    res.setHeader('Cache-Control', 'no-store');
    const cd = serializeCourtDate(row, today, lang);
    res.json({
      ...cd, time_zone: tz, language: lang, reminders, guidance: courtDayGuidance(lang),
      plan: planView(row.plan), plan_updated_at: row.plan_updated_at || null,
      help: helpLinks(cd.courthouse), ride_offers: await rideOffersForOwner(db, id),
      phone_line: phoneLineNumber() ? { number: phoneLineNumber() } : null,
    });
  } catch (e) {
    logger.error({ err: e.message }, '[court-dates/get]');
    res.status(500).json({ error: msg(lang, 'cd.err.load') });
  }
});

router.patch('/:id', authRequired, writeLimiter, async (req, res) => {
  const id = idParam(req, res); if (!id) return;
  const lang = resolveLang(req);
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const { out, errors } = parseFields(b, { partial: true }, lang);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  if (!Object.keys(out).length) return res.status(400).json({ error: msg(lang, 'cd.err.nothing_to_update') });
  try {
    const db = await getDb();
    const before = await loadOwned(db, req.user.id, id);
    if (!before) return res.status(404).json({ error: msg(lang, 'cd.err.not_found') });
    if (await rememberRequestPrefs(db, req.user.id, req)) await rescheduleUserCourtReminders(db, req.user.id);
    if (out.courthouse_id) {
      const ch = await db.get('SELECT id FROM courthouses WHERE id = ?', [out.courthouse_id]);
      if (!ch) return res.status(400).json({ error: msg(lang, 'cd.err.courthouse_unknown') });
    }
    const sets = []; const vals = [];
    for (const [k, v] of Object.entries(out)) {
      if (k === 'court_date') { sets.push('court_date = CAST(? AS date)'); vals.push(v); }
      else if (k === 'court_time') { sets.push('court_time = CAST(? AS time)'); vals.push(v); }
      else { sets.push(`${k} = ?`); vals.push(v); }
    }
    // a status set here is the person's own: a late text reply never overwrites it (services/courtReplies.js)
    if (out.status !== undefined) sets.push(`status_source = 'app'`, 'status_at = NOW()');
    sets.push('updated_at = NOW()');
    try {
      await db.run(`UPDATE court_dates SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...vals, id, req.user.id]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: msg(lang, 'cd.err.duplicate_time'), code: 'duplicate' });
      throw e;
    }
    await refreshNextCourtDate(db, Number(before.case_id));
    const plan = await scheduleForCourtDate(db, id);
    // Followers hear about changes to the date itself (day, time, place, cancellation) —
    // not about the owner marking it attended / missed.
    const courtChange = ['court_date', 'court_time', 'location', 'courthouse_id'].some(k => k in out)
      || (out.status && ['cancelled', 'rescheduled'].includes(out.status));
    if (courtChange) {
      notifyFollowersCourtDateChanged(db, Number(before.case_id), out.status === 'cancelled' ? 'cancelled' : 'changed')
        .catch(logIgnored('routes/courtDates'));
    }
    const row = await loadOwned(db, req.user.id, id);
    const { today } = await userToday(db, req.user.id, row.case_state);
    const body = { ...serializeCourtDate(row, today, lang), time_zone: plan.time_zone, reminders: plan.reminders };
    if (row.status === 'missed') body.guidance = courtDayGuidance(lang).missed;
    res.json(body);
  } catch (e) {
    logger.error({ err: e.message }, '[court-dates/update]');
    res.status(500).json({ error: msg(lang, 'cd.err.update') });
  }
});

router.delete('/:id', authRequired, writeLimiter, async (req, res) => {
  const id = idParam(req, res); if (!id) return;
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const row = await loadOwned(db, req.user.id, id);
    if (!row) return res.status(404).json({ error: msg(lang, 'cd.err.not_found') });
    await db.run('UPDATE court_dates SET deleted_at = NOW(), updated_at = NOW() WHERE id = ? AND user_id = ?', [id, req.user.id]);
    await cancelCourtDateReminders(db, id, 'court_date_deleted');
    await refreshNextCourtDate(db, Number(row.case_id));
    notifyFollowersCourtDateChanged(db, Number(row.case_id), 'cancelled').catch(logIgnored('routes/courtDates'));
    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e.message }, '[court-dates/delete]');
    res.status(500).json({ error: msg(lang, 'cd.err.delete') });
  }
});

// ── A8 Plan your court day ──────────────────────────────────────────────────
function helpFail(req, res, e, where) {
  const lang = resolveLang(req);
  if (e instanceof HelpError) return res.status(e.status).json({ error: msg(lang, `ride.err.${e.code}`), code: e.code });
  logger.error({ err: e.message }, `[court-dates${where}]`);
  return res.status(500).json({ error: msg(lang, 'cd.err.save'), code: 'server_error' });
}

router.put('/:id/plan', authRequired, writeLimiter, async (req, res) => {
  const id = idParam(req, res); if (!id) return;
  try {
    const plan = normalizePlan(req.body);
    const db = await getDb();
    const row = await loadOwned(db, req.user.id, id);
    if (!row) return res.status(404).json({ error: msg(resolveLang(req), 'cd.err.not_found') });
    const merged = { ...(row.plan && typeof row.plan === 'object' ? row.plan : {}), ...plan };
    const up = await db.get(
      `UPDATE court_dates SET plan = CAST(? AS jsonb), plan_updated_at = NOW() WHERE id = ? AND user_id = ? RETURNING plan, plan_updated_at`,
      [JSON.stringify(merged), id, req.user.id]);
    res.json({ plan: planView(up.plan), plan_updated_at: up.plan_updated_at });
  } catch (e) { helpFail(req, res, e, '/plan'); }
});

router.post('/:id/ride-offers/:offerId', authRequired, writeLimiter, async (req, res) => {
  const id = idParam(req, res); if (!id) return;
  const offerId = Number.parseInt(req.params.offerId, 10);
  if (!Number.isSafeInteger(offerId) || offerId <= 0) return res.status(400).json({ error: msg(resolveLang(req), 'cd.err.bad_id') });
  try {
    const db = await getDb();
    const row = await loadOwned(db, req.user.id, id);
    if (!row) return res.status(404).json({ error: msg(resolveLang(req), 'cd.err.not_found') });
    const r = await decideRide(db, { ownerId: req.user.id, courtDateId: id, offerId, decision: String(req.body?.decision || '') });
    res.json({ ...r, ride_offers: await rideOffersForOwner(db, id) });
  } catch (e) { helpFail(req, res, e, '/ride-offers'); }
});

router.get('/:id/reminders', authRequired, async (req, res) => {
  const id = idParam(req, res); if (!id) return;
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const row = await loadOwned(db, req.user.id, id);
    if (!row) return res.status(404).json({ error: msg(lang, 'cd.err.not_found') });
    const reminders = (await listPendingCourtReminders(db, req.user.id, null, id)).filter(r => r.type === 'court_reminder');
    const { tz } = await userToday(db, req.user.id, row.case_state);
    res.json({ court_date_id: id, time_zone: tz, reminders });
  } catch (e) {
    logger.error({ err: e.message }, '[court-dates/reminders]');
    res.status(500).json({ error: msg(lang, 'cd.err.reminders') });
  }
});

router.get('/:id/ics', authRequired, async (req, res) => {
  const id = idParam(req, res); if (!id) return;
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const row = await loadOwned(db, req.user.id, id);
    if (!row) return res.status(404).json({ error: msg(lang, 'cd.err.not_found') });
    const cd = serializeCourtDate(row, null, lang);
    const { tz: userTz } = await userToday(db, req.user.id, row.case_state);
    // The hearing's time is the court's wall clock: the courthouse's (or the case state's) zone.
    const tz = stateTimeZone(cd.courthouse?.state) || stateTimeZone(cd.case_state) || userTz;
    const place = cd.courthouse ? [cd.courthouse.name, cd.courthouse.address].filter(Boolean).join(', ') : null;
    const loc = [place, cd.location].filter(Boolean).join(' — ') || null;
    const desc = [
      msg(lang, 'cd.ics.for', { case: cd.case_title }),
      cd.hearing_type ? msg(lang, 'cd.ics.hearing', { hearing: cd.hearing_label }) : null,
      cd.courthouse?.phone ? msg(lang, 'cd.ics.phone', { phone: cd.courthouse.phone }) : null,
      msg(lang, 'cd.ics.advice'),
    ].filter(Boolean).join('\n');
    const ics = buildCourtDateIcs({
      uid: `court-date-${cd.id}@justicegavel.app`, courtDate: cd.court_date, courtTime: cd.court_time, tz,
      summary: msg(lang, 'cd.ics.summary', { case: cd.case_title }), location: loc, description: desc,
      alarmDayBefore: msg(lang, 'cd.ics.alarm_day_before', { case: cd.case_title }),
      alarmTwoHours: msg(lang, 'cd.ics.alarm_two_hours', { case: cd.case_title }),
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="court-date-${cd.court_date}.ics"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(ics);
  } catch (e) {
    logger.error({ err: e.message }, '[court-dates/ics]');
    res.status(500).json({ error: msg(lang, 'cd.err.ics') });
  }
});

export default router;
