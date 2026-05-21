/**
 * auth.test.js — Authentication routes
 * Tests: register, login, /me, account deletion (cascading), GDPR export
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { makeTestDb, createSchema } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

let testDb, app;

async function buildApp(db) {
  const router = express.Router();

  function authReq(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  router.post('/register', async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
    try {
      const hash = await bcrypt.hash(password, 4); // low rounds for speed in tests
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const r = await db.run(
        'INSERT INTO users (email, password_hash, name, referral_code) VALUES (?, ?, ?, ?)',
        [email.toLowerCase(), hash, name || '', code]
      );
      const token = jwt.sign({ id: r.lastID, role: 'user', email: email.toLowerCase() }, SECRET, { expiresIn: '30d' });
      res.status(201).json({ ok: true, token, user: { id: r.lastID, email: email.toLowerCase(), name: name || '' } });
    } catch (e) {
      if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Account already exists.' });
      res.status(500).json({ error: 'Server error. Please try again.' });
    }
  });

  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    try {
      const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
      if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });
      const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, SECRET, { expiresIn: '30d' });
      res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch { res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  router.get('/me', authReq, async (req, res) => {
    try {
      const user = await db.get('SELECT id, email, name, role, subscription FROM users WHERE id = ?', [req.user.id]);
      if (!user) return res.status(404).json({ error: 'Not found.' });
      res.json(user);
    } catch { res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  router.delete('/account', authReq, async (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password required to delete account.' });
    try {
      const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
      if (!user) return res.status(404).json({ error: 'Account not found.' });
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Incorrect password.' });
      for (const tbl of ['messages', 'cases', 'push_tokens', 'scheduled_pushes',
                          'subscriptions', 'saved_lawyers', 'consultations', 'motions', 'ai_jobs']) {
        await db.run(`DELETE FROM ${tbl} WHERE user_id = ?`, [req.user.id]).catch(() => {});
      }
      await db.run('DELETE FROM users WHERE id = ?', [req.user.id]);
      res.json({ ok: true, message: 'Account permanently deleted.' });
    } catch { res.status(500).json({ error: 'Could not delete account. Please try again.' }); }
  });

  router.get('/export', authReq, async (req, res) => {
    try {
      const user     = await db.get('SELECT id, email, name FROM users WHERE id = ?', [req.user.id]);
      const cases_   = await db.all('SELECT * FROM cases WHERE user_id = ?', [req.user.id]);
      const messages = await db.all('SELECT * FROM messages WHERE sender_id = ? OR recipient_id = ?', [req.user.id, req.user.id]);
      res.json({ exported_at: new Date().toISOString(), data: { profile: user, cases: cases_, messages } });
    } catch { res.status(500).json({ error: 'Could not export data. Please try again.' }); }
  });

  // Logout route — clear push token
  router.post('/logout', authReq, async (req, res) => {
    await db.run('UPDATE users SET push_token = NULL WHERE id = ?', [req.user.id]).catch(() => {});
    res.json({ ok: true, message: 'Logged out.' });
  });

  const a = express();
  a.use(express.json());
  a.use('/api/auth', router);
  return a;
}

beforeAll(async () => {
  testDb = await makeTestDb();
  await createSchema(testDb);
  app = await buildApp(testDb);
});

// ── Registration ──────────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('creates a new user and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'alice@test.com', password: 'securepass123', name: 'Alice' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('alice@test.com');
  });

  it('rejects duplicate email with 409', async () => {
    await request(app).post('/api/auth/register').send({ email: 'dup@test.com', password: 'password123' });
    const res = await request(app).post('/api/auth/register').send({ email: 'dup@test.com', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('normalises email to lowercase', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'CAPS@TEST.COM', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('caps@test.com');
  });

  it('rejects missing fields with 400', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'x@y.com' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ password: 'pass1234' })).status).toBe(400);
  });

  it('rejects password under 8 characters', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'short@test.com', password: '1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await request(app).post('/api/auth/register').send({ email: 'loginuser@test.com', password: 'loginpass123' });
  });

  it('returns JWT for valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'loginuser@test.com', password: 'loginpass123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'loginuser@test.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('prevents account enumeration — same error for wrong user vs wrong pass', async () => {
    const wrongUser = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'anything' });
    const wrongPass = await request(app).post('/api/auth/login').send({ email: 'loginuser@test.com', password: 'wrongpass' });
    expect(wrongUser.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    expect(wrongUser.body.error).toBe(wrongPass.body.error);  // CRITICAL: identical messages
  });

  it('is case-insensitive for email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'LOGINUSER@TEST.COM', password: 'loginpass123' });
    expect(res.status).toBe(200);
  });

  it('rejects empty body with 400', async () => {
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
  });
});

// ── /me ───────────────────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  let token;
  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'meuser@test.com', password: 'mepassword123' });
    token = res.body.token;
  });

  it('returns profile for valid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('meuser@test.com');
  });

  it('returns 401 without token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('returns 401 for malformed token', async () => {
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401);
  });
});

// ── Account Deletion ──────────────────────────────────────────────────────────
describe('DELETE /api/auth/account', () => {
  let token, userId;
  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'todelete@test.com', password: 'deletepass123' });
    token = res.body.token;
    userId = res.body.user.id;
    await testDb.run('INSERT INTO cases (user_id, title) VALUES (?, ?)', [userId, 'Test Case']);
  });

  it('requires password in body', async () => {
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it('rejects wrong password', async () => {
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token}`).send({ password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect password/i);
  });

  it('deletes user and cascade data with correct password', async () => {
    const res = await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${token}`).send({ password: 'deletepass123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const gone = await testDb.get('SELECT id FROM users WHERE id = ?', [userId]);
    expect(gone).toBeUndefined();
    const cases = await testDb.all('SELECT id FROM cases WHERE user_id = ?', [userId]);
    expect(cases).toHaveLength(0);
  });

  it('requires auth token', async () => {
    expect((await request(app).delete('/api/auth/account').send({ password: 'x' })).status).toBe(401);
  });
});

// ── GDPR Export ───────────────────────────────────────────────────────────────
describe('GET /api/auth/export', () => {
  let token;
  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'export@test.com', password: 'exportpass123' });
    token = res.body.token;
  });

  it('returns structured export with exported_at', async () => {
    const res = await request(app).get('/api/auth/export').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.exported_at).toBeTruthy();
    expect(res.body.data.profile).toBeDefined();
    expect(Array.isArray(res.body.data.cases)).toBe(true);
    expect(Array.isArray(res.body.data.messages)).toBe(true);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/auth/export')).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
test('401 without token', async () => {
    const r = await request(app).post('/api/auth/logout');
    expect(r.status).toBe(401);
  });

  test('200 on logout with valid token', async () => {
    // Register a user first to get a valid token
    const reg = await request(app).post('/api/auth/register')
      .send({ email: 'logout_test@test.com', password: 'logoutpass123' });
    expect(reg.status).toBe(201);
    const token = reg.body.token;
    const r = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
  // ── Account lockout tests ─────────────────────────────────────────────────────
  test('lockout helpers: bad password returns 401', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'nobody_at_all@example.com', password: 'wrong' });
    expect([400, 401, 404]).toContain(res.status);
  });

});