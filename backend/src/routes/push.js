import { logIgnored } from '../utils/ignored.js';
import { err400, truncateStr } from '../utils/routeHelpers.js';
import { sanitizeStr } from '../utils/sanitize.js';
import { isValidTimeZone } from '../utils/timezone.js';
import { rememberTimeZone, rescheduleUserCourtReminders } from '../services/courtReminders.js';
import { normalizeLang, rememberLanguage, resolveLang, msg, userLang } from '../i18n/index.js';
import { TIERS, usd } from './billing/plans.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { sendExpoPush, isExpoPushToken } from '../services/expoPush.js';
import logger      from '../utils/logger.js';

const router = Router();
const pushLimiter = makeUserLimiter({ windowMs: 60000, max: 20, message: 'Push notification limit reached. Try again later.' });


// POST /token — register Expo push token (also handles refresh on foreground)
// A device belongs to one account: registering it here takes it away from any
// other account that had it (a shared phone where someone signed in without
// the previous person signing out must not get that person's notifications).
router.post('/token', authRequired, async (req, res) => {
  const { token, expoPushToken } = req.body || {};
  const pushToken = expoPushToken || token;
  const lang = resolveLang(req);
  if (!isExpoPushToken(pushToken)) return res.status(400).json({ error: 'invalid_push_token', message: msg(lang, 'push.err.invalid_token') });
  try {
    const db = await getDb();
    await db.run('DELETE FROM push_tokens WHERE token = ? AND user_id <> ?', [pushToken, req.user.id]);
    await db.run('UPDATE users SET push_token = NULL WHERE push_token = ? AND id <> ?', [pushToken, req.user.id]);
    await db.run(
      'INSERT INTO push_tokens (user_id, token) VALUES (?,?) ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token',
      [req.user.id, pushToken]
    );
    await db.run('UPDATE users SET push_token = ? WHERE id = ?', [pushToken, req.user.id]);
    res.json({ ok: true });
  } catch (e) { logger.error('[push/token]', e.message); res.status(500).json({ error: 'server_error', message: msg(lang, 'http.500') }); }
});

// DELETE /api/push/token/:token — unregister a device token (logout / disable push)
router.delete('/token/:token', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const token = String(req.params.token || '').slice(0, 300);
    await db.run('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', [req.user.id, token]);
    await db.run('UPDATE users SET push_token = NULL WHERE id = ? AND push_token = ?', [req.user.id, token]);
    res.json({ ok: true });
  } catch (e) {
    logger.error('[push/token/delete]', e.message);
    res.status(500).json({ error: 'Could not remove push token.' });
  }
});

