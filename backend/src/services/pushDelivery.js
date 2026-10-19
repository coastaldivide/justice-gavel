import { logIgnored } from '../utils/ignored.js';
import logger from '../utils/logger.js';
import { getDb } from '../db/index.js';
import { sendExpoPush, isExpoPushToken } from './expoPush.js';
// ── Lazy Expo singleton — same pattern as cases.js / messages.js ──────────────
// Top-level `new Expo()` crashes at import time if expo-server-sdk is missing.
// Lazy init means the module loads safely and the error surfaces only if push
// is actually attempted without the SDK installed.
let _expoInstance = null;
async function getExpoClient() {
  if (_expoInstance) return _expoInstance;
  const { Expo } = await import('expo-server-sdk');
  _expoInstance = new Expo();
  return _expoInstance;
}

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
 * checkPushReceipts — checks Expo push receipts and removes invalid tokens.
 *
 * WHY THIS MATTERS:
 *   When a push token becomes invalid (user uninstalls, revokes permissions,
 *   or switches devices), Expo returns a DeviceNotRegistered error in the
 *   receipt response — NOT in the initial send ticket. Without checking
 *   receipts, the push table accumulates dead tokens and every push delivery
 *   loop retries them forever.
 *
 * CALL: run this hourly or after each delivery batch.
 */
export async function checkPushReceipts() {
  try {
    const db = await getDb();

    // Get tickets that were sent but not yet receipt-checked (last 48h)
    const pending = await db.all(
      `SELECT id, push_token, expo_ticket_id
         FROM scheduled_pushes
        WHERE status = 'sent'
          AND expo_ticket_id IS NOT NULL
          AND sent_at > (NOW() - INTERVAL '48 hours')
        LIMIT 100`
    ).catch(() => []);

    if (!pending.length) return { checked: 0 };

    const ticketIds = pending.map(p => p.expo_ticket_id).filter(Boolean);
    const expoR = await getExpoClient();
    const receiptChunks = expoR.chunkPushNotificationReceiptIds(ticketIds);

    let invalidCount = 0;
    for (const chunk of receiptChunks) {
      const receipts = await expoR.getPushNotificationReceiptsAsync(chunk);
      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status === 'error') {
          if (receipt.details?.error === 'DeviceNotRegistered') {
            // Token is dead — remove it so we stop sending to it
            const row = pending.find(p => p.expo_ticket_id === receiptId);
            if (row?.push_token) {
              await db.run(
                "DELETE FROM push_tokens WHERE token = ?",
                [row.push_token]
              ).catch(logIgnored('services/pushDelivery'));
              await db.run(
                "UPDATE scheduled_pushes SET status='device_not_registered' WHERE id=?",
                [row.id]
              ).catch(logIgnored('services/pushDelivery'));
              invalidCount++;
              logger.info('[Push] Removed dead token:', row.push_token.slice(-8));
            }
          }
        }
      }
    }

    logger.info(`[Push] Receipt check: ${pending.length} checked, ${invalidCount} dead tokens removed`);
    return { checked: pending.length, removed: invalidCount };
  } catch (err) {
    logger.error('[Push] checkPushReceipts error:', err.message);
    return { checked: 0, error: err.message };
  }
}
