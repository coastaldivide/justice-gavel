/**
 * routes/caseSteps.js — "Your case, step by step" progress for one of the person's own cases
 * (services/caseSteps.js, migration 43). Signed in, owner only: another account's case is a 404.
 *
 * GET /api/case-steps/:caseId   → { case_id, case_title, state, stage, checked, auto, next_court_date,
 *                                   share_stage, updated_at }
 * PUT /api/case-steps/:caseId   { stage?: <stage id>|null, checked?: { "<item id>": bool }, share_stage?: bool }
 *
 * Guests keep their progress on the device (frontend services/caseSteps.ts). A family follower
 * sees only the stage name, and only when share_stage is on (GET /api/following → case_stage).
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { resolveLang, msg } from '../i18n/index.js';
import { getSteps, saveSteps, StepsError } from '../services/caseSteps.js';

const router = Router();
const writeLimiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: (req) => msg(resolveLang(req), 'cst.err.too_many') });

function caseIdParam(req, res) {
  const id = Number.parseInt(req.params.caseId, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== String(req.params.caseId)) {
    const m = msg(resolveLang(req), 'cst.err.bad_case');
    res.status(400).json({ error: m, code: 'bad_case', message: m });
    return null;
  }
  return id;
}

function fail(req, res, e, where) {
  const lang = resolveLang(req);
  if (e instanceof StepsError) {
    const m = msg(lang, `cst.err.${e.code}`);
    return res.status(e.status).json({ error: m, code: e.code, message: m });
  }
  logger.error({ err: e.message }, `[case-steps${where}]`);
  const m = msg(lang, 'cst.err.server');
  return res.status(500).json({ error: m, code: 'server_error', message: m });
}

router.get('/:caseId', authRequired, async (req, res) => {
  const id = caseIdParam(req, res); if (!id) return;
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getSteps(await getDb(), req.user.id, id));
  } catch (e) { fail(req, res, e, '/get'); }
});

router.put('/:caseId', authRequired, writeLimiter, async (req, res) => {
  const id = caseIdParam(req, res); if (!id) return;
  try {
    res.json(await saveSteps(await getDb(), req.user.id, id, req.body));
  } catch (e) { fail(req, res, e, '/put'); }
});

export default router;
