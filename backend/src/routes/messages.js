/**
 * routes/messages.js — attorney-client messaging
 *
 *   GET    /messages/unread[/count]   unread badge count
 *   GET    /messages/direct           direct messages to/from me (incl. bulk outreach)
 *   POST   /messages/bulk             message up to BULK_MAX attorneys from the directory
 *   POST   /messages/attachment       upload a document (multipart), optionally into a case thread
 *   GET    /messages/attachment/:id   download an attachment (decrypted)
 *   GET    /messages/:caseId          case thread history (marks incoming as read)
 *   POST   /messages/:caseId          send a message in a case thread
 *   DELETE /messages/:id              soft-delete a case message
 *
 * Message bodies are encrypted at rest with AES-256-GCM (services/encryption.js,
 * "iv:tag:ciphertext"); decrypt() passes legacy plaintext rows through, so rows
 * written before encryption still read correctly. Attachment bytes are encrypted
 * with the same key before they reach storage (services/attachmentStorage.js).
 *
 * Case access: the case owner, or an attorney/defender with an ACTIVE
 * case_assignments row for that case.
 */

import { Router }       from 'express';
import crypto           from 'crypto';
import multer           from 'multer';
import { uploadGuard }  from '../middleware/uploads.js';
import rateLimit        from 'express-rate-limit';
import { authRequired } from '../middleware/auth.js';
import { getDb }        from '../db/index.js';
import { err400, err403, err404 } from '../utils/routeHelpers.js';
import { sanitizeStr, truncateStr } from '../utils/sanitize.js';
import { auditLog }     from '../utils/auditLog.js';
import logger           from '../utils/logger.js';
import { sendPushToUser } from '../services/pushDelivery.js';
import { encrypt, decrypt, encryptBuffer, decryptBuffer } from '../services/encryption.js';
import { getAttachmentStorage, newStorageKey } from '../services/attachmentStorage.js';

const router = Router();

export const BULK_MAX            = 3;                  // LawyersScreen lets the user pick up to 3
export const BULK_MAX_CHARS      = 5_000;
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;  // "JPEG, PNG, or PDF — max 10 MB"

const userKey = (req) => `user:${req.user?.id ?? req.ip}`;
const limitHandler = (req, res) => res.status(429).json({ error: 'Too many requests. Please try again later.' });
const bulkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10, keyGenerator: userKey, handler: limitHandler,
  standardHeaders: true, legacyHeaders: false, validate: false,
});
const attachmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, keyGenerator: userKey, handler: limitHandler,
  standardHeaders: true, legacyHeaders: false, validate: false,
});

// req.user.role / is_defender are the LIVE values from the users row (middleware/auth.js).
// Being an attorney is necessary but not sufficient: counsel access also needs an
// ACTIVE case_assignments row, which only exists when the case owner invited the
// attorney (routes/caseCounsel.js) — see routes/attorney/cases.js.
const isAttorneyRole = (user) => user?.role === 'attorney' || user?.role === 'defender' || Number(user?.is_defender) === 1;
const isId = (v) => /^\d{1,15}$/.test(String(v ?? ''));
const preview = (s) => (s.length > 80 ? s.slice(0, 80) + '…' : s);

/** Case access check shared by every case-scoped endpoint. */
export async function getCaseAccess(db, user, caseId) {
  if (!isId(caseId)) return { error: 404 };
  const cas = await db.get('SELECT id, user_id, title FROM cases WHERE id = ?', [Number(caseId)]);
  if (!cas) return { error: 404 };
  if (cas.user_id === user.id) return { cas, senderType: 'user' };
  if (isAttorneyRole(user)) {
    const a = await db.get(
      `SELECT id FROM case_assignments WHERE case_id = ? AND defender_id = ? AND status = 'active'`,
      [cas.id, user.id]
    );
    if (a) return { cas, senderType: 'attorney' };
    return { error: 403 };
  }
  return { error: 404 };   // do not reveal other users' case ids
}

const accessError = (res, error) =>
  error === 403 ? err403(res, 'Not assigned to this case') : err404(res, 'Case not found');

function decryptMessage(row) {
  if (!row) return row;
  const out = { ...row };
  if (out.body != null)    out.body    = decrypt(out.body);
  if (out.content != null) out.content = decrypt(out.content);
  return out;
}

