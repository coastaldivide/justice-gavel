/**
 * expungement/attorneys.js — GET /attorneys — find expungement attorneys
 */
import { err400, err401, err403, err404, err409, err422, err500, err502,
         safeInt, sanitizeStr, validateEmail } from '../../utils/routeHelpers.js';
import { Router }         from 'express';
import { authRequired }   from '../../middleware/auth.js';
import { getDb }          from '../../db/index.js';
import { perUserAiLimit } from '../../middleware/sharedAiLimiter.js';
import logger             from '../../utils/logger.js';
import { STATE_RULES, DEFAULT_RULES, classifyCharge, getEligibility } from './rules.js';

const router = Router();


router.get('/attorneys', async (req, res) => {
  try {
    const { state = 'TN', limit = 10 } = req.query;
    const db = await getDb();

    // Pull lawyers who have 'expungement' or 'record sealing' in specialties
    const rows = await db.all(
      `SELECT id, name, phone, address, city, state as lawyer_state,
              rating, reviews, bar_number, verified, bar_verified, jtb_verified,
              gavel_level, golden_gavel, free_consultation, specialties, bio, lat, lng
       FROM lawyers
       WHERE (
         LOWER(specialties) LIKE '%expungement%'
         OR LOWER(specialties) LIKE '%record seal%'
         OR LOWER(specialties) LIKE '%record clean%'
         OR LOWER(specialties) LIKE '%criminal defense%'
         OR LOWER(bio) LIKE '%expungement%'
       )
       AND (
         LOWER(city) LIKE ?
         OR LOWER(state) = ?
         OR state IS NULL
       )
       ORDER BY
         jtb_verified DESC,
         bar_verified DESC,
         gavel_level DESC,
         rating DESC
       LIMIT ?`,
      [`%${state.toLowerCase()}%`, state.toLowerCase(), safeInt(limit)]
    );

    if (rows.length === 0) {
      // Fallback: any criminal defense attorney in that state
      const fallback = await db.all(
        `SELECT id, name, phone, address, city, rating, reviews,
                bar_verified, jtb_verified, gavel_level, free_consultation, specialties
         FROM lawyers
         WHERE LOWER(state)=? OR state IS NULL
         ORDER BY jtb_verified DESC, bar_verified DESC, gavel_level DESC, rating DESC
         LIMIT ?`,
        [state.toLowerCase(), safeInt(limit)]
      );
      return res.json({ attorneys: fallback, state, matched: false, count: fallback.length });
    }

    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return res.json({ attorneys: rows, state, matched: true, count: rows.length });
  } catch (e) { logger.error('[expungement/attorneys]', e.message); res.status(500).json({ error: 'Server error. Please try again.' }); }
});


export default router;
