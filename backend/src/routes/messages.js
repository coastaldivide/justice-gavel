/**
 * messages.js — Encrypted defender-client messaging
 *
 * Message bodies are AES-256-GCM encrypted at rest.
 * Key: ENCRYPTION_KEY env var (32-byte hex) or derived from JWT_SECRET.
 *
 * Auth model:
 *   - GET /:caseId    — only case owner OR assigned defender
 *   - POST /:caseId   — only case owner OR assigned defender
 *   - Role is server-determined from case ownership, NOT client-provided
 *
 * Routes:
 *   GET  /api/messages/:caseId       — load thread (decrypted for auth'd user)
 *   POST /api/messages/:caseId       — send encrypted message
 *   POST /api/messages/:caseId/read  — mark read
 *   GET  /api/messages/unread/count  — badge count
 */

import { err400, truncateStr, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import express          from 'express';
import { getDb }        from '../db/index.js';
import { authRequired } from './auth.js';
import { encrypt, decrypt } from '../services/encryption.js';

const router = express.Router();

// Tables defined in db/index.js Year 1 block — no per-request DDL needed.

// ── Determine if user has access to a case ───────────────────────────────────
// Returns: { caseRow, role: 'owner'|'defender' } or null if no access
async function getCaseAccess(db, caseId, userId) {
  // Case owner (defendant/client)
  const asOwner = await db.get(
    `SELECT id, title, user_id FROM cases WHERE id=? AND user_id=?`,
    [caseId, userId]
  );
  if (asOwner) return { caseRow: asOwner, role: 'client' };

  // Assigned defender — check case_assignments table if it exists
  const asDefender = await db.get(
    `SELECT c.id, c.title, c.user_id FROM cases c
     LEFT JOIN case_assignments ca ON ca.case_id = c.id
     WHERE c.id=? AND ca.defender_id=?`,
    [caseId, userId]
  ).catch(() => null);
  if (asDefender) return { caseRow: asDefender, role: 'defender' };

  // Fallback: allow defender who created the case_messages (backward compat)
  const hasSentBefore = await db.get(
    `SELECT id FROM case_messages WHERE case_id=? AND sender_id=? LIMIT 1`,
    [caseId, userId]
  );
  if (hasSentBefore) {
    const caseRow = await db.get(`SELECT id, title, user_id FROM cases WHERE id=?`, [caseId]);
    return caseRow ? { caseRow, role: 'defender' } : null;
  }

  // Family member with explicit access grant
  const asFamily = await db.get(
    `SELECT c.id, c.title, c.user_id FROM cases c
     JOIN case_family_access cfa ON cfa.case_id = c.id
     WHERE c.id=? AND cfa.user_id=? AND cfa.accepted=1`,
    [caseId, userId]
  ).catch(() => null);
  if (asFamily) return { caseRow: asFamily, role: 'family' };

  return null;
}

// ── GET /api/messages/:caseId ─────────────────────────────────────────────────
router.get('/:caseId', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const caseId = Number(req.params.caseId);
    const access = await getCaseAccess(db, caseId, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied' });

    const messages = await db.all(
      `SELECT cm.*, u.display_name as sender_name
       FROM case_messages cm
       LEFT JOIN users u ON u.id = cm.sender_id
       WHERE cm.case_id=? ORDER BY cm.created_at ASC`,
      [caseId]
    );

    // Decrypt bodies before sending to client
    const decrypted = messages.map(m => ({ ...m, body: decrypt(m.body) }));

    // Mark messages from other party as read
    await db.run(
      `UPDATE case_messages SET read_at=datetime('now')
       WHERE case_id=? AND sender_id!==? AND read_at IS NULL`,
      [caseId, req.user.id]
    );

    res.json({ case: access.caseRow, messages: decrypted, role: access.role });
  } catch (e) {
    logger.error('[messages GET]', e.message);
    res.status(500).json({ error: 'Could not load messages' });
  }
});

