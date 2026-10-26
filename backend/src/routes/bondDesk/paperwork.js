/**
 * routes/bondDesk/paperwork.js — the agent's form library and signing packets.
 * Mounted at /api/bond-desk (docs/BOND_DESK.md). Every row is the calling agent's own.
 */
import { Router } from 'express';
import { BdError, handle, fail, id, text, oneOf, sendFile, body, requireStorage } from './_common.js';
import { uploadGuard } from '../../middleware/uploads.js';
import { inspectPdf, preparePdf, sha256, PdfError, mergePdfs, MAX_PDF_BYTES } from '../../services/bondDesk/pdf.js';
import {
  DATA_KEYS, agencyFor, newToken, hashToken, signLink, LINK_DAYS, sendAgentText, sendAgentEmail, signingMessage,
  dataValues, fieldValues, agentToday,
} from '../../services/bondDesk/core.js';
import { putFile, getFile, event } from '../../services/bondDesk/packets.js';
import { loadBond } from './bonds.js';
import { liveTotal } from '../../services/bondDesk/money.js';
import { normalizeLang } from '../../i18n/index.js';

const router = Router();
const ROLES = ['defendant', 'indemnitor'];
export const DOC_REQUESTS = ['id_front', 'id_back', 'selfie_with_id', 'proof_of_income', 'proof_of_address'];

const pdfUpload = uploadGuard({
  maxBytes: MAX_PDF_BYTES, field: 'file', requireMultipart: true, maxFields: 5, maxFieldBytes: 1000,
  onError: (err, req, res) => fail(req, res, new BdError(err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
    err?.code === 'LIMIT_FILE_SIZE' ? 'too_large' : 'bad_upload', err?.code === 'LIMIT_FILE_SIZE' ? { mb: 10 } : {})),
});

// ── Forms ─────────────────────────────────────────────────────────────────────

const FORM_COLS = 'id, name, page_count, roles, fields, field_map, archived, created_at, size_bytes';
const pubForm = (f) => ({ id: Number(f.id), name: f.name, page_count: Number(f.page_count), roles: f.roles, fields: f.fields,
  field_map: f.field_map, archived: !!f.archived, created_at: f.created_at, size_bytes: Number(f.size_bytes) });

async function loadForm(db, agentId, formId) {
  const f = await db.get(`SELECT ${FORM_COLS}, storage_key FROM bd_forms WHERE id = ? AND agent_id = ?`, [formId, agentId]);
  if (!f) throw new BdError(404, 'not_found');
  return f;
}

router.get('/forms', handle(async (req, res, db) => {
  const rows = await db.all(`SELECT ${FORM_COLS} FROM bd_forms WHERE agent_id = ? ORDER BY archived, name, id`, [req.agentId]);
  res.json({ forms: rows.map(pubForm), data_keys: DATA_KEYS });
}));

router.post('/forms', requireStorage, pdfUpload, handle(async (req, res, db) => {
  const file = req.file;
  if (!file?.buffer?.length) throw new BdError(400, 'file_required');
  const name = text(req.body?.name, 120, 'name') || text(String(file.originalname || '').replace(/\.pdf$/i, ''), 120, 'name') || 'Form';
  let info;
  try { info = await inspectPdf(file.buffer); } catch (e) {
    if (e instanceof PdfError) throw new BdError(400, e.code === 'encrypted_pdf' ? 'encrypted_pdf' : 'bad_pdf');
    throw e;
  }
  const n = await db.get('SELECT COUNT(*)::int AS n FROM bd_forms WHERE agent_id = ? AND NOT archived', [req.agentId]);
  if (n.n >= 100) throw new BdError(409, 'too_many');
  const key = await putFile(req.storage, file.buffer);
  const row = await db.get(
    `INSERT INTO bd_forms (agent_id, name, storage_key, sha256, size_bytes, page_count, fields) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)
     RETURNING ${FORM_COLS}`,
    [req.agentId, name, key, sha256(file.buffer), file.buffer.length, info.page_count, JSON.stringify(info.fields)]);
  res.status(201).json({ form: pubForm(row) });
}));

