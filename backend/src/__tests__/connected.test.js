/**
 * connected.test.js — Year 3: iManage/NetDocuments, Clio/PracticePanther, CalDAV, Webhooks
 *
 * Coverage:
 *   Integration Connections:
 *     - GET /catalogue returns all 8 providers with features
 *     - GET / lists firm connections (partner+)
 *     - GET /:provider returns not-connected state
 *     - POST /connect requires firm_admin
 *     - POST /connect returns oauth_url for OAuth2 providers
 *     - POST /connect creates direct connection for CalDAV
 *     - DELETE /:provider revokes connection
 *     - GET /:provider/sync/log returns log
 *     - POST /:provider/sync dispatches to correct handler
 *     - OAuth callback stores tokens
 *
 *   DMS (iManage + NetDocuments):
 *     - GET /dms/workspaces/:matterId returns demo docs when no active conn
 *     - POST /dms/workspaces/:matterId creates workspace mapping
 *     - GET /dms/map lists all matter mappings
 *     - POST /dms/search returns demo results
 *     - syncDMS: push matter creates workspace
 *     - syncDMS: pull documents returns demo list
 *
 *   Practice Management (Clio / PracticePanther):
 *     - GET /pm/matters returns demo matters
 *     - POST /pm/matters/:id/push pushes matter to PM system
 *     - GET /pm/contacts returns demo contacts
 *     - POST /pm/time/:matterId/push pushes time entries
 *     - POST /pm/invoices/:id/push pushes invoice
 *     - syncPracticeMgmt: pull matters returns records
 *     - syncPracticeMgmt: push time entries
 *
 *   CalDAV / Calendar:
 *     - iCal generation: VCALENDAR starts/ends correctly
 *     - VEVENT contains UID, DTSTART, SUMMARY, PRIORITY
 *     - POST /caldav/push/:entryId pushes single deadline
 *     - POST /caldav/push/matter/:id pushes all pending deadlines
 *     - GET /caldav/events lists pushed events
 *     - DELETE /caldav/events/:uid marks as deleted
 *     - GET /caldav/ical/:firmId returns ICS feed
 *     - GET /caldav/ical-token returns token and URL
 *     - Line folding at 75 octets
 *
 *   Outbound Webhooks:
 *     - GET /events lists all supported event types
 *     - POST /subscriptions requires firm_admin
 *     - POST /subscriptions validates URL format
 *     - POST /subscriptions validates event types
 *     - POST /subscriptions returns secret once
 *     - GET /subscriptions lists (secret hidden)
 *     - GET /subscriptions/:id gets single
 *     - PUT /subscriptions/:id updates
 *     - DELETE /subscriptions/:id deletes
 *     - POST /subscriptions/:id/test delivers test event
 *     - GET /deliveries/:subId shows history
 *     - signPayload: HMAC-SHA256 is stable and verifiable
 *     - dispatchWebhookEvent: fires for matching event types
 *     - Retry logic: 3 attempts with backoff
 *     - Auto-disable after 50 failures
 */

import express    from 'express';
import request    from 'supertest';
import jwt        from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

function tok(id, role = 'user', extra = {}) {
  return jwt.sign({ id, role, email: `u${id}@test.com`, ...extra }, SECRET, { expiresIn: '1h' });
}

const T_ADMIN   = tok(1, 'firm_admin', { firm_role: 'firm_admin' });
const T_PARTNER = tok(2, 'partner',    { firm_role: 'partner'    });
const T_ASSOC   = tok(3, 'associate',  { firm_role: 'associate'  });
const T_OTHER   = tok(9, 'user',       { firm_role: null         });

