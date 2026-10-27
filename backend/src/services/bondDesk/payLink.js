/**
 * services/bondDesk/payLink.js — "Pay {agency}": the agency's public pay page (B2), for money paid
 * before the bond is in Bond Desk. docs/BOND_DESK.md "Pay link".
 *
 * Every agency whose card payments are on has a page https://<app>/pay/<slug> (a stable random
 * slug). The payer enters the amount ($1–$50,000), their name, phone and/or e-mail and the
 * defendant's name, agrees that the payment goes to the agency and is final, and pays in Stripe
 * Checkout on the AGENCY's account (direct charge). The payment shows in Bond Desk under
 * "Unassigned payments"; the agent attaches it to a bond, which posts it to bd_payments (numbered
 * receipt, exactly once — the PaymentIntent id is unique there) and sends the receipt.
 */
import { logIgnored } from '../../utils/ignored.js';
import { PAY_LINK_MIN_CENTS, PAY_LINK_MAX_CENTS } from '../../routes/billing/plans.js';
import { stripeConfigured } from '../../config.js';
import { msg, normalizeLang, stripeLocale } from '../../i18n/index.js';
import { toE164 } from '../sms.js';
import { sendPushToUser } from '../pushDelivery.js';
import { todayInZone } from '../../utils/timezone.js';
import { agencyFor, sendAgentEmail } from './core.js';
import { money } from './money.js';
import { LedgerError, postPayment, sendReceipt } from './payments.js';
import { appUrl, stripeOr503 } from './connect.js';

export const PAY_SLUG_RE = /^[a-z0-9]{10,32}$/;

async function agencyBySlug(db, slug) {
  if (!PAY_SLUG_RE.test(String(slug || ''))) throw new LedgerError(404, 'link_invalid');
  const row = await db.get('SELECT * FROM bd_connect_accounts WHERE pay_slug = ?', [slug]);
  if (!row || !row.pay_link_on) throw new LedgerError(404, 'link_invalid');
  return row;
}

/** GET /api/bd-pay/agency/:slug */
export async function payPage(db, slug) {
  const row = await agencyBySlug(db, slug);
  const a = await agencyFor(db, row.agent_id);
  return {
    agency: { name: a.agency || a.agent_name, phone: a.phone || null, license: a.license || null },
    available: !!row.charges_enabled && stripeConfigured(),
    min_cents: PAY_LINK_MIN_CENTS, max_cents: PAY_LINK_MAX_CENTS,
  };
}

const clean = (v, max) => {
  if (v == null) return null;
  const s = String(v).normalize('NFC').replace(/\p{Cc}/gu, '').trim();
  return s ? s.slice(0, max) : null;
};

