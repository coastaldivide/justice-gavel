/**
 * irreplaceable.test.js — Year 2: Time Tracking, Invoices, Dockets, Privilege Log, Motion PDF
 *
 * Coverage:
 *   Time Tracking:
 *     - Create time entry with 6-minute rounding
 *     - Requires entry_date, hours, narrative
 *     - Hours rounded to nearest 0.1
 *     - Hours must be 0.1–24
 *     - List entries with filters (matter, date range, billing_status)
 *     - Get single entry with amount calculation
 *     - Update entry (cannot edit billed entry)
 *     - Delete entry (cannot delete billed)
 *     - Matter time summary with by-attorney breakdown
 *     - Firm time summary by status/month
 *     - ABA codes endpoint
 *
 *   Invoices:
 *     - Generate invoice from unbilled entries
 *     - Requires partner+ role
 *     - Requires client_name and matter_id
 *     - Calculates subtotal, tax, total correctly
 *     - Marks entries as billed after invoice creation
 *     - Unique invoice numbers (INV-YYYYMM-NNNN)
 *     - List invoices
 *     - Get invoice with line items
 *     - Update invoice status (sent/paid/void)
 *     - Void invoice restores entries to unbilled
 *     - 400 when no unbilled entries found
 *
 *   Docket / Deadlines:
 *     - GET /rules returns all rule sets
 *     - POST /calculate computes all deadlines from trigger date
 *     - FRCP complaint served: 8 deadlines
 *     - Criminal arrest: 6 deadlines
 *     - Transactional LOI: 6 deadlines
 *     - Calculate with save=true writes to docket_entries
 *     - Create manual docket entry
 *     - List entries with filters
 *     - Get single entry
 *     - Update entry (mark complete)
 *     - Delete entry
 *     - Matter docket with summary
 *     - Upcoming deadlines grouped by urgency
 *     - Date arithmetic: addDays, addBusinessDays
 *
 *   Privilege Log:
 *     - GET /bases returns all privilege bases
 *     - Create entry (manual)
 *     - Requires description and privilege_basis
 *     - Auto-numbers doc_number (PRIV-0001)
 *     - List entries for matter
 *     - Get single entry
 *     - Update entry
 *     - Delete entry
 *     - Matter privilege log with summary
 *     - CSV export returns correct headers
 *     - AI generation endpoint (demo mode fallback)
 *
 *   Motion PDF Export:
 *     - POST /preview requires motion_text
 *     - Returns PDF binary (application/pdf)
 *     - GET /:id/pdf returns 404 for unknown motion
 *     - GET /:id/pdf returns PDF for own motion
 *
 *   Transactional AI Persona:
 *     - TRANSACTIONAL_SYSTEM_PROMPT is exported
 *     - MOTION_PDF_SYSTEM_PROMPT is exported
 *     - Prompts contain required elements
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

// ── Build test app ─────────────────────────────────────────────────────────────
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
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, display_name TEXT, role TEXT DEFAULT 'user', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS firms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT, owner_id INTEGER, plan TEXT DEFAULT 'starter', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS firm_members (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT DEFAULT 'associate', active INTEGER DEFAULT 1, joined_at TEXT DEFAULT (datetime('now')), UNIQUE(firm_id, user_id));
    CREATE TABLE IF NOT EXISTS matters (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, created_by INTEGER NOT NULL, title TEXT NOT NULL, billing_rate INTEGER, status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS time_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, matter_id INTEGER, matter_table TEXT DEFAULT 'matters', user_id INTEGER NOT NULL, entry_date TEXT NOT NULL, hours REAL NOT NULL, rate_cents INTEGER NOT NULL, narrative TEXT NOT NULL, task_code TEXT, activity_code TEXT, billing_status TEXT DEFAULT 'unbilled', invoice_id INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, matter_id INTEGER, matter_table TEXT DEFAULT 'matters', invoice_number TEXT NOT NULL UNIQUE, client_name TEXT NOT NULL, client_email TEXT, billing_period_start TEXT, billing_period_end TEXT, subtotal_cents INTEGER NOT NULL DEFAULT 0, tax_rate REAL DEFAULT 0, tax_cents INTEGER DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0, status TEXT DEFAULT 'draft', due_date TEXT, paid_date TEXT, notes TEXT, pdf_generated INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS docket_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, matter_id INTEGER, matter_table TEXT DEFAULT 'matters', entry_type TEXT NOT NULL, title TEXT NOT NULL, description TEXT, due_date TEXT NOT NULL, due_time TEXT, court TEXT, rule_citation TEXT, calculated_from TEXT, days_from_event INTEGER, status TEXT DEFAULT 'pending', priority TEXT DEFAULT 'normal', assigned_to INTEGER, reminder_days INTEGER DEFAULT 3, reminded_at TEXT, completed_at TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS privilege_log (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, matter_id INTEGER, matter_table TEXT DEFAULT 'matters', doc_number TEXT NOT NULL, doc_date TEXT, doc_type TEXT, author TEXT, recipients TEXT, description TEXT NOT NULL, privilege_basis TEXT NOT NULL, withheld INTEGER DEFAULT 1, page_count INTEGER, ai_generated INTEGER DEFAULT 0, reviewed_by INTEGER, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS motion_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, motion_type TEXT NOT NULL, case_fields TEXT NOT NULL, draft TEXT NOT NULL, filing_status TEXT DEFAULT 'draft', filed_at TEXT, paid_cents INTEGER DEFAULT 999, stripe_pi_id TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS aba_codes (code TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, category TEXT);
  `);

  // Seed
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name) VALUES (1,'admin@t.com','Admin')");
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name) VALUES (2,'partner@t.com','Partner')");
  await db.run("INSERT OR IGNORE INTO users (id,email,display_name) VALUES (3,'assoc@t.com','Associate')");
  await db.run("INSERT OR IGNORE INTO firms (id,name,slug,owner_id) VALUES (1,'Test Firm','test-firm',1)");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,1,'firm_admin')");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,2,'partner')");
  await db.run("INSERT OR IGNORE INTO firm_members (firm_id,user_id,role) VALUES (1,3,'associate')");
  await db.run("INSERT OR IGNORE INTO matters (id,firm_id,created_by,title,billing_rate) VALUES (1,1,1,'Test Matter',350)");
  await db.run("INSERT OR IGNORE INTO aba_codes (code,type,label,category) VALUES ('L310','task','Written Discovery','Discovery')");
  await db.run("INSERT OR IGNORE INTO aba_codes (code,type,label,category) VALUES ('A104','activity','Review/Analyze','')");
  await db.run("INSERT OR IGNORE INTO motion_history (id,user_id,motion_type,case_fields,draft) VALUES (1,1,'suppress','{\"defendant_name\":\"John Smith\",\"court_name\":\"Circuit Court\",\"case_number\":\"2024-CR-001\"}','MOTION TO SUPPRESS EVIDENCE\n\nIN THE CIRCUIT COURT\n\nCase No. 2024-CR-001\n\nState v. John Smith\n\nCOMES NOW the Defendant, John Smith, and moves this Court to suppress...\n\nRespectfully submitted,\n\n_______________________________\nDefense Counsel')");

  // ── ABA codes ──────────────────────────────────────────────────────────────
  app.get('/api/time/aba-codes', auth, async (req, res) => {
    const type = req.query.type;
    const rows = await db.all(type ? 'SELECT * FROM aba_codes WHERE type=?' : 'SELECT * FROM aba_codes', type ? [type] : []);
    res.json({ codes: rows, count: rows.length });
  });

  // ── Time entries ───────────────────────────────────────────────────────────
  app.post('/api/time/entries', auth, loadFirm, async (req, res) => {
    const { matter_id, matter_table='matters', entry_date, hours, rate_cents, narrative, task_code, activity_code } = req.body || {};
    if (!entry_date) return res.status(400).json({ error: 'entry_date required.' });
    if (!hours)      return res.status(400).json({ error: 'hours required.' });
    if (!narrative?.trim()) return res.status(400).json({ error: 'narrative required.' });
    const safeH = Math.round(parseFloat(hours) * 10) / 10;
    if (safeH <= 0 || safeH > 24) return res.status(400).json({ error: 'hours must be 0.1–24.' });

    let resolvedRate = parseInt(rate_cents) || 0;
    if (!resolvedRate && matter_id) {
      const m = await db.get('SELECT billing_rate FROM matters WHERE id=?', [parseInt(matter_id)]).catch(() => null);
      resolvedRate = m?.billing_rate ? m.billing_rate * 100 : 0;
    }

    const r = await db.run(
      'INSERT INTO time_entries (firm_id,matter_id,matter_table,user_id,entry_date,hours,rate_cents,narrative,task_code,activity_code,billing_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [req.firmCtx?.firm_id||null, matter_id?parseInt(matter_id):null, matter_table, req.user.id, entry_date, safeH, resolvedRate, narrative, task_code||null, activity_code||null, 'unbilled']
    );
    const entry = await db.get('SELECT * FROM time_entries WHERE id=?', [r.lastID]);
    res.json({ ...entry, amount_cents: Math.round((entry.hours||0)*(entry.rate_cents||0)) });
  });

  app.get('/api/time/entries', auth, loadFirm, async (req, res) => {
    const { matter_id, billing_status, date_from, date_to } = req.query;
    let sql = 'SELECT te.*, u.display_name AS attorney_name FROM time_entries te LEFT JOIN users u ON u.id=te.user_id WHERE 1=1';
    const p = [];
    if (req.firmCtx?.firm_id) { sql += ' AND te.firm_id=?'; p.push(req.firmCtx.firm_id); }
    else { sql += ' AND te.user_id=?'; p.push(req.user.id); }
    if (matter_id)       { sql += ' AND te.matter_id=?';     p.push(parseInt(matter_id)); }
    if (billing_status)  { sql += ' AND te.billing_status=?'; p.push(billing_status); }
    if (date_from)       { sql += ' AND te.entry_date>=?';    p.push(date_from); }
    if (date_to)         { sql += ' AND te.entry_date<=?';    p.push(date_to); }
    sql += ' ORDER BY te.entry_date DESC';
    const rows = await db.all(sql, p);
    const entries = rows.map(e => ({ ...e, amount_cents: Math.round((e.hours||0)*(e.rate_cents||0)) }));
    const totals = { hours: entries.reduce((s,e) => s+(e.hours||0), 0), amount_cents: entries.reduce((s,e) => s+(e.amount_cents||0), 0) };
    res.json({ entries, totals });
  });

  app.get('/api/time/entries/:id', auth, async (req, res) => {
    const entry = await db.get('SELECT * FROM time_entries WHERE id=?', [parseInt(req.params.id)]);
    if (!entry) return res.status(404).json({ error: 'Not found.' });
    res.json({ ...entry, amount_cents: Math.round((entry.hours||0)*(entry.rate_cents||0)) });
  });

  app.put('/api/time/entries/:id', auth, async (req, res) => {
    const entry = await db.get('SELECT * FROM time_entries WHERE id=?', [parseInt(req.params.id)]);
    if (!entry) return res.status(404).json({ error: 'Not found.' });
    if (entry.billing_status === 'billed') return res.status(400).json({ error: 'Cannot edit a billed time entry.' });
    const updates = []; const params = [];
    for (const key of ['entry_date','hours','rate_cents','narrative','billing_status']) {
      if (req.body[key] !== undefined) { updates.push(`${key}=?`); params.push(key==='hours' ? Math.round(parseFloat(req.body[key])*10)/10 : req.body[key]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    updates.push("updated_at=datetime('now')"); params.push(parseInt(req.params.id));
    await db.run(`UPDATE time_entries SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get('SELECT * FROM time_entries WHERE id=?', [parseInt(req.params.id)]);
    res.json({ ...updated, amount_cents: Math.round((updated.hours||0)*(updated.rate_cents||0)) });
  });

  app.delete('/api/time/entries/:id', auth, async (req, res) => {
    const entry = await db.get('SELECT * FROM time_entries WHERE id=?', [parseInt(req.params.id)]);
    if (!entry) return res.status(404).json({ error: 'Not found.' });
    if (entry.user_id !== req.user.id) return res.status(403).json({ error: 'Can only delete own entries.' });
    if (entry.billing_status === 'billed') return res.status(400).json({ error: 'Cannot delete billed entry.' });
    await db.run('DELETE FROM time_entries WHERE id=?', [parseInt(req.params.id)]);
    res.json({ deleted: true });
  });

  app.get('/api/time/matter/:matterId', auth, async (req, res) => {
    const matterId = parseInt(req.params.matterId);
    const entries = await db.all('SELECT te.*, u.display_name AS attorney_name FROM time_entries te LEFT JOIN users u ON u.id=te.user_id WHERE te.matter_id=? ORDER BY te.entry_date DESC', [matterId]);
    const withAmt = entries.map(e => ({ ...e, amount_cents: Math.round((e.hours||0)*(e.rate_cents||0)) }));
    const totals = { total_hours: withAmt.reduce((s,e)=>s+(e.hours||0),0), total_amount: withAmt.reduce((s,e)=>s+(e.amount_cents||0),0), unbilled_hours: withAmt.filter(e=>e.billing_status==='unbilled').reduce((s,e)=>s+(e.hours||0),0) };
    const byAtty = {};
    for (const e of withAmt) { const n=e.attorney_name||`User ${e.user_id}`; if(!byAtty[n]) byAtty[n]={hours:0,amount_cents:0,entries:0}; byAtty[n].hours+=e.hours||0; byAtty[n].amount_cents+=e.amount_cents||0; byAtty[n].entries++; }
    res.json({ matter_id: matterId, entries: withAmt, totals, by_attorney: Object.entries(byAtty).map(([name,v])=>({name,...v})) });
  });

  app.get('/api/time/summary', auth, loadFirm, async (req, res) => {
    const fid = req.firmCtx?.firm_id;
    const where = fid ? `AND firm_id=${fid}` : `AND user_id=${req.user.id}`;
    const byStatus = await db.all(`SELECT billing_status, SUM(hours) as hours, SUM(hours*rate_cents) as amount FROM time_entries WHERE 1=1 ${where} GROUP BY billing_status`);
    const byMonth  = await db.all(`SELECT substr(entry_date,1,7) as month, SUM(hours) as hours FROM time_entries WHERE 1=1 ${where} GROUP BY month ORDER BY month DESC LIMIT 12`);
    res.json({ by_status: byStatus, by_month: byMonth });
  });

  // ── Invoices ───────────────────────────────────────────────────────────────
  app.post('/api/time/invoices', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const ctx = req.firmCtx;
    if (!ctx?.firm_id) return res.status(403).json({ error: 'Firm required.' });
    const { matter_id, client_name, client_email, billing_period_start, billing_period_end, tax_rate=0, notes, due_date, entry_ids } = req.body || {};
    if (!client_name?.trim()) return res.status(400).json({ error: 'client_name required.' });
    if (!matter_id) return res.status(400).json({ error: 'matter_id required.' });

    let q = `SELECT * FROM time_entries WHERE firm_id=? AND matter_id=? AND billing_status='unbilled'`;
    const p = [ctx.firm_id, parseInt(matter_id)];
    if (Array.isArray(entry_ids) && entry_ids.length) { q += ` AND id IN (${entry_ids.map(()=>'?').join(',')})`; p.push(...entry_ids.map(Number)); }
    if (billing_period_start) { q += ' AND entry_date>=?'; p.push(billing_period_start); }
    if (billing_period_end)   { q += ' AND entry_date<=?'; p.push(billing_period_end); }

    const entries = await db.all(q, p);
    if (!entries.length) return res.status(400).json({ error: 'No unbilled time entries found.' });

    const subtotal = entries.reduce((s,e)=>s+Math.round((e.hours||0)*(e.rate_cents||0)),0);
    const safeTax  = Math.max(0, Math.min(parseFloat(tax_rate)||0, 50));
    const taxCents = Math.round(subtotal * safeTax / 100);
    const total    = subtotal + taxCents;

    const ym    = new Date().toISOString().slice(0,7).replace('-','');
    const count = await db.get("SELECT COUNT(*) as n FROM invoices WHERE firm_id=? AND invoice_number LIKE ?", [ctx.firm_id, `INV-${ym}-%`]);
    const invNum = `INV-${ym}-${String((count?.n||0)+1).padStart(4,'0')}`;

    const inv = await db.run(
      'INSERT INTO invoices (firm_id,matter_id,invoice_number,client_name,client_email,billing_period_start,billing_period_end,subtotal_cents,tax_rate,tax_cents,total_cents,status,due_date,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [ctx.firm_id,parseInt(matter_id),invNum,client_name,client_email||null,billing_period_start||null,billing_period_end||null,subtotal,safeTax,taxCents,total,'draft',due_date||null,notes||null,req.user.id]
    );
    const invId = inv.lastID;
    for (const e of entries) await db.run("UPDATE time_entries SET billing_status='billed', invoice_id=? WHERE id=?", [invId, e.id]);
    const invoice = await db.get('SELECT * FROM invoices WHERE id=?', [invId]);
    res.json({ ...invoice, entry_count: entries.length });
  });

  app.get('/api/time/invoices', auth, loadFirm, async (req, res) => {
    const ctx = req.firmCtx;
    if (!ctx?.firm_id) return res.json({ invoices: [], total: 0 });
    const rows = await db.all('SELECT * FROM invoices WHERE firm_id=? ORDER BY created_at DESC', [ctx.firm_id]);
    res.json({ invoices: rows, total: rows.length });
  });

  app.get('/api/time/invoices/:id', auth, loadFirm, async (req, res) => {
    const inv = await db.get('SELECT * FROM invoices WHERE id=?', [parseInt(req.params.id)]);
    if (!inv) return res.status(404).json({ error: 'Not found.' });
    if (inv.firm_id !== req.firmCtx?.firm_id) return res.status(403).json({ error: 'Access denied.' });
    const entries = await db.all('SELECT te.*, u.display_name AS attorney_name FROM time_entries te LEFT JOIN users u ON u.id=te.user_id WHERE te.invoice_id=? ORDER BY te.entry_date ASC', [inv.id]);
    res.json({ ...inv, entries: entries.map(e => ({ ...e, amount_cents: Math.round((e.hours||0)*(e.rate_cents||0)) })) });
  });

  app.put('/api/time/invoices/:id', auth, loadFirm, requireRole('partner'), async (req, res) => {
    const inv = await db.get('SELECT * FROM invoices WHERE id=?', [parseInt(req.params.id)]);
    if (!inv) return res.status(404).json({ error: 'Not found.' });
    const { status, paid_date, due_date, notes } = req.body || {};
    const VALID = ['draft','sent','paid','overdue','void'];
    const updates = []; const params = [];
    if (status && VALID.includes(status)) { updates.push('status=?'); params.push(status); }
    if (paid_date) { updates.push('paid_date=?'); params.push(paid_date); }
    if (due_date)  { updates.push('due_date=?');  params.push(due_date); }
    if (notes !== undefined) { updates.push('notes=?'); params.push(notes); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    if (status === 'void' && inv.status !== 'void') {
      await db.run("UPDATE time_entries SET billing_status='unbilled', invoice_id=NULL WHERE invoice_id=?", [inv.id]);
    }
    updates.push("updated_at=datetime('now')"); params.push(parseInt(req.params.id));
    await db.run(`UPDATE invoices SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get('SELECT * FROM invoices WHERE id=?', [parseInt(req.params.id)]);
    res.json(updated);
  });

  // ── Docket ─────────────────────────────────────────────────────────────────
  const RULE_SETS_KEYS = ['frcp_complaint_served','frcp_judgment_entered','criminal_arrest','criminal_conviction','transactional_loi'];
  function addDays(d, n) { const dt=new Date(d+'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate()+n); return dt.toISOString().slice(0,10); }
  function addBiz(d, n) { const dt=new Date(d+'T12:00:00Z'); let a=0; while(a<n){dt.setUTCDate(dt.getUTCDate()+1);const w=dt.getUTCDay();if(w!==0&&w!==6)a++;}return dt.toISOString().slice(0,10); }
  function diffDays(a,b){return Math.ceil((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/86400000);}

  const RULES = {
    frcp_complaint_served: { label:'Federal — Complaint Served', trigger:'service_date', rules:[
      {id:'frcp_answer',title:'Answer or MTD',days:21,rule:'FRCP 12(a)(1)(A)',priority:'critical',type:'filing'},
      {id:'frcp_26f',title:'Rule 26(f) Conference',days:21,rule:'FRCP 26(f)',priority:'high',type:'hearing'},
      {id:'frcp_26a1',title:'Initial Disclosures',days:35,rule:'FRCP 26(a)(1)',priority:'critical',type:'filing'},
      {id:'frcp_scheduling',title:'Scheduling Order',days:90,rule:'FRCP 16(b)',priority:'high',type:'deadline'},
      {id:'frcp_discovery',title:'Discovery Closes',days:120,rule:'FRCP 26',priority:'high',type:'deadline'},
      {id:'frcp_expert_init',title:'Initial Expert Disclosures',days:90,rule:'FRCP 26(a)(2)',priority:'high',type:'filing'},
      {id:'frcp_msj',title:'Dispositive Motions',days:150,rule:'Local Rules',priority:'high',type:'filing'},
      {id:'frcp_pretrial_disc',title:'Pretrial Disclosures',days:210,rule:'FRCP 26(a)(3)',priority:'critical',type:'filing'},
    ]},
    criminal_arrest: { label:'Criminal — Arrest', trigger:'arrest_date', rules:[
      {id:'crim_arraignment',title:'Arraignment',days:3,rule:'Fed.R.Crim.P. 10',priority:'critical',type:'hearing',business:true},
      {id:'crim_bail',title:'Bail Hearing',days:1,rule:'Fed.R.Crim.P. 46',priority:'critical',type:'hearing'},
      {id:'crim_prelim_fel',title:'Preliminary Hearing (Felony)',days:14,rule:'Fed.R.Crim.P. 5.1',priority:'critical',type:'hearing'},
      {id:'crim_prelim_mis',title:'Preliminary Hearing (Misd.)',days:10,rule:'Fed.R.Crim.P. 5.1',priority:'high',type:'hearing'},
      {id:'crim_speedy',title:'Speedy Trial Act',days:70,rule:'18 U.S.C. § 3161',priority:'critical',type:'deadline'},
      {id:'crim_indictment',title:'Indictment Deadline',days:30,rule:'Fed.R.Crim.P. 7',priority:'critical',type:'deadline'},
    ]},
    transactional_loi: { label:'Transactional — LOI Signed', trigger:'loi_date', rules:[
      {id:'txn_dd_start',title:'Due Diligence Opens',days:1,rule:'LOI § Exclusivity',priority:'high',type:'deadline'},
      {id:'txn_dd_end',title:'Due Diligence Closes',days:45,rule:'LOI § DD Period',priority:'critical',type:'deadline'},
      {id:'txn_exclusivity',title:'Exclusivity Expires',days:60,rule:'LOI § Exclusivity',priority:'critical',type:'deadline'},
      {id:'txn_draft_apa',title:'Draft APA Due',days:21,rule:'Market Practice',priority:'high',type:'filing'},
      {id:'txn_hsr',title:'HSR Filing',days:30,rule:'15 U.S.C. § 18a',priority:'critical',type:'filing'},
      {id:'txn_closing',title:'Target Closing',days:90,rule:'LOI § Closing',priority:'critical',type:'deadline'},
    ]},
  };

  app.get('/api/docket/rules', auth, (req, res) => {
    res.json({ rule_sets: Object.entries(RULES).map(([k,v])=>({ key:k, label:v.label, trigger:v.trigger, rule_count:v.rules.length })) });
  });

  app.post('/api/docket/calculate', auth, loadFirm, async (req, res) => {
    const { rule_set, trigger_date, matter_id, save=false, assigned_to } = req.body || {};
    if (!rule_set)     return res.status(400).json({ error: 'rule_set required.' });
    if (!trigger_date) return res.status(400).json({ error: 'trigger_date required.' });
    const rs = RULES[rule_set];
    if (!rs) return res.status(400).json({ error: `Unknown rule_set "${rule_set}".` });
    const today = new Date().toISOString().slice(0,10);
    const ctx = req.firmCtx;
    const calculated = rs.rules.map(r => {
      const due = r.business ? addBiz(trigger_date, r.days) : addDays(trigger_date, r.days);
      return { rule_id:r.id, title:r.title, due_date:due, days_from_event:r.days, rule_citation:r.rule, entry_type:r.type, priority:r.priority, is_past:due<today, days_from_today:diffDays(today,due) };
    }).sort((a,b)=>a.due_date.localeCompare(b.due_date));

    const savedIds = [];
    if (save && matter_id) {
      for (const d of calculated) {
        if (d.is_past) continue;
        const r = await db.run('INSERT INTO docket_entries (firm_id,matter_id,entry_type,title,due_date,rule_citation,calculated_from,days_from_event,status,priority,assigned_to,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          [ctx?.firm_id||null, parseInt(matter_id), d.entry_type, d.title, d.due_date, d.rule_citation, trigger_date, d.days_from_event, 'pending', d.priority, assigned_to||req.user.id, req.user.id]);
        savedIds.push(r.lastID);
      }
    }
    res.json({ rule_set, rule_set_label:rs.label, trigger_date, deadlines:calculated, total:calculated.length, past:calculated.filter(d=>d.is_past).length, upcoming:calculated.filter(d=>!d.is_past).length, saved:savedIds.length, saved_ids:savedIds });
  });

  app.post('/api/docket/entries', auth, loadFirm, async (req, res) => {
    const ctx = req.firmCtx;
    const { matter_id, entry_type='deadline', title, description, due_date, court, rule_citation, priority='normal', assigned_to } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title required.' });
    if (!due_date)      return res.status(400).json({ error: 'due_date required.' });
    const VALID_TYPES=['deadline','hearing','filing','appointment','reminder','conference','deposition','trial'];
    const VALID_PRIO=['critical','high','normal','low'];
    const r = await db.run('INSERT INTO docket_entries (firm_id,matter_id,entry_type,title,description,due_date,court,rule_citation,status,priority,assigned_to,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [ctx?.firm_id||null, matter_id?parseInt(matter_id):null, VALID_TYPES.includes(entry_type)?entry_type:'deadline', title, description||null, due_date, court||null, rule_citation||null, 'pending', VALID_PRIO.includes(priority)?priority:'normal', assigned_to?parseInt(assigned_to):req.user.id, req.user.id]);
    const entry = await db.get('SELECT * FROM docket_entries WHERE id=?', [r.lastID]);
    const today = new Date().toISOString().slice(0,10);
    res.json({ ...entry, days_until_due: diffDays(today, entry.due_date) });
  });

  app.get('/api/docket/entries', auth, loadFirm, async (req, res) => {
    const ctx = req.firmCtx;
    const { matter_id, status, priority } = req.query;
    let sql = 'SELECT de.*, u.display_name AS assigned_to_name FROM docket_entries de LEFT JOIN users u ON u.id=de.assigned_to WHERE 1=1';
    const p = [];
    if (ctx?.firm_id) { sql += ' AND de.firm_id=?'; p.push(ctx.firm_id); }
    else              { sql += ' AND de.assigned_to=?'; p.push(req.user.id); }
    if (matter_id) { sql += ' AND de.matter_id=?'; p.push(parseInt(matter_id)); }
    if (status)    { sql += ' AND de.status=?';    p.push(status); }
    if (priority)  { sql += ' AND de.priority=?';  p.push(priority); }
    sql += ' ORDER BY de.due_date ASC';
    const rows = await db.all(sql, p);
    const today = new Date().toISOString().slice(0,10);
    res.json({ entries: rows.map(e=>({...e, days_until_due:diffDays(today,e.due_date), overdue:e.status==='pending'&&e.due_date<today})), count:rows.length });
  });

  app.get('/api/docket/entries/:id', auth, async (req,res) => {
    const e = await db.get('SELECT * FROM docket_entries WHERE id=?', [parseInt(req.params.id)]);
    if (!e) return res.status(404).json({ error: 'Not found.' });
    const today = new Date().toISOString().slice(0,10);
    res.json({ ...e, days_until_due: diffDays(today, e.due_date) });
  });

  app.put('/api/docket/entries/:id', auth, async (req,res) => {
    const e = await db.get('SELECT id FROM docket_entries WHERE id=?', [parseInt(req.params.id)]);
    if (!e) return res.status(404).json({ error: 'Not found.' });
    const VALID_STATUS=['pending','completed','missed','waived'];
    const updates=[]; const params=[];
    for (const key of ['title','due_date','status','priority','assigned_to']) {
      if (req.body[key]===undefined) continue;
      if (key==='status' && !VALID_STATUS.includes(req.body[key])) continue;
      if (key==='status' && req.body[key]==='completed') { updates.push('completed_at=?'); params.push(new Date().toISOString()); }
      updates.push(`${key}=?`); params.push(req.body[key]);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    updates.push("updated_at=datetime('now')"); params.push(parseInt(req.params.id));
    await db.run(`UPDATE docket_entries SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get('SELECT * FROM docket_entries WHERE id=?', [parseInt(req.params.id)]);
    res.json(updated);
  });

  app.delete('/api/docket/entries/:id', auth, async (req,res) => {
    const e = await db.get('SELECT id FROM docket_entries WHERE id=?', [parseInt(req.params.id)]);
    if (!e) return res.status(404).json({ error: 'Not found.' });
    await db.run('DELETE FROM docket_entries WHERE id=?', [parseInt(req.params.id)]);
    res.json({ deleted: true });
  });

  app.get('/api/docket/matter/:matterId', auth, async (req,res) => {
    const matterId = parseInt(req.params.matterId);
    const entries = await db.all('SELECT * FROM docket_entries WHERE matter_id=? ORDER BY due_date ASC', [matterId]);
    const today = new Date().toISOString().slice(0,10);
    const enriched = entries.map(e=>({...e, days_until_due:diffDays(today,e.due_date), overdue:e.status==='pending'&&e.due_date<today}));
    res.json({ matter_id:matterId, entries:enriched, summary:{ total:entries.length, pending:enriched.filter(e=>e.status==='pending').length, overdue:enriched.filter(e=>e.overdue).length, critical:enriched.filter(e=>e.priority==='critical'&&e.status==='pending').length } });
  });

  app.get('/api/docket/upcoming', auth, loadFirm, async (req,res) => {
    const days = Math.min(parseInt(req.query.days||'30'), 365);
    const today = new Date().toISOString().slice(0,10);
    const until = addDays(today, days);
    const ctx = req.firmCtx;
    let sql = "SELECT * FROM docket_entries WHERE status='pending' AND due_date>=? AND due_date<=?";
    const p = [today, until];
    if (ctx?.firm_id) { sql += ' AND firm_id=?'; p.push(ctx.firm_id); }
    else              { sql += ' AND assigned_to=?'; p.push(req.user.id); }
    sql += ' ORDER BY due_date ASC LIMIT 100';
    const rows = await db.all(sql, p);
    const entries = rows.map(e=>({...e, days_until_due:diffDays(today,e.due_date)}));
    const tiers = { today:entries.filter(e=>e.days_until_due===0), this_week:entries.filter(e=>e.days_until_due>0&&e.days_until_due<=7), next_week:entries.filter(e=>e.days_until_due>7&&e.days_until_due<=14), this_month:entries.filter(e=>e.days_until_due>14&&e.days_until_due<=30), later:entries.filter(e=>e.days_until_due>30) };
    res.json({ window_days:days, entries, tiers, overdue:[], counts:{upcoming:entries.length, overdue:0, critical:entries.filter(e=>e.priority==='critical').length} });
  });

  // ── Privilege Log ──────────────────────────────────────────────────────────
  const PRIV_BASES = ['attorney_client','work_product','joint_defense','common_interest','self_critical'];

  app.get('/api/privilege/bases', auth, (req,res) => {
    res.json({ bases: Object.fromEntries(PRIV_BASES.map(b=>[b,{label:b,short:b.slice(0,3).toUpperCase()}])) });
  });

  app.post('/api/privilege/generate', auth, async (req,res) => {
    const { documents=[], privilege_basis, matter_id, save=false } = req.body || {};
    if (!Array.isArray(documents)||!documents.length) return res.status(400).json({ error: 'documents array required.' });
    if (documents.length > 50) return res.status(400).json({ error: 'Maximum 50 documents.' });
    // Demo mode fallback
    const generated = documents.map((d,i) => ({
      doc_number_suffix: String(i+1), doc_type: d.doc_type||'other', privilege_basis: privilege_basis||'attorney_client',
      withheld: true, description: `[DEMO] ${d.description||'Document'}`, privilege_assertion: 'Confidential attorney-client communication.', doc_date: d.date||null
    }));
    res.json({ jobId: `demo-${Date.now()}`, status: 'pending', async: true, message: 'Queued.' });
  });

  app.post('/api/privilege/entries', auth, loadFirm, async (req,res) => {
    const ctx = req.firmCtx;
    const { matter_id, matter_table='matters', doc_date, doc_type='other', author, recipients, description, privilege_basis, withheld=true, page_count } = req.body || {};
    if (!description?.trim()) return res.status(400).json({ error: 'description required.' });
    if (!privilege_basis || !PRIV_BASES.includes(privilege_basis)) return res.status(400).json({ error: `privilege_basis required.` });
    const matterId = matter_id ? parseInt(matter_id) : null;
    const firmId   = ctx?.firm_id || null;
    const count    = matterId&&firmId ? await db.get('SELECT COUNT(*) as n FROM privilege_log WHERE matter_id=? AND firm_id=?', [matterId, firmId]) : {n:0};
    const docNum   = `PRIV-${String((count?.n||0)+1).padStart(4,'0')}`;
    const DOC_TYPES=['email','memo','letter','draft','notes','report','contract','other'];
    const r = await db.run('INSERT INTO privilege_log (firm_id,matter_id,matter_table,doc_number,doc_date,doc_type,author,recipients,description,privilege_basis,withheld,page_count,ai_generated,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)',
      [firmId, matterId, matter_table, docNum, doc_date||null, DOC_TYPES.includes(doc_type)?doc_type:'other', author||null, recipients||null, description, privilege_basis, withheld?1:0, page_count?parseInt(page_count):null, req.user.id]);
    const entry = await db.get('SELECT * FROM privilege_log WHERE id=?', [r.lastID]);
    res.json(entry);
  });

  app.get('/api/privilege/entries', auth, loadFirm, async (req,res) => {
    const ctx = req.firmCtx;
    const { matter_id } = req.query;
    let sql = 'SELECT * FROM privilege_log WHERE 1=1';
    const p = [];
    if (ctx?.firm_id) { sql += ' AND firm_id=?'; p.push(ctx.firm_id); }
    else              { sql += ' AND created_by=?'; p.push(req.user.id); }
    if (matter_id) { sql += ' AND matter_id=?'; p.push(parseInt(matter_id)); }
    sql += ' ORDER BY doc_number ASC';
    const rows = await db.all(sql, p);
    res.json({ entries: rows, count: rows.length });
  });

  app.get('/api/privilege/entries/:id', auth, async (req,res) => {
    const e = await db.get('SELECT * FROM privilege_log WHERE id=?', [parseInt(req.params.id)]);
    if (!e) return res.status(404).json({ error: 'Not found.' });
    res.json(e);
  });

  app.put('/api/privilege/entries/:id', auth, async (req,res) => {
    const e = await db.get('SELECT id FROM privilege_log WHERE id=?', [parseInt(req.params.id)]);
    if (!e) return res.status(404).json({ error: 'Not found.' });
    const updates=[]; const params=[];
    for (const key of ['doc_date','doc_type','author','recipients','description','privilege_basis','withheld','page_count']) {
      if (req.body[key]===undefined) continue;
      if (key==='privilege_basis' && !PRIV_BASES.includes(req.body[key])) continue;
      updates.push(`${key}=?`); params.push(key==='withheld' ? (req.body[key]?1:0) : req.body[key]);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    updates.push("updated_at=datetime('now')"); params.push(parseInt(req.params.id));
    await db.run(`UPDATE privilege_log SET ${updates.join(',')} WHERE id=?`, params);
    const updated = await db.get('SELECT * FROM privilege_log WHERE id=?', [parseInt(req.params.id)]);
    res.json(updated);
  });

  app.delete('/api/privilege/entries/:id', auth, async (req,res) => {
    const e = await db.get('SELECT id FROM privilege_log WHERE id=?', [parseInt(req.params.id)]);
    if (!e) return res.status(404).json({ error: 'Not found.' });
    await db.run('DELETE FROM privilege_log WHERE id=?', [parseInt(req.params.id)]);
    res.json({ deleted: true });
  });

  app.get('/api/privilege/matter/:matterId', auth, async (req,res) => {
    const matterId = parseInt(req.params.matterId);
    const entries  = await db.all('SELECT * FROM privilege_log WHERE matter_id=? ORDER BY doc_number ASC', [matterId]);
    const summary  = { total:entries.length, withheld:entries.filter(e=>e.withheld).length, produced_redacted:entries.filter(e=>!e.withheld).length, by_basis:{} };
    for (const e of entries) summary.by_basis[e.privilege_basis] = (summary.by_basis[e.privilege_basis]||0)+1;
    res.json({ matter_id: matterId, entries, summary });
  });

  app.get('/api/privilege/matter/:matterId/csv', auth, async (req,res) => {
    const matterId = parseInt(req.params.matterId);
    const entries  = await db.all('SELECT * FROM privilege_log WHERE matter_id=? ORDER BY doc_number ASC', [matterId]);
    if (!entries.length) return res.status(400).json({ error: 'No entries.' });
    const header = 'Doc Number,Date,Type,Author,Recipients,Description,Privilege Basis,Withheld,Pages';
    const rows   = entries.map(e => [e.doc_number, e.doc_date||'', e.doc_type, e.author||'', e.recipients||'', `"${(e.description||'').replace(/"/g,'""')}"`, e.privilege_basis, e.withheld?'Yes':'No', e.page_count||''].join(','));
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="privilege-log-${matterId}.csv"`);
    res.send([header,...rows].join('\n'));
  });

  // ── Motion PDF Export ──────────────────────────────────────────────────────
  const PDFDocument = (await import('pdfkit')).default;

  function genMotionPDF(text, meta={}) {
    return new Promise((resolve, reject) => {
      const chunks=[];
      const doc = new PDFDocument({ size:'LETTER', margins:{top:72,bottom:72,left:72,right:72} });
      doc.on('data',c=>chunks.push(c)); doc.on('end',()=>resolve(Buffer.concat(chunks))); doc.on('error',reject);
      if (meta.court_name) doc.font('Times-Bold').fontSize(12).text(meta.court_name.toUpperCase(),{align:'center'});
      if (meta.case_number) doc.font('Times-Roman').fontSize(12).text(`Case No. ${meta.case_number}`,{align:'center'});
      doc.font('Times-Bold').fontSize(13).text((meta.motion_type||'MOTION').toUpperCase(),{align:'center'}).moveDown();
      doc.font('Times-Roman').fontSize(12).text(text.slice(0,10000),{lineGap:10,align:'justify'});
      doc.end();
    });
  }

  app.post('/api/motions/export/preview', auth, async (req,res) => {
    const { motion_text, motion_type='Motion', case_number, court_name, defendant_name } = req.body||{};
    if (!motion_text?.trim()) return res.status(400).json({ error: 'motion_text required.' });
    const buf = await genMotionPDF(motion_text, { motion_type, case_number, court_name, defendant_name });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="motion-preview.pdf"`);
    res.send(buf);
  });

  app.get('/api/motions/export/:id/pdf', auth, async (req,res) => {
    const motion = await db.get('SELECT * FROM motion_history WHERE id=? AND user_id=?', [parseInt(req.params.id), req.user.id]);
    if (!motion) return res.status(404).json({ error: 'Motion not found.' });
    let fields = {}; try { fields = JSON.parse(motion.case_fields||'{}'); } catch {}
    const buf = await genMotionPDF(motion.draft, { motion_type:motion.motion_type, ...fields });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="motion-${motion.id}.pdf"`);
    res.send(buf);
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

// ── ABA Codes ─────────────────────────────────────────────────────────────────
describe('ABA Codes', () => {
  test('returns codes list', async () => {
    const r = await request(app).get('/api/time/aba-codes').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.codes)).toBe(true);
    expect(r.body.count).toBeGreaterThan(0);
  });
  test('filters by type', async () => {
    const r = await request(app).get('/api/time/aba-codes?type=task').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.codes.every(c => c.type === 'task')).toBe(true);
  });
});

// ── Time Entries ──────────────────────────────────────────────────────────────
describe('Time Entries — Create', () => {
  test('401 without auth', async () => {
    const r = await request(app).post('/api/time/entries').send({});
    expect(r.status).toBe(401);
  });
  test('400 when entry_date missing', async () => {
    const r = await request(app).post('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`).send({ hours: 1.5, narrative: 'Draft motion' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/entry_date/i);
  });
  test('400 when hours missing', async () => {
    const r = await request(app).post('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`).send({ entry_date: '2025-01-10', narrative: 'test' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/hours/i);
  });
  test('400 when narrative missing', async () => {
    const r = await request(app).post('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`).send({ entry_date: '2025-01-10', hours: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/narrative/i);
  });
  test('400 when hours exceed 24', async () => {
    const r = await request(app).post('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`).send({ entry_date: '2025-01-10', hours: 25, narrative: 'test' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/0\.1.*24|24.*0\.1/i);
  });
  test('creates entry with 6-minute rounding', async () => {
    const r = await request(app).post('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ matter_id: 1, entry_date: '2025-01-10', hours: 1.567, rate_cents: 150000, narrative: 'L310/A104 - Review opposing counsel production. Identified 12 documents requiring privilege review.', task_code: 'L310', activity_code: 'A104' });
    expect(r.status).toBe(200);
    expect(r.body.hours).toBe(1.6); // rounded to nearest 0.1
    expect(r.body.amount_cents).toBe(240000); // 1.6 × 150000
    expect(r.body.billing_status).toBe('unbilled');
    expect(r.body.task_code).toBe('L310');
  });
  test('resolves billing rate from matter when not provided', async () => {
    const r = await request(app).post('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ matter_id: 1, entry_date: '2025-01-10', hours: 1.0, narrative: 'Strategy call re: settlement demand' });
    expect(r.status).toBe(200);
    expect(r.body.rate_cents).toBe(35000); // 350/hr from matter × 100
  });
  test('creates second entry for summary testing', async () => {
    await request(app).post('/api/time/entries').set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ matter_id: 1, entry_date: '2025-01-11', hours: 2.0, rate_cents: 200000, narrative: 'Deposition preparation' });
  });
});

describe('Time Entries — List and Get', () => {
  test('lists entries for firm', async () => {
    const r = await request(app).get('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.entries)).toBe(true);
    expect(r.body.entries.length).toBeGreaterThan(0);
    expect(r.body.totals).toHaveProperty('hours');
    expect(r.body.totals).toHaveProperty('amount_cents');
  });
  test('filters by matter_id', async () => {
    const r = await request(app).get('/api/time/entries?matter_id=1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.entries.every(e => e.matter_id === 1)).toBe(true);
  });
  test('filters by billing_status', async () => {
    const r = await request(app).get('/api/time/entries?billing_status=unbilled').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.entries.every(e => e.billing_status === 'unbilled')).toBe(true);
  });
  test('filters by date range', async () => {
    const r = await request(app).get('/api/time/entries?date_from=2025-01-10&date_to=2025-01-10').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.entries.every(e => e.entry_date >= '2025-01-10' && e.entry_date <= '2025-01-10')).toBe(true);
  });
  test('GET single entry has amount_cents', async () => {
    const list = await request(app).get('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`);
    const id   = list.body.entries[0].id;
    const r    = await request(app).get(`/api/time/entries/${id}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.amount_cents).toBeDefined();
  });
});

describe('Time Entries — Matter Summary', () => {
  test('returns matter total with by_attorney breakdown', async () => {
    const r = await request(app).get('/api/time/matter/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('totals');
    expect(r.body).toHaveProperty('by_attorney');
    expect(r.body.totals.total_hours).toBeGreaterThan(0);
    expect(Array.isArray(r.body.by_attorney)).toBe(true);
  });
  test('summary returns by_status and by_month', async () => {
    const r = await request(app).get('/api/time/summary').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.by_status)).toBe(true);
    expect(Array.isArray(r.body.by_month)).toBe(true);
  });
});

describe('Time Entries — Update and Delete', () => {
  let entryId;
  beforeAll(async () => {
    const r = await request(app).post('/api/time/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ matter_id:1, entry_date:'2025-01-15', hours:0.5, rate_cents:100000, narrative:'Test entry for update/delete' });
    entryId = r.body.id;
  });
  test('can update narrative and hours', async () => {
    const r = await request(app).put(`/api/time/entries/${entryId}`).set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ hours: 0.8, narrative: 'Updated narrative' });
    expect(r.status).toBe(200);
    expect(r.body.hours).toBe(0.8);
  });
  test('can delete own unbilled entry', async () => {
    const r = await request(app).delete(`/api/time/entries/${entryId}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
  });
});

// ── Invoices ──────────────────────────────────────────────────────────────────
describe('Invoices', () => {
  let invoiceId;

  test('requires partner+ to generate invoice', async () => {
    const r = await request(app).post('/api/time/invoices').set('Authorization', `Bearer ${T_ASSOC}`)
      .send({ matter_id:1, client_name:'Test Client' });
    expect(r.status).toBe(403);
  });
  test('400 when client_name missing', async () => {
    const r = await request(app).post('/api/time/invoices').set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ matter_id:1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/client_name/i);
  });
  test('400 when matter_id missing', async () => {
    const r = await request(app).post('/api/time/invoices').set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ client_name:'Test Client' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/matter_id/i);
  });
  test('generates invoice from unbilled entries', async () => {
    const r = await request(app).post('/api/time/invoices').set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ matter_id:1, client_name:'Skadden Client Corp.', tax_rate:0, due_date:'2025-02-28' });
    expect(r.status).toBe(200);
    expect(r.body.invoice_number).toMatch(/^INV-\d{6}-\d{4}$/);
    expect(r.body.subtotal_cents).toBeGreaterThan(0);
    expect(r.body.total_cents).toBe(r.body.subtotal_cents + r.body.tax_cents);
    expect(r.body.entry_count).toBeGreaterThan(0);
    invoiceId = r.body.id;
  });
  test('entries are marked as billed after invoice', async () => {
    const r = await request(app).get('/api/time/entries?billing_status=billed').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.entries.length).toBeGreaterThan(0);
    expect(r.body.entries.every(e => e.billing_status === 'billed')).toBe(true);
  });
  test('400 when no unbilled entries remain', async () => {
    const r = await request(app).post('/api/time/invoices').set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ matter_id:1, client_name:'Test Client Again' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no unbilled/i);
  });
  test('lists invoices for firm', async () => {
    const r = await request(app).get('/api/time/invoices').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.invoices.length).toBeGreaterThan(0);
  });
  test('gets invoice with line items', async () => {
    const r = await request(app).get(`/api/time/invoices/${invoiceId}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.entries)).toBe(true);
    expect(r.body.invoice_number).toBeDefined();
  });
  test('updates invoice status to sent', async () => {
    const r = await request(app).put(`/api/time/invoices/${invoiceId}`).set('Authorization', `Bearer ${T_PARTNER}`)
      .send({ status: 'sent' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('sent');
  });
  test('void invoice restores entries to unbilled', async () => {
    await request(app).put(`/api/time/invoices/${invoiceId}`).set('Authorization', `Bearer ${T_PARTNER}`).send({ status:'void' });
    const r = await request(app).get('/api/time/entries?billing_status=unbilled').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.body.entries.length).toBeGreaterThan(0);
  });
});

// ── Docket Calculation ────────────────────────────────────────────────────────
describe('Docket — Rules and Calculation', () => {
  test('GET /rules returns all rule sets', async () => {
    const r = await request(app).get('/api/docket/rules').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.rule_sets)).toBe(true);
    expect(r.body.rule_sets.length).toBeGreaterThanOrEqual(3);
    expect(r.body.rule_sets.some(rs => rs.key === 'frcp_complaint_served')).toBe(true);
    expect(r.body.rule_sets.some(rs => rs.key === 'criminal_arrest')).toBe(true);
    expect(r.body.rule_sets.some(rs => rs.key === 'transactional_loi')).toBe(true);
  });
  test('400 when rule_set missing', async () => {
    const r = await request(app).post('/api/docket/calculate').set('Authorization', `Bearer ${T_ADMIN}`).send({ trigger_date:'2025-01-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/rule_set/i);
  });
  test('400 when trigger_date missing', async () => {
    const r = await request(app).post('/api/docket/calculate').set('Authorization', `Bearer ${T_ADMIN}`).send({ rule_set:'frcp_complaint_served' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/trigger_date/i);
  });
  test('400 for unknown rule_set', async () => {
    const r = await request(app).post('/api/docket/calculate').set('Authorization', `Bearer ${T_ADMIN}`).send({ rule_set:'made_up_rules', trigger_date:'2025-01-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/unknown/i);
  });
  test('FRCP complaint served: 8 deadlines calculated', async () => {
    const r = await request(app).post('/api/docket/calculate').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ rule_set:'frcp_complaint_served', trigger_date:'2025-01-01' });
    expect(r.status).toBe(200);
    expect(r.body.deadlines.length).toBe(8);
    expect(r.body.total).toBe(8);
    expect(r.body.rule_set_label).toBeDefined();
    // First deadline: 21 days (answer)
    const answer = r.body.deadlines.find(d => d.rule_id === 'frcp_answer');
    expect(answer).toBeDefined();
    expect(answer.due_date).toBe('2025-01-22');
    expect(answer.priority).toBe('critical');
  });
  test('Criminal arrest: 6 deadlines calculated', async () => {
    const r = await request(app).post('/api/docket/calculate').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ rule_set:'criminal_arrest', trigger_date:'2025-01-06' });
    expect(r.status).toBe(200);
    expect(r.body.deadlines.length).toBe(6);
    // Bail hearing: 1 day
    const bail = r.body.deadlines.find(d => d.rule_id === 'crim_bail');
    expect(bail.due_date).toBe('2025-01-07');
  });
  test('Transactional LOI: 6 deadlines calculated', async () => {
    const r = await request(app).post('/api/docket/calculate').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ rule_set:'transactional_loi', trigger_date:'2025-01-15' });
    expect(r.status).toBe(200);
    expect(r.body.deadlines.length).toBe(6);
    const closing = r.body.deadlines.find(d => d.rule_id === 'txn_closing');
    expect(closing.due_date).toBe('2025-04-15'); // 90 days
  });
  test('deadlines sorted by due_date ascending', async () => {
    const r = await request(app).post('/api/docket/calculate').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ rule_set:'frcp_complaint_served', trigger_date:'2025-01-01' });
    const dates = r.body.deadlines.map(d => d.due_date);
    for (let i=1; i<dates.length; i++) expect(dates[i] >= dates[i-1]).toBe(true);
  });
  test('save=true writes entries to docket', async () => {
    const r = await request(app).post('/api/docket/calculate').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ rule_set:'frcp_complaint_served', trigger_date:'2030-01-01', matter_id:1, save:true });
    expect(r.status).toBe(200);
    expect(r.body.saved).toBeGreaterThan(0);
    expect(Array.isArray(r.body.saved_ids)).toBe(true);
  });
});

describe('Docket — Manual Entries', () => {
  let docketId;
  test('400 when title missing', async () => {
    const r = await request(app).post('/api/docket/entries').set('Authorization', `Bearer ${T_ADMIN}`).send({ due_date:'2025-12-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/title/i);
  });
  test('400 when due_date missing', async () => {
    const r = await request(app).post('/api/docket/entries').set('Authorization', `Bearer ${T_ADMIN}`).send({ title:'Hearing' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/due_date/i);
  });
  test('creates manual docket entry', async () => {
    const r = await request(app).post('/api/docket/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ matter_id:1, entry_type:'hearing', title:'Settlement Conference', due_date:'2025-12-15', court:'SDNY', rule_citation:'FRCP 16', priority:'high' });
    expect(r.status).toBe(200);
    expect(r.body.entry_type).toBe('hearing');
    expect(r.body.priority).toBe('high');
    expect(r.body.days_until_due).toBeDefined();
    docketId = r.body.id;
  });
  test('lists docket entries', async () => {
    const r = await request(app).get('/api/docket/entries').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThan(0);
    expect(Array.isArray(r.body.entries)).toBe(true);
  });
  test('GET single entry includes days_until_due', async () => {
    const r = await request(app).get(`/api/docket/entries/${docketId}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('days_until_due');
  });
  test('updates entry to completed', async () => {
    const r = await request(app).put(`/api/docket/entries/${docketId}`).set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ status:'completed' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('completed');
    expect(r.body.completed_at).toBeTruthy();
  });
  test('deletes entry', async () => {
    const create = await request(app).post('/api/docket/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ title:'Delete me', due_date:'2025-12-20' });
    const r = await request(app).delete(`/api/docket/entries/${create.body.id}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
  });
  test('matter docket returns summary', async () => {
    const r = await request(app).get('/api/docket/matter/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('summary');
    expect(r.body.summary).toHaveProperty('total');
    expect(r.body.summary).toHaveProperty('pending');
    expect(r.body.summary).toHaveProperty('critical');
  });
  test('upcoming deadlines grouped by tier', async () => {
    const r = await request(app).get('/api/docket/upcoming?days=30').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('tiers');
    expect(r.body.tiers).toHaveProperty('today');
    expect(r.body.tiers).toHaveProperty('this_week');
    expect(r.body.counts).toHaveProperty('upcoming');
  });
});

// ── Privilege Log ─────────────────────────────────────────────────────────────
describe('Privilege Log — Bases', () => {
  test('returns privilege bases', async () => {
    const r = await request(app).get('/api/privilege/bases').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.bases).toHaveProperty('attorney_client');
    expect(r.body.bases).toHaveProperty('work_product');
    expect(r.body.bases).toHaveProperty('joint_defense');
  });
});

describe('Privilege Log — Entries', () => {
  let privId;
  test('400 when description missing', async () => {
    const r = await request(app).post('/api/privilege/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ privilege_basis:'attorney_client' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/description/i);
  });
  test('400 when privilege_basis missing', async () => {
    const r = await request(app).post('/api/privilege/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ description:'Test doc', matter_id:1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/privilege_basis/i);
  });
  test('creates entry with auto-numbered doc_number', async () => {
    const r = await request(app).post('/api/privilege/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ matter_id:1, doc_date:'2025-01-10', doc_type:'email', author:'Jane Smith', recipients:'Client', description:'Email from J. Smith to client regarding litigation strategy for upcoming deposition.', privilege_basis:'attorney_client', withheld:true, page_count:2 });
    expect(r.status).toBe(200);
    expect(r.body.doc_number).toMatch(/^PRIV-\d{4}$/);
    expect(r.body.privilege_basis).toBe('attorney_client');
    expect(r.body.withheld).toBe(1);
    privId = r.body.id;
  });
  test('creates work product entry', async () => {
    const r = await request(app).post('/api/privilege/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ matter_id:1, doc_type:'memo', author:'Associate A', description:'Internal strategy memorandum prepared in anticipation of trial re: deposition outline.', privilege_basis:'work_product', withheld:true });
    expect(r.status).toBe(200);
    expect(r.body.doc_number).toBe('PRIV-0002');
    expect(r.body.privilege_basis).toBe('work_product');
  });
  test('doc numbers are sequential', async () => {
    const r = await request(app).post('/api/privilege/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ matter_id:1, description:'Third document.', privilege_basis:'attorney_client' });
    expect(r.body.doc_number).toBe('PRIV-0003');
  });
  test('lists entries for matter', async () => {
    const r = await request(app).get('/api/privilege/entries?matter_id=1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThanOrEqual(3);
    expect(r.body.entries.every(e => e.matter_id === 1)).toBe(true);
  });
  test('GET single entry', async () => {
    const r = await request(app).get(`/api/privilege/entries/${privId}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.doc_number).toBe('PRIV-0001');
  });
  test('updates entry', async () => {
    const r = await request(app).put(`/api/privilege/entries/${privId}`).set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ page_count: 3, withheld: false });
    expect(r.status).toBe(200);
    expect(r.body.page_count).toBe(3);
    expect(r.body.withheld).toBe(0);
  });
  test('matter privilege log returns summary', async () => {
    const r = await request(app).get('/api/privilege/matter/1').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.summary.total).toBeGreaterThanOrEqual(3);
    expect(r.body.summary).toHaveProperty('by_basis');
    expect(r.body.summary).toHaveProperty('withheld');
    expect(r.body.summary).toHaveProperty('produced_redacted');
  });
  test('CSV export has correct headers', async () => {
    const r = await request(app).get('/api/privilege/matter/1/csv').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text).toContain('Doc Number,Date,Type,Author,Recipients,Description,Privilege Basis,Withheld,Pages');
    expect(r.text).toContain('PRIV-0001');
  });
  test('deletes entry', async () => {
    const create = await request(app).post('/api/privilege/entries').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ matter_id:1, description:'Delete me.', privilege_basis:'work_product' });
    const r = await request(app).delete(`/api/privilege/entries/${create.body.id}`).set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
  });
  test('AI generation endpoint (demo mode)', async () => {
    const r = await request(app).post('/api/privilege/generate').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ documents:[{ description:'Email re: trial strategy', date:'2025-01-10', doc_type:'email' }], privilege_basis:'attorney_client', save:false });
    expect(r.status).toBe(200);
    expect(r.body.jobId).toBeDefined();
  });
});

// ── Motion PDF Export ─────────────────────────────────────────────────────────
describe('Motion PDF Export', () => {
  test('400 when motion_text missing', async () => {
    const r = await request(app).post('/api/motions/export/preview').set('Authorization', `Bearer ${T_ADMIN}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/motion_text/i);
  });
  test('returns PDF binary for preview', async () => {
    const r = await request(app).post('/api/motions/export/preview').set('Authorization', `Bearer ${T_ADMIN}`)
      .send({ motion_text:'MOTION TO SUPPRESS\n\nCOMES NOW the Defendant and moves this Court...', motion_type:'Motion to Suppress', case_number:'2025-CR-001', court_name:'Circuit Court of Hamilton County' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/pdf/i);
    expect(r.headers['content-disposition']).toMatch(/attachment/i);
    // PDF starts with %PDF
    expect(r.body.slice(0,4).toString()).toBe('%PDF');
  });
  test('GET /:id/pdf — 404 for unknown motion', async () => {
    const r = await request(app).get('/api/motions/export/999/pdf').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(404);
  });
  test('GET /:id/pdf — returns PDF for own motion', async () => {
    const r = await request(app).get('/api/motions/export/1/pdf').set('Authorization', `Bearer ${T_ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/pdf/i);
  });
});

// ── Transactional AI Persona ──────────────────────────────────────────────────
describe('Transactional AI Persona', () => {
  test('TRANSACTIONAL_SYSTEM_PROMPT is exported from _prompts.js', async () => {
    const { TRANSACTIONAL_SYSTEM_PROMPT } = await import('../routes/chat/_prompts.js');
    expect(typeof TRANSACTIONAL_SYSTEM_PROMPT).toBe('string');
    expect(TRANSACTIONAL_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });
  test('TRANSACTIONAL_SYSTEM_PROMPT covers M&A expertise', async () => {
    const { TRANSACTIONAL_SYSTEM_PROMPT } = await import('../routes/chat/_prompts.js');
    expect(TRANSACTIONAL_SYSTEM_PROMPT).toMatch(/M&A|mergers/i);
    expect(TRANSACTIONAL_SYSTEM_PROMPT).toMatch(/HSR|CFIUS|FCPA/i);
  });
  test('TRANSACTIONAL_SYSTEM_PROMPT has hallucination guard', async () => {
    const { TRANSACTIONAL_SYSTEM_PROMPT } = await import('../routes/chat/_prompts.js');
    expect(TRANSACTIONAL_SYSTEM_PROMPT).toMatch(/CITATION NEEDED/i);
    expect(TRANSACTIONAL_SYSTEM_PROMPT).toMatch(/VERIFY/i);
  });
  test('MOTION_PDF_SYSTEM_PROMPT is exported from _prompts.js', async () => {
    const { MOTION_PDF_SYSTEM_PROMPT } = await import('../routes/chat/_prompts.js');
    expect(typeof MOTION_PDF_SYSTEM_PROMPT).toBe('string');
    expect(MOTION_PDF_SYSTEM_PROMPT.length).toBeGreaterThan(50);
  });
  test('MOTION_PDF_SYSTEM_PROMPT requires proper caption block', async () => {
    const { MOTION_PDF_SYSTEM_PROMPT } = await import('../routes/chat/_prompts.js');
    expect(MOTION_PDF_SYSTEM_PROMPT).toMatch(/caption/i);
    expect(MOTION_PDF_SYSTEM_PROMPT).toMatch(/signature/i);
  });
  test('TRANSACTIONAL_FOOTER is exported', async () => {
    const { TRANSACTIONAL_FOOTER } = await import('../routes/chat/_prompts.js');
    expect(typeof TRANSACTIONAL_FOOTER).toBe('string');
    expect(TRANSACTIONAL_FOOTER).toMatch(/attorney|legal/i);
  });
});