// POST /test — Settings › "Send test notification" (phone only)
router.post('/test', authRequired, pushLimiter, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const raw = typeof req.body?.message === 'string' && req.body.message.trim() ? req.body.message : msg(lang, 'push.test.body');
    const db = await getDb();
    const row = await db.get('SELECT token FROM push_tokens WHERE user_id=? ORDER BY id DESC LIMIT 1', [req.user.id]);
    if (!row) return res.status(400).json({ error: 'no_push_token', message: msg(lang, 'push.err.no_device') });
    const [ticket] = await sendExpoPush([{ to: row.token, sound: 'default', badge: 1, title: 'Justice Gavel',
      body: truncateStr(raw, 2000), data: { type: 'test' } }]);
    if (ticket?.status === 'ok') return res.json({ ok: true, ticket: { status: 'ok', id: ticket.id } });
    if (ticket?.details?.error === 'DeviceNotRegistered') return res.status(400).json({ error: 'no_push_token', message: msg(lang, 'push.err.no_device') });
    logger.warn('[push/test] not delivered:', ticket?.message);
    return res.status(503).json({ error: 'push_unavailable', code: 'push_unavailable', message: msg(lang, 'push.err.unavailable') });
  } catch (e) { logger.error('[push/test]', e.message); res.status(500).json({ error: 'server_error', message: msg(lang, 'http.500') }); }
});
// ── Legal tip of the day ───────────────────────────────────────────────────────
// GET /api/push/tip — returns today's legal tip (changes daily)
// Legal accuracy review (Oct 2026): 10 of 15 tips overstated the law (e.g. checkpoints "must
// be announced", "one phone call", Miranda "only after arrest"). Text is in i18n tip.N (4 languages).
export const LEGAL_TIPS = [
  { tip: "You have the right to remain silent: say out loud \"I am using my right to remain silent,\" because anything you say can be used against you.", category: "Criminal", lesson_query: "rights" },
  { tip: "Federal appeals courts covering most states recognize a right to openly record police doing their jobs in public, but officers can set reasonable distance limits and some states restrict secret audio recording.", category: "Constitutional", lesson_query: "police" },
  { tip: "Sobriety checkpoints are allowed under the U.S. Constitution, but about a dozen states do not use them, and advance-notice rules differ from state to state.", category: "Criminal", lesson_query: "DUI" },
  { tip: "Your traffic ticket shows the deadline to pay or contest it, and that deadline varies by state and court, so act before the date printed on the ticket.", category: "General", lesson_query: "traffic" },
  { tip: "Police usually need a warrant to enter or search your home unless you consent or an emergency exception applies, so you can calmly say \"I do not consent to a search.\"", category: "Constitutional", lesson_query: "search" },
  { tip: "There is no nationwide constitutional right to a phone call after arrest, though some states give one by law, so ask for a lawyer and do not discuss your case on jail phones, which are recorded.", category: "Criminal", lesson_query: "arrest" },
  { tip: "In most states you can ask to seal or expunge an arrest that did not lead to a conviction, though eligibility and waiting periods depend on your state.", category: "Criminal", lesson_query: "expungement" },
  { tip: "Federal law protects your job when you serve on a federal jury, and most states have their own laws protecting state jurors, so check your state's rule.", category: "General", lesson_query: "jury" },
  { tip: "If bail is set, your lawyer can ask the court to lower it at a bail hearing or by motion; some states, such as Illinois, no longer use cash bail at all.", category: "Criminal", lesson_query: "bail" },
  { tip: "Police must give Miranda warnings only before questioning someone in custody, which can happen before a formal arrest, and you can choose to stay silent at any time.", category: "Constitutional", lesson_query: "miranda" },
  { tip: "In most states roadside field sobriety tests are voluntary, but refusing a breath or chemical test after a DUI arrest usually triggers license suspension under implied-consent laws.", category: "Criminal", lesson_query: "DUI" },
  { tip: "If you cannot afford a lawyer and you face possible jail time, you have the right to a court-appointed lawyer, though some states may charge you a fee for it later.", category: "Criminal", lesson_query: "lawyer" },
  { tip: "A probation violation can lead to jail time, so attend every scheduled check-in.", category: "Criminal", lesson_query: "probation" },
  { tip: "Many states bar employers from asking about arrests that did not lead to a conviction.", category: "General", lesson_query: "employment" },
  { tip: "Marijuana laws vary widely: adult possession is legal in many states, can be a misdemeanor or felony in others depending on the amount, and remains illegal under federal law.", category: "Criminal", lesson_query: "drug" },
];

router.get('/tip', (req, res) =>{
  try {
  const dayIndex = Math.floor(Date.now() / 86400000) % LEGAL_TIPS.length;
  const entry = LEGAL_TIPS[dayIndex];
  const lang = resolveLang(req);
  res.set('Vary', 'Accept-Language');
  res.set('Content-Language', lang);
  // category / lesson_query stay English: they are search keys for the lessons screen.
  return res.json({ tip: msg(lang, `tip.${dayIndex}`), language: lang, category: entry.category, lesson_query: entry.lesson_query, index: dayIndex, total: LEGAL_TIPS.length });

  } catch (_e) {
    res.status(500).json({ error: 'Internal server error.', code: 'server_error' });
  }
});

