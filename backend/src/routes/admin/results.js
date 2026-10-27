/**
 * routes/admin/results.js — /api/admin/results: published results (B11; services/results.js).
 * Admin role only (anyone else 403, signed out 401). Nothing is published automatically.
 *
 *   GET  /preview?from=YYYY-MM-DD&to=YYYY-MM-DD   the numbers for a period (default: last 90 days)
 *   GET  /snapshots                               every published snapshot, newest first
 *   POST /publish { from, to }                    store an immutable, dated snapshot; refused (409
 *                                                 sample_too_small) under 100 answered court dates
 */
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { getDb } from '../../db/index.js';
import logger from '../../utils/logger.js';
import { audit, AUDIT_ACTIONS } from '../../utils/audit.js';
import { periodFrom, computeResults, publishResults, listSnapshots, ResultsError } from '../../services/results.js';

const router = Router();
const limiter = makeUserLimiter({ windowMs: 60_000, max: 60 });
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

router.use(authRequired, limiter, (req, res, next) => {
  if (!ADMIN_ROLES.has(req.user?.role)) return res.status(403).json({ error: msg(resolveLang(req), 'admin.err.forbidden'), code: 'forbidden' });
  next();
});

const handle = (fn) => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    await fn(req, res, await getDb());
  } catch (e) {
    const lang = resolveLang(req);
    if (e instanceof ResultsError) return res.status(e.status).json({ error: msg(lang, `results.err.${e.code}`, e.params), code: e.code, ...(e.params || {}) });
    logger.error({ err: e.message }, '[admin/results]');
    return res.status(500).json({ error: msg(lang, 'results.err.server'), code: 'server_error' });
  }
};

router.get('/preview', handle(async (req, res, db) => {
  res.json(await computeResults(db, periodFrom(req.query)));
}));

router.get('/snapshots', handle(async (req, res, db) => {
  res.json({ snapshots: await listSnapshots(db) });
}));

router.post('/publish', handle(async (req, res, db) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: msg(resolveLang(req), 'results.err.bad_period'), code: 'bad_period' });
  }
  const period = periodFrom(req.body || {});
  const snap = await publishResults(db, { adminId: req.user.id, ...period });
  await audit(AUDIT_ACTIONS.ADMIN_RESULTS_PUBLISHED, { req, entityType: 'results_snapshot', entityId: snap.id, metadata: period });
  res.status(201).json({ snapshot: snap });
}));

export default router;
