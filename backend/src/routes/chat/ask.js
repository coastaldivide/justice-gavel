/**
 * chat/ask.js — POST /ask — main AI chat request/response fallback: the answer
 * is a job (poll GET /api/jobs/:id).
 *
 * Used when the app cannot read a stream (native, old browsers, a proxy that
 * buffers SSE). Same rules as /stream: free accounts get
 * FREE_CHAT_MESSAGES_PER_DAY questions per local day, defender mode only for
 * attorneys, answers in the request language, and a retry with the same
 * clientMessageId returns the answer already given instead of asking again.
 */
import { Router }         from 'express';
import rateLimit          from 'express-rate-limit';
import { requireAi }      from '../../utils/ai.js';
import { requireDisclaimer } from '../../middleware/disclaimer.js';
import { authRequired }   from '../../middleware/auth.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { getDb }          from '../../db/index.js';
import { enqueueAIJob as enqueue } from '../../services/aiQueue.js';
import { rightsRefsFor }  from '../../services/rightsContent.js';
import { msg, resolveLang } from '../../i18n/index.js';
import logger             from '../../utils/logger.js';
import {
  chatContext, limitBody, readChatBody, prepareChatRequest, findReplay, saveExchange,
  detectLawyerHandoff, callClaude, classifyIntent, sourcedReply, sentOf, replayOf,
} from './_helpers.js';

export const chatBurstLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 50,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() ?? req.ip,
  validate: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limited', code: 'rate_limited', message: msg(resolveLang(req), 'chat.err.rate') }),
});

const router = Router();

router.post('/ask', chatBurstLimiter, authRequired, requireDisclaimer, requireAi, perUserAiLimit, async (req, res) => {
  const lang = resolveLang(req);
  try {
    const db = await getDb();
    const body = readChatBody(req, lang);
    if (body.error) return res.status(400).json(body.error);
    const ctx = await chatContext(db, req);
    const userId = req.user.id;

    const replay = await findReplay(db, userId, body.sessionId, body.clientMessageId);
    // reply: the answer as plain text ([n] markers + a source list) for text-only callers;
    // sourced: the verified answer (segments + citations) the chat bubble renders.
    const answerOf = (reply, replayed, sourced) => ({
      role: 'assistant', reply, replayed, sourced,
      suggestLawyerSearch: detectLawyerHandoff(body.message, reply),
      intent: classifyIntent(body.message),
      rights_refs: ctx.defender ? [] : rightsRefsFor(body.message, reply, lang),
    });
    if (replay == null && !ctx.unlimited && ctx.limited) return res.status(402).json(limitBody(ctx));

    const jobId = await enqueue('chat', async () => {
      if (replay != null) { const r = replayOf(replay, lang); return answerOf(r.reply, true, r.answer); }
      // Long conversations: older turns → the stored recap, recent turns sent (AI step 5).
      const { request } = await prepareChatRequest(db, { body, lang, defender: ctx.defender, userId });
      // nothing_found: a legal question with no source → no model call (services/sourcedAnswers.js)
      const out = request.mode === 'nothing_found' ? null : await callClaude({ ...request, defender: ctx.defender, userId });
      const r = sourcedReply(request, out ?? {}, lang);
      await saveExchange(db, { sessionId: body.sessionId, userId, question: body.message, answer: r.content, clientMessageId: body.clientMessageId,
        aiSent: sentOf(request), aiAnswer: r.answer });
      return answerOf(r.reply, false, r.answer);
    }, userId);

    res.json({ jobId, status: 'pending', async: true, not_legal_advice: true });
  } catch (err) {
    logger.error({ err: err?.message }, '[chat/ask]');
    res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(lang, 'chat.err.server') });
  }
});

export default router;
