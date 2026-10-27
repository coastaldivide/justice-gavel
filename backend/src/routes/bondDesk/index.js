/**
 * routes/bondDesk/index.js — /api/bond-desk (docs/BOND_DESK.md): bond paperwork with typed
 * e-signatures, bond records, ledger and receipts, collateral, powers and reports for bail
 * agents on a bail-agent plan (or admins).
 *
 *   GET /access   (signed in; never 403) whether the caller can use Bond Desk and why not
 *   GET /staff/invite/:token, POST /staff/accept  (signed in) a staff invitation (services/bondDesk/staff.js)
 *   everything else: bail agent with a plan, or their staff → bonds.js, forms.js, paperwork.js, reports.js,
 *   courtDates.js, watch.js (re-arrest alerts, timeline,
 *   recovery-agent sharing — ⚖ settings, see features), payments.js (card payments, automatic payments, pay link), agency.js (staff, forms
 *   setup, import, export)
 */
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { handle, requireBondDesk, body } from './_common.js';
import { agentAccess } from '../../services/bondDesk/core.js';
import { AGENT_TEXT_CENTS } from '../billing/plans.js';
import { smsLive } from '../../services/sms.js';
import { emailLive } from '../../services/email.js';
import { getAttachmentStorage } from '../../services/attachmentStorage.js';
import bonds from './bonds.js';
import paperwork from './paperwork.js';
import reports from './reports.js';
import courtDates from './courtDates.js';
import watch from './watch.js';
import { rearrestAlertsEnabled, recoverySharingEnabled } from '../../utils/counselFlags.js';
import forms from './forms.js';
import payments from './payments.js';
import agency from './agency.js';
import { invitePreview, acceptInvite } from '../../services/bondDesk/staff.js';
import { autopayEnabled } from '../../services/bondDesk/autopay.js';
import { audit } from '../../utils/audit.js';
import { resolveLang, msg } from '../../i18n/index.js';

const router = Router();
const tooMany = (req) => { const lang = resolveLang(req); return msg(lang, 'bd.err.too_many_requests'); };
const limiter = makeUserLimiter({ windowMs: 60_000, max: 120, message: tooMany });

router.use(authRequired, limiter);

router.get('/access', handle(async (req, res, db) => {
  const a = await agentAccess(db, req.user);
  res.json({ allowed: a.allowed, reason: a.reason, plan: a.plan, role: a.allowed ? a.role : null, texts_live: smsLive(), email_live: emailLive(),
    storage_live: !!(await getAttachmentStorage().catch(() => null)), text_cents: AGENT_TEXT_CENTS, autopay_enabled: autopayEnabled(),
    // ⚖ features behind a setting until counsel answers (utils/counselFlags.js); the app hides them when false
    features: { rearrest_alerts: rearrestAlertsEnabled(), recovery_sharing: recoverySharingEnabled() } });
}));

// Staff invitations: the invited person is not in the agency yet, so these come before requireBondDesk.
router.get('/staff/invite/:token', handle(async (req, res, db) => {
  res.json(await invitePreview(db, { token: req.params.token, user: req.user }));
}));
router.post('/staff/accept', handle(async (req, res, db) => {
  const out = await acceptInvite(db, { token: body(req).token, user: req.user });
  await audit('bond_desk.staff_joined', { userId: req.user.id, req, entityType: 'user', entityId: req.user.id, metadata: { agency: out.agency } });
  res.json(out);
}));

router.use(requireBondDesk);
router.use(bonds);
router.use(forms);
router.use(paperwork);
router.use(reports);
router.use(courtDates);
router.use(watch);
router.use(payments);
router.use(agency);

export default router;
