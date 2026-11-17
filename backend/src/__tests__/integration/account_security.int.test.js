/**
 * account_security.int.test.js — the second sandbox review (2026-11-17), every finding
 * replayed against the real app on real Postgres. Each test shows the attack (or bug) no
 * longer works AND the legitimate flow still does.
 *
 *  1  firm invitations need the e-mailed token (the invited address alone is not proof)
 *  2  a stolen session cannot move the account to another e-mail or phone
 *  3  a password change / reset / new e-mail / "sign out everywhere" ends every token
 *  4  the account lock is a rolling window that starts over; phone accounts can reset
 *  5  one account per phone number and sign-in identifier
 *  6  the free AI limit: rolling 24 h, one reservation at a time, refunds, no time-zone reset
 *  9  passwords: at most 72 bytes, a new one must differ, a change voids old reset links
 * (7, 8 and 10 are covered by court_reminder_times.test.js and the frontend suites.)
 *
 * E-mail (Resend) and texts (Telnyx) go to local mock servers; nothing leaves the machine.
 */
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { describeIntegration, initSuite } from './_harness.js';

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const PASSWORD = 'CorrectHorse9!';

function mockServer(handler) {
  const s = { received: [], server: null, url: '' };
  s.server = http.createServer((req, res) => {
    let d = ''; req.on('data', c => { d += c; });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(d); } catch { /* keep {} */ }
      s.received.push({ url: req.url, body: j });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handler(j, s.received.length)));
    });
  });
  return s;
}

