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
 *   6. Backend sends via POST /api/webpush/send (internal/admin only)
 *
 * Library: web-push (npm install web-push)
 */

import { Router }       from 'express';
import { getDb }        from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { requireFirmRole } from '../middleware/rbac.js';
import { err400, err403, safeInt, sanitizeStr } from '../utils/routeHelpers.js';
import { makeUserLimiter }    from '../middleware/sharedAiLimiter.js';
import logger           from '../utils/logger.js';

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
    return res.json({ enabled: false, public_key: null,
      message: 'Web push not configured. Set VAPID_PUBLIC_KEY in environment.' });
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
    if (!subscription?.endpoint) return err400(res, 'subscription.endpoint required');

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

    res.json({ ok: true, message: 'Web push subscription saved.' });
  } catch (e) {
    logger.error('[webpush/subscribe]', e.message);
    res.status(500).json({ error: 'Could not save subscription.' });
  }
});

// ── POST /api/webpush/send — send a push to a user (internal/admin) ───────────
// Used by the health scan and escalation engine to send alerts to web users.
// For firm users who are using the web app and have subscribed.
router.post('/send', authRequired, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const wp = await getWebPush();
    if (!wp) return res.json({ sent: 0, message: 'Web push not configured.' });

    const { user_id, title, body, url = '/' } = req.body || {};
    if (!user_id) return err400(res, 'user_id required');

    const db = await getDb();
    // Cross-firm push guard: verify target user belongs to requesting admin's firm
    const targetUser = await db.get(
      'SELECT id FROM users WHERE id=?',
      [safeInt(user_id)]
    ).catch(() => null);
    if (!targetUser) return err400(res, 'Target user not found.');
    const targetMembership = await db.get(
      'SELECT firm_id FROM firm_members WHERE user_id=? AND status=\'active\' LIMIT 1',
      [safeInt(user_id)]
    ).catch(() => null);
    const adminFirmId = (await db.get('SELECT firm_id FROM firm_members WHERE user_id=? AND status=\'active\' LIMIT 1', [req.user.id]).catch(()=>null))?.firm_id;
    if (targetMembership && adminFirmId && targetMembership.firm_id !== adminFirmId) {
      return res.status(403).json({ error: 'Cannot send push to user outside your firm.' });
    }
    const subs = await db.all(
      'SELECT endpoint, p256dh, auth FROM web_push_subscriptions WHERE user_id=?',
      [safeInt(user_id)]
    ).catch(() => []);

    const payload = JSON.stringify({ title, body, url, icon: '/icon-192.png' });
    let sent = 0;

    for (const sub of subs) {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Subscription expired — clean it up
          await db.run('DELETE FROM web_push_subscriptions WHERE endpoint=?', [sub.endpoint]).catch(() => {});
        }
        logger.warn(`[webpush/send] subscription failed: ${e.statusCode || e.message}`);
      }
    }

    res.json({ ok: true, sent, total: subs.length });
  } catch (e) {
    logger.error('[webpush/send]', e.message);
    res.status(500).json({ error: 'Web push send failed.' });
  }
});

export default router;
