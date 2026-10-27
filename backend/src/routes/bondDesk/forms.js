/**
 * routes/bondDesk/forms.js — the agency's form library: upload a fillable PDF, say who signs it,
 * map each text field to a case-file value once, preview it filled (docs/BOND_DESK.md "Forms library").
 *
 * Mounted twice with the same handlers:
 *   /api/bond-desk/forms…                       the agency (req.agentId); forms still being set up by
 *                                               Justice Gavel staff (setup_pending) are not listed or usable
 *   /api/admin/bd-setup/:requestId/forms…       admin staff working a "set up my forms" request on the
 *                                               agency's behalf (routes/admin/bdSetup.js sets req.agentId to
 *                                               the agency and req.setupRequestId); only that request's forms
 */
import { Router } from 'express';
import { BdError, handle, fail, id, text, sendFile, body, requireStorage } from './_common.js';
import { uploadGuard } from '../../middleware/uploads.js';
import { inspectPdf, preparePdf, sha256, PdfError, MAX_PDF_BYTES } from '../../services/bondDesk/pdf.js';
import { DATA_KEYS, agencyFor, dataValues, fieldValues, agentToday } from '../../services/bondDesk/core.js';
import { premiumCentsFor } from '../../services/bondDesk/payments.js';
import { putFile, getFile } from '../../services/bondDesk/packets.js';
import { loadBond } from './bonds.js';
import { audit } from '../../utils/audit.js';

const router = Router({ mergeParams: true });
const ROLES = ['defendant', 'indemnitor'];

export const pdfUpload = uploadGuard({
  maxBytes: MAX_PDF_BYTES, field: 'file', requireMultipart: true, maxFields: 5, maxFieldBytes: 1000,
  onError: (err, req, res) => fail(req, res, new BdError(err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
    err?.code === 'LIMIT_FILE_SIZE' ? 'too_large' : 'bad_upload', err?.code === 'LIMIT_FILE_SIZE' ? { mb: 10 } : {})),
});

const FORM_COLS = 'id, name, page_count, roles, fields, field_map, archived, created_at, size_bytes, setup_pending';
export const pubForm = (f) => ({ id: Number(f.id), name: f.name, page_count: Number(f.page_count), roles: f.roles, fields: f.fields,
  field_map: f.field_map, archived: !!f.archived, created_at: f.created_at, size_bytes: Number(f.size_bytes), setup_pending: !!f.setup_pending });

/** Which forms this caller sees: the agency's usable forms, or one setup request's forms (admin). */
const scope = (req) => (req.setupRequestId ? { sql: 'setup_request_id = ?', args: [req.setupRequestId] } : { sql: 'NOT setup_pending', args: [] });

async function loadForm(db, req, formId) {
  const sc = scope(req);
  const f = await db.get(`SELECT ${FORM_COLS}, storage_key FROM bd_forms WHERE id = ? AND agent_id = ? AND ${sc.sql}`, [formId, req.agentId, ...sc.args]);
  if (!f) throw new BdError(404, 'not_found');
  return f;
}

const auditAdmin = (req, action, formId, metadata = {}) => (req.setupRequestId
  ? audit(action, { userId: req.user.id, req, entityType: 'bd_form', entityId: formId, metadata: { setup_request_id: req.setupRequestId, agent_id: req.agentId, ...metadata } })
  : null);

router.get('/forms', handle(async (req, res, db) => {
  const sc = scope(req);
  const rows = await db.all(`SELECT ${FORM_COLS} FROM bd_forms WHERE agent_id = ? AND ${sc.sql} ORDER BY archived, name, id LIMIT 500`, [req.agentId, ...sc.args]);
  res.json({ forms: rows.map(pubForm), data_keys: DATA_KEYS });
}));

