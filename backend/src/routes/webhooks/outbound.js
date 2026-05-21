/**
 * routes/webhooks/outbound.js — Outbound Webhook System
 *
 * Allows firms to register HTTPS endpoints that receive real-time
 * notifications when key events occur in Justice Gavel.
 *
 * Event types:
 *   matter.created, matter.updated, matter.closed
 *   time_entry.created, time_entry.updated
 *   invoice.created, invoice.sent, invoice.paid, invoice.voided
 *   docket.deadline_created, docket.deadline_completed, docket.deadline_overdue
 *   privilege_log.entry_created
 *   conflict.detected, conflict.waiver_recorded
 *
 * Security:
 *   - All deliveries include X-JG-Signature header (HMAC-SHA256)
 *   - Signature: HMAC-SHA256(secret, timestamp + '.' + JSON.stringify(payload))
 *   - Endpoints must verify signature before processing
 *   - Retry: 3 attempts with exponential backoff (1s, 4s, 16s)
 *   - Timeout: 10 seconds per delivery attempt
 *   - HTTPS required in production
 *
 * Mounting: /api/webhooks/outbound
 *
 * Management endpoints:
 *   POST   /api/webhooks/outbound/subscriptions       — create subscription
 *   GET    /api/webhooks/outbound/subscriptions       — list subscriptions
 *   GET    /api/webhooks/outbound/subscriptions/:id   — get subscription
 *   PUT    /api/webhooks/outbound/subscriptions/:id   — update (url, events, active)
 *   DELETE /api/webhooks/outbound/subscriptions/:id   — delete subscription
 *   POST   /api/webhooks/outbound/subscriptions/:id/test — send test payload
 *   GET    /api/webhooks/outbound/deliveries/:subId   — delivery history
 *   POST   /api/webhooks/outbound/deliveries/:id/retry — retry failed delivery
 */

import { Router }      from 'express';
import { createHmac, randomBytes } from 'crypto';
import { getDb }       from '../../db/index.js';
import { authRequired } from '../../middleware/auth.js';
import { requireFirmRole, loadFirmContext } from '../../middleware/rbac.js';
import { writeAuditLog } from '../../middleware/audit.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { err400, err403, err404, safeInt,
         sanitizeStr, truncateStr }          from '../../utils/routeHelpers.js';
import logger           from '../../utils/logger.js';

const router     = Router();
const whLimiter  = makeUserLimiter({ windowMs: 3_600_000, max: 60, message: 'Webhook operation limit.' });
const testLimiter = makeUserLimiter({ windowMs: 60_000, max: 5, message: 'Test webhook limit.' });

// ── Supported event types ─────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  'matter.created',
  'matter.updated',
  'matter.closed',
  'time_entry.created',
  'time_entry.updated',
  'invoice.created',
  'invoice.sent',
  'invoice.paid',
  'invoice.voided',
  'docket.deadline_created',
  'docket.deadline_completed',
  'docket.deadline_overdue',
  'privilege_log.entry_created',
  'conflict.detected',
  'conflict.waiver_recorded',
  'member.added',
  'member.removed',
];

// ── Signature helper ──────────────────────────────────────────────────────────

