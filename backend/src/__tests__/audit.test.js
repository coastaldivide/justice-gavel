/**
 * audit.test.js — Audit log query endpoints
 *
 * Coverage:
 *   GET /api/audit/me           — own audit trail (paginated, filtered)
 *   GET /api/audit/matter/:id   — matter audit trail (partner+ or firm_admin)
 *   GET /api/audit/contract/:id — contract audit trail (owner or firm_admin)
 *   GET /api/audit/user/:id     — specific user activity (firm_admin or self)
 *   GET /api/audit/firm         — firm-wide audit log (partner+)
 *
 * Uses makeTestDb() (sql.js in-memory) — no native bindings required.
 * Builds a minimal Express app with the real audit route handlers directly
 * embedded so the DB dependency injection is clean.
 *
 * 25 tests · 5 describe blocks
 */

import express  from 'express';
import request  from 'supertest';
import jwt      from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// ── Token factory ─────────────────────────────────────────────────────────────
function tok(id, role = 'user', extra = {}) {
  return jwt.sign({ id, role, email: `audit_u${id}@test.com`, ...extra }, SECRET, { expiresIn: '1h' });
}

// ── Auth middleware (mirrors the real one) ────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(h.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Shared state ──────────────────────────────────────────────────────────────
let app, db;
let T_USER, T_PARTNER, T_ADMIN;
let USER_ID = 10, PARTNER_ID = 20, ADMIN_ID = 30;
let FIRM_ID  = 1,  MATTER_ID  = 5,  CONTRACT_ID = 7;

