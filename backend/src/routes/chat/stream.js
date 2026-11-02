/**
 * chat/stream.js — POST /stream — the answer as Server-Sent Events streaming
 * (the preferred path on web; chat/ask.js is the job fallback).
 *
 * Before the stream starts every refusal is plain JSON with its own status
 * (400 / 401 / 402 chat_limit_reached / 429 / 451 / 503 ai_unavailable), with
 * `message` in the request language. After that the response is an event
 * stream of `data: {json}` frames:
 *   { type: 'disclaimer', required: true }
 *   { type: 'segment', segment, sources }         — repeated: one checked part of the answer —
 *                                                   { text, cites: [n] } or { withheld: true }
 *                                                   ("no source found for this part"), plus the
 *                                                   sources first cited by it. Grounded answers
 *                                                   arrive block by block (citations verified
 *                                                   first), others sentence by sentence: nothing
 *                                                   unchecked is ever sent (ai/citations.js).
 *   { type: 'token', text }                       — a replayed answer (already checked), as text
 *   { type: 'done', full_text, sourced, replayed, partial, intent, suggestLawyerSearch, rights_refs }
 *                                                   sourced = the final answer (segments + sources) —
 *                                                   the app renders it in place of the segments
 *   { type: 'error', code, message, discard? }     — ai_unavailable | ai_busy | ai_timeout | ai_failed |
 *                                                   ai_refused | ai_too_large. discard: true (ai_refused) —
 *                                                   the model declined; the app drops any text already shown.
 *
 * The exchange is saved when the answer is complete. A refusal (stop_reason "refusal", also
 * mid-stream) saves nothing — not even on Stop — and tells the app to discard the partial text. When the person presses
 * Stop (or the connection closes) the part they already saw is saved with
 * status 'stopped'. A retry with the same clientMessageId replays a finished
 * answer and replaces a partial one (chat/_helpers.js findReplay).
 */
import { Router }         from 'express';
import { requireAi }      from '../../utils/ai.js';
import { aiStream, aiErrorCode } from '../../services/aiClient.js';
import { requireDisclaimer } from '../../middleware/disclaimer.js';
import { authRequired }   from '../../middleware/auth.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { getDb }          from '../../db/index.js';
import { rightsRefsFor }  from '../../services/rightsContent.js';
import { msg, resolveLang } from '../../i18n/index.js';
import logger             from '../../utils/logger.js';
import { chatBurstLimiter } from './ask.js';
import { streamAnswer, finishAssembled } from '../../services/sourcedAnswers.js';
import { nothingFoundAnswer } from '../../ai/citations.js';
import {
  chatContext, limitBody, readChatBody, prepareChatRequest, findReplay, saveExchange,
  detectLawyerHandoff, classifyIntent, sourcedOf, sentOf, replayOf,
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
    type: 'done', full_text: text, sourced: null, partial: false, replayed: false,
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
    const r = replayOf(replay, lang);
    send({ type: 'token', text: r.reply });
    send(meta(r.reply, { replayed: true, sourced: r.answer }));
    return res.end();
  }

  // 120 s for the whole answer; the upstream call is aborted when the person leaves.
  const upstream = new AbortController();
  let timedOut = false, clientGone = false;
  const stTimer = setTimeout(() => { timedOut = true; upstream.abort(); }, STREAM_TIMEOUT_MS);
  const onClientClose = () => { if (!res.writableEnded) { clientGone = true; upstream.abort(); } };
  res.on('close', onClientClose);

  const route = ctx.defender ? 'chat_stream_defender' : 'chat_stream';
  let fullText = '';          // the raw model text received (metering status only — never sent unchecked)
  let shown = 0;              // checked parts already sent to the app
  let stream = null;
  let refused = false;
  let saved = false;
  let request = null;
  let assembler = null;
  // Stop: only the checked parts the person already saw (the assembler's result so far).
  const save = async (status, sourced = assembler && shown ? sourcedOf(assembler.result(), lang) : null) => {
    if (saved || refused || !sourced) return;
    saved = true;
    await saveExchange(db, { sessionId: body.sessionId, userId, question: body.message, answer: sourced.content, clientMessageId: body.clientMessageId, status,
      aiSent: sentOf(request), aiAnswer: sourced.answer })
      .catch((e) => logger.warn({ err: e.message }, '[chat/stream] could not save the exchange'));
  };
  try {
    // Long conversations: older turns → the stored recap, recent turns sent (AI step 5).
    request = (await prepareChatRequest(db, { body, lang, defender: ctx.defender, userId })).request;
    if (request.mode === 'nothing_found') {
      // A legal question with no source: no model call, the person is told so (never an answer from memory).
      const r = sourcedOf(nothingFoundAnswer(lang, 'chat'), lang);
      send({ type: 'segment', segment: r.answer.segments[0], sources: [] });
      await save('complete', r);
      return send(meta(r.reply, { sourced: r.answer }));
    }
    assembler = streamAnswer(request, (e) => { shown += 1; send({ type: 'segment', ...e }); });
    // Routing, caching, preflight, budget, server-side refusal fallback: services/aiClient.js.
    stream = await aiStream({
      task: request.task, system: request.system, messages: request.messages, maxTokens: request.max_tokens,
      cacheConversation: true, route, userId, signal: upstream.signal,
    });
    const out = await stream.read((token) => {
      fullText += token;
      assembler.onText(token);
    }, { onBlock: assembler.onBlock });
    if (out.refused) {
      // The model declined (before or during the answer) and no fallback answered: nothing is
      // kept — the app removes the text it already showed.
      refused = true;
      fullText = '';
      return send({ type: 'error', code: 'ai_refused', message: msg(lang, 'ai.job.ai_refused'), discard: true });
    }
    if (out.error) {
      // A broken answer is not saved: the app keeps what arrived and offers a retry.
      return fail(out.error);
    }
    if (!fullText) return fail('ai_failed');
    assembler.end();
    const r = sourcedOf(finishAssembled(assembler.result(), { mode: request.mode, lang, kind: 'chat' }), lang);
    await save('complete', r);
    send(meta(r.reply, { sourced: r.answer }));
  } catch (err) {
    if (clientGone) {
      // Stop: keep only the checked parts the person already saw.
      await save('stopped');
      return;
    }
    logger.error({ err: err?.message, timedOut }, '[chat/stream]');
    fail(timedOut ? 'ai_timeout' : aiErrorCode(err));
  } finally {
    clearTimeout(stTimer);
    res.off('close', onClientClose);
    if (stream) {
      stream.record(fullText ? (clientGone ? 'stopped' : 'completed') : 'failed')
        .catch((e) => logger.warn({ err: e.message }, '[chat/stream] usage metering failed'));
    }
    if (!res.writableEnded) res.end();
  }
});

export default router;
