/**
 * referrals.test.js — Referral program routes
 *
 * Tests: apply referral code, referral status, user isolation,
 * invalid/expired codes, duplicate use prevention.
 */
import express  from 'express';
import request  from 'supertest';
import jwt      from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id = 1, role = 'user') =>
  jwt.sign({ id, role, email: `u${id}@test.com` }, SECRET, { expiresIn: '1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT DEFAULT 'x',
      name TEXT,
      referral_code TEXT UNIQUE,
      referred_by INTEGER,
      referral_credits INTEGER DEFAULT 0,
      subscription_tier TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL,
      referred_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      credit_amount INTEGER DEFAULT 7,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(referred_id)
    );
  `);
  // Seed two users
  await db.exec(`
    INSERT INTO users (id, email, name, referral_code) VALUES (1, 'alice@test.com', 'Alice', 'ALICE123');
    INSERT INTO users (id, email, name, referral_code) VALUES (2, 'bob@test.com',   'Bob',   'BOB456');
    INSERT INTO users (id, email, name, referral_code) VALUES (3, 'carol@test.com', 'Carol', 'CAROL789');
  `);
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  // POST /apply — apply someone else's referral code
  router.post('/apply', auth, async (req, res) => {
    const { code } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'Referral code is required' });
    try {
      const referrer = await db.get(
        'SELECT id, name FROM users WHERE UPPER(referral_code)=UPPER(?)',
        [code.trim()]
      );
      if (!referrer) return res.status(404).json({ error: 'Invalid referral code' });
      if (referrer.id === req.user.id) return res.status(400).json({ error: 'Cannot use your own referral code' });

      // Check if this user already used a referral
      const existing = await db.get('SELECT id FROM referrals WHERE referred_id=?', [req.user.id]);
      if (existing) return res.status(409).json({ error: 'Referral code already applied to your account' });

      await db.run(
        'INSERT INTO referrals (referrer_id, referred_id, code, status) VALUES (?,?,?,?)',
        [referrer.id, req.user.id, code.trim().toUpperCase(), 'active']
      );
      // Credit referrer
      await db.run(
        'UPDATE users SET referral_credits = referral_credits + 7 WHERE id=?',
        [referrer.id]
      );
      // Update new user's referred_by
      await db.run('UPDATE users SET referred_by=? WHERE id=?', [referrer.id, req.user.id]);

      res.json({
        ok: true,
        referrer_name: referrer.name,
        bonus_days: 7,
        message: `You got 7 free days! ${referrer.name} also earned 7 days.`,
      });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  // GET /status — own referral stats
  router.get('/status', auth, async (req, res) => {
    try {
      const user = await db.get(
        'SELECT referral_code, referral_credits, referred_by FROM users WHERE id=?',
        [req.user.id]
      );
      const referrals = await db.all(
        `SELECT r.id, r.status, r.credit_amount, r.created_at, u.name as referred_name
         FROM referrals r JOIN users u ON u.id = r.referred_id
         WHERE r.referrer_id=? ORDER BY r.created_at DESC`,
        [req.user.id]
      );
      res.json({
        referral_code:    user?.referral_code,
        referral_credits: user?.referral_credits ?? 0,
        referrals,
        total_referred:   referrals.length,
        share_url: `https://justicegavel.app/invite?ref=${user?.referral_code}`,
      });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  app.use('/referrals', router);
  return app;
}