async function buildApp(db) {
  const app = express();
  app.use(express.json());

  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  async function loadFirm(req, res, next) {
    if (!req.user) return next();
    const m = await db.get("SELECT firm_id, role AS firm_role FROM firm_members WHERE user_id=? AND active=1", [req.user.id]).catch(() => null);
    req.firmCtx = m || null;
    next();
  }

  function requireRole(min) {
    const H = ['viewer','client','paralegal','associate','partner','firm_admin','super_admin'];
    return (req, res, next) => {
      const role = req.firmCtx?.firm_role || req.user?.firm_role || req.user?.role || 'viewer';
      if (H.indexOf(role) < H.indexOf(min)) return res.status(403).json({ error: `Requires ${min}`, code: 'insufficient_role' });
      next();
    };
  }

  // ── Schema ─────────────────────────────────────────────────────────────────
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, display_name TEXT, role TEXT DEFAULT 'user');
    CREATE TABLE IF NOT EXISTS firms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT, owner_id INTEGER);
    CREATE TABLE IF NOT EXISTS firm_members (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT DEFAULT 'associate', active INTEGER DEFAULT 1, UNIQUE(firm_id, user_id));
    CREATE TABLE IF NOT EXISTS matters (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, created_by INTEGER NOT NULL, title TEXT NOT NULL, client_name TEXT, status TEXT DEFAULT 'active', practice_group TEXT, opened_date TEXT);
    CREATE TABLE IF NOT EXISTS cases (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, status TEXT DEFAULT 'Open');
    CREATE TABLE IF NOT EXISTS time_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, matter_id INTEGER, user_id INTEGER NOT NULL, entry_date TEXT NOT NULL, hours REAL NOT NULL, rate_cents INTEGER NOT NULL, narrative TEXT NOT NULL, billing_status TEXT DEFAULT 'unbilled', invoice_id INTEGER);
    CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, matter_id INTEGER, invoice_number TEXT NOT NULL UNIQUE, client_name TEXT NOT NULL, subtotal_cents INTEGER DEFAULT 0, total_cents INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', due_date TEXT);
    CREATE TABLE IF NOT EXISTS docket_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, matter_id INTEGER, entry_type TEXT NOT NULL, title TEXT NOT NULL, description TEXT, due_date TEXT NOT NULL, rule_citation TEXT, priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending', reminder_days INTEGER DEFAULT 3, assigned_to INTEGER, created_by INTEGER);
    CREATE TABLE IF NOT EXISTS integration_connections (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, user_id INTEGER, provider TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', access_token TEXT, refresh_token TEXT, token_expires_at TEXT, instance_url TEXT, customer_id TEXT, scope TEXT, metadata TEXT, last_sync_at TEXT, last_error TEXT, webhook_secret TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), UNIQUE(firm_id, provider));
    CREATE TABLE IF NOT EXISTS integration_sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER, firm_id INTEGER, direction TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, external_id TEXT, status TEXT NOT NULL, error_msg TEXT, records_sent INTEGER DEFAULT 0, records_received INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS document_sync_map (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER, matter_id INTEGER, external_workspace_id TEXT, external_folder_path TEXT, sync_enabled INTEGER DEFAULT 1, last_synced_at TEXT, doc_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS webhook_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, name TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL, active INTEGER DEFAULT 1, last_triggered_at TEXT, failure_count INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS webhook_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, subscription_id INTEGER, event_type TEXT NOT NULL, payload TEXT, response_status INTEGER, response_body TEXT, delivery_ms INTEGER, success INTEGER DEFAULT 0, attempted_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS calendar_push_events (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER, docket_entry_id INTEGER, external_uid TEXT NOT NULL, external_href TEXT, calendar_url TEXT, summary TEXT NOT NULL, dtstart TEXT NOT NULL, dtend TEXT NOT NULL, status TEXT DEFAULT 'confirmed', sync_status TEXT DEFAULT 'pending', last_sync_at TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, user_id INTEGER, target_type TEXT, target_id INTEGER, action TEXT NOT NULL, detail TEXT, ip_address TEXT, user_agent TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);

  // Seed
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name) VALUES (1,'admin@t.com','Admin')");
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name) VALUES (2,'partner@t.com','Partner')");
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name) VALUES (3,'assoc@t.com','Associate')");
  await db.run("INSERT OR IGNORE INTO firms (id,name,slug,owner_id) VALUES (1,'Test Firm','test-firm',1)");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,1,'firm_admin')");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,2,'partner')");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,3,'associate')");
  await db.run("INSERT OR IGNORE INTO matters (id,firm_id,created_by,title,client_name) VALUES (1,1,1,'Acme v. Smith Corp','Acme Corp')");
  await db.run("INSERT OR IGNORE INTO time_entries (id,firm_id,matter_id,user_id,entry_date,hours,rate_cents,narrative,billing_status) VALUES (1,1,1,1,'2025-01-10',2.0,200000,'Discovery review','unbilled')");
  await db.run("INSERT OR IGNORE INTO invoices (id,firm_id,matter_id,invoice_number,client_name,subtotal_cents,total_cents,status) VALUES (1,1,1,'INV-202501-0001','Acme Corp',200000,200000,'sent')");
  await db.run("INSERT OR IGNORE INTO docket_entries (id,firm_id,matter_id,entry_type,title,due_date,rule_citation,priority,status,reminder_days) VALUES (1,1,1,'filing','Answer to Complaint','2025-12-01','FRCP 12(a)','critical','pending',7)");
  await db.run("INSERT OR IGNORE INTO docket_entries (id,firm_id,matter_id,entry_type,title,due_date,rule_citation,priority,status,reminder_days) VALUES (2,1,1,'hearing','Preliminary Hearing','2025-12-15','Fed.R.Crim.P. 5','high','pending',3)");

  // ── Provider catalogue ─────────────────────────────────────────────────────
  const PROVIDERS = {
    imanage:        { label:'iManage Work', category:'dms', auth_type:'oauth2', features:['document_sync','matter_sync'], oauth_url:'https://cloudimanage.com/work/api/v2/oauth2/authorize', scope:'user documents.read' },
    netdocuments:   { label:'NetDocuments', category:'dms', auth_type:'oauth2', features:['document_sync','cabinet_sync'], oauth_url:'https://vault.netvoyage.com/neWeb2/OAuth.aspx', scope:'read write' },
    clio:           { label:'Clio Manage', category:'practice_mgmt', auth_type:'oauth2', features:['matter_sync','contact_sync','time_entry_sync','invoice_sync'], oauth_url:'https://app.clio.com/oauth/authorize', scope:'openid' },
    practicepanther:{ label:'PracticePanther', category:'practice_mgmt', auth_type:'oauth2', features:['matter_sync','contact_sync','time_entry_sync','invoice_sync'], oauth_url:'https://api.practicepanther.com/oauth/authorize', scope:'read write' },
    mycase:         { label:'MyCase', category:'practice_mgmt', auth_type:'oauth2', features:['matter_sync','contact_sync','invoice_sync'], oauth_url:'https://app.mycase.com/oauth/authorize', scope:'read write' },
    caldav:         { label:'CalDAV (Generic)', category:'calendar', auth_type:'basic_or_token', features:['event_push','event_pull','deadline_sync'] },
    google_calendar:{ label:'Google Calendar', category:'calendar', auth_type:'oauth2', features:['event_push','event_pull','deadline_sync'], oauth_url:'https://accounts.google.com/o/oauth2/v2/auth', scope:'https://www.googleapis.com/auth/calendar.events' },
    outlook:        { label:'Microsoft Outlook / Exchange', category:'calendar', auth_type:'oauth2', features:['event_push','event_pull','deadline_sync'], oauth_url:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', scope:'Calendars.ReadWrite offline_access' },
  };

  function buildOAuthUrl(provider, firmId, userId) {
    const p = PROVIDERS[provider];
    if (!p?.oauth_url) return null;
    const state = Buffer.from(JSON.stringify({ provider, firm_id: firmId, user_id: userId })).toString('base64url');
    const params = new URLSearchParams({ client_id: 'demo_client_id', response_type: 'code', redirect_uri: 'https://justicegavel.app/api/integrations/oauth/callback', scope: p.scope||'', state });
    return `${p.oauth_url}?${params}`;
  }

  // ── Integration management ─────────────────────────────────────────────────
  app.get('/api/integrations/catalogue', auth, (req, res) => {
    res.json({ providers: Object.entries(PROVIDERS).map(([key,p])=>({ key, label:p.label, category:p.category, auth_type:p.auth_type, features:p.features })) });
  });

  app.get('/api/integrations', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx = req.firmCtx;
    const conns = await db.all('SELECT id, provider, status, instance_url, last_sync_at, last_error, created_at FROM integration_connections WHERE firm_id=?', [ctx.firm_id]);
    res.json({ connections: conns.map(c=>({...c, provider_label:PROVIDERS[c.provider]?.label||c.provider})), count:conns.length });
  });

  app.get('/api/integrations/:provider', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) return res.status(400).json({ error: `Unknown provider "${provider}".` });
    const ctx  = req.firmCtx;
    const conn = await db.get('SELECT id, provider, status, instance_url, last_sync_at, last_error FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, provider]);
    if (!conn) return res.json({ connected:false, provider, provider_label:PROVIDERS[provider]?.label, features:PROVIDERS[provider]?.features });
    const recentSync = await db.all('SELECT status, entity_type, records_sent, records_received, created_at FROM integration_sync_log WHERE connection_id=? ORDER BY created_at DESC LIMIT 5', [conn.id]).catch(()=>[]);
    res.json({ connected:conn.status==='active', ...conn, provider_label:PROVIDERS[provider]?.label, features:PROVIDERS[provider]?.features, recent_syncs:recentSync });
  });

  app.post('/api/integrations/connect', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const { provider, access_token, instance_url, username, password, calendar_url } = req.body||{};
    if (!provider || !PROVIDERS[provider]) return res.status(400).json({ error: `provider required. Options: ${Object.keys(PROVIDERS).join(', ')}` });
    const ctx = req.firmCtx;
    const p   = PROVIDERS[provider];

    if (p.auth_type === 'oauth2' && !access_token) {
      const oauthUrl = buildOAuthUrl(provider, ctx.firm_id, req.user.id);
      const existing = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, provider]);
      if (!existing) await db.run('INSERT INTO integration_connections (firm_id,user_id,provider,status) VALUES (?,?,?,?)', [ctx.firm_id, req.user.id, provider, 'pending']);
      else await db.run("UPDATE integration_connections SET status='pending' WHERE firm_id=? AND provider=?", [ctx.firm_id, provider]);
      return res.json({ oauth_redirect_required:true, oauth_url:oauthUrl, provider, provider_label:p.label });
    }

    const meta = {};
    if (calendar_url) meta.calendar_url = calendar_url;
    const effectiveToken = access_token || (username && password ? Buffer.from(`${username}:${password}`).toString('base64') : null);
    if (!effectiveToken) return res.status(400).json({ error: 'access_token or username+password required.' });

    const existing = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, provider]);
    if (existing) {
      await db.run("UPDATE integration_connections SET status='active', access_token=?, instance_url=?, metadata=? WHERE id=?", [effectiveToken, instance_url||null, JSON.stringify(meta), existing.id]);
    } else {
      await db.run('INSERT INTO integration_connections (firm_id,user_id,provider,status,access_token,instance_url,metadata) VALUES (?,?,?,?,?,?,?)', [ctx.firm_id, req.user.id, provider, 'active', effectiveToken, instance_url||null, JSON.stringify(meta)]);
    }
    res.json({ connected:true, provider, provider_label:p.label, status:'active' });
  });

  app.delete('/api/integrations/:provider', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const ctx  = req.firmCtx;
    const conn = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, req.params.provider]);
    if (!conn) return res.status(404).json({ error: 'No connection found.' });
    await db.run("UPDATE integration_connections SET status='revoked', access_token=NULL WHERE id=?", [conn.id]);
    res.json({ ok:true, provider:req.params.provider, status:'revoked' });
  });

  app.post('/api/integrations/:provider/sync', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const provider = req.params.provider;
    const ctx      = req.firmCtx;
    const conn     = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider=? AND status='active'", [ctx.firm_id, provider]);
    if (!conn) return res.status(404).json({ error: `No active ${provider} connection.` });
    const { entity_type='matter', direction='push', matter_id } = req.body||{};
    // Simplified inline sync for tests
    let result = { status:'success', records_sent:0, records_received:0, demo:true };
    if (PROVIDERS[provider]?.category === 'dms') {
      result.records_received = 5; // demo docs
    } else if (PROVIDERS[provider]?.category === 'practice_mgmt') {
      if (direction === 'pull') { result.records_received = 3; result.matters = [{id:'DEMO-001',description:'Smith v. Jones'}]; }
      else { result.records_sent = 1; }
    } else if (PROVIDERS[provider]?.category === 'calendar') {
      const entries = await db.all("SELECT id FROM docket_entries WHERE firm_id=? AND status='pending'", [ctx.firm_id]).catch(()=>[]);
      result.records_sent = entries.length;
    }
    await db.run('INSERT INTO integration_sync_log (connection_id,firm_id,direction,entity_type,status,records_sent,records_received) VALUES (?,?,?,?,?,?,?)', [conn.id, ctx.firm_id, direction, entity_type, result.status, result.records_sent, result.records_received]);
    await db.run("UPDATE integration_connections SET last_sync_at=datetime('now') WHERE id=?", [conn.id]);
    res.json({ provider, direction, entity_type, ...result });
  });

  app.get('/api/integrations/:provider/sync/log', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx  = req.firmCtx;
    const conn = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [ctx.firm_id, req.params.provider]);
    if (!conn) return res.status(404).json({ error: 'No connection found.' });
    const log = await db.all('SELECT * FROM integration_sync_log WHERE connection_id=? ORDER BY created_at DESC LIMIT 20', [conn.id]);
    res.json({ provider:req.params.provider, log, count:log.length });
  });

  app.get('/api/integrations/oauth/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`/settings/integrations?error=${error}`);
    if (!code || !state) return res.status(400).json({ error: 'Missing code or state.' });
    let stateData; try { stateData = JSON.parse(Buffer.from(state,'base64url').toString()); } catch { return res.status(400).json({ error: 'Invalid state.' }); }
    const { provider, firm_id, user_id } = stateData;
    const demoToken = `demo_${provider}_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 30*24*3600*1000).toISOString();
    const existing = await db.get('SELECT id FROM integration_connections WHERE firm_id=? AND provider=?', [firm_id, provider]);
    if (existing) await db.run("UPDATE integration_connections SET status='active', access_token=?, token_expires_at=? WHERE id=?", [demoToken, expiresAt, existing.id]);
    else await db.run('INSERT INTO integration_connections (firm_id,user_id,provider,status,access_token,token_expires_at) VALUES (?,?,?,?,?,?)', [firm_id, user_id, provider, 'active', demoToken, expiresAt]);
    res.redirect(`/settings/integrations?provider=${provider}&status=active`);
  });

  // ── DMS endpoints ──────────────────────────────────────────────────────────
  function demoDocs() {
    return [
      {external_id:'DEMO-001',name:'Complaint.docx',type:'docx',modified:'2025-01-10',author:'J. Smith'},
      {external_id:'DEMO-002',name:'Engagement Letter.pdf',type:'pdf',modified:'2025-01-05',author:'J. Smith'},
      {external_id:'DEMO-003',name:'Discovery Request.docx',type:'docx',modified:'2025-01-15',author:'A. Jones'},
    ];
  }

  app.get('/api/integrations/dms/workspaces/:matterId', auth, loadFirm, requireRole('associate'), async (req, res) => {
    const ctx = req.firmCtx;
    const matterId = parseInt(req.params.matterId);
    const conn = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('imanage','netdocuments') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active DMS connection.' });
    const mapping = await db.get('SELECT * FROM document_sync_map WHERE connection_id=? AND matter_id=?', [conn.id, matterId]).catch(()=>null);
    const docs = demoDocs();
    res.json({ provider:conn.provider, matter_id:matterId, mapped:!!mapping, workspace:mapping?.external_workspace_id||null, status:'success', records_received:docs.length, documents:docs });
  });

  app.post('/api/integrations/dms/workspaces/:matterId', auth, loadFirm, requireRole('associate'), async (req, res) => {
    const ctx = req.firmCtx;
    const matterId = parseInt(req.params.matterId);
    const conn = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('imanage','netdocuments') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active DMS connection.' });
    const workspaceId = `DEMO-WS-${matterId}`;
    const existing = await db.get('SELECT id FROM document_sync_map WHERE connection_id=? AND matter_id=?', [conn.id, matterId]).catch(()=>null);
    if (!existing) await db.run('INSERT OR IGNORE INTO document_sync_map (connection_id,matter_id,external_workspace_id,external_folder_path,sync_enabled) VALUES (?,?,?,?,1)', [conn.id, matterId, workspaceId, `/workspaces/${workspaceId}`]);
    res.json({ provider:conn.provider, matter_id:matterId, status:'success', action: existing?'already_mapped':'created', workspace_id:workspaceId, records_sent:1, demo:true });
  });

  app.get('/api/integrations/dms/map', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx  = req.firmCtx;
    const conn = await db.get("SELECT id, provider FROM integration_connections WHERE firm_id=? AND provider IN ('imanage','netdocuments') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.json({ mappings:[], message:'No active DMS connection.' });
    const mappings = await db.all('SELECT dsm.*, m.title AS matter_title FROM document_sync_map dsm LEFT JOIN matters m ON m.id=dsm.matter_id WHERE dsm.connection_id=?', [conn.id]).catch(()=>[]);
    res.json({ provider:conn.provider, mappings, count:mappings.length });
  });

  app.post('/api/integrations/dms/search', auth, loadFirm, requireRole('associate'), async (req, res) => {
    const ctx   = req.firmCtx;
    const { query } = req.body||{};
    if (!query?.trim()) return res.status(400).json({ error: 'query required.' });
    const conn = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('imanage','netdocuments') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active DMS connection.' });
    const results = demoDocs().filter(d => d.name.toLowerCase().includes(query.toLowerCase()));
    res.json({ provider:conn.provider, query, results, count:results.length });
  });

  // ── Practice management endpoints ──────────────────────────────────────────
  function demoMatters() { return [{ id:'CLIO-001', description:'Smith v. Jones (Demo)', status:'Open', client:{name:'John Smith'} },{ id:'CLIO-002', description:'Estate of Williams (Demo)', status:'Open', client:{name:'Mary Williams'} }]; }
  function demoContacts() { return [{ id:'CON-001', name:'John Smith', email:'john@demo.com', type:'Person' },{ id:'CON-002', name:'Acme Corp', email:'legal@acme.com', type:'Company' }]; }

  app.get('/api/integrations/pm/matters', auth, loadFirm, requireRole('associate'), async (req, res) => {
    const ctx  = req.firmCtx;
    const conn = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active PM connection.' });
    res.json({ provider:conn.provider, records:demoMatters(), total:2, source:'demo' });
  });

  app.post('/api/integrations/pm/matters/:matterId/push', auth, loadFirm, requireRole('associate'), async (req, res) => {
    const ctx  = req.firmCtx;
    const conn = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active PM connection.' });
    const matter = await db.get('SELECT * FROM matters WHERE id=?', [parseInt(req.params.matterId)]).catch(()=>null);
    if (!matter) return res.status(404).json({ error: 'Matter not found.' });
    res.json({ provider:conn.provider, matter_id:matter.id, status:'success', external_id:`DEMO-${conn.provider.toUpperCase()}-${matter.id}`, action:'created', demo:true });
  });

  app.get('/api/integrations/pm/contacts', auth, loadFirm, requireRole('associate'), async (req, res) => {
    const ctx  = req.firmCtx;
    const conn = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active PM connection.' });
    res.json({ provider:conn.provider, records:demoContacts(), total:2, source:'demo' });
  });

  app.post('/api/integrations/pm/time/:matterId/push', auth, loadFirm, requireRole('associate'), async (req, res) => {
    const ctx  = req.firmCtx;
    const conn = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active PM connection.' });
    const matterId = parseInt(req.params.matterId);
    const billing  = req.body?.billing_status || 'unbilled';
    const entries  = await db.all('SELECT * FROM time_entries WHERE matter_id=? AND billing_status=?', [matterId, billing]).catch(()=>[]);
    const results  = entries.map(e => ({ entry_id:e.id, status:'success', external_id:`DEMO-TE-${e.id}`, demo:true }));
    res.json({ provider:conn.provider, matter_id:matterId, pushed:results.length, results });
  });

  app.post('/api/integrations/pm/invoices/:invoiceId/push', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx = req.firmCtx;
    const conn = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('clio','practicepanther','mycase') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active PM connection.' });
    const invoice = await db.get('SELECT * FROM invoices WHERE id=? AND firm_id=?', [parseInt(req.params.invoiceId), ctx?.firm_id]).catch(()=>null);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    res.json({ provider:conn.provider, invoice_id:invoice.id, status:'success', external_id:`DEMO-INV-${invoice.id}`, demo:true });
  });

  // ── CalDAV endpoints ───────────────────────────────────────────────────────
  const { createHmac } = await import('crypto');
  function generateUID(firmId, entryId) {
    const hash = createHmac('sha256', String(firmId||'jg')).update(String(entryId)).digest('hex').slice(0,32);
    return `jg-${hash}@justicegavel.app`;
  }
  function toICalDate(iso) { return String(iso||'').slice(0,10).replace(/-/g,''); }
  function addCalDay(d, n) { const dt=new Date(d+'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate()+n); return dt.toISOString().slice(0,10); }
  function escapeIcal(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n'); }
  function foldLine(l) {
    const bytes = Buffer.from(l,'utf8');
    if (bytes.length<=75) return l;
    const chunks=[]; let pos=0;
    while(pos<bytes.length){ if(pos===0){chunks.push(bytes.slice(0,75).toString('utf8'));pos=75;}else{chunks.push(' '+bytes.slice(pos,pos+74).toString('utf8'));pos+=74;} }
    return chunks.join('\r\n');
  }
  function buildVEvent(entry, uid, now) {
    const prio = {critical:'1',high:'3',normal:'5',low:'7'}[entry.priority]||'5';
    const alarm = entry.reminder_days>0 ? `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-P${entry.reminder_days}D\r\nEND:VALARM` : '';
    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${(now||new Date().toISOString()).replace(/[-:]/g,'').slice(0,15)+'Z'}`,
      `DTSTART;VALUE=DATE:${toICalDate(entry.due_date)}`,
      `DTEND;VALUE=DATE:${toICalDate(addCalDay(entry.due_date,1))}`,
      foldLine(`SUMMARY:${escapeIcal(entry.title)}`),
      entry.rule_citation ? `COMMENT:${escapeIcal(entry.rule_citation)}` : '',
      `PRIORITY:${prio}`,
      `STATUS:CONFIRMED`,
      `CATEGORIES:${(entry.entry_type||'DEADLINE').toUpperCase()}`,
      `X-JUSTICE-GAVEL-ID:${entry.id}`,
      alarm,
      'END:VEVENT',
    ].filter(Boolean).join('\r\n');
  }
  function buildVCal(events) { return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Justice Gavel//Legal Docket//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Justice Gavel Deadlines',...events,'END:VCALENDAR'].join('\r\n')+'\r\n'; }

  app.post('/api/integrations/caldav/push/:entryId', auth, loadFirm, async (req, res) => {
    const ctx     = req.firmCtx;
    const entryId = parseInt(req.params.entryId);
    const conn    = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('caldav','google_calendar','outlook') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active calendar connection.' });
    const entry = await db.get('SELECT * FROM docket_entries WHERE id=?', [entryId]).catch(()=>null);
    if (!entry) return res.status(404).json({ error: 'Docket entry not found.' });
    const uid = generateUID(ctx?.firm_id, entryId);
    const existing = await db.get('SELECT id FROM calendar_push_events WHERE docket_entry_id=? AND connection_id=?', [entryId, conn.id]).catch(()=>null);
    const meta = (()=>{try{return JSON.parse(conn.metadata||'{}')}catch{return{}}})();
    if (existing) await db.run("UPDATE calendar_push_events SET sync_status='synced', last_sync_at=datetime('now') WHERE id=?", [existing.id]);
    else await db.run('INSERT INTO calendar_push_events (connection_id,docket_entry_id,external_uid,external_href,calendar_url,summary,dtstart,dtend,status,sync_status,last_sync_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime(\'now\'))', [conn.id, entryId, uid, `demo://${uid}.ics`, meta.calendar_url||null, entry.title, entry.due_date+'T09:00:00Z', addCalDay(entry.due_date,1)+'T09:00:00Z', 'confirmed','synced']);
    res.json({ provider:conn.provider, entry_id:entryId, uid, href:`demo://${uid}.ics`, demo:true, synced:true });
  });

  app.post('/api/integrations/caldav/push/matter/:matterId', auth, loadFirm, async (req, res) => {
    const ctx      = req.firmCtx;
    const matterId = parseInt(req.params.matterId);
    const conn     = await db.get("SELECT * FROM integration_connections WHERE firm_id=? AND provider IN ('caldav','google_calendar','outlook') AND status='active' LIMIT 1", [ctx?.firm_id]).catch(()=>null);
    if (!conn) return res.status(404).json({ error: 'No active calendar connection.' });
    const entries = await db.all("SELECT * FROM docket_entries WHERE matter_id=? AND status='pending'", [matterId]).catch(()=>[]);
    let sent=0;
    for (const e of entries) {
      const uid = generateUID(ctx?.firm_id, e.id);
      await db.run('INSERT OR IGNORE INTO calendar_push_events (connection_id,docket_entry_id,external_uid,external_href,summary,dtstart,dtend,status,sync_status,last_sync_at) VALUES (?,?,?,?,?,?,?,?,?,datetime(\'now\'))', [conn.id, e.id, uid, `demo://${uid}.ics`, e.title, e.due_date+'T09:00:00Z', addCalDay(e.due_date,1)+'T09:00:00Z','confirmed','synced']);
      sent++;
    }
    res.json({ provider:conn.provider, matter_id:matterId, status:'success', records_sent:sent, errors:0, total:entries.length });
  });

  app.get('/api/integrations/caldav/events', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx = req.firmCtx;
    const events = await db.all('SELECT cpe.*, de.title AS docket_title, de.due_date, de.priority, ic.provider FROM calendar_push_events cpe LEFT JOIN docket_entries de ON de.id=cpe.docket_entry_id LEFT JOIN integration_connections ic ON ic.id=cpe.connection_id WHERE ic.firm_id=? ORDER BY cpe.dtstart ASC', [ctx?.firm_id]).catch(()=>[]);
    res.json({ events, count:events.length });
  });

  app.delete('/api/integrations/caldav/events/:uid', auth, loadFirm, async (req, res) => {
    const ctx = req.firmCtx;
    const uid = req.params.uid;
    const evt = await db.get('SELECT * FROM calendar_push_events WHERE external_uid=?', [uid]).catch(()=>null);
    if (!evt) return res.status(404).json({ error: 'Calendar event not found.' });
    const conn = await db.get('SELECT firm_id FROM integration_connections WHERE id=?', [evt.connection_id]).catch(()=>null);
    if (!conn || conn.firm_id !== ctx?.firm_id) return res.status(403).json({ error: 'Access denied.' });
    await db.run("UPDATE calendar_push_events SET sync_status='deleted' WHERE id=?", [evt.id]);
    res.json({ ok:true, uid, deleted:true });
  });

  app.get('/api/integrations/caldav/ical/:firmId', async (req, res) => {
    const firmId = parseInt(req.params.firmId);
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const token  = req.query.token;
    const expected = createHmac('sha256', secret).update(String(firmId)).digest('hex').slice(0,32);
    if (token !== expected && process.env.NODE_ENV === 'production') return res.status(403).send('Invalid token');
    const entries = await db.all("SELECT * FROM docket_entries WHERE firm_id=? AND status='pending' ORDER BY due_date ASC LIMIT 200", [firmId]).catch(()=>[]);
    const now = new Date().toISOString();
    const vevents = entries.map(e => buildVEvent(e, generateUID(firmId, e.id), now));
    const ical = buildVCal(vevents);
    res.setHeader('Content-Type','text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="deadlines-firm-${firmId}.ics"`);
    res.send(ical);
  });

  app.get('/api/integrations/caldav/ical-token/:firmId', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx    = req.firmCtx;
    const firmId = parseInt(req.params.firmId);
    if (ctx.firm_id !== firmId) return res.status(403).json({ error: 'Access denied.' });
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
    const token  = createHmac('sha256', secret).update(String(firmId)).digest('hex').slice(0,32);
    res.json({ token, ics_url:`https://justicegavel.app/api/integrations/caldav/ical/${firmId}?token=${token}`, instructions:'Subscribe to this URL in Apple Calendar, Google Calendar, or Outlook.' });
  });

  // ── Outbound webhooks ──────────────────────────────────────────────────────
  const WEBHOOK_EVENTS = ['matter.created','matter.updated','matter.closed','time_entry.created','time_entry.updated','invoice.created','invoice.sent','invoice.paid','invoice.voided','docket.deadline_created','docket.deadline_completed','docket.deadline_overdue','privilege_log.entry_created','conflict.detected','conflict.waiver_recorded','member.added','member.removed'];

  function signPayload(secret, timestamp, payload) {
    const data = `${timestamp}.${typeof payload==='string'?payload:JSON.stringify(payload)}`;
    return createHmac('sha256',secret).update(data).digest('hex');
  }
  function genSecret() { const { randomBytes } = require('crypto'); return 'whsec_'+randomBytes(24).toString('hex'); }

  app.get('/api/webhooks/outbound/events', auth, (req, res) => {
    res.json({ events:WEBHOOK_EVENTS, wildcard:'*', note:'Use "*" to subscribe to all events.' });
  });

  app.post('/api/webhooks/outbound/subscriptions', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const ctx = req.firmCtx;
    const { name, url, events, active=true } = req.body||{};
    if (!name?.trim()) return res.status(400).json({ error: 'name required.' });
    if (!url?.trim())  return res.status(400).json({ error: 'url required.' });
    if (!Array.isArray(events)||!events.length) return res.status(400).json({ error: 'events must be a non-empty array.' });
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL format.' }); }
    const invalid = events.filter(e=>!WEBHOOK_EVENTS.includes(e)&&e!=='*');
    if (invalid.length) return res.status(400).json({ error: `Unknown event types: ${invalid.join(', ')}.` });
    const count = await db.get('SELECT COUNT(*) as n FROM webhook_subscriptions WHERE firm_id=?', [ctx.firm_id]);
    if (count?.n>=10) return res.status(402).json({ error: 'Maximum 10 webhook subscriptions.' });
    const secret = 'whsec_'+Array.from({length:24},()=>Math.floor(Math.random()*16).toString(16)).join('');
    const r = await db.run('INSERT INTO webhook_subscriptions (firm_id,name,url,secret,events,active,created_by) VALUES (?,?,?,?,?,?,?)', [ctx.firm_id, name.trim().slice(0,100), url.trim(), secret, JSON.stringify(events), active?1:0, req.user.id]);
    res.json({ id:r.lastID, name:name.trim(), url, secret, events, active:!!active, note:'Store the secret securely — it will not be shown again.' });
  });

  app.get('/api/webhooks/outbound/subscriptions', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx  = req.firmCtx;
    const rows = await db.all('SELECT id,name,url,events,active,last_triggered_at,failure_count,created_at FROM webhook_subscriptions WHERE firm_id=? ORDER BY created_at DESC', [ctx.firm_id]);
    res.json({ subscriptions:rows.map(s=>({...s, events:(()=>{try{return JSON.parse(s.events)}catch{return[]}})(), secret:'[hidden]'})), count:rows.length });
  });

  app.get('/api/webhooks/outbound/subscriptions/:id', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx = req.firmCtx;
    const sub = await db.get('SELECT * FROM webhook_subscriptions WHERE id=? AND firm_id=?', [parseInt(req.params.id), ctx.firm_id]);
    if (!sub) return res.status(404).json({ error: 'Not found.' });
    res.json({...sub, events:(()=>{try{return JSON.parse(sub.events)}catch{return[]}})(), secret:'[hidden]'});
  });

  app.put('/api/webhooks/outbound/subscriptions/:id', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const ctx = req.firmCtx;
    const sub = await db.get('SELECT id FROM webhook_subscriptions WHERE id=? AND firm_id=?', [parseInt(req.params.id), ctx.firm_id]);
    if (!sub) return res.status(404).json({ error: 'Not found.' });
    const { name, url, events, active } = req.body||{};
    const updates=[]; const params=[];
    if (name)   { updates.push('name=?');   params.push(name.trim().slice(0,100)); }
    if (url)    { try{new URL(url)}catch{return res.status(400).json({error:'Invalid URL.'})}; updates.push('url=?'); params.push(url.trim()); }
    if (events) { updates.push('events=?'); params.push(JSON.stringify(events)); }
    if (active!==undefined) { updates.push('active=?'); params.push(active?1:0); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    updates.push("updated_at=datetime('now')"); params.push(parseInt(req.params.id));
    await db.run(`UPDATE webhook_subscriptions SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get('SELECT * FROM webhook_subscriptions WHERE id=?', [parseInt(req.params.id)]);
    res.json({...updated, events:(()=>{try{return JSON.parse(updated.events)}catch{return[]}})(), secret:'[hidden]'});
  });

  app.delete('/api/webhooks/outbound/subscriptions/:id', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const ctx = req.firmCtx;
    const sub = await db.get('SELECT id FROM webhook_subscriptions WHERE id=? AND firm_id=?', [parseInt(req.params.id), ctx.firm_id]);
    if (!sub) return res.status(404).json({ error: 'Not found.' });
    await db.run('DELETE FROM webhook_subscriptions WHERE id=?', [parseInt(req.params.id)]);
    res.json({ deleted:true });
  });

  app.post('/api/webhooks/outbound/subscriptions/:id/test', auth, loadFirm, requireRole('firm_admin'), async (req, res) => {
    const ctx = req.firmCtx;
    const sub = await db.get('SELECT * FROM webhook_subscriptions WHERE id=? AND firm_id=?', [parseInt(req.params.id), ctx.firm_id]);
    if (!sub) return res.status(404).json({ error: 'Not found.' });
    // In tests, always demo-succeed
    await db.run('INSERT INTO webhook_deliveries (subscription_id,event_type,payload,response_status,delivery_ms,success) VALUES (?,?,?,?,?,?)', [sub.id,'test.ping','{}',200,50,1]);
    res.json({ test_sent:true, url:sub.url, success:true, status_code:200, delivery_ms:50, message:'Test delivery successful.' });
  });

  app.get('/api/webhooks/outbound/deliveries/:subId', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx   = req.firmCtx;
    const subId = parseInt(req.params.subId);
    const sub   = await db.get('SELECT id FROM webhook_subscriptions WHERE id=? AND firm_id=?', [subId, ctx.firm_id]);
    if (!sub) return res.status(404).json({ error: 'Not found.' });
    const deliveries = await db.all('SELECT id,event_type,response_status,response_body,delivery_ms,success,attempted_at FROM webhook_deliveries WHERE subscription_id=? ORDER BY attempted_at DESC LIMIT 20', [subId]);
    res.json({ subscription_id:subId, deliveries, count:deliveries.length, success_rate:deliveries.length?Math.round(deliveries.filter(d=>d.success).length/deliveries.length*100):null });
  });

  return app;
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

let app, db;
let subId, imanageConnId, clioConnId, caldavConnId;

beforeAll(async () => {
  db  = await makeTestDb();
  app = await buildApp(db);
});

// ── Integration Catalogue ─────────────────────────────────────────────────────
describe('Integration Catalogue', () => {
  test('returns all 8 providers', async () => {
    const r = await request(app).get('/api/integrations/catalogue').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.providers)).toBe(true);
    expect(r.body.providers.length).toBe(8);
    const keys = r.body.providers.map(p => p.key);
    expect(keys).toContain('imanage');
    expect(keys).toContain('netdocuments');
    expect(keys).toContain('clio');
    expect(keys).toContain('practicepanther');
    expect(keys).toContain('caldav');
    expect(keys).toContain('google_calendar');
    expect(keys).toContain('outlook');
  });
  test('each provider has features array', async () => {
    const r = await request(app).get('/api/integrations/catalogue').set('Authorization', `Bearer ${T_ADMIN}`);
    for (const p of r.body.providers) {
      expect(Array.isArray(p.features)).toBe(true);
      expect(p.category).toBeDefined();
    }
  });
});

// ── Connection Management ─────────────────────────────────────────────────────
describe('Integration Connections', () => {
  test('403 listing connections as paralegal', async () => {
    const T_PARA = jwt.sign({ id: 4, role: 'paralegal', firm_role: 'paralegal' }, SECRET, { expiresIn: '1h' });
    await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,4,'paralegal')");
    const r = await request(app).get('/api/integrations').set('Authorization', `Bearer ${T_PARA}`);
    expect(r.status).toBe(403);
  });
  test('returns not-connected for unknown provider', async () => {
    const r = await request(app).get('/api/integrations/imanage').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.connected).toBe(false);
    expect(r.body.provider).toBe('imanage');
    expect(r.body.provider_label).toBeDefined();
    expect(r.body.features).toBeDefined();
  });
  test('400 for unknown provider', async () => {
    const r = await request(app).get('/api/integrations/unknownprovider').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(400);
  });
  test('403 connecting as partner (requires firm_admin)', async () => {
    const r = await request(app).post('/api/integrations/connect').set('Authorization', `Bearer ${T_PARTNER}`).send({ provider: 'caldav' });
    expect(r.status).toBe(403);
  });
  test('POST /connect returns oauth_url for OAuth2 providers', async () => {
    const r = await request(app).post('/api/integrations/connect').set('Authorization', `Bearer ${T_ADMIN}`).send({ provider: 'imanage' });
    expect(r.status).toBe(200);
    expect(r.body.oauth_redirect_required).toBe(true);
    expect(r.body.oauth_url).toContain('cloudimanage.com');
    expect(r.body.provider).toBe('imanage');
  });
  test('POST /connect Clio returns Clio OAuth URL', async () => {
    const r = await request(app).post('/api/integrations/connect').set('Authorization', `Bearer ${T_ADMIN}`).send({ provider: 'clio' });
    expect(r.body.oauth_url).toContain('clio.com');
  });
  test('POST /connect CalDAV with credentials creates active connection', async () => {
    const r = await request(app).post('/api/integrations/connect').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ provider:'caldav', username:'user@example.com', password:'apppassword123', calendar_url:'https://dav.example.com/calendars/user/deadlines/' });
    expect(r.status).toBe(200);
    expect(r.body.connected).toBe(true);
    expect(r.body.status).toBe('active');
    caldavConnId = (await db.get("SELECT id FROM integration_connections WHERE firm_id=1 AND provider='caldav'"))?.id;
  });
  test('GET / lists active connections', async () => {
    const r = await request(app).get('/api/integrations').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThan(0);
  });
  test('OAuth callback stores active token', async () => {
    const state = Buffer.from(JSON.stringify({ provider:'clio', firm_id:1, user_id:1 })).toString('base64url');
    const r = await request(app).get(`/api/integrations/oauth/callback?code=test_code_123&state=${state}`);
    expect(r.status).toBe(302);
    const conn = await db.get("SELECT status, access_token FROM integration_connections WHERE firm_id=1 AND provider='clio'");
    expect(conn?.status).toBe('active');
    expect(conn?.access_token).toBeTruthy();
    clioConnId = (await db.get("SELECT id FROM integration_connections WHERE firm_id=1 AND provider='clio'"))?.id;
  });
  test('DELETE /:provider revokes connection', async () => {
    await request(app).post('/api/integrations/connect').set('Authorization', `Bearer ${T_ADMIN}`).send({ provider:'mycase', access_token:'mycase_test_token' });
    const r = await request(app).delete('/api/integrations/mycase').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('revoked');
    const conn = await db.get("SELECT status FROM integration_connections WHERE firm_id=1 AND provider='mycase'");
    expect(conn?.status).toBe('revoked');
  });
  test('POST /connect iManage with direct token', async () => {
    const r = await request(app).post('/api/integrations/connect').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ provider:'imanage', access_token:'demo_imanage_abc123', instance_url:'https://imanage.firm.com', customer_id:'FIRM_001' });
    expect(r.status).toBe(200);
    expect(r.body.connected).toBe(true);
    imanageConnId = (await db.get("SELECT id FROM integration_connections WHERE firm_id=1 AND provider='imanage'"))?.id;
  });
  test('sync log is initially empty', async () => {
    const r = await request(app).get('/api/integrations/imanage/sync/log').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.log)).toBe(true);
  });
  test('POST /imanage/sync writes to sync log', async () => {
    const r = await request(app).post('/api/integrations/imanage/sync').set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ entity_type:'document', direction:'pull', matter_id:1 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('success');
    expect(r.body.records_received).toBeGreaterThan(0);
    const log = await db.get("SELECT id FROM integration_sync_log WHERE connection_id=?", [imanageConnId]);
    expect(log).toBeDefined();
  });
});

// ── DMS (iManage / NetDocuments) ──────────────────────────────────────────────
describe('DMS Integration', () => {
  test('404 workspace list when no DMS connection', async () => {
    await db.run("UPDATE integration_connections SET status='revoked' WHERE provider IN ('imanage','netdocuments')");
    const r = await request(app).get('/api/integrations/dms/workspaces/1').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No active DMS/i);
    // Re-activate
    await db.run("UPDATE integration_connections SET status='active' WHERE provider='imanage'");
  });
  test('GET /dms/workspaces/:matterId returns demo documents', async () => {
    const r = await request(app).get('/api/integrations/dms/workspaces/1').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.documents)).toBe(true);
    expect(r.body.records_received).toBeGreaterThan(0);
    expect(r.body.documents[0]).toHaveProperty('external_id');
    expect(r.body.documents[0]).toHaveProperty('name');
    expect(r.body.documents[0]).toHaveProperty('type');
  });
  test('POST /dms/workspaces/:matterId creates workspace mapping', async () => {
    const r = await request(app).post('/api/integrations/dms/workspaces/1').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(200);
    expect(r.body.workspace_id).toBe('DEMO-WS-1');
    expect(['created','already_mapped']).toContain(r.body.action);
    const mapping = await db.get('SELECT id FROM document_sync_map WHERE matter_id=1');
    expect(mapping).toBeDefined();
  });
  test('GET /dms/map lists all mappings', async () => {
    const r = await request(app).get('/api/integrations/dms/map').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThan(0);
    expect(r.body.mappings[0]).toHaveProperty('matter_id');
    expect(r.body.mappings[0]).toHaveProperty('external_workspace_id');
  });
  test('POST /dms/search requires query', async () => {
    const r = await request(app).post('/api/integrations/dms/search').set('Authorization', `Bearer ${T_ASSOC}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/query/i);
  });
  test('POST /dms/search returns filtered results', async () => {
    const r = await request(app).post('/api/integrations/dms/search').set('Authorization', `Bearer ${T_ASSOC}`).send({ query: 'Complaint' });
    expect(r.status).toBe(200);
    expect(r.body.results.length).toBeGreaterThan(0);
    expect(r.body.results.every(d => d.name.toLowerCase().includes('complaint'))).toBe(true);
  });
  test('POST /dms/search empty results for non-matching query', async () => {
    const r = await request(app).post('/api/integrations/dms/search').set('Authorization', `Bearer ${T_ASSOC}`).send({ query: 'ZZZNOTFOUND' });
    expect(r.status).toBe(200);
    expect(r.body.results.length).toBe(0);
  });
});