/** Validate the payer's form. → fields, or LedgerError(400, code, { field }) */
export function payForm(b) {
  const amount = typeof b.amount_cents === 'number' ? b.amount_cents : (/^\d+$/.test(String(b.amount_cents ?? '').trim()) ? Number(b.amount_cents) : NaN);
  if (!Number.isSafeInteger(amount) || amount < PAY_LINK_MIN_CENTS || amount > PAY_LINK_MAX_CENTS) {
    throw new LedgerError(400, 'pay_amount', { field: 'amount_cents', min: money(PAY_LINK_MIN_CENTS), max: money(PAY_LINK_MAX_CENTS) });
  }
  const payer = clean(b.payer_name, 161);
  if (!payer) throw new LedgerError(400, 'required', { field: 'payer_name' });
  if (payer.length > 160) throw new LedgerError(400, 'too_long', { field: 'payer_name', max: 160 });
  const defendant = clean(b.defendant_name, 161);
  if (!defendant) throw new LedgerError(400, 'required', { field: 'defendant_name' });
  if (defendant.length > 160) throw new LedgerError(400, 'too_long', { field: 'defendant_name', max: 160 });
  const phoneRaw = clean(b.payer_phone, 40);
  const phone = phoneRaw ? toE164(phoneRaw) : null;
  if (phoneRaw && !phone) throw new LedgerError(400, 'bad_phone', { field: 'payer_phone' });
  const email = clean(b.payer_email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LedgerError(400, 'bad_email', { field: 'payer_email' });
  if (!phone && !email) throw new LedgerError(400, 'contact_required', { field: 'payer_phone' });
  if (b.agree_final !== true) throw new LedgerError(400, 'consent_required', { field: 'agree_final' });
  return { amount, payer, defendant, phone, email: email ? email.toLowerCase() : null, smsOk: b.receipt_by_text === true && !!phone };
}

/** POST /api/bd-pay/agency/:slug/checkout → { url } (Stripe Checkout on the agency's account) */
export async function startPayLink(db, slug, b, { ip, lang } = {}) {
  const row = await agencyBySlug(db, slug);
  if (!row.charges_enabled) throw new LedgerError(409, 'payments_not_set_up');
  const f = payForm(b || {});
  const stripe = stripeOr503();
  const shown = normalizeLang(lang) || 'en';
  const a = await agencyFor(db, row.agent_id);
  const req = await db.get(
    `INSERT INTO bd_pay_requests (agent_id, amount_cents, payer_name, payer_phone, payer_email, defendant_name, receipt_sms_ok, lang, stripe_account_id, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [row.agent_id, f.amount, f.payer, f.phone, f.email, f.defendant, f.smsOk, shown, row.stripe_account_id, ip ? String(ip).slice(0, 64) : null]);
  const md = { bd_kind: 'paylink', bd_pay_request_id: String(req.id), bd_agent_id: String(row.agent_id) };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', customer_email: f.email || undefined,
    locale: stripeLocale(shown),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: f.amount,
      product_data: { name: `${a.agency || a.agent_name} — bail bond payment for ${f.defendant}`.slice(0, 200) } } }],
    payment_intent_data: { description: `Pay page — ${f.payer} for ${f.defendant}`.slice(0, 200), metadata: md },
    metadata: md,
    expires_at: Math.floor(Date.now() / 1000) + 2 * 3600,
    success_url: `${appUrl()}/pay/${slug}?paid=1`, cancel_url: `${appUrl()}/pay/${slug}`,
  }, { stripeAccount: row.stripe_account_id, idempotencyKey: `bd-paylink-${req.id}` });
  await db.run('UPDATE bd_pay_requests SET checkout_session_id = ?, updated_at = NOW() WHERE id = ?', [session.id, req.id]);
  return { url: session.url };
}

/** The payer paid (payment_intent.succeeded or checkout.session.completed). Idempotent. */
export async function markPayLinkPaid(db, { requestId, piId, account }) {
  const r = await db.get(
    `UPDATE bd_pay_requests SET status = 'paid', stripe_pi_id = ?, paid_at = NOW(), updated_at = NOW()
      WHERE id = ? AND status IN ('started','expired') AND (CAST(? AS text) IS NULL OR stripe_account_id = CAST(? AS text)) RETURNING agent_id, amount_cents, payer_name, defendant_name`,
    [piId, requestId, account || null, account || null]);
  if (!r) return false;
  const u = await db.get('SELECT preferred_language FROM users WHERE id = ?', [r.agent_id]).catch(() => null);
  const lang = normalizeLang(u?.preferred_language) || 'en';
  const p = { amount: money(r.amount_cents), payer: r.payer_name, defendant: r.defendant_name };
  const title = msg(lang, 'bd.paylink.agent_paid_title', p);
  const body = msg(lang, 'bd.paylink.agent_paid_body', p);
  await sendPushToUser(Number(r.agent_id), { title, body, data: { type: 'bd_paylink', screen: 'BondDesk' } }).catch(logIgnored('services/bondDesk/payLink'));
  const a = await agencyFor(db, r.agent_id);
  await sendAgentEmail({ to: a.email, subject: title, text: `${body}\n\n${appUrl()}/bond-desk` });
  return true;
}

export async function markPayLinkExpired(db, sessionId) {
  await db.run(`UPDATE bd_pay_requests SET status = 'expired', updated_at = NOW() WHERE checkout_session_id = ? AND status = 'started'`, [sessionId]);
}

const pub = (r) => ({ id: Number(r.id), status: r.status, amount_cents: Number(r.amount_cents), payer_name: r.payer_name,
  payer_phone: r.payer_phone, payer_email: r.payer_email, defendant_name: r.defendant_name, paid_at: r.paid_at,
  bond_id: r.bond_id == null ? null : Number(r.bond_id), payment_id: r.payment_id == null ? null : Number(r.payment_id), attached_at: r.attached_at });

/** GET /bond-desk/pay-requests?status=paid|attached */
export async function listPayRequests(db, agentId, status = 'paid') {
  const st = status === 'attached' ? 'attached' : 'paid';
  const rows = await db.all(`SELECT * FROM bd_pay_requests WHERE agent_id = ? AND status = ? ORDER BY paid_at DESC, id DESC LIMIT 200`, [agentId, st]);
  return rows.map(pub);
}

/** Attach a paid pay-page payment to a bond: posted once, with a numbered receipt, and the receipt sent. */
export async function attachPayRequest(db, { agentId, requestId, bondId, userId }) {
  const a = await agencyFor(db, agentId);
  const out = await db.transaction(async (tx) => {
    const r = await tx.get('SELECT * FROM bd_pay_requests WHERE id = ? AND agent_id = ? FOR UPDATE', [requestId, agentId]);
    if (!r) throw new LedgerError(404, 'not_found');
    if (r.status === 'attached') throw new LedgerError(409, 'already_attached');
    if (r.status !== 'paid' || !r.stripe_pi_id) throw new LedgerError(409, 'not_paid');
    const { payment, duplicate } = await postPayment(tx, {
      agentId, bondId, amountCents: Number(r.amount_cents), method: 'card', payerName: r.payer_name, reference: 'Card — pay page',
      receivedOn: todayInZone(a.tz, new Date(r.paid_at)), createdBy: userId, stripePiId: r.stripe_pi_id, source: 'pay_link',
    });
    await tx.run(`UPDATE bd_pay_requests SET status = 'attached', bond_id = ?, payment_id = ?, attached_at = NOW(), updated_at = NOW() WHERE id = ?`, [bondId, payment.id, r.id]);
    return { payment, duplicate, r };
  });
  const receipt = out.duplicate ? { email: null, sms: null }
    : await sendReceipt(db, { paymentId: out.payment.id, lang: out.r.lang, email: out.r.payer_email, phone: out.r.payer_phone, smsOk: !!out.r.receipt_sms_ok });
  return { payment: out.payment, receipt };
}
