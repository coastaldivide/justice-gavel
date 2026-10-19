/**
 * routes/rights.js — know-your-rights card (core path step 1). Public: people
 * in a police station must not need an account; the app caches the response
 * per state for airplane mode.
 *
 * GET /api/rights/states        — [{ code, name, state_specific_available }]
 * GET /api/rights/:state?lang=  — general (federal) sections + the state's
 *                                 sourced sections + the 30-second script.
 *                                 Every section has source + last_reviewed.
 *                                 Unknown code → 400; known code without
 *                                 state notes → general + state_notice.
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { apiLimiter } from '../middleware/rateLimiters.js';
import logger from '../utils/logger.js';
import { STATE_NAMES, STATE_RIGHTS, getRightsCard, normalizeState } from '../services/rightsContent.js';

const router = Router();

router.get('/states', apiLimiter, (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json({
    states: Object.entries(STATE_NAMES).map(([code, name]) => ({
      code, name, state_specific_available: !!STATE_RIGHTS[code],
    })),
  });
});

router.get('/:state', apiLimiter, async (req, res) => {
  const raw = String(req.params.state || '');
  const isGeneral = /^(us|all|general)$/i.test(raw);
  if (!isGeneral && !normalizeState(raw)) {
    return res.status(400).json({ error: 'Unknown state code. Use a two-letter code such as TN, or US for the general card.', code: 'bad_state' });
  }
  try {
    const db = await getDb().catch(() => null);
    const card = await getRightsCard(db, isGeneral ? null : raw, { lang: req.query.lang });
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.json(card);
  } catch (e) {
    logger.error({ err: e.message }, '[rights] card failed');
    res.status(500).json({ error: 'Could not load the rights card.', code: 'server_error' });
  }
});

export default router;