async function notifyCaseMessage(db, { cas, senderType, senderId, text }) {
  try {
    if (senderType === 'attorney') {
      if (cas.user_id && cas.user_id !== senderId) {
        await sendPushToUser(cas.user_id, {
          title: '⚖️ Your attorney sent a message',
          body: preview(text),
          data: { screen: 'Messages', caseId: cas.id },
          channelId: 'case_updates',
        });
      }
    } else {
      const rows = await db.all(
        `SELECT ca.defender_id, u.display_name AS client_name
           FROM case_assignments ca
           LEFT JOIN users u ON u.id = ?
          WHERE ca.case_id = ? AND ca.status = 'active'`,
        [senderId, cas.id]
      );
      for (const r of rows) {
        if (!r.defender_id || r.defender_id === senderId) continue;
        await sendPushToUser(r.defender_id, {
          title: `💬 ${r.client_name || 'Client'} sent a message`,
          body: preview(text),
          data: { screen: 'Messages', caseId: cas.id, case_title: cas.title },
          channelId: 'attorney_messages',
        });
      }
    }
  } catch (e) {
    logger.warn('[messages/push]', e?.message);   // non-fatal
  }
}

// ── GET /messages/unread — badge count ────────────────────────────────────
// (/unread/count is what HomeScreen calls)
router.get(['/unread', '/unread/count'], authRequired, async (req, res) => {
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
  } catch {
    return res.json({ count: 0 });
  }
});

// ── GET /messages/direct — direct messages (bulk outreach etc.) ───────────
router.get('/direct', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const withUser = isId(req.query.with) ? Number(req.query.with) : null;
    const params = [req.user.id, req.user.id];
    let where = '(m.recipient_id = ? OR m.sender_id = ?)';
    if (withUser) {
      where += ' AND (m.sender_id = ? OR m.recipient_id = ?)';
      params.push(withUser, withUser);
    }
    params.push(limit);
    const rows = await db.all(
      `SELECT m.id, m.sender_id, m.recipient_id, m.case_id, m.sender_role, m.content, m.created_at,
              su.display_name AS sender_name, ru.display_name AS recipient_name
         FROM messages m
         LEFT JOIN users su ON su.id = m.sender_id
         LEFT JOIN users ru ON ru.id = m.recipient_id
        WHERE ${where}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ?`,
      params
    );
    return res.json({
      messages: rows.map(r => ({
        ...decryptMessage(r),
        direction: r.sender_id === req.user.id ? 'sent' : 'received',
      })),
    });
  } catch (e) {
    logger.warn('[messages/direct]', e?.message);
    return res.status(500).json({ error: 'Could not load messages.' });
  }
});

