/**
 * pro_billing_g.int.test.js — section G (pro dashboards, payments, admin) on the
 * real app + real Postgres, with a fake Stripe client:
 *
 *   G1  no Stripe key: every money path is 503 payments_unavailable (localized) and nothing is stored
 *   G2  every plan charges exactly its price from plans.js (the /tiers list); attorney plans need an
 *       attorney account
 *   G3  consumer plan via the payment sheet: nothing unlocks before the card is confirmed; confirm
 *       twice = one row; a second plan is refused; features follow the plan (research, monitors)
 *   G4  Stripe Checkout (web): confirm by session id
 *   G5  plan change (prorated), a declined card keeps the old plan; cancel at period end
 *   G6  webhooks: bad signature 400; payment failed → past_due; paid → active; deleted → canceled;
 *       a replayed event changes nothing; a lost confirm is finished by the webhook
 *   G7  refunds: nothing charged yet → 409; a paid invoice within 7 days → refunded, plan gone
 *   G8  bail leads: initials before purchase, $100 flat, full record only for the buyer, a webhook
 *       replay never double-credits, a second payment for an owned lead is refunded
 *   G9  case leads: flat fee per type ($200 PI / civil rights, $100 employment, $75 ICE), one buyer,
 *       contact details only for the buyer, a late second buyer is refunded
 *   G10 bail-agent plan + new-arrest alerts for covered counties (once per record)
 *   G11 admin queue: admin role only; bar approve / reject with reason; audit rows
 *   G12 conflict check: normalized names, own firm only; firm trial + invite + seats; inbox shows
 *       direct messages and the attorney can reply
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';
import { describeIntegration, initSuite } from './_harness.js';

// ── Fake Stripe ───────────────────────────────────────────────────────────────
const fake = { seq: 0, prices: new Map(), subs: new Map(), pis: new Map(), sessions: new Map(), refunds: [], created: [], declineNextChange: false };
const id = (p) => `${p}_g${++fake.seq}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const now = () => Math.floor(Date.now() / 1000);
jest.unstable_mockModule('stripe', () => ({
  default: class FakeStripe {
    constructor() {
      this.customers = { list: async () => ({ data: [] }), create: async () => ({ id: id('cus') }) };
      this.prices = { retrieve: async (pid) => { const pr = fake.prices.get(pid); if (!pr) { const e = new Error('No such price'); e.code = 'resource_missing'; throw e; } return clone(pr); } };
      this.subscriptions = {
        create: async (p) => {
          fake.created.push(clone(p));
          const item = p.items[0];
          const price = item.price ? { id: item.price } : { id: id('price'), unit_amount: item.price_data.unit_amount, recurring: item.price_data.recurring };
          const trial = p.trial_period_days || 0;
          const sub = {
            id: id('sub'), customer: p.customer, metadata: p.metadata, status: trial ? 'trialing' : 'incomplete',
            items: { data: [{ id: id('si'), price }] }, default_payment_method: null, cancel_at_period_end: false,
            trial_end: trial ? now() + trial * 86400 : null, current_period_end: now() + (trial || 30) * 86400,
            latest_invoice: { id: id('in'), status: trial ? 'paid' : 'open', amount_paid: 0, payment_intent: trial ? null : { id: id('pi'), client_secret: 'pi_secret' } },
            pending_setup_intent: trial ? { id: id('seti'), client_secret: 'seti_secret', status: 'requires_payment_method' } : null,
          };
          fake.subs.set(sub.id, sub);
          return clone(sub);
        },
        retrieve: async (sid) => { const s = fake.subs.get(sid); if (!s) { const e = new Error('No such subscription'); e.code = 'resource_missing'; throw e; } return clone(s); },
        update: async (sid, p) => {
          const s = fake.subs.get(sid);
          if (p.items) {
            if (fake.declineNextChange) { fake.declineNextChange = false; return { ...clone(s), pending_update: { expires_at: now() + 3600 } }; }
            const it = p.items[0];
            s.items.data[0].price = it.price ? { id: it.price } : { id: id('price'), unit_amount: it.price_data.unit_amount, recurring: it.price_data.recurring };
          }
          if (p.metadata) s.metadata = p.metadata;
          if (p.cancel_at_period_end !== undefined) s.cancel_at_period_end = p.cancel_at_period_end;
          return clone(s);
        },
        cancel: async (sid) => { const s = fake.subs.get(sid); s.status = 'canceled'; return clone(s); },
      };
      this.invoices = {
        list: async ({ subscription }) => {
          const s = fake.subs.get(subscription);
          const inv = s?.paidInvoice;
          return { data: inv ? [inv] : [] };
        },
      };
      this.refunds = { create: async (p) => { const r = { id: id('re'), amount: fake.pis.get(p.payment_intent)?.amount ?? fake.lastInvoiceAmount ?? 0, payment_intent: p.payment_intent }; fake.refunds.push(r); return r; } };
      this.paymentIntents = {
        create: async (p) => { const pi = { id: id('pi'), client_secret: 'pi_secret_x', amount: p.amount, status: 'requires_payment_method', metadata: p.metadata }; fake.pis.set(pi.id, pi); return clone(pi); },
        retrieve: async (pid) => { const pi = fake.pis.get(pid); if (!pi) { const e = new Error('No such payment_intent'); e.code = 'resource_missing'; throw e; } return clone(pi); },
      };
      this.checkout = { sessions: {
        create: async (p) => {
          const s = { id: id('cs'), url: `https://checkout.stripe.test/${fake.seq}`, mode: p.mode, metadata: p.metadata, status: 'open', payment_status: 'unpaid', params: clone(p) };
          fake.sessions.set(s.id, s);
          return clone(s);
        },
        retrieve: async (cid) => clone(fake.sessions.get(cid)),
      } };
      this.webhooks = {
        constructEvent: (raw, sig, secret) => {
          const body = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
          const want = crypto.createHmac('sha256', secret).update(body).digest('hex');
          if (sig !== want) throw new Error('No signatures found matching the expected signature');
          return JSON.parse(body);
        },
      };
    }
  },
}));

/** What the payment sheet does: the card is confirmed (trial → card on file; else first invoice paid). */
function paySub(subId, amount) {
  const s = fake.subs.get(subId);
  if (s.status === 'trialing') { s.pending_setup_intent.status = 'succeeded'; s.default_payment_method = 'pm_card'; }
  else { s.status = 'active'; s.latest_invoice = { id: s.latest_invoice.id, status: 'paid', amount_paid: amount }; s.default_payment_method = 'pm_card'; }
}
const STRIPE_KEY = 'sk_test_section_g';
const WH_SECRET = 'whsec_section_g';
const sign = (event) => { const raw = JSON.stringify(event); return { raw, sig: crypto.createHmac('sha256', WH_SECRET).update(raw).digest('hex') }; };

