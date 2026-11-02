/**
 * services/aiFiles.js — the Anthropic Files API for documents read more than once (AI step 4,
 * docs/AI_PLATFORM.md §11).
 *
 * A case document (message_attachments) read again for a court date, or an agency's surety PDF
 * that staff ask suggestions for more than once, is uploaded ONCE and then referenced by file_id
 * (`{ type: 'document' | 'image', source: { type: 'file', file_id } }`), so the bytes are not
 * re-sent on every call. The mapping local document → file_id lives in ai_files (never a
 * client-supplied id — the Files page: "Never accept file_id values from end users").
 *
 * Files API — https://platform.claude.com/docs/en/build-with-claude/files (read 2026-11-02):
 *   POST   /v1/files            multipart: `file` (the bytes, with filename + content type) and the
 *                               optional `expires_in_seconds` (3,600 … 7,776,000; cannot change later)
 *                               → { id, type: 'file', filename, mime_type, size_bytes, created_at,
 *                                   downloadable: false, expires_at }
 *   GET    /v1/files/{id}       metadata (stays readable up to 30 days after expiry)
 *   DELETE /v1/files/{id}       → { id, type: 'file_deleted' } (irreversible; 404 = already gone)
 *   No beta header is required any more (it only changes list shapes; we never list) — the
 *   Messages request that REFERENCES a file sends `files-api-2025-04-14` (aiClient.js FILES_BETA,
 *   the vision page still asks for it). Free to upload / delete; the content is billed as input
 *   tokens when used. Max 500 MB per file, 1 TB per organisation, ~500 file calls / minute.
 *   Files are visible to every API key of the workspace — use a workspace of its own for this app.
 *   Not ZDR / HIPAA eligible: that is why AI_FILES_API defaults OFF in production (owner decision).
 *   After expiry a Messages request referencing the file fails before inference.
 *
 * Setting: AI_FILES_API = on | off (unset: on, except NODE_ENV=production → off). Off, or any
 * Files API error → the caller falls back to inline base64 (the request still works).
 * AI_FILES_TTL_DAYS (default 30, 1 hour … 90 days): sent as expires_in_seconds and stored.
 *
 * Deletion — the remote copy goes when:
 *   • the local document goes (releaseFor(): case message / case deleted, form archived),
 *   • the account goes (services/accountDeletion.js purgeAccountData marks them in the deletion
 *     transaction; routes/auth.js calls deleteRemoteFiles() after commit),
 *   • the daily job `ai-files-cleanup` (scheduler.js + monitoring/jobHealth.js): expired rows,
 *     rows whose document no longer exists, rows whose owner is gone, and deletes that failed.
 * Logs carry ids, sizes and counts only — never document contents or file names.
 */
import { anthropicApi } from './aiClient.js';
import { aiConfigured } from '../utils/ai.js';
import { logIgnored } from '../utils/ignored.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';

const str = (v) => String(v ?? '').trim();
export const FILES_PATH = '/v1/files';
const MIN_TTL_S = 3600;
const MAX_TTL_S = 7_776_000;
/** Do not reuse a remote file that expires within this margin (a long PDF read could straddle it). */
const REUSE_MARGIN_MS = 15 * 60_000;

/** AI_FILES_API: on | off; unset → on except in production. */
export function filesApiEnabled() {
  const v = str(process.env.AI_FILES_API).toLowerCase();
  if (v === 'on') return aiConfigured();
  if (v === 'off') return false;
  return aiConfigured() && str(process.env.NODE_ENV).toLowerCase() !== 'production';
}

/** expires_in_seconds from AI_FILES_TTL_DAYS (default 30), clamped to the API's 1 h … 90 d range. */
export function fileTtlSeconds() {
  const days = Number(str(process.env.AI_FILES_TTL_DAYS));
  const s = Number.isFinite(days) && days > 0 ? Math.round(days * 86_400) : 30 * 86_400;
  return Math.min(MAX_TTL_S, Math.max(MIN_TTL_S, s));
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'text/plain': 'txt' };
/** A filename the API accepts (1–255 chars, none of < > : " | ? * \ / or control chars) that says nothing personal. */
export function remoteFilename(subjectType, subjectId, mime) {
  return `jg-${String(subjectType).replace(/[^a-z_]/g, '')}-${Number(subjectId) || 0}.${EXT[mime] || 'bin'}`;
}

