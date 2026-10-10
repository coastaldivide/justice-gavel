/**
 * chat/history.js — GET + DELETE /history/:sessionId
 */
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import logger             from '../../utils/logger.js';
import { getHistory } from './_helpers.js';


const router = Router();


router.get('/history/:sessionId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const history = await getHistory(db, req.params.sessionId, 50, req.user.id);
    res.json(history);
  } catch (err) {
    logger.error('[chat/history]', err);
    res.status(500).json({ error: 'Could not load history' });
  }
});

router.delete('/history/:sessionId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM chat_sessions WHERE session_id = ? AND user_id = ?', [req.params.sessionId, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[chat/clear]', err);
    res.status(500).json({ error: 'Could not clear history' });
  }
});

// ── intent classifier ─────────────────────────────────────────────────────────

export default router;
