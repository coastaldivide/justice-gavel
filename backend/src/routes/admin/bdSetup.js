/**
 * routes/admin/bdSetup.js — /api/admin/bd-setup, the "set up my forms" queue for Justice Gavel
 * staff (admin role; anyone else 403, signed out 401). docs/BOND_DESK.md "Forms set up for you".
 * Every decision is audit-logged (services/bondDesk/formsSetup.js; form edits in routes/bondDesk/forms.js).
 *
 *   GET  /?status=open|requested|in_progress|ready|cancelled|all
 *   GET  /:id                           the request, the agency, its forms
 *   POST /:id/start                     in progress, assigned to the caller
 *   POST /:id/ready { note? }           hand over: the forms appear in the agency's library
 *   /:id/forms…                         the same forms tool the agency uses (list, upload, map, archive, original,
 *                                       preview with sample data), on the agency's behalf, only while in progress
 */
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { handle, fail, id, text, body, BdError } from '../bondDesk/_common.js';
import { getDb } from '../../db/index.js';
import forms from '../bondDesk/forms.js';
import { listForStaff, requestForStaff, startRequest, finishRequest } from '../../services/bondDesk/formsSetup.js';

const router = Router();
const limiter = makeUserLimiter({ windowMs: 60_000, max: 120 });
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

router.use(authRequired, limiter, (req, res, next) => {
  if (!ADMIN_ROLES.has(req.user?.role)) return res.status(403).json({ error: msg(resolveLang(req), 'admin.err.forbidden'), code: 'forbidden' });
  next();
});

router.get('/', handle(async (req, res, db) => {
  res.json({ requests: await listForStaff(db, req.query.status) });
}));

router.get('/:id', handle(async (req, res, db) => {
  res.json({ request: await requestForStaff(db, id(req.params.id)) });
}));

router.post('/:id/start', handle(async (req, res, db) => {
  res.json({ request: await startRequest(db, { adminId: req.user.id, requestId: id(req.params.id), req }) });
}));

router.post('/:id/ready', handle(async (req, res, db) => {
  if (body(req).note != null && typeof body(req).note !== 'string') throw new BdError(400, 'invalid', { field: 'note' });
  const note = text(body(req).note, 1000, 'note');
  res.json({ request: await finishRequest(db, { adminId: req.user.id, requestId: id(req.params.id), note, req }) });
}));

/** The forms tool acts as the agency, on this request's forms only, while the request is in progress (reads also when ready). */
router.use('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const r = await db.get('SELECT id, agent_id, status FROM bd_setup_requests WHERE id = ?', [id(req.params.id)]);
    if (!r) throw new BdError(404, 'not_found');
    const reading = req.method === 'GET';
    if (!(r.status === 'in_progress' || (reading && r.status === 'ready'))) throw new BdError(409, 'setup_not_started');
    req.agentId = Number(r.agent_id);
    req.setupRequestId = Number(r.id);
    req.setupStatus = r.status;
    next();
  } catch (e) { fail(req, res, e); }
}, forms);

export default router;
