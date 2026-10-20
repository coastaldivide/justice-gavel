/**
 * auth.int.test.js — /api/auth against real Postgres through the real app.
 * Covers the calls the app makes: register, login, refresh (both forms),
 * me, update-profile, disclaimer accept/status, logout, delete account —
 * plus the negative paths (bad body → 4xx, wrong password, token reuse).
 */
import jwt from 'jsonwebtoken';
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('auth routes (real Postgres)', () => {
  const ctx = initSuite();

  it('register returns 201 with the token/refreshToken/user shape the app stores', async () => {
    const u = await ctx.register({ displayName: 'Reg Shape' });
    expect(typeof u.token).toBe('string');
    expect(typeof u.refreshToken).toBe('string');
    expect(u.user).toMatchObject({ displayName: 'Reg Shape', role: 'user', subscriptionTier: 'free', premium: false });
    expect(u.user.email).toBe(u.email);
    // DB assertions: user row + stored (hashed) refresh token
    const row = await ctx.db.get('SELECT email, role, password_hash FROM users WHERE id = ?', [u.user.id]);
    expect(row.email).toBe(u.email);
    expect(row.password_hash).not.toContain('CorrectHorse9!');
    const rt = await ctx.db.get('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ? AND used = 0', [u.user.id]);
    expect(Number(rt.n)).toBeGreaterThanOrEqual(1);
  });

  it('register rejects duplicates (409), bad identifiers and short passwords (400)', async () => {
    const u = await ctx.register();
    const dup = await ctx.request().post('/api/auth/register').send({ identifier: u.email, password: 'CorrectHorse9!' });
    expect(dup.status).toBe(409);
    expect((await ctx.request().post('/api/auth/register').send({ identifier: 'not-an-identifier', password: 'CorrectHorse9!' })).status).toBe(400);
    expect((await ctx.request().post('/api/auth/register').send({ identifier: `${ctx.tag}-short@it.example.test`, password: 'short' })).status).toBe(400);
    expect((await ctx.request().post('/api/auth/register').send({})).status).toBe(400);
  });

  it('login succeeds with the right password and 401s with the wrong one (no 5xx)', async () => {
    const u = await ctx.register();
    const ok = await ctx.request().post('/api/auth/login').send({ identifier: u.email, password: u.password });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(u.user.id);
    expect(typeof ok.body.token).toBe('string');

    const bad = await ctx.request().post('/api/auth/login').send({ identifier: u.email, password: 'WrongPass123!' });
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({ code: 'invalid_credentials' });
    expect(bad.body.error).toMatch(/do not match/);
    const unknown = await ctx.request().post('/api/auth/login').send({ identifier: `${ctx.tag}-ghost@it.example.test`, password: 'Whatever123!' });
    expect(unknown.status).toBe(401);
    // failed attempt is recorded in the DB
    const row = await ctx.db.get('SELECT failed_login_attempts FROM users WHERE id = ?', [u.user.id]);
    expect(Number(row.failed_login_attempts)).toBeGreaterThanOrEqual(1);
  });

  it('GET /auth/me requires auth and returns the public profile', async () => {
    const u = await ctx.register({ displayName: 'Me User' });
    expect((await ctx.request().get('/api/auth/me')).status).toBe(401);
    expect((await ctx.request().get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
    const me = await ctx.request().get('/api/auth/me').set(u.headers);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: u.user.id, displayName: 'Me User', role: 'user' });
    expect(me.body.password_hash).toBeUndefined();
  });

  it('refresh rotates the refresh token: old one is single-use, reuse revokes the session family', async () => {
    const u = await ctx.register();
    const r1 = await ctx.request().post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(r1.status).toBe(200);
    expect(typeof r1.body.token).toBe('string');
    expect(r1.body.refreshToken).not.toBe(u.refreshToken);

    // Reusing the rotated token must fail AND revoke outstanding tokens
    const reuse = await ctx.request().post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('token_reuse');
    const left = await ctx.db.get('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?', [u.user.id]);
    expect(Number(left.n)).toBe(0);
  });

  it('refresh also re-issues from a valid access token (mobile path) and 400s with neither', async () => {
    const u = await ctx.register();
    const viaAccess = await ctx.request().post('/api/auth/refresh').set(u.headers).send({});
    expect(viaAccess.status).toBe(200);
    expect(viaAccess.body.user.id).toBe(u.user.id);
    expect((await ctx.request().post('/api/auth/refresh').send({})).status).toBe(400);
    const garbage = await ctx.request().post('/api/auth/refresh').send({ refreshToken: 'garbage' });
    expect(garbage.status).toBe(401);
  });

  it('access tokens signed with the wrong secret are rejected (401, not 5xx)', async () => {
    const u = await ctx.register();
    const forged = jwt.sign({ id: u.user.id, role: 'admin' }, 'some-other-secret', { expiresIn: '1h' });
    const res = await ctx.request().get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_token');
  });

  it('update-profile updates display name and rejects invalid email/phone', async () => {
    const u = await ctx.register();
    const ok = await ctx.request().post('/api/auth/update-profile').set(u.headers).send({ displayName: 'New Name' });
    expect(ok.status).toBe(200);
    expect(ok.body.displayName).toBe('New Name');
    expect((await ctx.db.get('SELECT display_name FROM users WHERE id = ?', [u.user.id])).display_name).toBe('New Name');
    expect((await ctx.request().post('/api/auth/update-profile').set(u.headers).send({ email: 'nope' })).status).toBe(400);
    expect((await ctx.request().post('/api/auth/update-profile').set(u.headers).send({ phone: 'abc' })).status).toBe(400);
    expect((await ctx.request().post('/api/auth/update-profile').set(u.headers).send({})).status).toBe(400);
  });

  it('disclaimer status flips after acceptance and is recorded with a version', async () => {
    const u = await ctx.register();
    const before = await ctx.request().get('/api/auth/disclaimer/status').set(u.headers);
    expect(before.status).toBe(200);
    expect(before.body.required).toBe(true);
    expect(typeof before.body.version).toBe('string');

    const acc = await ctx.acceptDisclaimer(u);
    expect(acc.accepted).toBe(true);

    const after = await ctx.request().get('/api/auth/disclaimer/status').set(u.headers);
    expect(after.body.required).toBe(false);
    const row = await ctx.db.get('SELECT version FROM user_disclaimer_acceptance WHERE user_id = ?', [u.user.id]);
    expect(row.version).toBe(acc.version);
  });

  it('logout marks the presented refresh token used', async () => {
    const u = await ctx.register();
    const out = await ctx.request().post('/api/auth/logout').set(u.headers).send({ refreshToken: u.refreshToken });
    expect(out.status).toBe(200);
    const reuse = await ctx.request().post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('DELETE /auth/account needs the password and purges the user and their data', async () => {
    const u = await ctx.register();
    await ctx.request().post('/api/cases').set(u.headers).send({ title: `${ctx.tag} delete-me case` });
    expect((await ctx.request().delete('/api/auth/account').set(u.headers).send({})).status).toBe(400);
    // 403: a wrong password must not look like an expired session (the app would sign out)
    expect((await ctx.request().delete('/api/auth/account').set(u.headers).send({ password: 'Wrong123!' })).status).toBe(403);
    const del = await ctx.request().delete('/api/auth/account').set(u.headers).send({ password: u.password });
    expect(del.status).toBe(200);
    expect(await ctx.db.get('SELECT id FROM users WHERE id = ?', [u.user.id])).toBeUndefined();
    const cases = await ctx.db.get('SELECT COUNT(*) AS n FROM cases WHERE user_id = ?', [u.user.id]);
    expect(Number(cases.n)).toBe(0);
  });
});
