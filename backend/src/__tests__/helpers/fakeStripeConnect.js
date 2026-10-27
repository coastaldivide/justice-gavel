/**
 * helpers/fakeStripeConnect.js — a fake Stripe client for the Bond Desk card-payment suites:
 * the Connect endpoints (Express accounts, account links, login links), Checkout sessions in
 * setup and payment mode, SetupIntents, PaymentMethods, off-session PaymentIntents (with
 * idempotency keys), customers, invoice items (text billing) and webhook signatures (HMAC of
 * the body, as the other suites' fakes do). Every call records the Stripe-Account header it was
 * made with, so tests can prove money goes to the agency's connected account.
 *
 * Usage (before importing the app):
 *   const fake = newFakeState();
 *   jest.unstable_mockModule('stripe', () => ({ default: fakeStripeClass(fake) }));
 *
 * Card behaviour by payment method id: pm_ok → succeeded; pm_decline → card_declined;
 * pm_3ds → authentication_required (requires_action).
 */
import crypto from 'node:crypto';

export function newFakeState() {
  return { seq: 0, run: crypto.randomBytes(3).toString('hex'), accounts: new Map(), sessions: new Map(), setupIntents: new Map(), pms: new Map(), pis: new Map(), customers: new Map(),
    idem: new Map(), calls: [], items: [], detached: [], cancelled: [], down: false };
}

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

class CardError extends Error {
  constructor(code, pi) { super(code === 'authentication_required' ? 'Your card requires authentication.' : 'Your card was declined.'); this.type = 'StripeCardError'; this.code = code; this.raw = { code, payment_intent: pi }; }
}

