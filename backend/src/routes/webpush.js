/**
 * routes/webpush.js — VAPID Web Push for browser/PWA/desktop
 *
 * Expo push tokens work for iOS/Android native builds.
 * Browser Push API (VAPID) is required for Web PWA and Electron.
 *
 * Setup:
 *   1. Generate VAPID keys: npx web-push generate-vapid-keys
 *   2. Add to .env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
 *   3. Frontend calls GET /api/webpush/key to get the public key
 *   4. Frontend subscribes via PushManager.subscribe({ applicationServerKey })
 *   5. Frontend POSTs the PushSubscription to POST /api/webpush/subscribe
 *   6. Backend sends via POST /api/webpush/send (platform staff, or a firm admin
 *      to an active member of the same firm — never to anyone else)
 *
 * The push endpoint is a URL the server POSTs to: it must be https on a public
 * host (utils/ssrfGuard.js), checked when it is stored. Without VAPID keys web
 * push is off: /key says so and /send sends nothing.
 *
 * Library: web-push (npm install web-push)
 */

import { logIgnored } from '../utils/ignored.js';
import { Router }       from 'express';
import { getDb }        from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { err400, safeInt, sanitizeStr } from '../utils/routeHelpers.js';
import { makeUserLimiter }    from '../middleware/sharedAiLimiter.js';
import logger           from '../utils/logger.js';
import { publicUrlError } from '../utils/ssrfGuard.js';
import { ACTIVE_MEMBER_SQL } from '../middleware/rbac.js';
import { isStaff }      from '../utils/staff.js';
import { msg, resolveLang } from '../i18n/index.js';

const router = Router();

// Initialize web-push lazily — only if VAPID keys are configured
let webpush = null;
async function getWebPush() {
  if (webpush) return webpush;
  try {
    webpush = await import('web-push');
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_EMAIL) {
      webpush.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      logger.info('[webpush] VAPID configured — browser push enabled');
    } else {
      logger.warn('[webpush] VAPID keys not set — web push disabled. See VAPID_PUBLIC_KEY in .env.example');
      webpush = null;
    }
  } catch {
    logger.warn('[webpush] web-push package not installed — run: npm install web-push');
    webpush = null;
  }
  return webpush;
}

// ── GET /api/webpush/key — public VAPID key for PushManager.subscribe ────────
router.get('/key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return res.json({ enabled: false, public_key: null, message: msg(resolveLang(req), 'webpush.off') });
  }
  res.json({ enabled: true, public_key: key });
});

// ── POST /api/webpush/subscribe — store a PushSubscription ───────────────────
// Called by the frontend after PushManager.subscribe() succeeds.
// Stores the subscription alongside the user's Expo push token (if any).
const webPushLimiter = makeUserLimiter({ windowMs: 60_000, max: 10, message: 'Too many subscription requests.' });

router.post('/subscribe', authRequired, webPushLimiter, async (req, res) => {
  try {
    const { subscription, user_agent, platform = 'web' } = req.body || {};
    const lang = resolveLang(req);
    if (typeof subscription?.endpoint !== 'string' || !subscription.endpoint) return res.status(400).json({ error: 'endpoint_required', message: msg(lang, 'webpush.err.endpoint') });
    if (await publicUrlError(subscription.endpoint, { allowUnresolved: true })) {
      return res.status(400).json({ error: 'endpoint_not_allowed', message: msg(lang, 'webpush.err.endpoint') });
    }

    const db = await getDb();
    // web_push_subscriptions table is declared in db/index.js — created at startup
    await db.run(
      `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth, platform, user_agent)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, endpoint) DO UPDATE SET
         p256dh=excluded.p256dh, auth=excluded.auth, platform=excluded.platform`,
      [
        req.user.id,
        sanitizeStr(subscription.endpoint, 2000),
        subscription.keys?.p256dh ? sanitizeStr(subscription.keys.p256dh, 200) : null,
        subscription.keys?.auth   ? sanitizeStr(subscription.keys.auth, 100)   : null,
        sanitizeStr(platform, 20),
        user_agent ? sanitizeStr(user_agent, 300) : null,
      ]
    );

    res.json({ ok: true, message: msg(lang, 'webpush.saved') });
  } catch (e) {
    logger.error('[webpush/subscribe]', e.message);
    res.status(500).json({ error: 'server_error', message: msg(resolveLang(req), 'http.500') });
  }
});

// ── POST /api/webpush/send — send a push to a user (internal/admin) ───────────
// Used by the health scan and escalation engine to send alerts to web users.
// For firm users who are using the web app and have subscribed.
router.post('/send', authRequired, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const { user_id, title, body, url = '/' } = req.body || {};
    const targetId = safeInt(user_id);
    if (!targetId || typeof title !== 'string' || !title.trim()) return err400(res, 'user_id and title required');

    const db = await getDb();
    // Platform staff may alert anyone; a firm admin only an active member of their own firm.
    const staff = await isStaff(db, req.user);
    if (!staff) {
      const shared = await db.get(
        `SELECT 1 AS ok FROM firm_members fm JOIN firm_members t ON t.firm_id = fm.firm_id
          WHERE fm.user_id = ? AND ${ACTIVE_MEMBER_SQL} AND COALESCE(fm.firm_role, fm.role) = 'firm_admin'
            AND t.user_id = ? AND COALESCE(t.active, 1) = 1 AND COALESCE(t.status, 'active') = 'active' LIMIT 1`, [req.user.id, targetId]);
      if (!shared) return res.status(403).json({ error: 'forbidden', message: msg(lang, 'http.403') });
    }
    const wp = await getWebPush();
    if (!wp) return res.json({ sent: 0, enabled: false, message: msg(lang, 'webpush.off') });
    const subs = await db.all(
      'SELECT endpoint, p256dh, auth FROM web_push_subscriptions WHERE user_id=?',
      [safeInt(user_id)]
    ).catch(() => []);

    const payload = JSON.stringify({ title: sanitizeStr(title, 120), body: typeof body === 'string' ? sanitizeStr(body, 500) : '',
      url: typeof url === 'string' && url.startsWith('/') ? url.slice(0, 300) : '/', icon: '/icon-192.png' });
    let sent = 0;

    for (const sub of subs) {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { timeout: 10_000 }   // ms — a slow push service must not stall the loop
        );
        sent++;
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Subscription expired — clean it up
          await db.run('DELETE FROM web_push_subscriptions WHERE endpoint=?', [sub.endpoint]).catch(logIgnored('routes/webpush'));
        }
        logger.warn(`[webpush/send] subscription failed: ${e.statusCode || e.message}`);
      }
    }

    res.json({ ok: true, sent, total: subs.length });
  } catch (e) {
    logger.error('[webpush/send]', e.message);
    res.status(500).json({ error: 'server_error', message: msg(lang, 'http.500') });
  }
});

export default router;
