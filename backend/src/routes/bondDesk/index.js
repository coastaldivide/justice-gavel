/**
 * routes/bondDesk/index.js — /api/bond-desk (docs/BOND_DESK.md): bond paperwork with typed
 * e-signatures, bond records, ledger and receipts, collateral, powers and reports for bail
 * agents on a bail-agent plan (or admins).
 *
 *   GET /access   (signed in; never 403) whether the caller can use Bond Desk and why not
 *   everything else: bail agent with a plan → bonds.js, paperwork.js, reports.js
 */
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.js';
import { makeUserLimiter } from '../../middleware/sharedAiLimiter.js';
import { handle, requireBondDesk } from './_common.js';
import { agentAccess } from '../../services/bondDesk/core.js';
import { AGENT_TEXT_CENTS } from '../billing/plans.js';
import { smsLive } from '../../services/sms.js';
import { emailLive } from '../../services/email.js';
import { getAttachmentStorage } from '../../services/attachmentStorage.js';
import bonds from './bonds.js';
import paperwork from './paperwork.js';
import reports from './reports.js';
import { resolveLang, msg } from '../../i18n/index.js';

const router = Router();
const tooMany = (req) => { const lang = resolveLang(req); return msg(lang, 'bd.err.too_many_requests'); };
const limiter = makeUserLimiter({ windowMs: 60_000, max: 120, message: tooMany });

router.use(authRequired, limiter);

router.get('/access', handle(async (req, res, db) => {
  const a = await agentAccess(db, req.user);
  res.json({ allowed: a.allowed, reason: a.reason, plan: a.plan, texts_live: smsLive(), email_live: emailLive(),
    storage_live: !!(await getAttachmentStorage().catch(() => null)), text_cents: AGENT_TEXT_CENTS });
}));

router.use(requireBondDesk);
router.use(bonds);
router.use(paperwork);
router.use(reports);

export default router;
