/**
 * billing_consultations.int.test.js — with NO Stripe key configured (the
 * production default until the owner sets one up):
 *   • every money-moving POST under /api/billing returns 503 payments_unavailable
 *   • read-only billing GETs keep working on the free tier
 *   • consultation booking returns the same 503; slots/prefill/callback work
 * No mock payment ever activates anything — asserted against the DB.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('billing + consultations with payments disabled (real Postgres)', () => {
  const ctx = initSuite();

  let user;
  beforeAll(async () => {
    if (!ctx.app) return;
    user = await ctx.register({ displayName: 'Billing User' });
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM callback_requests WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [`${ctx.tag}-%@it.example.test`]);
    });
  });

  const expect503 = async (path, body = {}) => {
    const res = await ctx.request().post(path).set(user.headers).send(body);
    expect(`${path}:${res.status}`).toBe(`${path}:503`);
    expect(res.body.error).toBe('payments_unavailable');
    expect(res.body.message).toBe('Payments are not available yet');
  };

  it('every billing POST the app can issue returns 503 payments_unavailable', async () => {
    await expect503('/api/billing/subscribe', { tier: 'advisor' });
    await expect503('/api/billing/cancel');
    await expect503('/api/billing/consumer/subscribe', { tier: 'advisor' });
    await expect503('/api/billing/quickconnect', { lat: 36.16, lng: -86.78 });
    await expect503('/api/billing/family/connect', { arrest_id: 1 });
    await expect503('/api/billing/leads/1/accept', {});
    await expect503('/api/billing/bondsman/verified-badge/subscribe', {});
    await expect503('/api/billing/bondsman/subscribe', { tier: 'pro' });
    // nothing was activated behind the scenes
    const subs = await ctx.db.get('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?', [user.user.id]);
    expect(Number(subs.n)).toBe(0);
  });

  it('read-only billing endpoints stay available on the free tier', async () => {
    const sub = await ctx.request().get('/api/billing/subscription').set(user.headers);
    expect(sub.status).toBe(200);
    expect(sub.body.subscription).toBeNull();
    expect(Array.isArray(sub.body.tiers)).toBe(true);
    expect(sub.body.mock).toBe(true);                       // Stripe not live

    const consumer = await ctx.request().get('/api/billing/consumer/subscription').set(user.headers);
    expect(consumer.status).toBe(200);
    expect(consumer.body.subscription).toBeNull();
    expect(consumer.body.tiers.map(t => t.key)).toEqual(['advisor', 'legal_pro', 'legal_radar']);

    const tiers = await ctx.request().get('/api/billing/bondsman/tiers');
    expect(tiers.status).toBe(200);
    // the bondsman lead fee is FLAT — never scaled to bail (owner constraint)
    expect(tiers.body.lead_fee).toMatchObject({ model: 'flat' });
    expect(tiers.body.lead_fee.cents).toBe(10000);
    expect(tiers.body.lead_fee.display).toBe('$100');
  });

  it('bondsman leads list works read-only, hides sample arrests, quotes the flat fee', async () => {
    // Only bondsman accounts may browse leads (audit11 C2): a plain user is refused…
    const plain = await ctx.request().get('/api/billing/leads?state=TN').set(user.headers);
    expect(plain.status).toBe(403);
    // …and the same user can list once they have a bondsman profile.
    const prof = await ctx.request().post('/api/billing/bondsman/profile').set(user.headers)
      .send({ company_name: `${ctx.tag} Bonds`, license_number: 'TN-1', license_state: 'TN', counties: ['Davidson'], states: ['TN'] });
    expect(prof.status).toBe(200);
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM bondsman_profiles WHERE user_id = ?', [user.user.id]); });
    const res = await ctx.request().get('/api/billing/leads?state=TN&hours=87600').set(user.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leads)).toBe(true);
    expect(res.body.lead_fee).toMatchObject({ model: 'flat', cents: 10000 });
    expect(typeof res.body.feeds_configured).toBe('boolean');
    // the 600 seed rows all have bail > 0 and no attorney — none may appear
    for (const l of res.body.leads) expect(l.is_sample).toBeFalsy();
    expect((await ctx.request().get('/api/billing/leads')).status).toBe(401);
  });

  it('consultation booking returns 503 payments_unavailable and books NOTHING', async () => {
    const res = await ctx.request().post('/api/consultations/book').set(user.headers).send({
      lawyer_id: 1, lawyer_name: 'Test Attorney', date_slot: '2027-03-02', time_slot: '9:00 AM', duration_min: 30,
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('payments_unavailable');
    const rows = await ctx.db.get('SELECT COUNT(*) AS n FROM consultation_bookings WHERE user_id = ?', [user.user.id]);
    expect(Number(rows.n)).toBe(0);
  });

  it('slots + prefill + my-bookings list keep working without payments', async () => {
    const lawyer = await ctx.db.get('SELECT id FROM lawyers ORDER BY id LIMIT 1');
    const slots = await ctx.request().get(`/api/consultations/slots/${lawyer.id}`).set(user.headers);
    expect(slots.status).toBe(200);
    expect(Array.isArray(slots.body.slots)).toBe(true);
    expect(slots.body.slots.length).toBeGreaterThan(0);
    expect(slots.body.slots[0]).toEqual(expect.objectContaining({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), times: expect.any(Array),
    }));
    expect(slots.body.slots[0].times[0]).toEqual(expect.objectContaining({ time: expect.any(String), available: expect.any(Boolean) }));

    const prefill = await ctx.request().get('/api/consultations/prefill').set(user.headers);
    expect(prefill.status).toBe(200);
    expect(prefill.body).toHaveProperty('case_id');

    const mine = await ctx.request().get('/api/consultations').set(user.headers);
    expect(mine.status).toBe(200);
    expect(mine.body.consultations).toEqual([]);
  });

  it('callback-request stores a row (no payment involved) and validates the phone', async () => {
    const res = await ctx.request().post('/api/consultations/callback-request').set(user.headers)
      .send({ phone: '+16155550123', notes: 'Please call about bail', duration_min: 30 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const row = await ctx.db.get('SELECT phone, notes FROM callback_requests WHERE user_id = ?', [user.user.id]);
    expect(row).toMatchObject({ phone: '+16155550123', notes: 'Please call about bail' });
    expect((await ctx.request().post('/api/consultations/callback-request').set(user.headers).send({})).status).toBe(400);
  });

  it('booking validation precedes payment: missing slot fields are 400s, guests 401', async () => {
    const r400 = await ctx.request().post('/api/consultations/book').set(user.headers)
      .send({ lawyer_name: 'X' });
    expect([400, 503]).toContain(r400.status);  // zod runs first → 400; never 5xx
    expect(r400.status).toBe(400);
    expect((await ctx.request().post('/api/consultations/book').send({})).status).toBe(401);
  });
});
