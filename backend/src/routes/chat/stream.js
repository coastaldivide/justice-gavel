/**
 * chat/stream.js — POST /stream — Server-Sent Events streaming
 */
import { err400, API_URLS, BUSINESS_CONSTANTS } from '../../utils/routeHelpers.js';
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { getDb }          from '../../db/index.js';
import logger             from '../../utils/logger.js';
import rateLimit          from 'express-rate-limit';
import {
  SYSTEM_PROMPT, DEFENDER_SYSTEM_PROMPT, RESPONSE_FOOTER_INSTRUCTION,
} from './_prompts.js';
import {
  getHistory, saveMessage, detectLawyerHandoff, classifyIntent,
  buildCaseNote, buildJurisdictionNote,
} from './_helpers.js';

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 50,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() ?? req.ip,
  message: { error: 'AI rate limit reached — please wait.' },
});

const router = Router();

router.post('/stream', aiLimiter, authRequired, perUserAiLimit, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error:   'AI service not configured.',
      code:    'api_key_missing',
      message: 'ANTHROPIC_API_KEY is not set. Add it to backend/.env to enable the AI assistant.',
    });
  }

  // ── Defender mode flag — hoisted so both rate-limit check and stream use it
  const isDefender = req.body?.mode === 'defender';

  // Single DB handle — shared across rate-limit check and main handler.
  // Declared here with let so both try blocks can reference it; getDb()
  // is called inside the outer try so a DB init failure returns a clean error.
  let db;

  // ── Daily message limit — mirrors ask.js exactly ─────────────────────────
  // Defender mode bypasses the daily limit — they're using professional tools.
  try {
    db = await getDb();
    const sub = await db.get(
      `SELECT id FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing')`,
      [req.user.id]
    ).catch(() => null);
    if (!sub) {
      const todayCount = await db.get(
        `SELECT COUNT(*) as n FROM chat_sessions
         WHERE user_id = ? AND role = 'user'
         AND created_at >= date('now')`,
        [req.user.id]
      ).catch(() => ({ n: 0 }));
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
    logger.warn('[chat/stream] rate limit check failed:', e.message);
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

    if (message.length > 4000) return err400(res, 'Message too long. Please keep messages under 4,000 characters.');
    if (caseContext && typeof caseContext === 'string' && caseContext.length > 8000)
      return err400(res, 'Case context too long. Please summarise your case details.');
    if (!trimmedMsg) return err400(res, 'message is required.');
    if (typeof sessionId !== 'string' || !sessionId.trim()) return err400(res, 'sessionId is required.');

    const history = await getHistory(db, sessionId, 20);

    // Build case context note — delegates to shared buildCaseNote() in _helpers.js
    const caseNote = buildCaseNote(caseContext, mode);

    // Build location context
    let locationContext = null;
    const cityTrimmed = city?.trim() ?? '';
    if (cityTrimmed) locationContext = `City: ${cityTrimmed}`;
    if (Number.isFinite(lat) && Number.isFinite(lng)) locationContext = `${locationContext ? locationContext + ' ' : ''}Coords: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    const systemPrompt = (isDefender ? DEFENDER_SYSTEM_PROMPT : SYSTEM_PROMPT)
      + RESPONSE_FOOTER_INSTRUCTION;

    // Build jurisdiction note — delegates to shared buildJurisdictionNote() in _helpers.js
    const jurisdictionNote = buildJurisdictionNote(user_state, user_state_name);

    // Format location note for prompt injection
    const contextNote = locationContext
      ? `\n\n[User location context: ${locationContext}]` : '';

    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: caseNote + trimmedMsg + contextNote + jurisdictionNote },
    ];

    // ── SSE headers ────────────────────────────────────────────────────────
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
    let fullText = '';

    // ── Anthropic streaming API ─────────────────────────────────────────────
    const response = await fetch(API_URLS.ANTHROPIC, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-20250514',
        temperature: isDefender ? 0.3 : 0.4,  // defenders: precise; consumers: conversational
        max_tokens:  isDefender ? 1500 : 600,
        stream:      true,   // ← enables token streaming
        system:      systemPrompt,
        messages,
      }),
    });

    if (!response.ok || !response.body) {
      const errDetail = response.ok ? 'no body' : `HTTP ${response.status}`;
      logger.error('[chat/stream] Anthropic unavailable:', errDetail);
      send({ type: 'error', message: 'AI service unavailable. Please try again.' });
      return res.end();
    }

    // ── Stream token chunks to client ───────────────────────────────────────
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            const token = parsed.delta.text ?? '';
            fullText += token;
            send({ type: 'token', text: token });
          }
        } catch (e) { logger.warn('[chat/stream] malformed chunk:', e?.message); }
      }
    }

    // ── Save complete message to DB ─────────────────────────────────────────
    await saveMessage(db, sessionId, 'user', trimmedMsg, req.user.id).catch(() => {});
    // Only persist assistant message if tokens were actually received
    if (fullText) await saveMessage(db, sessionId, 'assistant', fullText, req.user.id).catch(() => {});

    // ── Final event with metadata ───────────────────────────────────────────
    send({
      type: 'done',
      full_text: fullText,
      intent: classifyIntent(trimmedMsg),
      suggestLawyerSearch: detectLawyerHandoff(trimmedMsg, fullText),
    });
    res.end();

  } catch (err) {
    logger.error('[chat/stream]', err?.message || String(err));
    try {
      res.write('data: ' + JSON.stringify({ type: 'error', message: 'Stream error.' }) + '\n\n');
      res.end();
    } catch { /* response already ended */ }
  }
});

export default router;
