/**
 * routes/admin/barVerification.js — Admin endpoints for bar verification
 */
import { Router } from 'express';
import { asyncRoute } from '../../utils/routeHelpers.js';
import { runNightlyVerification, verifyAttorneyLicense } from '../../services/barVerification.js';
import { authRequired } from '../../middleware/auth.js';

const router = Router();

/** Trigger a full verification sweep (admin only) */
router.post('/sweep', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const result = await runNightlyVerification();
  return res.json({ data: result });
}));

/** Verify a single attorney by bar number */
router.get('/verify/:bar_number', authRequired, asyncRoute(async (req, res) => {
  const { bar_number } = req.params;
  const { state } = req.query;
  const result = await verifyAttorneyLicense({ bar_number, bar_state: state });
  return res.json({ data: result });
}));

/** Get attorneys flagged for manual review */
router.get('/flagged', authRequired, asyncRoute(async (req, res) => {
  const flagged = await req.db.all(`
    SELECT id, full_name, bar_number, bar_state, license_status, last_verified_at
    FROM lawyer_profiles
    WHERE license_status NOT IN ('active') 
       OR license_status IS NULL
    ORDER BY last_verified_at ASC
    LIMIT 100
  `);
  return res.json({ data: flagged });
}));

export default router;