describeIntegration('account security (sandbox review 2026-11-17)', () => {
  const resend = mockServer((_b, n) => ({ id: `em-${n}` }));
  const telnyx = mockServer((_b, n) => ({ data: { id: `sms-${n}` } }));
  const ENV = ['RESEND_API_KEY', 'RESEND_BASE_URL', 'TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'APP_URL'];
  beforeAll(async () => {
    await new Promise(r => resend.server.listen(0, '127.0.0.1', r));
    await new Promise(r => telnyx.server.listen(0, '127.0.0.1', r));
    Object.assign(process.env, {
      RESEND_API_KEY: 're_test', RESEND_BASE_URL: `http://127.0.0.1:${resend.server.address().port}`,
      TELNYX_API_KEY: 'KEY_sec', TELNYX_FROM_NUMBER: '+16155550100', TELNYX_API_BASE: `http://127.0.0.1:${telnyx.server.address().port}`,
      APP_URL: 'https://justicegavel.app',
    });
  });
  afterAll(async () => {
    for (const k of ENV) delete process.env[k];
    await new Promise(r => resend.server.close(r));
    await new Promise(r => telnyx.server.close(r));
  });

  const ctx = initSuite({ anthropicMock: true });
  const req = () => ctx.request();
  // Phone numbers unique to this run (the database is shared with the other suites).
  const n4 = () => String(crypto.randomInt(0, 10_000)).padStart(4, '0');
  const phone = () => `615${crypto.randomInt(200, 999)}${n4()}`;
  const mailsTo = (addr) => resend.received.filter(m => [].concat(m.body.to || []).includes(addr));
  const linkIn = (text, re) => (String(text || '').match(re) || [])[1];
  beforeAll(() => {
    ctx.addCleanup(async (db) => {
      await db.run(`DELETE FROM firm_invites WHERE email LIKE ?`, [`${ctx.tag}-%`]).catch(() => {});
      await db.run(`DELETE FROM chat_quota_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)`, [`${ctx.tag}-%`]).catch(() => {});
      await db.run(`DELETE FROM phone_verifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE ? OR login_identifier LIKE ?)`, [`${ctx.tag}-%`, '+1615%']).catch(() => {});
    });
  });
  const phoneUsers = [];
  afterAll(async () => {
    if (!ctx.db) return;
    for (const id of phoneUsers) {
      for (const t of ['refresh_tokens', 'password_resets', 'phone_verifications', 'chat_quota_log', 'audit_log']) {
        await ctx.db.run(`DELETE FROM ${t} WHERE user_id = ?`, [id]).catch(() => {});
      }
      await ctx.db.run('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
    }
  });
  const registerPhone = async (number) => {
    const r = await req().post('/api/auth/register').send({ identifier: number, password: PASSWORD });
    expect(r.status).toBe(201);
    phoneUsers.push(r.body.user.id);
    return { ...r.body, headers: { Authorization: `Bearer ${r.body.token}` } };
  };

  // ── 3 session version ─────────────────────────────────────────────────────
  describe('3 every old token stops working', () => {
    test('change-password: the old access AND refresh tokens are refused at once; the new pair works', async () => {
      const u = await ctx.register();
      const before = await req().get('/api/auth/me').set(u.headers);
      expect(before.status).toBe(200);                                     // fills the 60 s principal cache
      const ch = await req().post('/api/auth/change-password').set(u.headers).send({ currentPassword: PASSWORD, newPassword: 'BrandNewPass8#' });
      expect(ch.status).toBe(200);
      const old = await req().get('/api/auth/me').set(u.headers);
      expect(old.status).toBe(401);
      expect(old.body.code).toBe('session_revoked');
      const oldRefresh = await req().post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
      expect([oldRefresh.status, oldRefresh.body.code]).toEqual([401, 'session_revoked']);
      expect((await req().post('/api/auth/refresh').set(u.headers).send({})).body.code).toBe('session_revoked');   // access-token path
      // the old device refreshing did not sign out the session that changed the password (below)
      expect((await req().get('/api/auth/me').set({ Authorization: `Bearer ${ch.body.token}` })).status).toBe(200);
      const again = await req().post('/api/auth/refresh').send({ refreshToken: ch.body.refreshToken });
      expect(again.status).toBe(200);
    });

    test('reset-password ends every session, including access tokens', async () => {
      const u = await ctx.register();
      const token = crypto.randomBytes(32).toString('hex');
      await ctx.db.run("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, NOW() + INTERVAL '1 hour')", [u.user.id, sha256(token)]);
      expect((await req().post('/api/auth/reset-password').send({ token, password: 'ResetPass77!' })).status).toBe(200);
      const me = await req().get('/api/auth/me').set(u.headers);
      expect([me.status, me.body.code]).toEqual([401, 'session_revoked']);
      expect((await req().post('/api/auth/login').send({ identifier: u.email, password: 'ResetPass77!' })).status).toBe(200);
    });

    test('logout { allDevices } ends every session; a plain logout ends only this refresh token', async () => {
      const u = await ctx.register();
      const second = (await req().post('/api/auth/login').send({ identifier: u.email, password: PASSWORD })).body;
      const plain = await req().post('/api/auth/logout').set(u.headers).send({ refreshToken: u.refreshToken });
      expect(plain.status).toBe(200);
      // the signed-out device trying its refresh token is refused — and does NOT end the other session
      const stale = await req().post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
      expect([stale.status, stale.body.code]).toEqual([401, 'invalid_refresh']);
      expect((await req().get('/api/auth/me').set({ Authorization: `Bearer ${second.token}` })).status).toBe(200);
      const all = await req().post('/api/auth/logout').set({ Authorization: `Bearer ${second.token}` }).send({ allDevices: true });
      expect(all.status).toBe(200);
      expect((await req().get('/api/auth/me').set(u.headers)).status).toBe(401);
      expect((await req().get('/api/auth/me').set({ Authorization: `Bearer ${second.token}` })).status).toBe(401);
      expect((await req().post('/api/auth/refresh').send({ refreshToken: second.refreshToken })).status).toBe(401);
      const back = await req().post('/api/auth/login').send({ identifier: u.email, password: PASSWORD });
      expect(back.status).toBe(200);
      expect((await req().get('/api/auth/me').set({ Authorization: `Bearer ${back.body.token}` })).status).toBe(200);
    });

    test('a reused (already rotated) refresh token ends every session, access tokens included', async () => {
      const u = await ctx.register();
      const r1 = await req().post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
      expect(r1.status).toBe(200);
      const reuse = await req().post('/api/auth/refresh').send({ refreshToken: u.refreshToken });
      expect([reuse.status, reuse.body.code]).toEqual([401, 'token_reuse']);
      expect((await req().get('/api/auth/me').set({ Authorization: `Bearer ${r1.body.token}` })).status).toBe(401);
      expect((await req().post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
    });

    test('a token signed before migration 51 (no "tv") still works until the first bump', async () => {
      const u = await ctx.register();
      const jwt = (await import('jsonwebtoken')).default;
      const legacy = jwt.sign({ id: u.user.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
      expect((await req().get('/api/auth/me').set({ Authorization: `Bearer ${legacy}` })).status).toBe(200);
      await req().post('/api/auth/logout').set(u.headers).send({ allDevices: true });
      expect((await req().get('/api/auth/me').set({ Authorization: `Bearer ${legacy}` })).status).toBe(401);
    });
  });

  // ── 2 e-mail / phone changes ──────────────────────────────────────────────
  describe('2 a session alone cannot take the account', () => {
    test('a new e-mail needs the current password, is used only after the link, and the old address is told', async () => {
      const u = await ctx.register();
      const newAddr = `${ctx.tag}-moved@it.example.test`;
      const noPw = await req().post('/api/auth/update-profile').set(u.headers).send({ email: newAddr });
      expect([noPw.status, noPw.body.code]).toEqual([400, 'password_required']);
      const wrong = await req().post('/api/auth/update-profile').set(u.headers).send({ email: newAddr, currentPassword: 'nope-nope' });
      expect([wrong.status, wrong.body.code]).toEqual([403, 'incorrect_password']);      // 403: the app keeps the session
      const ok = await req().post('/api/auth/update-profile').set({ ...u.headers, 'Accept-Language': 'es' }).send({ email: newAddr, currentPassword: PASSWORD });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ email: u.email, email_pending: newAddr, pendingEmail: newAddr });
      expect(ok.body.message).toMatch(/Enviamos un enlace/);
      // nothing changed yet: still signs in with the old address only
      expect((await req().post('/api/auth/login').send({ identifier: newAddr, password: PASSWORD })).status).toBe(401);
      const confirmMail = mailsTo(newAddr).at(-1);
      expect(confirmMail.body.subject).toBe('Confirme su nuevo correo electrónico de Justice Gavel');
      const token = linkIn(confirmMail.body.html, /confirm-email\?token(?:=|&#61;)([0-9a-f]{64})/);
      expect(token).toBeTruthy();
      const notice = mailsTo(u.email).at(-1);
      expect(notice.body.subject).toMatch(/Se está cambiando el correo electrónico/);
      expect(notice.body.html).not.toContain(newAddr);                                       // the new address is partly hidden
      const row = await ctx.db.get('SELECT pending_email_token FROM users WHERE id = ?', [u.user.id]);
      expect(row.pending_email_token).toBe(sha256(token));                                   // only the hash is stored

      const bad = await req().post('/api/auth/confirm-email').send({ token: 'f'.repeat(64) });
      expect([bad.status, bad.body.code]).toEqual([400, 'invalid_email_token']);
      const done = await req().post('/api/auth/confirm-email').send({ token });
      expect(done.status).toBe(200);
      expect((await req().get('/api/auth/me').set(u.headers)).status).toBe(401);             // every session ended
      const login = await req().post('/api/auth/login').send({ identifier: newAddr, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.user.email).toBe(newAddr);
      expect((await req().post('/api/auth/login').send({ identifier: u.email, password: PASSWORD })).status).toBe(401);
      expect((await req().post('/api/auth/confirm-email').send({ token })).status).toBe(400);   // single use
    });

    test('an address another account uses is refused; a password reset cancels a pending change', async () => {
      const a = await ctx.register();
      const b = await ctx.register();
      const taken = await req().post('/api/auth/update-profile').set(a.headers).send({ email: b.email, currentPassword: PASSWORD });
      expect([taken.status, taken.body.code]).toEqual([409, 'in_use']);
      const target = `${ctx.tag}-pending@it.example.test`;
      expect((await req().post('/api/auth/update-profile').set(a.headers).send({ email: target, currentPassword: PASSWORD })).status).toBe(200);
      const token = linkIn(mailsTo(target).at(-1).body.html, /confirm-email\?token(?:=|&#61;)([0-9a-f]{64})/);
      const reset = crypto.randomBytes(32).toString('hex');
      await ctx.db.run("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, NOW() + INTERVAL '1 hour')", [a.user.id, sha256(reset)]);
      expect((await req().post('/api/auth/reset-password').send({ token: reset, password: 'OwnerAgain55!' })).status).toBe(200);
      expect((await req().post('/api/auth/confirm-email').send({ token })).status).toBe(400);
      expect((await ctx.db.get('SELECT email FROM users WHERE id = ?', [a.user.id])).email).toBe(a.email);
    });

    test('nor from the court-date text settings (the second agent\'s takeover: own number, then a texted reset)', async () => {
      const victim = await ctx.register();
      const attackerNumber = phone();
      const r = await req().put('/api/court-dates/preferences').set(victim.headers).send({ sms_reminders: true, phone: attackerNumber });
      expect([r.status, r.body.code]).toEqual([400, 'phone_needs_verification']);
      expect((await ctx.db.get('SELECT phone FROM users WHERE id = ?', [victim.user.id])).phone).toBeNull();
      const before = telnyx.received.length;
      const reset = await req().post('/api/auth/forgot-password').send({ identifier: attackerNumber });
      expect(reset.body).toEqual({ sent: true });                   // the same answer as always…
      expect(telnyx.received.length).toBe(before);                  // …but no link went to the attacker's number
      expect((await req().post('/api/auth/login').send({ identifier: victim.email, password: PASSWORD })).status).toBe(200);
    });

    test('a phone number cannot be set from update-profile; the same number again is not a change', async () => {
      const u = await ctx.register();
      const r = await req().post('/api/auth/update-profile').set(u.headers).send({ phone: phone() });
      expect([r.status, r.body.code]).toEqual([400, 'phone_needs_verification']);
      expect((await ctx.db.get('SELECT phone FROM users WHERE id = ?', [u.user.id])).phone).toBeNull();
      const name = await req().post('/api/auth/update-profile').set(u.headers).send({ displayName: 'Renamed Person' });
      expect(name.status).toBe(200);
      expect(name.body.displayName).toBe('Renamed Person');
    });
  });

  // ── 5 one account per number ──────────────────────────────────────────────
  describe('5 one account per phone number and sign-in identifier', () => {
    const lastCode = () => linkIn(telnyx.received.at(-1)?.body?.text, /(\d{6})/);
    test('a number another account signs in with cannot be verified by anyone else', async () => {
      const number = phone();
      const owner = await registerPhone(number);
      expect(owner.user.phone).toBe(`+1${number}`);
      const other = await ctx.register();
      const r = await req().post('/api/me/phone/verify').set(other.headers).send({ phone: number });
      expect([r.status, r.body.code]).toEqual([409, 'phone_in_use']);
      const dup = await req().post('/api/auth/register').send({ identifier: `(${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`, password: PASSWORD });
      expect([dup.status, dup.body.code]).toEqual([409, 'already_registered']);
    });

    test('a contact number moves to the account that proves it (recycled numbers); no two rows share it', async () => {
      const number = phone();
      const first = await ctx.register();
      expect((await req().post('/api/me/phone/verify').set(first.headers).send({ phone: number })).status).toBe(200);
      expect((await req().post('/api/me/phone/confirm').set(first.headers).send({ code: lastCode() })).status).toBe(200);
      // a minute later (one code a minute per number)
      await ctx.db.run(`UPDATE phone_verifications SET created_at = created_at - INTERVAL '2 minutes' WHERE phone = ?`, [`+1${number}`]);
      const second = await ctx.register();
      expect((await req().post('/api/me/phone/verify').set(second.headers).send({ phone: number })).status).toBe(200);
      expect((await req().post('/api/me/phone/confirm').set(second.headers).send({ code: lastCode() })).status).toBe(200);
      const rows = await ctx.db.all('SELECT id FROM users WHERE phone = ?', [`+1${number}`]);
      expect(rows.map(x => Number(x.id))).toEqual([second.user.id]);
    });

    test('the database refuses a second row with the same phone or sign-in identifier', async () => {
      const number = `+1${phone()}`;
      await ctx.db.run('INSERT INTO users (email, phone, login_identifier) VALUES (?, ?, ?)', [`${ctx.tag}-dup1@it.example.test`, number, `${ctx.tag}-dup1@it.example.test`]);
      await expect(ctx.db.run('INSERT INTO users (email, phone, login_identifier) VALUES (?, ?, ?)', [`${ctx.tag}-dup2@it.example.test`, number, `${ctx.tag}-dup2@it.example.test`]))
        .rejects.toMatchObject({ code: '23505' });
      await expect(ctx.db.run('INSERT INTO users (email, login_identifier) VALUES (?, ?)', [`${ctx.tag}-dup3@it.example.test`, `${ctx.tag}-DUP1@it.example.test`]))
        .rejects.toMatchObject({ code: '23505' });
    });

    test('migration 51 stops with the duplicate account ids instead of changing data', async () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const sql = fs.readFileSync(path.join(here, '../../../../supabase/migrations/00000000000051_account_security.sql'), 'utf8');
      const guard = sql.slice(sql.indexOf('DO $$'), sql.indexOf('$$;', sql.indexOf('DO $$')) + 3);
      const number = `+1${phone()}`;
      let message = '';
      await ctx.db.transaction(async (tx) => {
        await tx.run('DROP INDEX uq_users_phone');
        const a = await tx.get('INSERT INTO users (email, phone) VALUES (?, ?) RETURNING id', [`${ctx.tag}-m1@it.example.test`, number]);
        const b = await tx.get('INSERT INTO users (email, phone) VALUES (?, ?) RETURNING id', [`${ctx.tag}-m2@it.example.test`, number]);
        await tx.run('SAVEPOINT g');
        try { await tx.exec(guard); } catch (e) { message = e.message; }
        await tx.run('ROLLBACK TO SAVEPOINT g');
        expect(message).toContain('Migration 051 stopped');
        expect(message).toContain(`accounts ${a.id}, ${b.id}`);
        expect(message).toContain(`number ending ${number.slice(-4)}`);
        expect(message).not.toContain(number);                // the full number is not printed
        throw new Error('rollback');                          // undo the test rows and the dropped index
      }).catch((e) => { if (e.message !== 'rollback') throw e; });
      expect(await ctx.db.get(`SELECT 1 AS x FROM pg_indexes WHERE indexname = 'uq_users_phone'`)).toBeTruthy();
    });
  });

  // ── 4 lockout + phone reset ───────────────────────────────────────────────
  describe('4 the lock is a rolling window; phone accounts can reset', () => {
    test('after a lock runs out, one wrong password does not lock the account again', async () => {
      const { LOCKOUT } = await import('../../routes/auth.js');
      const u = await ctx.register();
      await ctx.db.run('UPDATE users SET failed_login_attempts = ?, failed_login_window_start = NOW() WHERE id = ?', [LOCKOUT.ACCOUNT_LOCK_THRESHOLD - 1, u.user.id]);
      await req().post('/api/auth/login').set('X-Forwarded-For', '203.0.113.10').send({ identifier: u.email, password: 'wrong-1' });
      const locked = await req().post('/api/auth/login').set('X-Forwarded-For', '203.0.113.11').send({ identifier: u.email, password: PASSWORD });
      expect(locked.status).toBe(423);
      let row = await ctx.db.get('SELECT failed_login_attempts, failed_login_window_start FROM users WHERE id = ?', [u.user.id]);
      expect(Number(row.failed_login_attempts)).toBe(0);           // the count starts over with the lock
      // the lock runs out
      await ctx.db.run(`UPDATE users SET lock_until = ? WHERE id = ?`, [new Date(Date.now() - 1000).toISOString(), u.user.id]);
      const once = await req().post('/api/auth/login').set('X-Forwarded-For', '203.0.113.12').send({ identifier: u.email, password: 'wrong-2' });
      expect(once.status).toBe(401);                                // a wrong password, not a new lock
      row = await ctx.db.get('SELECT failed_login_attempts FROM users WHERE id = ?', [u.user.id]);
      expect(Number(row.failed_login_attempts)).toBe(1);
      expect((await req().post('/api/auth/login').set('X-Forwarded-For', '203.0.113.13').send({ identifier: u.email, password: PASSWORD })).status).toBe(200);
    });

    test('failures older than the window do not add up', async () => {
      const { LOCKOUT } = await import('../../routes/auth.js');
      const u = await ctx.register();
      await ctx.db.run(`UPDATE users SET failed_login_attempts = ?, failed_login_window_start = NOW() - INTERVAL '20 minutes' WHERE id = ?`, [LOCKOUT.ACCOUNT_LOCK_THRESHOLD - 1, u.user.id]);
      const r = await req().post('/api/auth/login').set('X-Forwarded-For', '203.0.113.20').send({ identifier: u.email, password: 'wrong' });
      expect(r.status).toBe(401);
      const row = await ctx.db.get('SELECT failed_login_attempts, lock_until FROM users WHERE id = ?', [u.user.id]);
      expect([Number(row.failed_login_attempts), row.lock_until]).toEqual([1, null]);
    });

    test('forgot password with a phone number texts the link (and answers the same for unknown numbers)', async () => {
      const number = phone();
      const u = await registerPhone(number);
      const before = telnyx.received.length;
      const r = await req().post('/api/auth/forgot-password').set('Accept-Language', 'es').send({ identifier: number });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ sent: true });
      const sms = telnyx.received.slice(before);
      expect(sms).toHaveLength(1);
      expect(sms[0].body.to).toBe(`+1${number}`);
      expect(sms[0].body.text).toMatch(/^Justice Gavel: para elegir una nueva contraseña/);
      const token = linkIn(sms[0].body.text, /reset-password\?token=([0-9a-f]{64})/);
      const unknown = await req().post('/api/auth/forgot-password').send({ identifier: phone() });
      expect(unknown.body).toEqual({ sent: true });
      expect(telnyx.received.length).toBe(before + 1);              // nothing texted for an unknown number
      // a second request within a minute sends nothing more
      await req().post('/api/auth/forgot-password').send({ identifier: number });
      expect(telnyx.received.length).toBe(before + 1);
      expect((await req().post('/api/auth/reset-password').send({ token, password: 'TextedReset66!' })).status).toBe(200);
      expect((await req().get('/api/auth/me').set(u.headers)).status).toBe(401);
      expect((await req().post('/api/auth/login').send({ identifier: number, password: 'TextedReset66!' })).status).toBe(200);
    });

    test('without Telnyx a phone reset says so (503 for every number); a bad address is a 400', async () => {
      const keep = process.env.TELNYX_API_KEY;
      delete process.env.TELNYX_API_KEY;
      try {
        const r = await req().post('/api/auth/forgot-password?lang=pt').send({ identifier: phone() });
        expect([r.status, r.body.code]).toEqual([503, 'sms_unavailable']);
        expect(r.body.error).toMatch(/SMS ainda não está disponível/);
      } finally { process.env.TELNYX_API_KEY = keep; }
      const bad = await req().post('/api/auth/forgot-password?lang=pt').send({ email: 'ana@' });
      expect([bad.status, bad.body.code]).toEqual([400, 'email_invalid']);
    });
  });

  // ── 9 password rules ──────────────────────────────────────────────────────
  describe('9 password rules', () => {
    test('more than 72 bytes is refused (bcrypt would ignore the rest); 72 ASCII characters are fine', async () => {
      const long = await req().post('/api/auth/register?lang=es').send({ identifier: `${ctx.tag}-long@it.example.test`, password: 'Aa1!' + 'x'.repeat(69) });
      expect([long.status, long.body.error]).toEqual([400, expect.stringMatching(/demasiado larga/)]);
      const accents = await req().post('/api/auth/register').send({ identifier: `${ctx.tag}-acc@it.example.test`, password: 'é'.repeat(37) });   // 37 chars, 74 bytes
      expect(accents.status).toBe(400);
      const max = await req().post('/api/auth/register').send({ identifier: `${ctx.tag}-max@it.example.test`, password: 'Aa1!' + 'y'.repeat(68) });
      expect(max.status).toBe(201);
      await ctx.db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [max.body.user.id]);
      await ctx.db.run('DELETE FROM users WHERE id = ?', [max.body.user.id]);
    });

    test('the new password must differ; a wrong current one is a 403 (the session stays); old reset links stop working', async () => {
      const u = await ctx.register();
      const same = await req().post('/api/auth/change-password').set(u.headers).send({ currentPassword: PASSWORD, newPassword: PASSWORD });
      expect([same.status, same.body.code]).toEqual([400, 'password_same']);
      const wrong = await req().post('/api/auth/change-password').set(u.headers).send({ currentPassword: 'not-it-123', newPassword: 'Different99!' });
      expect([wrong.status, wrong.body.code]).toEqual([403, 'incorrect_password']);
      expect((await req().get('/api/auth/me').set(u.headers)).status).toBe(200);
      const reset = crypto.randomBytes(32).toString('hex');
      await ctx.db.run("INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, NOW() + INTERVAL '1 hour')", [u.user.id, sha256(reset)]);
      expect((await req().post('/api/auth/change-password').set(u.headers).send({ currentPassword: PASSWORD, newPassword: 'Different99!' })).status).toBe(200);
      expect((await req().post('/api/auth/reset-password').send({ token: reset, password: 'Hijacked99!' })).status).toBe(400);
    });
  });

  // ── 1 firm invitations ────────────────────────────────────────────────────
  describe('1 firm invitations need the e-mailed token', () => {
    let admin, inviteToken, invitedEmail;
    beforeAll(async () => {
      if (!ctx.app) return;
      admin = await ctx.register({ accountType: 'attorney' });
      const trial = await req().post('/api/firm-acquisition/trial').set(admin.headers).send({ firm_name: `Firm ${ctx.tag}`, vertical: 'criminal_defense' });
      expect(trial.status).toBeLessThan(300);
      invitedEmail = `${ctx.tag}-invitee@it.example.test`;
      const inv = await req().post('/api/firm-acquisition/invite').set(admin.headers).send({ email: invitedEmail, role: 'partner' });
      expect(inv.status).toBe(201);
      expect(inv.body).toMatchObject({ email_status: 'sent' });
      expect(inv.body.link).toBeUndefined();                         // e-mailed: the admin is not handed the link
      inviteToken = linkIn(mailsTo(invitedEmail).at(-1).body.text, /firm\/join\/([A-Za-z0-9_-]{40,60})/);
      expect(inviteToken).toBeTruthy();
      ctx.addCleanup(async (db) => {
        const f = await db.get('SELECT firm_id FROM firm_members WHERE user_id = ?', [admin.user.id]);
        if (f) {
          await db.run('DELETE FROM firm_invites WHERE firm_id = ?', [f.firm_id]);
          await db.run('DELETE FROM audit_log WHERE firm_id = ?', [f.firm_id]).catch(() => {});
          await db.run('DELETE FROM firm_members WHERE firm_id = ?', [f.firm_id]);
          await db.run('DELETE FROM firms WHERE id = ?', [f.firm_id]).catch(() => {});
        }
      });
    });

    test('only a hash is stored; the in-app list no longer shows invitations by e-mail', async () => {
      const row = await ctx.db.get('SELECT id, token FROM firm_invites WHERE email = ?', [invitedEmail]);
      expect(row.token).toBe(sha256(inviteToken));
      const squatter = await ctx.register({ identifier: invitedEmail });     // signs up with the invited address
      expect((await req().get('/api/firm-acquisition/invites').set(squatter.headers)).body.invites).toEqual([]);
      const noToken = await req().post(`/api/firm-acquisition/invites/${row.id}/accept`).set(squatter.headers).send({});
      expect([noToken.status, noToken.body.code]).toEqual([400, 'invite_token_required']);
      const guess = await req().post('/api/firm-acquisition/invite/accept').set(squatter.headers).send({ token: 'A'.repeat(43) });
      expect(guess.status).toBe(404);
      expect(await ctx.db.get('SELECT 1 AS x FROM firm_members WHERE user_id = ?', [squatter.user.id])).toBeFalsy();
      await ctx.db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [squatter.user.id]);
      await ctx.db.run('DELETE FROM users WHERE id = ?', [squatter.user.id]);
    });

    test('the token in someone else\'s account is refused; the invited address with the token joins, once', async () => {
      const outsider = await ctx.register();
      const preview = await req().get(`/api/firm-acquisition/invite/${inviteToken}`).set(outsider.headers);
      expect(preview.body).toMatchObject({ firm: `Firm ${ctx.tag}`, role: 'partner', email_matches: false });
      const other = await req().post('/api/firm-acquisition/invite/accept').set(outsider.headers).send({ token: inviteToken });
      expect([other.status, other.body.code]).toEqual([403, 'invite_other_email']);
      const invitee = await ctx.register({ identifier: invitedEmail });
      const ok = await req().post('/api/firm-acquisition/invite/accept').set(invitee.headers).send({ token: inviteToken });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ joined: true, role: 'partner', firm: `Firm ${ctx.tag}` });
      expect((await req().post('/api/firm-acquisition/invite/accept').set(invitee.headers).send({ token: inviteToken })).status).toBe(404);
    });

    test('the firm workspace routes use the same hashed, e-mailed token (second agent pass)', async () => {
      const f = await ctx.db.get('SELECT firm_id FROM firm_members WHERE user_id = ?', [admin.user.id]);
      const addr = `${ctx.tag}-ws@it.example.test`;
      const inv = await req().post(`/api/firms/${f.firm_id}/members/invite`).set(admin.headers).send({ email: addr.toUpperCase(), role: 'paralegal' });
      expect(inv.status).toBe(201);
      expect(inv.body).toMatchObject({ email: addr, email_status: 'sent' });
      expect(inv.body.token).toBeUndefined();                       // e-mailed: not handed to the admin
      const token = linkIn(mailsTo(addr).at(-1).body.text, /firm\/join\/([A-Za-z0-9_-]{40,60})/);
      expect((await ctx.db.get('SELECT token FROM firm_invites WHERE email = ? AND firm_id = ?', [addr, f.firm_id])).token).toBe(sha256(token));
      const other = await ctx.register();
      expect((await req().post('/api/firms/accept-invite').set(other.headers).send({ token })).status).toBe(403);
      expect((await req().post('/api/firms/accept-invite').set(other.headers).send({ token: sha256(token) })).status).toBe(404);   // the stored hash is not a token
      const invitee = await ctx.register({ identifier: addr });
      const ok = await req().post('/api/firms/accept-invite').set(invitee.headers).send({ token });
      expect([ok.status, ok.body.role]).toEqual([200, 'paralegal']);
      expect((await req().post('/api/firms/accept-invite').set(invitee.headers).send({ token })).status).toBe(404);   // once
      // the older "send invitation" route now sends the same link (it used to send a firm code nothing accepted)
      const addr2 = `${ctx.tag}-ws2@it.example.test`;
      const old = await req().post(`/api/firms/${f.firm_id}/invite`).set(admin.headers).send({ email: addr2, role: 'viewer' });
      expect([old.status, old.body.email_status]).toEqual([201, 'sent']);
      expect(mailsTo(addr2).at(-1).body.text).toMatch(/\/firm\/join\/[A-Za-z0-9_-]{43}/);
      expect(mailsTo(addr2).at(-1).body.text).toContain('viewer (read only)');
    });

    test('without e-mail set up, the admin gets the link to pass on (and is told nothing was sent)', async () => {
      const keep = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;
      try {
        const r = await req().post('/api/firm-acquisition/invite?lang=es').set(admin.headers).send({ email: `${ctx.tag}-nomail@it.example.test`, role: 'associate' });
        expect(r.status).toBe(201);
        expect(r.body.email_status).toBe('skipped');
        expect(r.body.link).toMatch(/^https:\/\/justicegavel\.app\/firm\/join\/[A-Za-z0-9_-]{43}$/);
        expect(r.body.message).toMatch(/no se envió nada/);
      } finally { process.env.RESEND_API_KEY = keep; }
    });
  });

  // ── 6 free AI questions ───────────────────────────────────────────────────
  describe('6 free AI questions', () => {
    const ask = (u, body, tz = 'America/Chicago') => req().post('/api/chat/ask').set(u.headers).set('X-Timezone', tz).send(body);
    const freeUser = async () => { const u = await ctx.register(); await ctx.acceptDisclaimer(u); return u; };
    const used = async (u) => Number((await ctx.db.get(`SELECT COUNT(*) AS n FROM chat_quota_log WHERE user_id = ? AND state <> 'refunded'`, [u.user.id])).n);

    test('questions sent at the same moment cannot all pass: exactly 3 of 6 are taken', async () => {
      ctx.anthropic.replyText = `Q-${ctx.tag}: general information.`;
      const u = await freeUser();
      const rs = await Promise.all([0, 1, 2, 3, 4, 5].map(i => ask(u, { message: `Parallel question ${i}?`, sessionId: `${ctx.tag}-p`, clientMessageId: `${ctx.tag}par${i}` })));
      expect(rs.map(r => r.status).sort()).toEqual([200, 200, 200, 402, 402, 402]);
      await Promise.all(rs.filter(r => r.status === 200).map(r => ctx.pollJob(u, r.body.jobId)));
      expect(await used(u)).toBe(3);
    });

    test('a rolling 24 hours: another time zone does not start a new day; resets_at is when one frees up', async () => {
      const u = await freeUser();
      for (const h of [23, 22, 2]) {
        await ctx.db.run(`INSERT INTO chat_quota_log (user_id, state, created_at) VALUES (?, 'used', NOW() - make_interval(hours => ?))`, [u.user.id, h]);
      }
      const r = await ask(u, { message: 'One more?', sessionId: `${ctx.tag}-r`, clientMessageId: `${ctx.tag}r1` }, 'Pacific/Kiritimati');
      expect(r.status).toBe(402);
      const frees = new Date(r.body.resets_at).getTime() - Date.now();
      expect(frees).toBeGreaterThan(50 * 60_000);                     // the 23-hours-ago question leaves in ~1 h
      expect(frees).toBeLessThan(70 * 60_000);
      const r2 = await ask(u, { message: 'One more?', sessionId: `${ctx.tag}-r`, clientMessageId: `${ctx.tag}r2` }, 'Pacific/Pago_Pago');
      expect(r2.status).toBe(402);
      await ctx.db.run(`UPDATE chat_quota_log SET created_at = NOW() - INTERVAL '25 hours' WHERE user_id = ? AND created_at < NOW() - INTERVAL '22 hours 30 minutes'`, [u.user.id]);
      const r3 = await ask(u, { message: 'Now?', sessionId: `${ctx.tag}-r`, clientMessageId: `${ctx.tag}r3` });
      expect(r3.status).toBe(200);
      await ctx.pollJob(u, r3.body.jobId);
    });

    test('a question that got no answer is refunded; deleting chat history gives nothing back', async () => {
      const u = await freeUser();
      ctx.anthropic.status = 529;
      try {
        const r = await ask(u, { message: 'Will this fail?', sessionId: `${ctx.tag}-f`, clientMessageId: `${ctx.tag}f1` });
        expect(r.status).toBe(200);
        expect((await ctx.pollJob(u, r.body.jobId)).body.status).toBe('failed');
      } finally { ctx.anthropic.status = 200; }
      expect(await used(u)).toBe(0);
      const st = await ctx.db.get(`SELECT state FROM chat_quota_log WHERE user_id = ? ORDER BY id DESC LIMIT 1`, [u.user.id]);
      expect(st.state).toBe('refunded');
      for (const i of [1, 2, 3]) {
        const r = await ask(u, { message: `Real ${i}?`, sessionId: `${ctx.tag}-h`, clientMessageId: `${ctx.tag}h${i}` });
        await ctx.pollJob(u, r.body.jobId);
      }
      await ctx.db.run('DELETE FROM chat_sessions WHERE user_id = ?', [u.user.id]);
      const after = await ask(u, { message: 'After deleting history?', sessionId: `${ctx.tag}-h2`, clientMessageId: `${ctx.tag}h4` });
      expect(after.status).toBe(402);
      expect(after.body.message).toBe('Free accounts include 3 AI questions every 24 hours. Upgrade for unlimited questions, or ask again later.');
    });
  });
});
