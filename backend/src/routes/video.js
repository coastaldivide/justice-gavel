import { logIgnored } from '../utils/ignored.js';
/**
 * routes/video.js — Attorney-client video consultations via Daily.co
 *
 * Daily.co: embedded WebRTC, HIPAA BAA available, $0 until 10K participant-min/mo
 * No SDK install needed — works via iframe in WebView on mobile + web.
 *
 * Endpoints:
 *   POST   /video/session              → create a room, return the creator's token + URL;
 *                                        with attorney_id (counsel on one of the caller's
 *                                        cases, or the lawyer of a confirmed booking) the
 *                                        attorney is invited (push, in their language)
 *   POST   /video/session/:name/join   → a participant (creator or invited attorney) gets
 *                                        their own meeting token (the attorney is the owner)
 *   GET    /video/session/:name        → session status (participants only)
 *   DELETE /video/session/:name        → end the session (participants only)
 *   GET    /video/sessions/me          → sessions the caller created or was invited to
 *
 * Feature gate: creating a room needs Legal Pro / Esquire; joining as the invited attorney does not.
 * Sessions expire after 2 hours and are deleted from Daily.co automatically.
 *
 * Env vars:
 *   DAILY_API_KEY    — from dashboard.daily.co → developers → API keys (503 video_unavailable without)
 *   DAILY_API_BASE   — Daily REST base URL (default https://api.daily.co/v1; tests / staging)
 */

import { fetchWithTimeout } from '../utils/http.js';
import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb }        from '../db/index.js';
import { sanitizeStr }  from '../utils/sanitize.js';
import { safeInt }      from '../utils/routeHelpers.js';
import { hasFeature } from '../services/entitlements.js';
import { FEATURES } from './billing/plans.js';
import { auditLog }     from '../utils/auditLog.js';
import logger           from '../utils/logger.js';
import { resolveLang, msg, userLang } from '../i18n/index.js';
import { sendPushToUser } from '../services/pushDelivery.js';

const router   = Router();
// Read at call time: a key added after boot is picked up, and tests point the base at a fake Daily.
const dailyKey  = () => process.env.DAILY_API_KEY || null;
const dailyBase = () => String(process.env.DAILY_API_BASE || 'https://api.daily.co/v1').replace(/\/+$/, '');

async function dailyRequest(method, path, body = null) {
  if (!dailyKey()) throw new Error('DAILY_API_KEY not configured');
  const res = await fetchWithTimeout(`${dailyBase()}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${dailyKey()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Daily.co ${method} ${path}: ${err}`);
  }
  return res.json();
}

/** A meeting token for `user` in `roomName` (the attorney owns the room: can mute / remove). */
async function meetingToken(roomName, user, expiresAt, isOwner) {
  const t = await dailyRequest('POST', '/meeting-tokens', {
    properties: {
      room_name: roomName,
      user_name: user.display_name || user.displayName || user.name || (isOwner ? 'Attorney' : 'Client'),
      user_id:   String(user.id),
      exp:       expiresAt,
      is_owner:  !!isOwner,
    },
  });
  return t.token;
}

const ATTORNEY_ROLES = new Set(['attorney', 'defender']);

/**
 * The attorney a client may invite: an attorney account that is counsel on one
 * of the caller's cases, or whose directory listing is the lawyer of one of the
 * caller's confirmed consultations. null when there is no such link.
 */
async function invitableAttorney(db, callerId, attorneyId) {
  const atty = await db.get('SELECT id, role, display_name FROM users WHERE id = ?', [attorneyId]);
  if (!atty || !ATTORNEY_ROLES.has(String(atty.role))) return null;
  const linked = await db.get(
    `SELECT 1 AS ok FROM case_assignments ca JOIN cases c ON c.id = ca.case_id
      WHERE ca.defender_id = ? AND c.user_id = ? AND ca.status = 'active' AND c.deleted_at IS NULL
     UNION ALL
     SELECT 1 FROM consultation_bookings cb JOIN attorney_profiles ap ON ap.lawyer_id = cb.lawyer_id
      WHERE ap.user_id = ? AND cb.user_id = ? AND cb.status = 'confirmed'
     LIMIT 1`, [attorneyId, callerId, attorneyId, callerId]);
  return linked ? atty : null;
}

