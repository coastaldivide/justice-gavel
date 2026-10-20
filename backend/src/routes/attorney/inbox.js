/**
 * attorney/inbox.js — the attorney's inbox: everything that needs a reply or a decision.
 *
 *   GET  /api/attorney/inbox
 *        direct_messages      people who wrote to the attorney directly (Lawyers screen "message
 *                             attorneys", profile "Send a message") — one row per person, newest first
 *        unread_messages      unread client messages in case threads the attorney is counsel on
 *        pending_assignments  case invites waiting for an answer
 *        upcoming_consultations  confirmed bookings with the attorney's linked listing (next 7 days)
 *        today_hearings       court dates today (the attorney's zone, X-Timezone) on their cases
 *        recent_cases
 *   POST /api/attorney/inbox/mark-read/:caseId     case thread read
 *   POST /api/attorney/inbox/direct/:userId/read   direct conversation read
 *   POST /api/attorney/inbox/accept/:assignmentId  accept a case invite
 * Replies to direct messages: POST /api/messages/direct { to, body }.
 * Everything is scoped to the signed-in attorney.
 */
import { logIgnored } from '../../utils/ignored.js';
import { Router }           from 'express';
import { authRequired }     from '../../middleware/auth.js';
import { safeInt }          from '../../utils/routeHelpers.js';
import { makeUserLimiter }  from '../../middleware/sharedAiLimiter.js';
import logger               from '../../utils/logger.js';
import { decrypt }          from '../../services/encryption.js';
import { requireDefender }  from './_helpers.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { isValidTimeZone, todayInZone, DEFAULT_TIME_ZONE } from '../../utils/timezone.js';

const router = Router();
const inboxLimiter    = makeUserLimiter({ windowMs: 60_000,   max: 60 });
const markReadLimiter = makeUserLimiter({ windowMs: 60_000,   max: 120 });
const acceptLimiter   = makeUserLimiter({ windowMs: 3_600_000, max: 30 });
const say = (req, k) => msg(resolveLang(req), `attorney.err.${k}`);
const preview = (s) => { const t = String(s || ''); return t.length > 160 ? `${t.slice(0, 160)}…` : t; };