describeIntegration('section G — payments, leads, pro dashboards, admin (real Postgres, fake Stripe)', () => {
  beforeAll(() => { process.env.STRIPE_SECRET_KEY = STRIPE_KEY; process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET; });
  afterAll(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET; });
  const ctx = initSuite();
  let consumer, consumer2, attorney, attorney2, agent, agent2, admin;
  const arrests = [];
  let ipN = 0;
  const req = (m, path, user, lang) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.77.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (user) r = r.set(user.headers);
    if (lang) r = r.set('Accept-Language', lang);
    return r;
  };
  const webhook = (event) => { const { raw, sig } = sign(event); return ctx.request().post('/api/billing/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(raw); };
  let evSeq = 0;
  const event = (type, object) => ({ id: `evt_g_${Date.now()}_${++evSeq}`, type, data: { object } });

  beforeAll(async () => {
    if (!ctx.app) return;
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;   // the harness clears it before importing the app
    [consumer, consumer2] = await Promise.all(['C1', 'C2'].map(n => ctx.register({ displayName: `G ${n}` })));
    [attorney, attorney2] = await Promise.all(['A1', 'A2'].map(n => ctx.register({ displayName: `G ${n}`, accountType: 'attorney' })));
    [agent, agent2] = await Promise.all(['B1', 'B2'].map(n => ctx.register({ displayName: `G ${n}`, accountType: 'bail_agent' })));
    admin = await ctx.register({ displayName: 'G Admin' });
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    await ctx.db.run('UPDATE users SET bar_verified = 1 WHERE id IN (?, ?)', [attorney.user.id, attorney2.user.id]);
    for (const [name, county] of [['Jordan Testlead', 'Gcounty'], ['Riley Otherlead', 'Gcounty'], ['Casey Farlead', 'Faraway']]) {
      const r = await ctx.db.get(
        `INSERT INTO arrest_records (name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney, source, alert_sent, created_at)
         VALUES (?, CURRENT_DATE, 'DUI', 5000, ?, 'TN', 'G County Jail', 0, ?, 0, NOW()) RETURNING id`, [name, county, `roster_${ctx.tag}`]);
      arrests.push(Number(r.id));
    }
    ctx.addCleanup(async (db) => {
      const users = (await db.all('SELECT id FROM users WHERE email LIKE ?', [`${ctx.tag}-%`])).map(u => Number(u.id));
      if (users.length) {
        const ids = users.join(',');
        for (const sql of [
          `DELETE FROM lead_purchases WHERE bondsman_id IN (${ids})`, `DELETE FROM lead_alert_log WHERE user_id IN (${ids})`,
          `DELETE FROM bondsman_subscriptions WHERE user_id IN (${ids})`, `DELETE FROM bondsman_profiles WHERE user_id IN (${ids})`,
          `DELETE FROM pi_leads WHERE user_id IN (${ids})`, `DELETE FROM refund_requests WHERE user_id IN (${ids})`,
          `DELETE FROM messages WHERE sender_id IN (${ids}) OR recipient_id IN (${ids})`,
          `DELETE FROM conflict_index WHERE firm_id IN (SELECT id FROM firms WHERE owner_id IN (${ids}))`,
          `DELETE FROM firm_invites WHERE firm_id IN (SELECT id FROM firms WHERE owner_id IN (${ids}))`,
          `DELETE FROM firm_trials WHERE user_id IN (${ids})`, `DELETE FROM firm_vertical_config WHERE firm_id IN (SELECT id FROM firms WHERE owner_id IN (${ids}))`,
          `DELETE FROM firm_members WHERE user_id IN (${ids})`, `DELETE FROM firms WHERE owner_id IN (${ids})`,
          `DELETE FROM arrest_monitors WHERE user_id IN (${ids})`,
        ]) await db.run(sql).catch(() => {});
      }
      await db.run(`DELETE FROM arrest_records WHERE source = ?`, [`roster_${ctx.tag}`]);
    });
  });

  test('G1 without Stripe every money path is 503 and nothing is stored', async () => {
    if (!ctx.app) return;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const posts = [
        ['/api/billing/subscribe', consumer, { tier: 'legal_pro' }], ['/api/billing/consumer/subscribe', consumer, { tier: 'advisor' }],
        ['/api/billing/subscription/confirm', consumer, { subscription_id: 'sub_x' }], ['/api/billing/subscription/change', consumer, { tier: 'advisor' }],
        ['/api/billing/cancel', consumer, {}], ['/api/billing/refund', consumer, { reason: 'other' }],
        ['/api/billing/bondsman/subscribe', agent, { tier: 'pro' }], ['/api/billing/bondsman/subscription/confirm', agent, {}],
        [`/api/billing/leads/${arrests[0]}/accept`, agent, {}], [`/api/billing/leads/${arrests[0]}/confirm`, agent, { payment_intent_id: 'pi_x' }],
        ['/api/billing/pi-lead/accept/1', attorney, {}], ['/api/billing/pi-lead/confirm/1', attorney, { payment_intent_id: 'pi_x' }],
      ];
      for (const [path, user, body] of posts) {
        const r = await req('post', path, user, 'es').send(body);
        expect([path, r.status, r.body.error]).toEqual([path, 503, 'payments_unavailable']);
        expect(r.body.message).toBe('Los pagos aún no están disponibles');
      }
      expect((await ctx.request().post('/api/pay/create').set(consumer.headers).send({ amount: 1500 })).status).toBe(404);
      const n = await ctx.db.get(`SELECT COUNT(*)::int AS n FROM subscriptions WHERE user_id = ?`, [consumer.user.id]);
      expect(n.n).toBe(0);
      const tiers = await req('get', '/api/billing/tiers');
      expect(tiers.body.payments_live).toBe(false);
    } finally { process.env.STRIPE_SECRET_KEY = STRIPE_KEY; }
  });

  test('G2 every plan is charged exactly its listed price; attorney plans need an attorney account', async () => {
    if (!ctx.app) return;
    const { TIERS, chargeFor } = await import('../../routes/billing/plans.js');
    const list = (await req('get', '/api/billing/tiers')).body.tiers;
    expect(list.map(t => t.key).sort()).toEqual(['advisor', 'advisor_annual', 'esquire', 'esquire_annual', 'legal_pro', 'legal_radar', 'pro_annual'].sort());
    for (const t of list) {
      const c = chargeFor(t.key);
      expect(t.monthly_cents).toBe(TIERS[t.key].monthly_cents);
      // the display string is the amount charged (monthly) or the yearly charge (annual)
      expect(t.display_price).toContain(`$${(c.cents / 100).toFixed(c.cents % 100 ? 2 : 0)}`);
      const user = t.audience === 'attorney' ? attorney : await ctx.register({ displayName: `G buyer ${t.key}` });
      const r = await req('post', '/api/billing/subscribe', user).send({ tier: t.key });
      expect([t.key, r.status]).toEqual([t.key, 200]);
      expect(r.body.client_secret).toBeTruthy();
      const p = fake.created.at(-1);
      expect(p.items[0].price_data.unit_amount).toBe(c.cents);
      expect(p.items[0].price_data.recurring.interval).toBe(c.interval);
      expect(p.trial_period_days || 0).toBe(t.trial_days);
      expect(p.payment_behavior).toBe('default_incomplete');
      // nothing granted yet
      const row = await ctx.db.get('SELECT status FROM subscriptions WHERE stripe_sub_id = ?', [r.body.subscription_id]);
      expect(row.status).toBe('incomplete');
      if (t.audience === 'attorney') await ctx.db.run('DELETE FROM subscriptions WHERE stripe_sub_id = ?', [r.body.subscription_id]);
    }
    const refused = await req('post', '/api/billing/subscribe', consumer2).send({ tier: 'esquire' });
    expect(refused.status).toBe(403);
    expect((await req('post', '/api/billing/subscribe', consumer2).send({ tier: 'starter_annual' })).status).toBe(400);
    expect((await req('post', '/api/billing/consumer/subscribe', consumer2).send({ tier: 'esquire' })).status).toBe(400);
  });

  test('G3 a consumer plan unlocks only after the card is confirmed; features follow the plan', async () => {
    if (!ctx.app) return;
    await ctx.acceptDisclaimer(consumer);
    const research = () => req('get', '/api/research/status', consumer);
    expect((await research()).body.has_access).toBe(false);
    const monitorBefore = await req('post', '/api/arrests/monitors', consumer).send({ watch_name: 'Sam Watch' });
    expect(monitorBefore.status).toBe(402);
    const start = await req('post', '/api/billing/subscribe', consumer).send({ tier: 'legal_pro' });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ requires_payment: true, intent_type: 'setup', amount_cents: 3499, trial_days: 7 });
    const subId = start.body.subscription_id;
    expect((await req('get', '/api/billing/subscription', consumer)).body.subscription).toBeNull();
    expect((await research()).body.has_access).toBe(false);
    const early = await req('post', '/api/billing/subscription/confirm', consumer).send({ subscription_id: subId });
    expect(early.status).toBe(402);
    expect((await req('post', '/api/billing/subscription/confirm', consumer2).send({ subscription_id: subId })).status).toBe(404);
    paySub(subId, 0);
    const ok = await req('post', '/api/billing/subscription/confirm', consumer, 'pt').send({ subscription_id: subId });
    expect(ok.status).toBe(200);
    expect(ok.body.subscription).toMatchObject({ tier: 'legal_pro', status: 'trialing', paid: true });
    expect(ok.body.subscription.features).toEqual(expect.arrayContaining(['legal_research', 'arrest_monitor', 'video_consultation']));
    expect(ok.body.message).toMatch(/Seu teste grátis começou/);
    await req('post', '/api/billing/subscription/confirm', consumer).send({ subscription_id: subId });
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM subscriptions WHERE stripe_sub_id = ?', [subId])).n).toBe(1);
    expect((await research()).body.has_access).toBe(true);
    expect((await req('post', '/api/arrests/monitors', consumer).send({ watch_name: 'Sam Watch' })).status).toBe(201);
    const again = await req('post', '/api/billing/subscribe', consumer).send({ tier: 'advisor' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_subscribed');
    const over = await req('get', '/api/billing/overview', consumer);
    expect(over.body.subscriptions.map(s => s.tier)).toEqual(['legal_pro']);
    expect((await req('get', '/api/billing/overview', consumer2)).body.subscriptions).toEqual([]);
  });

  test('G4 Stripe Checkout in a browser: confirmed by the session id', async () => {
    if (!ctx.app) return;
    const user = await ctx.register({ displayName: 'G web buyer' });
    const r = await req('post', '/api/billing/subscribe', user).set('Origin', 'http://localhost:8081').send({ tier: 'advisor', ui: 'checkout', return_path: '/plans' });
    expect(r.status).toBe(200);
    expect(r.body.checkout_url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const session = fake.sessions.get(r.body.checkout_session_id);
    expect(session.params.success_url).toBe('http://localhost:8081/plans?checkout_session_id={CHECKOUT_SESSION_ID}');
    expect(session.params.line_items[0].price_data.unit_amount).toBe(2499);
    expect((await req('post', '/api/billing/subscription/confirm', user).send({ checkout_session_id: session.id })).status).toBe(402);
    // Stripe finished the checkout: the subscription exists and the card is on file
    const sub = await (new (await import('stripe')).default('k')).subscriptions.create({
      customer: 'cus', items: [session.params.line_items[0]], trial_period_days: 7, metadata: session.params.subscription_data.metadata });
    paySub(sub.id, 0);
    session.status = 'complete'; session.subscription = sub.id;
    const ok = await req('post', '/api/billing/subscription/confirm', user).send({ checkout_session_id: session.id });
    expect(ok.status).toBe(200);
    expect(ok.body.subscription).toMatchObject({ tier: 'advisor', status: 'trialing' });
  });

  test('G5 plan change is prorated, a declined card keeps the old plan; cancel at period end', async () => {
    if (!ctx.app) return;
    fake.declineNextChange = true;
    const declined = await req('post', '/api/billing/subscription/change', consumer).send({ tier: 'advisor' });
    expect(declined.status).toBe(402);
    expect(declined.body.code).toBe('change_not_paid');
    expect((await req('get', '/api/billing/subscription', consumer)).body.subscription.tier).toBe('legal_pro');
    const ok = await req('post', '/api/billing/subscription/change', consumer).send({ tier: 'pro_annual' });
    expect(ok.status).toBe(200);
    expect(ok.body.subscription).toMatchObject({ tier: 'pro_annual', amount_cents: 29900 });
    const row = await ctx.db.get(`SELECT stripe_sub_id FROM subscriptions WHERE user_id = ? AND tier = 'pro_annual'`, [consumer.user.id]);
    const s = fake.subs.get(row.stripe_sub_id);
    expect(s.items.data[0].price).toMatchObject({ unit_amount: 29900, recurring: { interval: 'year' } });
    expect(s.metadata.tier).toBe('pro_annual');
    // annual plans unlock their monthly plan's features
    expect((await req('get', '/api/research/status', consumer)).body.has_access).toBe(true);
    const cancel = await req('post', '/api/billing/cancel', consumer, 'es').send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.message).toMatch(/Su plan está cancelado/);
    expect(s.cancel_at_period_end).toBe(true);
    expect((await req('get', '/api/research/status', consumer)).body.has_access).toBe(true);   // until the period ends
  });

  test('G6 webhooks: signature, failed / paid / deleted, replays change nothing, a lost confirm is finished', async () => {
    if (!ctx.app) return;
    const row = await ctx.db.get(`SELECT stripe_sub_id FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [consumer.user.id]);
    const subId = row.stripe_sub_id;
    const bad = await ctx.request().post('/api/billing/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', 'nope').send('{"id":"evt_x"}');
    expect(bad.status).toBe(400);
    const status = async () => (await ctx.db.get('SELECT status FROM subscriptions WHERE stripe_sub_id = ?', [subId])).status;
    const failed = event('invoice.payment_failed', { id: 'in_f', subscription: subId });
    expect((await webhook(failed)).status).toBe(200);
    expect(await status()).toBe('past_due');
    expect((await req('get', '/api/research/status', consumer)).body.has_access).toBe(true);   // grace while Stripe retries
    const s = fake.subs.get(subId);
    s.status = 'active'; s.latest_invoice = { id: 'in_p', status: 'paid', amount_paid: 29900 };
    expect((await webhook(event('invoice.paid', { id: 'in_p', status: 'paid', subscription: subId }))).status).toBe(200);
    expect(await status()).toBe('active');
    s.status = 'canceled';
    const deleted = event('customer.subscription.deleted', clone(s));
    expect((await webhook(deleted)).status).toBe(200);
    expect(await status()).toBe('canceled');
    expect((await req('get', '/api/research/status', consumer)).body.has_access).toBe(false);
    // the same events delivered again are ignored
    const dup = await webhook(failed);
    expect(dup.body.duplicate).toBe(true);
    expect(await status()).toBe('canceled');
    // the app paid but never confirmed: the webhook records it
    const user = await ctx.register({ displayName: 'G lost confirm' });
    const start = await req('post', '/api/billing/subscribe', user).send({ tier: 'legal_radar' });
    paySub(start.body.subscription_id, 0);
    expect((await webhook(event('customer.subscription.updated', { id: start.body.subscription_id }))).status).toBe(200);
    expect((await ctx.db.get('SELECT status FROM subscriptions WHERE stripe_sub_id = ?', [start.body.subscription_id])).status).toBe('trialing');
    // an unpaid subscription is never promoted by a webhook
    const other = await ctx.register({ displayName: 'G unpaid' });
    const st2 = await req('post', '/api/billing/subscribe', other).send({ tier: 'legal_radar' });
    await webhook(event('customer.subscription.updated', { id: st2.body.subscription_id }));
    expect((await ctx.db.get('SELECT status FROM subscriptions WHERE stripe_sub_id = ?', [st2.body.subscription_id])).status).toBe('incomplete');
  });

  test('G7 refunds: nothing charged yet → 409; a charge within 7 days is refunded and the plan ends', async () => {
    if (!ctx.app) return;
    const user = await ctx.register({ displayName: 'G refund' });
    const start = await req('post', '/api/billing/subscribe', user).send({ tier: 'legal_radar' });
    paySub(start.body.subscription_id, 0);
    await req('post', '/api/billing/subscription/confirm', user).send({ subscription_id: start.body.subscription_id });
    expect((await req('post', '/api/billing/refund', user).send({ reason: 'nope' })).status).toBe(400);
    const none = await req('post', '/api/billing/refund', user).send({ reason: 'unsatisfied' });
    expect(none.status).toBe(409);
    const s = fake.subs.get(start.body.subscription_id);
    fake.pis.set('pi_g_inv', { id: 'pi_g_inv', amount: 1999, status: 'succeeded', metadata: {} });
    s.paidInvoice = { id: 'in_r', status: 'paid', amount_paid: 1999, payment_intent: 'pi_g_inv', status_transitions: { paid_at: now() - 86400 } };
    const ok = await req('post', '/api/billing/refund', user).send({ reason: 'unsatisfied' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'refunded', amount_cents: 1999 });
    expect(fake.refunds.at(-1).payment_intent).toBe('pi_g_inv');
    expect((await ctx.db.get('SELECT status FROM subscriptions WHERE stripe_sub_id = ?', [s.id])).status).toBe('refunded');
    expect((await req('post', '/api/billing/refund', user).send({ reason: 'other' })).status).toBe(404);
  });

  test('G8 bail leads: $100 flat, full record only after a verified payment, never credited twice', async () => {
    if (!ctx.app) return;
    expect((await req('post', '/api/billing/bondsman/profile', consumer2).send({ company_name: 'Not an agent' })).status).toBe(403);
    for (const a of [agent, agent2]) {
      expect((await req('post', '/api/billing/bondsman/profile', a).send({ company_name: `${ctx.tag} Bonds`, license_state: 'TN', states: ['TN'], counties: ['Gcounty'] })).status).toBe(200);
    }
    const list = await req('get', '/api/billing/leads?county=Gcounty&state=TN', agent);
    const lead = list.body.leads.find(l => l.id === arrests[0]);
    expect(lead).toMatchObject({ name: 'J. T.', jail_location: null, purchased: false, lead_fee_cents: 10000, lead_fee_display: '$100' });
    const start = await req('post', `/api/billing/leads/${arrests[0]}/accept`, agent).send({});
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ requires_payment: true, amount_cents: 10000 });
    const pi = start.body.payment_intent_id;
    expect(fake.pis.get(pi).amount).toBe(10000);
    expect((await req('post', `/api/billing/leads/${arrests[0]}/confirm`, agent).send({ payment_intent_id: pi })).status).toBe(402);
    fake.pis.get(pi).status = 'succeeded';
    expect((await req('post', `/api/billing/leads/${arrests[0]}/confirm`, agent2).send({ payment_intent_id: pi })).status).toBe(404);
    expect((await req('post', `/api/billing/leads/${arrests[1]}/confirm`, agent).send({ payment_intent_id: pi })).status).toBe(404);
    const ok = await req('post', `/api/billing/leads/${arrests[0]}/confirm`, agent).send({ payment_intent_id: pi });
    expect(ok.status).toBe(200);
    expect(ok.body.arrest).toMatchObject({ name: 'Jordan Testlead', jail_location: 'G County Jail' });
    await req('post', `/api/billing/leads/${arrests[0]}/confirm`, agent).send({ payment_intent_id: pi });
    const succeeded = event('payment_intent.succeeded', clone(fake.pis.get(pi)));
    await webhook(succeeded);
    await webhook({ ...succeeded, id: `${succeeded.id}_again` });
    const count = async (who) => (await ctx.db.get(`SELECT COUNT(*)::int AS n FROM lead_purchases WHERE bondsman_id = ? AND arrest_id = ? AND status = 'charged'`, [who, arrests[0]])).n;
    expect(await count(agent.user.id)).toBe(1);
    expect((await ctx.db.get('SELECT leads_accepted FROM bondsman_profiles WHERE user_id = ?', [agent.user.id])).leads_accepted).toBe(1);
    // the buyer sees the full record, the other agent still sees initials
    expect((await req('get', '/api/billing/leads?county=Gcounty&state=TN', agent)).body.leads.find(l => l.id === arrests[0]).name).toBe('Jordan Testlead');
    expect((await req('get', '/api/billing/leads?county=Gcounty&state=TN', agent2)).body.leads.find(l => l.id === arrests[0]).name).toBe('J. T.');
    expect((await req('post', `/api/billing/leads/${arrests[0]}/accept`, agent).send({})).status).toBe(409);
    // a second payment for an owned lead (e.g. two devices) is refunded
    fake.pis.set('pi_g_dup', { id: 'pi_g_dup', amount: 10000, status: 'succeeded', metadata: { package: 'bail_lead', arrest_id: String(arrests[0]), user_id: String(agent.user.id) } });
    const second = await req('post', `/api/billing/leads/${arrests[0]}/confirm`, agent).send({ payment_intent_id: 'pi_g_dup' });
    expect(second.status).toBe(409);
    expect(fake.refunds.some(r => r.payment_intent === 'pi_g_dup')).toBe(true);
    expect(await count(agent.user.id)).toBe(1);
    // the other agent may buy the same record once
    const b = await req('post', `/api/billing/leads/${arrests[0]}/accept`, agent2).send({});
    fake.pis.get(b.body.payment_intent_id).status = 'succeeded';
    expect((await req('post', `/api/billing/leads/${arrests[0]}/confirm`, agent2).send({ payment_intent_id: b.body.payment_intent_id })).status).toBe(200);
    expect(await count(agent2.user.id)).toBe(1);
    // CRM: own purchases only
    const mine = await req('get', '/api/bondsman/leads', agent);
    expect(mine.body.leads.map(l => l.arrest_id)).toEqual([arrests[0]]);
    const pid = mine.body.leads[0].id;
    expect((await req('patch', `/api/bondsman/leads/${pid}`, agent2).send({ status: 'contacted' })).status).toBe(404);
    const upd = await req('patch', `/api/bondsman/leads/${pid}`, agent).send({ status: 'contacted', notes: 'Called family' });
    expect(upd.body.lead).toMatchObject({ crm_status: 'contacted', crm_notes: 'Called family' });
    const dash = await req('get', '/api/bondsman/dashboard', agent);
    expect(dash.body).toMatchObject({ leads_bought: 1, spent_cents: 10000, pipeline: { contacted: 1 } });
  });

  test('G9 case leads: flat fee per type, sold once, contact details only for the buyer', async () => {
    if (!ctx.app) return;
    const fees = (await req('get', '/api/billing/pi-lead/fees')).body.fees;
    expect(Object.fromEntries(fees.map(f => [f.lead_type, f.fee_cents]))).toMatchObject({ personal_injury: 20000, civil_rights: 20000, employment: 10000, ice_detention: 7500 });
    const leads = {};
    for (const [type, cents] of [['personal_injury', 20000], ['civil_rights', 20000], ['employment', 10000], ['ice_detention', 7500]]) {
      const r = await req('post', '/api/billing/pi-lead/submit', consumer2).send({ case_type: type, description: 'A detailed description of what happened to me.', state: 'TN', city: 'Nashville' });
      expect(r.status).toBe(201);
      leads[type] = r.body.lead_id;
      const start = await req('post', `/api/billing/pi-lead/accept/${r.body.lead_id}`, attorney).send({});
      expect([type, start.status, start.body.amount_cents]).toEqual([type, 200, cents]);
      expect(fake.pis.get(start.body.payment_intent_id).amount).toBe(cents);
      await req('post', `/api/billing/pi-lead/release/${r.body.lead_id}`, attorney).send({});
    }
    const unverified = await ctx.register({ displayName: 'G unverified', accountType: 'attorney' });
    expect((await req('post', `/api/billing/pi-lead/accept/${leads.employment}`, unverified).send({})).status).toBe(403);
    const before = await req('get', '/api/billing/pi-leads?state=TN', attorney2);
    const row = before.body.find(l => l.id === leads.employment);
    expect(row.description).toBeUndefined();
    expect(row.contact_email).toBeUndefined();
    const hold = await req('post', `/api/billing/pi-lead/accept/${leads.employment}`, attorney).send({});
    expect((await req('get', '/api/billing/pi-leads?state=TN', attorney2)).body.some(l => l.id === leads.employment)).toBe(false);
    expect((await req('post', `/api/billing/pi-lead/accept/${leads.employment}`, attorney2).send({})).status).toBe(409);
    const pi = hold.body.payment_intent_id;
    fake.pis.get(pi).status = 'succeeded';
    const ok = await req('post', `/api/billing/pi-lead/confirm/${leads.employment}`, attorney).send({ payment_intent_id: pi });
    expect(ok.status).toBe(200);
    expect(ok.body.lead).toMatchObject({ description: 'A detailed description of what happened to me.', contact_email: consumer2.email });
    await webhook(event('payment_intent.succeeded', clone(fake.pis.get(pi))));
    expect((await ctx.db.get(`SELECT status, accepted_by FROM pi_leads WHERE id = ?`, [leads.employment]))).toMatchObject({ status: 'accepted', accepted_by: attorney.user.id });
    expect((await req('get', '/api/billing/pi-leads/mine', attorney)).body.leads.map(l => l.id)).toContain(leads.employment);
    expect((await req('get', '/api/billing/pi-leads/mine', attorney2)).body.leads.map(l => l.id)).not.toContain(leads.employment);
    // a payment that arrives after another attorney bought the lead is refunded
    fake.pis.set('pi_g_late', { id: 'pi_g_late', amount: 10000, status: 'succeeded', metadata: { package: 'case_lead', lead_id: String(leads.employment), user_id: String(attorney2.user.id) } });
    const late = await req('post', `/api/billing/pi-lead/confirm/${leads.employment}`, attorney2).send({ payment_intent_id: 'pi_g_late' });
    expect(late.status).toBe(409);
    expect(fake.refunds.some(r => r.payment_intent === 'pi_g_late')).toBe(true);
  });

  test('G10 bail-agent plan: verified before it counts; new-arrest alerts for the covered county, once', async () => {
    if (!ctx.app) return;
    const tiers = (await req('get', '/api/billing/bondsman/tiers')).body.tiers;
    expect(tiers.map(t => [t.key, t.monthly_cents, t.counties])).toEqual([['starter', 4900, 1], ['pro', 14900, 3], ['market', 34900, 'all']]);
    const start = await req('post', '/api/billing/bondsman/subscribe', agent).send({ tier: 'starter' });
    expect(start.status).toBe(200);
    expect(fake.created.at(-1).items[0].price_data).toMatchObject({ unit_amount: 4900, recurring: { interval: 'month' } });
    expect((await req('get', '/api/billing/bondsman/subscription', agent)).body.active).toBe(false);
    expect((await req('post', '/api/billing/bondsman/subscription/confirm', agent).send({ subscription_id: start.body.subscription_id })).status).toBe(402);
    paySub(start.body.subscription_id, 4900);
    const ok = await req('post', '/api/billing/bondsman/subscription/confirm', agent).send({ subscription_id: start.body.subscription_id });
    expect(ok.status).toBe(200);
    expect((await req('get', '/api/billing/bondsman/subscription', agent)).body).toMatchObject({ active: true, tier: 'starter', counties_covered: 1 });
    const { notifyCoveredBondsmen } = await import('../../services/leadAlerts.js');
    const rows = await ctx.db.all(`SELECT id, county, state, bail_amount, has_attorney FROM arrest_records WHERE source = ?`, [`roster_${ctx.tag}`]);
    await notifyCoveredBondsmen(ctx.db, rows);
    await notifyCoveredBondsmen(ctx.db, rows);
    const logged = await ctx.db.all('SELECT arrest_id FROM lead_alert_log WHERE user_id = ? ORDER BY arrest_id', [agent.user.id]);
    expect(logged.map(r => Number(r.arrest_id))).toEqual([arrests[0], arrests[1]]);   // Gcounty only, never Faraway
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM lead_alert_log WHERE user_id = ?', [agent2.user.id])).n).toBe(0);   // no plan
    // a consumer cannot buy a bail-agent plan
    expect((await req('post', '/api/billing/bondsman/subscribe', consumer2).send({ tier: 'pro' })).status).toBe(403);
  });

  test('G11 admin queue: admin role only, decisions audit-logged', async () => {
    if (!ctx.app) return;
    for (const u of [consumer, attorney, agent]) {
      expect((await req('get', '/api/admin/queue/summary', u)).status).toBe(403);
      expect((await req('post', `/api/admin/queue/bar/${attorney2.user.id}`, u).send({ approved: true })).status).toBe(403);
      expect((await req('get', '/api/billing/admin/stats', u)).status).toBe(403);
    }
    expect((await ctx.request().get('/api/admin/queue/bar')).status).toBe(401);
    await ctx.db.run('UPDATE users SET bar_verified = 0 WHERE id = ?', [attorney2.user.id]);
    const sub = await req('post', '/api/attorney/verify-bar', attorney2).send({ bar_number: 'tn 4455', state: 'tn' });
    expect(sub.body).toMatchObject({ status: 'pending_review', bar_number: 'TN4455', state: 'TN' });
    const q = await req('get', '/api/admin/queue/bar', admin);
    expect(q.body.pending.find(p => p.user_id === attorney2.user.id)).toMatchObject({ bar_number: 'TN4455', lookup_url: expect.stringMatching(/^https:/) });
    expect((await req('post', `/api/admin/queue/bar/${attorney2.user.id}`, admin).send({ approved: false })).status).toBe(400);
    expect((await req('post', `/api/admin/queue/bar/${attorney2.user.id}`, admin).send({ approved: true })).status).toBe(200);
    expect((await req('post', `/api/admin/queue/bar/${attorney2.user.id}`, admin).send({ approved: true })).status).toBe(404);
    expect((await req('get', '/api/attorney/profile', attorney2)).body.bar_verified).toBe(true);
    const audit = await ctx.db.get(`SELECT user_id, entity_id FROM audit_log WHERE action = 'admin.bar_approved' ORDER BY id DESC LIMIT 1`);
    expect({ user_id: Number(audit.user_id), entity_id: Number(audit.entity_id) }).toEqual({ user_id: admin.user.id, entity_id: attorney2.user.id });
    // a different number later removes the badge until it is checked again
    await req('post', '/api/attorney/verify-bar', attorney2).send({ bar_number: 'TN9999', state: 'TN' });
    expect((await req('get', '/api/attorney/profile', attorney2)).body).toMatchObject({ bar_verified: false, pending_bar_verification: true });
    await ctx.db.run('UPDATE users SET bar_verified = 1, pending_bar_verification = 0 WHERE id = ?', [attorney2.user.id]);
    for (const path of ['/api/admin/queue/claims', '/api/admin/queue/reports', '/api/admin/queue/reviews']) {
      expect((await req('get', path, admin)).status).toBe(200);
    }
  });

  test('G12 conflict check, firm trial, inbox with direct messages', async () => {
    if (!ctx.app) return;
    const noFirm = await req('post', '/api/conflicts/check', attorney, 'es').send({ parties: ['Ana'] });
    expect(noFirm.status).toBe(403);
    expect(noFirm.body.error).toMatch(/firma/);
    expect((await req('post', '/api/firm-acquisition/trial', consumer, 'vi').send({ firm_name: 'Nope' })).body.code).toBe('attorney_only');
    const trial = await req('post', '/api/firm-acquisition/trial', attorney, 'pt').send({ firm_name: `${ctx.tag} Law`, vertical: 'criminal_defense' });
    expect(trial.status).toBe(201);
    expect(trial.body.message).toMatch(/teste grátis de 14 dias/);
    const st = await req('get', '/api/firm-acquisition/status', attorney);
    expect(st.body).toMatchObject({ has_firm: true, trial_active: true, trial_days_left: 14, member_count: 1 });
    expect((await req('post', '/api/firm-acquisition/trial', attorney).send({ firm_name: 'Second' })).status).toBe(409);
    await req('post', '/api/conflicts/index', attorney).send({ parties: [{ name: "O'Brien, José", role: 'client' }, { name: 'Acme Corp.', role: 'adverse' }] });
    const check = await req('post', '/api/conflicts/check', attorney).send({ parties: [{ name: 'jose obrien' }, { name: 'ACME CORPORATION' }, { name: 'Jo' }] });
    expect(check.body.conflicts.map(c => [c.name, c.matches[0].match])).toEqual([['jose obrien', 'exact'], ['ACME CORPORATION', 'exact']]);
    // another firm's id (one this attorney is not a member of — not a fixed number:
    // on a fresh database firm 1 is this attorney's own trial firm)
    const otherFirm = await ctx.db.get(`INSERT INTO firms (name, owner_id) VALUES (?, ?) RETURNING id`, [`${ctx.tag} Other`, consumer.user.id]);
    expect((await req('post', '/api/conflicts/check', attorney).send({ parties: ['x'], firm_id: otherFirm.id })).status).toBe(403);
    await ctx.db.run('DELETE FROM firms WHERE id = ?', [otherFirm.id]);
    // the second attorney is invited, sees the invite and joins; the other firm's index stays private
    expect((await req('post', '/api/firm-acquisition/invite', attorney).send({ email: attorney2.email, role: 'associate' })).status).toBe(201);
    const inv = await req('get', '/api/firm-acquisition/invites', attorney2);
    expect(inv.body.invites.length).toBe(1);
    expect((await req('post', `/api/firm-acquisition/invites/${inv.body.invites[0].id}/accept`, consumer).send({})).status).toBe(404);
    expect((await req('post', `/api/firm-acquisition/invites/${inv.body.invites[0].id}/accept`, attorney2).send({})).status).toBe(200);
    expect((await req('get', '/api/firm-acquisition/checklist', attorney)).body.checklist.find(c => c.key === 'team_invited').done).toBe(true);
    // trial ended: the firm and its data stay, the screen is told
    await ctx.db.run(`UPDATE firm_trials SET trial_end = NOW() - INTERVAL '1 day' WHERE user_id = ?`, [attorney.user.id]);
    expect((await req('get', '/api/firm-acquisition/status', attorney)).body).toMatchObject({ trial_active: false, trial_ended: true, trial_days_left: 0 });
    // direct messages reach the attorney inbox
    // an approved listing claim links the account to a directory listing (the listing row is not touched)
    const listing = await ctx.db.get(`SELECT id FROM lawyers WHERE user_id IS NULL
                                       AND id NOT IN (SELECT lawyer_id FROM attorney_profiles WHERE lawyer_id IS NOT NULL) ORDER BY id DESC LIMIT 1`);
    await ctx.db.run('INSERT INTO attorney_profiles (user_id, lawyer_id) VALUES (?, ?) ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET lawyer_id = EXCLUDED.lawyer_id', [attorney.user.id, listing.id]);
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM attorney_profiles WHERE user_id = ?', [attorney.user.id]); });
    expect((await req('post', '/api/messages/bulk', consumer2).send({ lawyer_ids: [listing.id], message: 'Can you take my case?' })).body.sent).toBe(1);
    const inbox = await req('get', '/api/attorney/inbox', attorney);
    expect(inbox.body.direct_messages[0]).toMatchObject({ user_id: consumer2.user.id, last_message: 'Can you take my case?', unread: 1 });
    expect(inbox.body.summary.unread_direct).toBe(1);
    expect((await req('post', '/api/messages/direct', attorney).send({ to: consumer.user.id, body: 'cold' })).status).toBe(404);
    expect((await req('post', '/api/messages/direct', attorney).send({ to: consumer2.user.id, body: 'Yes — call my office.' })).status).toBe(201);
    const thread = await req('get', `/api/messages/direct?with=${attorney.user.id}`, consumer2);
    expect(thread.body.messages.map(m => [m.content, m.direction])).toEqual([['Yes — call my office.', 'received'], ['Can you take my case?', 'sent']]);
    expect((await req('get', '/api/attorney/inbox', attorney)).body.summary.unread_direct).toBe(0);
  });
  test('G13 a configured Stripe price id is used only when it is exactly the plan price', async () => {
    if (!ctx.app) return;
    const { planLine, chargeItem, _resetPriceChecks } = await import('../../services/stripeBilling.js');
    const stripe = new (await import('stripe')).default('k');
    _resetPriceChecks();
    fake.prices.set('price_ok', { id: 'price_ok', active: true, unit_amount: 2499, currency: 'usd', recurring: { interval: 'month' } });
    fake.prices.set('price_old', { id: 'price_old', active: true, unit_amount: 2999, currency: 'usd', recurring: { interval: 'month' } });   // the old setup script's Advisor price
    const line = planLine('tier', 'advisor', 'monthly');
    expect(await chargeItem(stripe, { ...line, priceId: 'price_ok' })).toEqual({ price: 'price_ok' });
    const fallback = await chargeItem(stripe, { ...line, priceId: 'price_old' });
    expect(fallback.price_data).toMatchObject({ unit_amount: 2499, recurring: { interval: 'month' } });
    expect(await chargeItem(stripe, { ...line, priceId: 'price_missing' })).toEqual(line.inline);
    // the setup script builds its price list from plans.js (no second copy of the amounts)
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../../../scripts/setup-stripe-products.js', import.meta.url), 'utf8');
    expect(src).toMatch(/from '\.\.\/src\/routes\/billing\/plans\.js'/);
    expect(src).not.toMatch(/\b(2999|2900|7999|24900|39900)\b/);
  });
});
