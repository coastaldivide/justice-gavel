/**
 * bail_legaldata_expungement.int.test.js — the reference-data endpoints the
 * app calls: bail calculator + schedules, /api/legaldata/:type, and the
 * expungement eligibility / attorneys / log-visit flow, on real Postgres.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('bail calculator, legaldata, expungement (real Postgres)', () => {
  const ctx = initSuite();

  let user;
  beforeAll(async () => {
    if (!ctx.app) return;
    user = await ctx.register({ displayName: 'Ref User' });
  });

  // ── bail ────────────────────────────────────────────────────────────────────
  it('POST /bail/calculate is gone (it multiplied invented amounts by invented percentages)', async () => {
    const res = await ctx.request().post('/api/bail/calculate').send({
      state: 'TN', charge_type: 'felony', severity: 'medium', prior_record: 'minor', flight_risk: 'low', employed: true,
    });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/recommended/);
  });

  it('GET /bail?state=TN returns schedule rows from the DB', async () => {
    const res = await ctx.request().get('/api/bail?state=TN');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const r of res.body.data) expect(['TN', 'ALL']).toContain(r.state);
  });

  // ── legaldata ───────────────────────────────────────────────────────────────
  it('GET /legaldata/:type returns state-filtered rows with the meta envelope', async () => {
    const res = await ctx.request().get('/api/legaldata/dui?state=TN').set(user.headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta).toMatchObject({ type: 'dui', state: 'TN', not_legal_advice: true });
    expect(typeof res.body.meta.disclaimer).toBe('string');
    for (const row of res.body.data) expect(['TN', 'ALL', 'FED']).toContain(String(row.state).toUpperCase());
  });

  it('legaldata covers every type the app requests', async () => {
    for (const type of ['bail', 'dui', 'drugs', 'sol', 'federal-courts', 'victim-comp', 'clinics', 'bar-complaints']) {
      const res = await ctx.request().get(`/api/legaldata/${type}`).set(user.headers);
      expect(`${type}:${res.status}`).toBe(`${type}:200`);
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  it('legaldata: unknown type 404 (table allowlist); public reference data readable without a token', async () => {
    expect((await ctx.request().get('/api/legaldata/users;drop').set(user.headers)).status).toBe(404);
    expect((await ctx.request().get('/api/legaldata/secrets')).status).toBe(404);
    const dui = await ctx.request().get('/api/legaldata/dui');   // guests use the DUI / drug penalty screens
    expect(dui.status).toBe(200);
    expect(dui.body.meta).toHaveProperty('disclaimer');
  });

  // ── expungement ─────────────────────────────────────────────────────────────
  it('GET /expungement/check classifies the charge and returns the eligibility card shape', async () => {
    const res = await ctx.request().get('/api/expungement/check?state=TN&charges=misdemeanor%20theft&status=Dismissed');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('TN');
    expect(res.body.eligibility).toEqual(expect.objectContaining({
      likely: expect.any(Boolean), conditional: expect.any(Boolean), notEligible: expect.any(Boolean),
    }));
    expect(res.body.disclaimer).toMatch(/not legal advice/i);
    // dismissed charges are expungeable ~everywhere
    expect(res.body.eligibility.likely || res.body.eligibility.conditional).toBe(true);
  });

  it('POST /expungement/eligibility computes wait dates per charge (auth required)', async () => {
    const res = await ctx.request().post('/api/expungement/eligibility').set(user.headers).send({
      state: 'TN',
      charges: [{ charge_type: 'misdemeanor', charge: 'shoplifting' }],
      conviction_date: '2020-01-15',
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.overall_eligible).toBe('boolean');
    expect(res.body.results).toHaveLength(1);
    const r = res.body.results[0];
    if (r.eligible && r.wait_years) {
      expect(r.wait_until_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.wait_days_remaining).toBeGreaterThanOrEqual(0);
    }
    expect((await ctx.request().post('/api/expungement/eligibility').set(user.headers).send({})).status).toBe(400);
    expect((await ctx.request().post('/api/expungement/eligibility').send({ state: 'TN' })).status).toBe(401);
  });

  it('GET /expungement/attorneys returns real directory attorneys for the state', async () => {
    const res = await ctx.request().get('/api/expungement/attorneys?state=TN&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.attorneys.length).toBeGreaterThan(0);
    expect(res.body.attorneys.length).toBeLessThanOrEqual(5);
    expect(res.body.attorneys[0]).toEqual(expect.objectContaining({ name: expect.any(String) }));
    expect(typeof res.body.matched).toBe('boolean');
  });

  it('POST /expungement/log-visit writes a check-log row for the nightly scheduler', async () => {
    const res = await ctx.request().post('/api/expungement/log-visit').set(user.headers).send({});
    expect(res.status).toBe(200);
    expect(res.body.logged).toBe(true);
    const row = await ctx.db.get(
      "SELECT COUNT(*) AS n FROM expungement_check_log WHERE user_id = ? AND source = 'screen_visit'", [user.user.id]);
    expect(Number(row.n)).toBe(1);
    expect((await ctx.request().post('/api/expungement/log-visit').send({})).status).toBe(401);
  });
});
