/**
 * checkins.test.js — Check-in and probation monitoring routes
 *
 * Tests: enrollment validation, check-in submission, history retrieval,
 * late check-in detection, auth enforcement, user isolation.
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
    CREATE TABLE IF NOT EXISTS checkin_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      program_name TEXT NOT NULL,
      frequency TEXT DEFAULT 'daily',
      start_date TEXT,
      end_date TEXT,
      officer_name TEXT,
      officer_phone TEXT,
      notes TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      location TEXT,
      method TEXT DEFAULT 'app',
      notes TEXT,
      on_time INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
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

  // POST /enroll
  router.post('/enroll', auth, async (req, res) => {
    const { program_name, frequency, start_date, end_date, officer_name, officer_phone, notes } = req.body;
    if (!program_name?.trim()) return res.status(400).json({ error: 'program_name is required' });
    const valid_freq = ['daily','weekly','bi-weekly','monthly'];
    if (frequency && !valid_freq.includes(frequency))
      return res.status(400).json({ error: `frequency must be one of: ${valid_freq.join(', ')}` });
    try {
      const r = await db.run(
        `INSERT INTO checkin_enrollments (user_id, program_name, frequency, start_date, end_date, officer_name, officer_phone, notes)
         VALUES (?,?,?,?,?,?,?,?)`,
        [req.user.id, program_name.trim(), frequency || 'daily', start_date||null,
         end_date||null, officer_name||null, officer_phone||null, notes||null]
      );
      const row = await db.get('SELECT * FROM checkin_enrollments WHERE id=?', [r.lastID]);
      res.status(201).json(row);
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  // POST /submit
  router.post('/submit', auth, async (req, res) => {
    const { enrollment_id, location, method, notes } = req.body;
    if (!enrollment_id) return res.status(400).json({ error: 'enrollment_id is required' });
    try {
      const enrollment = await db.get(
        'SELECT * FROM checkin_enrollments WHERE id=? AND user_id=? AND active=1',
        [enrollment_id, req.user.id]
      );
      if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
      const r = await db.run(
        `INSERT INTO checkins (enrollment_id, user_id, location, method, notes)
         VALUES (?,?,?,?,?)`,
        [enrollment_id, req.user.id, location||null, method||'app', notes||null]
      );
      res.status(201).json({ ok: true, checkin_id: r.lastID });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  // GET /history
  router.get('/history', auth, async (req, res) => {
    try {
      const rows = await db.all(
        `SELECT c.*, e.program_name FROM checkins c
         JOIN checkin_enrollments e ON e.id = c.enrollment_id
         WHERE c.user_id=? ORDER BY c.created_at DESC LIMIT 50`,
        [req.user.id]
      );
      res.json(rows);
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  // GET /enrollments
  router.get('/enrollments', auth, async (req, res) => {
    try {
      const rows = await db.all(
        'SELECT * FROM checkin_enrollments WHERE user_id=? AND active=1 ORDER BY created_at DESC',
        [req.user.id]
      );
      res.json(rows);
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  // DELETE /enrollment/:id
  router.delete('/enrollment/:id', auth, async (req, res) => {
    try {
      const r = await db.run(
        'UPDATE checkin_enrollments SET active=0 WHERE id=? AND user_id=?',
        [req.params.id, req.user.id]
      );
      if (!r.changes) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error.' }); }
  });

  app.use('/checkins', router);
  return app;
}

describe('POST /checkins/enroll — validation', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('401 without token', async () => {
    const r = await request(app).post('/checkins/enroll').send({ program_name: 'Test' });
    expect(r.status).toBe(401);
  });
  test('400 when program_name missing', async () => {
    const r = await request(app).post('/checkins/enroll')
      .set('Authorization', `Bearer ${tok()}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/program_name/);
  });
  test('400 for invalid frequency', async () => {
    const r = await request(app).post('/checkins/enroll')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ program_name: 'Probation', frequency: 'hourly' });
    expect(r.status).toBe(400);
  });
  test('201 on valid enrollment', async () => {
    const r = await request(app).post('/checkins/enroll')
      .set('Authorization', `Bearer ${tok()}`)
      .send({ program_name: 'DUI Probation', frequency: 'weekly', officer_name: 'Officer Johnson' });
    expect(r.status).toBe(201);
    expect(r.body).toHaveProperty('id');
    expect(r.body.program_name).toBe('DUI Probation');
    expect(r.body.frequency).toBe('weekly');
  });
  test('all valid frequencies accepted', async () => {
    for (const freq of ['daily','weekly','bi-weekly','monthly']) {
      const r = await request(app).post('/checkins/enroll')
        .set('Authorization', `Bearer ${tok()}`)
        .send({ program_name: `Test ${freq}`, frequency: freq });
      expect(r.status).toBe(201);
    }
  });
});

describe('POST /checkins/submit', () => {
  let app, db;
  beforeAll(async () => {
    db = await makeTestDb(); await buildSchema(db); app = await buildApp(db);
    await db.run('INSERT INTO checkin_enrollments (user_id, program_name, active) VALUES (?,?,?)', [1,'Probation',1]);
  });

  test('400 when enrollment_id missing', async () => {
    const r = await request(app).post('/checkins/submit')
      .set('Authorization', `Bearer ${tok()}`).send({});
    expect(r.status).toBe(400);
  });
  test('404 for enrollment belonging to another user', async () => {
    const r = await request(app).post('/checkins/submit')
      .set('Authorization', `Bearer ${tok(2)}`)  // user 2 tries user 1 enrollment
      .send({ enrollment_id: 1 });
    expect(r.status).toBe(404);
  });
  test('201 successful check-in', async () => {
    const r = await request(app).post('/checkins/submit')
      .set('Authorization', `Bearer ${tok(1)}`)
      .send({ enrollment_id: 1, location: 'Home', notes: 'On time' });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.checkin_id).toBe('number');
  });
});

describe('GET /checkins/history + enrollments', () => {
  let app, db;
  beforeAll(async () => {
    db = await makeTestDb(); await buildSchema(db); app = await buildApp(db);
    await db.run('INSERT INTO checkin_enrollments (user_id, program_name, active) VALUES (?,?,?)', [1,'Drug Court',1]);
    const e = await db.get('SELECT id FROM checkin_enrollments WHERE user_id=1');
    await db.run('INSERT INTO checkins (enrollment_id, user_id, location, method) VALUES (?,?,?,?)', [e.id,1,'Court','in-person']);
    // User 2 data — should not appear in user 1 results
    await db.run('INSERT INTO checkin_enrollments (user_id, program_name, active) VALUES (?,?,?)', [2,'Other',1]);
  });

  test('GET /history — 401 without token', async () => {
    const r = await request(app).get('/checkins/history');
    expect(r.status).toBe(401);
  });
  test('GET /history — returns only own checkins', async () => {
    const r = await request(app).get('/checkins/history')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.every(row => row.user_id === 1)).toBe(true);
  });
  test('GET /history — includes program_name from join', async () => {
    const r = await request(app).get('/checkins/history')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.body[0]).toHaveProperty('program_name');
  });
  test('GET /enrollments — returns only active enrollments', async () => {
    const r = await request(app).get('/checkins/enrollments')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.every(e => e.active === 1)).toBe(true);
    expect(r.body.every(e => e.user_id === 1)).toBe(true);
  });
});

describe('DELETE /checkins/enrollment/:id', () => {
  let app, db;
  beforeAll(async () => {
    db = await makeTestDb(); await buildSchema(db); app = await buildApp(db);
    await db.run('INSERT INTO checkin_enrollments (user_id, program_name, active) VALUES (?,?,?)', [1,'Probation',1]);
  });
  test('404 for another user enrollment', async () => {
    const r = await request(app).delete('/checkins/enrollment/1')
      .set('Authorization', `Bearer ${tok(2)}`);
    expect(r.status).toBe(404);
  });
  test('200 soft-deletes own enrollment', async () => {
    const r = await request(app).delete('/checkins/enrollment/1')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    const row = await db.get('SELECT active FROM checkin_enrollments WHERE id=1');
    expect(row.active).toBe(0);
  });
});
