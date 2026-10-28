/**
 * routes/admin/pdOffices.js — /api/admin/pd-offices: Justice Gavel staff (admin role; anyone else
 * 403, signed out 401) set up public defender offices and invoice them (A11 steps 1 and 6,
 * ⚖ PUBLIC_DEFENDER_CHANNEL_ENABLED; docs/PUBLIC_DEFENDER.md). Every change is audit-logged.
 *
 *   GET    /                                  offices (newest first, at most 200)
 *   POST   /  { name, county?, state, phone?, seat_limit?, billing_email?, admin_email }
 *                                             creates the office and e-mails its first office admin an invitation
 *   GET    /unroutable                        client texts that matched several offices (delivered to none; last 100)
 *   GET    /:id                               the office, members and invitations, invoices
 *   PATCH  /:id { name?, county?, state?, phone?, seat_limit?, billing_email?, status? }
 *   POST   /:id/invites { email, role? }      invite another office admin / staff member
 *   GET    /:id/invoice-preview?year=         active clients, setup fee, amount (or the invoice already made)
 *   POST   /:id/invoices { year }             "Create annual invoice" (Stripe; idempotent per office + year)
 */
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { audit } from '../../utils/audit.js';
import { logIgnored } from '../../utils/ignored.js';
import { pdHandle, pdOn, pid } from '../publicDefender.js';
import { PdError, pdPrices } from '../../services/publicDefender/common.js';
import { listOffices, createOffice, getOffice, shapeOffice, updateOfficeAdmin, listMembers, inviteMember } from '../../services/publicDefender/offices.js';
import { previewInvoice, createInvoice, listInvoices, invoiceYear } from '../../services/publicDefender/billing.js';

const router = Router();
const limiter = makeUserLimiter({ windowMs: 60_000, max: 120 });
const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const b = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

router.use(authRequired, limiter, (req, res, next) => {
  if (!ADMIN_ROLES.has(req.user?.role)) return res.status(403).json({ error: msg(resolveLang(req), 'admin.err.forbidden'), code: 'forbidden' });
  next();
}, pdOn);

router.get('/', pdHandle(async (req, res, db) => {
  res.json({ offices: await listOffices(db), prices: pdPrices() });
}));

router.post('/', pdHandle(async (req, res, db) => {
  const out = await createOffice(db, { adminId: req.user.id, body: b(req), lang: b(req).lang || resolveLang(req) });
  await audit('pd.office_created', { userId: req.user.id, req, entityType: 'pd_office', entityId: out.office.id, metadata: { seat_limit: out.office.seat_limit } }).catch(logIgnored('routes/admin/pdOffices'));
  res.status(201).json(out);
}));

// texts from a number that is a client of several offices: delivered to none (review finding 9)
router.get('/unroutable', pdHandle(async (req, res, db) => {
  const { listUnroutable } = await import('../../services/publicDefender/texts.js');
  res.json({ texts: await listUnroutable(db) });
}));

router.get('/:id', pdHandle(async (req, res, db) => {
  const id = pid(req.params.id);
  const office = shapeOffice(await getOffice(db, id));
  res.json({ office, ...(await listMembers(db, id)), invoices: await listInvoices(db, id) });
}));

router.patch('/:id', pdHandle(async (req, res, db) => {
  const id = pid(req.params.id);
  const office = await updateOfficeAdmin(db, id, b(req));
  await audit('pd.office_updated', { userId: req.user.id, req, entityType: 'pd_office', entityId: id, metadata: { fields: Object.keys(b(req)).slice(0, 10) } }).catch(logIgnored('routes/admin/pdOffices'));
  res.json({ office });
}));

router.post('/:id/invites', pdHandle(async (req, res, db) => {
  const id = pid(req.params.id);
  await getOffice(db, id);
  const out = await inviteMember(db, { officeId: id, email: b(req).email, role: b(req).role || 'admin', invitedBy: req.user.id, lang: b(req).lang || resolveLang(req) });
  await audit('pd.member_invited', { userId: req.user.id, req, entityType: 'pd_invite', entityId: out.invite.id, metadata: { office_id: id, role: out.invite.role } }).catch(logIgnored('routes/admin/pdOffices'));
  res.status(201).json(out);
}));

router.get('/:id/invoice-preview', pdHandle(async (req, res, db) => {
  res.json(await previewInvoice(db, pid(req.params.id), invoiceYear(req.query.year)));
}));

router.post('/:id/invoices', pdHandle(async (req, res, db) => {
  const id = pid(req.params.id);
  const year = invoiceYear(b(req).year);
  if (b(req).confirm !== true) throw new PdError(400, 'confirm_required');
  const out = await createInvoice(db, { officeId: id, year, adminId: req.user.id });
  if (out.created) await audit('pd.invoice_created', { userId: req.user.id, req, entityType: 'pd_invoice', entityId: out.invoice.id, metadata: { office_id: id, year, amount_cents: out.invoice.amount_cents } }).catch(logIgnored('routes/admin/pdOffices'));
  res.status(out.created ? 201 : 200).json(out);
}));

export default router;
