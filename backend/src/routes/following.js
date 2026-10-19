/**
 * routes/following.js — the family follower's side (services/followers.js).
 *
 * POST   /api/following/accept   { code }  — accept an invite (rate limited)
 * GET    /api/following                   — cases I follow + their court dates (no notes, ever)
 * DELETE /api/following/:id               — stop following
 *
 * The owner's side lives on the case: POST/GET /api/cases/:id/followers,
 * DELETE /api/cases/:id/followers/:followId.
 */
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import logger from '../utils/logger.js';
import { acceptInvite, listFollowing, leaveFollow, FollowError } from '../services/followers.js';

const router = Router();
const acceptLimiter = makeUserLimiter({ windowMs: 15 * 60_000, max: 10, message: 'Too many tries. Wait a few minutes and try again.' });

function fail(res, e, where) {
  if (e instanceof FollowError) return res.status(e.status).json({ error: e.message, code: e.code });
  logger.error({ err: e.message }, `[following${where}]`);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

router.post('/accept', authRequired, acceptLimiter, async (req, res) => {
  try {
    const following = await acceptInvite(await getDb(), req.user.id, req.body?.code);
    res.status(201).json({ ok: true, following });
  } catch (e) { fail(res, e, '/accept'); }
});

router.get('/', authRequired, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ following: await listFollowing(await getDb(), req.user.id) });
  } catch (e) { fail(res, e, ''); }
});

router.delete('/:id', authRequired, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id.' });
  try {
    res.json(await leaveFollow(await getDb(), req.user.id, id));
  } catch (e) { fail(res, e, '/:id'); }
});

export default router;
