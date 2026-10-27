/**
 * routes/following.js — the family follower's side (services/followers.js).
 *
 * POST   /api/following/accept   { code }  — accept an invite (rate limited)
 * GET    /api/following                   — cases I follow + their court dates (no notes, ever)
 * DELETE /api/following/:id               — stop following
 * POST   /api/following/:id/court-dates/:cdId/ride-offer — "Offer a ride" (followers who get reminders;
 *                                           the owner gets a push and can accept / decline — services/courtDayHelp.js)
 * DELETE /api/following/:id/court-dates/:cdId/ride-offer — take the offer back
 * GET /api/following also says, per court date, `ride_offer` (my offer's status) and `can_offer_ride`.
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
import { rescheduleUserCourtReminders, resolveReminderTimeZone } from '../services/courtReminders.js';
import { offerRide, withdrawRide, myRideOffers, HelpError } from '../services/courtDayHelp.js';
import { todayInZone } from '../utils/timezone.js';

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
    const db = await getDb();
    const following = await listFollowing(db, req.user.id, { lang });
    const offers = await myRideOffers(db, req.user.id);
    for (const f of following) {
      for (const d of f.court_dates) {
        d.ride_offer = offers[d.id] || null;
        d.can_offer_ride = f.share_reminders && !d.is_past && d.status === 'scheduled';
      }
    }
    res.json({ language: lang, following });
  } catch (e) { fail(req, res, e, ''); }
});

router.delete('/:id', authRequired, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: msg(resolveLang(req), 'follow.err.bad_id') });
  try {
    res.json(await leaveFollow(await getDb(), req.user.id, id));
  } catch (e) { fail(req, res, e, '/:id'); }
});

// ── A8 "Offer a ride" ─────────────────────────────────────────────────────────
const rideLimiter = makeUserLimiter({ windowMs: 60 * 60_000, max: 20, message: (req) => msg(resolveLang(req), 'ride.err.too_many') });
function ids(req, res) {
  const id = Number.parseInt(req.params.id, 10); const cd = Number.parseInt(req.params.cdId, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(cd) || cd <= 0) {
    res.status(400).json({ error: msg(resolveLang(req), 'follow.err.bad_id') }); return null;
  }
  return { followId: id, courtDateId: cd };
}
function rideFail(req, res, e) {
  if (e instanceof HelpError) return res.status(e.status).json({ error: msg(resolveLang(req), `ride.err.${e.code}`), code: e.code });
  return fail(req, res, e, '/ride-offer');
}
router.post('/:id/court-dates/:cdId/ride-offer', authRequired, rideLimiter, async (req, res) => {
  const p = ids(req, res); if (!p) return;
  try {
    const db = await getDb();
    const { tz } = await resolveReminderTimeZone(db, req.user.id, null);
    const r = await offerRide(db, { followerId: req.user.id, ...p, today: todayInZone(tz) });
    res.status(r.already ? 200 : 201).json(r);
  } catch (e) { rideFail(req, res, e); }
});
router.delete('/:id/court-dates/:cdId/ride-offer', authRequired, rideLimiter, async (req, res) => {
  const p = ids(req, res); if (!p) return;
  try {
    res.json(await withdrawRide(await getDb(), { followerId: req.user.id, ...p }));
  } catch (e) { rideFail(req, res, e); }
});

export default router;
