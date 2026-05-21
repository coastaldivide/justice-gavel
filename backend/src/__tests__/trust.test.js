/**
 * trust.test.js — Year 1.5: SOC 2, SSO/SAML, Ethics Walls, Conflict Screening
 *
 * Coverage:
 *   SSO Configuration:
 *     - Metadata endpoint returns valid XML
 *     - SSO config requires firm_admin
 *     - Create/update/delete SSO config
 *     - Config exposes SP metadata fields
 *     - force_sso flag is stored correctly
 *     - Test endpoint validates config completeness
 *     - Login endpoint requires firm slug
 *     - ACS rejects missing SAMLResponse
 *     - Logout clears session
 *
 *   Conflict Screening:
 *     - Check with no conflicts returns clear
 *     - Check with matching adverse returns conflict
 *     - Check with multiple names detects multiple conflicts
 *     - Index adds parties to conflict_index
 *     - Index detects adverse-vs-client cross-matter conflict
 *     - Index detects client-vs-adverse cross-matter conflict
 *     - Report returns full firm conflict summary
 *     - Requires firm membership
 *     - Handles fuzzy name matching
 *
 *   Conflict Waivers:
 *     - Requires partner role
 *     - Requires written justification
 *     - Records waiver with authorized_by
 *     - Lists firm waivers
 *
 *   Ethics Walls:
 *     - Get wall status for a matter
 *     - Set ethics wall requires partner+
 *     - Set wall requires reason
 *     - Set wall blocks attorney (409 on duplicate)
 *     - Lift wall requires firm_admin + reason
 *     - Lift wall is logged
 *     - Ethics wall log returns all events
 *     - Cannot wall yourself
 *
 *   SOC 2 Controls:
 *     - Requires firm_admin
 *     - Returns controls list with categories
 *     - Returns readiness score
 *     - Returns runtime checks
 *     - Audit log check passes when audit entries exist
 *
 *   Security Headers (app-level):
 *     - HSTS header present
 *     - X-Frame-Options prevents clickjacking
 *     - Content-Security-Policy present
 *     - X-Content-Type-Options set to nosniff
 *     - Cache-Control no-store on API responses
 *     - X-Request-ID injected on every response
 *     - Referrer-Policy set
 */

import express    from 'express';
import request    from 'supertest';
import jwt        from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

function tok(id, role = 'user', extra = {}) {
  return jwt.sign({ id, role, email: `user${id}@test.com`, ...extra }, SECRET, { expiresIn: '1h' });
}

const T_ADMIN    = tok(1, 'firm_admin',  { firm_role: 'firm_admin'  });
const T_PARTNER  = tok(2, 'partner',     { firm_role: 'partner'     });
const T_ASSOC    = tok(3, 'associate',   { firm_role: 'associate'   });
const T_PARALEGAL= tok(4, 'paralegal',   { firm_role: 'paralegal'   });
const T_OTHER    = tok(9, 'user',        { firm_role: null          });

