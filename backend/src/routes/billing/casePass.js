/**
 * billing/casePass.js — the one-time Case Pass (plans.js CASE_PASS). Mounted at /api/billing.
 *
 *   GET  /case-pass            price, features, and (signed in) the caller's pass end date
 *   POST /case-pass/buy        { family?, ui?, return_path? } → PaymentIntent (sheet) or Checkout URL (browser);
 *                              $29, or $19 while a pass is active (adds 90 days after it ends);
 *                              family: true → Family Case Pass, $39 / $25 (FAMILY_CASE_PASS)
 *   GET  /record-clearing      the $99 record-clearing packet's price and whether it is on sale (not yet)
 *   POST /case-pass/confirm    { payment_intent_id | checkout_session_id } → reads the payment back
 *                              from Stripe (this user, 'case_pass', succeeded) and records it once
 * One-time purchase, all sales final (subscriptions.js refund policy). Nothing renews.
 */
import { Router } from 'express';
import { authRequired, optionalAuth } from '../../middleware/auth.js';
import { getDb } from '../../db/index.js';
import { stripeConfigured } from '../../config.js';
import { resolveLang, msg, LOCALES } from '../../i18n/index.js';
import { CASE_PASS, FAMILY_CASE_PASS, RECORD_CLEARING, planFeatures } from './plans.js';
import { billingLimiter } from './_shared.js';
import { startPayment, verifyPayment, uiFrom, returnUrlFor } from '../../services/stripeBilling.js';
import { activeCasePass, casePassQuote, recordCasePass } from '../../services/casePass.js';
import { billingFail } from './subscriptions.js';
import { audit, AUDIT_ACTIONS } from '../../utils/audit.js';

const router = Router();

router.get('/case-pass', optionalAuth, async (req, res) => {
  try {
    const active = req.user?.id ? await activeCasePass(await getDb(), req.user.id) : null;
    res.json({
      cents: CASE_PASS.cents, extend_cents: CASE_PASS.extend_cents, days: CASE_PASS.days,
      family: { cents: FAMILY_CASE_PASS.cents, extend_cents: FAMILY_CASE_PASS.extend_cents, days: FAMILY_CASE_PASS.days },
      features: planFeatures('case_pass'), payments_live: stripeConfigured(),
      active_until: active?.ends_at || null, can_extend: !!active,
    });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/case-pass/buy', billingLimiter, authRequired, async (req, res) => {
  try {
    const family = req.body?.family === true;
    const q = await casePassQuote(await getDb(), req.user.id, { family });
    const name = family ? 'Family Case Pass' : 'Case Pass';
    const out = await startPayment({
      user: req.user, cents: q.cents,
      description: q.kind === 'extend' ? `Justice Gavel — ${name}, 90 more days` : `Justice Gavel — ${name}, 90 days`,
      metadata: { package: 'case_pass', kind: q.kind, family: family ? '1' : '0' },
      ui: uiFrom(req.body), returnUrl: returnUrlFor(req, req.body?.return_path || '/plans'),
    });
    res.json({ ...out, kind: q.kind, family });
  } catch (e) { billingFail(req, res, e); }
});

router.post('/case-pass/confirm', billingLimiter, authRequired, async (req, res) => {
  const lang = resolveLang(req);
  if (typeof req.body?.payment_intent_id !== 'string' && typeof req.body?.checkout_session_id !== 'string') {
    return res.status(400).json({ error: msg(lang, 'billing.err.payment_required'), code: 'payment_required' });
  }
  try {
    const pi = await verifyPayment({
      user: req.user, pkg: 'case_pass',
      paymentIntentId: typeof req.body?.payment_intent_id === 'string' ? req.body.payment_intent_id.trim() : null,
      checkoutSessionId: typeof req.body?.checkout_session_id === 'string' ? req.body.checkout_session_id.trim() : null,
    });
    const db = await getDb();
    const out = await recordCasePass(db, { userId: req.user.id, pi });
    if (out.created) {
      await audit(AUDIT_ACTIONS.SUBSCRIPTION_STARTED, { userId: req.user.id, req, entityType: 'case_pass', entityId: null,
        metadata: { amount_cents: pi.amount, ends_at: out.pass.ends_at } });
    }
    const active = await activeCasePass(db, req.user.id);
    const until = active?.ends_at || out.pass.ends_at;
    const date = new Date(until).toLocaleDateString(LOCALES[lang], { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    res.json({ ok: true, active_until: until, message: msg(lang, 'billing.msg.case_pass_active', { date }) });
  } catch (e) { billingFail(req, res, e); }
});

router.get('/record-clearing', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ cents: RECORD_CLEARING.cents, display: RECORD_CLEARING.display, on_sale: RECORD_CLEARING.on_sale,
    states_on_sale: RECORD_CLEARING.states_on_sale, payments_live: stripeConfigured() });
});

export default router;