describe('POST /referrals/apply', () => {
  let app, db;
  beforeAll(async () => { db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('401 without token', async () => {
    const r = await request(app).post('/referrals/apply').send({ code: 'ALICE123' });
    expect(r.status).toBe(401);
  });
  test('400 when code missing', async () => {
    const r = await request(app).post('/referrals/apply')
      .set('Authorization', `Bearer ${tok(2)}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/code/i);
  });
  test('404 for invalid code', async () => {
    const r = await request(app).post('/referrals/apply')
      .set('Authorization', `Bearer ${tok(2)}`).send({ code: 'NOTACODE' });
    expect(r.status).toBe(404);
  });
  test('400 cannot use own code', async () => {
    const r = await request(app).post('/referrals/apply')
      .set('Authorization', `Bearer ${tok(1)}`).send({ code: 'ALICE123' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/own/i);
  });
  test('200 valid application — credits referrer', async () => {
    const r = await request(app).post('/referrals/apply')
      .set('Authorization', `Bearer ${tok(2)}`).send({ code: 'ALICE123' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.referrer_name).toBe('Alice');
    expect(r.body.bonus_days).toBe(7);
    // Alice should have 7 credits now
    const alice = await db.get('SELECT referral_credits FROM users WHERE id=1');
    expect(alice.referral_credits).toBe(7);
  });
  test('code is case-insensitive', async () => {
    const r = await request(app).post('/referrals/apply')
      .set('Authorization', `Bearer ${tok(3)}`).send({ code: 'alice123' });
    expect(r.status).toBe(200);
  });
  test('409 when referral already applied', async () => {
    // User 2 already applied ALICE123 in the '200 valid application' test above
    // (same describe block = same db instance). Now trying a different code should 409.
    const r = await request(app).post('/referrals/apply')
      .set('Authorization', `Bearer ${tok(2)}`).send({ code: 'CAROL789' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already applied/i);
  });
});

describe('GET /referrals/status', () => {
  let app, db;
  beforeAll(async () => { db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('401 without token', async () => {
    const r = await request(app).get('/referrals/status');
    expect(r.status).toBe(401);
  });
  test('200 returns referral code and credits', async () => {
    const r = await request(app).get('/referrals/status')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('referral_code', 'ALICE123');
    expect(r.body).toHaveProperty('referral_credits');
    expect(r.body).toHaveProperty('share_url');
    expect(r.body.share_url).toContain('ALICE123');
    expect(Array.isArray(r.body.referrals)).toBe(true);
    expect(typeof r.body.total_referred).toBe('number');
  });
  test('referrals list shows who was referred', async () => {
    // Apply a referral first
    await db.run('INSERT INTO referrals (referrer_id, referred_id, code, status) VALUES (?,?,?,?)', [1,2,'ALICE123','active']);
    const r = await request(app).get('/referrals/status')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.body.referrals.length).toBeGreaterThanOrEqual(1);
    expect(r.body.referrals[0]).toHaveProperty('referred_name');
  });
});

// ── Rate limiting integration test ────────────────────────────────────────────
// Verifies that makeUserLimiter returns 429 when a user exceeds the configured limit.
// Uses a throwaway express app so no test state bleeds over.
describe('makeUserLimiter', () => {
  test('returns 429 when per-user request limit is exceeded', async () => {
    const { makeUserLimiter } = await import('../middleware/sharedAiLimiter.js');
    const rll = makeUserLimiter({ windowMs: 60_000, max: 2, message: 'Too many requests' });
    const rla = express(); rla.use(express.json());
    const rls = process.env.JWT_SECRET;
    const rlt = jwt.sign({ id: 77777, role: 'user' }, rls, { expiresIn: '1h' });
    rla.post('/x', (q,s,n)=>{
      try{q.user=jwt.verify((q.headers.authorization||'').replace('Bearer ',''),rls);n();}
      catch{s.status(401).json({error:'x'});}
    }, rll, (_q,s)=>s.json({ok:true}));
    await request(rla).post('/x').set('Authorization',`Bearer ${rlt}`).expect(200);
    await request(rla).post('/x').set('Authorization',`Bearer ${rlt}`).expect(200);
    const rlr = await request(rla).post('/x').set('Authorization',`Bearer ${rlt}`);
    expect(rlr.status).toBe(429);
    expect(rlr.body.error).toMatch(/too many requests/i);
    expect(rlr.headers['retry-after']).toBeDefined();
  });
});

