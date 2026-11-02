/**
 * routes/admin/aiBatches.js — /api/admin/ai-batches: Message Batches (docs/AI_PLATFORM.md §10;
 * Admin → Batch tools). Admin role only.
 *
 *   GET  /                          recent batches (?kind=, ?limit ≤ 200)
 *   GET  /:id                       one batch: status, request counts, item outcomes, cost, output
 *   POST /poll                      check open batches now (the 'ai-batches' job does it every 10 minutes)
 *   POST /:id/cancel                ask the API to cancel (finished results are still processed)
 *   POST /eval                      start an evaluation run { state?, category?, limit? }
 *   GET  /:id/eval                  the stored results of an evaluation run (first batch id)
 *   POST /translate                 "Translate new keys": draft translations for missing keys
 *   GET  /:id/translation-draft     the review file (JSON download) — never applied automatically
 */
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { resolveLang, msg } from '../../i18n/index.js';
import { getDb } from '../../db/index.js';
import logger from '../../utils/logger.js';
import { listBatches, getBatch, pollBatches, cancelBatch, BATCH_KINDS } from '../../services/aiBatch.js';
import { startEvalRun } from '../../services/evalBatch.js';
import { startTranslationDraft } from '../../services/translationDrafts.js';
import { aiErrorCode } from '../../services/aiClient.js';

const router = Router();
const limiter = makeUserLimiter({ windowMs: 60_000, max: 60 });
const startLimiter = makeUserLimiter({ windowMs: 60_000, max: 3, message: 'Too many batches started — wait a minute.' });
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

router.use(authRequired, limiter, (req, res, next) => {
  if (!ADMIN_ROLES.has(req.user?.role)) return res.status(403).json({ error: msg(resolveLang(req), 'admin.err.forbidden'), code: 'forbidden' });
  next();
});

const handle = (fn) => async (req, res) => {
  const lang = resolveLang(req);
  try {
    res.set('Cache-Control', 'no-store');
    await fn(req, res, await getDb(), lang);
  } catch (e) {
    if (e?.name === 'AiError' || String(e?.code || '').startsWith('ai_')) {
      const code = aiErrorCode(e);
      return res.status(code === 'ai_too_large' ? 413 : code === 'ai_failed' ? 500 : 503).json({ error: msg(lang, `ai.job.${code}`), code });
    }
    logger.error({ err: e.message }, '[admin/ai-batches]');
    return res.status(500).json({ error: msg(lang, 'srcchk.err.server'), code: 'server_error' });
  }
};
const idOf = (req) => { const n = parseInt(req.params.id, 10); return Number.isFinite(n) && n > 0 ? n : null; };
const notFound = (res, lang) => res.status(404).json({ error: msg(lang, 'srcchk.err.not_found'), code: 'not_found' });

router.get('/', handle(async (req, res, db) => {
  const kind = BATCH_KINDS.includes(String(req.query.kind || '')) ? String(req.query.kind) : null;
  res.json({ batches: await listBatches(db, { kind, limit: req.query.limit }) });
}));

router.post('/poll', handle(async (req, res, db) => {
  res.json(await pollBatches(db));
}));

router.post('/eval', startLimiter, handle(async (req, res, db) => {
  const b = req.body || {};
  if ((b.state != null && !/^[A-Za-z]{2}$/.test(String(b.state))) || (b.limit != null && !Number.isFinite(parseInt(b.limit, 10)))) {
    return res.status(400).json({ error: msg(resolveLang(req), 'srcchk.err.bad_fields'), code: 'bad_request' });
  }
  const state = /^[A-Za-z]{2}$/.test(String(b.state || '')) ? String(b.state).toUpperCase() : null;
  const category = /^[a-z_]{1,40}$/.test(String(b.category || '')) ? String(b.category) : null;
  const limit = Number.isFinite(parseInt(b.limit, 10)) ? Math.min(Math.max(parseInt(b.limit, 10), 1), 200) : null;
  const r = await startEvalRun(db, { state, category, limit, createdBy: req.user.id });
  res.status(r.created ? 201 : 200).json({ batch: r.batch, created: r.created, questions: r.questions });
}));

router.post('/translate', startLimiter, handle(async (req, res, db) => {
  const r = await startTranslationDraft(db, { createdBy: req.user.id });
  res.status(r.created ? 201 : 200).json({ batch: r.batch, created: r.created, missing: r.missing });
}));

router.get('/:id', handle(async (req, res, db, lang) => {
  const id = idOf(req); if (!id) return notFound(res, lang);
  const b = await getBatch(db, id);
  if (!b) return notFound(res, lang);
  // The review file and English strings can be large: summarise here, download below.
  const { meta, output, ...rest } = b;
  const m = typeof meta === 'string' ? JSON.parse(meta) : meta || {};
  const o = typeof output === 'string' ? JSON.parse(output) : output;
  res.json({ ...rest, meta: { ...m, english: undefined },
    output: o && o.kind === 'translation_draft' ? { kind: o.kind, counts: o.counts, generated_at: o.generated_at, note: o.note } : o });
}));

router.post('/:id/cancel', handle(async (req, res, db, lang) => {
  const id = idOf(req); if (!id) return notFound(res, lang);
  const b = await cancelBatch(db, id);
  if (!b) return notFound(res, lang);
  res.json({ batch: b });
}));

router.get('/:id/eval', handle(async (req, res, db, lang) => {
  const id = idOf(req); if (!id) return notFound(res, lang);
  const b = await db.get(`SELECT id, kind, status, output, meta, created_at FROM ai_batches WHERE id = ? AND kind = 'eval_answer'`, [id]);
  if (!b) return notFound(res, lang);
  const o = typeof b.output === 'string' ? JSON.parse(b.output) : b.output || {};
  const grade = await db.get(`SELECT id, status FROM ai_batches WHERE kind = 'eval_grade' AND root_id = ? ORDER BY id DESC LIMIT 1`, [id]);
  res.json({ id: Number(b.id), status: b.status, grading: grade ? { id: Number(grade.id), status: grade.status } : null,
    results: o.eval || null, answered: o.answered ?? null, created_at: b.created_at });
}));

router.get('/:id/translation-draft', handle(async (req, res, db, lang) => {
  const id = idOf(req); if (!id) return notFound(res, lang);
  const b = await db.get(`SELECT id, status, output FROM ai_batches WHERE id = ? AND kind = 'translate_keys'`, [id]);
  const o = b && (typeof b.output === 'string' ? JSON.parse(b.output) : b.output);
  if (!o || o.kind !== 'translation_draft') return res.status(404).json({ error: msg(lang, 'srcchk.err.draft_not_ready'), code: 'draft_not_ready' });
  res.set('Content-Disposition', `attachment; filename="translation-draft-${id}.json"`);
  res.json(o);
}));

export default router;