router.patch('/forms/:id', handle(async (req, res, db) => {
  const f = await loadForm(db, req.agentId, id(req.params.id));
  const b = body(req);
  const set = {};
  if (Object.prototype.hasOwnProperty.call(b, 'name')) set.name = text(b.name, 120, 'name', { required: true });
  if (Object.prototype.hasOwnProperty.call(b, 'roles')) {
    if (!Array.isArray(b.roles) || !b.roles.length || b.roles.some((r) => !ROLES.includes(r))) throw new BdError(400, 'invalid', { field: 'roles' });
    set.roles = [...new Set(b.roles)];
  }
  if (Object.prototype.hasOwnProperty.call(b, 'field_map')) {
    const m = b.field_map;
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new BdError(400, 'bad_field_map');
    const textFields = new Set((f.fields || []).filter((x) => x.type === 'text').map((x) => x.name));
    const clean = {};
    for (const [field, key] of Object.entries(m)) {
      if (key === null || key === '') continue;            // unmapped
      if (!textFields.has(field) || !DATA_KEYS.includes(key)) throw new BdError(400, 'bad_field_map', { field });
      clean[field] = key;
    }
    set.field_map = clean;
  }
  const cols = Object.keys(set);
  if (cols.length) {
    await db.run(`UPDATE bd_forms SET ${cols.map((c) => (c === 'field_map' ? 'field_map = ?::jsonb' : c === 'roles' ? 'roles = ?::text[]' : `${c} = ?`)).join(', ')}, updated_at = NOW() WHERE id = ?`,
      [...cols.map((c) => (c === 'field_map' ? JSON.stringify(set[c]) : c === 'roles' ? `{${set[c].join(',')}}` : set[c])), f.id]);
  }
  const row = await db.get(`SELECT ${FORM_COLS} FROM bd_forms WHERE id = ?`, [f.id]);
  res.json({ form: pubForm(row) });
}));

router.post('/forms/:id/archive', handle(async (req, res, db) => {
  const f = await loadForm(db, req.agentId, id(req.params.id));
  const archived = body(req).archived !== false;
  await db.run('UPDATE bd_forms SET archived = ?, updated_at = NOW() WHERE id = ?', [archived, f.id]);
  res.json({ ok: true, archived });
}));

router.get('/forms/:id/file', requireStorage, handle(async (req, res, db) => {
  const f = await loadForm(db, req.agentId, id(req.params.id));
  sendFile(res, await getFile(req.storage, f.storage_key), { type: 'application/pdf', name: `${f.name}.pdf` });
}));

router.get('/forms/:id/preview.pdf', requireStorage, handle(async (req, res, db) => {
  const f = await loadForm(db, req.agentId, id(req.params.id));
  const bond = await loadBond(db, req.agentId, id(req.query.bond_id));
  const raw = await db.get('SELECT * FROM bd_bonds WHERE id = ?', [bond.id]);
  const agency = await agencyFor(db, req.agentId);
  const premium = await db.all(`SELECT amount_cents, voided_at FROM bd_charges WHERE bond_id = ? AND kind = 'premium'`, [bond.id]);
  const values = dataValues({ bond: raw, agency, signer: { role: 'defendant', name: raw.defendant_name, phone: raw.defendant_phone, email: raw.defendant_email, answers: {} },
    indemnitor: null, premiumCents: liveTotal(premium), powerNumber: bond.power?.number || null, today: await agentToday(db, req.agentId) });
  let pdf;
  try { pdf = await preparePdf(await getFile(req.storage, f.storage_key), fieldValues(f.field_map, values)); } catch (e) {
    if (e instanceof PdfError) throw new BdError(409, 'form_problem', { form: f.name, field: e.detail || null, reason: e.code });
    throw e;
  }
  sendFile(res, pdf, { type: 'application/pdf', name: `${f.name} (preview).pdf`, inline: true });
}));

// ── Packets ───────────────────────────────────────────────────────────────────

async function loadPacket(db, agentId, packetId) {
  const p = await db.get('SELECT * FROM bd_packets WHERE id = ? AND agent_id = ?', [packetId, agentId]);
  if (!p) throw new BdError(404, 'not_found');
  return p;
}

