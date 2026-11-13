/**
 * auth_password_policy.int.test.js — sandbox review 2026-11-12, bug 3.
 *
 * The old Quick Sign Up used a 4-digit PIN typed twice as the password, and a
 * flat 10-failure lock let anyone lock an account they knew the phone number of.
 *   • weak passwords are refused at sign-up, reset and change
 *   • an old doubled-PIN account signs in with password_change_required and can
 *     change its password
 *   • failures from one address lock only that address; the owner elsewhere
 *     still signs in
 */
import bcrypt from 'bcryptjs';
import { describeIntegration, initSuite } from './_harness.js';
import { passwordProblem } from '../../utils/passwordPolicy.js';

describe('passwordProblem', () => {
  it.each([
    ['12341234', 'weak'], ['00000000', 'weak'], ['12345678', 'weak'], ['98765432', 'weak'],
    ['password', 'weak'], ['Password1', 'weak'], ['aaaaaaaa', 'weak'], ['short', 'short'], ['', 'short'],
  ])('%s → %s', (pw, why) => expect(passwordProblem(pw)).toBe(why));
  it.each(['CorrectHorse9!', 'my court date is monday', '4821-blue-ferry'])('%s is fine', (pw) => {
    expect(passwordProblem(pw)).toBeNull();
  });
});

describeIntegration('password policy and login lock-out (real Postgres)', () => {
  const ctx = initSuite();
  const post = (path, body, ip, headers = {}) => {
    let r = ctx.request().post(path).send(body);
    if (ip) r = r.set('X-Forwarded-For', ip);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return r;
  };

  it('sign-up refuses a doubled PIN and common passwords with password_weak wording', async () => {
    for (const pw of ['12341234', 'password', '11111111']) {
      const r = await post('/api/auth/register', { identifier: `${ctx.tag}-weak-${pw}@it.example.test`, password: pw });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/too easy to guess/);
    }
  });

  it('an old doubled-PIN account signs in, is told to change it, and can', async () => {
    const u = await ctx.register();
    await ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash('48214821', 4), u.user.id]);

    const login = await post('/api/auth/login', { identifier: u.email, password: '48214821' });
    expect(login.status).toBe(200);
    expect(login.body.password_change_required).toBe(true);
    const H = { Authorization: `Bearer ${login.body.token}` };

    expect((await post('/api/auth/change-password', { currentPassword: '48214821', newPassword: '99999999' }, null, H)).status).toBe(400);
    expect((await post('/api/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'Ferry-4821-blue' }, null, H)).status).toBe(401);
    expect((await ctx.request().post('/api/auth/change-password').send({ currentPassword: '48214821', newPassword: 'Ferry-4821-blue' })).status).toBe(401);

    const ok = await post('/api/auth/change-password', { currentPassword: '48214821', newPassword: 'Ferry-4821-blue' }, null, H);
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe('string');

    const again = await post('/api/auth/login', { identifier: u.email, password: 'Ferry-4821-blue' });
    expect(again.status).toBe(200);
    expect(again.body.password_change_required).toBeUndefined();
    expect((await post('/api/auth/login', { identifier: u.email, password: '48214821' })).status).toBe(401);
  });

  it('ten failures from one address lock that address only; the owner elsewhere signs in', async () => {
    const u = await ctx.register();
    const attacker = '203.0.113.7', owner = '198.51.100.20';
    for (let i = 0; i < 10; i++) {
      expect((await post('/api/auth/login', { identifier: u.email, password: `Wrong-guess-${i}` }, attacker)).status).toBe(401);
    }
    const locked = await post('/api/auth/login', { identifier: u.email, password: u.password }, attacker);
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('account_locked');

    const fromOwner = await post('/api/auth/login', { identifier: u.email, password: u.password }, owner);
    expect(fromOwner.status).toBe(200);
  });
});
