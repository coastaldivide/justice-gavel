/**
 * routes/courtPapers.js — "Read my court paper" (AI step 4, docs/AI_PLATFORM.md §11).
 * Signed-in only, after the AI disclaimer (451 otherwise, like every AI feature). Nothing here saves a court date: the app shows the proposed lines for the person
 * to check against the paper and edit, and saves through POST /api/court-dates after they confirm.
 *
 *   GET  /api/court-papers/status             { enabled, max_mb, max_pages, types, reads_left_today }
 *   POST /api/court-papers/read               multipart `file` (photo JPEG/PNG/WebP/GIF or PDF; type
 *                                             sniffed from the bytes) → the proposed fields. The file
 *                                             is read in memory and dropped — not stored.
 *   POST /api/court-papers/read-attachment    { attachment_id } — a document already attached to one
 *                                             of the person's own cases (existing case documents);
 *                                             may be sent by Files API file_id (services/aiFiles.js)
 *
 * Answer: { result: 'read' | 'not_court_paper' | 'unreadable', fields: { court_date, court_time,
 * court_name, court_address, courtroom, case_number, judge, hearing_type: { value, source_text,
 * confidence } } | null, bring: [{ text, source_text, confidence }], warnings: [...], notice,
 * message?, pages, via_file_id, case_id? }.
 * Errors: { error, code, message } — file_* (400/413/415), hourly_limit / daily_limit (429),
 * unavailable (503), ai_* (the gateway's codes).
 */
import { Router } from 'express';
import multer from 'multer';
import { authRequired } from '../middleware/auth.js';
import { requireDisclaimer } from '../middleware/disclaimer.js';
import { uploadGuard, MB } from '../middleware/uploads.js';
import { getDb } from '../db/index.js';
import { resolveLang, msg } from '../i18n/index.js';
import logger from '../utils/logger.js';
import { readCourtPaper, courtPaperEnabled, courtPaperLimits, CourtPaperError } from '../services/courtPaper.js';
import { sendAiError, AiError } from '../services/aiClient.js';
import { AiBudgetExceededError } from '../services/aiBudget.js';
import { IMAGE_TYPES, PDF_TYPE } from '../ai/media.js';
import { getAttachmentStorage } from '../services/attachmentStorage.js';
import { decryptBuffer } from '../services/encryption.js';
import { todayInZone, stateTimeZone } from '../utils/timezone.js';

const router = Router();
const HARD_MAX = 20 * MB;   // COURT_PAPER_MAX_MB is checked on the bytes; this only bounds the parser

const say = (req, key, p) => msg(resolveLang(req), key, p);
function sendError(req, res, e) {
  if (e instanceof CourtPaperError) {
    const params = Object.fromEntries(Object.entries(e.params || {}).filter(([, v]) => v != null));
    return res.status(e.status).json({ error: e.code, code: e.code, message: say(req, `cpr.err.${e.code}`, params), ...params });
  }
  if (e instanceof AiError || e instanceof AiBudgetExceededError || e?.status) return sendAiError(res, resolveLang(req), e);
  logger.error({ err: e?.message }, '[court-papers]');
  return res.status(500).json({ error: 'server_error', code: 'server_error', message: say(req, 'cpr.err.server') });
}

const paperUpload = uploadGuard({
  maxBytes: HARD_MAX, field: 'file', requireMultipart: true, maxFields: 4, maxFieldBytes: 200,
  onError: (err, req, res) => (err?.code === 'LIMIT_FILE_SIZE'
    ? res.status(413).json({ error: 'file_too_large', code: 'file_too_large', message: say(req, 'cpr.err.file_too_large', { mb: Math.round(courtPaperLimits().maxBytes / MB) }) })
    : res.status(400).json({ error: 'invalid_upload', code: 'invalid_upload', message: say(req, err instanceof multer.MulterError ? 'cpr.err.file_empty' : 'cpr.err.file_unsupported_type') })),
});

function requireOn(req, res, next) {
  if (!courtPaperEnabled()) return res.status(503).json({ error: 'feature_unavailable', code: 'feature_unavailable', message: say(req, 'cpr.err.unavailable') });
  next();
}

async function personToday(db, userId) {
  const u = await db.get('SELECT state FROM users WHERE id = ?', [userId]).catch(() => null);
  return todayInZone(stateTimeZone(u?.state) || 'America/New_York');
}

function answer(req, out, extra = {}) {
  const lang = resolveLang(req);
  return {
    ...out,
    notice: msg(lang, 'cpr.notice'),
    ...(out.result === 'read' ? {} : { message: msg(lang, `cpr.result.${out.result}`) }),
    ...extra,
  };
}

router.get('/status', authRequired, async (req, res) => {
  try {
    const db = await getDb();
    const lim = courtPaperLimits();
    const r = await db.get(`SELECT COUNT(*)::int AS n FROM ai_document_reads WHERE user_id = ? AND kind = 'court_paper' AND created_at > NOW() - INTERVAL '1 day'`, [req.user.id]);
    res.json({ enabled: courtPaperEnabled(), max_mb: Math.round(lim.maxBytes / MB), max_pages: lim.maxPages, types: [...IMAGE_TYPES, PDF_TYPE],
      reads_left_today: Math.max(0, lim.perDay - (r?.n ?? 0)) });
  } catch (e) { sendError(req, res, e); }
});

router.post('/read', authRequired, requireDisclaimer, requireOn, paperUpload, async (req, res) => {
  try {
    if (!req.file?.buffer?.length) throw new CourtPaperError(400, 'file_empty');
    const db = await getDb();
    const out = await readCourtPaper(db, { userId: req.user.id, buffer: req.file.buffer, source: 'upload', today: await personToday(db, req.user.id) });
    req.file.buffer = null;   // the paper is not kept
    res.json(answer(req, out));
  } catch (e) { sendError(req, res, e); }
});

router.post('/read-attachment', authRequired, requireDisclaimer, requireOn, async (req, res) => {
  try {
    const raw = req.body?.attachment_id;
    if (!/^\d{1,15}$/.test(String(raw ?? ''))) throw new CourtPaperError(400, 'bad_attachment');
    const db = await getDb();
    // Only a document on one of the person's OWN cases (court dates are the case owner's).
    const a = await db.get(
      `SELECT a.id, a.case_id, a.storage, a.storage_key, a.encrypted, a.message_id, c.user_id
         FROM message_attachments a JOIN cases c ON c.id = a.case_id
        WHERE a.id = ? AND c.user_id = ? AND c.deleted_at IS NULL`, [Number(raw), req.user.id]);
    if (!a) throw new CourtPaperError(404, 'attachment_not_found');
    if (a.message_id) {
      const m = await db.get('SELECT deleted_at FROM case_messages WHERE id = ?', [a.message_id]);
      if (!m || m.deleted_at) throw new CourtPaperError(404, 'attachment_not_found');
    }
    const storage = await getAttachmentStorage();
    if (!storage || storage.kind !== a.storage) throw new CourtPaperError(503, 'storage');
    const stored = await storage.get(a.storage_key);
    const bytes = a.encrypted ? decryptBuffer(stored) : stored;
    const out = await readCourtPaper(db, {
      userId: req.user.id, buffer: bytes, source: 'attachment',
      subject: { type: 'message_attachment', id: Number(a.id), userId: Number(a.user_id) },
      today: await personToday(db, req.user.id),
    });
    res.json(answer(req, out, { case_id: Number(a.case_id), attachment_id: Number(a.id) }));
  } catch (e) { sendError(req, res, e); }
});

export default router;
