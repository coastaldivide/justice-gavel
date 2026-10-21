/**
 * core_safety.int.test.js — section A (core path & safety) regressions on the
 * real app + real Postgres:
 *
 *   1  POST /api/alerts (SOS): says per contact whether it really went out —
 *      no SMS / e-mail provider → sent 0 with a reason (it used to report
 *      success while the SMS sender was a stub); all three saved contacts
 *      are tried (the third was dropped); no location still sends (it was a
 *      400); text in the request's language; with Twilio configured the text
 *      goes out and is counted
 *   2  GET /api/interrogation/recording-law: full state names (the iOS
 *      geocoder) resolve — "California" is all-party consent, not the
 *      one-party default — and the note comes in the requested language
 *   3  arrest monitors: no state = every state (the app's "ALL" was a 400);
 *      deleting someone else's or a missing monitor is a 404
 *   4  Quick Connect: GET quote is the real $20.00 (the price constant was
 *      missing → NaN); without Stripe every POST stays 503
 *   5  POST /api/transcribe/text: a non-string is a 400, not "[object Object]"
 */
import http from 'http';
import { describeIntegration, initSuite } from './_harness.js';

const twilio = { server: null, received: [] };

describeIntegration('section A: SOS, recording law, monitors, Quick Connect (real Postgres)', () => {
  beforeAll(async () => {
    twilio.server = http.createServer((req, res) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        twilio.received.push(Object.fromEntries(new URLSearchParams(data)));
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sid: `SM${twilio.received.length}` }));
      });
    });
    await new Promise(r => twilio.server.listen(0, '127.0.0.1', r));
    delete process.env.RESEND_API_KEY;
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']) delete process.env[k];
  });
  afterAll(async () => {
    if (ctx.db) await ctx.db.run('DELETE FROM alerts WHERE user_name = ?', [`Alice ${ctx.tag}`]).catch(() => {});
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'TWILIO_API_BASE']) delete process.env[k];
    await new Promise(r => twilio.server.close(r));
  });

  const ctx = initSuite({ anthropicMock: true });
  let alice, bob;
  beforeAll(async () => {
    if (!ctx.app) return;
    alice = await ctx.register({ displayName: 'Alice SOS' });
    bob = await ctx.register({ displayName: 'Bob Other' });
  });

  // ── 1 SOS ──────────────────────────────────────────────────────────────
  test('1a SOS needs an account and at least one contact (400 in the language)', async () => {
    expect((await ctx.request().post('/api/alerts').send({ contacts: ['6155550101'] })).status).toBe(401);
    const r = await ctx.request().post('/api/alerts?lang=es').set(alice.headers).send({ userName: 'Alice', contacts: [{ x: 1 }, 5, '  '] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/contacto de emergencia/);
  });

  test('1b no SMS / e-mail provider: nothing is reported as sent; all 3 contacts tried; no location is fine', async () => {
    const r = await ctx.request().post('/api/alerts').set({ ...alice.headers, 'Accept-Language': 'es' })
      .send({ userName: `Alice ${ctx.tag}`, contacts: ['6155550101', 'mom@example.test', '(615) 555-0103', '6155550104', '6155550101'] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, sent: 0, total: 3, language: 'es' });
    expect(r.body.results).toEqual([
      { contact: '6155550101', method: 'sms', delivered: false, reason: 'sms_not_configured' },
      { contact: 'mom@example.test', method: 'email', delivered: false, reason: 'email_not_configured' },
      { contact: '(615) 555-0103', method: 'sms', delivered: false, reason: 'sms_not_configured' },
    ]);
    expect(r.body.message).toMatch(new RegExp(`^EMERGENCIA: Alice ${ctx.tag} necesita ayuda inmediata\\. No se pudo compartir su ubicación`));
    const logged = await ctx.db.all('SELECT status FROM alerts WHERE user_name = ?', [`Alice ${ctx.tag}`]);
    expect(logged.map(x => x.status).sort()).toEqual(['email_not_configured', 'sms_not_configured', 'sms_not_configured']);
  });

  test('1c with Twilio configured the texts go out (with the map link) and are counted; bad numbers are not', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM_NUMBER = '+16155550000';
    process.env.TWILIO_API_BASE = `http://127.0.0.1:${twilio.server.address().port}`;
    twilio.received.length = 0;
    const r = await ctx.request().post('/api/alerts').set(bob.headers)
      .send({ userName: '', contacts: ['6155550101', '12'], lat: 36.16, lng: -86.78 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sent: 1, total: 2 });
    expect(r.body.results[1]).toMatchObject({ contact: '12', delivered: false, reason: 'invalid_contact' });
    expect(twilio.received).toHaveLength(1);
    expect(twilio.received[0].To).toBe('+16155550101');
    expect(twilio.received[0].Body).toBe('EMERGENCY: Someone you know needs immediate help. Location: https://maps.google.com/?q=36.16,-86.78');
  });

  // ── 2 recording law ────────────────────────────────────────────────────
  test('2 recording-consent law: full state names resolve; note in the language; unknown → one-party', async () => {
    const ca = await ctx.request().get('/api/interrogation/recording-law?state=California');
    expect(ca.body).toMatchObject({ state: 'CA', consent: 'two-party', warn: true, law: 'California Penal Code § 632' });
    expect(ca.body.note).toMatch(/^California requires ALL parties/);
    const nh = await ctx.request().get('/api/interrogation/recording-law?state=new%20hampshire&lang=vi');
    expect(nh.body).toMatchObject({ state: 'NH', consent: 'two-party' });
    expect(nh.body.note).toBe('New Hampshire yêu cầu sự đồng ý của tất cả các bên.');
    const tn = await ctx.request().get('/api/interrogation/recording-law?state=Tennessee').set('Accept-Language', 'pt-BR');
    expect(tn.body).toMatchObject({ state: 'TN', consent: 'one-party', warn: false });
    expect(tn.body.note).toMatch(/^No seu estado, basta que uma das partes/);
    const none = await ctx.request().get('/api/interrogation/recording-law?state=Narnia');
    expect(none.body).toMatchObject({ state: null, consent: 'one-party' });
  });

  // ── 3 arrest monitors ──────────────────────────────────────────────────
  test('3 monitors: no state / "ALL" = every state; delete is owner-only with a 404 otherwise', async () => {
    // Monitoring is a paid feature (Legal Pro / Esquire — billing/plans.js PLAN_FEATURES, section G):
    // without such a plan the server refuses with 402; a Stripe-confirmed plan row unlocks it.
    const refused = await ctx.request().post('/api/arrests/monitors').set(alice.headers).send({ watch_name: 'Jordan Sample' });
    expect(refused.status).toBe(402);
    expect(refused.body.code).toBe('upgrade_required');
    await ctx.db.run(`INSERT INTO subscriptions (user_id, tier, status, stripe_sub_id, created_at) VALUES (?, 'legal_pro', 'active', ?, NOW())`,
      [alice.user.id, `sub_core_safety_${ctx.tag}`]);
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM subscriptions WHERE user_id = ?', [alice.user.id]); });
    const a = await ctx.request().post('/api/arrests/monitors').set(alice.headers).send({ watch_name: 'Jordan Sample', county: 'All' });
    expect(a.status).toBe(201);
    const b = await ctx.request().post('/api/arrests/monitors').set(alice.headers).send({ watch_name: 'Jamie Sample', state: 'ALL' });
    expect(b.status).toBe(201);
    const rows = await ctx.db.all('SELECT state FROM arrest_monitors WHERE id IN (?, ?)', [a.body.id, b.body.id]);
    expect(rows.map(r => r.state)).toEqual([null, null]);
    const { monitorMatches } = await import('../../services/arrest_alerts.js');
    expect(monitorMatches({ watch_name: 'Jordan Sample', state: null }, { name: 'SAMPLE, JORDAN', state: 'GA' })).toBe(true);
    expect(monitorMatches({ watch_name: 'Jordan Sample', state: 'ALL' }, { name: 'SAMPLE, JORDAN', state: 'GA' })).toBe(true);
    expect((await ctx.request().delete(`/api/arrests/monitors/${a.body.id}`).set(bob.headers)).status).toBe(404);
    expect((await ctx.request().delete(`/api/arrests/monitors/${a.body.id}`).set(alice.headers)).status).toBe(200);
    expect((await ctx.request().delete(`/api/arrests/monitors/${a.body.id}`).set(alice.headers)).status).toBe(404);
    const list = await ctx.request().get('/api/arrests/monitors').set(alice.headers);
    expect(list.body.monitors.map(m => m.watch_name)).toEqual(['Jamie Sample']);
  });

  // ── 4 Quick Connect ────────────────────────────────────────────────────
  test('4 Quick Connect quote is $20.00 minus credit; POSTs stay 503 without Stripe', async () => {
    const q = await ctx.request().get('/api/billing/quickconnect/quote').set(alice.headers);
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ price_cents: 2000, credit_cents: 0, amount_cents: 2000, payments_live: false });
    await ctx.db.run('UPDATE users SET credit_cents = 500 WHERE id = ?', [alice.user.id]);
    const q2 = await ctx.request().get('/api/billing/quickconnect/quote').set(alice.headers);
    expect(q2.body).toMatchObject({ credit_cents: 500, amount_cents: 1500 });
    expect((await ctx.request().get('/api/billing/quickconnect/quote')).status).toBe(401);
    for (const p of ['/api/billing/quickconnect', '/api/billing/quickconnect/confirm']) {
      const r = await ctx.request().post(p).set(alice.headers).send({ lat: 36.16, lng: -86.78, payment_intent_id: 'pi_x' });
      expect(r.status).toBe(503);
      expect(r.body.error).toBe('payments_unavailable');
    }
  });

  // ── 5 typed voice note ─────────────────────────────────────────────────
  test('5 typed note: a non-string is a 400', async () => {
    const r = await ctx.request().post('/api/transcribe/text').set(alice.headers).send({ text: { a: 1 } });
    expect(r.status).toBe(400);
    const ok = await ctx.request().post('/api/transcribe/text').set(alice.headers).send({ text: 'Call my lawyer. Court date is Friday.' });
    expect(ok.status).toBe(200);
    expect(ok.body.note.summary).toContain('Call my lawyer.');
  });
});