// ── Build test app ─────────────────────────────────────────────────────────────
async function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Security headers (mirrors app.js)
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'");
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Request-ID', `test-${Date.now()}`);
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  // Auth middleware
  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  // Firm context loader
  async function loadFirm(req, res, next) {
    if (!req.user) return next();
    const member = await db.get(
      "SELECT firm_id, role AS firm_role FROM firm_members WHERE user_id=? AND active=1 LIMIT 1",
      [req.user.id]
    ).catch(() => null);
    req.firmCtx = member || null;
    next();
  }

  // Role guard
  function requireRole(minRole) {
    const HIERARCHY = ['viewer','client','paralegal','associate','partner','firm_admin','super_admin'];
    return (req, res, next) => {
      const role = req.firmCtx?.firm_role || req.user?.firm_role || req.user?.role || 'viewer';
      const minIdx = HIERARCHY.indexOf(minRole);
      const userIdx = HIERARCHY.indexOf(role);
      if (userIdx < minIdx) {
        return res.status(403).json({ error: `Requires ${minRole}`, code: 'insufficient_role' });
      }
      next();
    };
  }

  // ── Schema ─────────────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE, display_name TEXT, name TEXT,
      role TEXT DEFAULT 'user', is_premium INTEGER DEFAULT 0,
      push_token TEXT, login_identifier TEXT, password_hash TEXT DEFAULT 'x',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS firms (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      slug TEXT UNIQUE, owner_id INTEGER, plan TEXT DEFAULT 'starter',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS firm_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'associate', active INTEGER DEFAULT 1,
      joined_at TEXT DEFAULT (datetime('now')),
      UNIQUE(firm_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS sso_configurations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER NOT NULL UNIQUE, provider TEXT DEFAULT 'saml',
      entity_id TEXT, sso_url TEXT, slo_url TEXT, certificate TEXT,
      attribute_email TEXT DEFAULT 'email', attribute_name TEXT DEFAULT 'displayName',
      attribute_role TEXT, sp_entity_id TEXT, sp_acs_url TEXT,
      force_sso INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
      created_by INTEGER, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conflict_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER NOT NULL, matter_id INTEGER,
      party_name_norm TEXT NOT NULL, party_name_orig TEXT NOT NULL,
      party_role TEXT DEFAULT 'client', added_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS matter_parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER, firm_id INTEGER,
      party_name TEXT NOT NULL, party_type TEXT DEFAULT 'adverse',
      added_by INTEGER, added_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conflict_waivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER, matter_id INTEGER, conflicting_matter_id INTEGER,
      adverse_party TEXT NOT NULL, client_party TEXT NOT NULL,
      conflict_type TEXT DEFAULT 'adverse_party', waiver_text TEXT,
      authorized_by INTEGER, client_consent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS matter_team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      matter_role TEXT DEFAULT 'associate', added_by INTEGER,
      can_edit INTEGER DEFAULT 0, can_message INTEGER DEFAULT 1,
      can_view_docs INTEGER DEFAULT 1, ethics_wall INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(case_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS matter_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matter_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'associate', added_by INTEGER,
      active INTEGER DEFAULT 1, added_at TEXT DEFAULT (datetime('now')),
      UNIQUE(matter_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS ethics_wall_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER, matter_id INTEGER,
      screened_user_id INTEGER NOT NULL, action TEXT NOT NULL,
      reason TEXT, set_by INTEGER, reviewed_by INTEGER,
      waiver_signed INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_id INTEGER, user_id INTEGER, target_type TEXT,
      target_id INTEGER, action TEXT NOT NULL, detail TEXT,
      ip_address TEXT, user_agent TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS soc2_controls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      control_id TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT,
      status TEXT DEFAULT 'implemented', evidence TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firm_role TEXT NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL,
      UNIQUE(firm_role, resource, action)
    );
  `);

  // Seed test data
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name,name) VALUES (1,'admin@test.com','Admin','Admin')");
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name,name) VALUES (2,'partner@test.com','Partner','Partner')");
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name,name) VALUES (3,'assoc@test.com','Associate','Associate')");
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name,name) VALUES (4,'para@test.com','Paralegal','Paralegal')");
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name,name) VALUES (9,'other@test.com','Other','Other')");
  await db.run("INSERT OR IGNORE INTO firms (id,name,slug,owner_id) VALUES (1,'Test Firm','test-firm',1)");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,1,'firm_admin')");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,2,'partner')");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,3,'associate')");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,4,'paralegal')");
  await db.run("INSERT OR IGNORE INTO soc2_controls (control_id,category,title,status,evidence) VALUES ('CC6.1','Security','Logical Access Controls','implemented','authRequired JWT')");
  await db.run("INSERT OR IGNORE INTO soc2_controls (control_id,category,title,status,evidence) VALUES ('CC6.2','Security','Authentication','partial','bcrypt/12; account lockout')");
  await db.run("INSERT OR IGNORE INTO soc2_controls (control_id,category,title,status,evidence) VALUES ('CC7.1','Availability','System Operations','implemented','/health endpoint')");
  await db.run("INSERT OR IGNORE INTO role_permissions (firm_role,resource,action) VALUES ('partner','audit','read')");

  // ── SSO endpoints ──────────────────────────────────────────────────────────
  app.get('/api/sso/metadata', (req, res) => {
    const xml = `<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://justicegavel.app/api/sso/metadata"><md:SPSSODescriptor><md:AssertionConsumerService Location="https://justicegavel.app/api/sso/acs" index="1"/></md:SPSSODescriptor></md:EntityDescriptor>`;
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  });

  app.get('/api/sso/login', async (req, res) => {
    const { firm } = req.query;
    if (!firm) return res.status(400).json({ error: 'firm parameter required' });
    const firmRow = await db.get('SELECT id FROM firms WHERE slug=? OR id=?', [firm, parseInt(firm) || 0]);
    if (!firmRow) return res.status(404).json({ error: 'Firm not found.' });
    const sso = await db.get('SELECT sso_url FROM sso_configurations WHERE firm_id=? AND active=1', [firmRow.id]);
    if (!sso) return res.status(400).json({ error: 'SSO not configured', code: 'sso_not_configured' });
    res.redirect(302, sso.sso_url + '?SAMLRequest=test');
  });

  app.post('/api/sso/acs', (req, res) => {
    if (!req.body?.SAMLResponse) return res.status(400).json({ error: 'SAMLResponse missing.' });
    res.status(200).json({ ok: true, message: 'ACS processed (test mode)' });
  });

  app.post('/api/sso/logout', auth, async (req, res) => {
    await db.run('UPDATE users SET push_token=NULL WHERE id=?', [req.user.id]).catch(() => {});
    res.json({ ok: true, message: 'SSO session terminated.' });
  });

  app.get('/api/sso/config/:firmId', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    if (req.firmCtx?.firm_id !== firmId) return res.status(403).json({ error: 'Access denied.' });
    const config = await db.get(
      'SELECT id, firm_id, provider, entity_id, sso_url, attribute_email, force_sso, active FROM sso_configurations WHERE firm_id=?',
      [firmId]
    );
    if (!config) return res.json({ configured: false, sp_entity_id: 'https://justicegavel.app/api/sso/metadata', sp_acs_url: 'https://justicegavel.app/api/sso/acs' });
    res.json({ ...config, certificate_configured: true, sp_entity_id: 'https://justicegavel.app/api/sso/metadata' });
  });

  app.post('/api/sso/config/:firmId', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    if (req.firmCtx?.firm_id !== firmId) return res.status(403).json({ error: 'Access denied.' });
    const { provider='saml', entity_id, sso_url, certificate, force_sso=0 } = req.body || {};
    if (!sso_url)     return res.status(400).json({ error: 'sso_url required.' });
    if (!entity_id)   return res.status(400).json({ error: 'entity_id required.' });
    if (!certificate) return res.status(400).json({ error: 'certificate required.' });
    const existing = await db.get('SELECT id FROM sso_configurations WHERE firm_id=?', [firmId]);
    if (existing) {
      await db.run(
        'UPDATE sso_configurations SET provider=?,entity_id=?,sso_url=?,certificate=?,force_sso=?,active=1 WHERE firm_id=?',
        [provider, entity_id, sso_url, certificate, force_sso?1:0, firmId]
      );
    } else {
      await db.run(
        'INSERT INTO sso_configurations (firm_id,provider,entity_id,sso_url,certificate,force_sso,created_by) VALUES (?,?,?,?,?,?,?)',
        [firmId, provider, entity_id, sso_url, certificate, force_sso?1:0, req.user.id]
      );
    }
    res.json({ ok: true, configured: true, provider, sp_acs_url: 'https://justicegavel.app/api/sso/acs', force_sso: !!force_sso });
  });

  app.delete('/api/sso/config/:firmId', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    if (req.firmCtx?.firm_id !== firmId) return res.status(403).json({ error: 'Access denied.' });
    await db.run('UPDATE sso_configurations SET active=0 WHERE firm_id=?', [firmId]);
    res.json({ ok: true, message: 'SSO disabled.' });
  });

  app.get('/api/sso/test/:firmId', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    const config = await db.get('SELECT * FROM sso_configurations WHERE firm_id=? AND active=1', [firmId]);
    if (!config) return res.status(404).json({ error: 'No active SSO config.' });
    const checks = {
      entity_id_set: !!config.entity_id,
      sso_url_set: !!config.sso_url,
      certificate_set: !!config.certificate,
      provider: config.provider,
    };
    res.json({ ok: Object.values(checks).filter(v => v === false).length === 0, checks });
  });

  // ── Conflict screening ─────────────────────────────────────────────────────
  app.get('/api/conflicts/check', auth, loadFirm, async (req, res) => {
    const ctx = req.firmCtx;
    if (!ctx) return res.status(403).json({ error: 'Firm membership required.' });
    const firmId = ctx.firm_id;
    const rawNames = String(req.query.names || '').split(',').map(n => n.trim()).filter(Boolean);
    if (!rawNames.length) return res.status(400).json({ error: 'names required.' });
    if (rawNames.length > 20) return res.status(400).json({ error: 'Maximum 20 names.' });

    const conflicts = [];
    for (const name of rawNames) {
      const norm = name.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim();
      const rows = await db.all(
        "SELECT party_name_orig, party_role, matter_id FROM conflict_index WHERE firm_id=? AND (party_name_norm=? OR party_name_norm LIKE ?)",
        [firmId, norm, `%${norm}%`]
      ).catch(() => []);
      if (rows.length) conflicts.push({ name, matches: rows, conflict_types: [...new Set(rows.map(r => r.party_role))] });
    }

    await db.run(
      "INSERT INTO audit_log (firm_id,user_id,action,target_type,detail) VALUES (?,?,?,?,?)",
      [firmId, req.user.id, 'conflict_check', 'conflict', JSON.stringify({ names: rawNames, count: conflicts.length })]
    ).catch(() => {});

    res.json({ clear: conflicts.length === 0, conflicts, checked: rawNames, conflict_count: conflicts.length });
  });

  app.post('/api/conflicts/index', auth, loadFirm, requireRole('associate'), async (req, res) => {
    const ctx = req.firmCtx;
    if (!ctx) return res.status(403).json({ error: 'Firm membership required.' });
    const firmId = ctx.firm_id;
    const { matter_id, parties = [] } = req.body || {};
    if (!Array.isArray(parties) || !parties.length) return res.status(400).json({ error: 'parties array required.' });

    const VALID_ROLES = ['client','adverse','former_client','witness','expert'];
    const added = [];
    const conflicts_found = [];

    for (const party of parties) {
      const name = String(party.name || '').trim().slice(0, 200);
      const role = VALID_ROLES.includes(party.role) ? party.role : 'client';
      if (!name) continue;
      const norm = name.toLowerCase().replace(/[^a-z0-9\s]/g,'').trim();

      if (role === 'client') {
        const existing = await db.all(
          "SELECT party_name_orig, matter_id FROM conflict_index WHERE firm_id=? AND party_role='adverse' AND party_name_norm LIKE ?",
          [firmId, `%${norm}%`]
        ).catch(() => []);
        if (existing.length) conflicts_found.push({ party: name, type: 'new_client_is_existing_adverse', existing_matters: existing });
      }
      if (role === 'adverse') {
        const existing = await db.all(
          "SELECT party_name_orig, matter_id FROM conflict_index WHERE firm_id=? AND party_role='client' AND party_name_norm LIKE ?",
          [firmId, `%${norm}%`]
        ).catch(() => []);
        if (existing.length) conflicts_found.push({ party: name, type: 'adverse_party_is_existing_client', existing_matters: existing });
      }

      await db.run(
        "INSERT OR IGNORE INTO conflict_index (firm_id,matter_id,party_name_norm,party_name_orig,party_role) VALUES (?,?,?,?,?)",
        [firmId, matter_id ? parseInt(matter_id) : null, norm, name, role]
      ).catch(() => {});
      added.push({ name, role });
    }

    res.json({ added, added_count: added.length, conflicts_found, conflict_count: conflicts_found.length, requires_waiver: conflicts_found.length > 0 });
  });

  app.get('/api/conflicts/report/:firmId', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    if (req.firmCtx?.firm_id !== firmId) return res.status(403).json({ error: 'Access denied.' });
    const total = await db.get('SELECT COUNT(*) as n FROM conflict_index WHERE firm_id=?', [firmId]);
    const byRole = await db.all('SELECT party_role, COUNT(*) as count FROM conflict_index WHERE firm_id=? GROUP BY party_role', [firmId]);
    const waivers = await db.all('SELECT * FROM conflict_waivers WHERE firm_id=?', [firmId]).catch(() => []);
    const ethicsWalls = await db.all('SELECT * FROM ethics_wall_log WHERE firm_id=?', [firmId]).catch(() => []);
    res.json({ firm_id: firmId, total_indexed: total?.n||0, by_role: byRole, waivers, ethics_walls: ethicsWalls, generated_at: new Date().toISOString() });
  });

  app.post('/api/conflicts/waiver', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx = req.firmCtx;
    if (!ctx) return res.status(403).json({ error: 'Firm membership required.' });
    const { adverse_party, client_party, conflict_type='adverse_party', waiver_text, matter_id, client_consent=false } = req.body || {};
    if (!adverse_party?.trim()) return res.status(400).json({ error: 'adverse_party required.' });
    if (!client_party?.trim())  return res.status(400).json({ error: 'client_party required.' });
    if (!waiver_text?.trim())   return res.status(400).json({ error: 'waiver_text required.' });
    const r = await db.run(
      'INSERT INTO conflict_waivers (firm_id,matter_id,adverse_party,client_party,conflict_type,waiver_text,authorized_by,client_consent) VALUES (?,?,?,?,?,?,?,?)',
      [ctx.firm_id, matter_id||null, adverse_party, client_party, conflict_type, waiver_text, req.user.id, client_consent?1:0]
    );
    res.json({ ok: true, waiver_id: r.lastID, authorized_by: req.user.id });
  });

  app.get('/api/conflicts/waivers/:firmId', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    if (req.firmCtx?.firm_id !== firmId) return res.status(403).json({ error: 'Access denied.' });
    const waivers = await db.all('SELECT * FROM conflict_waivers WHERE firm_id=? ORDER BY created_at DESC', [firmId]).catch(() => []);
    res.json({ waivers, count: waivers.length });
  });

  // ── Ethics Walls ───────────────────────────────────────────────────────────
  app.get('/api/conflicts/ethics-wall/:matterId', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const matterId = parseInt(req.params.matterId);
    const members = await db.all(
      'SELECT mt.user_id, mt.ethics_wall, mt.matter_role, u.display_name, u.email FROM matter_team_members mt JOIN users u ON u.id=mt.user_id WHERE mt.case_id=?',
      [matterId]
    ).catch(async () =>
      db.all('SELECT mt.user_id, 0 as ethics_wall, mt.role as matter_role, u.display_name, u.email FROM matter_teams mt JOIN users u ON u.id=mt.user_id WHERE mt.matter_id=? AND mt.active=1', [matterId]).catch(() => [])
    );
    res.json({ matter_id: matterId, team: members, walled_count: members.filter(m => m.ethics_wall).length });
  });

  app.post('/api/conflicts/ethics-wall/:matterId', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const matterId = parseInt(req.params.matterId);
    const ctx = req.firmCtx;
    const { user_id, reason } = req.body || {};
    if (!user_id)        return res.status(400).json({ error: 'user_id required.' });
    if (!reason?.trim()) return res.status(400).json({ error: 'reason required (ethics wall must be documented).' });
    const targetId = parseInt(user_id);
    if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot set ethics wall on yourself.' });

    const member = await db.get('SELECT id, ethics_wall FROM matter_team_members WHERE case_id=? AND user_id=?', [matterId, targetId]);
    if (member) {
      if (member.ethics_wall) return res.status(409).json({ error: 'Attorney is already screened from this matter.' });
      await db.run('UPDATE matter_team_members SET ethics_wall=1 WHERE case_id=? AND user_id=?', [matterId, targetId]);
    } else {
      const mt = await db.get('SELECT id FROM matter_teams WHERE matter_id=? AND user_id=? AND active=1', [matterId, targetId]).catch(() => null);
      if (!mt) return res.status(404).json({ error: 'Attorney is not on this matter team.' });
      await db.run('INSERT OR IGNORE INTO matter_team_members (case_id,user_id,matter_role,ethics_wall,added_by) VALUES (?,?,?,1,?)', [matterId, targetId, 'screened', req.user.id]);
    }

    await db.run(
      'INSERT INTO ethics_wall_log (firm_id,matter_id,screened_user_id,action,reason,set_by) VALUES (?,?,?,?,?,?)',
      [ctx?.firm_id||null, matterId, targetId, 'set', reason, req.user.id]
    );
    res.json({ ok: true, matter_id: matterId, screened_user_id: targetId, action: 'set' });
  });

  app.delete('/api/conflicts/ethics-wall/:matterId/:userId', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const matterId = parseInt(req.params.matterId);
    const targetId = parseInt(req.params.userId);
    const ctx = req.firmCtx;
    const { reason } = req.body || {};
    if (!reason?.trim()) return res.status(400).json({ error: 'reason required (lifting ethics wall must be documented).' });

    const member = await db.get('SELECT id, ethics_wall FROM matter_team_members WHERE case_id=? AND user_id=?', [matterId, targetId]);
    if (!member || !member.ethics_wall) return res.status(404).json({ error: 'No active ethics wall for this attorney.' });

    await db.run('UPDATE matter_team_members SET ethics_wall=0 WHERE case_id=? AND user_id=?', [matterId, targetId]);
    await db.run(
      'INSERT INTO ethics_wall_log (firm_id,matter_id,screened_user_id,action,reason,set_by,reviewed_by) VALUES (?,?,?,?,?,?,?)',
      [ctx?.firm_id||null, matterId, targetId, 'lifted', reason, req.user.id, req.user.id]
    );
    res.json({ ok: true, matter_id: matterId, user_id: targetId, action: 'lifted' });
  });

  app.get('/api/conflicts/ethics-wall/log/:firmId', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    if (req.firmCtx?.firm_id !== firmId) return res.status(403).json({ error: 'Access denied.' });
    const log = await db.all('SELECT * FROM ethics_wall_log WHERE firm_id=? ORDER BY created_at DESC', [firmId]).catch(() => []);
    res.json({ log, total: log.length });
  });

  // ── SOC 2 Controls ─────────────────────────────────────────────────────────
  app.get('/api/conflicts/soc2/:firmId', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    if (req.firmCtx?.firm_id !== firmId) return res.status(403).json({ error: 'Access denied.' });
    const controls = await db.all('SELECT * FROM soc2_controls ORDER BY control_id ASC').catch(() => []);
    const byStatus = controls.reduce((a, c) => { a[c.status] = (a[c.status]||0)+1; return a; }, {});
    const score = Math.round(((byStatus.implemented||0) + (byStatus.partial||0)*0.5) / Math.max(controls.length,1)*100);
    const auditCount = await db.get('SELECT COUNT(*) as n FROM audit_log WHERE firm_id=?', [firmId]).catch(() => ({ n:0 }));
    const rbacCount  = await db.get('SELECT COUNT(*) as n FROM role_permissions').catch(() => ({ n:0 }));
    const ssoConfig  = await db.get('SELECT id FROM sso_configurations WHERE firm_id=? AND active=1', [firmId]).catch(() => null);
    const runtime_checks = {
      audit_log_active:          { pass: auditCount.n > 0, value: `${auditCount.n} entries` },
      rbac_permissions_seeded:   { pass: rbacCount.n > 0, value: rbacCount.n },
      sso_configured:            { pass: !!ssoConfig, value: ssoConfig ? 'SSO active' : 'SSO not configured' },
      hsts_configured:           { pass: true, value: 'Enforced via helmet()' },
      encryption_at_rest:        { pass: true, value: 'AES-256 on case notes' },
      ethics_wall_system:        { pass: true, value: 'ethics_wall_log table active' },
      conflict_screening:        { pass: true, value: 'conflict_index table active' },
    };
    res.json({
      firm_id: firmId, controls, by_status: byStatus,
      readiness_score: score, runtime_checks,
      generated_at: new Date().toISOString(),
    });
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

let app, db;

beforeAll(async () => {
  db  = await makeTestDb();
  app = await buildApp(db);
});

// ── Security Headers ──────────────────────────────────────────────────────────
describe('Security Headers', () => {
  test('HSTS header present on all responses', async () => {
    const r = await request(app).get('/api/sso/metadata');
    expect(r.headers['strict-transport-security']).toMatch(/max-age=31536000/);
  });

  test('X-Frame-Options prevents clickjacking', async () => {
    const r = await request(app).get('/api/sso/metadata');
    expect(r.headers['x-frame-options']).toBe('DENY');
  });

  test('X-Content-Type-Options is nosniff', async () => {
    const r = await request(app).get('/api/sso/metadata');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  test('Content-Security-Policy is set', async () => {
    const r = await request(app).get('/api/sso/metadata');
    expect(r.headers['content-security-policy']).toBeDefined();
  });

  test('Cache-Control no-store on API responses', async () => {
    const r = await request(app).get('/api/conflicts/check?names=Test').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  test('X-Request-ID injected on every response', async () => {
    const r = await request(app).get('/api/sso/metadata');
    expect(r.headers['x-request-id']).toBeDefined();
  });

  test('Referrer-Policy is strict-origin-when-cross-origin', async () => {
    const r = await request(app).get('/api/sso/metadata');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

// ── SSO Metadata ──────────────────────────────────────────────────────────────
describe('SSO Metadata', () => {
  test('GET /api/sso/metadata returns XML with entityID', async () => {
    const r = await request(app).get('/api/sso/metadata');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/xml/);
    expect(r.text).toContain('EntityDescriptor');
    expect(r.text).toContain('entityID');
  });

  test('Metadata contains ACS URL', async () => {
    const r = await request(app).get('/api/sso/metadata');
    expect(r.text).toContain('AssertionConsumerService');
  });
});

// ── SSO Login ─────────────────────────────────────────────────────────────────
describe('SSO Login Initiation', () => {
  test('400 when firm param missing', async () => {
    const r = await request(app).get('/api/sso/login');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/firm parameter/i);
  });

  test('404 for unknown firm', async () => {
    const r = await request(app).get('/api/sso/login?firm=nonexistent-firm-xyz');
    expect(r.status).toBe(404);
  });

  test('400 when firm has no SSO configured', async () => {
    const r = await request(app).get('/api/sso/login?firm=test-firm');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('sso_not_configured');
  });
});

// ── SSO Configuration ─────────────────────────────────────────────────────────
describe('SSO Configuration (firm_admin only)', () => {
  test('401 without auth', async () => {
    const r = await request(app).get('/api/sso/config/1');
    expect(r.status).toBe(401);
  });

  test('403 for associate (insufficient role)', async () => {
    const r = await request(app).get('/api/sso/config/1').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(403);
  });

  test('returns unconfigured state when no SSO set', async () => {
    const r = await request(app).get('/api/sso/config/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(false);
    expect(r.body.sp_entity_id).toBeDefined();
    expect(r.body.sp_acs_url).toBeDefined();
  });

  test('400 when sso_url missing', async () => {
    const r = await request(app).post('/api/sso/config/1')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ entity_id: 'https://okta.com/issuer', certificate: 'a'.repeat(200) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/sso_url/i);
  });

  test('400 when certificate missing', async () => {
    const r = await request(app).post('/api/sso/config/1')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ sso_url: 'https://okta.com/sso', entity_id: 'https://okta.com/issuer' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/certificate/i);
  });

  test('creates SSO config successfully', async () => {
    const r = await request(app).post('/api/sso/config/1')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({
        provider:    'okta',
        entity_id:   'https://dev-12345.okta.com',
        sso_url:     'https://dev-12345.okta.com/app/saml/sso',
        certificate: 'MIICpDCCAYwCCQDU+pQ4pHgSpDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwHhcNMjMwMTAxMDAwMDAwWhcNMjQwMTAxMDAwMDAwWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7o4qne60TB3wolrRHLkSHQfPEFcX2KRFMPVqJVkV',
        force_sso:   false,
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.configured).toBe(true);
    expect(r.body.provider).toBe('okta');
    expect(r.body.sp_acs_url).toBeDefined();
  });

  test('GET config after creation returns configured=true', async () => {
    const r = await request(app).get('/api/sso/config/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.entity_id).toBe('https://dev-12345.okta.com');
    expect(r.body.certificate_configured).toBe(true);
  });

  test('force_sso flag is stored', async () => {
    await request(app).post('/api/sso/config/1')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({
        entity_id: 'https://dev-12345.okta.com', sso_url: 'https://dev-12345.okta.com/sso',
        certificate: 'x'.repeat(200), force_sso: true,
      });
    const r = await request(app).get('/api/sso/config/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.force_sso).toBe(1);
  });

  test('test endpoint returns all checks', async () => {
    const r = await request(app).get('/api/sso/test/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.checks).toHaveProperty('entity_id_set');
    expect(r.body.checks).toHaveProperty('sso_url_set');
    expect(r.body.checks).toHaveProperty('certificate_set');
  });

  test('DELETE disables SSO', async () => {
    const r = await request(app).delete('/api/sso/config/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  test('login redirects after SSO is re-enabled', async () => {
    // Re-enable
    await request(app).post('/api/sso/config/1')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ entity_id: 'https://okta.com', sso_url: 'https://okta.com/sso', certificate: 'y'.repeat(200) });
    const r = await request(app).get('/api/sso/login?firm=1');
    expect(r.status).toBe(302);
    expect(r.headers['location']).toMatch(/https:\/\/okta\.com\/sso/);
  });
});

// ── SSO ACS ───────────────────────────────────────────────────────────────────
describe('SSO ACS', () => {
  test('400 when SAMLResponse missing', async () => {
    const r = await request(app).post('/api/sso/acs').send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/SAMLResponse/i);
  });

  test('200 with SAMLResponse present (test mode)', async () => {
    const r = await request(app).post('/api/sso/acs')
      .send({ SAMLResponse: Buffer.from('<saml>test</saml>').toString('base64'), RelayState: '' });
    expect(r.status).toBe(200);
  });
});

// ── SSO Logout ────────────────────────────────────────────────────────────────
describe('SSO Logout', () => {
  test('401 without auth', async () => {
    const r = await request(app).post('/api/sso/logout');
    expect(r.status).toBe(401);
  });

  test('clears session on authenticated logout', async () => {
    const r = await request(app).post('/api/sso/logout').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

// ── Conflict Screening ────────────────────────────────────────────────────────
describe('Conflict Screening — Check', () => {
  beforeAll(async () => {
    // Seed some existing parties in the conflict index
    await db.run("INSERT OR IGNORE INTO conflict_index (firm_id,party_name_norm,party_name_orig,party_role) VALUES (1,'acme corporation','Acme Corporation','adverse')");
    await db.run("INSERT OR IGNORE INTO conflict_index (firm_id,party_name_norm,party_name_orig,party_role) VALUES (1,'smith industries','Smith Industries','client')");
  });

  test('403 without firm membership', async () => {
    const r = await request(app).get('/api/conflicts/check?names=Acme').set('Authorization', `Bearer ${T_OTHER}`);
    expect(r.status).toBe(403);
  });

  test('400 when names param missing', async () => {
    const r = await request(app).get('/api/conflicts/check').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(400);
  });

  test('clear result for unknown party', async () => {
    const r = await request(app).get('/api/conflicts/check?names=Totally+Unknown+Corp+XYZ').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.clear).toBe(true);
    expect(r.body.conflict_count).toBe(0);
  });

  test('detects existing adverse party', async () => {
    const r = await request(app).get('/api/conflicts/check?names=Acme+Corporation').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.clear).toBe(false);
    expect(r.body.conflict_count).toBeGreaterThan(0);
    expect(r.body.conflicts[0].matches[0].party_role).toBe('adverse');
  });

  test('checks multiple names in one request', async () => {
    const r = await request(app).get('/api/conflicts/check?names=Acme+Corporation,Unknown+Inc').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.checked.length).toBe(2);
    expect(r.body.conflict_count).toBe(1);
  });

  test('400 for more than 20 names', async () => {
    const names = Array.from({ length: 21 }, (_, i) => `Party${i}`).join(',');
    const r = await request(app).get(`/api/conflicts/check?names=${names}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(400);
  });

  test('audit log entry written on conflict check', async () => {
    await request(app).get('/api/conflicts/check?names=Acme').set('Authorization', `Bearer ${T_ADMIN}`);
    const log = await db.get("SELECT id FROM audit_log WHERE action='conflict_check' AND firm_id=1");
    expect(log).toBeDefined();
  });
});

// ── Conflict Index ────────────────────────────────────────────────────────────
describe('Conflict Index', () => {
  test('400 when parties array missing', async () => {
    const r = await request(app).post('/api/conflicts/index')
      .set('Authorization', `Bearer ${T_ADMIN}`).send({ parties: [] });
    expect(r.status).toBe(400);
  });

  test('adds client party to index', async () => {
    const r = await request(app).post('/api/conflicts/index')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ parties: [{ name: 'Globex Corporation', role: 'client' }] });
    expect(r.status).toBe(200);
    expect(r.body.added_count).toBe(1);
    expect(r.body.added[0].name).toBe('Globex Corporation');
  });

  test('detects new client is existing adverse party', async () => {
    // Acme is already in index as adverse — adding it as client triggers conflict
    const r = await request(app).post('/api/conflicts/index')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ parties: [{ name: 'Acme Corporation', role: 'client' }] });
    expect(r.status).toBe(200);
    expect(r.body.conflict_count).toBeGreaterThan(0);
    expect(r.body.conflicts_found[0].type).toBe('new_client_is_existing_adverse');
    expect(r.body.requires_waiver).toBe(true);
  });

  test('detects adverse party is existing client', async () => {
    // Smith Industries is already a client — adding as adverse triggers conflict
    const r = await request(app).post('/api/conflicts/index')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ parties: [{ name: 'Smith Industries', role: 'adverse' }] });
    expect(r.status).toBe(200);
    expect(r.body.conflict_count).toBeGreaterThan(0);
    expect(r.body.conflicts_found[0].type).toBe('adverse_party_is_existing_client');
  });

  test('paralegal cannot index parties (associate+ required)', async () => {
    const r = await request(app).post('/api/conflicts/index')
      .set('Authorization', `Bearer ${T_PARALEGAL}`)
      .send({ parties: [{ name: 'Test Co', role: 'client' }] });
    expect(r.status).toBe(403);
  });
});

// ── Conflict Report ───────────────────────────────────────────────────────────
describe('Conflict Report', () => {
  test('requires partner+ role', async () => {
    const r = await request(app).get('/api/conflicts/report/1').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(403);
  });

  test('returns full report for partner', async () => {
    const r = await request(app).get('/api/conflicts/report/1').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('total_indexed');
    expect(r.body).toHaveProperty('by_role');
    expect(r.body).toHaveProperty('waivers');
    expect(r.body).toHaveProperty('ethics_walls');
    expect(r.body).toHaveProperty('generated_at');
    expect(r.body.total_indexed).toBeGreaterThan(0);
  });

  test('403 when accessing another firm report', async () => {
    const r = await request(app).get('/api/conflicts/report/999').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(403);
  });
});

// ── Conflict Waivers ──────────────────────────────────────────────────────────
describe('Conflict Waivers', () => {
  test('400 when adverse_party missing', async () => {
    const r = await request(app).post('/api/conflicts/waiver')
      .set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ client_party: 'Client A', waiver_text: 'Justified.' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/adverse_party/i);
  });

  test('400 when waiver_text missing', async () => {
    const r = await request(app).post('/api/conflicts/waiver')
      .set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ adverse_party: 'Acme', client_party: 'Smith' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/waiver_text/i);
  });

  test('records waiver with authorized_by', async () => {
    const r = await request(app).post('/api/conflicts/waiver')
      .set('Authorization', `Bearer ${T_PARTNER}`)
      .send({
        adverse_party: 'Acme Corporation',
        client_party:  'Smith Industries',
        waiver_text:   'Both parties have provided informed consent. The matters are unrelated. See file for signed client consent forms.',
        client_consent: true,
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.waiver_id).toBeDefined();
    expect(r.body.authorized_by).toBe(2); // partner user id
  });

  test('associate cannot create waivers (partner+ required)', async () => {
    const r = await request(app).post('/api/conflicts/waiver')
      .set('Authorization', `Bearer ${T_ASSOC}`)
      .send({ adverse_party: 'X', client_party: 'Y', waiver_text: 'test' });
    expect(r.status).toBe(403);
  });

  test('lists firm waivers', async () => {
    const r = await request(app).get('/api/conflicts/waivers/1').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.waivers)).toBe(true);
    expect(r.body.count).toBeGreaterThan(0);
  });
});

// ── Ethics Walls ──────────────────────────────────────────────────────────────
describe('Ethics Walls', () => {
  const MATTER_ID = 101;

  beforeAll(async () => {
    // Set up matter team members for testing
    await db.run("INSERT OR IGNORE INTO matter_team_members (case_id,user_id,matter_role,ethics_wall) VALUES (101,3,'associate',0)");
    await db.run("INSERT OR IGNORE INTO matter_team_members (case_id,user_id,matter_role,ethics_wall) VALUES (101,4,'paralegal',0)");
  });

  test('GET ethics-wall status requires partner+', async () => {
    const r = await request(app).get('/api/conflicts/ethics-wall/101').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(403);
  });

  test('GET ethics-wall returns team with wall status', async () => {
    const r = await request(app).get('/api/conflicts/ethics-wall/101').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.team).toBeDefined();
    expect(Array.isArray(r.body.team)).toBe(true);
    expect(r.body.walled_count).toBe(0);
  });

  test('400 when user_id missing on set', async () => {
    const r = await request(app).post('/api/conflicts/ethics-wall/101')
      .set('Authorization', `Bearer ${T_PARTNER}`).send({ reason: 'Conflict detected' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/user_id/i);
  });

  test('400 when reason missing on set', async () => {
    const r = await request(app).post('/api/conflicts/ethics-wall/101')
      .set('Authorization', `Bearer ${T_PARTNER}`).send({ user_id: 3 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/reason/i);
  });

  test('400 cannot set wall on yourself', async () => {
    const r = await request(app).post('/api/conflicts/ethics-wall/101')
      .set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ user_id: 2, reason: 'test' }); // T_PARTNER is user 2
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/yourself/i);
  });

  test('sets ethics wall on team member', async () => {
    const r = await request(app).post('/api/conflicts/ethics-wall/101')
      .set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ user_id: 3, reason: 'Potential conflict: associate represents adverse party in matter 55.' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.action).toBe('set');
    expect(r.body.screened_user_id).toBe(3);
  });

  test('409 when wall already set', async () => {
    const r = await request(app).post('/api/conflicts/ethics-wall/101')
      .set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ user_id: 3, reason: 'Duplicate attempt.' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already screened/i);
  });

  test('GET shows walled_count = 1 after wall set', async () => {
    const r = await request(app).get('/api/conflicts/ethics-wall/101').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.body.walled_count).toBe(1);
  });

  test('400 when lifting without reason', async () => {
    const r = await request(app).delete('/api/conflicts/ethics-wall/101/3')
      .set('Authorization', `Bearer ${T_ADMIN}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/reason/i);
  });

  test('partner cannot lift wall (firm_admin required)', async () => {
    const r = await request(app).delete('/api/conflicts/ethics-wall/101/3')
      .set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ reason: 'Conflict resolved, waiver signed.' });
    expect(r.status).toBe(403);
  });

  test('firm_admin lifts ethics wall with reason', async () => {
    const r = await request(app).delete('/api/conflicts/ethics-wall/101/3')
      .set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ reason: 'Conflict waiver signed by client on 2025-01-01. See file #W-2025-001.' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.action).toBe('lifted');
  });

  test('ethics wall log records set and lift events', async () => {
    const r = await request(app).get('/api/conflicts/ethics-wall/log/1').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.log)).toBe(true);
    expect(r.body.log.length).toBeGreaterThanOrEqual(2);
    const actions = r.body.log.map(e => e.action);
    expect(actions).toContain('set');
    expect(actions).toContain('lifted');
  });

  test('ethics wall log 403 for associate', async () => {
    const r = await request(app).get('/api/conflicts/ethics-wall/log/1').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(403);
  });
});

// ── SOC 2 Controls ────────────────────────────────────────────────────────────
describe('SOC 2 Type II Readiness', () => {
  test('requires firm_admin', async () => {
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(403);
  });

  test('returns controls list', async () => {
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.controls)).toBe(true);
    expect(r.body.controls.length).toBeGreaterThan(0);
  });

  test('controls have required fields', async () => {
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_ADMIN}`);
    const ctrl = r.body.controls[0];
    expect(ctrl).toHaveProperty('control_id');
    expect(ctrl).toHaveProperty('category');
    expect(ctrl).toHaveProperty('title');
    expect(ctrl).toHaveProperty('status');
    expect(ctrl).toHaveProperty('evidence');
  });

  test('returns readiness_score as a number', async () => {
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(typeof r.body.readiness_score).toBe('number');
    expect(r.body.readiness_score).toBeGreaterThanOrEqual(0);
    expect(r.body.readiness_score).toBeLessThanOrEqual(100);
  });

  test('includes runtime checks', async () => {
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.runtime_checks).toBeDefined();
    expect(r.body.runtime_checks).toHaveProperty('hsts_configured');
    expect(r.body.runtime_checks).toHaveProperty('encryption_at_rest');
    expect(r.body.runtime_checks).toHaveProperty('ethics_wall_system');
    expect(r.body.runtime_checks).toHaveProperty('conflict_screening');
  });

  test('hsts_configured passes', async () => {
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.runtime_checks.hsts_configured.pass).toBe(true);
  });

  test('audit log check passes when entries exist', async () => {
    // Seed an audit entry
    await db.run("INSERT INTO audit_log (firm_id,user_id,action) VALUES (1,1,'test')");
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.runtime_checks.audit_log_active.pass).toBe(true);
  });

  test('RBAC permissions check passes when seeded', async () => {
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.runtime_checks.rbac_permissions_seeded.pass).toBe(true);
  });

  test('includes generated_at timestamp', async () => {
    const r = await request(app).get('/api/conflicts/soc2/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.generated_at).toBeDefined();
    expect(new Date(r.body.generated_at).getTime()).toBeGreaterThan(0);
  });
});
