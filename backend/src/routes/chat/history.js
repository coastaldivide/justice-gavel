/**
 * chat/history.js — GET + DELETE /history/:sessionId
 */
import { err400, BUSINESS_CONSTANTS, err401, err403, err404, err409,
         err422, err500, err502, safeInt } from '../../utils/routeHelpers.js';
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import { enqueue }        from '../../services/aiQueue.js';
import logger             from '../../utils/logger.js';
import rateLimit          from 'express-rate-limit';
import {
  SYSTEM_PROMPT, DEFENDER_SYSTEM_PROMPT, RESPONSE_FOOTER_INSTRUCTION,
} from './_prompts.js';
import {
  getHistory, saveMessage, detectLawyerHandoff, callClaude, classifyIntent,
} from './_helpers.js';

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 50,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
  message: { error: 'AI rate limit reached — please wait.' },
});

const router = Router();


router.get('/history/:sessionId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const history = await getHistory(db, req.params.sessionId, 50);
    res.json(history);
  } catch (err) {
    logger.error('[chat/history]', err);
    res.status(500).json({ error: 'Could not load history' });
  }
});

router.delete('/history/:sessionId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM chat_sessions WHERE session_id = ?', [req.params.sessionId]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[chat/clear]', err);
    res.status(500).json({ error: 'Could not clear history' });
  }
});

// ── intent classifier ─────────────────────────────────────────────────────────

export default router;