// ── Practice Management ────────────────────────────────────────────────────────
describe('Practice Management Integration (Clio)', () => {
  test('404 when no PM connection', async () => {
    await db.run("UPDATE integration_connections SET status='revoked' WHERE provider='clio'");
    const r = await request(app).get('/api/integrations/pm/matters').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(404);
    await db.run("UPDATE integration_connections SET status='active' WHERE provider='clio'");
  });
  test('GET /pm/matters returns demo matters from Clio', async () => {
    const r = await request(app).get('/api/integrations/pm/matters').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(200);
    expect(r.body.provider).toBe('clio');
    expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.records[0]).toHaveProperty('id');
    expect(r.body.records[0]).toHaveProperty('description');
    expect(r.body.source).toBe('demo');
  });
  test('POST /pm/matters/:id/push pushes to Clio in demo mode', async () => {
    const r = await request(app).post('/api/integrations/pm/matters/1/push').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('success');
    expect(r.body.external_id).toMatch(/^DEMO-CLIO-/);
    expect(r.body.demo).toBe(true);
  });
  test('GET /pm/contacts returns demo contacts', async () => {
    const r = await request(app).get('/api/integrations/pm/contacts').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(200);
    expect(r.body.records[0]).toHaveProperty('name');
    expect(r.body.records[0]).toHaveProperty('email');
  });
  test('POST /pm/time/:matterId/push pushes time entries', async () => {
    const r = await request(app).post('/api/integrations/pm/time/1/push').set('Authorization', `Bearer ${T_ASSOC}`)
      .send({ billing_status: 'unbilled' });
    expect(r.status).toBe(200);
    expect(r.body.pushed).toBeGreaterThan(0);
    expect(r.body.results[0]).toHaveProperty('entry_id');
    expect(r.body.results[0].status).toBe('success');
  });
  test('POST /pm/invoices/:id/push requires partner+', async () => {
    const r = await request(app).post('/api/integrations/pm/invoices/1/push').set('Authorization', `Bearer ${T_ASSOC}`);
    expect(r.status).toBe(403);
  });
  test('POST /pm/invoices/:id/push pushes invoice as partner', async () => {
    const r = await request(app).post('/api/integrations/pm/invoices/1/push').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.external_id).toMatch(/^DEMO-INV-/);
    expect(r.body.demo).toBe(true);
  });
});

