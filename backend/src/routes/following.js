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
import { resolveLang, requestedLang, msg, rememberLanguage } from '../i18n/index.js';
import { rescheduleUserCourtReminders } from '../services/courtReminders.js';

const router = Router();
const acceptLimiter = makeUserLimiter({ windowMs: 15 * 60_000, max: 10, message: (req) => msg(resolveLang(req), 'follow.err.too_many_tries') });

function fail(req, res, e, where) {
  const lang = resolveLang(req);
  if (e instanceof FollowError) return res.status(e.status).json({ error: e.localizedMessage(lang), code: e.code });
  logger.error({ err: e.message }, `[following${where}]`);
  return res.status(500).json({ error: msg(lang, 'follow.err.server') });
}

router.post('/accept', authRequired, acceptLimiter, async (req, res) => {
  try {
    const db = await getDb();
    // The follower's reminders are written in their language: remember it first.
    if (await rememberLanguage(db, req.user.id, requestedLang(req)).catch(() => false)) {
      await rescheduleUserCourtReminders(db, req.user.id).catch(() => 0);
    }
    const following = await acceptInvite(db, req.user.id, req.body?.code);
    res.status(201).json({ ok: true, following });
  } catch (e) { fail(req, res, e, '/accept'); }
});

router.get('/', authRequired, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const lang = resolveLang(req);
    res.json({ language: lang, following: await listFollowing(await getDb(), req.user.id, { lang }) });
  } catch (e) { fail(req, res, e, ''); }
});

router.delete('/:id', authRequired, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: msg(resolveLang(req), 'follow.err.bad_id') });
  try {
    res.json(await leaveFollow(await getDb(), req.user.id, id));
  } catch (e) { fail(req, res, e, '/:id'); }
});

export default router;
