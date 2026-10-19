import { requireAi, CLAUDE_MODEL } from '../../utils/ai.js';
import { safeJson, err400, BUSINESS_CONSTANTS } from '../../utils/routeHelpers.js';
import { anthropicFetch, streamUsageMeter } from '../../services/aiClient.js';
import { requireDisclaimer } from '../../middleware/disclaimer.js';
/**
 * chat/stream.js — POST /stream — Server-Sent Events streaming
 */
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { getDb }          from '../../db/index.js';
import logger             from '../../utils/logger.js';
import rateLimit          from 'express-rate-limit';
import { SYSTEM_PROMPT, DEFENDER_SYSTEM_PROMPT, RESPONSE_FOOTER_INSTRUCTION } from './_prompts.js';
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

router.post('/stream', aiLimiter, authRequired, requireDisclaimer, requireAi, perUserAiLimit, async (req, res) => {
  if (!(process.env.ANTHROPIC_API_KEY ?? '')) {
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
         AND created_at >= CURRENT_DATE`,
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

    // Only this user's own turns — a sessionId never pulls another account's history.
    const history = await getHistory(db, sessionId, 20, req.user.id);

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

    // ── SSE headers — set and flushed BEFORE the first frame ──────────────
    // Every validation / limit / disclaimer response above is plain JSON with
    // its own status; from here on the response is an event stream and errors
    // are reported as `error` frames (headers are already on the wire).
    res.status(200);
    res.setHeader('Content-Type',  'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (obj) => {
      if (res.writableEnded || res.destroyed) return;
      res.write('data: ' + JSON.stringify(obj) + '\n\n');
    };
    send({ type: 'disclaimer', required: true });

    // 120-second stream timeout; also abort the upstream call when the client goes away.
    const upstream = new AbortController();
    let timedOut = false;
    const stTimer = setTimeout(() => { timedOut = true; upstream.abort(); }, 120_000);
    const onClientClose = () => { if (!res.writableEnded) upstream.abort(); };
    res.on('close', onClientClose);

    let fullText = '';
    let metered = null;
    try {
      // Budget check, connect timeout and transient retries: aiClient. The
      // stream itself is bounded by the 120 s timer above; usage is metered
      // from the stream's message_start / message_delta events.
      const response = await anthropicFetch({
        signal: upstream.signal,
        body: JSON.stringify({
          model:       CLAUDE_MODEL,
          temperature: isDefender ? 0.3 : 0.4,  // defenders: precise; consumers: conversational
          max_tokens:  isDefender ? 1500 : 600,
          stream:      true,   // ← enables token streaming
          system:      systemPrompt,
          messages,
        }),
      }, { route: isDefender ? 'chat_stream_defender' : 'chat_stream', userId: req.user.id, stream: true });

      if (!response.ok || !response.body) {
        const errDetail = response.ok ? 'no body' : `HTTP ${response.status}`;
        logger.error('[chat/stream] Anthropic unavailable:', errDetail);
        send({ type: 'error', message: 'AI service unavailable. Please try again.' });
        return;
      }

      // ── Stream token chunks to client ─────────────────────────────────────
      // SSE lines can be split across network reads: keep the incomplete tail.
      const meter   = streamUsageMeter();
      metered = meter;
      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let upstreamError = null;
      const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        const parsed = safeJson(data);
        if (!parsed || typeof parsed !== 'object') return;
        meter.onEvent(parsed);
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          const token = parsed.delta.text ?? '';
          fullText += token;
          send({ type: 'token', text: token });
        } else if (parsed.type === 'error') {
          upstreamError = parsed.error?.message || 'upstream error';
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(handleLine);
      }
      pending += decoder.decode();
      if (pending) handleLine(pending);

      if (upstreamError) {
        logger.error('[chat/stream] Anthropic stream error:', upstreamError);
        if (!fullText) { send({ type: 'error', message: 'AI service unavailable. Please try again.' }); return; }
      }

      // ── Save complete exchange to DB ─────────────────────────────────────
      // Only persist when tokens were actually received, so a failed stream
      // never leaves an orphan user turn (the client may retry via /chat/ask).
      if (fullText) {
        await saveMessage(db, sessionId, 'user', trimmedMsg, req.user.id).catch(() => {});
        await saveMessage(db, sessionId, 'assistant', fullText, req.user.id).catch(() => {});
      }

      // ── Final event with metadata ───────────────────────────────────────
      send({
        type: 'done',
        full_text: fullText,
        partial: !!upstreamError,
        intent: classifyIntent(trimmedMsg),
        suggestLawyerSearch: detectLawyerHandoff(trimmedMsg, fullText),
      });
    } catch (err) {
      if (upstream.signal.aborted && !timedOut) return; // client disconnected — nothing to send
      logger.error('[chat/stream]', err?.message || String(err));
      send({ type: 'error', message: timedOut ? 'Response timed out. Please try again.' : 'Stream error.' });
    } finally {
      clearTimeout(stTimer);
      res.off('close', onClientClose);
      if (metered) {
        metered.record({ route: isDefender ? 'chat_stream_defender' : 'chat_stream', userId: req.user.id, status: fullText ? 'completed' : 'failed' })
          .catch((e) => logger.warn({ err: e.message }, '[chat/stream] usage metering failed'));
      }
      if (!res.writableEnded) res.end();
    }

  } catch (err) {
    // Only reached before the stream started (headers not yet sent).
    logger.error('[chat/stream]', err?.message || String(err));
    if (!res.headersSent) return res.status(500).json({ error: 'Stream error.' });
    if (!res.writableEnded) res.end();
  }
});

export default router;