/** Send (or resend) one signer's link. → { sms, email } */
async function deliver(db, { packet, signer, link, deliverHow, agency, bond }) {
  const m = signingMessage(packet.lang || 'en', { agency: agency.agency || agency.agent_name, defendant: bond.defendant_name, link });
  const out = { sms: null, email: null };
  if (deliverHow === 'sms' || deliverHow === 'both') {
    out.sms = signer.phone ? await sendAgentText(db, { agentId: packet.agent_id, bondId: bond.id, purpose: 'signing_link', to: signer.phone, body: m.sms }) : 'skipped';
  }
  if (deliverHow === 'email' || deliverHow === 'both') {
    out.email = signer.email ? await sendAgentEmail({ to: signer.email, subject: m.subject, text: m.email }) : 'skipped';
  }
  for (const [ch, st] of Object.entries(out)) {
    if (st) await event(db, { packetId: packet.id, signerId: signer.id, event: `delivery_${ch}`, detail: st });
  }
  return out;
}

router.post('/bonds/:id/packets', handle(async (req, res, db) => {
  const b = body(req);
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  if (bond.status === 'cancelled') throw new BdError(409, 'bond_closed');
  // forms
  if (!Array.isArray(b.form_ids) || !b.form_ids.length || b.form_ids.length > 10) throw new BdError(400, 'invalid', { field: 'form_ids' });
  const formIds = [...new Set(b.form_ids.map((x) => id(x)))];
  const forms = await db.all(`SELECT id, roles FROM bd_forms WHERE agent_id = ? AND NOT archived AND id IN (${formIds.map(() => '?').join(',')})`, [req.agentId, ...formIds]);
  if (forms.length !== formIds.length) throw new BdError(400, 'invalid', { field: 'form_ids' });
  // signers
  if (!Array.isArray(b.signers) || !b.signers.length || b.signers.length > 6) throw new BdError(400, 'invalid', { field: 'signers' });
  const signers = [];
  const seen = new Set();
  for (const s of b.signers) {
    const role = oneOf(s?.role, ROLES, 'role');
    if (role === 'defendant') {
      if (seen.has('d')) throw new BdError(400, 'invalid', { field: 'signers' });
      seen.add('d');
      signers.push({ role, indemnitor_id: null, name: bond.defendant_name, phone: bond.defendant_phone, email: bond.defendant_email });
    } else {
      const iid = id(s.indemnitor_id);
      if (seen.has(`i${iid}`)) throw new BdError(400, 'invalid', { field: 'signers' });
      seen.add(`i${iid}`);
      const i = await db.get('SELECT id, full_name, phone, email FROM bd_indemnitors WHERE id = ? AND bond_id = ?', [iid, bond.id]);
      if (!i) throw new BdError(400, 'invalid', { field: 'signers' });
      signers.push({ role, indemnitor_id: Number(i.id), name: i.full_name, phone: i.phone, email: i.email });
    }
  }
  for (const s of signers) {
    if (!forms.some((f) => (f.roles || []).includes(s.role))) throw new BdError(400, 'no_forms_for_role', { role: s.role });
  }
  const questions = oneOf(b.questions, ['none', 'basic', 'full'], 'questions', { required: false, fallback: 'none' });
  const custom = Array.isArray(b.custom_questions) ? b.custom_questions : [];
  if (custom.length > 10) throw new BdError(400, 'invalid', { field: 'custom_questions' });
  const customClean = custom.map((q) => text(q, 200, 'custom_questions', { required: true }));
  const requests = Array.isArray(b.doc_requests) ? [...new Set(b.doc_requests)] : [];
  if (requests.some((r) => !DOC_REQUESTS.includes(r))) throw new BdError(400, 'invalid', { field: 'doc_requests' });
  const deliverHow = oneOf(b.deliver, ['sms', 'email', 'both', 'none'], 'deliver', { required: false, fallback: 'none' });
  if ((deliverHow === 'sms' || deliverHow === 'both') && b.consent_confirmed !== true) throw new BdError(400, 'consent_required');
  const lang = normalizeLang(b.lang) || 'en';

  const created = await db.transaction(async (tx) => {
    const p = await tx.get(
      `INSERT INTO bd_packets (bond_id, agent_id, form_ids, questions, custom_questions, doc_requests, lang)
       VALUES (?, ?, ?::bigint[], ?, ?::jsonb, ?::text[], ?) RETURNING *`,
      [bond.id, req.agentId, `{${formIds.join(',')}}`, questions, JSON.stringify(customClean), `{${requests.join(',')}}`, lang]);
    const out = [];
    for (const s of signers) {
      const token = newToken();
      const row = await tx.get(
        `INSERT INTO bd_signers (packet_id, role, indemnitor_id, name, phone, email, token_hash, token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + make_interval(days => ?)) RETURNING id`,
        [p.id, s.role, s.indemnitor_id, s.name, s.phone, s.email, hashToken(token), LINK_DAYS]);
      await event(tx, { packetId: Number(p.id), signerId: Number(row.id), event: 'sent' });
      out.push({ ...s, id: Number(row.id), token });
    }
    await tx.run('UPDATE bd_bonds SET updated_at = NOW() WHERE id = ?', [bond.id]);
    return { packet: p, signers: out };
  });
  const agency = await agencyFor(db, req.agentId);
  const result = [];
  for (const s of created.signers) {
    const link = signLink(s.token);
    const delivery = deliverHow === 'none' ? { sms: null, email: null }
      : await deliver(db, { packet: created.packet, signer: s, link, deliverHow, agency, bond });
    result.push({ id: s.id, name: s.name, role: s.role, link, delivery });
  }
  res.status(201).json({ packet: pubPacket(created.packet), signers: result });
}));

