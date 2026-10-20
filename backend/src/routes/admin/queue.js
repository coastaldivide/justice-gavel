/**
 * routes/admin/queue.js — the in-app admin review screen (AdminVerificationScreen).
 * Mounted at /api/admin/queue (before the key-protected /api/admin router).
 * Every route needs a signed-in account whose live role is admin or super_admin;
 * anyone else gets 403 (401 signed out). Decisions are audit-logged
 * (services/adminQueues.js).
 *
 *   GET  /summary              pending counts per queue
 *   GET  /bar                  bar numbers waiting for a check
 *   POST /bar/:userId          { approved: boolean, reason? }  (reason required to reject)
 *   GET  /claims?status=       POST /claims/:id  { decision: 'approve'|'reject', note? }
 *   GET  /reports?status=      POST /reports/:id { status: 'resolved'|'dismissed', note? }
 *   GET  /reviews?status=      POST /reviews/:id { action: 'publish'|'hide', note? }
 */
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { getDb } from '../../db/index.js';
import logger from '../../utils/logger.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import {
  QueueError, queueSummary, listBarSubmissions, decideBar, listClaims, decideClaim,
  listReports, decideReport, listReviews, moderateReview,
} from '../../services/adminQueues.js';

const router = Router();
const limiter = makeUserLimiter({ windowMs: 60_000, max: 120 });
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

router.use(authRequired, limiter, (req, res, next) => {
  if (!ADMIN_ROLES.has(req.user?.role)) return res.status(403).json({ error: msg(resolveLang(req), 'admin.err.forbidden'), code: 'forbidden' });
  next();
});

const handle = (fn) => async (req, res) => {
  try {
    const db = await getDb();
    res.json(await fn(db, req));
  } catch (e) {
    if (e instanceof QueueError) return res.status(e.status).json({ error: msg(resolveLang(req), `admin.err.${e.code}`), code: e.code });
    logger.error('[admin/queue]', req.path, e?.message);
    res.status(500).json({ error: msg(resolveLang(req), 'admin.err.server'), code: 'server_error' });
  }
};
const idOf = (req, k = 'id') => Number.parseInt(req.params[k], 10);
// A decision must name one of its queue's choices (checked again in services/adminQueues.js).
const body = (ok) => (req, res, next) => (ok(req.body && typeof req.body === 'object' ? req.body : {})
  ? next() : res.status(400).json({ error: msg(resolveLang(req), 'admin.err.bad_decision'), code: 'bad_decision' }));

router.get('/summary', handle(db => queueSummary(db)));
router.get('/bar', handle(async db => ({ pending: await listBarSubmissions(db) })));
router.post('/bar/:userId', body(b => typeof b.approved === 'boolean'), handle((db, req) => decideBar(db, { adminId: req.user.id, userId: idOf(req, 'userId'), approved: req.body?.approved, reason: req.body?.reason, req })));
router.get('/claims', handle(async (db, req) => ({ claims: await listClaims(db, req.query.status) })));
router.post('/claims/:id', body(b => ['approve', 'reject'].includes(b.decision)), handle((db, req) => decideClaim(db, { adminId: req.user.id, id: idOf(req), decision: req.body?.decision, note: req.body?.note, req })));
router.get('/reports', handle(async (db, req) => ({ reports: await listReports(db, req.query.status, req.query.limit) })));
router.post('/reports/:id', body(b => ['resolved', 'dismissed'].includes(b.status)), handle((db, req) => decideReport(db, { adminId: req.user.id, id: idOf(req), status: req.body?.status, note: req.body?.note, req })));
router.get('/reviews', handle(async (db, req) => ({ reviews: await listReviews(db, req.query.status, req.query.limit) })));
router.post('/reviews/:id', body(b => ['publish', 'hide'].includes(b.action)), handle((db, req) => moderateReview(db, { adminId: req.user.id, id: idOf(req), action: req.body?.action, note: req.body?.note, req })));

export default router;
