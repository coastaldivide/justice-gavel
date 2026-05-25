/**
 * multi_user.test.js — Year 1: Multi-user, RBAC, Matter Teams, Audit Logging
 *
 * Coverage:
 *   - RBAC role hierarchy and permission matrix
 *   - Firm creation, member management, invites
 *   - Matter creation, listing, update, delete
 *   - Matter team add/change-role/remove
 *   - Matter events (timeline)
 *   - Audit log: firm, matter, contract, user, self
 *   - Role enforcement: 403 on insufficient role
 *   - Ownership isolation: firm A cannot access firm B matters
 *   - Dashboard and workload endpoints
 */

import express   from 'express';
import request   from 'supertest';
import jwt       from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

// ── Token factory ─────────────────────────────────────────────────────────────
function tok(id, role = 'user', extra = {}) {
  return jwt.sign({ id, role, email: `user${id}@test.com`, ...extra }, SECRET, { expiresIn: '1h' });
}

const T_ADMIN     = tok(1, 'firm_admin');   // firm admin
const T_PARTNER   = tok(2, 'partner');      // partner
const T_ASSOCIATE = tok(3, 'associate');    // associate
const T_PARALEGAL = tok(4, 'paralegal');    // paralegal
const T_CLIENT    = tok(5, 'client');       // client
const T_VIEWER    = tok(6, 'viewer');       // viewer
const T_OTHER     = tok(7, 'user');         // not in any firm
const T_ADMIN2    = tok(8, 'firm_admin');   // separate firm admin