// ── POST /messages/bulk — message several directory attorneys at once ─────
// Directory rows (lawyers) are public listings; most have no Justice Gavel
// account (lawyers.user_id is NULL). Only attorneys with an account
// (lawyers.user_id, or attorney_profiles.user_id for a claimed listing) can
// receive in-app messages; the rest are reported back as skipped with their
// public contact details so the app can offer to call / visit instead.
router.post('/bulk', authRequired, bulkLimiter, async (req, res) => {
  const rawIds  = req.body?.lawyer_ids;
  const rawText = req.body?.message ?? req.body?.body;

  if (!Array.isArray(rawIds) || rawIds.length === 0) return err400(res, 'lawyer_ids must be a non-empty array');
  if (!rawIds.every(isId)) return err400(res, 'lawyer_ids must be numeric ids');
  const ids = [...new Set(rawIds.map(Number))];
  if (ids.length > BULK_MAX) return err400(res, `You can message at most ${BULK_MAX} attorneys at once`);
  if (typeof rawText !== 'string' || !rawText.trim()) return err400(res, 'message is required');
  if (rawText.length > BULK_MAX_CHARS) return err400(res, `message must be ${BULK_MAX_CHARS} characters or fewer`);
  const text = truncateStr(sanitizeStr(rawText.trim(), BULK_MAX_CHARS), BULK_MAX_CHARS);

  const caseIdRaw = req.body?.case_id ?? req.body?.caseId ?? null;

  try {
    const db = await getDb();

    let caseId = null;
    if (caseIdRaw !== null && caseIdRaw !== undefined && caseIdRaw !== '') {
      const acc = await getCaseAccess(db, req.user, caseIdRaw);
      if (acc.error || acc.senderType !== 'user') return err404(res, 'Case not found');
      caseId = acc.cas.id;
    }

    const rows = await db.all(
      `SELECT l.id, l.name, l.firm, l.phone, l.website,
              u.id AS account_id
         FROM lawyers l
         LEFT JOIN attorney_profiles ap ON ap.lawyer_id = l.id
         LEFT JOIN users u ON u.id = COALESCE(l.user_id, ap.user_id)
        WHERE l.id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const byId = new Map(rows.map(r => [r.id, r]));

    const skipped = [];
    const targets = [];          // { lawyer, accountId }
    const seenAccounts = new Set();
    for (const id of ids) {
      const l = byId.get(id);
      if (!l) { skipped.push({ lawyer_id: id, reason: 'not_found' }); continue; }
      const contact = { lawyer_id: id, name: l.name, firm: l.firm || null, phone: l.phone || null, website: l.website || null };
      if (!l.account_id)                    { skipped.push({ ...contact, reason: 'no_account' }); continue; }
      if (l.account_id === req.user.id)     { skipped.push({ ...contact, reason: 'self' }); continue; }
      if (seenAccounts.has(l.account_id))   { skipped.push({ ...contact, reason: 'duplicate' }); continue; }
      seenAccounts.add(l.account_id);
      targets.push({ lawyer: l, accountId: l.account_id });
    }

    const recipients = [];
    if (targets.length) {
      await db.transaction(async (tx) => {
        for (const t of targets) {
          const r = await tx.run(
            `INSERT INTO messages (sender_id, recipient_id, case_id, sender_role, lang, content, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [req.user.id, t.accountId, caseId, isAttorneyRole(req.user) ? 'attorney' : 'user',
             typeof req.body?.lang === 'string' ? req.body.lang.slice(0, 8) : null, encrypt(text)]
          );
          recipients.push({ lawyer_id: t.lawyer.id, name: t.lawyer.name, message_id: r.lastID });
        }
      });
      for (const t of targets) {
        sendPushToUser(t.accountId, {
          title: '📨 New message from a potential client',
          body: preview(text),
          data: { screen: 'Messages', direct: true, from: req.user.id },
          channelId: 'attorney_messages',
        }).catch(() => {});
      }
    }

    await auditLog({
      userId: req.user.id, action: 'MESSAGE_BULK_SENT', entityType: 'lawyer', entityId: null,
      meta: { requested: ids.length, sent: recipients.length, skipped: skipped.length, length: text.length }, req,
    });

    const noAccount = skipped.filter(s => s.reason === 'no_account').length;
    let summary;
    if (recipients.length && !skipped.length) summary = `Sent to ${recipients.length} attorney${recipients.length === 1 ? '' : 's'}.`;
    else if (recipients.length) summary = `Sent to ${recipients.length} attorney${recipients.length === 1 ? '' : 's'}; ${skipped.length} could not be messaged in the app.`;
    else summary = noAccount
      ? 'None of the selected attorneys use in-app messaging yet. Please contact them by phone or through their website.'
      : 'No messages were sent.';

    return res.json({ sent: recipients.length, requested: ids.length, recipients, skipped, message: summary });
  } catch (e) {
    logger.warn('[messages/bulk]', e?.message);
    return res.status(500).json({ error: 'Could not send messages. Please try again.' });
  }
});

// ── Attachments ────────────────────────────────────────────────────────────
// Accepted types are sniffed from the bytes (the client-declared type is not trusted).
function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };

function safeFileName(name, mime) {
  let base = String(name || '').split(/[\\/]/).pop() || '';
  base = base.replace(/[\p{Cc}"<>|:*?]/gu, '').replace(/\s+/g, ' ').trim();
  base = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');       // extension comes from the sniffed type
  base = base.replace(/[^A-Za-z0-9 ._()-]/g, '_').slice(0, 100) || 'document';
  return `${base}.${EXT[mime]}`;
}

// Attachments are encrypted in memory before storage, so they stay in memory —
// capped at 10 MB and admitted against the process-wide upload budget (C5).
const parseMultipart = uploadGuard({
  maxBytes: ATTACHMENT_MAX_BYTES, any: true, requireMultipart: true, maxFields: 10, maxFieldBytes: 10_000,
  onError: (err, req, res) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'file_too_large', message: `Attachments can be at most ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.` });
    }
    if (err instanceof multer.MulterError) return err400(res, `Invalid upload: ${err.message}`);
    logger.warn('[messages/attachment] multipart error:', err?.message);
    return err400(res, 'Invalid upload');
  },
});

async function requireStorage(req, res, next) {
  try {
    const storage = await getAttachmentStorage();
    if (!storage) {
      return res.status(503).json({
        error: 'storage_unavailable',
        message: 'Document attachments are not available right now. Please try again later.',
      });
    }
    req.attachmentStorage = storage;
    next();
  } catch (e) {
    logger.warn('[messages/attachment] storage init failed:', e?.message);
    return res.status(503).json({ error: 'storage_unavailable', message: 'Document attachments are not available right now.' });
  }
}