export function fakeStripeClass(fake) {
  const id = (p) => `${p}_${fake.run}${++fake.seq}`;
  const log = (name, params, opts) => fake.calls.push({ name, params: clone(params), account: opts?.stripeAccount || null, idem: opts?.idempotencyKey || null });
  const idem = async (opts, fn) => {
    const key = opts?.idempotencyKey ? `${opts.stripeAccount || ''}|${opts.idempotencyKey}` : null;
    if (key && fake.idem.has(key)) { const r = fake.idem.get(key); if (r.error) throw r.error; return clone(r.value); }
    try { const value = await fn(); if (key) fake.idem.set(key, { value: clone(value) }); return value; } catch (error) { if (key && error?.type === 'StripeCardError') fake.idem.set(key, { error }); throw error; }
  };
  return class FakeStripe {
    constructor() {
      this.accounts = {
        create: async (p, o) => idem(o, async () => {
          log('accounts.create', p, o);
          const a = { id: id('acct'), type: p.type, email: p.email, metadata: p.metadata, charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { disabled_reason: 'requirements.past_due' } };
          fake.accounts.set(a.id, a);
          return clone(a);
        }),
        retrieve: async (aid) => { log('accounts.retrieve', { aid }); return clone(fake.accounts.get(aid)); },
        createLoginLink: async (aid) => { log('accounts.createLoginLink', { aid }); return { url: `https://connect.stripe.test/express/${aid}` }; },
      };
      this.accountLinks = { create: async (p) => { log('accountLinks.create', p); return { url: `https://connect.stripe.test/setup/${p.account}`, expires_at: 0 }; } };
      this.customers = {
        create: async (p, o) => idem(o, async () => { log('customers.create', p, o); const c = { id: id('cus'), ...clone(p) }; fake.customers.set(c.id, c); return c; }),
        list: async () => ({ data: [] }),
      };
      this.checkout = { sessions: {
        create: async (p, o) => idem(o, async () => {
          log('checkout.sessions.create', p, o);
          const s = { id: id('cs'), url: `https://checkout.stripe.test/${fake.seq}`, mode: p.mode, metadata: p.metadata || {}, status: 'open',
            payment_status: 'unpaid', customer: p.customer || null, setup_intent: null, payment_intent: null, account: o?.stripeAccount || null,
            amount_total: p.line_items?.[0]?.price_data?.unit_amount ?? null, params: clone(p) };
          fake.sessions.set(s.id, s);
          return clone(s);
        }),
        retrieve: async (cid, _p, o) => { log('checkout.sessions.retrieve', { cid }, o); return clone(fake.sessions.get(cid)); },
      } };
      this.setupIntents = { retrieve: async (sid, p, o) => {
        log('setupIntents.retrieve', { sid, ...p }, o);
        const si = clone(fake.setupIntents.get(sid));
        if (si && p?.expand?.includes('payment_method')) si.payment_method = clone(fake.pms.get(si.payment_method));
        return si;
      } };
      this.paymentMethods = {
        retrieve: async (pid, _p, o) => { log('paymentMethods.retrieve', { pid }, o); return clone(fake.pms.get(pid)); },
        detach: async (pid, _p, o) => { log('paymentMethods.detach', { pid }, o); fake.detached.push(pid); return { id: pid }; },
      };
      this.paymentIntents = {
        create: async (p, o) => {
          log('paymentIntents.create', p, o);
          if (fake.down) { const e = new Error('connection reset'); e.type = 'StripeConnectionError'; throw e; }
          return idem(o, async () => {
            const pi = { id: id('pi'), amount: p.amount, amount_received: 0, status: 'processing', metadata: p.metadata || {}, customer: p.customer,
              payment_method: p.payment_method, application_fee_amount: p.application_fee_amount ?? null, account: o?.stripeAccount || null };
            if (p.payment_method === 'pm_decline') { pi.status = 'requires_payment_method'; fake.pis.set(pi.id, pi); throw new CardError('card_declined', clone(pi)); }
            if (p.payment_method === 'pm_3ds') { pi.status = 'requires_action'; fake.pis.set(pi.id, pi); throw new CardError('authentication_required', clone(pi)); }
            pi.status = 'succeeded'; pi.amount_received = p.amount;
            fake.pis.set(pi.id, pi);
            return clone(pi);
          });
        },
        cancel: async (pid, _p, o) => { log('paymentIntents.cancel', { pid }, o); fake.cancelled.push(pid); const pi = fake.pis.get(pid); if (pi) pi.status = 'canceled'; return clone(pi); },
        retrieve: async (pid) => clone(fake.pis.get(pid)),
      };
      this.subscriptions = { retrieve: async (sid) => ({ id: sid, customer: 'cus_plan' }) };
      this.invoiceItems = {
        list: async ({ customer }) => ({ data: fake.items.filter((i) => i.customer === customer), has_more: false }),
        create: async (p, o) => { const it = { id: id('ii'), ...p, idem: o?.idempotencyKey }; fake.items.push(it); return it; },
      };
      this.webhooks = {
        constructEvent: (raw, sig, secret) => {
          const body = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
          const want = crypto.createHmac('sha256', secret).update(body).digest('hex');
          if (sig !== want) throw new Error('No signatures found matching the expected signature');
          return JSON.parse(body);
        },
      };
    }
  };
}

/** What Stripe Checkout does when the payer finishes a setup session: a SetupIntent with a card. */
export function completeSetupSession(fake, sessionId, pmId, { brand = 'visa', last4 = '4242' } = {}) {
  const s = fake.sessions.get(sessionId);
  fake.pms.set(pmId, { id: pmId, type: 'card', card: { brand, last4 } });
  const si = { id: `seti_${sessionId}`, status: 'succeeded', payment_method: pmId };
  fake.setupIntents.set(si.id, si);
  s.status = 'complete';
  s.setup_intent = si.id;
  return clone(s);
}

/** What Stripe Checkout does when a payment session is paid. */
export function completePaymentSession(fake, sessionId) {
  const s = fake.sessions.get(sessionId);
  const pi = { id: `pi_${sessionId}`, amount: s.amount_total, amount_received: s.amount_total, status: 'succeeded', metadata: s.params.payment_intent_data?.metadata || {} };
  fake.pis.set(pi.id, pi);
  s.status = 'complete'; s.payment_status = 'paid'; s.payment_intent = pi.id;
  return { session: clone(s), pi: clone(pi) };
}

/** Sign a webhook body the way the fake verifies it. */
export const signEvent = (event, secret) => {
  const raw = JSON.stringify(event);
  return { raw, sig: crypto.createHmac('sha256', secret).update(raw).digest('hex') };
};