// ── POST /api/messages/:caseId ────────────────────────────────────────────────
router.post('/:caseId', authRequired, messagesLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const caseId = Number(req.params.caseId);
    const access = await getCaseAccess(db, caseId, req.user.id);
    if (!access) return res.status(403).json({ error: 'Access denied' });

    const { body, lang = 'en' } = req.body;
    if (!body?.trim())              return err400(res, 'Message body is required');
    if (body.trim().length > 2000)  return err400(res, 'Message too long (max 2000 chars)');

    // Role is determined server-side — never trusted from client
    const role = access.role;

    // Encrypt body before storage
    const encryptedBody = encrypt(body.trim());

    const r = await db.run(
      `INSERT INTO case_messages (case_id, sender_id, sender_role, body, lang)
       VALUES (?,?,?,?,?)`,
      [caseId, req.user.id, role, encryptedBody, lang]
    );

    const msg = await db.get(`SELECT id, case_id, sender_id, sender_role, lang, read_at, created_at FROM case_messages WHERE id=?`, [r.lastID]);
    const msgDecrypted = { ...msg, body: body.trim() }; // return plaintext to sender

    // Push notification to other party (best-effort)
    try {
      const otherParty = await db.get(
        `SELECT u.push_token FROM cases c
         JOIN users u ON u.id = c.user_id
         WHERE c.id=? AND c.user_id !== ?`,
        [caseId, req.user.id]
      );
      if (otherParty?.push_token) {
        const preview = body.trim().slice(0, 60) + (body.trim().length > 60 ? '…' : '');
        const expo = await getExpo();
        await expo.sendPushNotificationsAsync([{
          to:    otherParty.push_token,
          title: `New message — ${access.caseRow.title}`,
          body:  preview,
          data:  { screen: 'Messages', caseId },
        }]);
      }
    } catch { /* push is best-effort */ }

    res.json({ ok: true, message: msgDecrypted });
  } catch (e) {
    logger.error('[messages POST]', e.message);
    res.status(500).json({ error: 'Could not send message' });
  }
});

// ── POST /api/messages/:caseId/read ──────────────────────────────────────────
router.post('/:caseId/read', authRequired, messagesLimiter, async (req, res) => {
  try {
    const db = await getDb();
    const caseId = Number(req.params.caseId);
    await db.run(
      `UPDATE case_messages SET read_at=datetime('now')
       WHERE case_id=? AND sender_id!==? AND read_at IS NULL`,
      [caseId, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    logger.warn('[messages/read]', e.message);
    res.status(500).json({ error: 'Could not mark read' });
  }
});

// ── GET /api/messages/unread/count ────────────────────────────────────────────
router.get('/unread/count', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const row = await db.get(
      `SELECT COUNT(*) as count FROM case_messages
       WHERE sender_id !== ? AND read_at IS NULL
       AND case_id IN (SELECT id FROM cases WHERE user_id=?)`,
      [req.user.id, req.user.id]
    ).catch(() => ({ count: 0 }));
    res.json({ count: row?.count || 0 });
  } catch (e) {
    logger.warn('[messages/unread]', e?.message);
    res.json({ count: 0 });
  }
});

// ── File attachment upload ─────────────────────────────────────────────────
// POST /api/messages/attachment
// Accepts: multipart/form-data { file, conversation_id, recipient_id }
// Returns: { attachment_url, filename, size, mime_type }
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import logger from '../utils/logger.js';

const messagesLimiter = makeUserLimiter({ windowMs: 60000, max: 30, message: 'Message rate limit reached. Please slow down.' });
// Lazy Expo push client — initialized on first use, consistent with cases.js pattern
let _expo = null;
async function getExpo() {
  if (_expo) return _expo;
  const { Expo } = await import('expo-server-sdk');
  _expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  return _expo;
}


const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads/messages';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg','image/png','image/heic','image/heif','image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const hash = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}-${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

