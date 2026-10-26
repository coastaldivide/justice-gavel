/**
 * routes/sign.js — /api/sign/:token, the public signing page's API (docs/BOND_DESK.md).
 * No account: the link sent to the signer (a 32-byte random token; only its SHA-256 is
 * stored) is the credential. Steps: questions → requested uploads → prepare copies → open
 * each copy → type full name + agree → signed. Every step is logged with time, IP and browser
 * for the signature certificate.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db/index.js';
import { resolveLang, msg, normalizeLang } from '../i18n/index.js';
import logger from '../utils/logger.js';
import { uploadGuard } from '../middleware/uploads.js';
import { getAttachmentStorage } from '../services/attachmentStorage.js';
import { hashToken, questionsFor, agencyFor, CONSENT_VERSION } from '../services/bondDesk/core.js';
import { prepareSigner, signSigner, listDocs, getFile, putFile, event, refreshPacketStatus, markOpened, markViewed, SignError } from '../services/bondDesk/packets.js';
import { sha256, mergePdfs } from '../services/bondDesk/pdf.js';
import { isDate } from '../services/bondDesk/money.js';
import { sendFile } from './bondDesk/_common.js';

const router = Router();
const UPLOAD_MAX = 10 * 1024 * 1024;
const UPLOAD_KINDS = ['id_front', 'id_back', 'selfie_with_id', 'proof_of_income', 'proof_of_address'];

router.use(rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: (req) => ({ error: msg(resolveLang(req), 'bd.err.too_many_requests'), code: 'too_many_requests' }),
}));

function fail(req, res, e) {
  if (e instanceof SignError) {
    return res.status(e.status).json({ error: msg(resolveLang(req), `bd.err.${e.code}`, e.params), code: e.code, ...e.params });
  }
  logger.error({ err: e?.message }, '[sign]');
  return res.status(500).json({ error: msg(resolveLang(req), 'bd.err.server'), code: 'server_error' });
}
const ipOf = (req) => String(req.ip || '').replace(/^::ffff:/, '').slice(0, 64) || null;
const uaOf = (req) => String(req.get('user-agent') || '').slice(0, 300) || null;

/** Resolve the token → req.sign = { db, signer, packet }. */
async function resolveToken(req, res, next) {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new SignError(404, 'link_invalid');
    const db = await getDb();
    const signer = await db.get('SELECT * FROM bd_signers WHERE token_hash = ?', [hashToken(token)]);
    if (!signer) throw new SignError(404, 'link_invalid');
    const packet = await db.get('SELECT * FROM bd_packets WHERE id = ?', [signer.packet_id]);
    if (packet.status === 'voided') throw new SignError(410, 'packet_voided');
    if (new Date(signer.token_expires_at) <= new Date()) throw new SignError(410, 'link_expired');
    signer.id = Number(signer.id);
    packet.id = Number(packet.id);
    req.sign = { db, signer, packet };
    next();
  } catch (e) { fail(req, res, e); }
}

const step = (fn) => async (req, res) => {
  try { await fn(req, res, req.sign); } catch (e) { fail(req, res, e); }
};
const open = (s) => !['signed', 'declined'].includes(s.status);
const requireOpen = (s) => {
  if (s.status === 'signed') throw new SignError(409, 'already_signed');
  if (s.status === 'declined') throw new SignError(409, 'declined');
};

async function storageOr503() {
  const s = await getAttachmentStorage();
  if (!s) throw new SignError(503, 'storage_unavailable');
  return s;
}

async function view(db, signer, packet) {
  const agency = await agencyFor(db, packet.agent_id);
  const bond = await db.get('SELECT defendant_name FROM bd_bonds WHERE id = ?', [packet.bond_id]);
  const uploads = await db.all('SELECT DISTINCT kind FROM bd_uploads WHERE signer_id = ?', [signer.id]);
  const have = new Set(uploads.map((u) => u.kind));
  return {
    agency: { name: agency.agency || agency.agent_name, phone: agency.phone, license: agency.license },
    signer: { name: signer.name, role: signer.role },
    status: signer.status, defendant_name: bond.defendant_name, lang: packet.lang,
    questions: questionsFor(packet, signer.role), answers: signer.answers || {},
    doc_requests: (packet.doc_requests || []).map((k) => ({ kind: k, uploaded: have.has(k) })),
    documents: signer.prepared_at ? await listDocs(db, signer.id) : [],
    prepared: !!signer.prepared_at, signed_at: signer.signed_at || null,
    consent: { version: CONSENT_VERSION, text_key: 'sgn_esign_consent' },
  };
}