export function signPayload(secret, timestamp, payload) {
  const data    = `${timestamp}.${typeof payload === 'string' ? payload : JSON.stringify(payload)}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

function generateSecret() {
  return 'whsec_' + randomBytes(24).toString('hex');
}

// ── Delivery engine ───────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [1000, 4000, 16000]; // 1s, 4s, 16s

export async function deliverWebhook(db, subscription, eventType, payload, attempt = 0) {
  const start     = Date.now();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body      = JSON.stringify({
    id:         `evt_${randomBytes(8).toString('hex')}`,
    type:       eventType,
    created:    new Date().toISOString(),
    api_version:'2025-01',
    data:       payload,
  });
  const signature = signPayload(subscription.secret, timestamp, body);

  let responseStatus = null, responseBody = null, success = false;

  try {
    // Validate URL is HTTPS in production
    const url = subscription.url;
    if (process.env.NODE_ENV === 'production' && !url.startsWith('https://')) {
      throw new Error('Webhook endpoint must use HTTPS in production.');
    }

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'X-JG-Signature':    `t=${timestamp},v1=${signature}`,
        'X-JG-Event':        eventType,
        'X-JG-Delivery-ID':  `del_${randomBytes(8).toString('hex')}`,
        'User-Agent':        'JusticeGavel-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    responseStatus = resp.status;
    responseBody   = await resp.text().catch(() => '').then(t => t.slice(0, 500));
    success        = resp.ok || (resp.status >= 200 && resp.status < 300);
  } catch (e) {
    responseBody = e.message?.slice(0, 500) || 'Connection failed';
    responseStatus = null;
    success = false;
  }

  const deliveryMs = Date.now() - start;

  // Log delivery attempt — surface failures; silent drop means audit trail has gaps
  try {
    await db.run(
      `INSERT INTO webhook_deliveries
         (subscription_id, event_type, payload, response_status, response_body, delivery_ms, success)
       VALUES (?,?,?,?,?,?,?)`,
      [subscription.id, eventType, body.slice(0, 2000), responseStatus,
       responseBody, deliveryMs, success ? 1 : 0]
    );
  } catch (e) {
    logger.warn('[webhook/delivery-log] insert failed:', e?.message);
  }

  // Update subscription stats
  if (success) {
    await db.run(
      "UPDATE webhook_subscriptions SET last_triggered_at=datetime('now'), failure_count=0 WHERE id=?",
      [subscription.id]
    ).catch(e => logger.warn('[webhook/stat-reset]', e?.message));
  } else {
    await db.run(
      'UPDATE webhook_subscriptions SET failure_count=failure_count+1 WHERE id=?',
      [subscription.id]
    ).catch(e => logger.warn('[webhook/fail-count]', e?.message));

    // Auto-disable after 50 consecutive failures
    const sub = await db.get('SELECT failure_count FROM webhook_subscriptions WHERE id=?', [subscription.id]).catch(() => null);
    if (sub?.failure_count >= 50) {
      await db.run("UPDATE webhook_subscriptions SET active=0 WHERE id=?", [subscription.id])
        .catch(e => logger.warn('[webhook/auto-disable]', e?.message));
      logger.warn(`[webhook] Subscription ${subscription.id} auto-disabled after 50 failures.`);
    }

    // Retry with backoff
    if (attempt < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[attempt];
      logger.info(`[webhook] Retrying ${eventType} to ${subscription.url} in ${delay}ms (attempt ${attempt + 2})`);
      setTimeout(() => deliverWebhook(db, subscription, eventType, payload, attempt + 1), delay);
    } else {
      logger.warn(`[webhook] Giving up on ${eventType} to ${subscription.url} after ${attempt + 1} attempts.`);
    }
  }

  return { success, status: responseStatus, delivery_ms: deliveryMs };
}

// ── Dispatch event to all matching firm subscriptions ──────────────────────────

export async function dispatchWebhookEvent(db, firmId, eventType, payload) {
  try {
    const subscriptions = await db.all(
      "SELECT id, firm_id, name, url, events, active, last_triggered_at, failure_count, created_by, created_at, updated_at FROM webhook_subscriptions WHERE firm_id=? AND active=1",
      [firmId]
    ).catch(() => []);

    const matching = subscriptions.filter(sub => {
      try {
        const events = JSON.parse(sub.events || '[]');
        return events.includes(eventType) || events.includes('*');
      } catch (e) {
        logger.warn('[webhooks/outbound] events parse:', e?.message);
        return false;
      }
    });

    if (!matching.length) return;

    for (const sub of matching) {
      // Fire-and-forget — delivery is logged internally
      setImmediate(() => deliverWebhook(db, sub, eventType, payload));
    }

    logger.info(`[webhook] Dispatched ${eventType} to ${matching.length} subscription(s) for firm ${firmId}`);
  } catch (e) {
    logger.warn('[webhook/dispatch]', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// POST /subscriptions — create subscription
router.post('/subscriptions', authRequired, requireFirmRole('firm_admin'), whLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = req.firmCtx;

    const {
      name,
      url,
      events,
      active = true,
    } = req.body || {};

    if (!name?.trim())   return err400(res, 'name is required.');
    if (!url?.trim())    return err400(res, 'url (HTTPS endpoint) is required.');
    if (!Array.isArray(events) || !events.length) {
      return err400(res, 'events must be a non-empty array. See GET /api/webhooks/outbound/events for options.');
    }

    // Validate URL format
    try { new URL(url); } catch { return err400(res, 'Invalid URL format.'); }
    if (process.env.NODE_ENV === 'production' && !url.startsWith('https://')) {
      return err400(res, 'Webhook URL must use HTTPS.');
    }

    // Validate event types
    const invalidEvents = events.filter(e => !WEBHOOK_EVENTS.includes(e) && e !== '*');
    if (invalidEvents.length) {
      return err400(res, `Unknown event types: ${invalidEvents.join(', ')}. GET /api/webhooks/outbound/events for valid types.`);
    }

    // Check subscription limit (max 10 per firm)
    const count = await db.get('SELECT COUNT(*) as n FROM webhook_subscriptions WHERE firm_id=?', [ctx.firm_id]);
    if (count?.n >= 10) return res.status(402).json({ error: 'Maximum 10 webhook subscriptions per firm. Delete unused subscriptions first.' });

    const secret = generateSecret();
    const r = await db.run(
      `INSERT INTO webhook_subscriptions (firm_id, name, url, secret, events, active, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [ctx.firm_id, truncateStr(sanitizeStr(name, 100), 100),
       url.trim(), secret, JSON.stringify(events), active ? 1 : 0, req.user.id]
    );

    await writeAuditLog(db, {
      user_id: req.user.id, firm_id: ctx.firm_id,
      action: 'webhook_created', resource: 'webhook',
      target_id: r.lastID,
      detail: JSON.stringify({ url, events }),
      ip: req.ip, ua: req.headers['user-agent'],
    });

    res.json({
      id:       r.lastID,
      name:     truncateStr(sanitizeStr(name, 100), 100),
      url,
      secret,   // Only shown ONCE on creation — store it securely
      events,
      active:   !!active,
      note:     'Store the secret securely — it will not be shown again. Use it to verify X-JG-Signature on inbound events.',
    });
  } catch (e) {
    logger.error('[webhooks/create]', e.message);
    res.status(500).json({ error: 'Could not create webhook subscription.' });
  }
});