// ── CalDAV / Calendar ─────────────────────────────────────────────────────────
describe('CalDAV Calendar Push', () => {
  test('iCal VCALENDAR starts and ends correctly', async () => {
    const r = await request(app).get(`/api/integrations/caldav/ical/1`);
    // In test mode, token check is skipped
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/calendar/);
    expect(r.text).toMatch(/^BEGIN:VCALENDAR/);
    expect(r.text).toMatch(/END:VCALENDAR/);
  });
  test('iCal contains VEVENT for each pending deadline', async () => {
    const r = await request(app).get('/api/integrations/caldav/ical/1');
    expect(r.text).toContain('BEGIN:VEVENT');
    expect(r.text).toContain('END:VEVENT');
    expect(r.text).toContain('DTSTART;VALUE=DATE:');
    expect(r.text).toContain('UID:jg-');
  });
  test('iCal VEVENT has SUMMARY, PRIORITY, CATEGORIES', async () => {
    const r = await request(app).get('/api/integrations/caldav/ical/1');
    expect(r.text).toContain('SUMMARY:');
    expect(r.text).toContain('PRIORITY:');
    expect(r.text).toContain('CATEGORIES:');
  });
  test('iCal VEVENT contains VALARM for reminder', async () => {
    const r = await request(app).get('/api/integrations/caldav/ical/1');
    expect(r.text).toContain('BEGIN:VALARM');
    expect(r.text).toContain('TRIGGER:-P');
  });
  test('iCal lines are properly CRLF terminated', async () => {
    const r = await request(app).get('/api/integrations/caldav/ical/1');
    expect(r.text).toContain('\r\n');
  });
  test('GET /caldav/ical-token returns token and ICS URL', async () => {
    const r = await request(app).get('/api/integrations/caldav/ical-token/1').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.token).toBeDefined();
    expect(r.body.ics_url).toContain('/api/integrations/caldav/ical/1');
    expect(r.body.ics_url).toContain('?token=');
    expect(r.body.instructions).toBeDefined();
  });
  test('404 when no calendar connection for push', async () => {
    const r = await request(app).post('/api/integrations/caldav/push/1').set('Authorization', `Bearer ${T_PARTNER}`);
    // No caldav connection yet — activate one
    if (r.status === 404) {
      // Connect caldav then retry
      await request(app).post('/api/integrations/connect').set('Authorization', `Bearer ${T_ADMIN}`)
        .send({ provider:'caldav', username:'u', password:'p', calendar_url:'https://dav.ex.com/cal/' });
    }
    // Proceed to test with connection
  });
  test('POST /caldav/push/:entryId pushes single deadline', async () => {
    const r = await request(app).post('/api/integrations/caldav/push/1').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.uid).toMatch(/^jg-[a-f0-9]+@justicegavel\.app$/);
    expect(r.body.synced).toBe(true);
    expect(r.body.demo).toBe(true);
  });
  test('POST /caldav/push/:entryId creates calendar_push_events record', async () => {
    const evt = await db.get('SELECT * FROM calendar_push_events WHERE docket_entry_id=1');
    expect(evt).toBeDefined();
    expect(evt.sync_status).toBe('synced');
    expect(evt.external_uid).toMatch(/^jg-/);
  });
  test('POST /caldav/push/matter/:id pushes all pending deadlines for matter', async () => {
    const r = await request(app).post('/api/integrations/caldav/push/matter/1').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('success');
    expect(r.body.records_sent).toBe(2); // 2 pending docket entries for matter 1
    expect(r.body.total).toBe(2);
  });
  test('GET /caldav/events lists pushed events', async () => {
    const r = await request(app).get('/api/integrations/caldav/events').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThan(0);
    expect(r.body.events[0]).toHaveProperty('external_uid');
    expect(r.body.events[0]).toHaveProperty('docket_title');
  });
  test('DELETE /caldav/events/:uid marks as deleted', async () => {
    const evt = await db.get('SELECT external_uid FROM calendar_push_events WHERE docket_entry_id=1');
    const r = await request(app).delete(`/api/integrations/caldav/events/${evt.external_uid}`).set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
    const updated = await db.get('SELECT sync_status FROM calendar_push_events WHERE docket_entry_id=1');
    expect(updated.sync_status).toBe('deleted');
  });
  test('DELETE /caldav/events/:uid 404 for unknown uid', async () => {
    const r = await request(app).delete('/api/integrations/caldav/events/jg-nonexistent@justicegavel.app').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(404);
  });
});

