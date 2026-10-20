/**
 * chat/stream.js — POST /stream — the answer as Server-Sent Events streaming
 * (the preferred path on web; chat/ask.js is the job fallback).
 *
 * Before the stream starts every refusal is plain JSON with its own status
 * (400 / 401 / 402 chat_limit_reached / 429 / 451 / 503 ai_unavailable), with
 * `message` in the request language. After that the response is an event
 * stream of `data: {json}` frames:
 *   { type: 'disclaimer', required: true }
 *   { type: 'token', text }                       — repeated
 *   { type: 'done', full_text, replayed, partial, intent, suggestLawyerSearch, rights_refs }
 *   { type: 'error', code, message }               — ai_unavailable | ai_busy | ai_timeout | ai_failed
 *
 * The exchange is saved when the answer is complete. When the person presses
 * Stop (or the connection closes) the part they already saw is saved with
 * status 'stopped'. A retry with the same clientMessageId replays a finished
 * answer and replaces a partial one (chat/_helpers.js findReplay).
 */
import { Router }         from 'express';
import { requireAi, CLAUDE_MODEL } from '../../utils/ai.js';
import { safeJson }       from '../../utils/routeHelpers.js';
import { anthropicFetch, streamUsageMeter, aiHttpError, aiErrorCode } from '../../services/aiClient.js';
import { requireDisclaimer } from '../../middleware/disclaimer.js';
import { authRequired }   from '../../middleware/auth.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { getDb }          from '../../db/index.js';
import { rightsRefsFor }  from '../../services/rightsContent.js';
import { msg, resolveLang } from '../../i18n/index.js';
import logger             from '../../utils/logger.js';
import { chatBurstLimiter } from './ask.js';
import {
  chatContext, limitBody, readChatBody, buildChatRequest, findReplay, saveExchange,
  getHistory, detectLawyerHandoff, classifyIntent,
} from './_helpers.js';

export const STREAM_TIMEOUT_MS = 120_000;

const router = Router();

router.post('/stream', chatBurstLimiter, authRequired, requireDisclaimer, requireAi, perUserAiLimit, async (req, res) => {
  const lang = resolveLang(req);
  let db, body, ctx;
  try {
    db = await getDb();
    body = readChatBody(req, lang);
    if (body.error) return res.status(400).json(body.error);
    ctx = await chatContext(db, req);
  } catch (err) {
    logger.error({ err: err?.message }, '[chat/stream] before stream');
    return res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(lang, 'chat.err.server') });
  }
  const userId = req.user.id;
  const meta = (text, extra = {}) => ({
    type: 'done', full_text: text, partial: false, replayed: false,
    intent: classifyIntent(body.message),
    suggestLawyerSearch: detectLawyerHandoff(body.message, text),
    rights_refs: ctx.defender ? [] : rightsRefsFor(body.message, text, lang),
    ...extra,
  });

  let replay = null;
  try {
    replay = await findReplay(db, userId, body.sessionId, body.clientMessageId);
  } catch (err) {
    logger.warn({ err: err?.message }, '[chat/stream] replay lookup failed');
  }
  if (replay == null && !ctx.unlimited && ctx.limited) return res.status(402).json(limitBody(ctx));

  // ── SSE headers — flushed before the first frame ─────────────────────────
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
  const fail = (code) => send({ type: 'error', code, message: msg(lang, `ai.job.${code}`) });
  send({ type: 'disclaimer', required: true });

  if (replay != null) {
    send({ type: 'token', text: replay });
    send(meta(replay, { replayed: true }));
    return res.end();
  }

  // 120 s for the whole answer; the upstream call is aborted when the person leaves.
  const upstream = new AbortController();
  let timedOut = false, clientGone = false;
  const stTimer = setTimeout(() => { timedOut = true; upstream.abort(); }, STREAM_TIMEOUT_MS);
  const onClientClose = () => { if (!res.writableEnded) { clientGone = true; upstream.abort(); } };
  res.on('close', onClientClose);

  const route = ctx.defender ? 'chat_stream_defender' : 'chat_stream';
  let fullText = '';
  let meter = null;
  let saved = false;
  const save = async (status) => {
    if (saved || !fullText) return;
    saved = true;
    await saveExchange(db, { sessionId: body.sessionId, userId, question: body.message, answer: fullText, clientMessageId: body.clientMessageId, status })
      .catch((e) => logger.warn({ err: e.message }, '[chat/stream] could not save the exchange'));
  };
  try {
    const history = await getHistory(db, body.sessionId, 20, userId);
    const request = buildChatRequest({ history, body, lang, defender: ctx.defender });
    const response = await anthropicFetch({
      signal: upstream.signal,
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: request.max_tokens, stream: true, system: request.system, messages: request.messages }),
    }, { route, userId, stream: true });

    if (!response.ok || !response.body) {
      const e = response.ok ? Object.assign(new Error('no body'), { code: 'ai_failed' }) : await aiHttpError(response, route);
      return fail(e.code);
    }

    // SSE lines can be split across network reads: keep the incomplete tail.
    meter = streamUsageMeter();
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
        upstreamError = parsed.error?.type === 'overloaded_error' || parsed.error?.type === 'rate_limit_error' ? 'ai_busy' : 'ai_failed';
        logger.warn({ route, error: parsed.error }, '[chat/stream] upstream stream error');
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
      // A broken answer is not saved: the app keeps what arrived and offers a retry.
      return fail(upstreamError);
    }
    if (!fullText) return fail('ai_failed');
    await save('complete');
    send(meta(fullText));
  } catch (err) {
    if (clientGone) { await save('stopped'); return; }
    logger.error({ err: err?.message, timedOut }, '[chat/stream]');
    fail(timedOut ? 'ai_timeout' : aiErrorCode(err));
  } finally {
    clearTimeout(stTimer);
    res.off('close', onClientClose);
    if (meter) {
      meter.record({ route, userId, status: fullText ? 'completed' : 'failed' })
        .catch((e) => logger.warn({ err: e.message }, '[chat/stream] usage metering failed'));
    }
    if (!res.writableEnded) res.end();
  }
});

export default router;