// ── Post-purchase retention trigger ───────────────────────────────────────────
// Called after Quick Connect purchase — writes to scheduled_pushes for delivery
router.post('/retention/post-purchase', authRequired, async (req, res) => {
  const purchase_type = req.body?.purchase_type === 'emergency_connection' ? 'emergency_connection' : 'quickconnect';
  const db0 = await getDb();
  const lang = await userLang(db0, req.user.id).catch(() => resolveLang(req));
  // Price and wording come from the real plan (routes/billing/plans.js): Legal Pro
  // includes arrest monitors, which are checked against new public records nightly.
  const messages = {
    quickconnect: {
      title: msg(lang, 'push.retention.monitor_title'),
      body:  msg(lang, 'push.retention.monitor_body', { price: usd(TIERS.legal_pro.monthly_cents) }),
      data:  JSON.stringify({ screen: 'ConsumerSubscription' }),
      delay_hours: 48,
    },
    emergency_connection: {
      title: msg(lang, 'push.retention.saved_title'),
      body:  msg(lang, 'push.retention.saved_body'),
      data:  JSON.stringify({ screen: 'CasesTab' }),
      delay_hours: 24,
    },
  };
  const note = messages[purchase_type];

  try {
    const db = await getDb();
    // Calculate delivery time
    const deliverAt = new Date(Date.now() + note.delay_hours * 3600 * 1000).toISOString();
    await db.run(
      `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at, notification_type)
       SELECT ?, push_token, ?, ?, ?, ?, 'engagement' FROM users WHERE id=? AND push_token IS NOT NULL`,
      [req.user.id, note.title, note.body, note.data, deliverAt, req.user.id]
    ).catch(logIgnored('routes/push')); // graceful — table may not exist yet in demo
    return res.json({ scheduled: true, deliver_at: deliverAt, message: note });
  } catch {
    return res.json({ scheduled: false, error: 'Could not schedule push. Please try again.' });
  }
});

// ── Reminders ──────────────────────────────────────────────────────────────────
// POST /api/push/reminders — schedule a reminder the user asked for (deadline,
//   follow-up, …). Body: { title, body?, deliver_at (ISO 8601 instant), case_id?,
//   notification_type? } — `scheduled_for` is accepted as an alias of deliver_at
//   for app builds that sent that name. Delivered by services/reminderDispatcher.js
//   (push to the user's devices, email fallback). Court-date reminders are planned
//   automatically per case — see POST /api/cases/:id/reminders.
// GET  /api/push/reminders — the user's pending reminders (court + own), soonest first.
const MAX_REMINDER_AHEAD_MS = 2 * 366 * 86_400_000;

router.post('/reminders', authRequired, pushLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const b = req.body || {};
    const title = typeof b.title === 'string' ? sanitizeStr(b.title).slice(0, 120) : '';
    const rawWhen = b.deliver_at ?? b.scheduled_for;
    if (!title || !rawWhen) {
      return res.status(400).json({ error: 'title and deliver_at are required' });
    }
    const when = new Date(String(rawWhen));
    if (Number.isNaN(when.getTime()) || !/\d{4}-\d{2}-\d{2}T/.test(String(rawWhen))) {
      return err400(res, 'deliver_at must be an ISO 8601 date-time (e.g. 2026-10-14T15:00:00Z)');
    }
    const now = Date.now();
    if (when.getTime() <= now - 60_000) return err400(res, 'deliver_at is in the past');
    if (when.getTime() > now + MAX_REMINDER_AHEAD_MS) return err400(res, 'deliver_at is too far in the future');

    let caseId = null;
    if (b.case_id !== undefined && b.case_id !== null && b.case_id !== '') {
      caseId = Number(b.case_id);
      const owned = Number.isSafeInteger(caseId)
        ? await db.get('SELECT id FROM cases WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [caseId, req.user.id])
        : null;
      if (!owned) return res.status(404).json({ error: 'Case not found.' });
    }
    // 'court_reminder' rows are owned by the per-case planner; user-set ones are 'reminder'.
    const type = 'reminder';
    const text = typeof b.body === 'string' ? sanitizeStr(b.body).slice(0, 500) : '';
    const data = { type, screen: typeof b.data?.screen === 'string' ? b.data.screen.slice(0, 40) : (caseId ? 'Cases' : null), case_id: caseId };

    await rememberTimeZone(db, req.user.id, req.get('X-Timezone')).catch(() => false);
    const r = await db.run(
      `INSERT INTO scheduled_pushes
         (user_id, push_token, title, body, deliver_at, notification_type, case_id, data, status)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'pending')`,
      [req.user.id, title, text, when.toISOString(), type, caseId, JSON.stringify(data)]
    );
    res.status(201).json({ id: r.lastID, scheduled: true, deliver_at: when.toISOString(), case_id: caseId });
  } catch(e) {
    logger.error('[push/reminders]', e.message);
    res.status(500).json({ error: 'Could not schedule reminder' });
  }
});