// GET /subscriptions — list subscriptions
router.get('/subscriptions', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);

    const rows = await db.all(
      `SELECT id, name, url, events, active, last_triggered_at, failure_count, created_at
       FROM webhook_subscriptions WHERE firm_id=? ORDER BY created_at DESC`,
      [ctx.firm_id]
    );

    res.json({
      subscriptions: rows.map(s => ({
        ...s,
        events: (() => { try { return JSON.parse(s.events); } catch { return []; } })(),
        secret: '[hidden]',
      })),
      count: rows.length,
    });
  } catch (e) {
    logger.error('[webhooks/list]', e.message);
    res.status(500).json({ error: 'Could not load webhook subscriptions.' });
  }
});

// GET /subscriptions/:id
router.get('/subscriptions/:id', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    const sub = await db.get('SELECT id, firm_id, name, url, events, active, last_triggered_at, failure_count, created_by, created_at, updated_at FROM webhook_subscriptions WHERE id=? AND firm_id=? LIMIT 1', [safeInt(req.params.id), ctx.firm_id]);
    if (!sub) return err404(res, 'Webhook subscription not found.');

    res.json({
      ...sub,
      events: (() => { try { return JSON.parse(sub.events); } catch { return []; } })(),
      secret: '[hidden]',
    });
  } catch (e) {
    logger.error('[webhooks/get]', e.message);
    res.status(500).json({ error: 'Could not load subscription.' });
  }
});

// PUT /subscriptions/:id — update url, events, active, name
router.put('/subscriptions/:id', authRequired, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = req.firmCtx;
    const sub = await db.get('SELECT id, firm_id, name, url, events, active, last_triggered_at, failure_count, created_by, created_at, updated_at FROM webhook_subscriptions WHERE id=? AND firm_id=? LIMIT 1', [safeInt(req.params.id), ctx.firm_id]);
    if (!sub) return err404(res, 'Webhook subscription not found.');

    const { name, url, events, active } = req.body || {};
    const updates = []; const params = [];

    if (name)   { updates.push('name=?');   params.push(truncateStr(sanitizeStr(name,100),100)); }
    if (url) {
      try { new URL(url); } catch { return err400(res, 'Invalid URL.'); }
      updates.push('url=?'); params.push(url.trim());
    }
    if (events) {
      if (!Array.isArray(events)) return err400(res, 'events must be an array.');
      updates.push('events=?'); params.push(JSON.stringify(events));
    }
    if (active !== undefined) { updates.push('active=?'); params.push(active ? 1 : 0); }
    if (!updates.length) return err400(res, 'Nothing to update.');

    updates.push("updated_at=datetime('now')");
    params.push(safeInt(req.params.id));
    await db.run(`UPDATE webhook_subscriptions SET ${updates.join(',')} WHERE id=?`, params);

    const updated = await db.get('SELECT id, firm_id, name, url, events, active, last_triggered_at, failure_count, created_by, created_at, updated_at FROM webhook_subscriptions WHERE id=? LIMIT 1', [safeInt(req.params.id)]);
    res.json({
      ...updated,
      events: (() => { try { return JSON.parse(updated.events); } catch { return []; } })(),
      secret: '[hidden]',
    });
  } catch (e) {
    logger.error('[webhooks/update]', e.message);
    res.status(500).json({ error: 'Could not update subscription.' });
  }
});

