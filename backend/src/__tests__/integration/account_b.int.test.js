/**
 * account_b.int.test.js — section B (sign-up, sign-in & account) regressions on
 * the real app + real Postgres:
 *
 *   1  register / login / lockout / rate-limit / validation answer in the
 *      request's language (they were English-only, some developer text such as
 *      "identifier must be a valid email or phone number")
 *   2  register saves the sign-up language on the profile; accountType
 *      'bail_agent' is stored and returned (the app sends each account type to
 *      its own home); attorney accounts say 'attorney'; unknown types are a 400
 *   3  DELETE /auth/account with a wrong password is a 403 (it was a 401, which
 *      made the app sign the person out); the right password deletes it
 *   4  forgot-password without an e-mail provider says so (503 for every
 *      address, it used to answer "sent" while nothing was sent); a phone
 *      number is a translated 400; the reset e-mail is written in the language
 *   5  logout revokes the refresh token and removes this device's push token
 *   6  Settings › Notifications › Arrest alerts off: no monitor-match push (it
 *      was sent regardless; the check-in reminder now filters on its switch too)
 */
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('section B: sign-up, sign-in & account (real Postgres)', () => {
  const ctx = initSuite();
  const req = () => ctx.request();
  beforeAll(() => { delete process.env.RESEND_API_KEY; });
  afterAll(() => { delete process.env.RESEND_API_KEY; });

  test('1 auth errors come in the request language', async () => {
    const r1 = await req().post('/api/auth/register').set('Accept-Language', 'es').send({ identifier: 'ana', password: 'CorrectHorse9!' });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toBe('Ingrese un correo electrónico o número de teléfono válido.');
    const r2 = await req().post('/api/auth/register?lang=vi').send({ identifier: 'ab', password: 'CorrectHorse9!' });
    expect(r2.status).toBe(400);
    expect(r2.body).toMatchObject({ error: 'Validation failed', message: 'Một số thông tin bạn nhập không hợp lệ. Vui lòng kiểm tra và thử lại.' });
    const u = await ctx.register();
    const dup = await req().post('/api/auth/register').set('Accept-Language', 'pt-BR').send({ identifier: u.email, password: 'CorrectHorse9!' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'already_registered', error: 'Já existe uma conta com este e-mail. Entre na sua conta.' });
    const bad = await req().post('/api/auth/login').set('Accept-Language', 'es').send({ identifier: u.email, password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(bad.body).toMatchObject({ code: 'invalid_credentials' });
    expect(bad.body.error).toMatch(/no coinciden/);
    await ctx.db.run('UPDATE users SET lock_until = ? WHERE id = ?', [new Date(Date.now() + 10 * 60_000).toISOString(), u.user.id]);
    const locked = await req().post('/api/auth/login?lang=pt').send({ identifier: u.email, password: 'CorrectHorse9!' });
    expect(locked.status).toBe(423);
    expect(locked.body.error).toMatch(/bloqueada por mais 10 minutos/);
  });

  test('2 profile language + account type on register; attorney / bail agent / unknown', async () => {
    const pt = await ctx.register({ accountType: 'bail_agent' });
    const row = await ctx.db.get('SELECT preferred_language, user_type, role FROM users WHERE id = ?', [pt.user.id]);
    expect(row).toMatchObject({ user_type: 'bail_agent', role: 'user' });
    expect(pt.user.accountType).toBe('bail_agent');
    const es = await req().post('/api/auth/register').set('Accept-Language', 'es-MX').send({ identifier: `${ctx.tag}-es@it.example.test`, password: 'CorrectHorse9!' });
    expect(es.status).toBe(201);
    expect(es.body.user).toMatchObject({ accountType: 'consumer', preferredLanguage: 'es' });
    const atty = await ctx.register({ accountType: 'attorney', barState: 'tn' });
    expect(atty.user).toMatchObject({ role: 'attorney', accountType: 'attorney' });
    const legacy = await ctx.register({ isAttorney: true });
    expect(legacy.user.accountType).toBe('attorney');
    const me = await req().get('/api/auth/me').set(pt.headers);
    expect(me.body.accountType).toBe('bail_agent');
    const login = await req().post('/api/auth/login').send({ identifier: atty.email, password: 'CorrectHorse9!' });
    expect(login.body.user.accountType).toBe('attorney');
    const nope = await req().post('/api/auth/register').send({ identifier: `${ctx.tag}-x@it.example.test`, password: 'CorrectHorse9!', accountType: 'admin' });
    expect(nope.status).toBe(400);
    await ctx.db.run('DELETE FROM users WHERE email = ?', [`${ctx.tag}-es@it.example.test`]);
  });

  test('3 delete account: wrong password is 403 (session stays valid), right password deletes', async () => {
    const u = await ctx.register();
    const wrong = await req().delete('/api/auth/account').set({ ...u.headers, 'Accept-Language': 'vi' }).send({ password: 'nope' });
    expect(wrong.status).toBe(403);
    expect(wrong.body).toEqual({ error: 'Mật khẩu không đúng.', code: 'incorrect_password' });
    expect((await req().get('/api/auth/me').set(u.headers)).status).toBe(200);
    const ok = await req().delete('/api/auth/account').set(u.headers).send({ password: 'CorrectHorse9!' });
    expect(ok.status).toBe(200);
    expect(await ctx.db.get('SELECT id FROM users WHERE id = ?', [u.user.id])).toBeFalsy();
  });

  test('4 forgot-password: honest without e-mail; phone → 400; reset mail in the language', async () => {
    const u = await ctx.register();
    const off = await req().post('/api/auth/forgot-password').set('Accept-Language', 'es').send({ email: u.email });
    const offUnknown = await req().post('/api/auth/forgot-password').set('Accept-Language', 'es').send({ email: 'nobody@it.example.test' });
    expect(off.status).toBe(503);
    expect(offUnknown.status).toBe(503);              // same answer: no account enumeration
    expect(off.body).toEqual(offUnknown.body);
    expect(off.body.code).toBe('email_unavailable');
    expect(off.body.error).toMatch(/support@justicegavel\.app/);
    const phone = await req().post('/api/auth/forgot-password?lang=pt').send({ email: '6155550100' });
    expect(phone.status).toBe(400);
    expect(phone.body).toEqual({ error: 'Digite um e-mail válido.', code: 'email_invalid' });

  });

  test('4b the reset e-mail text follows the language', async () => {
    const { sendPasswordReset } = await import('../../services/email.js');
    const r = await sendPasswordReset('x@it.example.test', 'https://justicegavel.app/reset-password?token=abc', 'es');
    expect(r).toMatchObject({ mock: true, subject: 'Restablezca su contraseña de Justice Gavel' });
  });

  test('4c reset-password: bad token translated; a real token works once and signs out other sessions', async () => {
    const u = await ctx.register();
    const bad = await req().post('/api/auth/reset-password').set('Accept-Language', 'es').send({ token: 'nope', password: 'NewPassword7!' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_reset_token');
    expect(bad.body.error).toMatch(/no es válido o ya venció/);
    const token = crypto.randomBytes(32).toString('hex');
    await ctx.db.run("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, NOW() + INTERVAL '1 hour')", [u.user.id, crypto.createHash('sha256').update(token).digest('hex')]);
    const ok = await req().post('/api/auth/reset-password').send({ token, password: 'NewPassword7!' });
    expect(ok.status).toBe(200);
    expect((await req().post('/api/auth/refresh').send({ refreshToken: u.refreshToken })).status).toBe(401);
    expect((await req().post('/api/auth/login').send({ identifier: u.email, password: 'NewPassword7!' })).status).toBe(200);
    expect((await req().post('/api/auth/reset-password').send({ token, password: 'Another7!!' })).status).toBe(400);
  });

  test('5 logout revokes the refresh token and this device\'s push token', async () => {
    const u = await ctx.register();
    await req().post('/api/push/token').set(u.headers).send({ token: 'ExponentPushToken[b-logout]' });
    const out = await req().post('/api/auth/logout').set({ ...u.headers, 'Accept-Language': 'es' })
      .send({ refreshToken: u.refreshToken, pushToken: 'ExponentPushToken[b-logout]' });
    expect(out.status).toBe(200);
    expect(out.body.message).toBe('Cerró sesión.');
    expect((await req().post('/api/auth/refresh').send({ refreshToken: u.refreshToken })).status).toBe(401);
    expect(await ctx.db.get('SELECT token FROM push_tokens WHERE user_id = ?', [u.user.id])).toBeFalsy();
  });

  test('6 Settings › Arrest alerts off: a monitor match is not pushed to that person (on: it is)', async () => {
    const received = [];
    const expo = http.createServer((rq, rs) => {
      let d = ''; rq.on('data', c => { d += c; });
      rq.on('end', () => {
        const msgs = JSON.parse(d || '[]'); received.push(...msgs);
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ data: msgs.map((_, k) => ({ status: 'ok', id: `t${k}` })) }));
      });
    });
    await new Promise(r => expo.listen(0, '127.0.0.1', r));
    const prevExpo = process.env.EXPO_PUSH_API_URL;
    process.env.EXPO_PUSH_API_URL = `http://127.0.0.1:${expo.address().port}/--/api/v2`;
    const off = await ctx.register(); const on = await ctx.register();
    const name = `${ctx.tag} Watched Person`;
    try {
      for (const [u, tok] of [[off, 'ExponentPushToken[b-off]'], [on, 'ExponentPushToken[b-on]']]) {
        await req().post('/api/push/token').set(u.headers).send({ token: tok });
        await ctx.db.run('INSERT INTO arrest_monitors (user_id, watch_name, name, state, active) VALUES (?, ?, ?, ?, 1)', [u.user.id, name, name, 'TN']);
      }
      expect((await req().post('/api/push/preferences').set(off.headers).send({ notif_arrest_alerts: 0 })).status).toBe(200);
      await ctx.db.run(
        `INSERT INTO arrest_records (name, booking_date, charges, bail_amount, county, state, source, case_number, has_attorney, suppressed)
         VALUES (?, NOW(), 'Trespassing', 500, 'Davidson', 'TN', 'county_roster', ?, 0, 0)`, [name, `${ctx.tag}-B6`]);
      const { sendArrestAlerts } = await import('../../services/arrest_alerts.js');
      await sendArrestAlerts();
      const tokens = received.map(m => m.to);
      expect(tokens).toContain('ExponentPushToken[b-on]');
      expect(tokens).not.toContain('ExponentPushToken[b-off]');
      const checkins = fs.readFileSync(new URL('../../routes/checkins.js', import.meta.url), 'utf8');
      expect(checkins).toMatch(/COALESCE\(u\.notif_checkin_reminders, 1\) = 1/);
    } finally {
      process.env.EXPO_PUSH_API_URL = prevExpo || '';
      if (!prevExpo) delete process.env.EXPO_PUSH_API_URL;
      await new Promise(r => expo.close(r));
      await ctx.db.run('DELETE FROM arrest_monitors WHERE watch_name = ?', [name]);
      await ctx.db.run('DELETE FROM arrest_records WHERE case_number = ?', [`${ctx.tag}-B6`]);
    }
  });
});