router.get('/reminders', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT id, title, body, deliver_at, notification_type, case_id, data
         FROM scheduled_pushes
        WHERE user_id = ? AND status = 'pending'
          AND notification_type IN ('court_reminder','follower_court_reminder','reminder')
          AND deliver_at > NOW()
        ORDER BY deliver_at ASC
        LIMIT 50`,
      [req.user.id]
    );
    return res.json(rows.map(r => {
      let data = {};
      try { data = JSON.parse(r.data || '{}'); } catch { /* keep {} */ }
      return {
        id: Number(r.id), title: r.title, body: r.body,
        deliver_at: r.deliver_at instanceof Date ? r.deliver_at.toISOString() : r.deliver_at,
        type: r.notification_type, case_id: r.case_id == null ? null : Number(r.case_id),
        court_date: data.court_date || null,
        court_date_id: data.court_date_id ?? null,
        days_before: data.days_before ?? null,
      };
    }));
  } catch (e) { logger.error('[push/reminders]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// DELETE /api/push/reminders/:id — cancel one of my pending reminders.
router.delete('/reminders/:id', authRequired, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return err400(res, 'invalid id');
    const db = await getDb();
    const r = await db.run(
      `UPDATE scheduled_pushes SET status = 'cancelled', error = 'user_cancelled'
        WHERE id = ? AND user_id = ? AND status = 'pending'`,
      [id, req.user.id]
    );
    if (!r.changes) return res.status(404).json({ error: 'Reminder not found.' });
    res.json({ ok: true });
  } catch (e) { logger.error('[push/reminders/delete]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Time zone ─────────────────────────────────────────────────────────────────
// POST /api/push/timezone { timezone: 'America/Chicago' } — the app reports the
// device zone (also sent as the X-Timezone header). Reminder times are wall-clock
// times in this zone; changing it re-plans pending court reminders.
router.post('/timezone', authRequired, async (req, res) => {
  try {
    const tz = req.body?.timezone;
    if (!isValidTimeZone(tz)) return err400(res, 'timezone must be an IANA zone name, e.g. America/Chicago');
    const db = await getDb();
    const changed = await rememberTimeZone(db, req.user.id, tz);
    const replanned = changed ? await rescheduleUserCourtReminders(db, req.user.id) : 0;
    res.json({ ok: true, timezone: tz, changed, replanned_cases: replanned });
  } catch (e) {
    logger.error('[push/timezone]', e.message);
    res.status(500).json({ error: 'Could not save time zone.' });
  }
});

// ── Language ──────────────────────────────────────────────────────────────────
// POST /api/push/language { language: 'es' } — the language the person chose in
// the app (en / es / pt / vi / ht / zh / ar / tl). Court reminders, follower notices and reminder
// e-mails are written in it; changing it re-plans pending court reminders so
// their text follows.
router.post('/language', authRequired, async (req, res) => {
  const lang = normalizeLang(req.body?.language);
  if (!lang) return err400(res, msg(resolveLang(req), 'lang.err.bad'));
  try {
    const db = await getDb();
    const changed = await rememberLanguage(db, req.user.id, lang);
    const replanned = changed ? await rescheduleUserCourtReminders(db, req.user.id) : 0;
    res.json({ ok: true, language: lang, changed, replanned_court_dates: replanned, message: msg(lang, 'lang.saved') });
  } catch (e) {
    logger.error('[push/language]', e.message);
    res.status(500).json({ error: msg(lang, 'lang.err.save') });
  }
});

// ── Notification preferences ──────────────────────────────────────────────────
// GET  /api/push/preferences  — return current prefs
// POST /api/push/preferences  — update prefs
router.get('/preferences', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get(
      `SELECT notif_court_reminders, notif_legal_tips, notif_arrest_alerts,
              notif_marketing, notif_checkin_reminders, timezone, preferred_language
       FROM users WHERE id=?`,
      [req.user.id]
    );
    return res.json(user || {
      notif_court_reminders:  1,
      notif_legal_tips:       1,
      notif_arrest_alerts:    1,
      notif_marketing:        0,
      notif_checkin_reminders:1,
      timezone:               null,
      preferred_language:     null,
    });
  } catch {
    return res.status(500).json({ error: 'Could not load preferences' });
  }
});

router.post('/preferences', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const b = req.body || {};
    // Only the keys the client sends are changed — a missing key never flips
    // a preference (in particular it never opts anyone into marketing).
    const KEYS = ['notif_court_reminders', 'notif_legal_tips', 'notif_arrest_alerts', 'notif_marketing', 'notif_checkin_reminders'];
    const sets = []; const vals = [];
    for (const k of KEYS) {
      if (b[k] === undefined) continue;
      sets.push(`${k}=?`); vals.push(b[k] ? 1 : 0);
    }
    if (b.timezone !== undefined && b.timezone !== null) {
      if (!isValidTimeZone(b.timezone)) return err400(res, 'timezone must be an IANA zone name, e.g. America/Chicago');
    }
    if (b.language !== undefined && b.language !== null && !normalizeLang(b.language)) {
      return err400(res, msg(resolveLang(req), 'lang.err.bad'));
    }
    if (sets.length) await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id=?`, [...vals, req.user.id]);
    const tzChanged = !!b.timezone && await rememberTimeZone(db, req.user.id, b.timezone);
    const langChanged = !!b.language && await rememberLanguage(db, req.user.id, b.language);
    if (tzChanged || langChanged) await rescheduleUserCourtReminders(db, req.user.id);
    return res.json({ ok: true });
  } catch (e) {
    logger.error('[push/preferences]', e.message);
    return res.status(500).json({ error: 'Could not save preferences' });
  }
});

// ── D7 re-engagement trigger ──────────────────────────────────────────────────
// Called by scheduler 7 days after a user first registers (free users only).
// Target: users who browsed but haven't returned or subscribed.
// Message: routes to expungement screen — highest-value free feature.
router.post('/d7-reengage', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get(
      `SELECT id, push_token, is_premium FROM users WHERE id=?`, [req.user.id]
    );
    if (!user?.push_token) return res.json({ sent: false, reason: 'no_push_token' });
    if (user.is_premium) return res.json({ sent: false, reason: 'already_premium' });

    const deliverAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await db.run(
      `INSERT INTO scheduled_pushes (user_id, push_token, title, body, data, deliver_at, notification_type)
       VALUES (?,?,?,?,?,?,'engagement')`,
      [user.id, user.push_token,
       "Your legal rights don't expire.",
       'Check if you qualify for free expungement — it could clear your record permanently.',
       JSON.stringify({ screen: 'Expungement' }),
       deliverAt]
    );
    return res.json({ sent: true, deliver_at: deliverAt });
  } catch {
    return res.status(500).json({ error: 'Could not schedule D7 push' });
  }
});




export default router;