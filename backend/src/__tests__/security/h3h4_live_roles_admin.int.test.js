/**
 * audit11 H3 — authorization uses the CURRENT database role/status, not the
 * role baked into a 30-day token. A demoted / banned / deleted account loses
 * access within the 60 s principal cache (immediately on the instance that
 * makes the change, via invalidateUserCache). Fails closed when the DB is down.
 *
 * audit11 H4 — /api/admin/lawyers and /api/admin/bail work (READ paths; the
 * verified rows are never modified here — checksum-verified).
 */
import { jest } from '@jest/globals';
import { describeIntegration, initSecuritySuite, providerChecksum } from './_world.js';

const ADMIN_KEY = 'test-admin-key-0123456789abcdef';

describeIntegration('H3/H4 — live roles and the provider admin console', () => {
  const ctx = initSecuritySuite();
  let admin, user, attorney, before, invalidateUserCache;

  beforeAll(async () => {
    if (!ctx.app) return;
    process.env.ADMIN_KEY = ADMIN_KEY;
    ({ invalidateUserCache } = await import('../../middleware/auth.js'));
    before   = await providerChecksum(ctx.db);
    admin    = await ctx.persona('Admin');
    user     = await ctx.persona('Plain');
    attorney = await ctx.persona('PendingAtty', { attorney: true });
    // promote AFTER the token was issued: the token still says role=user
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.id]);
    invalidateUserCache(admin.id);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  const adminGet = (who, path) => ctx.request().get(path).set(who.headers).set('X-Admin-Key', ADMIN_KEY);

  it('H3: a promotion takes effect from the DB even though the token says "user"', async () => {
    expect((await adminGet(admin, '/api/admin/stats')).status).toBe(200);
    expect((await ctx.request().get('/api/attorney/pending-verification').set(admin.headers)).status).toBe(200);
  });

  it('H3 ATTACK: after demotion the OLD token is refused (immediately after invalidation)', async () => {
    await ctx.db.run(`UPDATE users SET role = 'user' WHERE id = ?`, [admin.id]);
    invalidateUserCache(admin.id);
    expect((await adminGet(admin, '/api/admin/stats')).status).toBe(403);
    const pv = await ctx.request().get('/api/attorney/pending-verification').set(admin.headers);
    expect(pv.status).toBe(403);
    expect(JSON.stringify(pv.body)).not.toContain(attorney.email);
    // restore for the next tests
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.id]);
    invalidateUserCache(admin.id);
  });

  it('H3 ATTACK: without explicit invalidation, demotion bites once the 60 s cache expires', async () => {
    expect((await adminGet(admin, '/api/admin/stats')).status).toBe(200);           // cached as admin
    await ctx.db.run(`UPDATE users SET role = 'user' WHERE id = ?`, [admin.id]);     // e.g. changed by another instance
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => realNow + 61_000);
    expect((await adminGet(admin, '/api/admin/stats')).status).toBe(403);
    jest.restoreAllMocks();
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.id]);
    invalidateUserCache(admin.id);
  });

  it('H3 ATTACK: banned and deleted accounts lose access', async () => {
    const victim = await ctx.persona('ToBan');
    expect((await ctx.request().get('/api/auth/me').set(victim.headers)).status).toBe(200);
    await ctx.db.run(`UPDATE users SET account_status = 'banned' WHERE id = ?`, [victim.id]);
    invalidateUserCache(victim.id);
    const r = await ctx.request().get('/api/auth/me').set(victim.headers);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('account_disabled');

    const gone = await ctx.persona('ToDelete');
    await ctx.db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [gone.id]);
    await ctx.db.run('DELETE FROM users WHERE id = ?', [gone.id]);
    invalidateUserCache(gone.id);
    expect((await ctx.request().get('/api/cases').set(gone.headers)).status).toBe(401);
  });

  it('H3: role claims in a token are ignored — a forged "super_admin" claim in a validly signed token grants nothing', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ id: user.id, role: 'super_admin', firm_role: 'firm_admin' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    expect((await ctx.request().get('/api/billing/admin/stats').set('Authorization', `Bearer ${forged}`)).status).toBe(403);
  });

  it('L2: authentication fails CLOSED when the database is unreachable', async () => {
    const { getDb } = await import('../../db/index.js');
    const db = await getDb();
    invalidateUserCache(user.id);
    const spy = jest.spyOn(db, 'get').mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
    const r = await ctx.request().get('/api/cases').set(user.headers);
    spy.mockRestore();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('auth_unavailable');
    expect((await ctx.request().get('/api/cases').set(user.headers)).status).toBe(200);
  });

  it('LEGIT: the mobile refresh path still works and returns a usable token', async () => {
    const r = await ctx.request().post('/api/auth/refresh').set(user.headers).send({});
    expect(r.status).toBe(200);
    expect((await ctx.request().get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`)).status).toBe(200);
  });

  it('H4: /api/admin/lawyers and /api/admin/bail list and read (admin + key)', async () => {
    const l = await adminGet(admin, '/api/admin/lawyers?limit=5&active=all');
    expect(l.status).toBe(200);
    expect(l.body.rows.length).toBeGreaterThan(0);
    expect(Number(l.body.total)).toBeGreaterThan(0);
    const one = await adminGet(admin, `/api/admin/lawyers/${l.body.rows[0].id}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(l.body.rows[0].id);

    const b = await adminGet(admin, '/api/admin/bail?limit=5&active=all');
    expect(b.status).toBe(200);
    expect(b.body.rows.length).toBeGreaterThan(0);
    const bone = await adminGet(admin, `/api/admin/bail/${b.body.rows[0].id}`);
    expect(bone.status).toBe(200);

    // still guarded: no key → 401, non-admin → 403
    expect((await ctx.request().get('/api/admin/lawyers').set(admin.headers)).status).toBe(401);
    expect((await adminGet(user, '/api/admin/lawyers')).status).toBe(403);
  });

  it('verified lawyer / bail-agent rows are untouched by the whole suite', async () => {
    expect(await providerChecksum(ctx.db)).toEqual(before);
  });
});
