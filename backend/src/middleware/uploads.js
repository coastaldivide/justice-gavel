/**
 * middleware/uploads.js — the ONLY way routes accept multipart uploads (C5).
 *
 * Before: several routes buffered 20–100 MB per request in memory for any
 * signed-in user, so a handful of parallel uploads OOM-killed the process.
 *
 * Every upload route now goes through uploadGuard(), which, in order:
 *   1. requires an authenticated user BEFORE a single body byte is read
 *      (mount it after authRequired; anonymous requests get 401);
 *   2. rejects by Content-Length up front (413) when the declared body is over
 *      the route's cap, so the bytes are never buffered;
 *   3. admits the upload against process-wide budgets — a byte budget for
 *      in-memory uploads and a slot budget for disk uploads — and a per-user
 *      concurrency limit; over budget → 503 upload_busy / 429 (Retry-After);
 *   4. parses with multer using per-route limits (file size, file count, field
 *      count/size, parts) — small content (documents, attachments) stays in
 *      memory, large media (audio) is STREAMED TO A TEMP FILE on disk;
 *   5. releases the reservation and deletes temp files when the response ends.
 */
import { logIgnored } from '../utils/ignored.js';
import multer from 'multer';
import os     from 'os';
import fs     from 'fs';
import path   from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import logger from '../utils/logger.js';

export const MB = 1024 * 1024;

// Process-wide budgets. Memory: the sum of the caps of all in-flight in-memory
// uploads. Disk: number of concurrent streaming-to-disk uploads.
export const UPLOAD_LIMITS = Object.freeze({
  memoryBudgetBytes: 40 * MB,
  diskConcurrent:    6,
  perUserConcurrent: 2,
  multipartOverhead: 256 * 1024,   // headers/boundaries/small fields allowed on top of the file cap
});

const state = { memoryInFlight: 0, diskInFlight: 0, perUser: new Map() };
export function uploadStats() {
  return { memoryInFlight: state.memoryInFlight, diskInFlight: state.diskInFlight, users: state.perUser.size };
}

const TMP_DIR = path.join(os.tmpdir(), 'jg-uploads');
function ensureTmp() {
  try { fs.mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 }); } catch { /* exists */ }
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => { ensureTmp(); cb(null, TMP_DIR); },
  filename:    (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.upload`),
});

function unlinkQuiet(p) { if (p) fs.promises.unlink(p).catch(logIgnored('middleware/uploads')); }

/**
 * uploadGuard(opts) → Express middleware
 *   maxBytes   per-file cap (required)
 *   storage    'memory' (default) | 'disk'
 *   field      single file field name (mode 'single'), or
 *   fields     multer fields spec (mode 'fields'), or
 *   any: true  accept any one file field (mode 'any')
 *   maxFiles   default 1
 *   fileFilter multer fileFilter
 *   requireMultipart  when false (default) non-multipart requests pass straight
 *                     through (routes that also accept a small JSON body)
 *   onError(err, req, res) custom error renderer (optional)
 */
export function uploadGuard({
  maxBytes, storage = 'memory', field, fields, any = false, maxFiles = 1,
  fileFilter, requireMultipart = false, maxFields = 20, maxFieldBytes = 64 * 1024, onError,
} = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('uploadGuard: maxBytes required');
  const toDisk = storage === 'disk';
  const m = multer({
    storage: toDisk ? diskStorage : multer.memoryStorage(),
    limits: {
      fileSize: maxBytes, files: maxFiles, fields: maxFields, fieldSize: maxFieldBytes,
      parts: maxFiles + maxFields, headerPairs: 200,
    },
    fileFilter,
  });
  const parser = fields ? m.fields(fields) : any ? m.any() : m.single(field || 'file');
  const maxRequest = maxBytes * maxFiles + UPLOAD_LIMITS.multipartOverhead;

  return function uploadGuardMiddleware(req, res, next) {
    if (!req.is('multipart/form-data')) {
      if (requireMultipart) return res.status(400).json({ error: 'multipart_required', message: 'Send the file as multipart/form-data.' });
      return next();
    }
    // 1. Authentication must already have happened.
    if (!req.user?.id) {
      res.setHeader('Connection', 'close');
      return res.status(401).json({ error: 'Authentication required.', code: 'missing_token' });
    }
    // 2. Declared size.
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxRequest) {
      res.setHeader('Connection', 'close');
      return res.status(413).json({ error: 'file_too_large', message: `Uploads here can be at most ${Math.floor(maxBytes / MB)} MB.` });
    }
    // 3. Admission.
    const uid = String(req.user.id);
    const mine = state.perUser.get(uid) || 0;
    if (mine >= UPLOAD_LIMITS.perUserConcurrent) {
      res.setHeader('Retry-After', '10');
      res.setHeader('Connection', 'close');
      return res.status(429).json({ error: 'too_many_uploads', message: 'Wait for your other uploads to finish.' });
    }
    const reserve = toDisk ? 0 : Math.min(Number.isFinite(declared) && declared > 0 ? declared : maxRequest, maxRequest);
    if (toDisk ? state.diskInFlight >= UPLOAD_LIMITS.diskConcurrent
               : state.memoryInFlight + reserve > UPLOAD_LIMITS.memoryBudgetBytes) {
      res.setHeader('Retry-After', '15');
      res.setHeader('Connection', 'close');
      logger.warn({ path: req.path, memoryInFlight: state.memoryInFlight, diskInFlight: state.diskInFlight }, '[uploads] busy — upload refused');
      return res.status(503).json({ error: 'upload_busy', message: 'The server is busy processing uploads. Please try again shortly.' });
    }
    state.perUser.set(uid, mine + 1);
    if (toDisk) state.diskInFlight += 1; else state.memoryInFlight += reserve;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (state.perUser.get(uid) || 1) - 1;
      if (n <= 0) state.perUser.delete(uid); else state.perUser.set(uid, n);
      if (toDisk) state.diskInFlight = Math.max(0, state.diskInFlight - 1);
      else state.memoryInFlight = Math.max(0, state.memoryInFlight - reserve);
      // Temp files never outlive the request.
      const files = [req.file, ...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat())];
      for (const f of files) if (f?.path) unlinkQuiet(f.path);
      if (req.file) req.file.buffer = null;
    };
    res.once('finish', release);
    res.once('close', release);

    // 4. Parse.
    parser(req, res, (err) => {
      if (!err) return next();
      if (onError) return onError(err, req, res);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file_too_large', message: `Uploads here can be at most ${Math.floor(maxBytes / MB)} MB.` });
      }
      if (err instanceof multer.MulterError) return res.status(400).json({ error: 'invalid_upload', message: err.message });
      return res.status(415).json({ error: 'unsupported_file', message: err.message || 'Unsupported file.' });
    });
  };
}

/** Read an uploaded file into a Buffer whether it was stored in memory or on disk. */
export function fileBuffer(file) {
  if (!file) return Promise.resolve(null);
  if (file.buffer) return Promise.resolve(file.buffer);
  if (file.path) return fs.promises.readFile(file.path);
  return Promise.resolve(null);
}

/** A readable stream for an uploaded file (disk or memory). */
export function fileStream(file) {
  if (file?.path) return fs.createReadStream(file.path);
  return Readable.from(file?.buffer || Buffer.alloc(0));
}