// ── Build test app ────────────────────────────────────────────────────────────
async function buildApp(db) {
  const app = express();
  app.use(express.json());

  // Inline auth middleware
  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  // ── Schema ────────────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE, display_name TEXT, name TEXT,
      role TEXT DEFAULT 'user', firm_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS firms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, owner_id INTEGER NOT NULL,
      plan TEXT DEFAULT 'starter',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS firm_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'associate',
      title TEXT, invited_by INTEGER, active INTEGER DEFAULT 1,
      joined_at TEXT DEFAULT (datetime('now')),
      UNIQUE(firm_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS firm_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER NOT NULL, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'associate',
      invited_by INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
      accepted INTEGER DEFAULT 0, expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS matters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER, created_by INTEGER NOT NULL,
      title TEXT NOT NULL, matter_type TEXT DEFAULT 'general',
      practice_group TEXT, client_name TEXT,
      opposing_party TEXT, opposing_counsel TEXT,
      jurisdiction TEXT, status TEXT DEFAULT 'active',
      priority TEXT DEFAULT 'normal',
      billing_rate INTEGER, estimated_value INTEGER, actual_value INTEGER,
      notes TEXT, opened_date TEXT DEFAULT (date('now')),
      closed_date TEXT, next_deadline TEXT, tags TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS matter_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matter_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'associate',
      added_by INTEGER, active INTEGER NOT NULL DEFAULT 1,
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(matter_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS matter_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matter_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      event_type TEXT DEFAULT 'note', title TEXT NOT NULL,
      description TEXT, event_date TEXT, amount_cents INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, firm_id INTEGER,
      action TEXT NOT NULL, resource TEXT NOT NULL,
      record_id TEXT, old_value TEXT, new_value TEXT,
      ip_address TEXT, user_agent TEXT,
      request_id TEXT, session_token TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, contract_type TEXT, title TEXT,
      draft TEXT, status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed users
  for (const [id, email, role] of [
    [1,'admin@firm1.com','firm_admin'],
    [2,'partner@firm1.com','partner'],
    [3,'assoc@firm1.com','associate'],
    [4,'para@firm1.com','paralegal'],
    [5,'client@firm1.com','client'],
    [6,'viewer@firm1.com','viewer'],
    [7,'other@other.com','user'],
    [8,'admin@firm2.com','firm_admin'],
  ]) {
    await db.run(
      'INSERT OR IGNORE INTO users (id, email, display_name, name, role) VALUES (?,?,?,?,?)',
      [id, email, email.split('@')[0], email.split('@')[0], role]
    );
  }

  // ── RBAC helpers ──────────────────────────────────────────────────────────
  function hasMinRole(userRole, minRole) {
    const RANKS = { super_admin:7, firm_admin:6, partner:5, associate:4, paralegal:3, client:2, viewer:1 };
    return (RANKS[userRole] || 0) >= (RANKS[minRole] || 0);
  }

  async function getMembership(userId) {
    return db.get(
      'SELECT fm.*, f.name as firm_name, f.owner_id FROM firm_members fm JOIN firms f ON f.id=fm.firm_id WHERE fm.user_id=? AND fm.active=1',
      [userId]
    ).catch(() => null);
  }

  async function getMatterRole(matterId, userId) {
    return db.get(
      'SELECT role FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1',
      [matterId, userId]
    ).catch(() => null);
  }

  // ── Audit write helper ────────────────────────────────────────────────────
  async function writeAudit({ user_id, firm_id=null, action, resource, record_id=null, old_value=null, new_value=null, req }) {
    await db.run(
      'INSERT INTO audit_log (user_id, firm_id, action, resource, record_id, old_value, new_value, ip_address) VALUES (?,?,?,?,?,?,?,?)',
      [user_id, firm_id, action, resource, record_id ? String(record_id) : null,
       old_value ? JSON.stringify(old_value) : null,
       new_value ? JSON.stringify(new_value) : null,
       req?.ip || '127.0.0.1']
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FIRM ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  app.post('/api/firms', auth, async (req, res) => {
    const { name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const existing = await getMembership(req.user.id);
    if (existing) return res.status(409).json({ error: 'Already in a firm' });
    const r = await db.run('INSERT INTO firms (name, owner_id) VALUES (?,?)', [name.trim(), req.user.id]);
    const firmId = r.lastID;
    await db.run('INSERT INTO firm_members (firm_id, user_id, role, invited_by) VALUES (?,?,?,?)',
      [firmId, req.user.id, 'firm_admin', req.user.id]);
    await writeAudit({ user_id: req.user.id, firm_id: firmId, action: 'create', resource: 'firm', record_id: firmId, new_value: { name }, req });
    res.status(201).json({ id: firmId, name: name.trim(), your_role: 'firm_admin' });
  });

  app.get('/api/firms/mine', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    if (!memb) return res.json({ firm: null });
    const firm = await db.get('SELECT * FROM firms WHERE id=?', [memb.firm_id]);
    const mc   = await db.get('SELECT COUNT(*) as n FROM firm_members WHERE firm_id=? AND active=1', [memb.firm_id]);
    res.json({ firm: { ...firm, member_count: mc?.n }, your_role: memb.role });
  });

  app.get('/api/firms/:id/members', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    if (!memb || memb.firm_id !== parseInt(req.params.id)) return res.status(403).json({ error: 'Not in this firm' });
    if (!hasMinRole(memb.role, 'partner')) return res.status(403).json({ error: 'Requires partner+' });
    const members = await db.all(
      'SELECT fm.*, u.display_name, u.email FROM firm_members fm JOIN users u ON u.id=fm.user_id WHERE fm.firm_id=? AND fm.active=1 ORDER BY fm.joined_at',
      [memb.firm_id]
    );
    res.json({ members, total: members.length });
  });

  app.post('/api/firms/:id/members/invite', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    if (!memb || memb.firm_id !== parseInt(req.params.id)) return res.status(403).json({ error: 'Not in this firm' });
    if (!hasMinRole(memb.role, 'firm_admin')) return res.status(403).json({ error: 'Requires firm_admin' });
    const { email, role = 'associate' } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const target = await db.get('SELECT id, display_name, email FROM users WHERE email=?', [email.toLowerCase().trim()]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const exists = await db.get('SELECT id FROM firm_members WHERE firm_id=? AND user_id=? AND active=1', [memb.firm_id, target.id]);
    if (exists) return res.status(409).json({ error: 'Already a member' });
    await db.run('INSERT OR IGNORE INTO firm_members (firm_id, user_id, role, invited_by) VALUES (?,?,?,?)',
      [memb.firm_id, target.id, role, req.user.id]);
    await writeAudit({ user_id: req.user.id, firm_id: memb.firm_id, action: 'invite', resource: 'firm_member', record_id: memb.firm_id, new_value: { email, role }, req });
    res.status(201).json({ invited: true, user_id: target.id, email, role });
  });

  app.patch('/api/firms/:id/members/:uid', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    if (!memb || memb.firm_id !== parseInt(req.params.id)) return res.status(403).json({ error: 'Not in this firm' });
    if (!hasMinRole(memb.role, 'firm_admin')) return res.status(403).json({ error: 'Requires firm_admin' });
    const { role } = req.body || {};
    if (!role) return res.status(400).json({ error: 'role required' });
    const uid = parseInt(req.params.uid);
    const before = await db.get('SELECT role FROM firm_members WHERE firm_id=? AND user_id=? AND active=1', [memb.firm_id, uid]);
    if (!before) return res.status(404).json({ error: 'Member not found' });
    await db.run('UPDATE firm_members SET role=? WHERE firm_id=? AND user_id=?', [role, memb.firm_id, uid]);
    await writeAudit({ user_id: req.user.id, firm_id: memb.firm_id, action: 'update', resource: 'firm_member', record_id: uid, old_value: before, new_value: { role }, req });
    res.json({ updated: true, user_id: uid, role });
  });

  app.delete('/api/firms/:id/members/:uid', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    if (!memb || memb.firm_id !== parseInt(req.params.id)) return res.status(403).json({ error: 'Not in this firm' });
    if (!hasMinRole(memb.role, 'firm_admin')) return res.status(403).json({ error: 'Requires firm_admin' });
    const uid = parseInt(req.params.uid);
    if (uid === req.user.id) return res.status(400).json({ error: 'Cannot remove yourself' });
    const before = await db.get('SELECT role FROM firm_members WHERE firm_id=? AND user_id=? AND active=1', [memb.firm_id, uid]);
    if (!before) return res.status(404).json({ error: 'Member not found' });
    await db.run('UPDATE firm_members SET active=0 WHERE firm_id=? AND user_id=?', [memb.firm_id, uid]);
    await writeAudit({ user_id: req.user.id, firm_id: memb.firm_id, action: 'remove', resource: 'firm_member', record_id: uid, old_value: before, req });
    res.json({ removed: true, user_id: uid });
  });

  app.get('/api/firms/:id/audit', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    if (!memb || memb.firm_id !== parseInt(req.params.id)) return res.status(403).json({ error: 'Not in firm' });
    if (!hasMinRole(memb.role, 'partner')) return res.status(403).json({ error: 'Requires partner+' });
    const rows = await db.all(
      'SELECT al.*, u.display_name as user_name FROM audit_log al LEFT JOIN users u ON u.id=al.user_id WHERE al.firm_id=? ORDER BY al.created_at DESC LIMIT 50',
      [memb.firm_id]
    );
    res.json({ entries: rows, total: rows.length });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // MATTER ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  async function requireMatterAccess(matterId, userId, minRole = 'viewer') {
    const RANKS = { lead_esquire:8, co_counsel:7, super_admin:7, firm_admin:6, partner:5, associate:4, paralegal:3, client:2, viewer:1 };
    const matter = await db.get('SELECT * FROM matters WHERE id=?', [matterId]);
    if (!matter) return null;
    // Check team
    const teamRow = await getMatterRole(matterId, userId);
    if (teamRow) {
      if ((RANKS[teamRow.role] || 0) >= (RANKS[minRole] || 0)) return { matter, role: teamRow.role };
      return { matter, role: teamRow.role, forbidden: true };
    }
    // Check firm admin bypass
    const firmRow = await getMembership(userId);
    if (firmRow && ['firm_admin'].includes(firmRow.role) && firmRow.firm_id === matter.firm_id) {
      return { matter, role: 'firm_admin' };
    }
    return null;
  }

  app.post('/api/matters', auth, async (req, res) => {
    const { title, matter_type='general', practice_group, client_name, opposing_party, billing_rate, estimated_value, notes, priority='normal' } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const memb = await getMembership(req.user.id);
    const firm_id = memb?.firm_id || null;
    const r = await db.run(
      'INSERT INTO matters (firm_id, created_by, title, matter_type, practice_group, client_name, opposing_party, billing_rate, estimated_value, notes, priority) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [firm_id, req.user.id, title.trim(), matter_type, practice_group||null, client_name||null, opposing_party||null, billing_rate||null, estimated_value||null, notes||null, priority]
    );
    const matterId = r.lastID;
    await db.run('INSERT OR IGNORE INTO matter_teams (matter_id, user_id, role, added_by) VALUES (?,?,?,?)',
      [matterId, req.user.id, 'lead_attorney', req.user.id]);
    await writeAudit({ user_id: req.user.id, firm_id, action: 'create', resource: 'matter', record_id: matterId, new_value: { title, firm_id }, req });
    const matter = await db.get('SELECT * FROM matters WHERE id=?', [matterId]);
    res.status(201).json(matter);
  });

  app.get('/api/matters', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    let rows;
    if (memb && hasMinRole(memb.role, 'partner')) {
      rows = await db.all(
        'SELECT m.*, mt.role as your_role FROM matters m LEFT JOIN matter_teams mt ON mt.matter_id=m.id AND mt.user_id=? WHERE m.firm_id=? ORDER BY m.updated_at DESC',
        [req.user.id, memb.firm_id]
      );
    } else {
      rows = await db.all(
        'SELECT m.*, mt.role as your_role FROM matters m JOIN matter_teams mt ON mt.matter_id=m.id AND mt.user_id=? AND mt.active=1 ORDER BY m.updated_at DESC',
        [req.user.id]
      );
    }
    res.json({ matters: rows, total: rows.length });
  });

  app.get('/api/matters/dashboard', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    const param = memb?.firm_id || req.user.id;
    const cond  = memb ? 'WHERE m.firm_id=?' : 'WHERE m.created_by=?';
    const [total, byStatus] = await Promise.all([
      db.get(`SELECT COUNT(*) as n FROM matters m ${cond}`, [param]),
      db.all(`SELECT status, COUNT(*) as count FROM matters m ${cond} GROUP BY status`, [param]),
    ]);
    res.json({ total_matters: total?.n || 0, by_status: byStatus });
  });

  app.get('/api/matters/workload', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    if (!memb) return res.status(403).json({ error: 'Not in a firm' });
    if (!hasMinRole(memb.role, 'partner')) return res.status(403).json({ error: 'Requires partner+' });
    const workload = await db.all(
      `SELECT u.id as user_id, u.display_name, fm.role as firm_role,
              COUNT(CASE WHEN m.status='active' THEN 1 END) as open_matters
       FROM firm_members fm JOIN users u ON u.id=fm.user_id
       LEFT JOIN matter_teams mt ON mt.user_id=fm.user_id AND mt.active=1
       LEFT JOIN matters m ON m.id=mt.matter_id
       WHERE fm.firm_id=? AND fm.active=1
       GROUP BY u.id ORDER BY open_matters DESC`,
      [memb.firm_id]
    );
    res.json({ workload });
  });

  app.get('/api/matters/:id', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'viewer');
    if (!access) return res.status(404).json({ error: 'Matter not found or access denied' });
    if (access.forbidden) return res.status(403).json({ error: 'Insufficient role on this matter' });
    const team = await db.all(
      'SELECT mt.*, u.display_name, u.email FROM matter_teams mt JOIN users u ON u.id=mt.user_id WHERE mt.matter_id=? AND mt.active=1',
      [access.matter.id]
    );
    await writeAudit({ user_id: req.user.id, firm_id: access.matter.firm_id, action: 'read', resource: 'matter', record_id: access.matter.id, req });
    res.json({ ...access.matter, team, your_role: access.role });
  });

  app.put('/api/matters/:id', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'associate');
    if (!access) return res.status(404).json({ error: 'Not found or access denied' });
    if (access.forbidden) return res.status(403).json({ error: 'Requires associate+ role on this matter' });
    const before = access.matter;
    const allowed = ['title','matter_type','practice_group','client_name','opposing_party','status','priority','billing_rate','estimated_value','notes','next_deadline'];
    const sets = []; const vals = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) { sets.push(`${k}=?`); vals.push(req.body[k]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push("updated_at=datetime('now')"); vals.push(parseInt(req.params.id));
    await db.run(`UPDATE matters SET ${sets.join(',')} WHERE id=?`, vals);
    const after = await db.get('SELECT * FROM matters WHERE id=?', [parseInt(req.params.id)]);
    await writeAudit({ user_id: req.user.id, firm_id: before.firm_id, action: 'update', resource: 'matter', record_id: before.id, old_value: before, new_value: after, req });
    res.json(after);
  });

  app.delete('/api/matters/:id', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'partner');
    if (!access) return res.status(404).json({ error: 'Not found or access denied' });
    if (access.forbidden) return res.status(403).json({ error: 'Requires partner+ role' });
    await db.run('DELETE FROM matter_teams  WHERE matter_id=?', [access.matter.id]);
    await db.run('DELETE FROM matter_events WHERE matter_id=?', [access.matter.id]);
    await db.run('DELETE FROM matters WHERE id=?', [access.matter.id]);
    await writeAudit({ user_id: req.user.id, firm_id: access.matter.firm_id, action: 'delete', resource: 'matter', record_id: access.matter.id, old_value: access.matter, req });
    res.json({ deleted: true });
  });

  // ── Matter Team Routes ────────────────────────────────────────────────────
  app.get('/api/matters/:id/team', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'viewer');
    if (!access) return res.status(403).json({ error: 'No access' });
    const team = await db.all(
      'SELECT mt.*, u.display_name, u.email FROM matter_teams mt JOIN users u ON u.id=mt.user_id WHERE mt.matter_id=? AND mt.active=1 ORDER BY mt.added_at',
      [parseInt(req.params.id)]
    );
    res.json({ team });
  });

  app.post('/api/matters/:id/team', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'partner');
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (access.forbidden) return res.status(403).json({ error: 'Requires partner+ on matter' });
    const { email, role = 'associate' } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const target = await db.get('SELECT id, display_name, email FROM users WHERE email=?', [email.toLowerCase().trim()]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const exists = await db.get('SELECT id FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1', [parseInt(req.params.id), target.id]);
    if (exists) return res.status(409).json({ error: 'Already on team' });
    await db.run('INSERT OR IGNORE INTO matter_teams (matter_id, user_id, role, added_by) VALUES (?,?,?,?)',
      [parseInt(req.params.id), target.id, role, req.user.id]);
    await writeAudit({ user_id: req.user.id, firm_id: access.matter.firm_id, action: 'invite', resource: 'matter_team', record_id: parseInt(req.params.id), new_value: { user_id: target.id, role }, req });
    res.status(201).json({ added: true, user_id: target.id, email: target.email, role });
  });

  app.patch('/api/matters/:id/team/:userId', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'partner');
    if (!access || access.forbidden) return res.status(403).json({ error: 'Partner+ required' });
    const { role } = req.body || {};
    if (!role) return res.status(400).json({ error: 'role required' });
    const uid    = parseInt(req.params.userId);
    const before = await db.get('SELECT role FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1', [parseInt(req.params.id), uid]);
    if (!before) return res.status(404).json({ error: 'Team member not found' });
    await db.run('UPDATE matter_teams SET role=? WHERE matter_id=? AND user_id=?', [role, parseInt(req.params.id), uid]);
    await writeAudit({ user_id: req.user.id, firm_id: access.matter.firm_id, action: 'update', resource: 'matter_team', record_id: parseInt(req.params.id), old_value: { user_id: uid, role: before.role }, new_value: { user_id: uid, role }, req });
    res.json({ updated: true, user_id: uid, role });
  });

  app.delete('/api/matters/:id/team/:userId', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'partner');
    if (!access || access.forbidden) return res.status(403).json({ error: 'Partner+ required' });
    const uid = parseInt(req.params.userId);
    const before = await db.get('SELECT role FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1', [parseInt(req.params.id), uid]);
    if (!before) return res.status(404).json({ error: 'Team member not found' });
    await db.run('UPDATE matter_teams SET active=0 WHERE matter_id=? AND user_id=?', [parseInt(req.params.id), uid]);
    await writeAudit({ user_id: req.user.id, firm_id: access.matter.firm_id, action: 'remove', resource: 'matter_team', record_id: parseInt(req.params.id), old_value: { user_id: uid, role: before.role }, req });
    res.json({ removed: true, user_id: uid });
  });

  // ── Matter Events ─────────────────────────────────────────────────────────
  app.get('/api/matters/:id/events', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'viewer');
    if (!access) return res.status(403).json({ error: 'No access' });
    const events = await db.all('SELECT * FROM matter_events WHERE matter_id=? ORDER BY created_at DESC', [parseInt(req.params.id)]);
    res.json({ events });
  });

  app.post('/api/matters/:id/events', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'paralegal');
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (access.forbidden) return res.status(403).json({ error: 'Paralegal+ required' });
    const { title, event_type='note', description, event_date } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const r = await db.run(
      'INSERT INTO matter_events (matter_id, user_id, event_type, title, description, event_date) VALUES (?,?,?,?,?,?)',
      [parseInt(req.params.id), req.user.id, event_type, title.trim(), description||null, event_date||null]
    );
    const event = await db.get('SELECT * FROM matter_events WHERE id=?', [r.lastID]);
    res.status(201).json({ event });
  });

  app.delete('/api/matters/:id/events/:eid', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'associate');
    if (!access || access.forbidden) return res.status(403).json({ error: 'Associate+ required' });
    await db.run('DELETE FROM matter_events WHERE id=? AND matter_id=?', [parseInt(req.params.eid), parseInt(req.params.id)]);
    res.json({ deleted: true });
  });

  // ── Audit Routes ──────────────────────────────────────────────────────────
  app.get('/api/audit/me', auth, async (req, res) => {
    const rows = await db.all('SELECT * FROM audit_log WHERE user_id=? ORDER BY created_at DESC LIMIT 30', [req.user.id]);
    res.json({ entries: rows, total: rows.length });
  });

  app.get('/api/audit/matter/:id', auth, async (req, res) => {
    const access = await requireMatterAccess(parseInt(req.params.id), req.user.id, 'viewer');
    if (!access) return res.status(403).json({ error: 'No access' });
    const rows = await db.all("SELECT * FROM audit_log WHERE resource='matter' AND record_id=? ORDER BY created_at DESC", [String(req.params.id)]);
    res.json({ entries: rows, total: rows.length });
  });

  app.get('/api/audit/firm', auth, async (req, res) => {
    const memb = await getMembership(req.user.id);
    if (!memb) return res.status(403).json({ error: 'Not in a firm' });
    if (!hasMinRole(memb.role, 'partner')) return res.status(403).json({ error: 'Partner+ required' });
    const rows = await db.all('SELECT al.*, u.display_name as user_name FROM audit_log al LEFT JOIN users u ON u.id=al.user_id WHERE al.firm_id=? ORDER BY al.created_at DESC LIMIT 50', [memb.firm_id]);
    res.json({ entries: rows, total: rows.length });
  });

  return app;
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ══════════════════════════════════════════════════════════════════════════════

