/**
 * chat/history.js — GET + DELETE /history/:sessionId (the caller's own turns only)
 *
 * GET → [{ role, content, text, status: 'complete' | 'stopped', client_msg_id, sourced }]
 * DELETE also removes the chat's recap (AI step 5).
 *
 * GET    /memory/:sessionId — "What the assistant remembers about this chat" (AI step 5,
 *        services/conversationMemory.js): { enabled, remembered, forgotten, recap, covered_turns, updated_at }
 * DELETE /memory/:sessionId — forget it: the recap is removed and nothing is summarised again for this chat
 *   sourced — a saved answer's verified citations (segments + sources, migration 45), so the
 *   bubble renders exactly as it was first shown; null for questions and older answers.
 */
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { msg, resolveLang } from '../../i18n/index.js';
import logger             from '../../utils/logger.js';
import { getHistory } from './_helpers.js';
import { loadMemory, forgetMemory, deleteMemory, publicMemory } from '../../services/conversationMemory.js';

const router = Router();
const validSession = (s) => typeof s === 'string' && s.length > 0 && s.length <= 64;

router.get('/history/:sessionId', authRequired, async (req, res) => {
  if (!validSession(req.params.sessionId)) return res.json([]);
  try {
    const db = await getDb();
    const rows = await getHistory(db, req.params.sessionId, 50, req.user.id);
    res.json(rows.map(({ ai_answer, ai_sent: _sent, ...r }) => ({ ...r, sourced: ai_answer || null })));
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
    await deleteMemory(db, { userId: req.user.id, kind: 'chat', key: req.params.sessionId });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err?.message }, '[chat/clear]');
    res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(resolveLang(req), 'chat.err.clear') });
  }
});

// ── What the assistant remembers about this chat (AI step 5) ────────────────
router.get('/memory/:sessionId', authRequired, async (req, res) => {
  if (!validSession(req.params.sessionId)) return res.json(publicMemory(null));
  try {
    const db = await getDb();
    res.json(publicMemory(await loadMemory(db, { userId: req.user.id, kind: 'chat', key: req.params.sessionId })));
  } catch (err) {
    logger.error({ err: err?.message }, '[chat/memory]');
    res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(resolveLang(req), 'chat.err.memory') });
  }
});

router.delete('/memory/:sessionId', authRequired, async (req, res) => {
  if (!validSession(req.params.sessionId)) return res.json({ ok: true, ...publicMemory({ forgotten: true }) });
  try {
    const db = await getDb();
    // Only a chat of this person's (another id → nothing stored, same answer)
    const own = await db.get('SELECT 1 AS x FROM chat_sessions WHERE session_id = ? AND user_id = ? LIMIT 1', [req.params.sessionId, req.user.id]);
    if (own) await forgetMemory(db, { userId: req.user.id, kind: 'chat', key: req.params.sessionId });
    res.json({ ok: true, ...publicMemory({ forgotten: true }) });
  } catch (err) {
    logger.error({ err: err?.message }, '[chat/memory/forget]');
    res.status(500).json({ error: 'server_error', code: 'server_error', message: msg(resolveLang(req), 'chat.err.memory') });
  }
});

export default router;
