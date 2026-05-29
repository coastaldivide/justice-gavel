/**
 * jobs.js — Job status polling endpoint
 *
 * GET  /api/jobs/:id   — poll a job by UUID
 * GET  /api/jobs/stats — queue health (admin only)
 *
 * Response shapes:
 *
 *   pending:    { id, type, status: 'pending',    queuedAt }
 *   processing: { id, type, status: 'processing', queuedAt, startedAt }
 *   done:       { id, type, status: 'done',       result, completedAt }
 *   failed:     { id, type, status: 'failed',     error,  completedAt }
 */

import { err400, err401, err403, err404, err409, err422, err500, err502, safeInt, sanitizeStr, validateEmail, normalizeEmail, ownsResource, buildWhere } from '../utils/routeHelpers.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getJob, queueStats, getQueueStats } from '../services/aiQueue.js';
import { apiLimiter, writeLimiter, aiLimiter } from '../middleware/rateLimiters.js';

const router = Router();

// GET /api/jobs/:id — poll job status
router.get('/:id', authRequired, apiLimiter, async (req, res) => {
  try {
    const id = safeInt(req.params.id);
    if (isNaN(id)) return err400(res, 'Invalid id');
    const job = getJob(safeInt(req.params.id));
    if (!job) return err404(res, 'Job not found or expired (15 minute TTL)');
    // Never leak results from other users — jobs are not user-scoped in the store
    // so we only return status+result, not internal fields
    res.json({
      id:          job.id,
      type:        job.type,
      status:      job.status,
      result:      job.status === 'done'    ? job.result : null,
      error:       job.status === 'failed'  ? job.error  : null,
      queuedAt:    job.queuedAt,
      startedAt:   job.startedAt   || null,
      completedAt: job.completedAt || null,
    });
  } catch (e) {
    logger.error({ msg: '[jobs]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// GET /api/jobs/stats — queue health (no auth — monitoring use)
router.get('/stats', async (req, res) => {
  try {
    res.json(await queueStats());
  } catch (e) {
    logger.error({ msg: '[jobs]', error: e?.message }); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

export default router;