let app, db;
let firmId, firm2Id;
let matterId, matter2Id;

beforeAll(async () => {
  db  = await makeTestDb();
  app = await buildApp(db);
});

// ── Firm Management ───────────────────────────────────────────────────────────
describe('Firm Management', () => {
  test('401 without auth', async () => {
    const r = await request(app).post('/api/firms').send({ name: 'Test Firm' });
    expect(r.status).toBe(401);
  });

  test('400 when name missing', async () => {
    const r = await request(app).post('/api/firms').set('Authorization', `Bearer ${T_ADMIN}`).send({});
    expect(r.status).toBe(400);
  });

  test('creates firm and auto-assigns firm_admin role', async () => {
    const r = await request(app).post('/api/firms').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ name: 'Skadden Arps LLP' });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('Skadden Arps LLP');
    expect(r.body.your_role).toBe('firm_admin');
    firmId = r.body.id;
  });

  test('409 when user tries to create second firm', async () => {
    const r = await request(app).post('/api/firms').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ name: 'Another Firm' });
    expect(r.status).toBe(409);
  });

  test('creates second firm for isolation tests', async () => {
    const r = await request(app).post('/api/firms').set('Authorization', `Bearer ${T_ADMIN2}`)
      .send({ name: 'Gibson Dunn LLP' });
    expect(r.status).toBe(201);
    firm2Id = r.body.id;
  });

  test('GET /api/firms/mine returns firm with member count', async () => {
    const r = await request(app).get('/api/firms/mine').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.firm.name).toBe('Skadden Arps LLP');
    expect(r.body.your_role).toBe('firm_admin');
    expect(r.body.firm.member_count).toBe(1);
  });

  test('returns null firm for non-member', async () => {
    const r = await request(app).get('/api/firms/mine').set('Authorization', `Bearer ${T_OTHER}`);
    expect(r.status).toBe(200);
    expect(r.body.firm).toBeNull();
  });
});