/** Store an uploaded PDF as a form of the agency (shared with the forms-setup upload). → row */
export async function createForm(db, { agentId, storage, file, name, setupRequestId = null, setupPending = false }) {
  if (!file?.buffer?.length) throw new BdError(400, 'file_required');
  const clean = text(name, 120, 'name') || text(String(file.originalname || '').replace(/\.pdf$/i, ''), 120, 'name') || 'Form';
  let info;
  try { info = await inspectPdf(file.buffer); } catch (e) {
    if (e instanceof PdfError) throw new BdError(400, e.code === 'encrypted_pdf' ? 'encrypted_pdf' : 'bad_pdf');
    throw e;
  }
  const n = await db.get('SELECT COUNT(*)::int AS n FROM bd_forms WHERE agent_id = ? AND NOT archived', [agentId]);
  if (n.n >= 100) throw new BdError(409, 'too_many');
  const key = await putFile(storage, file.buffer);
  return await db.get(
    `INSERT INTO bd_forms (agent_id, name, storage_key, sha256, size_bytes, page_count, fields, setup_request_id, setup_pending)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?) RETURNING ${FORM_COLS}`,
    [agentId, clean, key, sha256(file.buffer), file.buffer.length, info.page_count, JSON.stringify(info.fields), setupRequestId, setupPending]);
}

router.post('/forms', requireStorage, pdfUpload, handle(async (req, res, db) => {
  const row = await createForm(db, { agentId: req.agentId, storage: req.storage, file: req.file, name: req.body?.name,
    setupRequestId: req.setupRequestId || null, setupPending: !!req.setupRequestId && req.setupStatus !== 'ready' });
  await auditAdmin(req, 'admin.bd_setup_form_uploaded', row.id);
  res.status(201).json({ form: pubForm(row) });
}));

router.patch('/forms/:id', handle(async (req, res, db) => {
  const f = await loadForm(db, req, id(req.params.id));
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
    await auditAdmin(req, 'admin.bd_setup_form_mapped', f.id, { changed: cols, mapped_fields: set.field_map ? Object.keys(set.field_map).length : undefined });
  }
  const row = await db.get(`SELECT ${FORM_COLS} FROM bd_forms WHERE id = ?`, [f.id]);
  res.json({ form: pubForm(row) });
}));

router.post('/forms/:id/archive', handle(async (req, res, db) => {
  const f = await loadForm(db, req, id(req.params.id));
  const archived = body(req).archived !== false;
  await db.run('UPDATE bd_forms SET archived = ?, updated_at = NOW() WHERE id = ?', [archived, f.id]);
  await auditAdmin(req, 'admin.bd_setup_form_archived', f.id, { archived });
  res.json({ ok: true, archived });
}));

router.get('/forms/:id/file', requireStorage, handle(async (req, res, db) => {
  const f = await loadForm(db, req, id(req.params.id));
  sendFile(res, await getFile(req.storage, f.storage_key), { type: 'application/pdf', name: `${f.name}.pdf` });
}));

/** Sample case-file values for a preview without a bond (staff setting forms up have none). */
const SAMPLE_BOND = Object.freeze({
  defendant_name: 'Sample Defendant', defendant_dob: '1990-01-31', defendant_address: '100 Sample St, Nashville, TN 37201',
  defendant_phone: '+16155550100', defendant_email: 'defendant@example.com', case_number: '26-CR-0000', court_name: 'Sample County Court',
  county: 'Sample', state: 'TN', court_date: '2026-12-01', charges: 'Sample charge', bond_amount_cents: 500000, surety_name: 'Sample Surety',
});

router.get('/forms/:id/preview.pdf', requireStorage, handle(async (req, res, db) => {
  const f = await loadForm(db, req, id(req.params.id));
  const agency = await agencyFor(db, req.agentId);
  const today = await agentToday(db, req.agentId);
  let raw = SAMPLE_BOND; let premiumCents = 50000; let powerNumber = 'S-000001';
  if (req.query.bond_id != null && req.query.bond_id !== '') {
    const bond = await loadBond(db, req.agentId, id(req.query.bond_id));
    raw = await db.get('SELECT * FROM bd_bonds WHERE id = ?', [bond.id]);
    premiumCents = await premiumCentsFor(db, bond.id);
    powerNumber = bond.power?.number || null;
  }
  const values = dataValues({ bond: raw, agency, signer: { role: 'defendant', name: raw.defendant_name, phone: raw.defendant_phone, email: raw.defendant_email, answers: {} },
    indemnitor: null, premiumCents, powerNumber, today });
  let pdf;
  try { pdf = await preparePdf(await getFile(req.storage, f.storage_key), fieldValues(f.field_map, values)); } catch (e) {
    if (e instanceof PdfError) throw new BdError(409, 'form_problem', { form: f.name, field: e.detail || null, reason: e.code });
    throw e;
  }
  sendFile(res, pdf, { type: 'application/pdf', name: `${f.name} (preview).pdf`, inline: true });
}));

export default router;
