/**
 * golden_gavel.test.js — Gavel tier system (Bronze/Silver/Gold)
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT, name TEXT,
      gavel_level INTEGER DEFAULT 0, gavel_points INTEGER DEFAULT 0,
      hall_opt_in INTEGER DEFAULT 0, compliance_flags INTEGER DEFAULT 0,
      golden_gavel INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','-13 months'))
    );
    CREATE TABLE IF NOT EXISTS subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, tier TEXT, provider_type TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now','-13 months')));
    CREATE TABLE IF NOT EXISTS referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER, credits INTEGER DEFAULT 1, status TEXT DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS lessons (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
    CREATE TABLE IF NOT EXISTS lesson_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, lesson_id INTEGER, completed INTEGER DEFAULT 1, UNIQUE(user_id,lesson_id));
    CREATE TABLE IF NOT EXISTS consultation_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, lawyer_id INTEGER, status TEXT DEFAULT 'completed');
    CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT, entity_id INTEGER, rating REAL DEFAULT 5.0);
    CREATE TABLE IF NOT EXISTS gavel_hall_of_fame (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, gavel_level INTEGER, display_name TEXT, bio TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);
  await db.run("INSERT INTO users (id,email,name,is_admin) VALUES (1,'admin@jg.com','Admin',1)");
  await db.run("INSERT INTO users (id,email,name,hall_opt_in) VALUES (2,'user@jg.com','Regular',0)");
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({ error:'missing token' });
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({ error:'invalid token' }); }
  }

  const GAVEL_LABEL = { 0:'None', 1:'Bronze', 2:'Silver', 3:'Golden' };
  const GAVEL_EMOJI = { 0:'', 1:'🥉', 2:'🥈', 3:'🏆' };

  router.get('/status', auth, async (req, res) => {
    try {
      const user = await db.get('SELECT id,gavel_level,gavel_points,hall_opt_in FROM users WHERE id=?', [req.user.id]);
      if (!user) return res.status(404).json({ error:'User not found' });
      res.json({
        user_id: user.id,
        level: user.gavel_level,
        label: GAVEL_LABEL[user.gavel_level],
        emoji: GAVEL_EMOJI[user.gavel_level],
        points: user.gavel_points,
        hall_opt_in: !!user.hall_opt_in,
      });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.post('/hall/opt-in', auth, async (req, res) => {
    try {
      await db.run('UPDATE users SET hall_opt_in=1 WHERE id=?', [req.user.id]);
      res.json({ ok:true, hall_opt_in:true });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.get('/hall', async (req, res) => {
    try {
      const rows = await db.all(
        `SELECT u.id, u.name, u.gavel_level, u.gavel_points, h.bio
         FROM users u LEFT JOIN gavel_hall_of_fame h ON h.user_id=u.id
         WHERE u.hall_opt_in=1 AND u.gavel_level>0
         ORDER BY u.gavel_level DESC, u.gavel_points DESC LIMIT 50`
      ).catch(()=>[]);
      res.json(rows);
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.post('/evaluate', auth, async (req, res) => {
    try {
      const admin = await db.get('SELECT is_admin FROM users WHERE id=?', [req.user.id]);
      if (!admin?.is_admin) return res.status(403).json({ error:'Admin only' });
      const { user_id } = req.body;
      if (!user_id) return res.status(400).json({ error:'user_id required' });
      const user = await db.get('SELECT id, gavel_level FROM users WHERE id=?', [user_id]);
      if (!user) return res.status(404).json({ error:'User not found' });
      res.json({ ok:true, user_id, level:user.gavel_level, label:GAVEL_LABEL[user.gavel_level] });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  app.use('/golden_gavel', router);
  return app;
}

describe('GET /golden_gavel/status', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without token', async () => { expect((await request(app).get('/golden_gavel/status')).status).toBe(401); });
  test('returns gavel status shape', async () => {
    const r = await request(app).get('/golden_gavel/status').set('Authorization',`Bearer ${tok(2)}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('level');
    expect(r.body).toHaveProperty('label');
    expect(r.body).toHaveProperty('emoji');
    expect(r.body).toHaveProperty('points');
    expect(r.body).toHaveProperty('hall_opt_in');
  });
  test('default level is None', async () => {
    const r = await request(app).get('/golden_gavel/status').set('Authorization',`Bearer ${tok(2)}`);
    expect(r.body.label).toBe('None');
  });
});

describe('Hall of Fame opt-in and listing', () => {
  let app, db;
  beforeAll(async () => { db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('POST /hall/opt-in sets hall_opt_in=true', async () => {
    const r = await request(app).post('/golden_gavel/hall/opt-in').set('Authorization',`Bearer ${tok(2)}`);
    expect(r.status).toBe(200);
    expect(r.body.hall_opt_in).toBe(true);
    const row = await db.get('SELECT hall_opt_in FROM users WHERE id=2');
    expect(row.hall_opt_in).toBe(1);
  });
  test('GET /hall returns opt-in users with gavel_level>0', async () => {
    await db.run("UPDATE users SET gavel_level=2, hall_opt_in=1 WHERE id=2");
    const r = await request(app).get('/golden_gavel/hall');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.some(u=>u.gavel_level>0)).toBe(true);
  });
  test('GET /hall excludes non-opted-in users', async () => {
    await db.run("INSERT INTO users (id,email,name,gavel_level,hall_opt_in) VALUES (99,'no@opt.com','No-opt',3,0)");
    const r = await request(app).get('/golden_gavel/hall');
    expect(r.body.every(u=>u.hall_opt_in!==0)).toBe(true);
  });
});

describe('POST /golden_gavel/evaluate (admin only)', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('403 for non-admin', async () => {
    const r = await request(app).post('/golden_gavel/evaluate').set('Authorization',`Bearer ${tok(2)}`).send({ user_id:2 });
    expect(r.status).toBe(403);
  });
  test('400 without user_id', async () => {
    const r = await request(app).post('/golden_gavel/evaluate').set('Authorization',`Bearer ${tok(1)}`).send({});
    expect(r.status).toBe(400);
  });
  test('200 admin can evaluate user', async () => {
    const r = await request(app).post('/golden_gavel/evaluate').set('Authorization',`Bearer ${tok(1)}`).send({ user_id:2 });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body).toHaveProperty('label');
  });
  test('404 for non-existent user', async () => {
    const r = await request(app).post('/golden_gavel/evaluate').set('Authorization',`Bearer ${tok(1)}`).send({ user_id:9999 });
    expect(r.status).toBe(404);
  });
});