/** POST /v1/files (multipart). → the file object. Throws on any failure. */
export async function uploadFile({ buffer, mime, filename, ttlSeconds = fileTtlSeconds(), fetchImpl } = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  if (ttlSeconds) form.append('expires_in_seconds', String(ttlSeconds));
  const res = await anthropicApi('POST', FILES_PATH, { body: form, timeoutMs: 60_000, retries: 1, fetchImpl });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    logger.warn({ status: res.status, body: t.slice(0, 200) }, '[ai-files] upload refused');
    throw Object.assign(new Error(`files upload ${res.status}`), { status: res.status });
  }
  const f = await res.json();
  if (!f?.id || typeof f.id !== 'string') throw new Error('files upload: no id');
  return f;
}

/** DELETE /v1/files/{id}. → 'deleted' | 'gone' (404). Throws on other failures. */
export async function deleteRemoteFile(fileId, { fetchImpl } = {}) {
  const res = await anthropicApi('DELETE', `${FILES_PATH}/${encodeURIComponent(fileId)}`, { timeoutMs: 20_000, retries: 1, fetchImpl });
  if (res.status === 404) { await res.text().catch(() => ''); return 'gone'; }
  if (!res.ok) {
    await res.text().catch(() => '');
    throw Object.assign(new Error(`files delete ${res.status}`), { status: res.status });
  }
  await res.json().catch(() => null);
  return 'deleted';
}

/**
 * The file_id for a local document, uploading it the first time. → { fileId, reused } or null
 * when the Files API is off or failed (the caller then sends the bytes inline).
 *   subject: { type: 'message_attachment' | 'bd_form', id, userId }
 */