router.get('/:token', resolveToken, step(async (req, res, { db, signer, packet }) => {
  if (!signer.opened_at && open(signer)) await markOpened(db, { packet, signer, ip: ipOf(req), ua: uaOf(req) });
  const fresh = await db.get('SELECT * FROM bd_signers WHERE id = ?', [signer.id]);
  fresh.id = Number(fresh.id);
  res.set('Cache-Control', 'no-store');
  res.json(await view(db, fresh, packet));
}));

router.post('/:token/answers', resolveToken, step(async (req, res, { db, signer, packet }) => {
  requireOpen(signer);
  if (signer.prepared_at) throw new SignError(409, 'answers_locked');
  const input = req.body?.answers;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SignError(400, 'invalid', { field: 'answers' });
  const qs = questionsFor(packet, signer.role);
  const keys = new Set(qs.map((q) => q.key));
  const next = { ...(signer.answers || {}) };
  for (const [k, v] of Object.entries(input)) {
    if (!keys.has(k)) throw new SignError(400, 'invalid', { field: k });
    const s = v == null ? '' : String(v).normalize('NFC').replace(/\p{Cc}/gu, ' ').trim();
    if (s.length > 500) throw new SignError(400, 'too_long', { field: k, max: 500 });
    if (k === 'dob' && s && !isDate(s)) throw new SignError(400, 'bad_date', { field: k });
    if (s) next[k] = s; else delete next[k];
  }
  const c = await db.run(`UPDATE bd_signers SET answers = ?::jsonb, status = CASE WHEN status IN ('sent','opened') THEN 'in_progress' ELSE status END
                           WHERE id = ? AND prepared_at IS NULL AND status NOT IN ('signed','declined')`, [JSON.stringify(next), signer.id]);
  if (!c.changes) throw new SignError(409, 'answers_locked');
  await event(db, { packetId: packet.id, signerId: signer.id, event: 'answers_saved', ip: ipOf(req), ua: uaOf(req) });
  await refreshPacketStatus(db, packet.id);
  res.json({ ok: true, answers: next });
}));

