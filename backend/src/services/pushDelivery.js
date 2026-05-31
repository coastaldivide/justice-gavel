import logger from '../utils/logger.js';
import { getDb } from '../db/index.js';
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
// Synchronous accessor for Expo static methods (isExpoPushToken, chunkPushNotificationReceiptIds)
async function getExpoClass() {
  const { Expo } = await import('expo-server-sdk');
  return Expo;
}

/**
 * sendPushToUser — send an immediate push to a specific user
 * Used by: attorney messages, case updates, hearing reminders
 */
export async function sendPushToUser(userId, { title, body, data = {}, badge = 1, sound = 'default', priority = 'high', channelId = 'default'}) {
  try {
    const db = await getDb();
    const rows = await db.all(
      'SELECT token FROM push_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 3',
      [userId]
    );
    if (!rows.length) return { sent: 0, reason: 'no_token' };

    const ExpoClass   = await getExpoClass();
  const validTokens = rows.map(r => r.token).filter(ExpoClass.isExpoPushToken);
    if (!validTokens.length) return { sent: 0, reason: 'invalid_token' };

    const messages = validTokens.map(to => ({
      to, sound, badge, title, body,
      priority,             // 'high' wakes device immediately; 'normal' batches (up to 1hr)
      channelId,            // Android notification channel (required on Android 8+)
      data: typeof data === 'string' ? JSON.parse(data) : (data || {}),
    }));

    const expoClient = await getExpoClient();
    const chunks = expoClient.chunkPushNotifications(messages);
    const tickets = [];
    for (const chunk of chunks) {
      const chunkTickets = await expoClient.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    }

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
 * deliverScheduledPushes — called by a cron/interval to drain scheduled_pushes table
 * Sends all pushes where deliver_at <= NOW() and status = 'pending'
 */
export async function deliverScheduledPushes() {
  const db = await getDb();
  const due = await db.all(
    `SELECT id, push_token, title, body, data, deliver_at, notification_type, case_id, channelId, expo_ticket_id
     FROM scheduled_pushes
     WHERE deliver_at <= datetime('now')
       AND status = 'pending'
     ORDER BY deliver_at ASC
     LIMIT 50`
  );

  if (!due.length) return { processed: 0 };

  let sent = 0;
  let failed = 0;

  for (const push of due) {
    try {
      const ExpoC = await getExpoClass();
      if (!push.push_token || !ExpoC.isExpoPushToken(push.push_token)) {
        await db.run(
          "UPDATE scheduled_pushes SET status='invalid_token' WHERE id=?",
          [push.id]
        );
        continue;
      }

      const messages = [{
        to: push.push_token,
        sound: 'default',
        badge: 1,
        priority: 'high',
        channelId: push.channelId || 'default',
        title: push.title,
        body: push.body,
          data: {
            type:    push.notification_type || 'general',
            case_id: push.case_id           || null,
            push_id: push.id,
          },
      }];

      const expoC = await getExpoClient();
      const [ticket] = await expoC.sendPushNotificationsAsync(messages);

      if (ticket.status === 'error') {
        await db.run(
          "UPDATE scheduled_pushes SET status='error', error=? WHERE id=?",
          [ticket.message, push.id]
        );
        failed++;
      } else {
        await db.run(
          "UPDATE scheduled_pushes SET status='sent', sent_at=datetime('now') WHERE id=?",
          [push.id]
        );
        sent++;
      }
    } catch (err) {
      await db.run(
        "UPDATE scheduled_pushes SET status='error', error=? WHERE id=?",
        [err.message, push.id]
      );
      failed++;
    }
  }

  logger.info(`[Push] Delivered: ${sent} sent, ${failed} failed`);
  return { processed: due.length, sent, failed };
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
          AND sent_at > datetime('now', '-48 hours')
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
              ).catch(() => {});
              await db.run(
                "UPDATE scheduled_pushes SET status='device_not_registered' WHERE id=?",
                [row.id]
              ).catch(() => {});
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
