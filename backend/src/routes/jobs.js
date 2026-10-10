/**
 * jobs.js — Job status polling endpoint
 *
 * GET  /api/jobs/stats — queue health
 * GET  /api/jobs/:id   — poll a job (only the user who created it can see it)
 *
 * Response shapes:
 *   pending:    { id, type, status: 'pending',    queuedAt }
 *   processing: { id, type, status: 'processing', queuedAt, startedAt }
 *   done:       { id, type, status: 'done',       result, completedAt }
 *   failed:     { id, type, status: 'failed',     error,  completedAt }
 */
import { err400, err404 } from '../utils/routeHelpers.js';
import logger from '../utils/logger.js';
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getJobAsync, queueStats } from '../services/aiQueue.js';

const router = Router();

// GET /api/jobs/stats — queue health (registered before /:id)
router.get('/stats', async (req, res) => {
  try {
    res.json(await queueStats());
  } catch (e) {
    logger.error({ msg: '[jobs/stats]', error: e?.message });
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// GET /api/jobs/:id — poll job status
router.get('/:id', authRequired, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^[\w-]{1,64}$/.test(id)) return err400(res, 'Invalid id');
    const job = await getJobAsync(id);
    if (!job || (job.userId != null && String(job.userId) !== String(req.user.id))) {
      return err404(res, 'Job not found or expired (15 minute TTL)');
    }
    res.json({
      id:          job.id,
      type:        job.type,
      status:      job.status,
      result:      job.status === 'done'   ? job.result : null,
      error:       job.status === 'failed' ? job.error  : null,
      queuedAt:    job.queuedAt,
      startedAt:   job.startedAt   || null,
      completedAt: job.completedAt || null,
    });
  } catch (e) {
    logger.error({ msg: '[jobs]', error: e?.message });
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

export default router;
