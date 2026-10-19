/**
 * GET /api/admin/diagnostics/client-ip on the REAL app + Postgres: only a
 * signed-in admin (role read live from the DB) who also sends X-Admin-Key gets
 * the report; everyone else gets the same 401/403 as every other /api/admin
 * route. The report reflects the request (X-Forwarded-For, trust proxy) and is
 * never cached.
 */
import { describeIntegration, initSecuritySuite } from './_world.js';

const ADMIN_KEY = 'test-admin-key-clientip-0123456789';
const PATH = '/api/admin/diagnostics/client-ip';

describeIntegration('admin client-IP diagnostics (TRUST_PROXY procedure)', () => {
  const ctx = initSecuritySuite();
  let admin, user, invalidateUserCache, savedKey;

  beforeAll(async () => {
    if (!ctx.app) return;
    savedKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = ADMIN_KEY;
    ({ invalidateUserCache } = await import('../../middleware/auth.js'));
    admin = await ctx.persona('IpAdmin');
    user  = await ctx.persona('IpPlain');
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.id]);
    invalidateUserCache(admin.id);
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = savedKey;
  });

  it('refuses: no token (401), no key (401), wrong key (401), non-admin with key (403)', async () => {
    expect((await ctx.request().get(PATH)).status).toBe(401);
    expect((await ctx.request().get(PATH).set('X-Admin-Key', ADMIN_KEY)).status).toBe(401);
    expect((await ctx.request().get(PATH).set(admin.headers)).status).toBe(401);
    expect((await ctx.request().get(PATH).set(admin.headers).set('X-Admin-Key', 'x'.repeat(ADMIN_KEY.length))).status).toBe(401);
    const plain = await ctx.request().get(PATH).set(user.headers).set('X-Admin-Key', ADMIN_KEY);
    expect(plain.status).toBe(403);
    expect(plain.body.ip).toBeUndefined();
  });

  it('admin + key: report shape, reflects X-Forwarded-For and the trust setting, no-store', async () => {
    const r = await ctx.request().get(PATH).set(admin.headers).set('X-Admin-Key', ADMIN_KEY)
      .set('X-Forwarded-For', '198.51.100.7, 203.0.113.20');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toMatch(/no-store/);
    expect(r.body).toMatchObject({
      x_forwarded_for: '198.51.100.7, 203.0.113.20',
      trust_proxy: { effective: 1 },
    });
    expect(r.body.ip).toBe('203.0.113.20');                     // default TRUST_PROXY = 1 hop
    expect(r.body.candidates.map(c => c.ip).slice(1)).toEqual(['203.0.113.20', '198.51.100.7']);
    expect(r.body.candidates[0]).toEqual({ trust_proxy: 0, ip: r.body.socket_remote_address });
    expect(Array.isArray(r.body.ips)).toBe(true);
  });

  it('a demoted admin loses access immediately (live DB role)', async () => {
    await ctx.db.run(`UPDATE users SET role = 'user' WHERE id = ?`, [admin.id]);
    invalidateUserCache(admin.id);
    expect((await ctx.request().get(PATH).set(admin.headers).set('X-Admin-Key', ADMIN_KEY)).status).toBe(403);
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.id]);
    invalidateUserCache(admin.id);
  });
});
