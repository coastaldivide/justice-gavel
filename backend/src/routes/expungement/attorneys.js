/**
 * expungement/attorneys.js — GET /attorneys — lawyers in a state whose listing
 * mentions expungement / record sealing (then criminal defense), public shape.
 *
 * Read only: the lawyer rows are real directory data (never changed here).
 */
import { Router }        from 'express';
import { getDb }         from '../../db/index.js';
import { apiLimiter }    from '../../middleware/rateLimiters.js';
import { safeInt }       from '../../utils/routeHelpers.js';
import { msg, resolveLang } from '../../i18n/index.js';
import { LAWYER_COLS }   from '../providers.js';
import { formatLawyer }  from '../../services/providerDirectory.js';
import logger            from '../../utils/logger.js';
import { STATE_RULES }   from './rules.js';

const router = Router();

const RECORD_WORDS = /expunge|record seal|record clean|sealing|clear (your|my)? ?record/i;
const DEFENSE_WORDS = /criminal/i;

router.get('/attorneys', apiLimiter, async (req, res) => {
  const lang = resolveLang(req);
  const state = String(req.query.state || '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(STATE_RULES, state)) {
    return res.status(400).json({ error: msg(lang, 'expungement.err.invalid_state'), code: 'invalid_state' });
  }
  const limit = Math.min(Math.max(safeInt(req.query.limit, 10) || 10, 1), 20);
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT ${LAWYER_COLS} FROM lawyers l WHERE COALESCE(l.active, 1) = 1 AND UPPER(l.state) = ?`, [state]);
    const text = (r) => `${r.specialties || ''} ${r.bio || ''}`;
    const record = rows.filter(r => RECORD_WORDS.test(text(r)));
    const pool = record.length ? record : rows.filter(r => DEFENSE_WORDS.test(text(r)));
    // Listing completeness, then rating — never paid placement.
    const score = (r) => (r.phone ? 2 : 0) + (r.website ? 1 : 0) + (r.address ? 1 : 0);
    pool.sort((a, b) => score(b) - score(a) || (Number(b.rating) || 0) - (Number(a.rating) || 0) || Number(a.id) - Number(b.id));
    const attorneys = pool.slice(0, limit).map(r => formatLawyer(r));
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return res.json({ attorneys, state, matched: record.length > 0, count: attorneys.length });
  } catch (e) {
    logger.error('[expungement/attorneys]', e.message);
    return res.status(500).json({ error: msg(lang, 'expungement.err.server'), code: 'server_error' });
  }
});

export default router;
