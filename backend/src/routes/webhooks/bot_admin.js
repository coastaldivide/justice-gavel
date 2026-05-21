/**
 * webhooks/bot_admin.js — Bot monitoring, manual triggers, revenue dashboard
 *
 * All routes require X-Admin-Key header (timing-safe comparison).
 * The application DB is a singleton — never call db.close() on it.
 *
 * GET  /api/bot/status          — last 10 bot runs, pending links, recent revenue
 * POST /api/bot/run             — manually trigger outbound bot (async, fire-and-forget)
 * GET  /api/bot/revenue         — revenue summary by source and by day
 * GET  /api/bot/opt-outs        — list opt-out numbers/emails (paginated)
 * POST /api/bot/opt-out         — add a manual opt-out
 * GET  /api/bot/messages        — recent outbound messages (filterable)
 * POST /api/bot/expire-links    — manually expire old payment links
 */

import { Router }              from 'express';
import { timingSafeEqual }     from 'crypto';
import logger                  from '../../utils/logger.js';
import { runOutboundBot, expireOldPaymentLinks } from '../../services/outbound_bot.js';
import { getDb }               from '../../db/index.js';
import { makeUserLimiter }     from '../../middleware/sharedAiLimiter.js';
import { err400, safeInt, sanitizeStr } from '../../utils/routeHelpers.js';

const router      = Router();

// Shared rate limiter — admin endpoints still get throttled to prevent scraping
const adminLimiter = makeUserLimiter({ windowMs: 60_000, max: 30, message: 'Admin rate limit reached.' });

// ── Timing-safe admin key check ───────────────────────────────────────────────
// String equality (===) is timing-vulnerable. timingSafeEqual prevents
// side-channel attacks that infer key length/prefix from response time.
function requireAdmin(req, res, next) {
  const provided = String(req.headers['x-admin-key'] || req.query.adminKey || '');
  const expected = process.env.ADMIN_KEY || '';

  if (!expected) {
    // ADMIN_KEY not set — refuse all admin access in production
    if (process.env.NODE_ENV === 'production') {
      logger.warn('[bot_admin] ADMIN_KEY not set — request rejected');
      return res.status(503).json({ error: 'Admin access is not configured.' });
    }
    // Development fallback — warn loudly
    logger.warn('[bot_admin] ADMIN_KEY not set — using open access (dev only)');
    return next();
  }

  if (provided.length !== expected.length) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
  } catch (e) {
    logger.warn('[bot_admin/auth]', e?.message);
    return res.status(403).json({ error: 'Forbidden.' });
  }

  next();
}

// ── Explicit column lists — never SELECT * /* intentional: bot processes full record */ on admin routes ────────────────────
const BOT_RUN_COLS    = 'id, run_type, started_at, completed_at, messages_sent, errors, status';
const REVENUE_COLS    = 'source, COUNT(*) as count, SUM(gross_cents) as gross, SUM(net_cents) as net';
const OPT_OUT_COLS    = 'id, phone, email, reason, opted_out_at';
const MSG_COLS        = 'id, message_type, recipient, status, sent_at, error_message';
const LINK_COLS       = 'COUNT(*) as n, SUM(amount_cents) as total';

// ── GET /api/bot/status ───────────────────────────────────────────────────────
router.get('/status', requireAdmin, adminLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const [runs, pendingLinks, recentRevenue] = await Promise.all([
      db.all(
        `SELECT ${BOT_RUN_COLS} FROM bot_runs ORDER BY started_at DESC LIMIT 10`
      ).catch(() => []),
      db.get(
        `SELECT ${LINK_COLS} FROM payment_links WHERE status='pending'`
      ).catch(() => ({ n: 0, total: 0 })),
      db.get(
        `SELECT COUNT(*) as sales, SUM(gross_cents) as gross, SUM(net_cents) as net
         FROM revenue_log WHERE recorded_at >= datetime('now', '-7 days')`
      ).catch(() => ({ sales: 0, gross: 0, net: 0 })),
    ]);

    res.json({
      runs:         runs,
      pending_links: pendingLinks,
      last_7_days:  recentRevenue,
    });
  } catch (e) {
    logger.error('[bot_admin/status]', e.message);
    res.status(500).json({ error: 'Could not load bot status.' });
  }
});

// ── POST /api/bot/run ─────────────────────────────────────────────────────────
// Response is sent immediately — bot runs in background via setImmediate.
router.post('/run', requireAdmin, adminLimiter, async (req, res) => {
  const { dryRun = false, forceRun = false } = req.body || {};
  logger.info(`[bot_admin] Manual bot trigger — dryRun=${dryRun} forceRun=${forceRun}`);
  res.json({
    started:  true,
    dryRun,
    forceRun,
    message: 'Bot running in background. Monitor via GET /api/bot/status.',
  });
  setImmediate(async () => {
    try {
      await runOutboundBot({ dryRun: !!dryRun, forceRun: !!forceRun, runType: 'manual' });
    } catch (err) {
      logger.error('[bot_admin] Manual run error:', err.message);
    }
  });
});

