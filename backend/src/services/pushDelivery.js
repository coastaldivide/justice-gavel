import logger from '../utils/logger.js';
import { getDb } from '../db/index.js';
import { sendExpoPush, isExpoPushToken } from './expoPush.js';

/**
 * sendPushToUser — send an immediate push to a specific user
 * Used by: attorney messages, case updates, hearing reminders.
 * Goes through services/expoPush.js (endpoint injectable via EXPO_PUSH_API_URL).
 */
export async function sendPushToUser(userId, { title, body, data = {}, badge = 1, sound = 'default', priority = 'high', channelId = 'default'}) {
  try {
    const db = await getDb();
    const rows = await db.all(
      'SELECT token FROM push_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 3',
      [userId]
    );
    if (!rows.length) return { sent: 0, reason: 'no_token' };

    const validTokens = rows.map(r => r.token).filter(isExpoPushToken);
    if (!validTokens.length) return { sent: 0, reason: 'invalid_token' };

    const messages = validTokens.map(to => ({
      to, sound, badge, title, body,
      priority,             // 'high' wakes device immediately; 'normal' batches (up to 1hr)
      channelId,            // Android notification channel (required on Android 8+)
      data: typeof data === 'string' ? JSON.parse(data) : (data || {}),
    }));

    const tickets = await sendExpoPush(messages);
    const errors = tickets.filter(t => t.status === 'error');
    if (errors.length) {
      logger.warn({ msg: '[push] send errors', errors: errors.map(e => e.message) });
    }

    return { sent: tickets.length - errors.length, errors: errors.length };
  } catch (err) {
    logger.error('[Push] sendPushToUser error:', err.message);
    return { sent: 0, error: err.message };
  }
}

/**
 * deliverScheduledPushes — drains due rows of scheduled_pushes.
 * Kept for existing callers; the work is done by services/reminderDispatcher.js
 * (which the API process runs every minute — see services/scheduler.js).
 */
export async function deliverScheduledPushes(opts = {}) {
  const { dispatchDueReminders } = await import('./reminderDispatcher.js');
  const r = await dispatchDueReminders(opts);
  return { processed: r.claimed, sent: r.sent, failed: r.failed };
}

/**
 * checkPushReceipts — Expo receipts for recorded tickets; tokens of devices
 * that no longer exist are removed (services/expoPush.js). The scheduler runs
 * it every 30 minutes on one instance.
 */
export { checkPushReceipts } from './expoPush.js';