const uploadParser = uploadGuard({
  maxBytes: UPLOAD_MAX, field: 'file', requireMultipart: true, maxFields: 3, maxFieldBytes: 100,
  onError: (err, req, res) => fail(req, res, new SignError(err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err?.code === 'LIMIT_FILE_SIZE' ? 'too_large' : 'bad_upload', err?.code === 'LIMIT_FILE_SIZE' ? { mb: 10 } : {})),
});
function sniff(buf) {
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

const uploadReady = step(async (req, res, { signer }) => {
  requireOpen(signer);
  await storageOr503();
  req.user = { id: `signer-${signer.id}`, role: 'signer' };   // the upload guard's per-person limit
});
router.post('/:token/uploads', resolveToken, (req, res, next) => uploadReady(req, res).then(() => { if (!res.headersSent) next(); }),
  uploadParser, step(async (req, res, { db, signer, packet }) => {
    const kind = String(req.body?.kind || '');
    if (!UPLOAD_KINDS.includes(kind) || !(packet.doc_requests || []).includes(kind)) throw new SignError(400, 'invalid', { field: 'kind' });
    const file = req.file;
    if (!file?.buffer?.length) throw new SignError(400, 'file_required');
    const type = sniff(file.buffer);
    if (!type) throw new SignError(415, 'bad_file_type');
    const n = await db.get('SELECT COUNT(*)::int AS n FROM bd_uploads WHERE signer_id = ?', [signer.id]);
    if (n.n >= 20) throw new SignError(409, 'too_many');
    const storage = await storageOr503();
    const key = await putFile(storage, file.buffer);
    const row = await db.get(
      `INSERT INTO bd_uploads (packet_id, signer_id, kind, storage_key, content_type, size_bytes, sha256, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, created_at`,
      [packet.id, signer.id, kind, key, type, file.buffer.length, sha256(file.buffer), ipOf(req)]);
    await event(db, { packetId: packet.id, signerId: signer.id, event: 'uploaded', detail: kind, ip: ipOf(req), ua: uaOf(req) });
    await db.run(`UPDATE bd_signers SET status = 'in_progress' WHERE id = ? AND status IN ('sent','opened')`, [signer.id]);
    await refreshPacketStatus(db, packet.id);
    res.status(201).json({ id: Number(row.id), kind, created_at: row.created_at });
  }));

router.post('/:token/prepare', resolveToken, step(async (req, res, { db, signer, packet }) => {
  requireOpen(signer);
  const storage = await storageOr503();
  if (!signer.prepared_at) {
    const missing = questionsFor(packet, signer.role).filter((q) => q.required && !String(signer.answers?.[q.key] || '').trim()).map((q) => q.key);
    if (missing.length) throw new SignError(409, 'answers_missing', { missing });
    const have = new Set((await db.all('SELECT DISTINCT kind FROM bd_uploads WHERE signer_id = ?', [signer.id])).map((u) => u.kind));
    const need = (packet.doc_requests || []).filter((k) => !have.has(k));
    if (need.length) throw new SignError(409, 'uploads_missing', { missing: need });
  }
  const documents = await prepareSigner(db, storage, { packet, signer, ip: ipOf(req), ua: uaOf(req) });
  res.json({ documents });
}));

router.get('/:token/documents/:docId.pdf', resolveToken, step(async (req, res, { db, signer, packet }) => {
  const docId = Number.parseInt(req.params.docId, 10);
  const d = Number.isSafeInteger(docId)
    ? await db.get('SELECT id, name, status, prepared_key, signed_key, viewed_at FROM bd_documents WHERE id = ? AND signer_id = ?', [docId, signer.id])
    : null;
  if (!d) throw new SignError(404, 'not_found');
  const storage = await storageOr503();
  if (!d.viewed_at) await markViewed(db, { packet, signer, docId: Number(d.id), ip: ipOf(req), ua: uaOf(req) });
  const signed = d.status === 'signed';
  sendFile(res, await getFile(storage, signed ? d.signed_key : d.prepared_key),
    { type: 'application/pdf', name: `${d.name}${signed ? ' (signed)' : ''}.pdf`, inline: true });
}));

router.post('/:token/sign', resolveToken, step(async (req, res, { db, signer, packet }) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (b.agree_esign !== true || b.agree_terms !== true) throw new SignError(400, 'consent_required');
  const typed = typeof b.typed_name === 'string' ? b.typed_name.slice(0, 200) : '';
  const storage = await storageOr503();
  const lang = normalizeLang(b.lang) || packet.lang || 'en';
  const out = await signSigner(db, storage, { packet, signer, typedName: typed, ip: ipOf(req), ua: uaOf(req), lang });
  res.json(out);
}));

router.post('/:token/decline', resolveToken, step(async (req, res, { db, signer, packet }) => {
  requireOpen(signer);
  const reason = String(req.body?.reason || '').trim().slice(0, 300) || null;
  const c = await db.run(`UPDATE bd_signers SET status = 'declined', declined_at = NOW(), declined_reason = ? WHERE id = ? AND status NOT IN ('signed','declined')`,
    [reason, signer.id]);
  if (!c.changes) throw new SignError(409, 'already_signed');
  await event(db, { packetId: packet.id, signerId: signer.id, event: 'declined', detail: reason, ip: ipOf(req), ua: uaOf(req) });
  await refreshPacketStatus(db, packet.id);
  res.json({ ok: true });
}));

router.get('/:token/signed.pdf', resolveToken, step(async (req, res, { db, signer }) => {
  if (signer.status !== 'signed') throw new SignError(409, 'not_signed');
  const storage = await storageOr503();
  const docs = await db.all(`SELECT signed_key FROM bd_documents WHERE signer_id = ? AND status = 'signed' ORDER BY id`, [signer.id]);
  const files = [];
  for (const d of docs) files.push(await getFile(storage, d.signed_key));
  sendFile(res, await mergePdfs(files), { type: 'application/pdf', name: 'signed-bail-documents.pdf' });
}));

export default router;
