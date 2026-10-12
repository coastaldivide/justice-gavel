/**
 * providers.int.test.js — /api/providers lawyer + bail-agent search against
 * the real seeded directory (read-only: verified rows are never modified).
 * Covers the three search paths the app uses (GPS, city/state, fallback),
 * the single-profile endpoint, nearest-city, and input validation.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('providers routes (real Postgres, read-only on directory data)', () => {
  const ctx = initSuite();

  it('GPS lawyer search returns distance-sorted results with the fields LawyersScreen renders', async () => {
    // Nashville, TN — seed data has lawyers with coordinates here
    const res = await ctx.request().get('/api/providers/lawyers?lat=36.1627&lng=-86.7816&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    const first = res.body[0];
    // shape contract used by frontend formatters
    expect(first).toEqual(expect.objectContaining({
      id: expect.anything(), name: expect.any(String), city: expect.any(String),
      specialties: expect.any(Array), languages: expect.any(Array),
    }));
    expect(typeof first.distanceKm).toBe('number');
    expect(typeof first.distanceMi).toBe('number');
    expect(typeof first.verified).toBe('boolean');
    expect(typeof first.golden_gavel).toBe('boolean');
  });

  it('city/state search stays inside the requested city', async () => {
    const res = await ctx.request().get('/api/providers/lawyers?city=Nashville&state=TN&limit=25');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const l of res.body) expect(l.city.toLowerCase()).toBe('nashville');
    // "City, ST" combined form parses the same way
    const combined = await ctx.request().get(`/api/providers/lawyers?city=${encodeURIComponent('Nashville, TN')}&limit=5`);
    expect(combined.status).toBe(200);
    expect(combined.body.length).toBeGreaterThan(0);
  });

  it('no-filter fallback returns a rating-sorted list (guest access allowed)', async () => {
    const res = await ctx.request().get('/api/providers/lawyers?limit=5');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
  });

  it('GET /providers/lawyers/:id returns the full profile and 404/400 for bad ids', async () => {
    const list = await ctx.request().get('/api/providers/lawyers?city=Nashville&state=TN&limit=1');
    const id = list.body[0].id;
    const prof = await ctx.request().get(`/api/providers/lawyers/${id}`);
    expect(prof.status).toBe(200);
    expect(prof.body.id).toBe(id);
    expect(prof.body).toHaveProperty('reviews');
    expect((await ctx.request().get('/api/providers/lawyers/999999999')).status).toBe(404);
    expect((await ctx.request().get('/api/providers/lawyers/abc')).status).toBe(400);
  });

  it('bail-agent GPS search returns nearby agents with the BailSearch fields', async () => {
    const res = await ctx.request().get('/api/providers/bail?lat=36.1627&lng=-86.7816&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);   // auto-expands to MIN_RESULTS
    const a = res.body[0];
    expect(a).toEqual(expect.objectContaining({ id: expect.anything(), name: expect.any(String), phone: expect.anything() }));
    expect(typeof a.available_24_7).toBe('boolean');
    expect(typeof a.payment_plans).toBe('boolean');
    // sorted by distance
    const dists = res.body.map(x => x.distanceKm);
    expect([...dists].sort((x, y) => x - y)).toEqual(dists);
  });

  it('bail-agent city search filters by city/state', async () => {
    const res = await ctx.request().get(`/api/providers/bail?city=${encodeURIComponent('Washington, DC')}&limit=50`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const a of res.body) expect(a.city.toLowerCase()).toBe('washington');
  });

  it('nearest-city resolves GPS to a covered city and validates input', async () => {
    const res = await ctx.request().get('/api/providers/nearest-city?lat=36.16&lng=-86.78');
    expect(res.status).toBe(200);
    expect(typeof res.body.city).toBe('string');
    expect(typeof res.body.distanceKm).toBe('number');
    expect((await ctx.request().get('/api/providers/nearest-city')).status).toBe(400);
    expect((await ctx.request().get('/api/providers/nearest-city?lat=abc&lng=def')).status).toBe(400);
  });
});