router.post('/attachment', authRequired, messagesLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return err400(res, 'No file uploaded or file type not allowed.');
  }
  const { conversation_id, recipient_id } = req.body || {};
  if (!conversation_id && !recipient_id) {
    fs.unlink(req.file.path, () => {});
    return err400(res, 'conversation_id or recipient_id required.');
  }
  try {
    const db = await getDb();
    const attachmentUrl = `/uploads/messages/${req.file.filename}`;
    // Store attachment record and create a message with it
    const result = await db.run(
      `INSERT INTO messages (sender_id, recipient_id, conversation_id,
        body, attachment_url, attachment_name, attachment_size, attachment_mime,
        created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        req.user.id,
        recipient_id || null,
        conversation_id || null,
        req.body.body || '',
        attachmentUrl,
        req.file.originalname,
        req.file.size,
        req.file.mimetype,
      ]
    );

    // ── Attorney response time tracking ─────────────────────────────────────
    // If this message is from an attorney (lawyer/defender role), update their
    // rolling average response time based on how long since the lead was opened.
    try {
      const isAtty = req.user?.type === 'lawyer' || req.user?.type === 'defender'
                  || req.user?.user_type === 'lawyer';
      if (isAtty) {
        // Find the original lead/case created_at
        const lead = await db.get(
          `SELECT created_at FROM cases WHERE id=? LIMIT 1`,
          [safeInt(req.params.caseId)]
        );
        if (lead?.created_at) {
          const leadTs   = new Date(lead.created_at).getTime();
          const replyTs  = Date.now();
          const elapsedH = (replyTs - leadTs) / (1000 * 60 * 60);
          const hrs      = parseFloat(elapsedH.toFixed(2));

          // Rolling average: new_avg = (old_avg * n + hrs) / (n + 1)
          // Simplified: exponential moving average (α = 0.3) for recency bias
          await db.run(
            `UPDATE lawyers
             SET avg_response_hrs = CASE
               WHEN avg_response_hrs IS NULL THEN ?
               ELSE ROUND(avg_response_hrs * 0.7 + ? * 0.3, 2)
             END,
             updated_at = datetime('now')
             WHERE user_id = ?`,
            [hrs, hrs, req.user.id]
          ).catch(() => {});  // non-blocking — don't fail message send if this errors
        }
      }
    } catch (e) { logger.warn('[messages/response-time]', e?.message); }
    // ── end response time tracking ──────────────────────────────────────────

    res.json({
      ok: true,
      message_id: result.lastID,
      attachment_url: attachmentUrl,
      filename: req.file.originalname,
      size: req.file.size,
      mime_type: req.file.mimetype,
    });
  } catch (err) { logger.error('[messages/attachment]', err?.message);
    // Clean up uploaded file if DB insert fails
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Could not save attachment. Please try again.' });
  }
});

// Multer error handler
router.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return err400(res, 'File too large — maximum 10MB.');
  }
  if (err.message?.includes('File type not allowed')) {
    return err400(res, 'Could not process message. Please try again.');
  }
  res.status(500).json({ error: 'Upload error. Please try again.' });
});

// POST /api/messages/bulk — send initial inquiry to multiple attorneys
// Body: { lawyer_ids: number[], message: string, case_id?: number }
// Returns: { sent: number, results: { lawyer_id, case_id, error? }[] }
router.post('/bulk', authRequired, messagesLimiter, async (req, res) => {
  try {
    const { lawyer_ids = [], message = '', case_id } = req.body;
    const safeMessage = message ? truncateStr(sanitizeStr(String(message), 2000), 2000) : '';
    if (!safeMessage.trim())          return err400(res, 'Message text required.');
    if (!Array.isArray(lawyer_ids) || lawyer_ids.length === 0)
      return err400(res, 'At least one attorney required.');
    if (lawyer_ids.length > 5)
      return err400(res, 'Maximum 5 attorneys at once.');

    const db      = await getDb();
    const results = [];

    // Batch lawyer → user_id lookup before loop (eliminates 1 SELECT per lawyer)
    const safeIds = lawyer_ids.map(id => safeInt(id, 0)).filter(id => id > 0);
    const lawyerRows = safeIds.length
      ? await db.all(
          `SELECT id, user_id FROM lawyers WHERE id IN (${safeIds.map(()=>'?').join(',')})`,
          safeIds
        ).catch(() => [])
      : [];
    const lawyerUserMap = Object.fromEntries(lawyerRows.map(r => [r.id, r.user_id]));
    const { sendPushToUser } = await import('../services/pushDelivery.js');

    for (const lawyerId of lawyer_ids) {
      try {
        // Get or create a case for this conversation
        let convCaseId = case_id;
        if (!convCaseId) {
          const newCase = await db.run(
            `INSERT INTO cases (user_id, title, status) VALUES (?,?,?)`,
            [req.user.id, 'Attorney inquiry', 'Active']
          );
          convCaseId = newCase.lastID;
        }
        // Send the message
        await db.run(
          `INSERT INTO messages (case_id, sender_id, sender_name, body) VALUES (?,?,?,?)`,
          [convCaseId, req.user.id, req.user.name || 'User', message.trim()]
        );
        // Push notification to attorney
        const targetUserId = lawyerUserMap[safeInt(lawyerId, 0)];
        if (targetUserId) {
          await sendPushToUser(targetUserId, {
            title: '⚖️ New inquiry from Justice Gavel',
            body:  safeMessage.slice(0, 100),
            data:  { type: 'message', case_id: convCaseId },
          }).catch(() => {});
        }
        results.push({ lawyer_id: lawyerId, case_id: convCaseId });
      } catch (e) {
        results.push({ lawyer_id: lawyerId, error: 'Could not send.' });
      }
    }

    const sent = results.filter(r => !r.error).length;
    return res.json({ sent, results });
  } catch (e) {
    logger.error('[messages/bulk]', e?.message);
    return res.status(500).json({ error: 'Bulk send failed. Please try again.' });
  }
});

// GET /api/messages/:caseId/stream — Server-Sent Events for real-time messages
// The client opens one persistent connection per case screen.
// Every 2 seconds the server checks for messages newer than the client's
// last seen message_id. On new messages, it pushes a 'data:' event.
// The client falls back to polling if SSE is not supported.
router.get('/:caseId/stream', authRequired, async (req, res) => {
  const caseId = safeInt(req.params.caseId);
  const uid    = req.user.id;

  let heartbeat, poll;
  try {
    // Verify user has access to this case
    const db = await getDb();
    const cas = await db.get(
      `SELECT id FROM cases WHERE id=? AND user_id=?
       UNION SELECT c.id FROM cases c
         JOIN case_family_access fa ON fa.case_id=c.id
         WHERE c.id=? AND fa.user_id=?`,
      [caseId, uid, caseId, uid]
    ).catch(() => null);
    if (!cas) return err404(res, 'Case not found.');

    // SSE headers
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
    res.flushHeaders();

    let lastId = parseInt(String(req.query.lastId || '0'), 10);

    // Send a heartbeat comment every 15s to keep the connection alive
    heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    // Poll for new messages every 2 seconds
    poll = setInterval(async () => {
      try {
        const newMsgs = await db.all(
          `SELECT id, sender_id, sender_name, body, lang, attachment,
                  read_at, created_at
           FROM messages
           WHERE case_id=? AND id > ?
           ORDER BY id ASC`,
          [caseId, lastId]
        );
        if (newMsgs.length > 0) {
          lastId = newMsgs[newMsgs.length - 1].id;
          res.write(`data: ${JSON.stringify(newMsgs)}\n\n`);
        }
      } catch { /* db error during poll — continue */ }
    }, 2000);

    // Cleanup on client disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(poll);
    });
  } catch (e) {
    // Setup failed (DB unavailable, connection closed before flush, etc.)
    clearInterval(heartbeat);
    clearInterval(poll);
    if (!res.headersSent) res.status(500).json({ error: 'Stream unavailable.' });
  }
});

export default router;
