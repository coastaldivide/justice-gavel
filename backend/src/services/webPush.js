/**
 * services/webPush.js — browser (VAPID) push delivery for the web / PWA app.
 *
 * Court reminders were Expo-push → e-mail only, so a person using the web app got
 * no notification at all unless e-mail was configured (Oct 2026 reminder review).
 * The dispatcher now tries web push after Expo push. Off (returns
 * { enabled: false }) until VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_EMAIL
 * are set. Dead subscriptions (404 / 410) are removed. Never throws.
 */
import logger from '../utils/logger.js';
import { logIgnored } from '../utils/ignored.js';

let _wp;            // undefined = not loaded yet, null = unavailable
export async function getWebPush() {
  if (_wp !== undefined) return _wp;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;
  if (!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_EMAIL)) return null;   // re-checked next call
  try {
    const mod = await import('web-push');
    const wp = mod.default || mod;
    wp.setVapidDetails(`mailto:${VAPID_EMAIL}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    _wp = wp;
  } catch (e) {
    logger.warn({ err: e.message }, '[webPush] web-push unavailable');
    _wp = null;
  }
  return _wp;
}

export const webPushLive = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_EMAIL);

/** Send one notification to every browser subscription of a user. */
export async function sendWebPushToUser(db, userId, { title, body = '', url = '/', tag = null, data = {} }) {
  const wp = await getWebPush();
  if (!wp) return { enabled: false, sent: 0, total: 0 };
  const subs = await db.all('SELECT endpoint, p256dh, auth FROM web_push_subscriptions WHERE user_id = ? LIMIT 10', [userId]).catch(() => []);
  const payload = JSON.stringify({
    title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 500),
    url: typeof url === 'string' && url.startsWith('/') ? url.slice(0, 300) : '/',
    icon: '/icon-192.png', tag: tag ? String(tag).slice(0, 80) : undefined, data,
  });
  let sent = 0; let lastError = null;
  for (const s of subs) {
    try {
      await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { timeout: 10_000, TTL: 6 * 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      lastError = e.statusCode ? `web_push_${e.statusCode}` : 'web_push_failed';
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.run('DELETE FROM web_push_subscriptions WHERE endpoint = ?', [s.endpoint]).catch(logIgnored('services/webPush'));
      }
    }
  }
  return { enabled: true, sent, total: subs.length, error: sent ? null : (subs.length ? lastError : 'no_web_subscription') };
}