const pubPacket = (p) => ({ id: Number(p.id), bond_id: Number(p.bond_id), status: p.status, questions: p.questions,
  custom_questions: p.custom_questions, doc_requests: p.doc_requests, lang: p.lang, created_at: p.created_at,
  completed_at: p.completed_at, voided_at: p.voided_at, void_reason: p.void_reason });

router.get('/packets/:id', handle(async (req, res, db) => {
  const p = await loadPacket(db, req.agentId, id(req.params.id));
  const [signers, docs, uploads, events] = await Promise.all([
    db.all(`SELECT id, role, indemnitor_id, name, phone, email, status, sent_at, opened_at, signed_at, declined_at, declined_reason, answers, prepared_at, typed_name
              FROM bd_signers WHERE packet_id = ? ORDER BY id`, [p.id]),
    db.all('SELECT id, signer_id, form_id, name, status, prepared_sha256, signed_sha256, viewed_at FROM bd_documents WHERE packet_id = ? ORDER BY id', [p.id]),
    db.all('SELECT id, signer_id, kind, content_type, size_bytes, created_at FROM bd_uploads WHERE packet_id = ? ORDER BY id', [p.id]),
    db.all('SELECT signer_id, event, detail, ip, at FROM bd_events WHERE packet_id = ? ORDER BY at, id', [p.id]),
  ]);
  res.json({
    packet: pubPacket(p),
    signers: signers.map((s) => ({ ...s, id: Number(s.id), indemnitor_id: s.indemnitor_id == null ? null : Number(s.indemnitor_id),
      events: events.filter((e) => Number(e.signer_id) === Number(s.id)).map((e) => ({ event: e.event, detail: e.detail, at: e.at, ip: e.ip })) })),
    documents: docs.map((d) => ({ ...d, id: Number(d.id), signer_id: Number(d.signer_id), form_id: Number(d.form_id), viewed: !!d.viewed_at })),
    uploads: uploads.map((u) => ({ id: Number(u.id), signer_id: Number(u.signer_id), kind: u.kind, content_type: u.content_type, size: Number(u.size_bytes), created_at: u.created_at })),
    events: events.filter((e) => e.signer_id == null).map((e) => ({ event: e.event, detail: e.detail, at: e.at })),
  });
}));

