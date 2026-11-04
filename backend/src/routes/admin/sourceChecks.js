/**
 * routes/admin/sourceChecks.js — /api/admin/source-checks: the source re-check review queue
 * (docs/AI_PLATFORM.md §9; Admin → Source checks). Admin role only (anyone else 403, signed out
 * 401). Every decision is audited (services/sourceChecks/reviews.js).
 *
 *   GET  /                      overview: rows per dataset (shown / checkable / not official / no
 *                               source), last runs with cost
 *   GET  /reviews               the queue (?status=pending|approved|edited|withheld|superseded|all,
 *                               ?dataset=, ?limit ≤ 200, ?offset)
 *   POST /reviews/:id           decide { action: approve | edit | withhold, note?, fields?, source_url?, text? }
 *   POST /run                   start a re-check now { max_rows? } (≤ SOURCE_CHECK_MAX_ROWS; one run at a time)
 *   GET  /withheld              rows withheld after a check + corrections waiting for a developer
 *   POST /rows/restore          { dataset, key } lift a withhold
 *   GET  /allow-list            the official-domain rules and explicit list (read-only)
 */
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { getDb } from '../../db/index.js';
import logger from '../../utils/logger.js';
import { listReviews, decideReview, restoreRow, listWithheld, overview, ReviewError } from '../../services/sourceChecks/reviews.js';
import { startSourceCheckRun, sourceCheckSettings } from '../../services/sourceChecks/index.js';
import { EXPLICIT_DOMAINS, NEVER_DOMAINS, PROPOSAL_SOURCES } from '../../ai/sourceDomains.js';
import { aiErrorCode } from '../../services/aiClient.js';

const router = Router();
const limiter = makeUserLimiter({ windowMs: 60_000, max: 60 });
const runLimiter = makeUserLimiter({ windowMs: 60_000, max: 3, message: 'Too many runs started — wait a minute.' });
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

router.use(authRequired, limiter, (req, res, next) => {
  if (!ADMIN_ROLES.has(req.user?.role)) return res.status(403).json({ error: msg(resolveLang(req), 'admin.err.forbidden'), code: 'forbidden' });
  next();
});

const handle = (fn) => async (req, res) => {
  const lang = resolveLang(req);
  try {
    res.set('Cache-Control', 'no-store');
    await fn(req, res, await getDb());
  } catch (e) {
    if (e instanceof ReviewError) return res.status(e.status).json({ error: msg(lang, `srcchk.err.${e.code}`), code: e.code });
    if (e?.code === 'run_in_progress') return res.status(409).json({ error: msg(lang, 'srcchk.err.run_in_progress'), code: 'run_in_progress', batch_id: e.batchId });
    if (e?.name === 'AiError' || e?.code?.startsWith?.('ai_')) {
      const code = aiErrorCode(e);
      return res.status(code === 'ai_too_large' ? 413 : 503).json({ error: msg(lang, `ai.job.${code}`), code });
    }
    logger.error({ err: e.message }, '[admin/source-checks]');
    return res.status(500).json({ error: msg(lang, 'srcchk.err.server'), code: 'server_error' });
  }
};

router.get('/', handle(async (req, res, db) => {
  res.json({ ...await overview(db), settings: sourceCheckSettings() });
}));

router.get('/reviews', handle(async (req, res, db) => {
  res.json(await listReviews(db, req.query || {}));
}));

router.post('/reviews/:id', handle(async (req, res, db) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  res.json(await decideReview(db, req.params.id, body, { userId: req.user.id }));
}));

router.post('/run', runLimiter, handle(async (req, res, db) => {
  const s = sourceCheckSettings();
  const want = parseInt(req.body?.max_rows, 10);
  const maxRows = Number.isFinite(want) && want > 0 ? Math.min(want, s.maxRows) : s.maxRows;
  const r = await startSourceCheckRun(db, { trigger: 'admin', createdBy: req.user.id, maxRows });
  res.status(r.created ? 201 : 200).json({ batch: r.batch, created: r.created, counts: r.counts });
}));

router.get('/withheld', handle(async (req, res, db) => {
  res.json({ rows: await listWithheld(db) });
}));

router.post('/rows/restore', handle(async (req, res, db) => {
  const { dataset, key, note } = req.body || {};
  if (typeof dataset !== 'string' || !dataset || key == null || String(key) === '') {
    return res.status(400).json({ error: msg(resolveLang(req), 'srcchk.err.bad_dataset'), code: 'bad_dataset' });
  }
  res.json(await restoreRow(db, String(dataset || ''), String(key ?? ''), { userId: req.user.id, note }));
}));

router.get('/allow-list', handle((req, res) => {
  res.json({
    rules: ['.gov hosts', 'state.<xx>.us hosts', 'the explicit list below'],
    explicit: EXPLICIT_DOMAINS, never: NEVER_DOMAINS,
    proposals: Object.fromEntries(Object.entries(PROPOSAL_SOURCES).map(([k, v]) => [k, v.domains])),
  });
}));

export default router;
