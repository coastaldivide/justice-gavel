/**
 * bond_desk.int.test.js — Bond Desk (docs/BOND_DESK.md) on the real app + real Postgres,
 * a fake Telnyx server and a fake Stripe client:
 *
 *   BD1  access: not an agent → not_agent; agent without a plan → no_plan; with a plan → allowed
 *   BD2  bonds: create / validate / search; another agent's bond is 404
 *   BD3  ledger: whole cents, over-balance refused, parallel payments never overpay, receipt
 *        numbers per agency, voids, receipt PDF
 *   BD4  payment plan: exact total, installment status, out-of-sync after a new charge
 *   BD5  status moves and forfeiture deadlines; liability; dashboard
 *   BD6  powers: zero-padded ranges, duplicates skipped, limit / expiry / one per bond, void,
 *        surety report
 *   BD7  forms + packet + signing: field mapping, link texts (5¢ each), STOP list respected,
 *        answers → uploads → prepare → view → typed-name signature → certificate; packet
 *        completes; rotated / voided links stop working
 *   BD8  reports as CSV (formula cells neutralised)
 *   BD9  texts billed once on the plan invoice, even after a crash between Stripe and the DB
 */
import { jest } from '@jest/globals';
import http from 'node:http';
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describeIntegration, initSuite } from './_harness.js';

// ── Fake Stripe (text billing only) ───────────────────────────────────────────
const fake = { items: [], subs: new Map(), createCalls: 0 };
jest.unstable_mockModule('stripe', () => ({
  default: class FakeStripe {
    constructor() {
      this.subscriptions = { retrieve: async (id) => fake.subs.get(id) || { id, customer: 'cus_bd' } };
      this.invoiceItems = {
        list: async ({ customer }) => ({ data: fake.items.filter((i) => i.customer === customer), has_more: false }),
        create: async (params, opts) => {
          fake.createCalls += 1;
          const dup = fake.items.find((i) => i.idem === opts?.idempotencyKey);
          if (dup) return dup;
          const item = { id: `ii_${fake.items.length + 1}`, ...params, idem: opts?.idempotencyKey };
          fake.items.push(item);
          return item;
        },
      };
      this.customers = { create: async () => ({ id: 'cus_bd' }), list: async () => ({ data: [] }) };
    }
  },
}));

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

async function sampleForm() {
  const d = await PDFDocument.create();
  const p = d.addPage([612, 792]);
  const f = d.getForm();
  const field = (name, y) => f.createTextField(name).addToPage(p, { x: 50, y, width: 300, height: 20 });
  field('Defendant', 700); field('Bond Amount', 660); field('Signer Name', 620); field('Signer Address', 580);
  field('Signature', 540); field('Signed On', 500); field('Unmapped', 460);
  f.createCheckBox('Agree').addToPage(p, { x: 50, y: 420, width: 15, height: 15 });
  return Buffer.from(await d.save());
}