// ── POST /video/session — create a video consultation room ─────────────────
router.post('/session', authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
  const { matter_id, attorney_id, scheduled_for, topic } = req.body || {};

  // Feature gate — Legal Pro and above
  const db  = await getDb();

  if (!dailyKey()) {
    logger.warn('DAILY_API_KEY not set — video sessions disabled');
    return res.status(503).json({ error: msg(lang, 'video.err.unavailable'), code: 'video_unavailable' });
  }

  // A matter can only be linked by someone on it (never another person's matter).
  const matterId = safeInt(matter_id) || null;
  if (matterId) {
    const m = await db.get('SELECT id FROM matters WHERE id = ? AND (user_id = ? OR created_by = ?)', [matterId, req.user.id, req.user.id]).catch(() => null);
    if (!m) return res.status(404).json({ error: msg(lang, 'video.err.matter_not_found'), code: 'not_found' });
  }
  // The attorney to invite must be linked to the caller (never any account by id).
  const attorneyId = safeInt(attorney_id) || null;
  const attorney = attorneyId ? await invitableAttorney(db, req.user.id, attorneyId) : null;
  if (attorneyId && !attorney) return res.status(404).json({ error: msg(lang, 'video.err.attorney_not_found'), code: 'attorney_not_found' });

  if (!await hasFeature(db, req.user.id, FEATURES.VIDEO_CONSULTATION)) {
    return res.status(403).json({
      error:    msg(lang, 'video.err.upgrade'),
      code:     'upgrade_required',
      upgrade:  true,
      tier_needed: 'legal_pro',
    });
  }

  try {
    // Create a private Daily.co room
    const safeTopic = sanitizeStr(typeof topic === 'string' && topic.trim() ? topic : 'Legal Consultation').slice(0, 60);
    const expiresAt = Math.floor(Date.now() / 1000) + 2 * 3600; // 2 hours

    const room = await dailyRequest('POST', '/rooms', {
      name:       `jg-${req.user.id}-${Date.now()}`,
      privacy:    'private',
      properties: {
        exp:                 expiresAt,
        max_participants:    4,           // defendant + attorney + 2 co-counsel
        enable_chat:         false,        // use our own messages.js
        enable_screenshare:  true,
        lang:                ['en', 'es', 'pt'].includes(lang) ? lang : 'en',
        start_video_off:     false,
        start_audio_off:     false,
      },
    });

    // The creator's own token (an attorney who creates the room owns it).
    const token = await meetingToken(room.name, req.user, expiresAt, ATTORNEY_ROLES.has(String(req.user.role)));

    await db.run(
      `INSERT INTO video_sessions
         (user_id, matter_id, attorney_id, daily_room_name, daily_room_url,
          topic, scheduled_for, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, to_timestamp(?), NOW())`,
      [req.user.id, matterId, attorney ? attorney.id : null,
       room.name, room.url, safeTopic,
       parseScheduled(scheduled_for), expiresAt]
    );

    await auditLog({ userId: req.user.id, action: 'VIDEO_SESSION_CREATED',
      entityType: 'video', entityId: room.name, req });

    if (attorney) {
      const attyLang = await userLang(db, attorney.id);
      await sendPushToUser(attorney.id, {
        title: msg(attyLang, 'video.push.invite_title'),
        body:  msg(attyLang, 'video.push.invite_body', { name: req.user.display_name || msg(attyLang, 'consult.a_client') }),
        data:  { type: 'video_invite', screen: 'VideoConsultation', room: room.name },
        channelId: 'attorney_bookings',
      }).catch(e => logger.warn('[video] invite push failed', e?.message));
    }

    return res.json({
      session_duration_minutes: 120,
      room_url:    room.url,
      room_name:   room.name,
      token,
      expires_at:  new Date(expiresAt * 1000).toISOString(),
      join_url:    `${room.url}?t=${token}`,
      topic:       safeTopic,
      attorney_invited: !!attorney,
    });

  } catch (e) {
    logger.warn('[video/session]', e?.message);
    // Graceful degradation: if Daily.co is down, suggest phone call
    return res.status(503).json({
      error: msg(lang, 'video.err.down'),
      code: 'video_unavailable',
      fallback: 'phone',
    });
  }
  } catch (e) {
    logger.warn('[video/session POST]', e?.message);
    if (!res.headersSent) res.status(500).json({ error: msg(lang, 'video.err.down'), code: 'server_error' });
  }
});

