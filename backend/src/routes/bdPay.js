/**
 * routes/bdPay.js — /api/bd-pay, the public pages where people pay a bail agency by card
 * (no account). docs/BOND_DESK.md "Automatic payments" and "Pay link".
 *
 *   Automatic payments (⚖ counsel 3.2 — 503 feature_unavailable while BOND_AUTOPAY_ENABLED is off).
 *   The personal link texted / e-mailed by the agent is the credential (32 random bytes; only the
 *   SHA-256 is stored), like signing links.
 *     GET  /autopay/:token            what the page shows: agency, schedule, consent text, card, status
 *     POST /autopay/:token/start      { agree: true, consent_version, lang } → { url } Stripe Checkout (save the card)
 *     POST /autopay/:token/stop       "Stop automatic payments"
 *     POST /autopay/:token/confirm    the bank asked the payer to confirm a payment → { url } Stripe Checkout
 *
 *   "Pay {agency}" (B2): the agency's pay page, by its stable slug.
 *     GET  /agency/:slug              agency name, limits, whether payments are on
 *     POST /agency/:slug/checkout     { amount_cents, payer_name, payer_phone?, payer_email?, defendant_name,
 *                                       receipt_by_text?, agree_final: true, lang? } → { url } Stripe Checkout
 *
 * Money goes to the agency's own Stripe account (Connect direct charges), never to Justice Gavel.
 * IP rate limits: 60 reads and 10 payment starts per IP per 15 minutes.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db/index.js';
import { resolveLang, msg, normalizeLang } from '../i18n/index.js';
import logger from '../utils/logger.js';
import { LedgerError } from '../services/bondDesk/payments.js';
import { autopayEnabled, autopayView, startSetup, stopAutopay, startActionPayment, autopayByToken } from '../services/bondDesk/autopay.js';
import { payPage, startPayLink } from '../services/bondDesk/payLink.js';

const router = Router();
const limitMsg = (req) => ({ error: msg(resolveLang(req), 'bd.err.too_many_requests'), code: 'too_many_requests' });
const readLimiter = rateLimit({ windowMs: 15 * 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: limitMsg });
const payLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: limitMsg });

function fail(req, res, e) {
  if (e instanceof LedgerError) {
    return res.status(e.status).json({ error: msg(resolveLang(req), `bd.err.${e.code}`, e.params), code: e.code, ...e.params });
  }
  if (typeof e?.type === 'string' && e.type.startsWith('Stripe')) {
    logger.warn({ err: e?.message, type: e.type }, '[bd-pay] Stripe refused');
    return res.status(502).json({ error: msg(resolveLang(req), 'bd.err.payment_provider'), code: 'payment_provider' });
  }
  logger.error({ err: e?.message, type: e?.type }, '[bd-pay]');
  return res.status(500).json({ error: msg(resolveLang(req), 'bd.err.server'), code: 'server_error' });
}
const handle = (fn) => async (req, res) => {
  try { await fn(req, res, await getDb()); } catch (e) { fail(req, res, e); }
};
const ipOf = (req) => String(req.ip || '').replace(/^::ffff:/, '').slice(0, 64) || null;
const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const langOf = (req) => normalizeLang(body(req).lang) || normalizeLang(req.query?.lang) || resolveLang(req);

function autopayOn(req, res, next) {
  if (autopayEnabled()) return next();
  return fail(req, res, new LedgerError(503, 'feature_unavailable'));
}

router.get('/autopay/:token', readLimiter, autopayOn, handle(async (req, res, db) => {
  res.json(await autopayView(db, req.params.token, { lang: normalizeLang(req.query?.lang) }));
}));

router.post('/autopay/:token/start', payLimiter, autopayOn, handle(async (req, res, db) => {
  const b = body(req);
  res.json(await startSetup(db, req.params.token, { agree: b.agree === true, consentVersion: b.consent_version, lang: langOf(req),
    ip: ipOf(req), userAgent: req.get('user-agent') || null }));
}));

router.post('/autopay/:token/stop', payLimiter, autopayOn, handle(async (req, res, db) => {
  const row = await autopayByToken(db, req.params.token);
  await stopAutopay(db, { autopayId: Number(row.id), by: 'payer', reason: 'stopped by the payer on the link page' });
  res.json(await autopayView(db, req.params.token, { lang: langOf(req) }));
}));

router.post('/autopay/:token/confirm', payLimiter, autopayOn, handle(async (req, res, db) => {
  res.json(await startActionPayment(db, req.params.token, { lang: langOf(req) }));
}));

router.get('/agency/:slug', readLimiter, handle(async (req, res, db) => {
  res.json(await payPage(db, req.params.slug));
}));

router.post('/agency/:slug/checkout', payLimiter, handle(async (req, res, db) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: msg(resolveLang(req), 'bd.err.invalid', { field: 'body' }), code: 'invalid', field: 'body' });
  }
  res.json(await startPayLink(db, req.params.slug, body(req), { ip: ipOf(req), lang: langOf(req) }));
}));

export default router;
