/**
 * attorney/index.js — Attorney Platform module entry point
 *
 * Mounts at /api/attorney in app.js.
 *
 *   _helpers.js      — sanitiseField, requireDefender, STATE_BAR_LOOKUP
 *   cases.js         — /cases, /office
 *   templates.js     — /templates
 *   cle.js           — /cle
 *   profile.js       — /profile, /profile/availability
 *   verification.js  — /verify-bar, /approve-verification
  *   inbox.js        — /inbox (unified attorney command center)
 */
import { Router }       from 'express';
import casesRouter      from './cases.js';
import templatesRouter  from './templates.js';
import cleRouter        from './cle.js';
import profileRouter    from './profile.js';
import verifyRouter     from './verification.js';
import inboxRouter     from './inbox.js';

const router = Router();
router.use('/', inboxRouter);
router.use('/', casesRouter);
router.use('/', inboxRouter);
router.use('/', templatesRouter);
router.use('/', inboxRouter);
router.use('/', cleRouter);
router.use('/', inboxRouter);
router.use('/', profileRouter);
router.use('/', inboxRouter);
router.use('/', verifyRouter);

export default router;
