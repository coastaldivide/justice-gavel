/**
 * billing_consultations.int.test.js — with NO Stripe key configured (the
 * production default until the owner sets one up):
 *   • every money-moving POST under /api/billing returns 503 payments_unavailable
 *   • read-only billing GETs keep working on the free tier
 *   • consultation booking returns the same 503; slots/prefill/callback work
 *     (booking and call-backs only for a lawyer who is on the app)
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
    expect(sub.body.payments_live).toBe(false);             // Stripe not live

    const consumer = await ctx.request().get('/api/billing/consumer/subscription').set(user.headers);
    expect(consumer.status).toBe(200);
    expect(consumer.body.subscription).toBeNull();
    expect(consumer.body.tiers.map(t => t.key).sort()).toEqual(['advisor', 'advisor_annual', 'legal_pro', 'legal_radar', 'pro_annual']);
    expect(consumer.body.tiers.every(t => t.audience === 'consumer')).toBe(true);

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
    // …a bail agent account lists once it has a bondsman profile (the profile is
    // for bail-agent accounts only — section G).
    expect((await ctx.request().post('/api/billing/bondsman/profile').set(user.headers)
      .send({ company_name: 'Not an agent', license_state: 'TN' })).status).toBe(403);
    const agent = await ctx.register({ displayName: 'Lead Agent', accountType: 'bail_agent' });
    const prof = await ctx.request().post('/api/billing/bondsman/profile').set(agent.headers)
      .send({ company_name: `${ctx.tag} Bonds`, license_number: 'TN-1', license_state: 'TN', counties: ['Davidson'], states: ['TN'] });
    expect(prof.status).toBe(200);
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM bondsman_profiles WHERE user_id = ?', [agent.user.id]); });
    const res = await ctx.request().get('/api/billing/leads?state=TN&hours=87600').set(agent.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leads)).toBe(true);
    expect(res.body.lead_fee).toMatchObject({ model: 'flat', cents: 10000 });
    expect(typeof res.body.feeds_configured).toBe('boolean');
    // the 600 seed rows all have bail > 0 and no attorney — none may appear
    for (const l of res.body.leads) expect(l.is_sample).toBeFalsy();
    expect((await ctx.request().get('/api/billing/leads')).status).toBe(401);
  });

  // A directory lawyer linked to an attorney account (as an approved listing
  // claim does) can be booked; any other listing cannot (nobody would see it).
  let linked; let unlinked;
  const linkLawyer = async () => {
    if (linked) return;
    const atty = await ctx.register({ displayName: 'Linked Attorney', accountType: 'attorney' });
    const row = await ctx.db.get(`SELECT l.id, l.state FROM lawyers l WHERE l.user_id IS NULL AND l.state = 'TX'
      AND NOT EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = l.id) ORDER BY l.id LIMIT 1`);
    await ctx.db.run(`INSERT INTO attorney_profiles (user_id, lawyer_id) VALUES (?, ?)
                      ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET lawyer_id = EXCLUDED.lawyer_id`, [atty.user.id, row.id]);
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM attorney_profiles WHERE lawyer_id = ?', [row.id]); });
    linked = row;
    unlinked = await ctx.db.get(`SELECT l.id FROM lawyers l WHERE l.user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = l.id) AND l.id <> ? ORDER BY l.id LIMIT 1`, [row.id]);
  };

  it('consultation booking returns 503 payments_unavailable and books NOTHING (lawyer on the app, real slot)', async () => {
    await linkLawyer();
    const slots = await ctx.request().get(`/api/consultations/slots/${linked.id}`).set(user.headers);
    const day = slots.body.slots.find(d => d.times.some(t => t.available));
    const slot = day.times.find(t => t.available);
    const res = await ctx.request().post('/api/consultations/book').set(user.headers).send({
      lawyer_id: linked.id, date_slot: day.date, time_slot: slot.time, duration_min: 30,
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('payments_unavailable');
    const rows = await ctx.db.get('SELECT COUNT(*) AS n FROM consultation_bookings WHERE user_id = ?', [user.user.id]);
    expect(Number(rows.n)).toBe(0);
  });

  it('a listing that is not on the app cannot be booked (409 not_on_app, nothing stored)', async () => {
    await linkLawyer();
    const slots = await ctx.request().get(`/api/consultations/slots/${unlinked.id}`).set(user.headers);
    expect(slots.status).toBe(200);
    expect(slots.body).toMatchObject({ bookable: false, reason: 'not_on_app', slots: [] });
    const res = await ctx.request().post('/api/consultations/book').set(user.headers).send({
      lawyer_id: unlinked.id, date_slot: '2027-03-02', time_slot: '9:00 AM', duration_min: 30,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_on_app');
  });

  it('slots (lawyer zone + exact instants) + prices + prefill + my-bookings list work without payments', async () => {
    await linkLawyer();
    const slots = await ctx.request().get(`/api/consultations/slots/${linked.id}`).set(user.headers);
    expect(slots.status).toBe(200);
    expect(slots.body).toMatchObject({ bookable: true, time_zone: 'America/Chicago', refund_cutoff_hours: 0 });   // 0 = platform fee non-refundable once confirmed
    expect(slots.body.prices.map(p => p.fee_display)).toEqual(['$10.00', '$15.00', '$25.00']);
    expect(slots.body.slots.length).toBeGreaterThan(0);
    expect(slots.body.slots[0]).toEqual(expect.objectContaining({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), times: expect.any(Array),
    }));
    const first = slots.body.slots[0].times[0];
    expect(first).toEqual(expect.objectContaining({ time: '9:00 AM', available: expect.any(Boolean), starts_at: expect.any(String) }));
    // 9:00 AM on a Texas lawyer's clock, whatever the server's own zone
    const wall = new Date(first.starts_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
    expect(wall).toBe('9:00 AM');

    const prefill = await ctx.request().get('/api/consultations/prefill').set(user.headers);
    expect(prefill.status).toBe(200);
    expect(prefill.body).toHaveProperty('case_id');

    const mine = await ctx.request().get('/api/consultations').set(user.headers);
    expect(mine.status).toBe(200);
    expect(mine.body.consultations).toEqual([]);
  });

  it('callback-request: only for a lawyer on the app; stores the row and validates the contact', async () => {
    await linkLawyer();
    // its own user: bookings and call-backs share a 5-per-hour limit per person
    const caller = await ctx.register({ displayName: 'Caller' });
    const no = await ctx.request().post('/api/consultations/callback-request').set(caller.headers)
      .send({ lawyer_id: unlinked.id, phone: '+16155550123', notes: 'Please call about bail' });
    expect(no.status).toBe(409);
    const res = await ctx.request().post('/api/consultations/callback-request').set(caller.headers)
      .send({ lawyer_id: linked.id, phone: '+16155550123', notes: 'Please call about bail', duration_min: 30 });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const row = await ctx.db.get('SELECT phone, notes FROM callback_requests WHERE user_id = ?', [caller.user.id]);
    expect(row).toMatchObject({ phone: '+16155550123', notes: 'Please call about bail' });
    expect((await ctx.request().post('/api/consultations/callback-request').set(caller.headers).send({ lawyer_id: linked.id, phone: '12' })).status).toBe(400);
    expect((await ctx.request().post('/api/consultations/callback-request').set(caller.headers).send({})).status).toBe(400);
  });

  it('booking validation precedes payment: missing slot fields are 400s, guests 401', async () => {
    const r400 = await ctx.request().post('/api/consultations/book').set(user.headers)
      .send({ lawyer_name: 'X' });
    expect([400, 503]).toContain(r400.status);  // zod runs first → 400; never 5xx
    expect(r400.status).toBe(400);
    expect((await ctx.request().post('/api/consultations/book').send({})).status).toBe(401);
  });
});
