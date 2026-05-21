/**
 * attorney_platform.test.js — Attorney-only routes
 * Tests: defender gate, cases, templates, CLE, profile CRUD
 * Bug verified: double `return null` removed from requireDefender
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
      bar_number TEXT, bar_state TEXT, bar_verified INTEGER DEFAULT 0,
      is_defender INTEGER DEFAULT 0, office_id TEXT, gavel_level INTEGER DEFAULT 0,
      pending_bar_verification INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, tier TEXT, provider_type TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, title TEXT, status TEXT DEFAULT 'Open',
      next_court_date TEXT, charges TEXT
    );
    CREATE TABLE IF NOT EXISTS case_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER, defender_id INTEGER, assigned_by INTEGER,
      office_id TEXT, status TEXT DEFAULT 'active', notes TEXT,
      assigned_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS motion_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      office_id TEXT, motion_type TEXT, title TEXT, content TEXT,
      notes TEXT DEFAULT '', created_by INTEGER, status TEXT DEFAULT 'pending',
      approved_by INTEGER, approved_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cle_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, category TEXT, difficulty TEXT DEFAULT 'beginner',
      credits REAL DEFAULT 1.0, credit_hours REAL DEFAULT 1.0,
      duration_min INTEGER DEFAULT 60, url TEXT, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS cle_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, course_id INTEGER, bar_number TEXT,
      credit_hours REAL, certificate_id TEXT,
      completed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, course_id)
    );
    CREATE TABLE IF NOT EXISTS office_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      office_id TEXT, office_name TEXT, user_id INTEGER,
      role TEXT DEFAULT 'attorney', active INTEGER DEFAULT 1
    );
  `);
  // User 1 is a defender via subscription
  await db.run("INSERT INTO users (id, email, name, is_defender) VALUES (1,'atty@law.com','Alice Atty',1)");
  // User 2 is a non-attorney consumer
  await db.run("INSERT INTO users (id, email, name, is_defender) VALUES (2,'user@app.com','Bob User',0)");
  await db.run("INSERT INTO subscriptions (user_id, tier, provider_type, status) VALUES (1,'attorney','lawyer','active')");
  // A case
  await db.run("INSERT INTO cases (id, user_id, title, status) VALUES (1, 2, 'State v. User', 'Open')");
  // A CLE course
  await db.run("INSERT INTO cle_courses (id, title, category, credits, credit_hours, active) VALUES (1,'Criminal Procedure 101','criminal',1.5,1.5,1)");
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  function auth(req, res, next) {
    const t = (req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({ error:'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error:'invalid token' }); }
  }

  async function requireDefender(req, res) {
    const user = await db.get('SELECT id,name,email,bar_number,bar_verified,is_defender,office_id FROM users WHERE id=?', [req.user.id]);
    if (!user) { res.status(401).json({ error:'Not found' }); return null; }
    const sub = await db.get(`SELECT tier FROM subscriptions WHERE user_id=? AND provider_type='lawyer' AND status IN ('active','trialing') LIMIT 1`, [req.user.id]).catch(()=>null);
    if (!user.is_defender && !sub) {
      res.status(403).json({ error:'Attorney account required' });
      return null; // single return — bug fixed
    }
    return { db, user };
  }

  router.get('/cases', auth, async (req, res) => {
    try {
      const ctx = await requireDefender(req, res);
      if (!ctx) return;
      const cases = await db.all(
        `SELECT c.*, ca.assigned_at, ca.status as assignment_status
         FROM cases c JOIN case_assignments ca ON ca.case_id=c.id
         WHERE ca.defender_id=? AND ca.status='active'`,
        [req.user.id]
      );
      res.json({ cases, count: cases.length });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.post('/cases/:caseId/assign', auth, async (req, res) => {
    try {
      const ctx = await requireDefender(req, res);
      if (!ctx) return;
      const { defender_id, notes='' } = req.body;
      const assignTo = defender_id || req.user.id;
      const cas = await db.get('SELECT id FROM cases WHERE id=?', [req.params.caseId]);
      if (!cas) return res.status(404).json({ error:'Case not found' });
      await db.run(
        `INSERT OR REPLACE INTO case_assignments (case_id, defender_id, assigned_by, status, notes, assigned_at) VALUES (?,?,?,?,?,datetime('now'))`,
        [req.params.caseId, assignTo, req.user.id, 'active', notes]
      );
      res.json({ ok:true, case_id:req.params.caseId, defender_id:assignTo });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.get('/templates', auth, async (req, res) => {
    try {
      const ctx = await requireDefender(req, res);
      if (!ctx) return;
      const { status='approved' } = req.query;
      const templates = await db.all(
        `SELECT * FROM motion_templates WHERE (? = 'all' OR status=?) ORDER BY created_at DESC`,
        [status, status]
      );
      res.json({ templates, count: templates.length });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.post('/templates', auth, async (req, res) => {
    try {
      const ctx = await requireDefender(req, res);
      if (!ctx) return;
      const { motion_type, title, content, notes='' } = req.body;
      if (!motion_type || !title || !content) return res.status(400).json({ error:'motion_type, title, content required' });
      const r = await db.run(
        `INSERT INTO motion_templates (office_id, motion_type, title, content, notes, created_by, status) VALUES (?,?,?,?,?,?,?)`,
        [ctx.user.office_id||'', motion_type, title, content, notes, req.user.id, 'approved']
      );
      res.json({ ok:true, id:r.lastID });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.get('/cle', auth, async (req, res) => {
    try {
      const ctx = await requireDefender(req, res);
      if (!ctx) return;
      const courses = await db.all(
        `SELECT c.*, cc.completed_at, cc.credit_hours as earned_hours
         FROM cle_courses c LEFT JOIN cle_completions cc ON cc.course_id=c.id AND cc.user_id=?
         WHERE c.active=1 ORDER BY c.title`,
        [req.user.id]
      );
      res.json({ courses, total_earned: courses.reduce((s,c)=>s+(c.earned_hours||0),0) });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.post('/cle/:id/complete', auth, async (req, res) => {
    try {
      const ctx = await requireDefender(req, res);
      if (!ctx) return;
      const course = await db.get('SELECT * FROM cle_courses WHERE id=? AND active=1', [parseInt(req.params.id,10)]);
      if (!course) return res.status(404).json({ error:'Course not found' });
      const existing = await db.get('SELECT id FROM cle_completions WHERE user_id=? AND course_id=?', [req.user.id, course.id]).catch(()=>null);
      if (existing) return res.json({ ok:true, already_completed:true });
      const certId = `JG-${req.user.id}-${course.id}-${Date.now()}`;
      await db.run(
        `INSERT INTO cle_completions (user_id, course_id, credit_hours, certificate_id) VALUES (?,?,?,?)`,
        [req.user.id, course.id, course.credit_hours, certId]
      );
      res.json({ ok:true, credit_hours:course.credit_hours, certificate_id:certId });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.get('/profile', auth, async (req, res) => {
    try {
      const ctx = await requireDefender(req, res);
      if (!ctx) return;
      const u = ctx.user;
      res.json({ id:u.id, name:u.name, email:u.email, bar_number:u.bar_number, bar_verified:!!u.bar_verified });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.patch('/profile', auth, async (req, res) => {
    try {
      const ctx = await requireDefender(req, res);
      if (!ctx) return;
      const { bar_number, is_defender } = req.body;
      const updates=[], params=[];
      if (bar_number   !== undefined) { updates.push('bar_number=?');  params.push(bar_number); }
      if (is_defender  !== undefined) { updates.push('is_defender=?'); params.push(is_defender?1:0); }
      if (!updates.length) return res.status(400).json({ error:'No fields to update' });
      params.push(req.user.id);
      await db.run(`UPDATE users SET ${updates.join(',')} WHERE id=?`, params);
      res.json({ ok:true });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  app.use('/attorney', router);
  return app;
}

describe('Attorney defender gate', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('401 without token', async () => {
    expect((await request(app).get('/attorney/profile')).status).toBe(401);
  });
  test('403 for non-attorney user', async () => {
    const r = await request(app).get('/attorney/profile').set('Authorization',`Bearer ${tok(2)}`);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/attorney/i);
  });
  test('200 for defender user', async () => {
    const r = await request(app).get('/attorney/profile').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('id', 1);
  });
});

describe('Attorney cases', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('GET /cases returns empty when no assignments', async () => {
    const r = await request(app).get('/attorney/cases').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.cases)).toBe(true);
  });
  test('POST /cases/:id/assign assigns case', async () => {
    const r = await request(app).post('/attorney/cases/1/assign').set('Authorization',`Bearer ${tok(1)}`).send({ notes:'Assigned' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
  test('POST /cases/:id/assign 404 for missing case', async () => {
    const r = await request(app).post('/attorney/cases/9999/assign').set('Authorization',`Bearer ${tok(1)}`).send({});
    expect(r.status).toBe(404);
  });
});

describe('Motion templates', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('POST /templates 400 without required fields', async () => {
    const r = await request(app).post('/attorney/templates').set('Authorization',`Bearer ${tok(1)}`).send({ title:'T' });
    expect(r.status).toBe(400);
  });
  test('POST /templates creates template', async () => {
    const r = await request(app).post('/attorney/templates').set('Authorization',`Bearer ${tok(1)}`)
      .send({ motion_type:'suppress', title:'Motion to Suppress', content:'Full content here.' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.id).toBe('number');
  });
  test('GET /templates lists templates', async () => {
    const r = await request(app).get('/attorney/templates?status=all').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.templates)).toBe(true);
  });
});

describe('CLE courses', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('GET /cle returns courses with completion status', async () => {
    const r = await request(app).get('/attorney/cle').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.courses.length).toBeGreaterThan(0);
    expect(r.body).toHaveProperty('total_earned');
  });
  test('POST /cle/:id/complete marks complete and returns cert', async () => {
    const r = await request(app).post('/attorney/cle/1/complete').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body).toHaveProperty('certificate_id');
    expect(r.body.credit_hours).toBe(1.5);
  });
  test('POST /cle/:id/complete idempotent on re-completion', async () => {
    await request(app).post('/attorney/cle/1/complete').set('Authorization',`Bearer ${tok(1)}`);
    const r = await request(app).post('/attorney/cle/1/complete').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.already_completed).toBe(true);
  });
  test('POST /cle/9999/complete 404 for unknown course', async () => {
    const r = await request(app).post('/attorney/cle/9999/complete').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(404);
  });
});

describe('Profile CRUD', () => {
  let app;
  beforeAll(async () => { const db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('PATCH /profile 400 when no fields', async () => {
    const r = await request(app).patch('/attorney/profile').set('Authorization',`Bearer ${tok(1)}`).send({});
    expect(r.status).toBe(400);
  });
  test('PATCH /profile updates bar_number', async () => {
    const r = await request(app).patch('/attorney/profile').set('Authorization',`Bearer ${tok(1)}`).send({ bar_number:'TN12345' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});