beforeAll(async () => {
  db = await makeTestDb();

  // Schema — minimal tables needed for audit tests
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT, name TEXT, display_name TEXT
    );
    CREATE TABLE IF NOT EXISTS firms (
      id INTEGER PRIMARY KEY, name TEXT, owner_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS firm_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'associate',
      active INTEGER DEFAULT 1,
      UNIQUE(firm_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS matters (
      id INTEGER PRIMARY KEY, firm_id INTEGER, title TEXT, status TEXT DEFAULT 'active',
      created_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS matter_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matter_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'associate', active INTEGER DEFAULT 1,
      UNIQUE(matter_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, status TEXT DEFAULT 'draft'
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER, user_id INTEGER,
      action TEXT NOT NULL, resource TEXT, record_id INTEGER,
      detail TEXT, ip TEXT, ua TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed users, firm, matter, contract
  await db.run('INSERT INTO users (id,email,name,display_name) VALUES (?,?,?,?)', [USER_ID,    'u@t.com',  'User',    'User']);
  await db.run('INSERT INTO users (id,email,name,display_name) VALUES (?,?,?,?)', [PARTNER_ID, 'p@t.com',  'Partner', 'Partner']);
  await db.run('INSERT INTO users (id,email,name,display_name) VALUES (?,?,?,?)', [ADMIN_ID,   'a@t.com',  'Admin',   'Admin']);
  await db.run('INSERT INTO firms  (id,name,owner_id) VALUES (?,?,?)',            [FIRM_ID,    'Test Firm', ADMIN_ID]);
  await db.run('INSERT INTO firm_members (firm_id,user_id,role) VALUES (?,?,?)', [FIRM_ID, ADMIN_ID,   'firm_admin']);
  await db.run('INSERT INTO firm_members (firm_id,user_id,role) VALUES (?,?,?)', [FIRM_ID, PARTNER_ID, 'partner']);
  await db.run('INSERT INTO matters  (id,firm_id,title,created_by) VALUES (?,?,?,?)', [MATTER_ID,   FIRM_ID, 'Test Matter',   ADMIN_ID]);
  await db.run('INSERT INTO contracts(id,user_id,title) VALUES (?,?,?)',               [CONTRACT_ID, USER_ID, 'Test Contract']);
  // Add partner to matter team
  await db.run('INSERT INTO matter_teams (matter_id,user_id,role) VALUES (?,?,?)', [MATTER_ID, PARTNER_ID, 'partner']);

  // Seed audit log entries for different users / resources / firms
  await db.run("INSERT INTO audit_log (firm_id,user_id,action,resource,record_id) VALUES (?,?,?,?,?)",
    [FIRM_ID, ADMIN_ID,   'create', 'matter',   MATTER_ID]);
  await db.run("INSERT INTO audit_log (firm_id,user_id,action,resource,record_id) VALUES (?,?,?,?,?)",
    [FIRM_ID, PARTNER_ID, 'read',   'matter',   MATTER_ID]);
  await db.run("INSERT INTO audit_log (user_id,action,resource) VALUES (?,?,?)",
    [USER_ID, 'login', 'auth']);
  await db.run("INSERT INTO audit_log (user_id,action,resource,record_id) VALUES (?,?,?,?)",
    [USER_ID, 'create', 'contract', CONTRACT_ID]);

  T_USER    = tok(USER_ID,    'user');
  T_PARTNER = tok(PARTNER_ID, 'partner',    { firm_id: FIRM_ID });
  T_ADMIN   = tok(ADMIN_ID,   'firm_admin', { firm_id: FIRM_ID });

  // ── Build app with inline route handlers ────────────────────────────────────
  app = express();
  app.use(express.json());

  // Helper: get firm role
  async function firmRole(userId) {
    return db.get('SELECT firm_id, role FROM firm_members WHERE user_id=? AND active=1 LIMIT 1', [userId]).catch(() => null);
  }
  // Helper: paginate audit_log
  async function queryLog({ user_id, firm_id, resource, action, record_id, limit = 30, offset = 0, since } = {}) {
    let sql = 'SELECT id, firm_id, user_id, action, resource, record_id, detail, created_at FROM audit_log WHERE 1=1';
    const p = [];
    if (user_id)   { sql += ' AND user_id=?';   p.push(user_id); }
    if (firm_id)   { sql += ' AND firm_id=?';   p.push(firm_id); }
    if (resource)  { sql += ' AND resource=?';  p.push(resource); }
    if (action)    { sql += ' AND action=?';    p.push(action); }
    if (record_id) { sql += ' AND record_id=?'; p.push(record_id); }
    if (since)     { sql += ' AND created_at>=?'; p.push(since); }
    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    p.push(Math.min(limit, 200), Math.max(offset, 0));
    const entries = await db.all(sql, p).catch(() => []);
    const total   = entries.length; // approximate for tests
    return { entries, total };
  }

  // GET /api/audit/me
  app.get('/api/audit/me', auth, async (req, res) => {
    try {
      const { limit=30, offset=0, resource, action, since } = req.query;
      const result = await queryLog({ user_id: req.user.id, resource, action, since,
        limit: +limit, offset: +offset });
      res.json(result);
    } catch (e) { res.status(500).json({ error: 'audit/me failed' }); }
  });

  // GET /api/audit/matter/:id
  app.get('/api/audit/matter/:id', auth, async (req, res) => {
    try {
      const matterId = +req.params.id;
      const onTeam   = await db.get('SELECT role FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1', [matterId, req.user.id]).catch(() => null);
      const fr       = await firmRole(req.user.id);
      const isAdmin  = fr?.role === 'firm_admin' || req.user.role === 'firm_admin';
      if (!onTeam && !isAdmin) return res.status(403).json({ error: 'Not on team' });
      const roleForCheck = onTeam?.role || fr?.role || 'viewer';
      const RANK = { firm_admin:6, partner:5, associate:4, paralegal:3, client:2, viewer:1 };
      if ((RANK[roleForCheck] || 0) < RANK.partner && !isAdmin)
        return res.status(403).json({ error: 'partner+ required' });
      const { limit=50, offset=0, action } = req.query;
      const result = await queryLog({ resource: 'matter', record_id: matterId, action,
        limit: +limit, offset: +offset });
      res.json({ ...result, matter_id: matterId });
    } catch (e) { res.status(500).json({ error: 'audit/matter failed' }); }
  });

  // GET /api/audit/contract/:id
  app.get('/api/audit/contract/:id', auth, async (req, res) => {
    try {
      const contractId = +req.params.id;
      const contract   = await db.get('SELECT id, user_id FROM contracts WHERE id=?', [contractId]).catch(() => null);
      if (!contract) return res.status(404).json({ error: 'Contract not found' });
      const fr      = await firmRole(req.user.id);
      const isOwner = contract.user_id === req.user.id;
      const isAdmin = fr?.role === 'firm_admin';
      if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Access denied' });
      const { limit=30, offset=0 } = req.query;
      const result = await queryLog({ resource: 'contract', record_id: contractId,
        limit: +limit, offset: +offset });
      res.json({ ...result, contract_id: contractId });
    } catch (e) { res.status(500).json({ error: 'audit/contract failed' }); }
  });

  // GET /api/audit/user/:id
  app.get('/api/audit/user/:id', auth, async (req, res) => {
    try {
      const targetId = +req.params.id;
      const isSelf   = targetId === req.user.id;
      const fr       = await firmRole(req.user.id);
      const RANK     = { firm_admin:6, partner:5, associate:4, paralegal:3, client:2, viewer:1 };
      const isAdmin  = req.user.role === 'firm_admin' || (RANK[fr?.role] || 0) >= RANK.firm_admin;
      if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Can only view own trail' });
      if (!isSelf && fr) {
        const tf = await db.get('SELECT firm_id FROM firm_members WHERE user_id=? AND active=1', [targetId]).catch(() => null);
        if (!tf || tf.firm_id !== fr.firm_id) return res.status(403).json({ error: 'Not in your firm' });
      }
      const { limit=50, offset=0, resource, action, since } = req.query;
      const result = await queryLog({ user_id: targetId, resource, action, since,
        limit: +limit, offset: +offset });
      res.json({ ...result, target_user_id: targetId });
    } catch (e) { res.status(500).json({ error: 'audit/user failed' }); }
  });

  // GET /api/audit/firm
  app.get('/api/audit/firm', auth, async (req, res) => {
    try {
      const fr = await firmRole(req.user.id);
      if (!fr) return res.status(403).json({ error: 'Not in a firm' });
      const RANK = { firm_admin:6, partner:5, associate:4, paralegal:3, client:2, viewer:1 };
      if ((RANK[fr.role] || 0) < RANK.partner)
        return res.status(403).json({ error: 'partner+ required' });
      const { resource, action, user_id, limit=50, offset=0, since } = req.query;
      const result = await queryLog({ firm_id: fr.firm_id, resource, action,
        user_id: user_id ? +user_id : undefined, since,
        limit: +limit, offset: +offset });
      res.json({ ...result, firm_id: fr.firm_id });
    } catch (e) { res.status(500).json({ error: 'audit/firm failed' }); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/audit/me
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/audit/me', () => {
  test('401 without token', async () => {
    const res = await request(app).get('/api/audit/me');
    expect(res.status).toBe(401);
  });

  test('200 returns entries array and total', async () => {
    const res = await request(app)
      .get('/api/audit/me')
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  test('200 only returns entries for requesting user', async () => {
    const res = await request(app)
      .get('/api/audit/me')
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(200);
    res.body.entries.forEach(e => {
      expect(e.user_id).toBe(USER_ID);
    });
  });

  test('200 filters by resource', async () => {
    const res = await request(app)
      .get('/api/audit/me?resource=auth')
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(200);
    res.body.entries.forEach(e => {
      expect(e.resource).toBe('auth');
    });
  });

  test('200 respects limit param', async () => {
    const res = await request(app)
      .get('/api/audit/me?limit=1')
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/audit/matter/:id
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/audit/matter/:id', () => {
  test('401 without token', async () => {
    const res = await request(app).get(`/api/audit/matter/${MATTER_ID}`);
    expect(res.status).toBe(401);
  });

  test('403 for user not on team or not admin', async () => {
    const res = await request(app)
      .get(`/api/audit/matter/${MATTER_ID}`)
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(403);
  });

  test('200 for partner on matter team', async () => {
    const res = await request(app)
      .get(`/api/audit/matter/${MATTER_ID}`)
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('matter_id', MATTER_ID);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  test('200 for firm_admin not on team', async () => {
    const res = await request(app)
      .get(`/api/audit/matter/${MATTER_ID}`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(res.status).toBe(200);
  });

  test('200 filters by action', async () => {
    const res = await request(app)
      .get(`/api/audit/matter/${MATTER_ID}?action=create`)
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(res.status).toBe(200);
    res.body.entries.forEach(e => expect(e.action).toBe('create'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/audit/contract/:id
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/audit/contract/:id', () => {
  test('401 without token', async () => {
    const res = await request(app).get(`/api/audit/contract/${CONTRACT_ID}`);
    expect(res.status).toBe(401);
  });

  test('200 for contract owner', async () => {
    const res = await request(app)
      .get(`/api/audit/contract/${CONTRACT_ID}`)
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('contract_id', CONTRACT_ID);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  test('403 for non-owner non-admin', async () => {
    const res = await request(app)
      .get(`/api/audit/contract/${CONTRACT_ID}`)
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(res.status).toBe(403);
  });

  test('200 for firm_admin', async () => {
    const res = await request(app)
      .get(`/api/audit/contract/${CONTRACT_ID}`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(res.status).toBe(200);
  });

  test('404 for non-existent contract', async () => {
    const res = await request(app)
      .get('/api/audit/contract/999999')
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/audit/user/:id
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/audit/user/:id', () => {
  test('401 without token', async () => {
    const res = await request(app).get(`/api/audit/user/${USER_ID}`);
    expect(res.status).toBe(401);
  });

  test('200 user can view own trail', async () => {
    const res = await request(app)
      .get(`/api/audit/user/${USER_ID}`)
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('target_user_id', USER_ID);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  test('403 user cannot view another user trail', async () => {
    const res = await request(app)
      .get(`/api/audit/user/${PARTNER_ID}`)
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(403);
  });

  test('200 firm_admin can view partner trail', async () => {
    const res = await request(app)
      .get(`/api/audit/user/${PARTNER_ID}`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('target_user_id', PARTNER_ID);
  });

  test('200 respects limit', async () => {
    const res = await request(app)
      .get(`/api/audit/user/${USER_ID}?limit=1`)
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/audit/firm
// ═════════════════════════════════════════════════════════════════════════════
describe('GET /api/audit/firm', () => {
  test('401 without token', async () => {
    const res = await request(app).get('/api/audit/firm');
    expect(res.status).toBe(401);
  });

  test('403 for user not in any firm', async () => {
    const res = await request(app)
      .get('/api/audit/firm')
      .set('Authorization', `Bearer ${T_USER}`);
    expect(res.status).toBe(403);
  });

  test('200 for partner with firm membership', async () => {
    const res = await request(app)
      .get('/api/audit/firm')
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('firm_id', FIRM_ID);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  test('200 for firm_admin', async () => {
    const res = await request(app)
      .get('/api/audit/firm')
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('firm_id');
  });

  test('200 filters by resource', async () => {
    const res = await request(app)
      .get('/api/audit/firm?resource=matter')
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(res.status).toBe(200);
    res.body.entries.forEach(e => expect(e.resource).toBe('matter'));
  });

  test('200 filters by user_id', async () => {
    const res = await request(app)
      .get(`/api/audit/firm?user_id=${ADMIN_ID}`)
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(res.status).toBe(200);
    res.body.entries.forEach(e => expect(e.user_id).toBe(ADMIN_ID));
  });

  test('200 respects limit and offset', async () => {
    const res = await request(app)
      .get('/api/audit/firm?limit=1&offset=0')
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(1);
  });
});
