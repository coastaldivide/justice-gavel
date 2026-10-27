/**
 * bond_desk_payments.int.test.js — Bond Desk card payments, automatic payment plans, the pay page,
 * forms set up by staff, CSV import, export and staff seats (docs/BOND_DESK.md), on the real app +
 * real Postgres, a fake Telnyx server and a fake Stripe with the Connect endpoints
 * (helpers/fakeStripeConnect.js):
 *
 *   PAY1  Connect: fee terms first; Express account + onboarding link; account.updated (Connect secret)
 *         turns card payments on; replay and bad signature change nothing; staff cannot set it up
 *   PAY2  autopay: link → consent snapshot → card saved (webhook) → the job charges the installment due
 *         today on the agency's account (idempotency key bd-inst-<id>-1, 99¢ fee) and posts it once,
 *         even with webhook replays and a second run; never more than the balance
 *   PAY3  autopay: a declined card texts + e-mails payer and agent and is tried once more 3 days later
 *   PAY4  autopay: 3-D Secure → off-session charge cancelled, payer texted a link, confirmed in Checkout,
 *         posted once; payer stops autopay on the link; plan changed → not charged; flag off → 503
 *   PAY5  pay page: limits and consent, Checkout on the agency's account, paid by webhook (once),
 *         "Unassigned payments", attached to a bond with a numbered receipt (once), receipt texted
 *   PAY6  forms set up for the agency: request + PDFs (hidden), admin queue (403 for others), mapping
 *         with the same tool, hand-over, audit log
 *   PAY7  CSV import: per-row errors, all or nothing, cents exact, power numbers unique, imported balance
 *   PAY8  export ZIP: every report, receipt PDFs, signed PDFs, README; unzips; owner only; 3 an hour
 *   PAY9  staff seats: invite, seats_full at the plan's limit, accept with the invited e-mail only, staff
 *         work in the owner's desk but not billing / Connect / export / staff; removal ends access
 */
import { jest } from '@jest/globals';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { describeIntegration, initSuite } from './_harness.js';
import { newFakeState, fakeStripeClass, completeSetupSession, completePaymentSession, signEvent } from '../helpers/fakeStripeConnect.js';

const fake = newFakeState();
jest.unstable_mockModule('stripe', () => ({ default: fakeStripeClass(fake) }));

const STRIPE_KEY = 'sk_test_bd_payments';
const WH = 'whsec_platform_bd';
const WH_CONNECT = 'whsec_connect_bd';
const TZ = 'America/Chicago';
const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

async function sampleForm() {
  const d = await PDFDocument.create();
  const p = d.addPage([612, 792]);
  const f = d.getForm();
  f.createTextField('Defendant').addToPage(p, { x: 50, y: 700, width: 300, height: 20 });
  f.createTextField('Premium').addToPage(p, { x: 50, y: 660, width: 300, height: 20 });
  return Buffer.from(await d.save());
}