// ── GET /api/bot/revenue ──────────────────────────────────────────────────────
router.get('/revenue', requireAdmin, adminLimiter, async (req, res) => {
  try {
    const db   = await getDb();
    const days = Math.min(Math.max(safeInt(req.query.days || '30', 30), 1), 365);

    const [bySource, daily, allTime] = await Promise.all([
      db.all(
        `SELECT ${REVENUE_COLS}
         FROM revenue_log
         WHERE recorded_at >= datetime('now', '-${days} days')
         GROUP BY source ORDER BY gross DESC`
      ).catch(() => []),
      db.all(
        `SELECT DATE(recorded_at) as date,
                SUM(gross_cents) as gross,
                SUM(net_cents) as net,
                COUNT(*) as transactions
         FROM revenue_log
         WHERE recorded_at >= datetime('now', '-${days} days')
         GROUP BY DATE(recorded_at)
         ORDER BY date DESC
         LIMIT 90`
      ).catch(() => []),
      db.get(
        `SELECT COUNT(*) as total_txns,
                SUM(gross_cents) as total_gross,
                SUM(net_cents) as total_net
         FROM revenue_log`
      ).catch(() => ({ total_txns: 0, total_gross: 0, total_net: 0 })),
    ]);

    res.json({ period_days: days, by_source: bySource, daily, all_time: allTime });
  } catch (e) {
    logger.error('[bot_admin/revenue]', e.message);
    res.status(500).json({ error: 'Could not load revenue.' });
  }
});

// ── GET /api/bot/opt-outs ─────────────────────────────────────────────────────
router.get('/opt-outs', requireAdmin, adminLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    const limit  = Math.min(safeInt(req.query.limit || '100'), 500);
    const offset = safeInt(req.query.offset || '0', 0);

    const [optOuts, total] = await Promise.all([
      db.all(
        `SELECT ${OPT_OUT_COLS} FROM opt_outs ORDER BY opted_out_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      ).catch(() => []),
      db.get('SELECT COUNT(*) as n FROM opt_outs').catch(() => ({ n: 0 })),
    ]);

    res.json({ opt_outs: optOuts, count: optOuts.length, total: total?.n || 0 });
  } catch (e) {
    logger.error('[bot_admin/opt-outs]', e.message);
    res.status(500).json({ error: 'Could not load opt-outs.' });
  }
});

// ── POST /api/bot/opt-out ─────────────────────────────────────────────────────
router.post('/opt-out', requireAdmin, adminLimiter, async (req, res) => {
  try {
    const { phone, email, reason = 'manual' } = req.body || {};
    if (!phone && !email) return err400(res, 'phone or email required.');

    const safePhone  = phone  ? sanitizeStr(String(phone).replace(/\D/g, ''), 20) : null;
    const safeEmail  = email  ? sanitizeStr(String(email).toLowerCase().trim(), 200) : null;
    const safeReason = sanitizeStr(String(reason || 'manual'), 100);

    const db = await getDb();
    await db.run(
      `INSERT OR IGNORE INTO opt_outs (phone, email, reason) VALUES (?,?,?)`,
      [safePhone, safeEmail, safeReason]
    );
    res.json({ success: true, phone: safePhone, email: safeEmail });
  } catch (e) {
    logger.error('[bot_admin/opt-out]', e.message);
    res.status(500).json({ error: 'Could not add opt-out.' });
  }
});

// ── GET /api/bot/messages ─────────────────────────────────────────────────────
router.get('/messages', requireAdmin, adminLimiter, async (req, res) => {
  try {
    const db     = await getDb();
    const limit  = Math.min(safeInt(req.query.limit || '50'), 200);
    const offset = safeInt(req.query.offset || '0', 0);
    const type   = req.query.type   ? sanitizeStr(req.query.type,   30) : null;
    const status = req.query.status ? sanitizeStr(req.query.status, 30) : null;

    const conditions = [];
    const params     = [];
    if (type)   { conditions.push('message_type = ?'); params.push(type); }
    if (status) { conditions.push('status = ?');       params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [msgs, total] = await Promise.all([
      db.all(
        `SELECT ${MSG_COLS} FROM outbound_messages ${where} ORDER BY sent_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ).catch(() => []),
      db.get(
        `SELECT COUNT(*) as n FROM outbound_messages ${where}`,
        params
      ).catch(() => ({ n: 0 })),
    ]);

    res.json({ messages: msgs, count: msgs.length, total: total?.n || 0 });
  } catch (e) {
    logger.error('[bot_admin/messages]', e.message);
    res.status(500).json({ error: 'Could not load messages.' });
  }
});

// ── POST /api/bot/expire-links ────────────────────────────────────────────────
router.post('/expire-links', requireAdmin, adminLimiter, async (req, res) => {
  try {
    const result = await expireOldPaymentLinks();
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('[bot_admin/expire-links]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
