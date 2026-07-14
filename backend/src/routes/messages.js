import { validate, schemas } from '../validation/schemas.js';
/**
 * routes/messages.js — Real-time messaging for attorney-client communication
 *
 * Replaces polling with Supabase Realtime subscriptions.
 * Clients subscribe to postgres_changes on case_messages table —
 * new rows broadcast instantly to all subscribers in that case channel.
 *
 * Architecture:
 *   POST /messages/:caseId   → insert to case_messages → Supabase broadcasts
 *   GET  /messages/:caseId   → fetch history (initial load only)
 *   GET  /messages/unread    → unread count badge
 *   DELETE /messages/:id     → soft-delete a message
 *
 * Frontend subscribes via:
 *   supabase.channel('case:${caseId}')
 *     .on('postgres_changes', { event:'INSERT', table:'case_messages',
 *          filter:`case_id=eq.${caseId}` }, handler)
 *     .subscribe()
 */

import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { getDb }        from '../db/index.js';
import { err400, err403, err404 } from '../utils/routeHelpers.js';
import { sanitizeStr, truncateStr } from '../utils/sanitize.js';
import { auditLog }     from '../utils/auditLog.js';
import logger           from '../utils/logger.js';

const router = Router();

// ── GET /messages/:caseId — initial history load ───────────────────────────
router.get('/:caseId', authRequired, async (req, res) => {
  const { caseId } = req.params;
  const { limit = 50, before } = req.query;
  try {
    const db = await getDb();
    const safeLimit = Math.min(parseInt(limit) || 50, 100);

    // Verify user has access to this case
    const cas = await db.get(
      `SELECT id, user_id FROM cases WHERE id = ? AND user_id = ?`,
      [caseId, req.user.id]
    );
    if (!cas) return err404(res, 'Case not found');

    const rows = await db.all(
      `SELECT m.id, m.sender_id, m.sender_type, m.body, m.sent_at,
              m.read_at, m.deleted_at,
              u.name AS sender_name
         FROM case_messages m
         LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.case_id = ?
          AND m.deleted_at IS NULL
          ${before ? 'AND m.sent_at < ?' : ''}
        ORDER BY m.sent_at DESC
        LIMIT ?`,
      before ? [caseId, before, safeLimit] : [caseId, safeLimit]
    );

    // Mark visible messages as read
    await db.run(
      `UPDATE case_messages SET read_at = datetime('now')
        WHERE case_id = ? AND sender_id != ? AND read_at IS NULL`,
      [caseId, req.user.id]
    ).catch(() => {});

    return res.json({ messages: rows.reverse(), realtime_channel: `case:${caseId}` });
  } catch (e) {
    logger.warn('[messages/list]', e?.message);
    return err400(res, 'Failed to load messages');
  }
});

// ── POST /messages/:caseId — send a message ────────────────────────────────
// Insert triggers Supabase Realtime — all subscribers get it instantly
router.post('/:caseId', authRequired, async (req, res) => {
  const { caseId } = req.params;
  const { body }   = req.body;

  if (!body?.trim()) return err400(res, 'Message body required');
  // message_type: 'chat' (quick message) | 'note' (full legal correspondence)
  const msgType  = req.body.message_type === 'note' ? 'note' : 'chat';
  const maxLen   = msgType === 'note' ? 50_000 : 10_000;
  const safeBody = truncateStr(sanitizeStr(body), maxLen);

  try {
    const db = await getDb();

    // Verify access
    const cas = await db.get(
      `SELECT id FROM cases WHERE id = ? AND user_id = ?`,
      [caseId, req.user.id]
    );
    if (!cas) return err404(res, 'Case not found');

    const result = await db.run(
      `INSERT INTO case_messages
         (case_id, sender_id, sender_type, body, message_type, sent_at)
       VALUES (?, ?, 'user', ?, ?, datetime('now'))`,
      [caseId, req.user.id, safeBody, msgType]
    );

    const msg = await db.get(
      `SELECT m.*, u.name AS sender_name FROM case_messages m
         LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?`,
      [result.lastID]
    );

    await auditLog({ userId: req.user.id, action: 'MESSAGE_SENT',
      entityType: 'case', entityId: caseId,
      meta: { length: safeBody.length }, req });

    // Supabase Realtime automatically broadcasts the INSERT to subscribers
    // No additional push needed — clients subscribed to postgres_changes receive it
    return res.json({ message: msg, channel: `case:${caseId}` });
  } catch (e) {
    logger.warn('[messages/send]', e?.message);
    return err400(res, 'Failed to send message');
  }
});

// ── GET /messages/unread — badge count ────────────────────────────────────
router.get('/unread', authRequired, async (req, res) => {
  try {
    const db  = await getDb();
    const row = await db.get(
      `SELECT COUNT(*) AS count
         FROM case_messages m
         JOIN cases c ON m.case_id = c.id
        WHERE c.user_id = ?
          AND m.sender_id != ?
          AND m.read_at IS NULL
          AND m.deleted_at IS NULL`,
      [req.user.id, req.user.id]
    ).catch(() => ({ count: 0 }));
    return res.json({ count: row?.count || 0 });
  } catch (e) {
    return res.json({ count: 0 });
  }
});

// ── DELETE /messages/:id — soft delete ────────────────────────────────────
router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    const msg = await db.get(
      `SELECT m.*, c.user_id FROM case_messages m
         JOIN cases c ON m.case_id = c.id
        WHERE m.id = ?`,
      [id]
    );
    if (!msg) return err404(res, 'Message not found');
    if (msg.sender_id !== req.user.id && msg.user_id !== req.user.id)
      return err403(res, 'Cannot delete this message');

    await db.run(
      `UPDATE case_messages SET deleted_at = datetime('now') WHERE id = ?`,
      [id]
    );
    return res.json({ deleted: true });
  } catch (e) {
    logger.warn('[messages/delete]', e?.message);
    return err400(res, 'Failed to delete');
  }
});

export default router;