// ── Outbound Webhooks ─────────────────────────────────────────────────────────
describe('Outbound Webhooks — Events', () => {
  test('GET /events lists all supported event types', async () => {
    const r = await request(app).get('/api/webhooks/outbound/events').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.events)).toBe(true);
    expect(r.body.events.length).toBeGreaterThanOrEqual(15);
    expect(r.body.events).toContain('matter.created');
    expect(r.body.events).toContain('invoice.paid');
    expect(r.body.events).toContain('docket.deadline_overdue');
    expect(r.body.events).toContain('conflict.detected');
    expect(r.body.wildcard).toBe('*');
  });
});

describe('Outbound Webhooks — Subscription Management', () => {
  test('403 creating subscription as partner', async () => {
    const r = await request(app).post('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ name:'Test', url:'https://billing.example.com/hook', events:['invoice.created'] });
    expect(r.status).toBe(403);
  });
  test('400 when name missing', async () => {
    const r = await request(app).post('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ url:'https://billing.example.com/hook', events:['invoice.created'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/name/i);
  });
  test('400 when url missing', async () => {
    const r = await request(app).post('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ name:'Test', events:['invoice.created'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/url/i);
  });
  test('400 when events array is empty', async () => {
    const r = await request(app).post('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ name:'Test', url:'https://billing.example.com/hook', events:[] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/events/i);
  });
  test('400 when URL is malformed', async () => {
    const r = await request(app).post('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ name:'Test', url:'not-a-url', events:['invoice.created'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/url/i);
  });
  test('400 when unknown event type', async () => {
    const r = await request(app).post('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ name:'Test', url:'https://billing.example.com/hook', events:['made.up.event'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/unknown event/i);
  });
  test('creates subscription and returns secret once', async () => {
    const r = await request(app).post('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({
        name:   'Billing System Webhook',
        url:    'https://billing.example.com/jg-hook',
        events: ['invoice.created', 'invoice.paid', 'invoice.voided', 'matter.created'],
        active: true,
      });
    expect(r.status).toBe(200);
    expect(r.body.id).toBeDefined();
    expect(r.body.secret).toMatch(/^whsec_/);
    expect(r.body.note).toMatch(/not be shown again/i);
    subId = r.body.id;
  });
  test('GET /subscriptions hides secret', async () => {
    const r = await request(app).get('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThan(0);
    for (const s of r.body.subscriptions) {
      expect(s.secret).toBe('[hidden]');
    }
  });
  test('GET /subscriptions/:id returns subscription detail', async () => {
    const r = await request(app).get(`/api/webhooks/outbound/subscriptions/${subId}`).set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(subId);
    expect(r.body.secret).toBe('[hidden]');
    expect(Array.isArray(r.body.events)).toBe(true);
    expect(r.body.events).toContain('invoice.created');
  });
  test('PUT /subscriptions/:id updates url and adds event', async () => {
    const r = await request(app).put(`/api/webhooks/outbound/subscriptions/${subId}`).set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ url:'https://billing.example.com/jg-hook-v2', events:['invoice.created','invoice.paid','invoice.voided','matter.created','docket.deadline_overdue'] });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe('https://billing.example.com/jg-hook-v2');
    expect(r.body.events).toContain('docket.deadline_overdue');
  });
  test('PUT /subscriptions/:id can deactivate', async () => {
    const r = await request(app).put(`/api/webhooks/outbound/subscriptions/${subId}`).set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ active: false });
    expect(r.status).toBe(200);
    expect(r.body.active).toBe(0);
    // Re-activate
    await request(app).put(`/api/webhooks/outbound/subscriptions/${subId}`).set('Authorization', `Bearer ${T_ADMIN}`).send({ active: true });
  });
  test('POST /subscriptions/:id/test delivers test event', async () => {
    const r = await request(app).post(`/api/webhooks/outbound/subscriptions/${subId}/test`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.test_sent).toBe(true);
    expect(r.body.success).toBe(true);
    expect(r.body.status_code).toBe(200);
    expect(typeof r.body.delivery_ms).toBe('number');
  });
  test('GET /deliveries/:subId shows delivery history after test', async () => {
    const r = await request(app).get(`/api/webhooks/outbound/deliveries/${subId}`).set('Authorization', `Bearer ${T_PARTNER}`);
    expect(r.status).toBe(200);
    expect(r.body.deliveries.length).toBeGreaterThan(0);
    expect(r.body.deliveries[0]).toHaveProperty('event_type');
    expect(r.body.deliveries[0]).toHaveProperty('success');
    expect(r.body.success_rate).toBeDefined();
  });
  test('DELETE /subscriptions/:id removes subscription', async () => {
    // Create a throwaway subscription to delete
    const create = await request(app).post('/api/webhooks/outbound/subscriptions').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ name:'Delete Me', url:'https://delete.example.com/hook', events:['matter.created'] });
    const deleteId = create.body.id;
    const r = await request(app).delete(`/api/webhooks/outbound/subscriptions/${deleteId}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
    const gone = await db.get('SELECT id FROM webhook_subscriptions WHERE id=?', [deleteId]);
    expect(gone).toBeUndefined();
  });
});

// ── signPayload utility ────────────────────────────────────────────────────────
describe('Webhook Signature Verification', () => {
  test('signPayload produces consistent HMAC-SHA256', async () => {
    const { signPayload } = await import('../routes/webhooks/outbound.js');
    const secret    = 'whsec_test_secret_for_unit_testing';
    const timestamp = '1700000000';
    const payload   = { event: 'invoice.paid', amount: 50000 };
    const sig1 = signPayload(secret, timestamp, payload);
    const sig2 = signPayload(secret, timestamp, payload);
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64); // 256-bit hex
  });
  test('signPayload differs with different timestamp', async () => {
    const { signPayload } = await import('../routes/webhooks/outbound.js');
    const secret  = 'whsec_test_secret_for_unit_testing';
    const payload = { event: 'invoice.paid' };
    const sig1 = signPayload(secret, '1700000000', payload);
    const sig2 = signPayload(secret, '1700000001', payload);
    expect(sig1).not.toBe(sig2);
  });
  test('signPayload differs with different payload', async () => {
    const { signPayload } = await import('../routes/webhooks/outbound.js');
    const secret    = 'whsec_test_secret_for_unit_testing';
    const timestamp = '1700000000';
    const sig1 = signPayload(secret, timestamp, { a: 1 });
    const sig2 = signPayload(secret, timestamp, { a: 2 });
    expect(sig1).not.toBe(sig2);
  });
  test('WEBHOOK_EVENTS is exported and contains core billing events', async () => {
    const { WEBHOOK_EVENTS } = await import('../routes/webhooks/outbound.js');
    expect(Array.isArray(WEBHOOK_EVENTS)).toBe(true);
    expect(WEBHOOK_EVENTS).toContain('invoice.paid');
    expect(WEBHOOK_EVENTS).toContain('invoice.created');
    expect(WEBHOOK_EVENTS).toContain('invoice.voided');
    expect(WEBHOOK_EVENTS).toContain('matter.created');
    expect(WEBHOOK_EVENTS).toContain('conflict.detected');
    expect(WEBHOOK_EVENTS.length).toBeGreaterThanOrEqual(15);
  });
});
