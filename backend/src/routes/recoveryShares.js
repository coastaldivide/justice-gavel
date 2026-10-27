/**
 * routes/recoveryShares.js — the recovery agent's side of a shared forfeited bond (B4, ⚖
 * BOND_RECOVERY_SHARING_ENABLED; services/bondDesk/recoveryShares.js). Any signed-in account.
 *
 *   POST /api/recovery-shares/accept   { token }  accept an e-mailed invite (the account must use
 *                                                 the invited e-mail address)
 *   GET  /api/recovery-shares                     my live shares
 *   GET  /api/recovery-shares/:id                 the read-only file (every view is logged)
 *   GET  /api/recovery-shares/:id/photo           the defendant's photo, if on file (logged)
 * Read-only: nothing here changes the bond. 503 feature_unavailable while the setting is off.
 */
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { makeUserLimiter } from '../middleware/sharedAiLimiter.js';
import { getDb } from '../db/index.js';
import logger from '../utils/logger.js';
import { msg, resolveLang } from '../i18n/index.js';
import { recoverySharingEnabled } from '../utils/counselFlags.js';
import { acceptShare, shareDetails, sharePhoto, sharesForRecoveryAgent, ShareError } from '../services/bondDesk/recoveryShares.js';
import { getAttachmentStorage } from '../services/attachmentStorage.js';
import { sendFile } from './bondDesk/_common.js';
import { safeInt } from '../utils/routeHelpers.js';

const router = Router();
const limiter = makeUserLimiter({ windowMs: 60_000, max: 60, message: (req) => msg(resolveLang(req), 'bd.err.too_many_requests') });
const acceptLimiter = makeUserLimiter({ windowMs: 15 * 60_000, max: 10, message: (req) => msg(resolveLang(req), 'bd.err.too_many_requests') });

function fail(req, res, e) {
  const lang = resolveLang(req);
  if (e instanceof ShareError) return res.status(e.status).json({ error: msg(lang, `bd.err.${e.code}`, e.params), code: e.code });
  logger.error({ err: e?.message }, '[recovery-shares]');
  return res.status(500).json({ error: msg(lang, 'bd.err.server'), code: 'server_error' });
}
const handle = (fn) => async (req, res) => {
  try { await fn(req, res, await getDb()); } catch (e) { fail(req, res, e); }
};
const shareId = (v) => {
  const n = safeInt(v, 0);
  if (!n || n <= 0 || String(n) !== String(v)) throw new ShareError(404, 'not_found');
  return n;
};

router.use(authRequired, limiter, (req, res, next) => {
  if (recoverySharingEnabled()) return next();
  return res.status(503).json({ error: msg(resolveLang(req), 'bd.err.feature_unavailable'), code: 'feature_unavailable' });
});

router.post('/accept', acceptLimiter, handle(async (req, res, db) => {
  const id = await acceptShare(db, req.user, req.body?.token);
  res.json({ share_id: id });
}));

router.get('/', handle(async (req, res, db) => {
  res.json({ shares: await sharesForRecoveryAgent(db, req.user.id) });
}));

router.get('/:id', handle(async (req, res, db) => {
  res.set('Cache-Control', 'private, no-store');
  res.json(await shareDetails(db, req.user.id, shareId(req.params.id)));
}));

router.get('/:id/photo', handle(async (req, res, db) => {
  const storage = await getAttachmentStorage().catch(() => null);
  if (!storage) throw new ShareError(503, 'storage_unavailable');
  const p = await sharePhoto(db, storage, req.user.id, shareId(req.params.id));
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp' }[p.type] || 'img';
  sendFile(res, p.bytes, { type: p.type, name: `defendant.${ext}`, inline: true });
}));

export default router;