export async function fileIdFor(db, { subject, buffer, mime, fetchImpl } = {}) {
  if (!filesApiEnabled() || !db || !subject?.type || !subject?.id || !buffer?.length) return null;
  const hash = sha256(buffer);
  try {
    const row = await db.get(
      `SELECT id, file_id FROM ai_files WHERE subject_type = ? AND subject_id = ? AND sha256 = ? AND deleted_at IS NULL
          AND delete_requested_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC LIMIT 1`,
      [subject.type, subject.id, hash, new Date(Date.now() + REUSE_MARGIN_MS).toISOString()]);
    if (row) {
      await db.run('UPDATE ai_files SET uses = uses + 1, last_used_at = NOW() WHERE id = ?', [row.id]);
      return { fileId: row.file_id, reused: true };
    }
    const ttl = fileTtlSeconds();
    const f = await uploadFile({ buffer, mime, filename: remoteFilename(subject.type, subject.id, mime), ttlSeconds: ttl, fetchImpl });
    const expiresAt = f.expires_at ? new Date(f.expires_at).toISOString() : new Date(Date.now() + ttl * 1000).toISOString();
    await db.run(
      `INSERT INTO ai_files (file_id, subject_type, subject_id, user_id, sha256, mime_type, size_bytes, expires_at, uses, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [f.id, subject.type, subject.id, subject.userId ?? null, hash, mime, buffer.length, expiresAt]);
    logger.info({ subject: subject.type, subjectId: subject.id, bytes: buffer.length }, '[ai-files] uploaded');
    return { fileId: f.id, reused: false };
  } catch (e) {
    logger.warn({ err: e.message, subject: subject.type, subjectId: subject.id }, '[ai-files] not used — sending the document inline');
    return null;
  }
}

/** The API said the file is gone / expired (404 on a Messages call): stop using it. */
export async function forgetFile(db, fileId, reason = 'not_found') {
  if (!db || !fileId) return;
  await db.run(`UPDATE ai_files SET deleted_at = COALESCE(deleted_at, NOW()), delete_reason = COALESCE(delete_reason, ?) WHERE file_id = ?`, [reason, fileId]).catch(logIgnored('services/aiFiles'));
}

/** Delete these rows' remote files now (best effort); failures stay for the cleanup job. → counts */
export async function deleteRemoteFiles(db, rows, { fetchImpl } = {}) {
  const out = { deleted: 0, gone: 0, failed: 0 };
  for (const r of rows || []) {
    if (!r?.file_id) continue;
    try {
      const how = aiConfigured() ? await deleteRemoteFile(r.file_id, { fetchImpl }) : null;
      if (!how) throw new Error('no API key');
      out[how === 'gone' ? 'gone' : 'deleted'] += 1;
      await db.run('UPDATE ai_files SET deleted_at = NOW(), delete_error = NULL WHERE file_id = ?', [r.file_id]);
    } catch (e) {
      out.failed += 1;
      await db.run('UPDATE ai_files SET delete_attempts = delete_attempts + 1, delete_error = ? WHERE file_id = ?', [String(e.message).slice(0, 200), r.file_id]).catch(logIgnored('services/aiFiles'));
    }
  }
  return out;
}

/** The local document went: request deletion of its remote copies and try right away. */
export async function releaseFor(db, subjectType, subjectIds, reason = 'document_deleted', { fetchImpl } = {}) {
  const ids = (Array.isArray(subjectIds) ? subjectIds : [subjectIds]).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!db || !ids.length) return { deleted: 0, gone: 0, failed: 0 };
  const rows = await db.all(
    `UPDATE ai_files SET delete_requested_at = COALESCE(delete_requested_at, NOW()), delete_reason = COALESCE(delete_reason, ?)
      WHERE subject_type = ? AND subject_id = ANY(?::bigint[]) AND deleted_at IS NULL RETURNING file_id`,
    [reason, subjectType, `{${ids.join(',')}}`]).catch(() => []);
  return deleteRemoteFiles(db, rows, { fetchImpl });
}

/**
 * Daily job `ai-files-cleanup`: delete the remote copy of every row that is expired, whose
 * document no longer exists (attachment row gone, its case message or case deleted, form gone
 * or archived), whose owner is gone, or whose deletion was requested earlier and failed.
 * Expired rows need no API call when the API already removed them (404 = gone).
 */
export async function cleanupFiles(db, { limit = 500, fetchImpl } = {}) {
  if (!db) return { checked: 0 };
  await db.run(
    `UPDATE ai_files f SET delete_requested_at = NOW(), delete_reason = 'document_deleted'
      WHERE f.deleted_at IS NULL AND f.delete_requested_at IS NULL AND (
        (f.subject_type = 'message_attachment' AND NOT EXISTS (
           SELECT 1 FROM message_attachments a JOIN cases c ON c.id = a.case_id
            LEFT JOIN case_messages m ON m.id = a.message_id
            WHERE a.id = f.subject_id AND c.deleted_at IS NULL AND (a.message_id IS NULL OR (m.id IS NOT NULL AND m.deleted_at IS NULL))))
        OR (f.subject_type = 'bd_form' AND NOT EXISTS (SELECT 1 FROM bd_forms b WHERE b.id = f.subject_id AND NOT b.archived))
        OR f.user_id IS NULL)`);
  await db.run(
    `UPDATE ai_files SET delete_requested_at = NOW(), delete_reason = 'expired'
      WHERE deleted_at IS NULL AND delete_requested_at IS NULL AND expires_at IS NOT NULL AND expires_at <= NOW()`);
  const rows = await db.all(
    `SELECT file_id FROM ai_files WHERE deleted_at IS NULL AND delete_requested_at IS NOT NULL
      ORDER BY delete_attempts, delete_requested_at LIMIT ${Math.max(1, Math.min(5000, Number(limit) || 500))}`);
  if (!rows.length) return { checked: 0, deleted: 0, gone: 0, failed: 0 };
  if (!aiConfigured()) return { checked: rows.length, deleted: 0, gone: 0, failed: 0, skipped: 'no_api_key' };
  const r = await deleteRemoteFiles(db, rows, { fetchImpl });
  logger.info({ ...r, checked: rows.length }, '[ai-files] cleanup');
  return { checked: rows.length, ...r };
}

/** Counts for the admin AI diagnostics. */
export async function filesSummary(db) {
  const r = await db.get(
    `SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS live,
            COUNT(*) FILTER (WHERE deleted_at IS NULL AND delete_requested_at IS NOT NULL)::int AS pending_delete,
            COALESCE(SUM(size_bytes) FILTER (WHERE deleted_at IS NULL), 0)::bigint AS live_bytes
       FROM ai_files`).catch(() => null);
  return { enabled: filesApiEnabled(), ttl_seconds: fileTtlSeconds(), live: r?.live ?? 0, pending_delete: r?.pending_delete ?? 0, live_bytes: Number(r?.live_bytes ?? 0) };
}
