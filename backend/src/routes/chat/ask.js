import { withApiRetry } from '../../utils/retry.js';
import { requireDisclaimer } from '../../middleware/disclaimer.js';
import { withBreaker } from '../../middleware/circuitBreaker.js';
/**
 * chat/ask.js — POST /ask — main AI chat
 */
import { err400, BUSINESS_CONSTANTS } from '../../utils/routeHelpers.js';
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { enqueue }        from '../../services/aiQueue.js';
import logger             from '../../utils/logger.js';
import rateLimit          from 'express-rate-limit';
import {
  getHistory, saveMessage, detectLawyerHandoff, callClaude, classifyIntent,
} from './_helpers.js';

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 50,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() ?? req.ip,
  message: { error: 'AI rate limit reached — please wait.' },
});

const router = Router();

router.post('/ask', aiLimiter, authRequired, requireDisclaimer, perUserAiLimit, async (req, res) => {
  // Fail fast if API key is missing — avoids DB queries for a non-starter request
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error:   'AI service not configured.',
      code:    'api_key_missing',
      message: 'ANTHROPIC_API_KEY is not set. Add it to backend/.env to enable the AI assistant.',
    });
  }

  // Compute isDefender early — rate limit check runs before full body destructuring
  const isDefender = req.body?.mode === 'defender';

  // Single DB handle — shared across rate-limit check and main handler.
  // Declared here with let so both try blocks can reference it; getDb()
  // is called inside the outer try so a DB init failure returns 500 cleanly.
  let db;
  try {
    db = await getDb();
    // Check if user has active subscription
    const sub = await db.get(
      `SELECT id FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing')`,
      [req.user.id]
    ).catch(() => null);

    if (!sub) {
      // Count today's messages for this user
      // Use indexed user_id column — avoids full-table LIKE scan on every request
      const todayCount = await db.get(
        `SELECT COUNT(*) as n FROM chat_sessions
         WHERE user_id = ? AND role = 'user'
         AND created_at >= date('now')`,
        [req.user.id]
      ).catch(() => ({ n: 0 }));

      // Defender mode bypasses the daily limit — they're using professional tools.
      if (!isDefender && (todayCount?.n ?? 0) >= BUSINESS_CONSTANTS.AI_MESSAGES_PER_DAY_FREE) {
        const d = new Date();
        const resetsAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
        return res.status(402).json({
          error: 'Daily limit reached',
          code: 'chat_limit_reached',
          message: 'Free accounts include 3 AI messages per day. Upgrade for unlimited access.',
          upgrade_url: '/subscribe',
          limit: BUSINESS_CONSTANTS.AI_MESSAGES_PER_DAY_FREE,
          used: todayCount?.n ?? 0,
          remaining: 0,
          resets_at: resetsAt,
        });
      }
    }
  } catch (e) {
    // Limit check failed — allow through rather than blocking the request
    logger.warn('[chat/ask] rate limit check failed:', e.message);
  }

  try {
    // Ensure db is ready — may be undefined if rate-limit check threw before getDb() resolved
    if (!db) db = await getDb();

    const {
      message: _msg = '', sessionId, city, lat, lng,
      mode = 'consumer', caseContext = null,
      user_state = null, user_state_name = null,
    } = req.body || {};
    const message    = String(_msg);
    const trimmedMsg = message.trim();

    // ── Input length limits — prevent abuse and runaway API costs ──────────────
    // AI input: 4,000 chars ≈ 1,000 tokens — sufficient for any legitimate question
    // Excessive input costs ~$0.01–0.05 per call at current pricing
    if (message.length > 4000) return err400(res, 'Message too long. Please keep messages under 4,000 characters.');
    if (caseContext && typeof caseContext === 'string' && caseContext.length > 8000) return err400(res, 'Case context too long. Please summarise your case details.');

    if (!trimmedMsg) return err400(res, 'message is required.');
    if (typeof sessionId !== 'string' || !sessionId.trim()) return err400(res, 'sessionId is required.');

    let locationContext = null;
    const cityTrimmed = city?.trim() ?? '';
    if (cityTrimmed) locationContext = `City: ${cityTrimmed}`;
    if (Number.isFinite(lat) && Number.isFinite(lng)) locationContext = `${locationContext ? locationContext + ' ' : ''}Coords: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    const history = await getHistory(db, sessionId, 20);

    // Async: enqueue the Claude call — event loop stays free for other requests
    const jobId = await enqueue('chat', async () => {
      const r = await callClaude({
        history, newMessage: trimmedMsg, locationContext,
        mode, caseContext, user_state, user_state_name,
      });
      await saveMessage(db, sessionId, 'user',      trimmedMsg, req.user.id).catch(() => {});
      await saveMessage(db, sessionId, 'assistant', r,          req.user.id).catch(() => {});
      return {
        role: 'assistant', reply: r,
        suggestLawyerSearch: detectLawyerHandoff(trimmedMsg, r),
        intent: classifyIntent(trimmedMsg),
      };
    });

    res.json({
      jobId,
      status:          'pending',
      async:           true,
      not_legal_advice: true,
      disclaimer:      'AI responses are general information only — not legal advice.',
      message:         `Request queued. Poll /api/jobs/${jobId} for the response.`,
    });
  } catch (err) {
    logger.error('[chat/ask]', err);
    res.status(500).json({ error: 'Chat service error. Please try again.' });
  }
});

export default router;
