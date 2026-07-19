import { apiLimiter } from '../utils/rateLimiters.js';
import { validate, schemas } from '../validation/schemas.js';
/**
 * routes/video.js — Attorney-client video consultations via Daily.co
 *
 * Daily.co: embedded WebRTC, HIPAA BAA available, $0 until 10K participant-min/mo
 * No SDK install needed — works via iframe in WebView on mobile + web.
 *
 * Endpoints:
 *   POST /video/session         → create a session room, return token + URL
 *   GET  /video/session/:id     → get session status
 *   DELETE /video/session/:id   → end/close session
 *
 * Feature gate: Legal Pro ($34.99) and Esquire tiers only.
 * Sessions expire after 2 hours and are deleted from Daily.co automatically.
 *
 * Env vars:
 *   DAILY_API_KEY    — from dashboard.daily.co → developers → API keys
 */

import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb }        from '../db/index.js';
import { err400, err403 } from '../utils/routeHelpers.js';
import { sanitizeStr }  from '../utils/sanitize.js';
import { canAccessFeature } from '../utils/subscriptionStateMachine.js';
import { auditLog }     from '../utils/auditLog.js';
import logger           from '../utils/logger.js';

const router   = Router();
const DAILY_KEY = process.env.DAILY_API_KEY || null;  // null → 503 handled in POST /session
const DAILY_BASE = 'https://api.daily.co/v1';

async function dailyRequest(method, path, body = null) {
  if (!DAILY_KEY) throw new Error('DAILY_API_KEY not configured');
  const res = await fetch(`${DAILY_BASE}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${DAILY_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Daily.co ${method} ${path}: ${err}`);
  }
  return res.json();
}

// ── POST /video/session — create a video consultation room ─────────────────
router.post('/session', authRequired, async (req, res) => {
  try {
  const { matter_id, attorney_id, scheduled_for, topic } = req.body;

  // Feature gate — Legal Pro and above
  const db  = await getDb();
  const sub = await db.get(`SELECT tier FROM user_subscriptions WHERE user_id = ?`, [req.user.id])
              .catch(() => null);
  if (!process.env.DAILY_API_KEY) {
    logger.warn('DAILY_API_KEY not set — video sessions disabled');
    return res.status(503).json({ error: 'Video consultations temporarily unavailable.' });
  }

  if (!canAccessFeature(sub?.tier, 'video_consultation')) {
    return res.status(403).json({
      error:    'Video consultations require a Legal Pro or Esquire subscription.',
      upgrade:  true,
      tier_needed: 'legal_pro',
    });
  }

  try {
    // Create a private Daily.co room
    const safeTopic = sanitizeStr(topic || 'Legal Consultation').slice(0, 60);
    const expiresAt = Math.floor(Date.now() / 1000) + 2 * 3600; // 2 hours

    const room = await dailyRequest('POST', '/rooms', {
      name:       `jg-${req.user.id}-${Date.now()}`,
      privacy:    'private',
      properties: {
        exp:                 expiresAt,
        max_participants:    4,           // defendant + attorney + 2 co-counsel
        enable_chat:         false,        // use our own messages.js
        enable_screenshare:  true,
        lang:                'en',
        start_video_off:     false,
        start_audio_off:     false,
      },
    });

    // Generate meeting token for this user
    const token = await dailyRequest('POST', '/meeting-tokens', {
      properties: {
        room_name:    room.name,
        user_name:    req.user.name || 'Client',
        user_id:      String(req.user.id),
        exp:          expiresAt,
        is_owner:     false,
      },
    });

    // Log session in DB
    // Non-critical: log session in DB. If DB insert fails, still return the room URL.
    await db.run(
      `INSERT INTO video_sessions
    INSERT INTO video_sessions
         (user_id, matter_id, attorney_id, daily_room_name, daily_room_url,
          topic, scheduled_for, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime('now'))`,
      [req.user.id, matter_id || null, attorney_id || null,
       room.name, room.url, safeTopic,
       scheduled_for || null, expiresAt]
    ).catch(e => logger.warn('[video] session log failed:', e?.message));

    await auditLog({ userId: req.user.id, action: 'VIDEO_SESSION_CREATED',
      entityType: 'video', entityId: room.name, req });


  // ── Pre-session checklist ─────────────────────────────────────────────────
  const preSessionChecklist = [
    { item: 'Ensure microphone and camera are working', done: false },
    { item: 'Find a private, quiet location', done: false },
    { item: 'Charge your device (at least 50%)', done: false },
    { item: 'Write down your key questions in advance', done: false },
    { item: 'Have your case documents accessible', done: false },
    { item: 'Note your attorney\'s contact number in case of disconnection', done: false },
  ];

    return res.json({
      session_duration_minutes: 60,
      pre_session_checklist: preSessionChecklist,
      room_url:    room.url,
      room_name:   room.name,
      token:       token.token,
      expires_at:  new Date(expiresAt * 1000).toISOString(),
      join_url:    `${room.url}?t=${token.token}`,
      topic:       safeTopic,
    });

  } catch (e) {
    logger.warn('[video/session]', e?.message);
    // Graceful degradation: if Daily.co is down, suggest phone call
    return res.status(503).json({
      error: 'Video service temporarily unavailable. Please call your attorney directly.',
      fallback: 'phone',
    });
  }
  } catch (e) { logger.warn('[video/session POST]', e?.message); }
});

// ── GET /video/session/:name — session status ─────────────────────────────
router.get('/session/:name', authRequired, async (req, res) => {
  try {
    const room = await dailyRequest('GET', `/rooms/${req.params.name}`);
    return res.json({ active: true, room });
  } catch {
    return res.json({ active: false });
  }
});

// ── DELETE /video/session/:name — end session early ──────────────────────
router.delete('/session/:name', authRequired, async (req, res) => {
  try {
    await dailyRequest('DELETE', `/rooms/${req.params.name}`);
    await auditLog({ userId: req.user.id, action: 'VIDEO_SESSION_ENDED',
      entityType: 'video', entityId: req.params.name, req });
    return res.json({ ended: true });
  } catch (e) {
    return res.json({ ended: true, note: 'Room may have already expired' });
  }
});


// ── GET /video/sessions/me — user's video session history ────────────────
router.get('/sessions/me', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const sessions = await db.all(
      `SELECT vs.room_name, vs.room_url, vs.matter_id, vs.created_at, vs.ended_at,
              m.title as matter_title
       FROM video_sessions vs
       LEFT JOIN matters m ON m.id = vs.matter_id
       WHERE vs.user_id = ?
       ORDER BY vs.created_at DESC LIMIT 20`,
      [req.user.id]
    ).catch(() => []);
    return res.json({ sessions, count: sessions.length });
  } catch (e) {
    return res.status(500).json({ error: 'Could not fetch session history' });
  }
});

export default router;