describeIntegration('Bond Desk (real Postgres, fake Telnyx and Stripe)', () => {
  const ctx = initSuite();
  const texts = [];
  let telnyx;
  let agent, agent2, plainAgent, user;
  let ipN = 0;
  const req = (m, path, who) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.88.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (who) r = r.set(who.headers);
    return r;
  };
  const bd = (m, path, who = agent) => req(m, `/api/bond-desk${path}`, who);

  beforeAll(async () => {
    if (!ctx.app) return;
    telnyx = http.createServer((rq, rs) => {
      let data = '';
      rq.on('data', (c) => { data += c; });
      rq.on('end', () => {
        texts.push(JSON.parse(data || '{}'));
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ data: { id: `tx_${texts.length}` } }));
      });
    });
    await new Promise((r) => telnyx.listen(0, '127.0.0.1', r));
    process.env.TELNYX_API_KEY = 'KEY_test';
    process.env.TELNYX_FROM_NUMBER = '+16155550100';
    process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyx.address().port}`;
    [agent, agent2, plainAgent] = await Promise.all(['A1', 'A2', 'A3'].map((n) => ctx.register({ displayName: `BD ${n}`, accountType: 'bail_agent' })));
    user = await ctx.register({ displayName: 'BD user' });
    for (const [a, name] of [[agent, 'Alpha Bail Bonds'], [agent2, 'Beta Bail'], [plainAgent, 'No Plan Bail']]) {
      const r = await req('post', '/api/billing/bondsman/profile', a).send({ company_name: name, license_number: 'TN-123', license_state: 'TN', states: ['TN'], counties: ['Davidson'] });
      expect(r.status).toBe(200);
    }
    await ctx.db.run(`UPDATE bondsman_profiles SET phone = '615-555-0199' WHERE user_id = ?`, [agent.user.id]);
    for (const [a, sub] of [[agent, 'sub_bd_1'], [agent2, 'sub_bd_2']]) {
      await ctx.db.run(`INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, amount_cents) VALUES (?, 'starter', 'active', ?, 9900)`, [a.user.id, sub]);
    }
    ctx.addCleanup(async (db) => {
      const ids = [agent, agent2, plainAgent].map((a) => a.user.id).join(',');
      await db.run(`DELETE FROM bd_texts WHERE agent_id IN (${ids})`);
      await db.run(`DELETE FROM bd_text_batches WHERE agent_id IN (${ids})`);
      await db.run(`DELETE FROM bondsman_subscriptions WHERE user_id IN (${ids})`);
      await db.run(`DELETE FROM bondsman_profiles WHERE user_id IN (${ids})`);
      await db.run(`DELETE FROM sms_opt_outs WHERE phone LIKE '+1615555%'`);
    });
  });
  afterAll(async () => {
    if (telnyx) await new Promise((r) => telnyx.close(r));
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'STRIPE_SECRET_KEY']) delete process.env[k];
  });

  const newBond = async (extra = {}, who = agent) => {
    const r = await bd('post', '/bonds', who).send({ defendant_name: 'Jordan Rivers', bond_amount_cents: 500000, state: 'tn', defendant_phone: '(615) 555-0111', ...extra });
    expect(r.status).toBe(201);
    return r.body.bond;
  };

  test('BD1 access', async () => {
    if (!ctx.app) return;
    expect((await bd('get', '/access', user)).body).toMatchObject({ allowed: false, reason: 'not_agent', text_cents: 5 });
    expect((await bd('get', '/access', plainAgent)).body).toMatchObject({ allowed: false, reason: 'no_plan' });
    const ok = await bd('get', '/access');
    expect(ok.body).toMatchObject({ allowed: true, reason: null, plan: 'starter', texts_live: true, storage_live: true });
    expect((await bd('get', '/bonds', user)).status).toBe(403);
    const np = await bd('get', '/bonds', plainAgent);
    expect([np.status, np.body.code]).toEqual([403, 'no_plan']);
    expect((await ctx.request().get('/api/bond-desk/bonds')).status).toBe(401);
  });

  test('BD2 bonds', async () => {
    if (!ctx.app) return;
    const b = await newBond({ case_number: '26-CR-100', defendant_dob: '1990-02-28' });
    expect(b).toMatchObject({ status: 'prospect', state: 'TN', defendant_phone: '+16155550111', bond_amount_cents: 500000, power: null, defendant_dob: '1990-02-28' });
    for (const [body, field] of [[{ bond_amount_cents: 500000 }, 'defendant_name'], [{ defendant_name: 'X', bond_amount_cents: 0 }, 'bond_amount_cents'],
      [{ defendant_name: 'X', bond_amount_cents: 1.5 }, 'bond_amount_cents'], [{ defendant_name: 'X', bond_amount_cents: 100, defendant_dob: '2026-02-30' }, 'defendant_dob'],
      [{ defendant_name: 'X', bond_amount_cents: 100, defendant_phone: '12' }, 'defendant_phone'], [{ defendant_name: 'X', bond_amount_cents: 100, state: 'Tenn' }, 'state']]) {
      const r = await bd('post', '/bonds').send(body);
      expect([r.status, r.body.field]).toEqual([400, field]);
    }
    expect((await bd('get', '/bonds?q=26-CR-100')).body.bonds.map((x) => x.id)).toEqual([b.id]);
    expect((await bd('get', `/bonds/${b.id}`, agent2)).status).toBe(404);
    expect((await bd('patch', `/bonds/${b.id}`, agent2).send({ notes: 'x' })).status).toBe(404);
    const p = await bd('patch', `/bonds/${b.id}`).send({ notes: 'Called mother', court_date: '2026-12-01' });
    expect(p.body.bond).toMatchObject({ notes: 'Called mother', court_date: '2026-12-01', defendant_name: 'Jordan Rivers' });
  });

  test('BD3 ledger', async () => {
    if (!ctx.app) return;
    const b = await newBond({ defendant_name: 'Ledger Test' });
    expect((await bd('post', `/bonds/${b.id}/payments`).send({ amount_cents: 100, method: 'cash', payer_name: 'Mom' })).body.code).toBe('over_balance');
    expect((await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'premium', amount_cents: 50000, description: '10% premium' })).status).toBe(201);
    const fee = await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'fee', amount_cents: 2500 });
    expect((await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'premium', amount_cents: -5 })).status).toBe(400);
    // five parallel $150 payments against $525 owed: exactly three go through
    const tries = await Promise.all([1, 2, 3, 4, 5].map((n) => bd('post', `/bonds/${b.id}/payments`).send({ amount_cents: 15000, method: 'card', payer_name: `Payer ${n}`, reference: `auth ${n}` })));
    expect(tries.filter((r) => r.status === 201).length).toBe(3);
    expect(tries.filter((r) => r.status === 409 && r.body.code === 'over_balance').length).toBe(2);
    const nos = tries.filter((r) => r.status === 201).map((r) => r.body.payment.receipt_no).sort();
    expect(new Set(nos).size).toBe(3);
    expect(nos.every((n) => /^R-\d{6}$/.test(n))).toBe(true);
    let d = (await bd('get', `/bonds/${b.id}`)).body;
    expect(d.money).toMatchObject({ charged_cents: 52500, paid_cents: 45000, balance_cents: 7500 });
    // a future date is refused; an exact payoff works
    expect((await bd('post', `/bonds/${b.id}/payments`).send({ amount_cents: 7500, method: 'cash', payer_name: 'Mom', received_on: '2099-01-01' })).body.code).toBe('future_date');
    const last = await bd('post', `/bonds/${b.id}/payments`).send({ amount_cents: 7500, method: 'cash', payer_name: 'Mom' });
    expect(last.status).toBe(201);
    // voiding the fee would leave more paid than owed
    expect((await bd('post', `/charges/${fee.body.charge.id}/void`).send({ reason: 'waived' })).body.code).toBe('would_go_negative');
    expect((await bd('post', `/payments/${last.body.payment.id}/void`).send({})).status).toBe(400);   // reason required
    expect((await bd('post', `/payments/${last.body.payment.id}/void`).send({ reason: 'bounced check' })).status).toBe(200);
    expect((await bd('post', `/payments/${last.body.payment.id}/void`).send({ reason: 'again' })).body.code).toBe('already_void');
    expect((await bd('post', `/charges/${fee.body.charge.id}/void`).send({ reason: 'waived' })).status).toBe(200);
    d = (await bd('get', `/bonds/${b.id}`)).body;
    expect(d.money).toMatchObject({ charged_cents: 50000, paid_cents: 45000, balance_cents: 5000 });
    expect(d.payments.find((p) => p.id === last.body.payment.id)).toMatchObject({ void_reason: 'bounced check' });
    // receipt numbers are per agency: another agent starts at R-000001
    const other = await newBond({ defendant_name: 'Other agency' }, agent2);
    await bd('post', `/bonds/${other.id}/charges`, agent2).send({ kind: 'premium', amount_cents: 1000 });
    expect((await bd('post', `/bonds/${other.id}/payments`, agent2).send({ amount_cents: 1000, method: 'cash', payer_name: 'X' })).body.payment.receipt_no).toBe('R-000001');
    // receipt PDF (and nobody else's)
    const pdf = await bd('get', `/payments/${last.body.payment.id}/receipt.pdf`).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await PDFDocument.load(pdf.body)).getPageCount()).toBe(1);
    expect((await bd('get', `/payments/${last.body.payment.id}/receipt.pdf`, agent2)).status).toBe(404);
  });

  test('BD4 payment plan', async () => {
    if (!ctx.app) return;
    const b = await newBond({ defendant_name: 'Plan Test' });
    await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'premium', amount_cents: 60000 });
    const bad = await bd('put', `/bonds/${b.id}/plan`).send({ installments: [{ due_on: '2026-01-01', amount_cents: 20000 }, { due_on: '2099-01-01', amount_cents: 30000 }] });
    expect([bad.status, bad.body.code, bad.body.charged_cents]).toEqual([409, 'plan_total', 60000]);
    expect((await bd('put', `/bonds/${b.id}/plan`).send({ installments: [{ due_on: '2026-01-01', amount_cents: 1 }, { due_on: '2026-01-01', amount_cents: 59999 }] })).body.code).toBe('bad_plan');
    const ok = await bd('put', `/bonds/${b.id}/plan`).send({ installments: [
      { due_on: '2099-02-01', amount_cents: 20000 }, { due_on: '2026-01-01', amount_cents: 20000 }, { due_on: '2099-01-01', amount_cents: 20000 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.installments.map((i) => [i.due_on, i.status])).toEqual([['2026-01-01', 'overdue'], ['2099-01-01', 'due'], ['2099-02-01', 'due']]);
    expect(ok.body.money).toMatchObject({ overdue_cents: 20000, plan_in_sync: true, plan_scheduled_cents: 60000 });
    await bd('post', `/bonds/${b.id}/payments`).send({ amount_cents: 25000, method: 'cash', payer_name: 'Mom' });
    let d = (await bd('get', `/bonds/${b.id}`)).body;
    expect(d.installments.map((i) => [i.status, i.covered_cents])).toEqual([['paid', 20000], ['partial', 5000], ['due', 0]]);
    expect(d.money).toMatchObject({ overdue_cents: 0, next_due: { due_on: '2099-01-01', covered_cents: 5000 } });
    await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'fee', amount_cents: 1500 });
    d = (await bd('get', `/bonds/${b.id}`)).body;
    expect(d.money.plan_in_sync).toBe(false);
    const dash = (await bd('get', '/dashboard')).body;
    expect(dash.receivable_cents).toBeGreaterThanOrEqual(36500);
  });

  test('BD5 status moves, forfeitures, liability, dashboard', async () => {
    if (!ctx.app) return;
    const b = await newBond({ defendant_name: 'Status Test', bond_amount_cents: 1000000, surety_name: 'Acme Surety' });
    expect((await bd('post', `/bonds/${b.id}/status`).send({ status: 'forfeited', date: '2026-10-01', deadline_on: '2027-01-01' })).body.code).toBe('bad_transition');
    expect((await bd('post', `/bonds/${b.id}/status`).send({ status: 'active' })).body.code).toBe('required');
    const posted = await bd('post', `/bonds/${b.id}/status`).send({ status: 'active', date: '2026-09-15' });
    expect(posted.body.bond).toMatchObject({ status: 'active', posted_on: '2026-09-15' });
    expect((await bd('post', `/bonds/${b.id}/status`).send({ status: 'forfeited', date: '2026-10-01' })).body.code).toBe('required');
    const f = await bd('post', `/bonds/${b.id}/status`).send({ status: 'forfeited', date: '2026-10-01', deadline_on: '2099-01-01' });
    expect(f.body.bond).toMatchObject({ status: 'forfeited', forfeited_on: '2026-10-01', forfeiture_deadline_on: '2099-01-01' });
    const dash = (await bd('get', '/dashboard')).body;
    const row = dash.forfeitures.find((x) => x.bond_id === b.id);
    expect(row.days_left).toBeGreaterThan(20000);
    expect(dash.counts.forfeited).toBeGreaterThanOrEqual(1);
    const liab = (await bd('get', '/reports/liability')).body;
    expect(liab.bonds.some((x) => x.id === b.id)).toBe(true);
    expect(liab.total_cents).toBe(liab.by_surety.reduce((s, x) => s + x.amount_cents, 0));
    const back = await bd('post', `/bonds/${b.id}/status`).send({ status: 'active', date: '2026-10-10' });
    expect(back.body.bond).toMatchObject({ status: 'active', forfeited_on: null, forfeiture_deadline_on: null });
    const done = await bd('post', `/bonds/${b.id}/status`).send({ status: 'exonerated', date: '2026-10-20' });
    expect(done.body.bond).toMatchObject({ status: 'exonerated', discharged_on: '2026-10-20' });
    expect((await bd('post', `/bonds/${b.id}/status`).send({ status: 'active', date: '2026-10-21' })).body.code).toBe('bad_transition');
    expect((await bd('get', '/reports/liability')).body.bonds.some((x) => x.id === b.id)).toBe(false);
  });

  test('BD6 powers', async () => {
    if (!ctx.app) return;
    const add = await bd('post', '/powers').send({ surety_name: 'Acme Surety', prefix: 'AS', start: '000101', end: '000105', limit_cents: 1500000, received_on: '2026-10-01' });
    expect(add.body).toEqual({ created: 5, skipped: 0 });
    expect((await bd('post', '/powers').send({ surety_name: 'Acme Surety', prefix: 'AS', start: '000104', end: '000106', limit_cents: 1500000, received_on: '2026-10-01' })).body).toEqual({ created: 1, skipped: 2 });
    expect((await bd('post', '/powers').send({ surety_name: 'X', start: '1', end: '600', limit_cents: 1, received_on: '2026-10-01' })).body.code).toBe('too_many_powers');
    const small = await bd('post', '/powers').send({ surety_name: 'Small Surety', start: '7', end: '7', limit_cents: 100000, received_on: '2026-10-01' });
    expect(small.body.created).toBe(1);
    const old = await bd('post', '/powers').send({ surety_name: 'Old Surety', start: '9', end: '9', limit_cents: 9000000, received_on: '2025-01-01', expires_on: '2025-12-31' });
    expect(old.body.created).toBe(1);
    const list = (await bd('get', '/powers?status=available')).body;
    const byNum = Object.fromEntries(list.powers.map((p) => [p.number, p]));
    expect(Object.keys(byNum)).toEqual(expect.arrayContaining(['AS000101', 'AS000106', '7', '9']));
    const b = await newBond({ defendant_name: 'Power Test', bond_amount_cents: 1000000 });
    expect((await bd('post', `/bonds/${b.id}/power`).send({ power_id: byNum['7'].id })).body.code).toBe('power_limit');
    expect((await bd('post', `/bonds/${b.id}/power`).send({ power_id: byNum['9'].id })).body.code).toBe('power_expired');
    expect((await bd('post', `/bonds/${b.id}/power`, agent2).send({ power_id: byNum.AS000101.id })).status).toBe(404);
    const ok = await bd('post', `/bonds/${b.id}/power`).send({ power_id: byNum.AS000101.id });
    expect(ok.body.bond.power).toMatchObject({ number: 'AS000101', surety_name: 'Acme Surety' });
    expect((await bd('post', `/bonds/${b.id}/power`).send({ power_id: byNum.AS000102.id })).body.code).toBe('bond_has_power');
    expect((await bd('patch', `/bonds/${b.id}`).send({ bond_amount_cents: 2000000 })).body.code).toBe('power_limit');
    expect((await bd('post', `/bonds/${b.id}/status`).send({ status: 'cancelled' })).body.code).toBe('void_power_first');
    await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'premium', amount_cents: 100000 });
    const rep = (await bd('get', '/reports/surety?surety=Acme%20Surety')).body;
    expect(rep.rows.find((r) => r.power_number === 'AS000101')).toMatchObject({ bond_amount_cents: 1000000, premium_cents: 100000 });
    expect((await bd('post', `/powers/${byNum.AS000102.id}/return`).send({})).status).toBe(200);
    expect((await bd('post', `/powers/${byNum.AS000102.id}/return`).send({})).body.code).toBe('power_unavailable');
    expect((await bd('post', `/powers/${byNum.AS000101.id}/void`).send({ reason: 'Bond rewritten' })).status).toBe(200);
    expect((await bd('get', `/bonds/${b.id}`)).body.bond.power).toBeNull();
    expect((await bd('post', `/bonds/${b.id}/status`).send({ status: 'cancelled' })).body.bond.status).toBe('cancelled');
  });

  test('BD7 forms, packet and signing', async () => {
    if (!ctx.app) return;
    const b = await newBond({ defendant_name: 'Nguyễn Văn An', defendant_email: 'an@example.test', case_number: '26-CR-777', bond_amount_cents: 250000 });
    await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'premium', amount_cents: 25000 });
    const ind = (await bd('post', `/bonds/${b.id}/indemnitors`).send({ full_name: 'María López', relationship: 'Sister', phone: '615-555-0122', email: 'maria@example.test' })).body.indemnitor;
    const optedOut = (await bd('post', `/bonds/${b.id}/indemnitors`).send({ full_name: 'Pat Stop', phone: '615-555-0133' })).body.indemnitor;
    await ctx.db.run(`INSERT INTO sms_opt_outs (phone) VALUES ('+16155550133') ON CONFLICT DO NOTHING`);

    // a password-less, readable PDF is required
    expect((await bd('post', '/forms').attach('file', Buffer.from('not a pdf at all'), 'x.pdf')).body.code).toBe('bad_pdf');
    const up = await bd('post', '/forms').field('name', 'Indemnity Agreement').attach('file', await sampleForm(), 'indemnity.pdf');
    expect(up.status).toBe(201);
    const form = up.body.form;
    expect(form.fields.map((f) => [f.name, f.type])).toEqual([['Defendant', 'text'], ['Bond Amount', 'text'], ['Signer Name', 'text'],
      ['Signer Address', 'text'], ['Signature', 'text'], ['Signed On', 'text'], ['Unmapped', 'text'], ['Agree', 'checkbox']]);
    expect((await bd('patch', `/forms/${form.id}`).send({ field_map: { Agree: 'bond.defendant_name' } })).body.code).toBe('bad_field_map');
    expect((await bd('patch', `/forms/${form.id}`).send({ field_map: { Defendant: 'bond.nope' } })).body.code).toBe('bad_field_map');
    const mapped = await bd('patch', `/forms/${form.id}`).send({ field_map: {
      Defendant: 'bond.defendant_name', 'Bond Amount': 'bond.bond_amount', 'Signer Name': 'signer.full_name', 'Signer Address': 'signer.address',
      Signature: 'signature.name', 'Signed On': 'signature.date', Unmapped: '' } });
    expect(mapped.body.form.field_map).toEqual({ Defendant: 'bond.defendant_name', 'Bond Amount': 'bond.bond_amount', 'Signer Name': 'signer.full_name',
      'Signer Address': 'signer.address', Signature: 'signature.name', 'Signed On': 'signature.date' });
    const preview = await bd('get', `/forms/${form.id}/preview.pdf?bond_id=${b.id}`).buffer(true).parse(binary);
    const pf = (await PDFDocument.load(preview.body)).getForm();
    expect(pf.getTextField('Defendant').getText()).toBe('Nguyễn Văn An');
    expect(pf.getTextField('Bond Amount').getText()).toBe('$2,500.00');
    expect(pf.getTextField('Signature').getText()).toBeUndefined();
    expect(pf.getTextField('Defendant').isReadOnly()).toBe(true);

    // texts need the agent's confirmation that the person agreed to texts
    expect((await bd('post', `/bonds/${b.id}/packets`).send({ form_ids: [form.id], signers: [{ role: 'defendant' }], deliver: 'sms' })).body.code).toBe('consent_required');
    const before = texts.length;
    const pk = await bd('post', `/bonds/${b.id}/packets`).send({
      form_ids: [form.id], signers: [{ role: 'defendant' }, { role: 'indemnitor', indemnitor_id: ind.id }, { role: 'indemnitor', indemnitor_id: optedOut.id }],
      questions: 'basic', custom_questions: ['Name of your employer’s HR contact?'], doc_requests: ['id_front', 'selfie_with_id'],
      deliver: 'both', consent_confirmed: true, lang: 'es' });
    expect(pk.status).toBe(201);
    const [defS, indS, stopS] = pk.body.signers;
    expect(defS.delivery).toEqual({ sms: 'sent', email: 'skipped' });   // e-mail not configured in tests
    expect(indS.delivery.sms).toBe('sent');
    expect(stopS.delivery.sms).toBe('opted_out');
    expect(texts.length - before).toBe(2);
    expect(texts.at(-1).text).toMatch(/Responda STOP/);
    expect(texts.at(-1).text).toContain(indS.link);
    const logged = await ctx.db.all('SELECT cents, purpose FROM bd_texts WHERE agent_id = ? AND bond_id = ?', [agent.user.id, b.id]);
    expect(logged).toEqual([{ cents: 5, purpose: 'signing_link' }, { cents: 5, purpose: 'signing_link' }]);
    const token = (link) => link.split('/sign/')[1];
    const sg = (m, link, rest = '') => ctx.request()[m](`/api/sign/${token(link)}${rest}`).set('User-Agent', 'JestBrowser/1.0').set('X-Forwarded-For', '203.0.113.9');

    // the defendant opens the link
    const v = await sg('get', defS.link);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ signer: { name: 'Nguyễn Văn An', role: 'defendant' }, status: 'opened', prepared: false, documents: [],
      agency: { name: 'Alpha Bail Bonds', phone: '615-555-0199' }, lang: 'es' });
    expect(v.body.questions.map((q) => q.key)).toEqual(['dob', 'phone', 'email', 'address', 'years_at_address', 'employer', 'employer_phone', 'job_title', 'custom_1']);
    expect((await sg('get', indS.link)).body.questions[0]).toMatchObject({ key: 'relationship', required: true });
    expect((await sg('post', defS.link, '/prepare')).body.code).toBe('answers_missing');
    expect((await sg('post', defS.link, '/answers').send({ answers: { ssn: '123' } })).status).toBe(400);
    expect((await sg('post', defS.link, '/answers').send({ answers: { dob: '1990-13-01' } })).body.code).toBe('bad_date');
    expect((await sg('post', defS.link, '/answers').send({ answers: { dob: '1990-01-15', phone: '615-555-0111', address: '1 Main St, Nashville TN', custom_1: 'Lee' } })).status).toBe(200);
    const prep1 = await sg('post', defS.link, '/prepare');
    expect([prep1.body.code, prep1.body.missing]).toEqual(['uploads_missing', ['id_front', 'selfie_with_id']]);
    expect((await sg('post', defS.link, '/uploads').field('kind', 'proof_of_income').attach('file', JPEG, 'a.jpg')).body.field).toBe('kind');
    expect((await sg('post', defS.link, '/uploads').field('kind', 'id_front').attach('file', Buffer.from('plain text file here'), 'a.txt')).status).toBe(415);
    for (const kind of ['id_front', 'selfie_with_id']) {
      expect((await sg('post', defS.link, '/uploads').field('kind', kind).attach('file', JPEG, `${kind}.jpg`)).status).toBe(201);
    }
    const prep = await sg('post', defS.link, '/prepare');
    expect(prep.status).toBe(200);
    expect(prep.body.documents).toEqual([{ id: expect.any(Number), name: 'Indemnity Agreement', viewed: false, signed: false }]);
    expect((await sg('post', defS.link, '/answers').send({ answers: { phone: '1' } })).body.code).toBe('answers_locked');
    // concurrent prepare keeps one set
    await Promise.all([sg('post', defS.link, '/prepare'), sg('post', defS.link, '/prepare')]);
    const docs = await ctx.db.all('SELECT id, prepared_key, prepared_sha256 FROM bd_documents WHERE signer_id = ?', [defS.id]);
    expect(docs).toHaveLength(1);

    // signing needs every copy opened, the exact name and both agreements
    expect((await sg('post', defS.link, '/sign').send({ typed_name: 'Nguyễn Văn An', agree_esign: true, agree_terms: true })).body.code).toBe('not_viewed');
    const copy = await sg('get', defS.link, `/documents/${docs[0].id}.pdf`).buffer(true).parse(binary);
    expect(copy.status).toBe(200);
    expect(sha(copy.body)).toBe(docs[0].prepared_sha256);
    const cf = (await PDFDocument.load(copy.body)).getForm();
    expect(cf.getTextField('Signer Address').getText()).toBe('1 Main St, Nashville TN');
    expect(cf.getTextField('Signer Name').getText()).toBe('Nguyễn Văn An');
    expect((await sg('get', indS.link, `/documents/${docs[0].id}.pdf`)).status).toBe(404);   // not the indemnitor's copy
    expect((await sg('post', defS.link, '/sign').send({ typed_name: 'Nguyen Van An', agree_esign: true, agree_terms: true })).body.code).toBe('name_mismatch');
    expect((await sg('post', defS.link, '/sign').send({ typed_name: 'Nguyễn Văn An', agree_esign: true })).body.code).toBe('consent_required');
    const signed = await sg('post', defS.link, '/sign').send({ typed_name: '  nguyễn   văn an ', agree_esign: true, agree_terms: true });
    expect(signed.status).toBe(200);
    expect((await sg('post', defS.link, '/sign').send({ typed_name: 'Nguyễn Văn An', agree_esign: true, agree_terms: true })).body.code).toBe('already_signed');
    const s1 = await ctx.db.get('SELECT status, typed_name, sign_ip, sign_user_agent, consent_version FROM bd_signers WHERE id = ?', [defS.id]);
    expect(s1).toMatchObject({ status: 'signed', typed_name: 'nguyễn văn an', sign_ip: '203.0.113.9', sign_user_agent: 'JestBrowser/1.0', consent_version: 'esign-2026-10' });
    const mine = await sg('get', defS.link, '/signed.pdf').buffer(true).parse(binary);
    expect(mine.status).toBe(200);
    const sdoc = await PDFDocument.load(mine.body);
    expect(sdoc.getPageCount()).toBe(2);                 // the form + the signature certificate
    expect(sdoc.getForm().getFields()).toHaveLength(0);  // flattened
    const drow = await ctx.db.get('SELECT status, signed_sha256 FROM bd_documents WHERE id = ?', [docs[0].id]);
    expect(drow.status).toBe('signed');
    const agentCopy = await bd('get', `/documents/${docs[0].id}.pdf`).buffer(true).parse(binary);
    expect(sha(agentCopy.body)).toBe(drow.signed_sha256);

    let pd = (await bd('get', `/packets/${pk.body.packet.id}`)).body;
    expect(pd.packet.status).toBe('in_progress');
    expect(pd.signers.find((s) => s.id === defS.id).events.map((e) => e.event)).toEqual(
      ['sent', 'delivery_sms', 'delivery_email', 'opened', 'answers_saved', 'uploaded', 'uploaded', 'prepared', 'viewed', 'signed']);
    expect(pd.uploads.filter((u) => u.signer_id === defS.id).map((u) => u.kind)).toEqual(['id_front', 'selfie_with_id']);
    const upl = await bd('get', `/uploads/${pd.uploads[0].id}`).buffer(true).parse(binary);
    expect(Buffer.compare(upl.body, JPEG)).toBe(0);
    expect((await bd('get', `/uploads/${pd.uploads[0].id}`, agent2)).status).toBe(404);

    // a new link for the indemnitor: the old one stops working; the person who replied STOP declines
    const rot = await bd('post', `/packets/${pk.body.packet.id}/signers/${indS.id}/link`).send({ deliver: 'none' });
    expect((await sg('get', indS.link)).body.code).toBe('link_invalid');
    expect((await sg('post', stopS.link, '/decline').send({ reason: 'Not signing' })).status).toBe(200);
    expect((await sg('post', stopS.link, '/prepare')).body.code).toBe('declined');
    const ind2 = { link: rot.body.link };
    await sg('post', ind2.link, '/answers').send({ answers: { relationship: 'Sister', dob: '1985-05-05', phone: '615-555-0122', address: '2 Oak Ave', custom_1: 'n/a' } });
    for (const kind of ['id_front', 'selfie_with_id']) await sg('post', ind2.link, '/uploads').field('kind', kind).attach('file', JPEG, 'x.jpg');
    const ip = await sg('post', ind2.link, '/prepare');
    await sg('get', ind2.link, `/documents/${ip.body.documents[0].id}.pdf`);
    expect((await sg('post', ind2.link, '/sign').send({ typed_name: 'maría lópez', agree_esign: true, agree_terms: true })).status).toBe(200);
    pd = (await bd('get', `/packets/${pk.body.packet.id}`)).body;
    expect(pd.packet.status).toBe('in_progress');   // one signer declined: the agent decides (void and resend)
    const merged = await bd('get', `/packets/${pk.body.packet.id}/signed.pdf`).buffer(true).parse(binary);
    expect((await PDFDocument.load(merged.body)).getPageCount()).toBe(4);
    if (process.env.BD_DUMP) (await import('node:fs')).writeFileSync(process.env.BD_DUMP, merged.body);
    // a voided packet's links stop working
    expect((await bd('post', `/packets/${pk.body.packet.id}/void`).send({ reason: 'Re-issuing' })).status).toBe(200);
    expect((await sg('get', defS.link)).body.code).toBe('packet_voided');
    // a packet where everyone signs completes
    const pk2 = await bd('post', `/bonds/${b.id}/packets`).send({ form_ids: [form.id], signers: [{ role: 'defendant' }], deliver: 'none' });
    expect(pk2.body.signers[0].delivery).toEqual({ sms: null, email: null });
    const L = pk2.body.signers[0].link;
    const p2 = await sg('post', L, '/prepare');
    await sg('get', L, `/documents/${p2.body.documents[0].id}.pdf`);
    await sg('post', L, '/sign').send({ typed_name: 'Nguyễn Văn An', agree_esign: true, agree_terms: true });
    pd = (await bd('get', `/packets/${pk2.body.packet.id}`)).body;
    expect(pd.packet.status).toBe('completed');
    expect((await bd('get', '/dashboard')).body.awaiting_signature.some((a) => a.packet_id === pk2.body.packet.id)).toBe(false);

    // payment reminder: never to a number that replied STOP; texts are metered
    await bd('put', `/bonds/${b.id}/plan`).send({ installments: [{ due_on: '2099-03-01', amount_cents: 25000 }] });
    expect((await bd('post', `/bonds/${b.id}/remind`).send({ to: 'indemnitor', indemnitor_id: optedOut.id, channel: 'sms', consent_confirmed: true })).body.code).toBe('opted_out');
    const rem = await bd('post', `/bonds/${b.id}/remind`).send({ to: 'indemnitor', indemnitor_id: ind.id, channel: 'sms', consent_confirmed: true });
    expect(rem.body.status).toBe('sent');
    expect(texts.at(-1).text).toBe('Alpha Bail Bonds: a payment of $250.00 on the bail bond for Nguyễn Văn An is due 03/01/2099. Balance: $250.00. Questions: 615-555-0199. Reply STOP to opt out.');
    const month = (await bd('get', '/texts')).body;
    expect(month.count).toBeGreaterThanOrEqual(3);
    expect(month.cents).toBe(month.count * 5);
  });

  test('BD8 CSV reports neutralise formula cells', async () => {
    if (!ctx.app) return;
    const b = await newBond({ defendant_name: '=HYPERLINK("http://x")', bond_amount_cents: 100000 });
    await bd('post', `/bonds/${b.id}/charges`).send({ kind: 'premium', amount_cents: 10000 });
    await bd('post', `/bonds/${b.id}/payments`).send({ amount_cents: 2500, method: 'check', payer_name: '+cmd', reference: '1001' });
    const csv = await bd('get', '/reports/receipts?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv.text).toContain(`'+cmd`);
    const rec = (await bd('get', '/reports/receivables')).body;
    const row = rec.rows.find((r) => r.bond_id === b.id);
    expect(row).toMatchObject({ charged_cents: 10000, paid_cents: 2500, balance_cents: 7500 });
    expect((await bd('get', '/reports/receipts?from=2026-12-01&to=2026-01-01')).body.code).toBe('bad_date');
  });

  test('BD9 texts are billed once on the plan invoice', async () => {
    if (!ctx.app) return;
    process.env.STRIPE_SECRET_KEY = 'sk_test_bd';
    try {
      const { billAgentTexts } = await import('../../services/bondDesk/textBilling.js');
      const unbilled = async (a) => (await ctx.db.get('SELECT COUNT(*)::int AS n FROM bd_texts WHERE agent_id = ? AND batch_id IS NULL', [a.user.id])).n;
      const n = await unbilled(agent);
      expect(n).toBeGreaterThan(0);
      fake.subs.set('sub_bd_1', { id: 'sub_bd_1', customer: 'cus_agent1' });
      const r1 = await billAgentTexts(ctx.db);
      expect(r1.failed).toBe(0);
      const mine = fake.items.filter((i) => i.customer === 'cus_agent1');
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ subscription: 'sub_bd_1', amount: n * 5, currency: 'usd' });
      expect(await unbilled(agent)).toBe(0);
      await billAgentTexts(ctx.db);
      expect(fake.items.filter((i) => i.customer === 'cus_agent1')).toHaveLength(1);
      // crash after Stripe, before the DB: the batch stays pending; the next run finds the item
      await ctx.db.run(`INSERT INTO bd_texts (agent_id, purpose, to_masked, cents) VALUES (?, 'payment_reminder', '•••', 5)`, [agent.user.id]);
      const b = await ctx.db.get(`INSERT INTO bd_text_batches (agent_id, stripe_sub_id, texts, amount_cents) VALUES (?, 'sub_bd_1', 1, 5) RETURNING id`, [agent.user.id]);
      await ctx.db.run(`UPDATE bd_texts SET batch_id = ? WHERE agent_id = ? AND batch_id IS NULL`, [b.id, agent.user.id]);
      fake.items.push({ id: 'ii_pre', customer: 'cus_agent1', amount: 5, metadata: { bd_text_batch: String(b.id) } });
      const calls = fake.createCalls;
      await billAgentTexts(ctx.db);
      expect(fake.createCalls).toBe(calls);
      expect((await ctx.db.get('SELECT status, stripe_invoice_item_id FROM bd_text_batches WHERE id = ?', [b.id]))).toEqual({ status: 'billed', stripe_invoice_item_id: 'ii_pre' });
      // an agent without a paid plan is not billed (and keeps the texts unbilled)
      await ctx.db.run(`INSERT INTO bd_texts (agent_id, purpose, to_masked, cents) VALUES (?, 'payment_reminder', '•••', 5)`, [plainAgent.user.id]);
      await billAgentTexts(ctx.db);
      expect(await unbilled(plainAgent)).toBe(1);
    } finally { delete process.env.STRIPE_SECRET_KEY; }
  });
});
