/**
 * routes/custody.js — release / transfer alerts for families (A9, ⚖ counsel question 6.3,
 * CUSTODY_ALERTS_ENABLED; services/custodyAlerts.js, docs/CUSTODY_ALERTS.md).
 *
 *   GET    /api/custody/status              { enabled, max_follows, texts_live } (never 503)
 *   GET    /api/custody/follows             my follows: the booking as the roster shows it + its events
 *   POST   /api/custody/follows             { arrest_id, consent: true, case_id?, text_opt_in?, phone?, text_consent? }
 *   PATCH  /api/custody/follows/:id         { case_id? , text_opt_in?, phone?, text_consent? }
 *   DELETE /api/custody/follows/:id         unfollow (any time)
 *   GET    /api/custody/arrest/:arrestId    { follow_id, trackable } for the arrest record page
 * Everything but /status answers 503 feature_unavailable while the setting is off.
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { msg, resolveLang } from '../i18n/index.js';
import { smsLive } from '../services/sms.js';
import { safeInt } from '../utils/routeHelpers.js';
import { custodyAlertsEnabled } from '../utils/counselFlags.js';
import {
  CustodyError, MAX_FOLLOWS, followBooking, followFor, followableArrest, listFollows, unfollow, updateFollow,
} from '../services/custodyAlerts.js';

const router = Router();
const say = (req, key, p) => msg(resolveLang(req), key, p);
const limiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: (req) => say(req, 'custody.err.too_many_requests') });
const writeLimiter = makeUserLimiter({ windowMs: 60 * 60_000, max: 30, message: (req) => say(req, 'custody.err.too_many_requests') });

function fail(req, res, e) {
  if (e instanceof CustodyError) return res.status(e.status).json({ error: say(req, `custody.err.${e.code}`, { max: MAX_FOLLOWS }), code: e.code });
  logger.error({ err: e?.message }, '[custody]');
  return res.status(500).json({ error: say(req, 'custody.err.server'), code: 'server_error' });
}
const handle = (fn) => async (req, res) => {
  try { await fn(req, res, await getDb()); } catch (e) { fail(req, res, e); }
};
const on = (req, res, next) => (custodyAlertsEnabled() ? next()
  : res.status(503).json({ error: say(req, 'custody.err.feature_unavailable'), code: 'feature_unavailable' }));
const b = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

router.use(authRequired, limiter);

router.get('/status', (req, res) => {
  res.json({ enabled: custodyAlertsEnabled(), max_follows: MAX_FOLLOWS, texts_live: smsLive() });
});

router.get('/follows', on, handle(async (req, res, db) => {
  res.json({ follows: await listFollows(db, req.user.id), max_follows: MAX_FOLLOWS, texts_live: smsLive() });
}));

router.post('/follows', on, writeLimiter, handle(async (req, res, db) => {
  const id = await followBooking(db, req.user.id, b(req));
  res.status(201).json({ follow_id: id, follows: await listFollows(db, req.user.id) });
}));

router.patch('/follows/:id', on, writeLimiter, handle(async (req, res, db) => {
  const id = await updateFollow(db, req.user.id, req.params.id, b(req));
  res.json({ follow_id: id, follows: await listFollows(db, req.user.id) });
}));

router.delete('/follows/:id', on, handle(async (req, res, db) => {
  await unfollow(db, req.user.id, req.params.id);
  res.json({ ok: true });
}));

router.get('/arrest/:arrestId', on, handle(async (req, res, db) => {
  const arrestId = safeInt(req.params.arrestId, 0);
  if (!arrestId || arrestId <= 0) throw new CustodyError(404, 'not_found');
  let trackable = true;
  try { await followableArrest(db, arrestId); } catch (e) {
    if (!(e instanceof CustodyError) || e.code !== 'not_trackable') throw e;
    trackable = false;
  }
  res.json({ follow_id: await followFor(db, req.user.id, arrestId), trackable });
}));

export default router;