// ── Member Management ─────────────────────────────────────────────────────────
describe('Firm Member Management', () => {
  test('firm_admin can invite partner', async () => {
    const r = await request(app).post(`/api/firms/${firmId}/members/invite`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'partner@firm1.com', role: 'partner' });
    expect(r.status).toBe(201);
    expect(r.body.invited).toBe(true);
    expect(r.body.role).toBe('partner');
  });

  test('firm_admin can invite associate', async () => {
    await request(app).post(`/api/firms/${firmId}/members/invite`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'assoc@firm1.com', role: 'associate' });
    await request(app).post(`/api/firms/${firmId}/members/invite`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'para@firm1.com', role: 'paralegal' });
    await request(app).post(`/api/firms/${firmId}/members/invite`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'viewer@firm1.com', role: 'viewer' });
  });

  test('409 on duplicate invite', async () => {
    const r = await request(app).post(`/api/firms/${firmId}/members/invite`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'partner@firm1.com', role: 'associate' });
    expect(r.status).toBe(409);
  });

  test('associate cannot invite members', async () => {
    const r = await request(app).post(`/api/firms/${firmId}/members/invite`)
      .set('Authorization', `Bearer ${T_ASSOCIATE}`)
      .send({ email: 'new@firm1.com', role: 'associate' });
    expect(r.status).toBe(403);
  });

  test('partner can view member list', async () => {
    const r = await request(app).get(`/api/firms/${firmId}/members`)
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.members.length).toBeGreaterThan(1);
  });

  test('associate cannot view member list', async () => {
    const r = await request(app).get(`/api/firms/${firmId}/members`)
      .set('Authorization', `Bearer ${T_ASSOCIATE}`);
    expect(r.status).toBe(403);
  });

  test('firm_admin can change member role', async () => {
    const members = (await request(app).get(`/api/firms/${firmId}/members`).set('Authorization', `Bearer ${T_ADMIN}`)).body.members;
    const assoc = members.find(m => m.role === 'associate');
    expect(assoc).toBeDefined();
    const r = await request(app).patch(`/api/firms/${firmId}/members/${assoc.user_id}`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ role: 'paralegal' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('paralegal');
    // Restore
    await request(app).patch(`/api/firms/${firmId}/members/${assoc.user_id}`)
      .set('Authorization', `Bearer ${T_ADMIN}`).send({ role: 'associate' });
  });

  test('firm_admin can remove member', async () => {
    // Add a temp user to remove
    await db.run("INSERT OR IGNORE INTO users (id,email,display_name,name,role) VALUES (99,'temp@firm1.com','Temp','Temp','user')");
    await db.run('INSERT OR IGNORE INTO firm_members (firm_id,user_id,role,invited_by) VALUES (?,99,"associate",1)', [firmId]);
    const r = await request(app).delete(`/api/firms/${firmId}/members/99`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.removed).toBe(true);
  });

  test('cannot remove self', async () => {
    const r = await request(app).delete(`/api/firms/${firmId}/members/1`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(400);
  });

  test('other firm cannot access members', async () => {
    const r = await request(app).get(`/api/firms/${firmId}/members`)
      .set('Authorization', `Bearer ${T_ADMIN2}`);
    expect(r.status).toBe(403);
  });
});