describeIntegration('Bond Desk card payments, import / export, staff (real Postgres, fake Stripe Connect)', () => {
  const ctx = initSuite();
  const texts = [];
  let telnyx;
  let owner, owner2, staffA, staffB, stranger, admin;
  let tz; let today; let at9;
  let ipN = 0;
  const req = (m, p, who, ip) => {
    let r = ctx.request()[m](p).set('X-Forwarded-For', ip || `10.91.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (who) r = r.set(who.headers);
    return r;
  };
  const bd = (m, p, who = owner) => req(m, `/api/bond-desk${p}`, who);
  const pub = (m, p, ip) => req(m, `/api/bd-pay${p}`, null, ip);
  let evSeq = 0;
  const event = (type, object, account) => ({ id: `evt_bdp_${Date.now()}_${++evSeq}`, type, account, data: { object } });
  const webhook = (ev, secret = WH_CONNECT) => { const { raw, sig } = signEvent(ev, secret); return ctx.request().post('/api/billing/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(raw); };
  const textsTo = (phone) => texts.filter((t) => t.to === phone);

  beforeAll(async () => {
    if (!ctx.app) return;
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WH;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = WH_CONNECT;
    process.env.BOND_AUTOPAY_ENABLED = 'true';
    telnyx = http.createServer((rq, rs) => {
      let data = '';
      rq.on('data', (c) => { data += c; });
      rq.on('end', () => { texts.push(JSON.parse(data || '{}')); rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify({ data: { id: `tx_p${texts.length}` } })); });
    });
    await new Promise((r) => telnyx.listen(0, '127.0.0.1', r));
    process.env.TELNYX_API_KEY = 'KEY_test';
    process.env.TELNYX_FROM_NUMBER = '+16155550100';
    process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyx.address().port}`;
    [owner, owner2] = await Promise.all(['O1', 'O2'].map((n) => ctx.register({ displayName: `BDP ${n}`, accountType: 'bail_agent' })));
    [staffA, staffB, stranger, admin] = await Promise.all(['SA', 'SB', 'X', 'ADM'].map((n) => ctx.register({ displayName: `BDP ${n}` })));
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    for (const [a, name, sub] of [[owner, 'Delta Bail Bonds', `sub_${ctx.tag}_1`], [owner2, 'Echo Bail', `sub_${ctx.tag}_2`]]) {
      const r = await req('post', '/api/billing/bondsman/profile', a).send({ company_name: name, license_number: 'TN-777', license_state: 'TN', states: ['TN'], counties: ['Davidson'] });
      expect(r.status).toBe(200);
      await ctx.db.run(`INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, amount_cents) VALUES (?, 'starter', 'active', ?, 9900)`, [a.user.id, sub]);
    }
    await ctx.db.run(`UPDATE bondsman_profiles SET phone = '615-555-0188', email = ? WHERE user_id = ?`, [owner.email, owner.user.id]);
    await ctx.db.run('UPDATE users SET timezone = ? WHERE id IN (?, ?)', [TZ, owner.user.id, owner2.user.id]);
    const { todayInZone, zonedDateTimeToUtc } = await import('../../utils/timezone.js');
    tz = TZ; today = todayInZone(tz); at9 = (day) => zonedDateTimeToUtc(day, 9, 0, tz);
    ctx.addCleanup(async (db) => {
      const ids = [owner, owner2].map((a) => a.user.id).join(',');
      for (const sql of [
        `DELETE FROM bd_staff WHERE owner_id IN (${ids})`, `DELETE FROM bd_staff_invites WHERE owner_id IN (${ids})`,
        `DELETE FROM bd_texts WHERE agent_id IN (${ids})`, `DELETE FROM bd_pay_requests WHERE agent_id IN (${ids})`,
        `DELETE FROM bd_autopay WHERE agent_id IN (${ids})`, `DELETE FROM bd_powers WHERE agent_id IN (${ids})`,
        `DELETE FROM bd_bonds WHERE agent_id IN (${ids})`, `DELETE FROM bd_forms WHERE agent_id IN (${ids})`,
        `DELETE FROM bd_setup_requests WHERE agent_id IN (${ids})`, `DELETE FROM bd_payments WHERE agent_id IN (${ids})`,
        `DELETE FROM bd_counters WHERE agent_id IN (${ids})`, `DELETE FROM bd_connect_accounts WHERE agent_id IN (${ids})`,
        `DELETE FROM bondsman_subscriptions WHERE user_id IN (${ids})`, `DELETE FROM bondsman_profiles WHERE user_id IN (${ids})`,
        `DELETE FROM sms_opt_outs WHERE phone LIKE '+1615555%'`,
      ]) await db.run(sql).catch((e) => { throw new Error(`cleanup failed: ${sql}: ${e.message}`); });
    });
  });
  afterAll(async () => {
    if (telnyx) await new Promise((r) => telnyx.close(r));
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET', 'BOND_AUTOPAY_ENABLED']) delete process.env[k];
  });

  /** A bond with charges and a plan: installments [{ due_on, amount_cents }]. */
  const bondWithPlan = async (charges, plan, extra = {}) => {
    const b = (await bd('post', '/bonds').send({ defendant_name: 'Riley Stone', bond_amount_cents: 1000000, defendant_phone: '615-555-0141', defendant_email: 'riley@example.com', ...extra })).body.bond;
    for (const c of charges) expect((await bd('post', `/bonds/${b.id}/charges`).send({ kind: c.kind || 'premium', amount_cents: c.amount_cents })).status).toBe(201);
    if (plan) expect((await bd('put', `/bonds/${b.id}/plan`).send({ installments: plan })).status).toBe(200);
    return b;
  };
  /** Send the payer's link, agree, save a card (Checkout + webhook). → { token, autopay } */
  const setUpAutopay = async (bondId, pm, { deliver = 'none' } = {}) => {
    const r = await bd('post', `/bonds/${bondId}/autopay/link`).send({ to: 'defendant', deliver, consent_confirmed: true });
    expect(r.status).toBe(201);
    const token = r.body.link.split('/autopay/')[1];
    const start = await pub('post', `/autopay/${token}/start`).set('User-Agent', 'PayerBrowser/1.0').send({ agree: true, consent_version: 'autopay-2026-10' });
    expect(start.status).toBe(200);
    const row = await ctx.db.get('SELECT * FROM bd_autopay WHERE bond_id = ? ORDER BY id DESC LIMIT 1', [bondId]);
    const s = completeSetupSession(fake, row.setup_session_id, pm, { last4: pm === 'pm_ok' ? '4242' : '0002' });
    expect((await webhook(event('checkout.session.completed', s, row.stripe_account_id))).status).toBe(200);
    return { token, row };
  };
  const runJob = async (day) => (await import('../../services/bondDesk/autopay.js')).runAutopay(ctx.db, { now: at9(day) });
  let acct;

  test('PAY1 Connect onboarding (Express) and the account.updated webhook', async () => {
    if (!ctx.app) return;
    expect((await bd('get', '/connect')).body).toMatchObject({ status: 'none', charges_enabled: false, pay_link: null, autopay_fee_cents: 99 });
    expect((await bd('post', '/connect/start').send({})).body.code).toBe('fees_ack_required');
    const s = await bd('post', '/connect/start').send({ fees_acknowledged: true });
    expect(s.status).toBe(200);
    expect(s.body.url).toMatch(/^https:\/\/connect\.stripe\.test\/setup\/acct_/);
    const created = fake.calls.find((c) => c.name === 'accounts.create');
    expect(created.params).toMatchObject({ type: 'express', country: 'US', metadata: { agent_id: String(owner.user.id) } });
    const link = fake.calls.find((c) => c.name === 'accountLinks.create');
    expect(link.params.return_url).toMatch(/\/bond-desk\/settings\?connect=return$/);
    acct = (await ctx.db.get('SELECT stripe_account_id FROM bd_connect_accounts WHERE agent_id = ?', [owner.user.id])).stripe_account_id;
    // again: the same account, a fresh link
    expect((await bd('post', '/connect/start').send({ fees_acknowledged: true })).status).toBe(200);
    expect(fake.calls.filter((c) => c.name === 'accounts.create').length).toBe(1);
    expect((await bd('get', '/connect')).body.status).toBe('onboarding');
    // no card payments until Stripe says so: autopay link refused
    const early = await bondWithPlan([{ amount_cents: 10000 }], [{ due_on: today, amount_cents: 10000 }]);
    expect((await bd('post', `/bonds/${early.id}/autopay/link`).send({ to: 'defendant', deliver: 'none' })).body.code).toBe('payments_not_set_up');
    // Stripe: onboarding finished (Connect endpoint secret; a bad signature is refused; a replay changes nothing)
    const bad = await ctx.request().post('/api/billing/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', 'nope').send('{"id":"evt_x","type":"account.updated"}');
    expect(bad.status).toBe(400);
    const acc = { ...fake.accounts.get(acct), charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { disabled_reason: null } };
    fake.accounts.set(acct, acc);
    const ev = event('account.updated', acc, acct);
    expect((await webhook(ev)).body).toMatchObject({ received: true });
    expect((await webhook(ev)).body).toMatchObject({ duplicate: true });
    const st = (await bd('get', '/connect')).body;
    expect(st).toMatchObject({ status: 'enabled', charges_enabled: true, payouts_enabled: true });
    expect(st.pay_link).toMatch(/\/pay\/[a-z0-9]{10,32}$/);
    expect((await bd('post', '/connect/dashboard')).body.url).toBe(`https://connect.stripe.test/express/${acct}`);
    expect((await bd('post', '/connect/refresh')).body.status).toBe('enabled');
  });

  test('PAY2 autopay: consent snapshot, card saved, charged once on the agency account, never over the balance', async () => {
    if (!ctx.app) return;
    const b = await bondWithPlan([{ amount_cents: 30000 }], [{ due_on: today, amount_cents: 10000 }, { due_on: '2099-01-01', amount_cents: 10000 }, { due_on: '2099-02-01', amount_cents: 10000 }]);
    // the payer's page: consent with amounts, dates, how to stop, "all payments are final"
    const r = await bd('post', `/bonds/${b.id}/autopay/link`).send({ to: 'defendant', deliver: 'sms' });
    expect(r.body.code).toBe('consent_required');
    const link = await bd('post', `/bonds/${b.id}/autopay/link`).send({ to: 'defendant', deliver: 'sms', consent_confirmed: true });
    expect(link.status).toBe(201);
    expect(link.body.delivery.sms).toBe('sent');
    expect(textsTo('+16155550141').pop().text).toContain(link.body.link);
    const token = link.body.link.split('/autopay/')[1];
    const view = await pub('get', `/autopay/${token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ status: 'link_sent', can_start: true, agency: { name: 'Delta Bail Bonds' }, balance_cents: 30000 });
    expect(view.body.schedule).toEqual([{ due_on: today, amount_cents: 10000 }, { due_on: '2099-01-01', amount_cents: 10000 }, { due_on: '2099-02-01', amount_cents: 10000 }]);
    for (const part of ['$100.00', '01/01/2099', 'Stop automatic payments', '615-555-0188', 'All payments are final.']) expect(view.body.consent.text).toContain(part);
    expect((await pub('get', `/autopay/${token}?lang=es`)).body.consent.text).toContain('Todos los pagos son definitivos.');
    expect((await pub('post', `/autopay/${token}/start`).send({ agree: false })).body.code).toBe('consent_required');
    expect((await pub('post', `/autopay/${token}/start`).send({ agree: true, consent_version: 'old' })).body.code).toBe('consent_changed');
    expect((await pub('get', '/autopay/not-a-real-token-but-long-enough-to-pass-the-shape-check')).status).toBe(404);
    const start = await pub('post', `/autopay/${token}/start`).set('User-Agent', 'PayerBrowser/1.0').send({ agree: true, consent_version: 'autopay-2026-10' });
    expect(start.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const sess = fake.calls.filter((c) => c.name === 'checkout.sessions.create').pop();
    expect(sess).toMatchObject({ account: acct, params: { mode: 'setup', payment_method_types: ['card'] } });
    let row = await ctx.db.get('SELECT * FROM bd_autopay WHERE bond_id = ?', [b.id]);
    expect(row).toMatchObject({ status: 'link_sent', consent_version: 'autopay-2026-10', consent_lang: 'en', consent_user_agent: 'PayerBrowser/1.0' });
    expect(row.consent_text).toBe(view.body.consent.text);
    expect(row.consent_ip).toBeTruthy();
    expect(row.consent_at).toBeTruthy();
    expect(JSON.stringify(row)).not.toMatch(/4242 ?4242|card_number/);
    // the payer finished Checkout: the page itself picks it up even before the webhook
    completeSetupSession(fake, row.setup_session_id, 'pm_ok');
    expect((await pub('get', `/autopay/${token}`)).body).toMatchObject({ status: 'active', card: { brand: 'visa', last4: '4242' } });
    row = await ctx.db.get('SELECT * FROM bd_autopay WHERE bond_id = ?', [b.id]);
    expect(row).toMatchObject({ status: 'active', stripe_payment_method_id: 'pm_ok', card_last4: '4242' });
    expect(row.stripe_customer_id).toMatch(/^cus_/);
    // a second link while active is refused
    expect((await bd('post', `/bonds/${b.id}/autopay/link`).send({ to: 'defendant', deliver: 'none' })).body.code).toBe('autopay_active');

    // the job: the installment due today, on the agency's account, with the key and the 99¢ fee
    const out = await runJob(today);
    expect(out.succeeded).toBeGreaterThanOrEqual(1);
    const pi = fake.calls.filter((c) => c.name === 'paymentIntents.create' && c.params.metadata.bd_bond_id === String(b.id));
    expect(pi).toHaveLength(1);
    const inst = await ctx.db.get('SELECT id FROM bd_installments WHERE bond_id = ? AND due_on = ?', [b.id, today]);
    expect(pi[0]).toMatchObject({ account: acct, idem: `bd-inst-${inst.id}-1`,
      params: { amount: 10000, currency: 'usd', off_session: true, confirm: true, application_fee_amount: 99, customer: row.stripe_customer_id, payment_method: 'pm_ok' } });
    let d = (await bd('get', `/bonds/${b.id}`)).body;
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({ amount_cents: 10000, method: 'card', source: 'autopay', receipt_no: expect.stringMatching(/^R-\d{6}$/) });
    expect(d.money.balance_cents).toBe(20000);
    expect(d.installments[0].status).toBe('paid');
    // webhook replays (two event ids, the same PaymentIntent) and a second run change nothing
    const piObj = fake.pis.get((await ctx.db.get('SELECT stripe_pi_id FROM bd_autopay_attempts WHERE bond_id = ?', [b.id])).stripe_pi_id);
    for (let i = 0; i < 2; i++) expect((await webhook(event('payment_intent.succeeded', piObj, acct))).status).toBe(200);
    await runJob(today);
    d = (await bd('get', `/bonds/${b.id}`)).body;
    expect(d.payments).toHaveLength(1);
    expect(fake.calls.filter((c) => c.name === 'paymentIntents.create' && c.params.metadata.bd_bond_id === String(b.id))).toHaveLength(1);
    const ap = (await bd('get', `/bonds/${b.id}/autopay`)).body;
    expect(ap).toMatchObject({ enabled: true, autopay: { status: 'active', card: { last4: '4242' } }, plan_changed: false });
    expect(ap.attempts[0]).toMatchObject({ attempt: 1, status: 'succeeded', amount_cents: 10000, fee_cents: 99 });

    // never more than the balance: the plan says 250.00 today but a 50.00 charge was voided since
    const c = await bondWithPlan([{ amount_cents: 20000 }, { amount_cents: 5000, kind: 'fee' }], [{ due_on: today, amount_cents: 25000 }]);
    await setUpAutopay(c.id, 'pm_ok');
    const fee = (await bd('get', `/bonds/${c.id}`)).body.charges.find((x) => x.kind === 'fee');
    expect((await bd('post', `/charges/${fee.id}/void`).send({ reason: 'waived' })).status).toBe(200);
    await runJob(today);
    const cpi = fake.calls.filter((x) => x.name === 'paymentIntents.create' && x.params.metadata.bd_bond_id === String(c.id));
    expect(cpi).toHaveLength(1);
    expect(cpi[0].params.amount).toBe(20000);
    expect((await bd('get', `/bonds/${c.id}`)).body.money.balance_cents).toBe(0);
  });

  test('PAY3 a declined card: payer and agent told, one retry 3 days later, then no more', async () => {
    if (!ctx.app) return;
    const b = await bondWithPlan([{ amount_cents: 15000 }], [{ due_on: today, amount_cents: 15000 }], { defendant_phone: '615-555-0142' });
    await setUpAutopay(b.id, 'pm_decline', { deliver: 'sms' });
    const before = texts.length;
    await runJob(today);
    const a1 = await ctx.db.get('SELECT * FROM bd_autopay_attempts WHERE bond_id = ? AND attempt = 1', [b.id]);
    const { addDays } = await import('../../utils/timezone.js');
    expect(a1).toMatchObject({ status: 'failed', failure_code: 'card_declined' });
    expect(String(a1.retry_on).slice(0, 10) === addDays(today, 3) || new Date(a1.retry_on).toISOString().slice(0, 10) <= addDays(today, 3)).toBe(true);
    const sent = texts.slice(before);
    expect(sent.some((t) => t.to === '+16155550142' && /did not go through/.test(t.text))).toBe(true);
    expect(sent.some((t) => t.to === '+16155550188' && /declined/.test(t.text))).toBe(true);
    expect((await ctx.db.get(`SELECT COUNT(*)::int AS n FROM bd_texts WHERE bond_id = ? AND purpose = 'autopay_failed'`, [b.id])).n).toBe(2);
    // the same day again: nothing new; two days later: nothing; three days later: the retry
    await runJob(today);
    await runJob(addDays(today, 2));
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM bd_autopay_attempts WHERE bond_id = ?', [b.id])).n).toBe(1);
    await runJob(addDays(today, 3));
    const a2 = await ctx.db.get('SELECT * FROM bd_autopay_attempts WHERE bond_id = ? AND attempt = 2', [b.id]);
    expect(a2).toMatchObject({ status: 'failed', retry_on: null, idempotency_key: `bd-inst-${a1.installment_id}-2` });
    await runJob(addDays(today, 6));
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM bd_autopay_attempts WHERE bond_id = ?', [b.id])).n).toBe(2);
    expect((await bd('get', `/bonds/${b.id}`)).body.payments).toHaveLength(0);
  });

  test('PAY4 3-D Secure → confirm by link; payer stops; plan changed; flag off', async () => {
    if (!ctx.app) return;
    const b = await bondWithPlan([{ amount_cents: 12000 }], [{ due_on: today, amount_cents: 12000 }], { defendant_phone: '615-555-0143' });
    const { token } = await setUpAutopay(b.id, 'pm_3ds', { deliver: 'sms' });
    await runJob(today);
    const att = await ctx.db.get('SELECT * FROM bd_autopay_attempts WHERE bond_id = ?', [b.id]);
    expect(att.status).toBe('action_needed');
    expect(fake.cancelled).toContain(att.stripe_pi_id);
    const msgText = textsTo('+16155550143').pop().text;
    expect(msgText).toMatch(/confirm the payment of \$120\.00/);
    const fresh = /\/autopay\/([A-Za-z0-9_-]+)/.exec(msgText)[1];
    expect(fresh).not.toBe(token);
    expect((await pub('get', `/autopay/${token}`)).status).toBe(404);   // the old link was replaced
    expect((await pub('get', `/autopay/${fresh}`)).body.action_needed).toMatchObject({ amount_cents: 12000 });
    const conf = await pub('post', `/autopay/${fresh}/confirm`).send({});
    expect(conf.body.url).toMatch(/checkout\.stripe\.test/);
    const cs = fake.calls.filter((c) => c.name === 'checkout.sessions.create').pop();
    expect(cs).toMatchObject({ account: acct, params: { mode: 'payment', payment_intent_data: { application_fee_amount: 99, metadata: { bd_kind: 'autopay', bd_attempt_id: String(att.id) } } } });
    const sessId = (await ctx.db.get('SELECT action_session_id FROM bd_autopay_attempts WHERE id = ?', [att.id])).action_session_id;
    const { session, pi } = completePaymentSession(fake, sessId);
    expect((await webhook(event('checkout.session.completed', session, acct))).status).toBe(200);
    expect((await webhook(event('payment_intent.succeeded', pi, acct))).status).toBe(200);
    expect((await webhook(event('payment_intent.succeeded', pi, acct))).status).toBe(200);
    const d = (await bd('get', `/bonds/${b.id}`)).body;
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({ amount_cents: 12000, source: 'autopay' });
    expect((await ctx.db.get('SELECT status FROM bd_autopay_attempts WHERE id = ?', [att.id])).status).toBe('succeeded');

    // the payer stops it on the link page: card detached, the agent told, nothing charged after
    const s2 = await bondWithPlan([{ amount_cents: 9000 }], [{ due_on: today, amount_cents: 9000 }]);
    const { token: t2 } = await setUpAutopay(s2.id, 'pm_ok');
    const stop = await pub('post', `/autopay/${t2}/stop`).send({});
    expect(stop.body).toMatchObject({ status: 'stopped', stopped_by: 'payer' });
    expect(fake.detached).toContain('pm_ok');
    await runJob(today);
    expect(fake.calls.filter((c) => c.name === 'paymentIntents.create' && c.params.metadata.bd_bond_id === String(s2.id))).toHaveLength(0);
    expect((await pub('post', `/autopay/${t2}/stop`).send({})).body.code).toBe('autopay_not_active');

    // the plan changed after the payer agreed: that installment is not charged; the agent sees it
    const s3 = await bondWithPlan([{ amount_cents: 8000 }], [{ due_on: '2099-03-01', amount_cents: 8000 }]);
    await setUpAutopay(s3.id, 'pm_ok');
    expect((await bd('put', `/bonds/${s3.id}/plan`).send({ installments: [{ due_on: today, amount_cents: 8000 }] })).status).toBe(200);
    expect((await bd('get', `/bonds/${s3.id}/autopay`)).body.plan_changed).toBe(true);
    await runJob(today);
    expect(fake.calls.filter((c) => c.name === 'paymentIntents.create' && c.params.metadata.bd_bond_id === String(s3.id))).toHaveLength(0);
    // the agent stops it
    expect((await bd('post', `/bonds/${s3.id}/autopay/stop`).send({ reason: 'new plan' })).body.autopay.status).toBe('stopped');

    // ⚖ flag off: 503 feature_unavailable on the agent's and the payer's routes, and the job does nothing
    process.env.BOND_AUTOPAY_ENABLED = 'false';
    try {
      const off = await bd('post', `/bonds/${s3.id}/autopay/link`).send({ to: 'defendant', deliver: 'none' });
      expect([off.status, off.body.code]).toEqual([503, 'feature_unavailable']);
      expect((await pub('get', `/autopay/${fresh}`)).status).toBe(503);
      expect(await runJob(today)).toMatchObject({ skipped: 'off' });
      expect((await bd('get', '/access')).body.autopay_enabled).toBe(false);
    } finally { process.env.BOND_AUTOPAY_ENABLED = 'true'; }
  });

  test('PAY5 pay page: limits, Checkout on the agency account, unassigned → attached once with a receipt', async () => {
    if (!ctx.app) return;
    const slug = (await bd('get', '/connect')).body.pay_link.split('/pay/')[1];
    expect((await pub('get', `/agency/${slug}`)).body).toMatchObject({ agency: { name: 'Delta Bail Bonds' }, available: true, min_cents: 100, max_cents: 5000000 });
    expect((await pub('get', '/agency/nosuchagencyslug')).status).toBe(404);
    const ok = { amount_cents: 25000, payer_name: 'Pat Payer', payer_phone: '615-555-0150', payer_email: 'pat@example.com', defendant_name: 'Sam Stone', receipt_by_text: true, agree_final: true };
    const ip = '10.92.0.1';
    for (const [b, code] of [[{ ...ok, amount_cents: 99 }, 'pay_amount'], [{ ...ok, amount_cents: 5000001 }, 'pay_amount'], [{ ...ok, amount_cents: 12.5 }, 'pay_amount'],
      [{ ...ok, payer_phone: null, payer_email: null }, 'contact_required'], [{ ...ok, agree_final: false }, 'consent_required'], [{ ...ok, defendant_name: '' }, 'required']]) {
      const r = await pub('post', `/agency/${slug}/checkout`, ip).send(b);
      expect([r.status, r.body.code]).toEqual([400, code]);
    }
    const r = await pub('post', `/agency/${slug}/checkout`, '10.92.0.2').send(ok);
    expect(r.body.url).toMatch(/checkout\.stripe\.test/);
    const cs = fake.calls.filter((c) => c.name === 'checkout.sessions.create').pop();
    expect(cs).toMatchObject({ account: acct, params: { mode: 'payment', line_items: [{ price_data: { unit_amount: 25000, currency: 'usd' } }] } });
    expect(cs.params.payment_intent_data.application_fee_amount).toBeUndefined();
    const pr = await ctx.db.get('SELECT * FROM bd_pay_requests WHERE agent_id = ? ORDER BY id DESC LIMIT 1', [owner.user.id]);
    expect({ ...pr, amount_cents: Number(pr.amount_cents) }).toMatchObject({ status: 'started', amount_cents: 25000, payer_phone: '+16155550150' });
    const { session, pi } = completePaymentSession(fake, pr.checkout_session_id);
    expect((await webhook(event('payment_intent.succeeded', pi, acct))).status).toBe(200);
    expect((await webhook(event('checkout.session.completed', session, acct))).status).toBe(200);
    const list = (await bd('get', '/pay-requests')).body.pay_requests;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'paid', amount_cents: 25000, payer_name: 'Pat Payer', defendant_name: 'Sam Stone' });
    // attach: over the balance refused; then posted once with a receipt, and the receipt texted (5¢)
    const small = await bondWithPlan([{ amount_cents: 10000 }], null);
    expect((await bd('post', `/pay-requests/${list[0].id}/attach`).send({ bond_id: small.id })).body.code).toBe('over_balance');
    const big = await bondWithPlan([{ amount_cents: 40000 }], null);
    const before = texts.length;
    const at = await bd('post', `/pay-requests/${list[0].id}/attach`).send({ bond_id: big.id });
    expect(at.status).toBe(200);
    expect(at.body.payment).toMatchObject({ amount_cents: 25000, method: 'card', source: 'pay_link', receipt_no: expect.stringMatching(/^R-/) });
    expect(at.body.receipt.sms).toBe('sent');
    expect(texts.slice(before).some((t) => t.to === '+16155550150' && t.text.includes(at.body.payment.receipt_no))).toBe(true);
    expect((await bd('post', `/pay-requests/${list[0].id}/attach`).send({ bond_id: big.id })).body.code).toBe('already_attached');
    expect((await webhook(event('payment_intent.succeeded', pi, acct))).status).toBe(200);
    expect((await bd('get', `/bonds/${big.id}`)).body.payments).toHaveLength(1);
    expect((await bd('get', '/pay-requests')).body.pay_requests).toHaveLength(0);
    expect((await bd('get', '/pay-requests?status=attached')).body.pay_requests[0]).toMatchObject({ bond_id: big.id });
    // another agency cannot see or attach it
    expect((await bd('post', `/pay-requests/${list[0].id}/attach`, owner2).send({ bond_id: big.id })).status).toBe(404);
    // rate limit: 10 starts per IP per 15 minutes
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) limited = (await pub('post', `/agency/${slug}/checkout`, '10.92.0.9').send({ ...ok, amount_cents: 100 })).status === 429;
    expect(limited).toBe(true);
  });

  test('PAY6 forms set up for the agency: request, admin queue, mapping, hand-over, audit', async () => {
    if (!ctx.app) return;
    const r = await bd('post', '/forms-setup').send({ note: 'Our surety forms' });
    expect(r.status).toBe(201);
    expect((await bd('post', '/forms-setup').send({})).body.code).toBe('setup_open');
    const id = r.body.request.id;
    const up = await bd('post', `/forms-setup/${id}/files`).field('name', 'Surety Application').attach('file', await sampleForm(), 'surety.pdf');
    expect(up.status).toBe(201);
    expect(up.body.form.setup_pending).toBe(true);
    expect((await bd('get', '/forms')).body.forms.find((f) => f.id === up.body.form.id)).toBeUndefined();
    expect((await bd('get', '/forms-setup')).body.requests[0]).toMatchObject({ status: 'requested', forms: [{ name: 'Surety Application' }] });
    // the queue: admins only
    expect((await req('get', '/api/admin/bd-setup', owner)).status).toBe(403);
    const q = await req('get', '/api/admin/bd-setup', admin);
    expect(q.body.requests.find((x) => x.id === id)).toMatchObject({ status: 'requested', agency: 'Delta Bail Bonds', form_count: 1 });
    expect((await req('get', `/api/admin/bd-setup/${id}/forms`, admin)).body.code).toBe('setup_not_started');
    expect((await req('post', `/api/admin/bd-setup/${id}/start`, admin)).body.request.status).toBe('in_progress');
    expect((await bd('get', '/forms-setup')).body.requests[0].status).toBe('in_progress');
    const forms = (await req('get', `/api/admin/bd-setup/${id}/forms`, admin)).body.forms;
    expect(forms).toHaveLength(1);
    const patch = await req('patch', `/api/admin/bd-setup/${id}/forms/${forms[0].id}`, admin).send({ roles: ['defendant'], field_map: { Defendant: 'bond.defendant_name', Premium: 'bond.premium' } });
    expect(patch.body.form.field_map).toEqual({ Defendant: 'bond.defendant_name', Premium: 'bond.premium' });
    const prev = await req('get', `/api/admin/bd-setup/${id}/forms/${forms[0].id}/preview.pdf`, admin).buffer(true).parse(binary);
    expect(prev.status).toBe(200);
    const filled = (await PDFDocument.load(prev.body)).getForm();
    expect(filled.getTextField('Defendant').getText()).toBe('Sample Defendant');
    // another agency's forms are not reachable through this request
    const miss = await req('get', `/api/admin/bd-setup/${id}/forms/999999999/file`, admin);
    expect([miss.status, miss.body.code]).toEqual([404, 'not_found']);
    expect((await req('post', `/api/admin/bd-setup/${id}/ready`, admin).send({ note: 'Mapped both fields.' })).body.request.status).toBe('ready');
    const lib = (await bd('get', '/forms')).body.forms.find((f) => f.id === forms[0].id);
    expect(lib).toMatchObject({ setup_pending: false, roles: ['defendant'] });
    expect((await bd('get', '/forms-setup')).body.requests[0]).toMatchObject({ status: 'ready', staff_note: 'Mapped both fields.' });
    expect((await req('patch', `/api/admin/bd-setup/${id}/forms/${forms[0].id}`, admin).send({ name: 'x' })).body.code).toBe('setup_not_started');
    const audits = await ctx.db.all(`SELECT action FROM audit_log WHERE entity_type IN ('bd_setup_request','bd_form') AND (entity_id = ? OR entity_id = ?)`, [String(id), String(forms[0].id)]);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['bond_desk.forms_setup_requested', 'admin.bd_setup_started', 'admin.bd_setup_form_mapped', 'admin.bd_setup_ready']));
  });

  test('PAY7 CSV import: preview errors, all or nothing, exact cents, unique power numbers', async () => {
    if (!ctx.app) return;
    const tpl = await bd('get', '/import/template.csv');
    expect(tpl.status).toBe(200);
    expect(tpl.text.split('\r\n')[0]).toMatch(/^defendant_name,defendant_phone,defendant_email,defendant_dob,bond_amount,surety,power_number/);
    await ctx.db.run(`INSERT INTO bd_powers (agent_id, surety_name, number, limit_cents, received_on) VALUES (?, 'Old Surety', 'TAKEN-1', 100000, '2026-01-01')`, [owner.user.id]);
    const header = 'Defendant Name,Phone,Email,DOB,Bond Amount,Surety,Power Number,Court Date,Premium,Balance,Indemnitor Name,Indemnitor Phone';
    const bad = [header,
      'Alex Ok,615-555-0161,alex@example.com,1990-05-01,"$5,000.00",Acme Surety,AC-100,2099-01-15,500,"1,234.56",Jo Ok,615-555-0162',
      'No Amount,,,,,Acme Surety,AC-101,,,,,',
      'Bad Money,,,,12.345,Acme Surety,AC-102,,,,,',
      'Dup Power,,,,1000,Acme Surety,AC-100,,,,,',
      'Taken Power,,,,1000,Acme Surety,TAKEN-1,,,,,',
      'No Surety,,,,1000,,ZZ-1,,,,,',
      'Bad Phone,12,,13/45/1990,1000,,,,,,,'].join('\n');
    const pv = await bd('post', '/import/preview').attach('file', Buffer.from(bad), 'bonds.csv');
    expect(pv.status).toBe(200);
    expect(pv.body).toMatchObject({ total: 7, valid: 1, invalid: 6 });
    const errs = Object.fromEntries(pv.body.rows.map((r) => [r.values.defendant_name || r.line, r.errors.map((e) => `${e.field}:${e.code}`)]));
    expect(errs['Alex Ok']).toEqual([]);
    expect(errs['No Amount']).toContain('bond_amount:required');
    expect(errs['Bad Money']).toContain('bond_amount:bad_amount');
    expect(errs['Dup Power']).toContain('power_number:power_duplicate');
    expect(errs['Taken Power']).toContain('power_number:power_taken');
    expect(errs['No Surety']).toContain('surety:power_needs_surety');
    expect(errs['Bad Phone']).toEqual(expect.arrayContaining(['defendant_phone:bad_phone', 'defendant_dob:bad_date']));
    const before = (await ctx.db.get('SELECT COUNT(*)::int AS n FROM bd_bonds WHERE agent_id = ?', [owner.user.id])).n;
    const no = await bd('post', '/import').attach('file', Buffer.from(bad), 'bonds.csv');
    expect([no.status, no.body.code]).toEqual([409, 'import_has_errors']);
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM bd_bonds WHERE agent_id = ?', [owner.user.id])).n).toBe(before);
    const good = [header,
      'Alex Ok,615-555-0161,alex@example.com,05/01/1990,"$5,000.00",Acme Surety,AC-100,2099-01-15,500,"1,234.56",Jo Ok,615-555-0162',
      'Blair Two,,,,"12,345.6",Acme Surety,AC-101,,,0,,'].join('\r\n');
    const im = await bd('post', '/import').attach('file', Buffer.from(`\ufeff${good}`), 'bonds.csv');
    expect(im.status).toBe(201);
    expect(im.body.imported).toBe(2);
    const a = (await bd('get', `/bonds/${im.body.bond_ids[0]}`)).body;
    expect(a.bond).toMatchObject({ status: 'active', defendant_name: 'Alex Ok', bond_amount_cents: 500000, defendant_dob: '1990-05-01', court_date: '2099-01-15',
      power: { number: 'AC-100', surety_name: 'Acme Surety', limit_cents: 500000 } });
    expect(a.charges).toEqual([expect.objectContaining({ kind: 'premium', amount_cents: 123456, description: 'imported balance' })]);
    expect(a.money.balance_cents).toBe(123456);
    expect(a.indemnitors[0]).toMatchObject({ full_name: 'Jo Ok', phone: '+16155550162' });
    expect((await ctx.db.get('SELECT imported_premium_cents FROM bd_bonds WHERE id = ?', [a.bond.id])).imported_premium_cents).toEqual(expect.anything());
    expect(Number((await ctx.db.get('SELECT imported_premium_cents FROM bd_bonds WHERE id = ?', [a.bond.id])).imported_premium_cents)).toBe(50000);
    const b2 = (await bd('get', `/bonds/${im.body.bond_ids[1]}`)).body;
    expect(b2.bond.bond_amount_cents).toBe(1234560);
    expect(b2.charges).toHaveLength(0);
    // surety report shows the stated premium, not the imported balance
    const sr = (await bd('get', '/reports/surety?surety=Acme%20Surety')).body;
    expect(sr.rows.find((r) => r.power_number === 'AC-100').premium_cents).toBe(50000);
    // the same file again: the power numbers are now taken
    expect((await bd('post', '/import').attach('file', Buffer.from(good), 'bonds.csv')).body.code).toBe('import_has_errors');
    // more than 2,000 rows
    const many = [header, ...Array.from({ length: 2001 }, (_, i) => `P${i},,,,100,,,,,,,`)].join('\n');
    expect((await bd('post', '/import/preview').attach('file', Buffer.from(many), 'm.csv')).body.file_errors).toEqual([{ code: 'too_many_rows', max: 2000 }]);
    expect((await bd('post', '/import/preview').attach('file', Buffer.from('name,phone\nA,1'), 'x.csv')).body.file_errors).toEqual(expect.arrayContaining([{ code: 'missing_column', column: 'bond_amount' }]));
  });

  test('PAY8 export ZIP: reports, receipts, signed PDFs, README; owner only; rate limited', async () => {
    if (!ctx.app) return;
    // one signed document on file
    const { getAttachmentStorage } = await import('../../services/attachmentStorage.js');
    const { putFile } = await import('../../services/bondDesk/packets.js');
    const storage = await getAttachmentStorage();
    const signedBytes = await sampleForm();
    const key = await putFile(storage, signedBytes);
    const bond = await bondWithPlan([{ amount_cents: 1000 }], null, { defendant_name: 'Zip Zed' });
    const pk = await ctx.db.get(`INSERT INTO bd_packets (bond_id, agent_id, status, form_ids) VALUES (?, ?, 'completed', '{}') RETURNING id`, [bond.id, owner.user.id]);
    const sg = await ctx.db.get(`INSERT INTO bd_signers (packet_id, role, name, token_hash, token_expires_at, status) VALUES (?, 'defendant', 'Zip Zed', ?, NOW() + INTERVAL '1 day', 'signed') RETURNING id`, [pk.id, `h${Date.now()}`]);
    const fm = await ctx.db.get(`INSERT INTO bd_forms (agent_id, name, storage_key, sha256, size_bytes, page_count, fields) VALUES (?, 'Zip Form', ?, 'x', 1, 1, '[]'::jsonb) RETURNING id`, [owner.user.id, key]);
    await ctx.db.run(`INSERT INTO bd_documents (packet_id, signer_id, form_id, name, status, prepared_key, prepared_sha256, signed_key, signed_sha256) VALUES (?, ?, ?, 'Zip Form', 'signed', ?, 'a', ?, 'b')`,
      [pk.id, sg.id, fm.id, key, key]);
    expect((await bd('post', `/bonds/${bond.id}/payments`).send({ amount_cents: 1000, method: 'cash', payer_name: 'Zed' })).status).toBe(201);
    const z = await bd('get', '/export.zip').buffer(true).parse(binary);
    expect(z.status).toBe(200);
    expect(z.headers['content-type']).toBe('application/zip');
    const { readZip } = await import('../../services/bondDesk/zip.js');
    const entries = readZip(z.body);
    const names = entries.map((e) => e.name);
    for (const n of ['reports/liability.csv', 'reports/surety-report.csv', 'reports/receivables.csv', 'reports/receipts.csv', 'reports/collateral-held.csv',
      'reports/court-appearance.csv', 'records/bonds.csv', 'records/payments.csv', 'README.txt']) expect(names).toContain(n);
    expect(names.filter((n) => n.startsWith('receipts/payments/R-')).length).toBeGreaterThanOrEqual(3);
    const signed = entries.find((e) => e.name.startsWith('signed/') && e.name.includes('Zip-Form'));
    expect(signed.data.equals(signedBytes)).toBe(true);
    const readme = entries.find((e) => e.name === 'README.txt').data.toString('utf8');
    expect(readme).toContain('Your agency owns this data');
    expect(entries.find((e) => e.name === 'records/bonds.csv').data.toString('utf8')).toContain('Zip Zed');
    // the unzip tool reads it too (when installed)
    let unzipOk = null;
    try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); unzipOk = true; } catch { unzipOk = false; }
    if (unzipOk) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-zip-'));
      const f = path.join(dir, 'x.zip');
      fs.writeFileSync(f, z.body);
      expect(execFileSync('unzip', ['-t', f]).toString()).toMatch(/No errors detected/);
      execFileSync('unzip', ['-q', f, '-d', path.join(dir, 'out')]);
      expect(fs.readFileSync(path.join(dir, 'out', 'README.txt'), 'utf8')).toContain('Bond Desk export');
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect((await bd('get', '/export.zip', owner2)).status).toBe(200);
    let limited = false;
    for (let i = 0; i < 3 && !limited; i++) limited = (await bd('get', '/export.zip')).status === 429;
    expect(limited).toBe(true);
  });

  test('PAY9 staff seats: invite, seats_full, accept, staff limits, removal', async () => {
    if (!ctx.app) return;
    const tiers = (await req('get', '/api/billing/bondsman/tiers')).body.tiers;
    expect(Object.fromEntries(tiers.map((t) => [t.key, t.seats]))).toEqual({ starter: 3, pro: 10, market: 20 });
    expect((await bd('get', '/staff')).body.seats).toEqual({ included: 3, used: 1, staff: 0, pending: 0 });
    const ia = await bd('post', '/staff/invites').send({ email: staffA.email.toUpperCase() });
    expect(ia.status).toBe(201);
    const tokenA = ia.body.link.split('/bond-desk/join/')[1];
    expect((await bd('post', '/staff/invites').send({ email: staffA.email })).body.code).toBe('already_invited');
    expect((await bd('post', '/staff/invites').send({ email: staffB.email })).status).toBe(201);
    const full = await bd('post', '/staff/invites').send({ email: 'third@example.com' });
    expect([full.status, full.body.code, full.body.included]).toEqual([409, 'seats_full', 3]);
    expect(full.body.error).toMatch(/Move up a plan/);
    // accept: signed in with the invited e-mail only
    expect((await bd('get', `/staff/invite/${tokenA}`, stranger)).body).toMatchObject({ agency: 'Delta Bail Bonds', email_matches: false });
    expect((await bd('post', '/staff/accept', stranger).send({ token: tokenA })).body.code).toBe('invite_other_email');
    expect((await bd('get', '/access', staffA)).body).toMatchObject({ allowed: false });
    const acc = await bd('post', '/staff/accept', staffA).send({ token: tokenA });
    expect(acc.body).toEqual({ agency: 'Delta Bail Bonds' });
    expect((await bd('post', '/staff/accept', staffA).send({ token: tokenA })).body.code).toBe('invite_used');
    expect((await bd('get', '/access', staffA)).body).toMatchObject({ allowed: true, role: 'staff', plan: 'starter' });
    // staff work in the owner's desk
    const mine = await bd('post', '/bonds', staffA).send({ defendant_name: 'Staff Made', bond_amount_cents: 1000 });
    expect(mine.status).toBe(201);
    expect((await ctx.db.get('SELECT agent_id FROM bd_bonds WHERE id = ?', [mine.body.bond.id])).agent_id).toEqual(expect.anything());
    expect(Number((await ctx.db.get('SELECT agent_id FROM bd_bonds WHERE id = ?', [mine.body.bond.id])).agent_id)).toBe(Number(owner.user.id));
    await bd('post', '/bonds').send({ defendant_name: 'Owner Made', bond_amount_cents: 1000 });
    expect((await bd('get', '/bonds', staffA)).body.bonds.some((b) => b.defendant_name === 'Owner Made')).toBe(true);
    // … but not Connect, export, staff or sharing a bond with a recovery agent
    for (const [m, p, b] of [['post', '/connect/start', { fees_acknowledged: true }], ['post', '/connect/dashboard', {}], ['get', '/export.zip', null], ['post', '/staff/invites', { email: 'x@example.com' }],
      ['post', `/bonds/${mine.body.bond.id}/recovery/shares`, { email: 'agent@example.com', rule_acknowledged: true }]]) {
      const r = b ? await bd(m, p, staffA).send(b) : await bd(m, p, staffA);
      expect([p, r.status, r.body.code]).toEqual([p, 403, 'owner_only']);
    }
    expect((await bd('get', '/staff')).body.seats).toEqual({ included: 3, used: 3, staff: 1, pending: 1 });
    // withdraw B's invitation, remove A: access ends at once
    const list = (await bd('get', '/staff')).body;
    expect((await bd('delete', `/staff/invites/${list.invites[0].id}`)).status).toBe(200);
    expect((await bd('delete', `/staff/${staffA.user.id}`)).body.seats.used).toBe(1);
    expect((await bd('get', '/bonds', staffA)).status).toBe(403);
    // a member of one agency cannot join a second while still in the first
    const i2 = await bd('post', '/staff/invites', owner2).send({ email: staffB.email });
    const t2 = i2.body.link.split('/bond-desk/join/')[1];
    expect((await bd('post', '/staff/accept', staffB).send({ token: t2 })).status).toBe(200);
    const i3 = await bd('post', '/staff/invites').send({ email: staffB.email });
    expect((await bd('post', '/staff/accept', staffB).send({ token: i3.body.link.split('/bond-desk/join/')[1] })).body.code).toBe('other_agency');
    expect((await bd('post', '/staff/leave', staffB)).body).toEqual({ ok: true });
    // deleting the owner's account removes the agency's card-payment link, autopay set-ups, pay-page
    // payments, setup requests, staff and invitations (services/accountDeletion.js USER_REFS)
    const { purgeAccountData } = await import('../../services/accountDeletion.js');
    expect((await bd('post', '/staff/invites').send({ email: 'later@example.com' })).status).toBe(201);
    await ctx.db.transaction((tx) => purgeAccountData(tx, owner.user.id, { email: owner.email }));
    for (const t of ['bd_connect_accounts', 'bd_autopay', 'bd_pay_requests', 'bd_setup_requests', 'bd_bonds', 'bd_powers']) {
      expect([t, (await ctx.db.get(`SELECT COUNT(*)::int AS n FROM ${t} WHERE agent_id = ?`, [owner.user.id])).n]).toEqual([t, 0]);
    }
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM bd_staff_invites WHERE owner_id = ?', [owner.user.id])).n).toBe(0);
  });
});
