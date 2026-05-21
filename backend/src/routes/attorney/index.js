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
 */
import { Router }       from 'express';
import casesRouter      from './cases.js';
import templatesRouter  from './templates.js';
import cleRouter        from './cle.js';
import profileRouter    from './profile.js';
import verifyRouter     from './verification.js';

const router = Router();
router.use('/', casesRouter);
router.use('/', templatesRouter);
router.use('/', cleRouter);
router.use('/', profileRouter);
router.use('/', verifyRouter);

export default router;
