/**
 * routes/bondDesk/agency.js — running the agency in Bond Desk (docs/BOND_DESK.md "Staff and
 * seats", "Forms set up for you", "Import open bonds", "Export everything"). Mounted at
 * /api/bond-desk after requireBondDesk.
 *
 *   GET    /staff                        seats used / included, owner, staff, invitations
 *   POST   /staff/invites                owner: { email, lang? } (409 seats_full over the plan's seats)
 *   DELETE /staff/invites/:id            owner: withdraw an invitation
 *   DELETE /staff/:userId                owner: remove a staff member (access ends at once)
 *   POST   /staff/leave                  staff: leave the agency
 *   GET    /forms-setup                  the agency's "set up my forms" requests
 *   POST   /forms-setup                  { note? } ask Justice Gavel staff to set the forms up
 *   POST   /forms-setup/:id/files        multipart file (PDF ≤ 10 MB), name? — add a surety PDF to the request
 *   POST   /forms-setup/:id/cancel       while still "requested"
 *   GET    /import/template.csv          the CSV header
 *   POST   /import/preview               multipart file (CSV ≤ 2 MB, ≤ 2,000 rows) → rows with their errors
 *   POST   /import                       multipart file → all rows imported in one transaction, or none
 *   GET    /export.zip                   owner: everything, one ZIP (streamed; 3 per hour)
 */
import { Router } from 'express';
import { BdError, handle, fail, id, text, body, ownerOnly, requireStorage, sendFile } from './_common.js';
import { uploadGuard } from '../../middleware/uploads.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { listStaff, inviteStaff, revokeInvite, removeStaff, leaveAgency } from '../../services/bondDesk/staff.js';
import { listForAgency, createRequest, openRequestOf, cancelRequest } from '../../services/bondDesk/formsSetup.js';
import { checkCsv, importCsv, existingPowerNumbers, templateCsv, MAX_CSV_BYTES } from '../../services/bondDesk/csvImport.js';
import { writeAgencyExport } from '../../services/bondDesk/export.js';
import { agencyFor, agentToday } from '../../services/bondDesk/core.js';
import { getAttachmentStorage } from '../../services/attachmentStorage.js';
import { createForm, pdfUpload, pubForm } from './forms.js';
import { audit } from '../../utils/audit.js';
import { resolveLang, msg } from '../../i18n/index.js';
import logger from '../../utils/logger.js';

const router = Router();
const say = (req, key, p) => msg(resolveLang(req), key, p);
const exportLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 3, message: (req) => say(req, 'bd.err.export_rate') });
const importLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 30, message: (req) => say(req, 'bd.err.too_many_requests') });
const inviteLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 20, message: (req) => say(req, 'bd.err.too_many_requests') });

const csvUpload = uploadGuard({
  maxBytes: MAX_CSV_BYTES, field: 'file', requireMultipart: true, maxFields: 2, maxFieldBytes: 200,
  onError: (err, req, res) => fail(req, res, new BdError(err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
    err?.code === 'LIMIT_FILE_SIZE' ? 'csv_too_large' : 'bad_upload', err?.code === 'LIMIT_FILE_SIZE' ? { mb: 2 } : {})),
});

// ── Staff and seats (B8) ─────────────────────────────────────────────────────

router.get('/staff', handle(async (req, res, db) => {
  res.json({ ...(await listStaff(db, req.agentId, req.bdPlan)), role: req.bdRole });
}));

router.post('/staff/invites', ownerOnly, inviteLimiter, handle(async (req, res, db) => {
  const b = body(req);
  const out = await inviteStaff(db, { ownerId: req.agentId, tier: req.bdPlan, email: text(b.email, 254, 'email', { required: true }), lang: b.lang || resolveLang(req) });
  await audit('bond_desk.staff_invited', { userId: req.user.id, req, entityType: 'bd_staff_invite', entityId: out.invite.id, metadata: { agent_id: req.agentId } });
  res.status(201).json(out);
}));

router.delete('/staff/invites/:id', ownerOnly, handle(async (req, res, db) => {
  await revokeInvite(db, { ownerId: req.agentId, inviteId: id(req.params.id) });
  res.json(await listStaff(db, req.agentId, req.bdPlan));
}));

