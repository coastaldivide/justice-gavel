/**
 * routes/bondDesk/payments.js — card payments for the agency (docs/BOND_DESK.md "Card payments",
 * "Automatic payments", "Pay link"). Mounted at /api/bond-desk after requireBondDesk.
 *
 *   GET  /connect                       card-payment status (Stripe Connect Express), pay link, fees
 *   POST /connect/start                 owner: { fees_acknowledged: true } → { url } Stripe onboarding
 *   POST /connect/refresh               re-read the account from Stripe (back from onboarding)
 *   POST /connect/dashboard             owner: → { url } the agency's Stripe Express dashboard
 *   PUT  /connect/pay-link              owner: { on } the public pay page on / off
 *   GET  /bonds/:id/autopay             automatic payments of the bond: status, attempts
 *   POST /bonds/:id/autopay/link        ⚖ { to, indemnitor_id?, deliver, consent_confirmed?, lang? } send the payer's link
 *   POST /bonds/:id/autopay/stop        { reason? }
 *   GET  /pay-requests?status=paid|attached   pay-page payments ("Unassigned payments")
 *   POST /pay-requests/:id/attach       { bond_id } → posted with a receipt, receipt sent to the payer
 */
import { Router } from 'express';
import { BdError, handle, fail, id, text, oneOf, body, ownerOnly } from './_common.js';
import { connectState, startOnboarding, refreshAccount, dashboardLink, setPayLink } from '../../services/bondDesk/connect.js';
import { autopayEnabled, autopayForBond, sendAutopayLink, stopAutopay } from '../../services/bondDesk/autopay.js';
import { listPayRequests, attachPayRequest } from '../../services/bondDesk/payLink.js';
import { loadBond } from './bonds.js';
import { normalizeLang } from '../../i18n/index.js';

// Errors: handle() (./_common.js) runs every handler inside try { … } catch → fail().
const router = Router();

/** ⚖ counsel 3.2: automatic payments are off until BOND_AUTOPAY_ENABLED (503 feature_unavailable). */
function autopayOn(req, res, next) {
  if (autopayEnabled()) return next();
  return fail(req, res, new BdError(503, 'feature_unavailable'));
}

router.get('/connect', handle(async (req, res, db) => {
  res.json({ ...(await connectState(db, req.agentId, { autopayOn: autopayEnabled() })), role: req.bdRole });
}));

router.post('/connect/start', ownerOnly, handle(async (req, res, db) => {
  if (body(req).fees_acknowledged !== true) throw new BdError(400, 'fees_ack_required');
  res.json(await startOnboarding(db, { agentId: req.agentId, user: req.user }));
}));

router.post('/connect/refresh', handle(async (req, res, db) => {
  await refreshAccount(db, req.agentId);
  res.json(await connectState(db, req.agentId, { autopayOn: autopayEnabled() }));
}));

router.post('/connect/dashboard', ownerOnly, handle(async (req, res, db) => {
  res.json(await dashboardLink(db, req.agentId));
}));

router.put('/connect/pay-link', ownerOnly, handle(async (req, res, db) => {
  const on = body(req).on;
  if (typeof on !== 'boolean') throw new BdError(400, 'invalid', { field: 'on' });
  await setPayLink(db, req.agentId, on);
  res.json(await connectState(db, req.agentId, { autopayOn: autopayEnabled() }));
}));

// ── Automatic payments (A5) ──────────────────────────────────────────────────

router.get('/bonds/:id/autopay', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  res.json(await autopayForBond(db, { agentId: req.agentId, bondId: bond.id }));
}));

router.post('/bonds/:id/autopay/link', autopayOn, handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const b = body(req);
  const to = oneOf(b.to, ['defendant', 'indemnitor'], 'to');
  const deliver = oneOf(b.deliver, ['sms', 'email', 'both', 'none'], 'deliver');
  const out = await sendAutopayLink(db, {
    agentId: req.agentId, bondId: bond.id, to, indemnitorId: to === 'indemnitor' ? id(b.indemnitor_id) : null,
    deliver, consentConfirmed: b.consent_confirmed === true, lang: normalizeLang(b.lang) || 'en',
  });
  res.status(201).json(out);
}));

router.post('/bonds/:id/autopay/stop', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(req.params.id));
  const reason = text(body(req).reason, 300, 'reason');
  const open = await db.get(`SELECT id FROM bd_autopay WHERE bond_id = ? AND agent_id = ? AND status IN ('link_sent','active')`, [bond.id, req.agentId]);
  if (!open) throw new BdError(409, 'autopay_not_active');
  await stopAutopay(db, { autopayId: Number(open.id), by: 'agent', reason });
  res.json(await autopayForBond(db, { agentId: req.agentId, bondId: bond.id }));
}));

// ── Pay-page payments (B2) ───────────────────────────────────────────────────

router.get('/pay-requests', handle(async (req, res, db) => {
  res.json({ pay_requests: await listPayRequests(db, req.agentId, req.query.status) });
}));

router.post('/pay-requests/:id/attach', handle(async (req, res, db) => {
  const bond = await loadBond(db, req.agentId, id(body(req).bond_id));
  const out = await attachPayRequest(db, { agentId: req.agentId, requestId: id(req.params.id), bondId: bond.id, userId: req.user.id });
  res.json(out);
}));

export default router;
