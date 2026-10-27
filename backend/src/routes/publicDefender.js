/**
 * routes/publicDefender.js — /api/pd, the public defender office channel (A11, ⚖ counsel questions
 * 3.2 and 6.1, PUBLIC_DEFENDER_CHANNEL_ENABLED; services/publicDefender/*, docs/PUBLIC_DEFENDER.md).
 * Signed in only. Everything but /status answers 503 feature_unavailable while the setting is off.
 *
 *   GET    /status                         { enabled, member: { office_id, office, role } | null, texts_live }
 *   GET    /invite/:token                  an invitation (signed in)        POST /invite/accept { token }
 * Members of an office (staff or admin):
 *   GET    /office                         the office, seats, consent, baseline
 *   GET    /dashboard                      clients, upcoming, appearance per month, messages, opt-outs, baseline vs pilot
 *   GET    /export.zip                     every part as CSV    GET /export/:part.csv  one part
 *   GET    /clients?q=&page=               POST /clients (one)  GET|PATCH|DELETE /clients/:id
 *   GET    /clients/template.csv           POST /clients/import/preview (CSV) POST /clients/import (CSV)
 *   POST   /clients/:id/court-dates        PATCH|DELETE /court-dates/:id
 *   GET    /inbox?filter=open|all&page=    GET /inbox/unread
 *   GET    /clients/:id/messages?before=   POST /clients/:id/messages { body }   POST /clients/:id/handled { handled }
 *   GET    /staff
 * Office admins only:
 *   PATCH  /office { phone }               POST /office/consent { agree: true }   PUT /office/baseline {...}
 *   POST   /staff/invites { email, role }  DELETE /staff/invites/:id   PATCH /staff/:userId { role }   DELETE /staff/:userId
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { uploadGuard } from '../middleware/uploads.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { audit } from '../utils/audit.js';
import { msg, resolveLang } from '../i18n/index.js';
import { smsLive } from '../services/sms.js';
import { publicDefenderEnabled } from '../utils/counselFlags.js';
import { PdError, CONSENT_BASIS_TEXT } from '../services/publicDefender/common.js';
import {
  membership, getOffice, shapeOffice, seatUsage, listMembers, inviteMember, revokeInvite, removeMember, setRole,
  invitePreview, acceptInvite, updateOfficeSelf, recordConsent, setBaseline,
} from '../services/publicDefender/offices.js';
import {
  checkCsv, importCsv, existingKeys, templateCsv, officeToday, MAX_CSV_BYTES, MAX_ROWS,
  listClients, clientDetail, addClient, updateClient, deleteClient, addCourtDate, updateCourtDate, deleteCourtDate,
} from '../services/publicDefender/clients.js';
import { inbox, unreadTotal, conversation, markHandled } from '../services/publicDefender/inbox.js';
import { staffReply, STAFF_TEXT_MAX } from '../services/publicDefender/texts.js';
import { dashboard, partCsv, writeOfficeExport, EXPORT_PARTS } from '../services/publicDefender/dashboard.js';

const router = Router();
const say = (req, key, p) => msg(resolveLang(req), key, p);
const limiter = makeUserLimiter({ windowMs: 60_000, max: 120, message: (req) => say(req, 'pd.err.too_many_requests') });
const writeLimiter = makeUserLimiter({ windowMs: 60_000, max: 40, message: (req) => say(req, 'pd.err.too_many_requests') });
const importLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 30, message: (req) => say(req, 'pd.err.too_many_requests') });
const exportLimiter = makeUserLimiter({ windowMs: 3_600_000, max: 20, message: (req) => say(req, 'pd.err.too_many_requests') });
const textLimiter = makeUserLimiter({ windowMs: 60_000, max: 20, message: (req) => say(req, 'pd.err.too_many_requests') });

export function pdFail(req, res, e) {
  if (e instanceof PdError) {
    const text = say(req, `pd.err.${e.code}`, e.params);
    return res.status(e.status).json({ error: text, code: e.code, message: text, ...e.params });
  }
  if (typeof e?.type === 'string' && e.type.startsWith('Stripe')) {
    logger.warn({ err: e?.message, type: e.type }, '[pd] Stripe refused');
    const text = say(req, 'pd.err.payment_provider');
    return res.status(502).json({ error: text, code: 'payment_provider', message: text });
  }
  logger.error({ err: e?.message, stack: e?.stack?.split('\n').slice(0, 3).join(' | ') }, '[pd]');
  const text = say(req, 'pd.err.server');
  return res.status(500).json({ error: text, code: 'server_error', message: text });
}
export const pdHandle = (fn) => async (req, res) => {
  try { await fn(req, res, await getDb()); } catch (e) { pdFail(req, res, e); }
};
export const pdOn = (req, res, next) => (publicDefenderEnabled() ? next() : pdFail(req, res, new PdError(503, 'feature_unavailable')));
export const pid = (v) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isSafeInteger(n) || n <= 0 || String(n) !== String(v).trim()) throw new PdError(404, 'not_found');
  return n;
};
const b = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

async function requireMember(req, res, next) {
  try {
    const m = await membership(await getDb(), req.user.id);
    if (!m) throw new PdError(403, 'not_member');
    req.pd = m;
    next();
  } catch (e) { pdFail(req, res, e); }
}
const officeAdmin = (req, res, next) => (req.pd?.role === 'admin' ? next() : pdFail(req, res, new PdError(403, 'office_admin_only')));

const csvUpload = uploadGuard({
  maxBytes: MAX_CSV_BYTES, field: 'file', requireMultipart: true, maxFields: 2, maxFieldBytes: 200,
  onError: (err, req, res) => pdFail(req, res, new PdError(err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
    err?.code === 'LIMIT_FILE_SIZE' ? 'csv_too_large' : 'bad_upload', err?.code === 'LIMIT_FILE_SIZE' ? { mb: 2 } : {})),
});

const sendCsv = (res, bytes, name) => {
  res.set({
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': String(bytes.length),
    'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
  });
  res.end(bytes);
};

router.use(authRequired, limiter);

router.get('/status', pdHandle(async (req, res, db) => {
  const enabled = publicDefenderEnabled();
  let m = null;
  if (enabled) {
    const mem = await membership(db, req.user.id);
    if (mem) {
      const o = await db.get('SELECT name FROM pd_offices WHERE id = ?', [mem.office_id]);
      m = { office_id: mem.office_id, office: o?.name || '', role: mem.role, unread: await unreadTotal(db, mem.office_id) };
    }
  }
  res.json({ enabled, member: m, texts_live: smsLive() });
}));

// ── Invitations (any signed-in account) ──────────────────────────────────────

router.get('/invite/:token', pdOn, pdHandle(async (req, res, db) => {
  res.json(await invitePreview(db, { token: req.params.token, user: req.user }));
}));
router.post('/invite/accept', pdOn, writeLimiter, pdHandle(async (req, res, db) => {
  const out = await acceptInvite(db, { token: b(req).token, user: req.user });
  await audit('pd.member_joined', { userId: req.user.id, req, entityType: 'pd_office', metadata: { role: out.role } });
  res.json(out);
}));

// ── Members ──────────────────────────────────────────────────────────────────

router.use(pdOn, requireMember);

router.get('/office', pdHandle(async (req, res, db) => {
  res.json({ office: shapeOffice(await getOffice(db, req.pd.office_id)), role: req.pd.role, seats: await seatUsage(db, req.pd.office_id), consent_statement: CONSENT_BASIS_TEXT, texts_live: smsLive() });
}));
router.patch('/office', officeAdmin, writeLimiter, pdHandle(async (req, res, db) => {
  res.json({ office: await updateOfficeSelf(db, req.pd.office_id, b(req)) });
}));
router.post('/office/consent', officeAdmin, writeLimiter, pdHandle(async (req, res, db) => {
  const office = await recordConsent(db, { officeId: req.pd.office_id, userId: req.user.id, agree: b(req).agree });
  await audit('pd.consent_basis_recorded', { userId: req.user.id, req, entityType: 'pd_office', entityId: req.pd.office_id, metadata: { text: CONSENT_BASIS_TEXT } });
  res.json({ office });
}));
router.put('/office/baseline', officeAdmin, writeLimiter, pdHandle(async (req, res, db) => {
  res.json({ office: await setBaseline(db, { officeId: req.pd.office_id, userId: req.user.id, body: b(req) }) });
}));

router.get('/dashboard', pdHandle(async (req, res, db) => {
  res.json(await dashboard(db, req.pd.office_id));
}));

router.get('/export/:part.csv', exportLimiter, pdHandle(async (req, res, db) => {
  if (!EXPORT_PARTS.includes(req.params.part)) throw new PdError(404, 'not_found');
  sendCsv(res, await partCsv(db, req.pd.office_id, req.params.part), `public-defender-${req.params.part}.csv`);
}));

router.get('/export.zip', exportLimiter, pdHandle(async (req, res, db) => {
  const today = await officeToday(db, req.pd.office_id);
  res.status(200).set({
    'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="public-defender-export-${today}.zip"`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
  });
  const write = (buf) => new Promise((resolve, reject) => {
    if (res.destroyed) { reject(new Error('client went away')); return; }
    if (res.write(buf)) { resolve(); return; }
    res.once('drain', resolve);
  });
  try {
    await writeOfficeExport(db, { officeId: req.pd.office_id, write });
    await audit('compliance.data_export_requested', { userId: req.user.id, req, entityType: 'pd_office', entityId: req.pd.office_id });
    res.end();
  } catch (e) {
    logger.error({ err: e?.message }, '[pd] export failed');
    res.destroy(e);
  }
}));

// ── Clients ──────────────────────────────────────────────────────────────────

router.get('/clients/template.csv', (req, res) => sendCsv(res, Buffer.from(templateCsv(), 'utf8'), 'public-defender-clients-template.csv'));

router.post('/clients/import/preview', importLimiter, csvUpload, pdHandle(async (req, res, db) => {
  if (!req.file?.buffer?.length) throw new PdError(400, 'file_required');
  const today = await officeToday(db, req.pd.office_id);
  res.json({ ...checkCsv(req.file.buffer, { today, existing: await existingKeys(db, req.pd.office_id) }), max_rows: MAX_ROWS });
}));

router.post('/clients/import', importLimiter, csvUpload, pdHandle(async (req, res, db) => {
  if (!req.file?.buffer?.length) throw new PdError(400, 'file_required');
  const today = await officeToday(db, req.pd.office_id);
  const out = await importCsv(db, { officeId: req.pd.office_id, userId: req.user.id, buffer: req.file.buffer, today });
  await audit('pd.clients_imported', { userId: req.user.id, req, entityType: 'pd_office', entityId: req.pd.office_id, metadata: { imported: out.imported, added: out.added, updated: out.updated } });
  res.status(201).json(out);
}));

router.get('/clients', pdHandle(async (req, res, db) => {
  res.json(await listClients(db, req.pd.office_id, { q: req.query.q, page: req.query.page, pageSize: req.query.page_size }));
}));
router.post('/clients', writeLimiter, pdHandle(async (req, res, db) => {
  res.status(201).json(await addClient(db, { officeId: req.pd.office_id, userId: req.user.id, body: b(req) }));
}));
router.get('/clients/:id', pdHandle(async (req, res, db) => {
  res.json(await clientDetail(db, req.pd.office_id, pid(req.params.id)));
}));
router.patch('/clients/:id', writeLimiter, pdHandle(async (req, res, db) => {
  res.json(await updateClient(db, { officeId: req.pd.office_id, clientId: pid(req.params.id), body: b(req) }));
}));
router.delete('/clients/:id', writeLimiter, pdHandle(async (req, res, db) => {
  const id = pid(req.params.id);
  await deleteClient(db, { officeId: req.pd.office_id, clientId: id });
  await audit('pd.client_removed', { userId: req.user.id, req, entityType: 'pd_client', entityId: id });
  res.json({ ok: true });
}));
router.post('/clients/:id/court-dates', writeLimiter, pdHandle(async (req, res, db) => {
  res.status(201).json(await addCourtDate(db, { officeId: req.pd.office_id, clientId: pid(req.params.id), body: b(req) }));
}));
router.patch('/court-dates/:id', writeLimiter, pdHandle(async (req, res, db) => {
  res.json(await updateCourtDate(db, { officeId: req.pd.office_id, courtDateId: pid(req.params.id), body: b(req) }));
}));
router.delete('/court-dates/:id', writeLimiter, pdHandle(async (req, res, db) => {
  res.json(await deleteCourtDate(db, { officeId: req.pd.office_id, courtDateId: pid(req.params.id) }));
}));

// ── Inbox ────────────────────────────────────────────────────────────────────

router.get('/inbox', pdHandle(async (req, res, db) => {
  res.json(await inbox(db, req.pd.office_id, { filter: req.query.filter === 'open' ? 'open' : 'all', page: req.query.page }));
}));
router.get('/inbox/unread', pdHandle(async (req, res, db) => {
  res.json({ unread: await unreadTotal(db, req.pd.office_id) });
}));
router.get('/clients/:id/messages', pdHandle(async (req, res, db) => {
  res.json(await conversation(db, req.pd.office_id, pid(req.params.id), { before: req.query.before, limit: req.query.limit }));
}));
router.post('/clients/:id/messages', textLimiter, pdHandle(async (req, res, db) => {
  const body = b(req).body;
  if (body != null && typeof body !== 'string') throw new PdError(400, 'invalid', { field: 'body' });
  const out = await staffReply(db, { officeId: req.pd.office_id, clientId: pid(req.params.id), userId: req.user.id, text: body });
  res.status(201).json({ message: out, max: STAFF_TEXT_MAX });
}));
router.post('/clients/:id/handled', writeLimiter, pdHandle(async (req, res, db) => {
  const h = b(req).handled;
  if (h != null && typeof h !== 'boolean') throw new PdError(400, 'invalid', { field: 'handled' });
  await markHandled(db, { officeId: req.pd.office_id, clientId: pid(req.params.id), userId: req.user.id, handled: h !== false });
  res.json({ ok: true });
}));

// ── Staff ────────────────────────────────────────────────────────────────────

router.get('/staff', pdHandle(async (req, res, db) => {
  res.json({ ...(await listMembers(db, req.pd.office_id)), role: req.pd.role });
}));
router.post('/staff/invites', officeAdmin, writeLimiter, pdHandle(async (req, res, db) => {
  const x = b(req);
  const out = await inviteMember(db, { officeId: req.pd.office_id, email: x.email, role: x.role || 'staff', invitedBy: req.user.id, lang: x.lang || resolveLang(req) });
  await audit('pd.member_invited', { userId: req.user.id, req, entityType: 'pd_invite', entityId: out.invite.id, metadata: { office_id: req.pd.office_id, role: out.invite.role } });
  res.status(201).json(out);
}));
router.delete('/staff/invites/:id', officeAdmin, pdHandle(async (req, res, db) => {
  await revokeInvite(db, { officeId: req.pd.office_id, inviteId: pid(req.params.id) });
  res.json({ ok: true });
}));
router.patch('/staff/:userId', officeAdmin, writeLimiter, pdHandle(async (req, res, db) => {
  await setRole(db, { officeId: req.pd.office_id, userId: pid(req.params.userId), role: b(req).role });
  res.json(await listMembers(db, req.pd.office_id));
}));
router.delete('/staff/:userId', officeAdmin, pdHandle(async (req, res, db) => {
  const uid = pid(req.params.userId);
  await removeMember(db, { officeId: req.pd.office_id, userId: uid });
  await audit('pd.member_removed', { userId: req.user.id, req, entityType: 'pd_office', entityId: req.pd.office_id, metadata: { removed_user_id: uid } });
  res.json({ ok: true });
}));

export default router;
