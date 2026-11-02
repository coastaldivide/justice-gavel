/**
 * routes/legalSources.js — GET /api/legal-sources/status (public): the "checked on" dates and
 * withhold flags the source re-checks recorded for the reference sources the app bundles itself
 * (court guide / case steps sources, court rules, transit agencies — docs/AI_PLATFORM.md §9).
 * The app merges them over its bundled dates (components/GuideSourceList.tsx). Only public
 * reference data; nothing about any person.
 *   ?dataset=guide | court_rules | transit   (default: all three)
 */
import { Router } from 'express';
import { apiLimiter } from '../middleware/rateLimiters.js';
import { datasetOverlay } from '../ai/sourceOverlay.js';

const PUBLIC_DATASETS = ['guide', 'court_rules', 'transit'];
const router = Router();

router.get('/status', apiLimiter, (req, res) => {
  const want = String(req.query.dataset || '');
  const sets = PUBLIC_DATASETS.includes(want) ? [want] : PUBLIC_DATASETS;
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ datasets: Object.fromEntries(sets.map((d) => [d, datasetOverlay(d)])) });
});

export default router;