router.post('/attachment', authRequired, attachmentLimiter, requireStorage, parseMultipart, async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const file  = files.find(f => ['file', 'document', 'attachment'].includes(f.fieldname));
  if (!file) return err400(res, 'A file is required (field "file")');
  if (!file.size) return err400(res, 'The file is empty');

  const mime = sniffMime(file.buffer);
  if (!mime) {
    return res.status(415).json({ error: 'unsupported_type', message: 'Only JPEG, PNG, WebP, HEIC images and PDF documents can be attached.' });
  }
  const name = safeFileName(file.originalname, mime);
  const caseIdRaw = req.body?.case_id ?? req.body?.caseId;
  const storage = req.attachmentStorage;

  let key = null;
  try {
    const db = await getDb();
    let access = null;
    if (caseIdRaw !== undefined && caseIdRaw !== '') {
      access = await getCaseAccess(db, req.user, caseIdRaw);
      if (access.error) return accessError(res, access.error);
    }

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    key = newStorageKey();
    await storage.put(key, encryptBuffer(file.buffer));

    const caption = typeof req.body?.message === 'string' && req.body.message.trim()
      ? truncateStr(sanitizeStr(req.body.message.trim(), 2000), 2000)
      : `📎 ${name}`;

    const result = await db.transaction(async (tx) => {
      const a = await tx.run(
        `INSERT INTO message_attachments
           (uploader_id, case_id, original_name, mime_type, size_bytes, sha256, storage, storage_key, encrypted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [req.user.id, access?.cas.id ?? null, name, mime, file.size, sha256, storage.kind, key]
      );
      let messageId = null;
      if (access) {
        const m = await tx.run(
          `INSERT INTO case_messages (case_id, sender_id, sender_type, body, message_type, sent_at)
           VALUES (?, ?, ?, ?, 'attachment', NOW())`,
          [access.cas.id, req.user.id, access.senderType, encrypt(caption)]
        );
        messageId = m.lastID;
        await tx.run('UPDATE message_attachments SET message_id = ? WHERE id = ?', [messageId, a.lastID]);
      }
      return { id: a.lastID, messageId };
    });

    await auditLog({
      userId: req.user.id, action: 'MESSAGE_ATTACHMENT_UPLOADED', entityType: access ? 'case' : 'attachment',
      entityId: access ? access.cas.id : result.id, meta: { size: file.size, mime }, req,
    });
    if (access) notifyCaseMessage(db, { cas: access.cas, senderType: access.senderType, senderId: req.user.id, text: caption });

    const url = `/api/messages/attachment/${result.id}`;
    return res.status(201).json({
      id: result.id,
      url,
      path: url,
      attachment: {
        id: result.id, name, mime_type: mime, size_bytes: file.size,
        case_id: access?.cas.id ?? null, message_id: result.messageId,
      },
    });
  } catch (e) {
    logger.warn('[messages/attachment]', e?.message);
    if (key) storage.remove(key).catch(() => {});
    return res.status(500).json({ error: 'Could not store the attachment. Please try again.' });
  }
});

router.get('/attachment/:id', authRequired, async (req, res) => {
  if (!isId(req.params.id)) return err404(res, 'Attachment not found');
  try {
    const db = await getDb();
    const a = await db.get('SELECT * FROM message_attachments WHERE id = ?', [Number(req.params.id)]);
    if (!a) return err404(res, 'Attachment not found');
    if (a.uploader_id !== req.user.id) {
      if (!a.case_id) return err404(res, 'Attachment not found');
      const acc = await getCaseAccess(db, req.user, a.case_id);
      if (acc.error) return err404(res, 'Attachment not found');
    }
    const storage = await getAttachmentStorage();
    if (!storage || storage.kind !== a.storage) {
      return res.status(503).json({ error: 'storage_unavailable', message: 'This attachment is not available right now.' });
    }
    const stored = await storage.get(a.storage_key);
    const bytes  = a.encrypted ? decryptBuffer(stored) : stored;
    res.set({
      'Content-Type': a.mime_type,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${a.original_name.replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    return res.end(bytes);
  } catch (e) {
    logger.warn('[messages/attachment/get]', e?.message);
    return res.status(500).json({ error: 'Could not load the attachment.' });
  }
});

// ── GET /messages/:caseId — case thread history ───────────────────────────
router.get('/:caseId', authRequired, async (req, res, next) => {
  const { caseId } = req.params;
  if (!/^\d+$/.test(String(caseId))) return next('route');
  const { limit = 50, before } = req.query;
  try {
    const db = await getDb();
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);

    const acc = await getCaseAccess(db, req.user, caseId);
    if (acc.error) return accessError(res, acc.error);
    const cid = acc.cas.id;

    const beforeTs = before && !Number.isNaN(Date.parse(String(before))) ? String(before) : null;
    const rows = await db.all(
      `SELECT m.id, m.sender_id, m.sender_type, m.body, m.message_type, m.sent_at,
              m.read_at, m.deleted_at,
              u.name AS sender_name,
              ma.id AS attachment_id, ma.original_name AS attachment_name,
              ma.mime_type AS attachment_type, ma.size_bytes AS attachment_size
         FROM case_messages m
         LEFT JOIN users u ON m.sender_id = u.id
         LEFT JOIN message_attachments ma ON ma.message_id = m.id
        WHERE m.case_id = ?
          AND m.deleted_at IS NULL
          ${beforeTs ? 'AND m.sent_at < ?' : ''}
        ORDER BY m.sent_at DESC
        LIMIT ?`,
      beforeTs ? [cid, beforeTs, safeLimit] : [cid, safeLimit]
    );

    await db.run(
      `UPDATE case_messages SET read_at = NOW()
        WHERE case_id = ? AND sender_id != ? AND read_at IS NULL`,
      [cid, req.user.id]
    ).catch(() => {});

    const messages = rows.reverse().map(r => {
      const m = decryptMessage(r);
      if (m.attachment_id) m.attachment_url = `/api/messages/attachment/${m.attachment_id}`;
      return m;
    });
    // No realtime channel is advertised: clients poll this endpoint
    // (frontend hooks/useCaseMessages.ts) — Supabase Realtime would require
    // shipping the anon key, and RLS has no policies.
    return res.json({ messages });
  } catch (e) {
    logger.warn('[messages/list]', e?.message);
    return err400(res, 'Failed to load messages');
  }
});

// ── POST /messages/:caseId — send a message ────────────────────────────────
router.post('/:caseId', authRequired, async (req, res, next) => {
  const { caseId } = req.params;
  if (!/^\d+$/.test(String(caseId))) return next('route');
  const body = req.body?.body;

  if (typeof body !== 'string' || !body.trim()) return err400(res, 'Message body required');
  // message_type: 'chat' (quick message) | 'note' (full legal correspondence)
  const msgType  = req.body.message_type === 'note' ? 'note' : 'chat';
  const maxLen   = msgType === 'note' ? 50_000 : 10_000;
  const safeBody = truncateStr(sanitizeStr(body, maxLen), maxLen);

  try {
    const db  = await getDb();
    const acc = await getCaseAccess(db, req.user, caseId);
    if (acc.error) return accessError(res, acc.error);

    const result = await db.run(
      `INSERT INTO case_messages
         (case_id, sender_id, sender_type, body, message_type, sent_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [acc.cas.id, req.user.id, acc.senderType, encrypt(safeBody), msgType]
    );

    const msg = await db.get(
      `SELECT m.id, m.case_id, m.sender_id, m.sender_type, m.body, m.message_type,
              m.sent_at, m.read_at, u.name AS sender_name
         FROM case_messages m
         LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?`,
      [result.lastID]
    );

    await auditLog({ userId: req.user.id, action: 'MESSAGE_SENT',
      entityType: 'case', entityId: acc.cas.id,
      meta: { length: safeBody.length }, req });

    notifyCaseMessage(db, { cas: acc.cas, senderType: acc.senderType, senderId: req.user.id, text: safeBody });
    return res.json({ message: decryptMessage(msg) });
  } catch (e) {
    logger.warn('[messages/send]', e?.message);
    return err400(res, 'Failed to send message');
  }
});

// ── DELETE /messages/:id — soft delete ────────────────────────────────────
router.delete('/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return err404(res, 'Message not found');
  try {
    const db = await getDb();
    const msg = await db.get(
      `SELECT m.id, m.sender_id, c.user_id FROM case_messages m
         JOIN cases c ON m.case_id = c.id
        WHERE m.id = ?`,
      [Number(id)]
    );
    if (!msg) return err404(res, 'Message not found');
    if (msg.sender_id !== req.user.id && msg.user_id !== req.user.id)
      return err403(res, 'Cannot delete this message');

    await db.run(`UPDATE case_messages SET deleted_at = NOW() WHERE id = ?`, [msg.id]);
    return res.json({ deleted: true });
  } catch (e) {
    logger.warn('[messages/delete]', e?.message);
    return err400(res, 'Failed to delete');
  }
});

export default router;