// DELETE /subscriptions/:id
router.delete('/subscriptions/:id', authRequired, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = req.firmCtx;
    const sub = await db.get('SELECT id FROM webhook_subscriptions WHERE id=? AND firm_id=?', [safeInt(req.params.id), ctx.firm_id]);
    if (!sub) return err404(res, 'Webhook subscription not found.');
    await db.run('DELETE FROM webhook_subscriptions WHERE id=?', [safeInt(req.params.id)]);
    res.json({ deleted: true });
  } catch (e) {
    logger.error('[webhooks/delete]', e.message);
    res.status(500).json({ error: 'Could not delete subscription.' });
  }
});

// POST /subscriptions/:id/test — send test event
router.post('/subscriptions/:id/test', authRequired, requireFirmRole('firm_admin'), testLimiter, async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = req.firmCtx;
    const sub = await db.get('SELECT id, firm_id, name, url, events, active, last_triggered_at, failure_count, created_by, created_at, updated_at FROM webhook_subscriptions WHERE id=? AND firm_id=? LIMIT 1', [safeInt(req.params.id), ctx.firm_id]);
    if (!sub) return err404(res, 'Subscription not found.');

    const testPayload = {
      test:       true,
      firm_id:    ctx.firm_id,
      user_id:    req.user.id,
      message:    'This is a test webhook delivery from Justice Gavel.',
      sent_at:    new Date().toISOString(),
    };

    const result = await deliverWebhook(db, sub, 'test.ping', testPayload);

    res.json({
      test_sent:    true,
      url:          sub.url,
      success:      result.success,
      status_code:  result.status,
      delivery_ms:  result.delivery_ms,
      message:      result.success
        ? 'Test delivery successful. Your endpoint received the event.'
        : 'Test delivery failed. Check that your endpoint is reachable and returns 2xx.',
    });
  } catch (e) {
    res.status(500).json({ error: 'Test delivery failed.', detail: e.message });
  }
});

// GET /deliveries/:subId — delivery history
router.get('/deliveries/:subId', authRequired, requireFirmRole('partner'), async (req, res) => {
  try {
    const db  = await getDb();
    const ctx = await loadFirmContext(req);
    const subId = safeInt(req.params.subId);

    // Verify the subscription belongs to this firm
    const sub = await db.get('SELECT id FROM webhook_subscriptions WHERE id=? AND firm_id=?', [subId, ctx.firm_id]);
    if (!sub) return err404(res, 'Subscription not found.');

    const limit = Math.min(safeInt(req.query.limit || '20'), 100);
    const deliveries = await db.all(
      `SELECT id, event_type, response_status, response_body, delivery_ms, success, attempted_at
       FROM webhook_deliveries WHERE subscription_id=? ORDER BY attempted_at DESC LIMIT ?`,
      [subId, limit]
    );

    res.json({
      subscription_id: subId,
      deliveries,
      count: deliveries.length,
      success_rate: deliveries.length
        ? Math.round(deliveries.filter(d => d.success).length / deliveries.length * 100)
        : null,
    });
  } catch (e) {
    logger.error('[webhooks/deliveries]', e.message);
    res.status(500).json({ error: 'Could not load delivery history.' });
  }
});

// POST /deliveries/:id/retry — manually retry a failed delivery
router.post('/deliveries/:id/retry', authRequired, requireFirmRole('firm_admin'), async (req, res) => {
  try {
    const db       = await getDb();
    const ctx      = req.firmCtx;
    const delivery = await db.get('SELECT id, subscription_id, event_type, response_status, response_body, delivery_ms, success, attempted_at FROM webhook_deliveries WHERE id=? LIMIT 1', [safeInt(req.params.id)]);
    if (!delivery) return err404(res, 'Delivery not found.');

    const sub = await db.get('SELECT id, firm_id, name, url, events, active, last_triggered_at, failure_count, created_by, created_at, updated_at FROM webhook_subscriptions WHERE id=? AND firm_id=? LIMIT 1', [delivery.subscription_id, ctx.firm_id]);
    if (!sub) return err403(res);

    // Re-parse original payload
    let payload;
    try { payload = JSON.parse(delivery.payload); } catch { payload = {}; }

    const result = await deliverWebhook(db, sub, delivery.event_type, payload?.data || payload);
    res.json({ retried: true, success: result.success, status: result.status, delivery_ms: result.delivery_ms });
  } catch (e) {
    res.status(500).json({ error: 'Retry failed.', detail: e.message });
  }
});

// GET /events — list all supported event types
router.get('/events', authRequired, (req, res) => {
  res.json({
    events: WEBHOOK_EVENTS,
    wildcard: '*',
    note: 'Use "*" in events array to subscribe to all event types.',
    signature_docs: 'Each delivery includes X-JG-Signature header. Verify with: HMAC-SHA256(secret, timestamp + "." + body)',
  });
});

export default router;