router.delete('/staff/:userId', ownerOnly, handle(async (req, res, db) => {
  const userId = id(req.params.userId);
  await removeStaff(db, { ownerId: req.agentId, userId });
  await audit('bond_desk.staff_removed', { userId: req.user.id, req, entityType: 'user', entityId: userId, metadata: { agent_id: req.agentId } });
  res.json(await listStaff(db, req.agentId, req.bdPlan));
}));

router.post('/staff/leave', handle(async (req, res, db) => {
  if (req.bdRole !== 'staff') throw new BdError(409, 'not_staff');
  await leaveAgency(db, req.user.id);
  await audit('bond_desk.staff_left', { userId: req.user.id, req, entityType: 'user', entityId: req.user.id, metadata: { agent_id: req.agentId } });
  res.json({ ok: true });
}));

// ── Forms set up for the agency (A12 step 2) ─────────────────────────────────

router.get('/forms-setup', handle(async (req, res, db) => {
  res.json({ requests: await listForAgency(db, req.agentId) });
}));

router.post('/forms-setup', handle(async (req, res, db) => {
  const note = text(body(req).note, 1000, 'note');
  res.status(201).json({ request: await createRequest(db, { agentId: req.agentId, note, req }) });
}));

router.post('/forms-setup/:id/files', requireStorage, pdfUpload, handle(async (req, res, db) => {
  const r = await openRequestOf(db, req.agentId, id(req.params.id));
  const row = await createForm(db, { agentId: req.agentId, storage: req.storage, file: req.file, name: req.body?.name, setupRequestId: Number(r.id), setupPending: true });
  res.status(201).json({ form: pubForm(row) });
}));

router.post('/forms-setup/:id/cancel', handle(async (req, res, db) => {
  res.json({ request: await cancelRequest(db, { agentId: req.agentId, requestId: id(req.params.id), req }) });
}));

// ── CSV import of open bonds (A12 step 3) ────────────────────────────────────

router.get('/import/template.csv', (req, res) => {
  sendFile(res, Buffer.from(templateCsv(), 'utf8'), { type: 'text/csv; charset=utf-8', name: 'bond-desk-import-template.csv' });
});

router.post('/import/preview', importLimiter, csvUpload, handle(async (req, res, db) => {
  if (!req.file?.buffer?.length) throw new BdError(400, 'file_required');
  const today = await agentToday(db, req.agentId);
  const out = checkCsv(req.file.buffer, { today, existingPowers: await existingPowerNumbers(db, req.agentId) });
  res.json(out);
}));

router.post('/import', importLimiter, csvUpload, handle(async (req, res, db) => {
  if (!req.file?.buffer?.length) throw new BdError(400, 'file_required');
  const today = await agentToday(db, req.agentId);
  const out = await importCsv(db, { agentId: req.agentId, userId: req.user.id, buffer: req.file.buffer, today });
  await audit('bond_desk.bonds_imported', { userId: req.user.id, req, entityType: 'bd_bonds', entityId: req.agentId, metadata: { imported: out.imported } });
  res.status(201).json(out);
}));

// ── Export everything (A12 step 4) ───────────────────────────────────────────

router.get('/export.zip', ownerOnly, exportLimiter, handle(async (req, res, db) => {
  const a = await agencyFor(db, req.agentId);
  const today = await agentToday(db, req.agentId);
  const storage = await getAttachmentStorage().catch(() => null);
  const name = `bond-desk-export-${String(a.agency || 'agency').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}-${today}.zip`;
  res.status(200).set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${name}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  const write = (buf) => new Promise((resolve, reject) => {
    if (res.destroyed) { reject(new Error('client went away')); return; }
    if (res.write(buf)) { resolve(); return; }
    res.once('drain', resolve);
  });
  try {
    const out = await writeAgencyExport(db, { agentId: req.agentId, write, storage });
    await audit('compliance.data_export_requested', { userId: req.user.id, req, entityType: 'bond_desk', entityId: req.agentId, metadata: { files: out.files } });
    res.end();
  } catch (e) {
    // headers (and part of the ZIP) are already sent: end the stream so the client sees a broken download
    logger.error({ err: e?.message }, '[bond-desk] export failed');
    res.destroy(e);
  }
}));

export default router;
