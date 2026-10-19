/**
 * routes/rights.js — know-your-rights card (core path step 1). Public: people
 * in a police station must not need an account; the app caches the response
 * per state for airplane mode.
 *
 * GET /api/rights/states        — [{ code, name, state_specific_available }]
 * GET /api/rights/:state?lang=  — (lang: ?lang= or Accept-Language; en/es/pt/vi, else en)
 *                                 general (federal) sections + the state's
 *                                 sourced sections + the 30-second script.
 *                                 Every section has source + last_reviewed.
 *                                 State sections only when cited / reviewed;
 *                                 otherwise general + state_notice ("haven't
 *                                 been reviewed yet"). Unknown code → 400.
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { apiLimiter } from '../middleware/rateLimiters.js';
import logger from '../utils/logger.js';
import { STATE_NAMES, getRightsCard, normalizeState, reviewedStateCodes } from '../services/rightsContent.js';
import { resolveLang, msg, stateName } from '../i18n/index.js';

const router = Router();

// state_specific_available is true only where a cited / reviewed rights_cards
// row exists (the built-in summaries are unreviewed and never shown).
router.get('/states', apiLimiter, async (req, res) => {
  const db = await getDb().catch(() => null);
  const reviewed = await reviewedStateCodes(db);
  const lang = resolveLang(req);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'Accept-Language');
  res.json({
    language: lang,
    states: Object.entries(STATE_NAMES).map(([code, name]) => ({
      code, name, name_local: stateName(code, name, lang), state_specific_available: reviewed.has(code),
    })),
  });
});

router.get('/:state', apiLimiter, async (req, res) => {
  const raw = String(req.params.state || '');
  const lang = resolveLang(req);
  const isGeneral = /^(us|all|general)$/i.test(raw);
  if (!isGeneral && !normalizeState(raw)) {
    return res.status(400).json({ error: msg(lang, 'rights.err.bad_state'), code: 'bad_state' });
  }
  try {
    const db = await getDb().catch(() => null);
    const card = await getRightsCard(db, isGeneral ? null : raw, { lang });
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('Vary', 'Accept-Language');
    res.setHeader('Content-Language', card.language);
    res.json(card);
  } catch (e) {
    logger.error({ err: e.message }, '[rights] card failed');
    res.status(500).json({ error: msg(lang, 'rights.err.server'), code: 'server_error' });
  }
});

export default router;
