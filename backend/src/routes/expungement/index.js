/**
 * expungement/index.js — Expungement module entry point
 *
 * Mounts at /api/expungement in app.js.
 *
 *   rules.js      — State eligibility data + classifyCharge/getEligibility helpers
 *   attorneys.js  — GET /attorneys
 *   check.js      — GET /check
 *   petition.js   — POST /petition (AI, requires subscription)
 */
import { Router } from 'express';
import attorneysRouter  from './attorneys.js';
import checkRouter      from './check.js';
import petitionRouter   from './petition.js';
import { authRequired }    from '../../middleware/auth.js';
import { getDb }           from '../../db/index.js';
import { err400 }          from '../../utils/routeHelpers.js';

const router = Router();
router.use('/', attorneysRouter);
router.use('/', checkRouter);
router.use('/', petitionRouter);

// POST /referral — track partner referral clicks
router.post('/referral', authRequired, async (req, res) => {
  try {
    const { case_id, state, charges, status, partner } = req.body || {};
    if (!partner) return res.status(400).json({ error: 'partner required' });
    const db = await getDb();
    await db.run(
      `INSERT OR IGNORE INTO expungement_referrals
         (user_id, case_id, state, partner, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [req.user.id, case_id || null, state || null, partner]
    ).catch(() => {});
    res.json({ logged: true });
  } catch { res.json({ logged: false }); }
});

export default router;

// Re-export helpers so test files and other modules can import from the index
export { classifyCharge, getEligibility, STATE_RULES, DEFAULT_RULES } from './rules.js';