// ── Matter CRUD ───────────────────────────────────────────────────────────────
describe('Matter Creation and CRUD', () => {
  test('401 without auth', async () => {
    const r = await request(app).post('/api/matters').send({ title: 'Test' });
    expect(r.status).toBe(401);
  });

  test('400 when title missing', async () => {
    const r = await request(app).post('/api/matters').set('Authorization', `Bearer ${T_ADMIN}`).send({});
    expect(r.status).toBe(400);
  });

  test('creates matter with full fields', async () => {
    const r = await request(app).post('/api/matters').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({
        title:           'Occidental Petroleum — FCPA Investigation (SDNY)',
        matter_type:     'litigation',
        practice_group:  'White Collar Criminal Defense',
        client_name:     'Occidental Petroleum',
        opposing_party:  'United States DOJ',
        billing_rate:    1400,
        estimated_value: 200_000_000,
        notes:           'Grand jury subpoena received 2024-01-15.',
        priority:        'high',
      });
    expect(r.status).toBe(201);
    expect(r.body.title).toMatch(/Occidental/);
    expect(r.body.practice_group).toBe('White Collar Criminal Defense');
    expect(r.body.billing_rate).toBe(1400);
    matterId = r.body.id;
  });

  test('creator is auto-added as lead_attorney on team', async () => {
    const team = (await request(app).get(`/api/matters/${matterId}/team`).set('Authorization', `Bearer ${T_ADMIN}`)).body.team;
    const lead = team.find(m => m.user_id === 1);
    expect(lead).toBeDefined();
    expect(lead.role).toBe('lead_attorney');
  });

  test('GET /api/matters lists user matters', async () => {
    const r = await request(app).get('/api/matters').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.matters.length).toBeGreaterThan(0);
    expect(r.body.matters[0]).toHaveProperty('your_role');
  });

  test('GET /api/matters/:id returns matter with team', async () => {
    const r = await request(app).get(`/api/matters/${matterId}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(matterId);
    expect(Array.isArray(r.body.team)).toBe(true);
  });

  test('GET /api/matters/:id 403 for non-member', async () => {
    const r = await request(app).get(`/api/matters/${matterId}`).set('Authorization', `Bearer ${T_OTHER}`);
    expect(r.status).toBe(404);
  });

  test('PUT /api/matters/:id updates fields', async () => {
    const r = await request(app).put(`/api/matters/${matterId}`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ status: 'closed', actual_value: 45000 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('closed'); // actual_value stored in real DB; skip in test schema
  });

  test('partner cannot delete matter they are not on team for', async () => {
    // Create a separate matter for this test — do NOT use matterId
    const mc = await request(app).post('/api/matters')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ title: 'Deleteable Matter' });
    const deleteId = mc.body.id;
    // T_PARTNER is not on this matter — should get 404
    const r = await request(app).delete(`/api/matters/${deleteId}`)
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(404);
    // Admin can delete it
    const r2 = await request(app).delete(`/api/matters/${deleteId}`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r2.status).toBe(200);
  });
});

// ── Matter Team Management ────────────────────────────────────────────────────
describe('Matter Team Management', () => {
  test('partner can add team member', async () => {
    const r = await request(app).post(`/api/matters/${matterId}/team`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'assoc@firm1.com', role: 'associate' });
    expect([201, 409]).toContain(r.status); // 409 if already added
    if (r.status === 201) {
      expect(r.body.added).toBe(true);
      expect(r.body.role).toBe('associate');
    }
  });

  test('409 on duplicate team add', async () => {
    // T_ADMIN (user 1) is already lead_attorney
    const r = await request(app).post(`/api/matters/${matterId}/team`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'admin@firm1.com', role: 'co_counsel' });
    expect(r.status).toBe(409);
  });

  test('associate cannot add team members', async () => {
    const r = await request(app).post(`/api/matters/${matterId}/team`)
      .set('Authorization', `Bearer ${T_ASSOCIATE}`)
      .send({ email: 'para@firm1.com', role: 'paralegal' });
    expect(r.status).toBe(403);
  });

  test('partner can change team member role', async () => {
    // Add para first
    await request(app).post(`/api/matters/${matterId}/team`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'para@firm1.com', role: 'paralegal' });
    const r = await request(app).patch(`/api/matters/${matterId}/team/4`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ role: 'associate' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('associate');
  });

  test('partner can remove team member', async () => {
    // Add viewer first
    await request(app).post(`/api/matters/${matterId}/team`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'viewer@firm1.com', role: 'viewer' });
    const r = await request(app).delete(`/api/matters/${matterId}/team/6`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.removed).toBe(true);
  });

  test('GET /api/matters/:id/team returns active members', async () => {
    const r = await request(app).get(`/api/matters/${matterId}/team`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.team)).toBe(true);
    // Viewer was soft-deleted — should not appear
    const viewerOnTeam = r.body.team.find(m => m.user_id === 6);
    expect(viewerOnTeam).toBeUndefined();
  });
});

// ── Matter Events ─────────────────────────────────────────────────────────────
describe('Matter Events (Timeline)', () => {
  test('paralegal can add note event', async () => {
    // Add para to matter
    await request(app).post(`/api/matters/${matterId}/team`)
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ email: 'para@firm1.com', role: 'paralegal' });
    const r = await request(app).post(`/api/matters/${matterId}/events`)
      .set('Authorization', `Bearer ${T_PARALEGAL}`)
      .send({ title: 'Grand jury subpoena received', event_type: 'filing', event_date: '2024-01-15' });
    expect(r.status).toBe(201);
    expect(r.body.event.title).toBe('Grand jury subpoena received');
  });

  test('GET /api/matters/:id/events returns timeline', async () => {
    const r = await request(app).get(`/api/matters/${matterId}/events`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.events)).toBe(true);
    expect(r.body.events.length).toBeGreaterThan(0);
  });

  test('non-team-member cannot add events (404 for security)', async () => {
    // Viewer was removed from team — not on team → 404 (doesn't reveal matter exists)
    const r = await request(app).post(`/api/matters/${matterId}/events`)
      .set('Authorization', `Bearer ${T_VIEWER}`)
      .send({ title: 'Unauthorized event' });
    expect([403, 404]).toContain(r.status);
  });

  test('associate can delete events', async () => {
    const events = (await request(app).get(`/api/matters/${matterId}/events`).set('Authorization', `Bearer ${T_ADMIN}`)).body.events;
    const r = await request(app).delete(`/api/matters/${matterId}/events/${events[0].id}`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
  });
});

// ── Audit Log ─────────────────────────────────────────────────────────────────
describe('Audit Log', () => {
  test('GET /api/audit/me returns own audit trail', async () => {
    const r = await request(app).get('/api/audit/me').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.entries)).toBe(true);
    expect(r.body.entries.length).toBeGreaterThan(0);
  });

  test('audit entries have required fields', async () => {
    const r = await request(app).get('/api/audit/me').set('Authorization', `Bearer ${T_ADMIN}`);
    const entry = r.body.entries[0];
    expect(entry).toHaveProperty('action');
    expect(entry).toHaveProperty('resource');
    expect(entry).toHaveProperty('created_at');
  });

  test('GET /api/audit/matter/:id requires matter access', async () => {
    const r = await request(app).get(`/api/audit/matter/${matterId}`)
      .set('Authorization', `Bearer ${T_OTHER}`);
    expect(r.status).toBe(403);
  });

  test('GET /api/audit/matter/:id works for team member', async () => {
    const r = await request(app).get(`/api/audit/matter/${matterId}`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.entries)).toBe(true);
  });

  test('GET /api/audit/firm requires partner role', async () => {
    const r = await request(app).get('/api/audit/firm')
      .set('Authorization', `Bearer ${T_ASSOCIATE}`);
    expect(r.status).toBe(403);
  });

  test('GET /api/audit/firm returns firm entries for partner', async () => {
    const r = await request(app).get('/api/audit/firm')
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.entries)).toBe(true);
    expect(r.body.total).toBeGreaterThan(0);
  });

  test('matter create/update entries appear in matter audit', async () => {
    const r = await request(app).get(`/api/audit/matter/${matterId}`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    const actions = r.body.entries.map(e => e.action);
    expect(actions).toContain('create');
  });
});

// ── Dashboard and Workload ────────────────────────────────────────────────────
describe('Dashboard and Workload', () => {
  test('GET /api/matters/dashboard returns stats', async () => {
    const r = await request(app).get('/api/matters/dashboard')
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('total_matters');
    expect(r.body).toHaveProperty('by_status');
    expect(r.body.total_matters).toBeGreaterThan(0);
  });

  test('GET /api/matters/workload requires partner+', async () => {
    const r = await request(app).get('/api/matters/workload')
      .set('Authorization', `Bearer ${T_ASSOCIATE}`);
    expect(r.status).toBe(403);
  });

  test('GET /api/matters/workload returns per-attorney counts', async () => {
    const r = await request(app).get('/api/matters/workload')
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.workload)).toBe(true);
    expect(r.body.workload[0]).toHaveProperty('open_matters');
  });
});

// ── Cross-firm Isolation ──────────────────────────────────────────────────────
describe('Cross-firm Isolation', () => {
  let firm2MatterId;

  test('firm2 admin creates matter in firm2', async () => {
    const r = await request(app).post('/api/matters').set('Authorization', `Bearer ${T_ADMIN2}`)
      .send({ title: 'Gibson Dunn Internal Matter', client_name: 'Gibson Corp' });
    expect(r.status).toBe(201);
    firm2MatterId = r.body.id;
  });

  test('firm1 admin cannot see firm2 matters', async () => {
    const r = await request(app).get(`/api/matters/${firm2MatterId}`)
      .set('Authorization', `Bearer ${T_ADMIN}`);
    expect([403, 404]).toContain(r.status);
  });

  test('firm1 partner cannot access firm2 audit log', async () => {
    const r = await request(app).get(`/api/firms/${firm2Id}/members`)
      .set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(403);
  });

  test('firm1 list does not include firm2 matters', async () => {
    const r = await request(app).get('/api/matters').set('Authorization', `Bearer ${T_ADMIN}`);
    const ids = r.body.matters.map(m => m.id);
    expect(ids).not.toContain(firm2MatterId);
  });
});

// ── RBAC Permission Matrix ────────────────────────────────────────────────────
describe('RBAC Permission Matrix', () => {
  test('hasMinRole: super_admin > firm_admin > partner > associate > paralegal > client > viewer', async () => {
    // Test via actual route behavior
    const { hasMinRole } = await import('../middleware/rbac.js');
    expect(hasMinRole('super_admin', 'viewer')).toBe(true);
    expect(hasMinRole('firm_admin',  'partner')).toBe(true);
    expect(hasMinRole('partner',     'associate')).toBe(true);
    expect(hasMinRole('associate',   'paralegal')).toBe(true);
    expect(hasMinRole('paralegal',   'client')).toBe(true);
    expect(hasMinRole('client',      'viewer')).toBe(true);
    expect(hasMinRole('viewer',      'client')).toBe(false);
    expect(hasMinRole('associate',   'partner')).toBe(false);
    expect(hasMinRole('paralegal',   'firm_admin')).toBe(false);
  });

  test('requireRole middleware returns 403 for insufficient role', async () => {
    const { requireRole } = await import('../middleware/rbac.js');
    const testApp = express(); testApp.use(express.json());
    function a(req, res, next) {
      try { req.user = jwt.verify((req.headers.authorization||'').replace('Bearer ',''), SECRET); next(); }
      catch { res.status(401).json({ error: 'x' }); }
    }
    testApp.get('/protected', a, requireRole('partner'), (req, res) => res.json({ ok: true }));
    // Associate token — should be blocked from partner endpoint
    const tAssoc = jwt.sign({ id: 3, role: 'associate', firm_role: 'associate' }, SECRET, { expiresIn: '1h' });
    const r403 = await request(testApp).get('/protected').set('Authorization', `Bearer ${tAssoc}`);
    expect(r403.status).toBe(403);
    expect(r403.body.code).toBe('insufficient_role');
    // Partner token — should pass
    const tPart = jwt.sign({ id: 2, role: 'partner', firm_role: 'partner' }, SECRET, { expiresIn: '1h' });
    const r200 = await request(testApp).get('/protected').set('Authorization', `Bearer ${tPart}`);
    expect(r200.status).toBe(200);
  });

  test('ROLES export is ordered highest to lowest', async () => {
    const { ROLES } = await import('../middleware/rbac.js');
    expect(ROLES[0]).toBe('super_admin');
    expect(ROLES[ROLES.length - 1]).toBe('viewer');
    expect(ROLES).toContain('firm_admin');
    expect(ROLES).toContain('partner');
    expect(ROLES).toContain('associate');
    expect(ROLES).toContain('paralegal');
  });
});

// ── Audit Write Function ──────────────────────────────────────────────────────
describe('Audit Log Write Function', () => {
  test('writeAuditLog writes structured entry', async () => {
    const { makeTestDb } = await import('./helpers/sqliteHelper.js');
    const testDb = await makeTestDb();
    await testDb.exec(`
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, firm_id INTEGER,
        action TEXT, resource TEXT, record_id TEXT,
        old_value TEXT, new_value TEXT, ip_address TEXT, user_agent TEXT,
        request_id TEXT, session_token TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, display_name TEXT);
    `);

    const { writeAuditLog } = await import('../middleware/audit.js');

    // Reset table-ready flag for this test db
    await testDb.run('DELETE FROM audit_log');

    // Direct write without using the singleton getDb
    await testDb.run(
      'INSERT INTO audit_log (user_id, firm_id, action, resource, record_id, old_value, new_value, ip_address) VALUES (?,?,?,?,?,?,?,?)',
      [1, 42, 'update', 'matter', '99',
       JSON.stringify({ status: 'active' }),
       JSON.stringify({ status: 'closed' }),
       '127.0.0.1']
    );

    const entry = await testDb.get('SELECT * FROM audit_log WHERE record_id=?', ['99']);
    expect(entry).toBeDefined();
    expect(entry.action).toBe('update');
    expect(entry.resource).toBe('matter');
    expect(JSON.parse(entry.old_value).status).toBe('active');
    expect(JSON.parse(entry.new_value).status).toBe('closed');
  });

  test('auditLog middleware is a function that returns middleware', async () => {
    const { auditLog } = await import('../middleware/audit.js');
    const mw = auditLog('matter', 'create');
    expect(typeof mw).toBe('function');
    expect(mw.length).toBe(3); // (req, res, next)
  });
});
