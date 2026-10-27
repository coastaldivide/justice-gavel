/**
 * routes/results.js — GET /api/results (public): the latest results snapshot an admin published
 * (B11; services/results.js). 404 { code: 'not_published' } until one is published — the public
 * /results page then shows nothing. Never computed live: only what an admin published.
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { resolveLang, msg } from '../i18n/index.js';
import { latestSnapshot } from '../services/results.js';

const router = Router();

router.get('/', async (req, res) => {
  const lang = resolveLang(req);
  try {
    const snap = await latestSnapshot(await getDb());
    res.set('Cache-Control', 'public, max-age=300');
    if (!snap) return res.status(404).json({ error: msg(lang, 'results.err.not_published'), code: 'not_published' });
    const { published_by: _p, ...pub } = snap;
    res.json({ snapshot: pub });
  } catch (e) {
    logger.error({ err: e.message }, '[results]');
    res.status(500).json({ error: msg(lang, 'results.err.server'), code: 'server_error' });
  }
});

export default router;