router.post('/packets/:id/signers/:signerId/link', handle(async (req, res, db) => {
  const p = await loadPacket(db, req.agentId, id(req.params.id));
  if (p.status === 'voided') throw new BdError(409, 'packet_voided');
  const s = await db.get('SELECT * FROM bd_signers WHERE id = ? AND packet_id = ?', [id(req.params.signerId), p.id]);
  if (!s) throw new BdError(404, 'not_found');
  if (s.status === 'signed' || s.status === 'declined') throw new BdError(409, s.status === 'signed' ? 'already_signed' : 'declined');
  const b = body(req);
  const deliverHow = oneOf(b.deliver, ['sms', 'email', 'both', 'none'], 'deliver', { required: false, fallback: 'none' });
  if ((deliverHow === 'sms' || deliverHow === 'both') && b.consent_confirmed !== true) throw new BdError(400, 'consent_required');
  const token = newToken();
  const rotate = `UPDATE bd_signers SET token_hash = ?, token_expires_at = NOW() + make_interval(days => ?), sent_at = NOW() WHERE id = ?`;
  await db.run(rotate, [hashToken(token), LINK_DAYS, s.id]);
  await event(db, { packetId: p.id, signerId: Number(s.id), event: 'link_rotated' });
  const link = signLink(token);
  const bond = await db.get('SELECT id, defendant_name FROM bd_bonds WHERE id = ?', [p.bond_id]);
  const delivery = deliverHow === 'none' ? { sms: null, email: null }
    : await deliver(db, { packet: p, signer: { ...s, id: Number(s.id) }, link, deliverHow, agency: await agencyFor(db, req.agentId), bond });
  res.json({ id: Number(s.id), name: s.name, role: s.role, link, delivery });
}));

router.post('/packets/:id/void', handle(async (req, res, db) => {
  const p = await loadPacket(db, req.agentId, id(req.params.id));
  const reason = text(body(req).reason, 300, 'reason', { required: true });
  if (p.status === 'voided') throw new BdError(409, 'packet_voided');
  await db.run(`UPDATE bd_packets SET status = 'voided', voided_at = NOW(), void_reason = ? WHERE id = ? AND status <> 'voided'`, [reason, p.id]);
  await event(db, { packetId: p.id, event: 'voided', detail: reason });
  res.json({ ok: true });
}));

router.get('/documents/:id.pdf', requireStorage, handle(async (req, res, db) => {
  const d = await db.get(
    `SELECT d.id, d.name, d.status, d.prepared_key, d.signed_key, s.name AS signer_name FROM bd_documents d
       JOIN bd_packets p ON p.id = d.packet_id JOIN bd_signers s ON s.id = d.signer_id
      WHERE d.id = ? AND p.agent_id = ?`, [id(req.params.id), req.agentId]);
  if (!d) throw new BdError(404, 'not_found');
  const signed = d.status === 'signed';
  sendFile(res, await getFile(req.storage, signed ? d.signed_key : d.prepared_key),
    { type: 'application/pdf', name: `${d.name} - ${d.signer_name}${signed ? ' (signed)' : ''}.pdf` });
}));

router.get('/packets/:id/signed.pdf', requireStorage, handle(async (req, res, db) => {
  const p = await loadPacket(db, req.agentId, id(req.params.id));
  const docs = await db.all(`SELECT signed_key FROM bd_documents WHERE packet_id = ? AND status = 'signed' ORDER BY signer_id, id`, [p.id]);
  if (!docs.length) throw new BdError(409, 'not_signed');
  const files = [];
  for (const d of docs) files.push(await getFile(req.storage, d.signed_key));
  sendFile(res, await mergePdfs(files), { type: 'application/pdf', name: `bond-desk-packet-${p.id}-signed.pdf` });
}));

router.get('/uploads/:id', requireStorage, handle(async (req, res, db) => {
  const u = await db.get(
    `SELECT u.id, u.kind, u.content_type, u.storage_key FROM bd_uploads u JOIN bd_packets p ON p.id = u.packet_id
      WHERE u.id = ? AND p.agent_id = ?`, [id(req.params.id), req.agentId]);
  if (!u) throw new BdError(404, 'not_found');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp', 'application/pdf': 'pdf' }[u.content_type] || 'bin';
  sendFile(res, await getFile(req.storage, u.storage_key), { type: u.content_type, name: `${u.kind}-${u.id}.${ext}` });
}));

export default router;
