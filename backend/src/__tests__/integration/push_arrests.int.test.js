/**
 * push_arrests.int.test.js — push token register/delete + daily tip, and the
 * arrest search endpoints (sample seed rows must stay hidden), on real Postgres.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('push tokens + arrest search (real Postgres)', () => {
  const ctx = initSuite();

  let user;
  const TOKEN = 'ExponentPushToken[integration-test-0001]';
  beforeAll(async () => {
    if (!ctx.app) return;
    user = await ctx.register({ displayName: 'Push User' });
  });

  it('POST /push/token upserts the device token; DELETE /push/token/:token removes it', async () => {
    const reg = await ctx.request().post('/api/push/token').set(user.headers).send({ token: TOKEN });
    expect(reg.status).toBe(200);
    expect(reg.body.ok).toBe(true);
    let row = await ctx.db.get('SELECT token FROM push_tokens WHERE user_id = ?', [user.user.id]);
    expect(row.token).toBe(TOKEN);
    expect((await ctx.db.get('SELECT push_token FROM users WHERE id = ?', [user.user.id])).push_token).toBe(TOKEN);

    // re-register (app refresh on foreground) replaces, never duplicates
    const TOKEN2 = 'ExponentPushToken[integration-test-0002]';
    await ctx.request().post('/api/push/token').set(user.headers).send({ expoPushToken: TOKEN2 });
    const all = await ctx.db.all('SELECT token FROM push_tokens WHERE user_id = ?', [user.user.id]);
    expect(all).toHaveLength(1);
    expect(all[0].token).toBe(TOKEN2);

    const del = await ctx.request().delete(`/api/push/token/${encodeURIComponent(TOKEN2)}`).set(user.headers);
    expect(del.status).toBe(200);
    row = await ctx.db.get('SELECT token FROM push_tokens WHERE user_id = ?', [user.user.id]);
    expect(row).toBeUndefined();
    expect((await ctx.db.get('SELECT push_token FROM users WHERE id = ?', [user.user.id])).push_token).toBeNull();
  });

  it('push token endpoints validate input and require auth', async () => {
    expect((await ctx.request().post('/api/push/token').set(user.headers).send({})).status).toBe(400);
    expect((await ctx.request().post('/api/push/token').send({ token: 'x' })).status).toBe(401);
    expect((await ctx.request().delete('/api/push/token/whatever')).status).toBe(401);
  });

  it('notification preferences round-trip through /push/preferences (SettingsScreen)', async () => {
    const before = await ctx.request().get('/api/push/preferences').set(user.headers);
    expect(before.status).toBe(200);
    // DB defaults: reminders/tips/alerts on, marketing OFF (opt-in)
    expect(Number(before.body.notif_court_reminders)).toBe(1);
    expect(Number(before.body.notif_marketing)).toBe(0);

    // the app always posts all five flags together
    const save = await ctx.request().post('/api/push/preferences').set(user.headers).send({
      notif_court_reminders: 1, notif_legal_tips: 0, notif_arrest_alerts: 1,
      notif_checkin_reminders: 1, notif_marketing: 0,
    });
    expect(save.status).toBe(200);

    const after = await ctx.request().get('/api/push/preferences').set(user.headers);
    expect(Number(after.body.notif_legal_tips)).toBe(0);
    expect(Number(after.body.notif_court_reminders)).toBe(1);
    const row = await ctx.db.get('SELECT notif_legal_tips FROM users WHERE id = ?', [user.user.id]);
    expect(Number(row.notif_legal_tips)).toBe(0);
    expect((await ctx.request().get('/api/push/preferences')).status).toBe(401);
  });

  it('GET /push/tip is public and returns today\'s tip', async () => {
    const res = await ctx.request().get('/api/push/tip');
    expect(res.status).toBe(200);
    expect(typeof res.body.tip).toBe('string');
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('arrest search never returns the sample seed rows and reports honest flags', async () => {
    // the 600 seed rows are source='seed_v1' — by name they are all findable,
    // so search by a seed row's own name must return nothing
    const seed = await ctx.db.get("SELECT name, county, state FROM arrest_records WHERE source = 'seed_v1' LIMIT 1");
    expect(seed).toBeTruthy();

    const res = await ctx.request().get('/api/arrests/search')
      .query({ name: seed.name, state: seed.state }).set(user.headers);
    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.sample_mode).toBe(false);
    expect(typeof res.body.feeds_configured).toBe('boolean');

    const recent = await ctx.request().get('/api/arrests/recent?hours=87600&state=' + seed.state).set(user.headers);
    expect(recent.status).toBe(200);
    expect(recent.body.records.every(r => r.source !== 'seed_v1' && !r.is_sample)).toBe(true);
  });

  it('a REAL arrest row is searchable (and a stranger\'s takedown cannot hide it)', async () => {
    const caseNo = `${ctx.tag}-REAL-1`;
    const ins = await ctx.db.get(
      `INSERT INTO arrest_records (name, booking_date, charges, bail_amount, county, state, source, case_number, has_attorney, suppressed)
       VALUES (?, NOW(), 'Public intoxication', 1000, 'Davidson', 'TN', 'county_roster', ?, 0, 0) RETURNING id`,
      [`${ctx.tag} Real Person`, caseNo]);
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM arrest_takedown_log WHERE arrest_id = ?', [ins.id]);
      await db.run('DELETE FROM arrest_records WHERE case_number LIKE ?', [`${ctx.tag}%`]);
    });

    const res = await ctx.request().get('/api/arrests/search').query({ name: `${ctx.tag} Real` }).set(user.headers);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.records[0]).toMatchObject({ county: 'Davidson', state: 'TN', is_sample: false });

    // search requires auth and at least one filter
    expect((await ctx.request().get('/api/arrests/search').query({ name: 'x' })).status).toBe(401);
    expect((await ctx.request().get('/api/arrests/search').set(user.headers)).status).toBe(400);

    // a non-staff takedown request leaves the record visible (pending review)
    const td = await ctx.request().delete(`/api/alerts/record/${ins.id}`).set(user.headers)
      .send({ reason: 'This is me and the charge was dismissed.' });
    expect(td.status).toBe(202);
    const still = await ctx.request().get('/api/arrests/search').query({ name: `${ctx.tag} Real` }).set(user.headers);
    expect(still.body.total).toBe(1);
    expect(Number((await ctx.db.get('SELECT suppressed FROM arrest_records WHERE id = ?', [ins.id])).suppressed)).toBe(0);
  });
});