/** 'YYYY-MM-DDTHH:MM…' → ISO string, anything else → null (never a DB error). */
function parseScheduled(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** The session row when the caller is its creator or its invited attorney (room names are not secrets). */
async function participantSession(req) {
  const name = String(req.params.name || '');
  if (!/^jg-\d+-\d+$/.test(name)) return null;
  const db = await getDb();
  return db.get(
    `SELECT daily_room_name, daily_room_url, user_id, attorney_id, expires_at, ended_at
       FROM video_sessions WHERE daily_room_name = ? AND (user_id = ? OR attorney_id = ?)`,
    [name, req.user.id, req.user.id]);
}

// ── POST /video/session/:name/join — the caller's own meeting token ──────────
router.post('/session/:name/join', authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
    if (!dailyKey()) return res.status(503).json({ error: msg(lang, 'video.err.unavailable'), code: 'video_unavailable' });
    const s = await participantSession(req);
    if (!s) return res.status(404).json({ error: msg(lang, 'video.err.not_found'), code: 'not_found' });
    const expiresAt = Math.floor(new Date(s.expires_at).getTime() / 1000);
    if (s.ended_at || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
      return res.status(410).json({ error: msg(lang, 'video.err.ended'), code: 'session_ended' });
    }
    const isAttorney = Number(s.attorney_id) === Number(req.user.id) || ATTORNEY_ROLES.has(String(req.user.role));
    let token;
    try { token = await meetingToken(s.daily_room_name, req.user, expiresAt, isAttorney); }
    catch (e) {
      logger.warn('[video/join]', e?.message);
      return res.status(503).json({ error: msg(lang, 'video.err.down'), code: 'video_unavailable', fallback: 'phone' });
    }
    await auditLog({ userId: req.user.id, action: 'VIDEO_SESSION_JOINED', entityType: 'video', entityId: s.daily_room_name, req });
    return res.json({
      room_url: s.daily_room_url, room_name: s.daily_room_name, token,
      join_url: `${s.daily_room_url}?t=${token}`, expires_at: new Date(expiresAt * 1000).toISOString(),
    });
  } catch (e) {
    logger.warn('[video/join POST]', e?.message);
    if (!res.headersSent) res.status(500).json({ error: msg(lang, 'video.err.down'), code: 'server_error' });
  }
});

// ── GET /video/session/:name — session status ─────────────────────────────
router.get('/session/:name', authRequired, async (req, res) => {
  try {
    if (!(await participantSession(req))) return res.status(404).json({ error: msg(resolveLang(req), 'video.err.not_found'), code: 'not_found' });
    const room = await dailyRequest('GET', `/rooms/${encodeURIComponent(req.params.name)}`);
    return res.json({ active: true, room });
  } catch {
    return res.json({ active: false });
  }
});

// ── DELETE /video/session/:name — end session early ──────────────────────
router.delete('/session/:name', authRequired, async (req, res) => {
  try {
    if (!(await participantSession(req))) return res.status(404).json({ error: msg(resolveLang(req), 'video.err.not_found'), code: 'not_found' });
    await (await getDb()).run('UPDATE video_sessions SET ended_at = NOW() WHERE daily_room_name = ? AND ended_at IS NULL', [req.params.name]).catch(logIgnored('routes/video'));
    await auditLog({ userId: req.user.id, action: 'VIDEO_SESSION_ENDED',
      entityType: 'video', entityId: req.params.name, req });
    await dailyRequest('DELETE', `/rooms/${encodeURIComponent(req.params.name)}`);
    return res.json({ ended: true });
  } catch {
    return res.json({ ended: true, note: 'Room may have already expired' });
  }
});


// ── GET /video/sessions/me — user's video session history ────────────────
router.get('/sessions/me', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sessions = await db.all(
      `SELECT vs.daily_room_name AS room_name, vs.topic, vs.matter_id, vs.created_at, vs.ended_at, vs.expires_at,
              (vs.attorney_id = ? AND vs.user_id <> ?) AS invited,
              m.title as matter_title
       FROM video_sessions vs
       LEFT JOIN matters m ON m.id = vs.matter_id AND vs.user_id = ?
       WHERE vs.user_id = ? OR vs.attorney_id = ?
       ORDER BY vs.created_at DESC LIMIT 20`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
    );
    return res.json({ sessions, count: sessions.length });
  } catch (e) {
    logger.warn('[video/sessions/me]', e?.message);
    return res.status(500).json({ error: 'server_error', message: msg(resolveLang(req), 'video.err.down') });
  }
});

export default router;