router.get('/inbox', authRequired, inboxLimiter, async (req, res) => {
  const ctx = await requireDefender(req, res);
  if (!ctx) return;
  const { db } = ctx;
  const me = req.user.id;
  const tz = isValidTimeZone(req.get('X-Timezone')) ? req.get('X-Timezone') : DEFAULT_TIME_ZONE;
  const today = todayInZone(tz);
  try {
    const [direct, unread, pending, consults, hearings, recent] = await Promise.all([
      db.all(
        `SELECT DISTINCT ON (other) other, id, sender_id, content, created_at, case_id,
                (SELECT COUNT(*)::int FROM messages x WHERE x.sender_id = t.other AND x.recipient_id = ? AND x.read_at IS NULL) AS unread
           FROM (SELECT m.*, CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END AS other
                   FROM messages m WHERE m.recipient_id = ? OR m.sender_id = ?) t
          WHERE EXISTS (SELECT 1 FROM messages y WHERE y.sender_id = t.other AND y.recipient_id = ?)
          ORDER BY other, created_at DESC, id DESC`,
        [me, me, me, me, me]),
      db.all(
        `SELECT cm.id, cm.case_id, cm.body, cm.sent_at, u.display_name AS client_name, c.title AS case_title
           FROM case_messages cm
           JOIN cases c ON c.id = cm.case_id AND c.deleted_at IS NULL
           JOIN case_assignments ca ON ca.case_id = c.id AND ca.defender_id = ? AND ca.status = 'active'
           JOIN users u ON u.id = cm.sender_id
          WHERE cm.read_at IS NULL AND cm.sender_type = 'user' AND cm.deleted_at IS NULL
          ORDER BY cm.sent_at DESC, cm.id DESC LIMIT 30`, [me]),
      db.all(
        `SELECT ca.id AS assignment_id, ca.assigned_at, ca.notes AS referral_notes,
                c.id AS case_id, c.title, c.state, u.display_name AS client_name
           FROM case_assignments ca
           JOIN cases c ON c.id = ca.case_id AND c.deleted_at IS NULL
           JOIN users u ON u.id = c.user_id
          WHERE ca.defender_id = ? AND ca.status = 'pending'
          ORDER BY ca.assigned_at DESC LIMIT 20`, [me]),
      db.all(
        `SELECT cb.id, cb.starts_at, cb.time_zone, cb.date_slot, cb.time_slot, cb.duration_min, u.display_name AS client_name
           FROM consultation_bookings cb
           JOIN users u ON u.id = cb.user_id
          WHERE (cb.lawyer_id IN (SELECT lawyer_id FROM attorney_profiles WHERE user_id = ? AND lawyer_id IS NOT NULL)
                 OR cb.lawyer_id IN (SELECT id FROM lawyers WHERE user_id = ?))
            AND cb.status = 'confirmed'
            AND COALESCE(cb.starts_at, cb.date_slot::timestamptz) >= NOW() - INTERVAL '1 hour'
            AND COALESCE(cb.starts_at, cb.date_slot::timestamptz) <= NOW() + INTERVAL '7 days'
          ORDER BY COALESCE(cb.starts_at, cb.date_slot::timestamptz) ASC LIMIT 20`, [me, me]),
      db.all(
        `SELECT cd.id AS court_date_id, cd.case_id, cd.court_date, cd.court_time, cd.hearing_type, cd.location,
                c.title, u.display_name AS client_name
           FROM court_dates cd
           JOIN cases c ON c.id = cd.case_id AND c.deleted_at IS NULL
           JOIN case_assignments ca ON ca.case_id = c.id AND ca.defender_id = ? AND ca.status = 'active'
           JOIN users u ON u.id = c.user_id
          WHERE cd.deleted_at IS NULL AND cd.court_date = ?::date
          ORDER BY cd.court_time NULLS LAST LIMIT 50`, [me, today]),
      db.all(
        `SELECT c.id AS case_id, c.title, c.state, c.status, c.updated_at, u.display_name AS client_name,
                (SELECT COUNT(*)::int FROM case_messages cm WHERE cm.case_id = c.id AND cm.read_at IS NULL
                    AND cm.sender_type = 'user' AND cm.deleted_at IS NULL) AS unread_count
           FROM cases c
           JOIN case_assignments ca ON ca.case_id = c.id AND ca.defender_id = ? AND ca.status = 'active'
           JOIN users u ON u.id = c.user_id
          WHERE c.deleted_at IS NULL
          ORDER BY c.updated_at DESC NULLS LAST LIMIT 15`, [me]),
    ]);

    const names = direct.length
      ? Object.fromEntries((await db.all(`SELECT id, display_name FROM users WHERE id IN (${direct.map(() => '?').join(',')})`, direct.map(d => d.other))).map(u => [Number(u.id), u.display_name]))
      : {};
    const directRows = direct
      .map(d => ({
        user_id: Number(d.other), name: names[Number(d.other)] || null, last_message: preview(decrypt(d.content)),
        last_from_me: Number(d.sender_id) === Number(me), last_at: d.created_at, unread: Number(d.unread || 0),
        case_id: d.case_id ? Number(d.case_id) : null,
      }))
      .sort((a, b) => new Date(b.last_at) - new Date(a.last_at));

    const unreadDirect = directRows.reduce((s, d) => s + d.unread, 0);
    res.json({
      summary: {
        unread_direct: unreadDirect,
        unread_messages: unread.length,
        pending_assignments: pending.length,
        today_events: hearings.length + consults.filter(c => c.starts_at && todayInZone(tz, new Date(c.starts_at)) === today).length,
      },
      direct_messages: directRows,
      unread_messages: unread.map(m => ({ ...m, body: preview(decrypt(m.body)) })),
      pending_assignments: pending,
      upcoming_consultations: consults,
      today_hearings: hearings,
      recent_cases: recent,
      today, time_zone: tz,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    logger.error({ msg: '[attorney/inbox]', error: e?.message });
    res.status(500).json({ error: say(req, 'inbox'), code: 'server_error' });
  }
});

router.post('/inbox/mark-read/:caseId', authRequired, markReadLimiter, async (req, res) => {
  const ctx = await requireDefender(req, res);
  if (!ctx) return;
  const caseId = safeInt(req.params.caseId);
  if (!caseId) return res.status(404).json({ error: say(req, 'not_assigned'), code: 'not_found' });
  try {
    const { db } = ctx;
    const a = await db.get(`SELECT id FROM case_assignments WHERE case_id = ? AND defender_id = ? AND status = 'active'`, [caseId, req.user.id]);
    if (!a) return res.status(404).json({ error: say(req, 'not_assigned'), code: 'not_found' });
    await db.run(`UPDATE case_messages SET read_at = NOW() WHERE case_id = ? AND read_at IS NULL AND sender_type = 'user'`, [caseId]);
    res.json({ success: true, case_id: caseId });
  } catch (e) {
    logger.warn('[mark-read]', e?.message);
    res.status(500).json({ error: say(req, 'server'), code: 'server_error' });
  }
});

router.post('/inbox/direct/:userId/read', authRequired, markReadLimiter, async (req, res) => {
  const ctx = await requireDefender(req, res);
  if (!ctx) return;
  const other = safeInt(req.params.userId);
  try {
    const r = await ctx.db.run('UPDATE messages SET read_at = NOW() WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL', [other || 0, req.user.id]);
    res.json({ success: true, marked: r.changes });
  } catch (e) {
    logger.warn('[inbox/direct/read]', e?.message);
    res.status(500).json({ error: say(req, 'server'), code: 'server_error' });
  }
});

router.post('/inbox/accept/:assignmentId', authRequired, acceptLimiter, async (req, res) => {
  const ctx = await requireDefender(req, res);
  if (!ctx) return;
  const { db } = ctx;
  const assignmentId = safeInt(req.params.assignmentId);
  try {
    const assignment = await db.get(
      `SELECT ca.id, ca.case_id, c.title, c.user_id AS client_id
         FROM case_assignments ca JOIN cases c ON c.id = ca.case_id AND c.deleted_at IS NULL
        WHERE ca.id = ? AND ca.defender_id = ? AND ca.status = 'pending'`,
      [assignmentId || 0, req.user.id]);
    if (!assignment) return res.status(404).json({ error: say(req, 'invite_not_found'), code: 'not_found' });
    await db.run(`UPDATE case_assignments SET status = 'active', accepted_at = NOW() WHERE id = ?`, [assignmentId]);
    const { sendPushToUser } = await import('../../services/pushDelivery.js');
    const { userLang } = await import('../../i18n/index.js');
    const lang = await userLang(db, assignment.client_id);
    await sendPushToUser(assignment.client_id, {
      title: msg(lang, 'msgs.push.attorney_accepted_title'),
      body: msg(lang, 'msgs.push.attorney_accepted_body', { name: req.user.display_name || msg(lang, 'msgs.push.your_attorney'), title: assignment.title }),
      data: { type: 'message', screen: 'Messages', caseId: Number(assignment.case_id), case_id: Number(assignment.case_id) },
      channelId: 'case_updates',
    }).catch(logIgnored('routes/attorney/inbox'));
    res.json({ success: true, assignment_id: assignmentId, case_id: Number(assignment.case_id), status: 'active' });
  } catch (e) {
    logger.error('[inbox/accept]', e?.message);
    res.status(500).json({ error: say(req, 'server'), code: 'server_error' });
  }
});

export default router;
