/**
 * chat/history.js — GET + DELETE /history/:sessionId (the caller's own turns only)
 *
 * GET → [{ role, content, text, status: 'complete' | 'stopped', client_msg_id }]
 */
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { msg, resolveLang } from '../../i18n/index.js';
import logger             from '../../utils/logger.js';
import { getHistory } from './_helpers.js';

const router = Router();
const validSession = (s) => typeof s === 'string' && s.length > 0 && s.length <= 64;

router.get('/history/:sessionId', authRequired, async (req, res) => {
  if (!validSession(req.params.sessionId)) return res.json([]);
  try {
    const db = await getDb();
    res.json(await getHistory(db, req.params.sessionId, 50, req.user.id));
  } catch (err) {
    logger.error({ err: err?.message }, '[chat/history]');
    res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(resolveLang(req), 'chat.err.history') });
  }
});

router.delete('/history/:sessionId', authRequired, async (req, res) => {
  if (!validSession(req.params.sessionId)) return res.json({ ok: true });
  try {
    const db = await getDb();
    await db.run('DELETE FROM chat_sessions WHERE session_id = ? AND user_id = ?', [req.params.sessionId, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err?.message }, '[chat/clear]');
    res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(resolveLang(req), 'chat.err.clear') });
  }
});

export default router;
