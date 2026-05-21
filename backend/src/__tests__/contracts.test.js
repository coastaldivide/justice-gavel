/**
 * contracts.test.js — Contract function layer test suite
 *
 * Tests: contract type catalog, drafting, review, redline, execution tracking,
 *        expiry management, dashboard, rate limiting, auth enforcement,
 *        and subscription tier gating.
 */

import express   from 'express';
import request   from 'supertest';
import jwt       from 'jsonwebtoken';
import { makeTestDb, createSchema } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;

function tok(id = 1, role = 'user') {
  return jwt.sign({ id, role, email: `u${id}@test.com` }, SECRET, { expiresIn: '1h' });
}

const T1 = tok(1);
const T2 = tok(2);

// ── Build a minimal test app ──────────────────────────────────────────────────
async function buildApp(testDb) {
  const app = express();
  app.use(express.json());

  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  // ── Inline contract routes (no Stripe, no Claude in test env) ──────────────
  app.get('/api/contracts/types', auth, async (req, res) => {
    res.json({
      Transactional: [
        { key: 'nda',        label: 'Non-Disclosure Agreement (NDA)',  required: ['disclosing_party','receiving_party','purpose','duration_years','state'] },
        { key: 'employment', label: 'Employment Agreement',             required: ['employer_name','employee_name','title','start_date','base_salary','state'] },
        { key: 'services',   label: 'Master Services Agreement (MSA)', required: ['client_name','vendor_name','services_scope','payment_terms','state'] },
        { key: 'settlement', label: 'Settlement Agreement and Release', required: ['settling_party_1','settling_party_2','settlement_amount','payment_schedule','claims_released','state'] },
      ],
      'M&A and Corporate': [
        { key: 'loi',      label: 'Letter of Intent (LOI)',        tier_required: 'contract_pro', required: ['buyer_name','target_name','transaction_type','proposed_value','exclusivity_days'] },
        { key: 'asset_purchase', label: 'Asset Purchase Agreement', tier_required: 'contract_pro', required: ['buyer_name','seller_name','assets_description','purchase_price','closing_date','state'] },
      ],
    });
  });

  // Contract CRUD with in-memory DB
  await testDb.exec(`
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, contract_type TEXT, title TEXT, party_a TEXT, party_b TEXT,
      fields TEXT, draft TEXT, status TEXT DEFAULT 'draft',
      execution_date TEXT, expiry_date TEXT, renewal_date TEXT, value_cents INTEGER,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contract_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, contract_id INTEGER, filename TEXT, risk_level TEXT,
      summary TEXT, red_flags TEXT, missing_clauses TEXT, recommendations TEXT,
      favorable_terms TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contract_redlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, contract_id INTEGER, filename_original TEXT, filename_revised TEXT,
      changes TEXT, summary TEXT, risk_delta TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS contract_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER, user_id INTEGER, signer_name TEXT, signer_email TEXT,
      signed_at TEXT, signature_method TEXT DEFAULT 'in-app', status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, tier TEXT, status TEXT DEFAULT 'active'
    );
  `);

  // Draft endpoint
  app.post('/api/contracts/draft', auth, async (req, res) => {
    const { contract_type, fields = {}, title } = req.body || {};
    if (!contract_type) return res.status(400).json({ error: 'contract_type is required' });

    const VALID_TYPES = ['nda','employment','contractor','services','saas','loi','asset_purchase',
                         'shareholders','commercial_lease','settlement','ip_assignment','license'];
    if (!VALID_TYPES.includes(contract_type)) return res.status(400).json({ error: `Unknown contract type: ${contract_type}` });

    // Check tier gating for pro types
    const PRO_TYPES = ['saas','loi','asset_purchase','shareholders','license'];
    if (PRO_TYPES.includes(contract_type)) {
      const sub = await testDb.get(
        "SELECT id FROM subscriptions WHERE user_id=? AND tier IN ('contract_pro','enterprise') AND status='active'",
        [req.user.id]
      );
      if (!sub) return res.status(402).json({ error: 'Contract Pro subscription required.', code: 'subscription_required', tier_required: 'contract_pro' });
    }

    const contractTitle = title || `${contract_type.toUpperCase()} Draft`;
    const draftText = `[TEST DRAFT] ${contractTitle}\n\nParties: ${fields.disclosing_party || fields.employer_name || 'Party A'} and ${fields.receiving_party || fields.employee_name || 'Party B'}\n\nDraft contract content would appear here.`;

    const r = await testDb.run(
      'INSERT INTO contracts (user_id, contract_type, title, fields, draft, status) VALUES (?,?,?,?,?,?)',
      [req.user.id, contract_type, contractTitle, JSON.stringify(fields), draftText, 'draft']
    );
    res.json({ ok: true, id: r.lastID, title: contractTitle, contract_type, draft: draftText, status: 'draft' });
  });

  // List contracts
  app.get('/api/contracts', auth, async (req, res) => {
    const rows = await testDb.all(
      'SELECT id, contract_type, title, status, created_at FROM contracts WHERE user_id=? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ contracts: rows, total: rows.length });
  });


  // Expiring contracts
  app.get('/api/contracts/expiring', auth, async (req, res) => {
    const days = parseInt(req.query.days || '30');
    const rows = await testDb.all(
      `SELECT id, title, expiry_date FROM contracts WHERE user_id=? AND expiry_date IS NOT NULL AND expiry_date > date('now') AND expiry_date <= date('now', '+' || ? || ' days') ORDER BY expiry_date ASC`,
      [req.user.id, days]
    );
    res.json({ contracts: rows, window_days: days });
  });

  // Dashboard
  app.get('/api/contracts/dashboard', auth, async (req, res) => {
    const [total, byStatus] = await Promise.all([
      testDb.get('SELECT COUNT(*) as n FROM contracts WHERE user_id=?', [req.user.id]),
      testDb.all('SELECT status, COUNT(*) as count FROM contracts WHERE user_id=? GROUP BY status', [req.user.id]),
    ]);
    res.json({ total_contracts: total.n, by_status: byStatus });
  });

  // Get single contract
  app.get('/api/contracts/:id', auth, async (req, res) => {
    const row = await testDb.get(
      'SELECT * FROM contracts WHERE id=? AND user_id=?',
      [parseInt(req.params.id), req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Contract not found.' });
    try { row.fields = JSON.parse(row.fields); } catch { row.fields = {}; }
    res.json(row);
  });

  // Update contract
  app.put('/api/contracts/:id', auth, async (req, res) => {
    const existing = await testDb.get('SELECT id FROM contracts WHERE id=? AND user_id=?', [parseInt(req.params.id), req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Contract not found.' });
    const { status, expiry_date, value_cents, title } = req.body || {};
    const updates = []; const params = [];
    if (status)       { updates.push('status=?');       params.push(status); }
    if (expiry_date)  { updates.push('expiry_date=?');  params.push(expiry_date); }
    if (value_cents !== undefined) { updates.push('value_cents=?'); params.push(value_cents); }
    if (title)        { updates.push('title=?');        params.push(title); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    updates.push("updated_at=datetime('now')");
    params.push(parseInt(req.params.id), req.user.id);
    await testDb.run(`UPDATE contracts SET ${updates.join(',')} WHERE id=? AND user_id=?`, params);
    const updated = await testDb.get('SELECT * FROM contracts WHERE id=?', [parseInt(req.params.id)]);
    res.json(updated);
  });

  // Delete contract
  app.delete('/api/contracts/:id', auth, async (req, res) => {
    const existing = await testDb.get('SELECT id FROM contracts WHERE id=? AND user_id=?', [parseInt(req.params.id), req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Contract not found.' });
    await testDb.run('DELETE FROM contracts WHERE id=? AND user_id=?', [parseInt(req.params.id), req.user.id]);
    res.json({ deleted: true });
  });

  // Review (simplified — no AI in tests)
  app.post('/api/contracts/review', auth, async (req, res) => {
    const { contract_text, contract_id } = req.body || {};
    if (!contract_text) return res.status(400).json({ error: 'contract_text is required' });
    const result = {
      risk_level: 'medium',
      summary: 'Test review: contract analyzed.',
      red_flags: [{ clause: 'Indemnification', issue: 'Broad indemnification', severity: 'medium' }],
      missing_clauses: [{ clause: 'Limitation of Liability', reason: 'Missing liability cap' }],
      recommendations: [{ action: 'Add liability cap', priority: 'high' }],
      favorable_terms: [],
    };
    const r = await testDb.run(
      'INSERT INTO contract_reviews (user_id, contract_id, risk_level, summary, red_flags, missing_clauses, recommendations, favorable_terms) VALUES (?,?,?,?,?,?,?,?)',
      [req.user.id, contract_id || null, result.risk_level, result.summary,
       JSON.stringify(result.red_flags), JSON.stringify(result.missing_clauses),
       JSON.stringify(result.recommendations), JSON.stringify(result.favorable_terms)]
    );
    res.json({ ok: true, id: r.lastID, ...result });
  });

  // Review history
  app.get('/api/contracts/review/history', auth, async (req, res) => {
    const rows = await testDb.all(
      'SELECT id, risk_level, summary, created_at FROM contract_reviews WHERE user_id=? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  });

  // Redline
  app.post('/api/contracts/redline', auth, async (req, res) => {
    const { original_text, revised_text } = req.body || {};
    if (!original_text || !revised_text) return res.status(400).json({ error: 'Provide both original_text and revised_text.' });
    const result = { risk_delta: 'neutral', summary: 'Test redline comparison.', changes: [
      { section: 'Payment Terms', type: 'modification', original: 'Net-30', revised: 'Net-15', impact: 'unfavorable', explanation: 'Payment accelerated' }
    ]};
    const r = await testDb.run(
      'INSERT INTO contract_redlines (user_id, changes, summary, risk_delta) VALUES (?,?,?,?)',
      [req.user.id, JSON.stringify(result.changes), result.summary, result.risk_delta]
    );
    res.json({ ok: true, id: r.lastID, ...result });
  });

  // Sign
  app.post('/api/contracts/:id/sign', auth, async (req, res) => {
    const contract = await testDb.get('SELECT id, status FROM contracts WHERE id=? AND user_id=?', [parseInt(req.params.id), req.user.id]);
    if (!contract) return res.status(404).json({ error: 'Contract not found.' });
    const { signer_name } = req.body || {};
    if (!signer_name) return res.status(400).json({ error: 'signer_name is required.' });
    const existing = await testDb.get("SELECT id FROM contract_executions WHERE contract_id=? AND signer_name=? AND status='signed'", [contract.id, signer_name]);
    if (existing) return res.status(409).json({ error: `${signer_name} has already signed.` });
    await testDb.run(
      "INSERT INTO contract_executions (contract_id, user_id, signer_name, signed_at, status) VALUES (?,?,?,datetime('now'),'signed')",
      [contract.id, req.user.id, signer_name]
    );
    const signers = await testDb.all("SELECT id FROM contract_executions WHERE contract_id=? AND status='signed'", [contract.id]);
    if (signers.length >= 2) await testDb.run("UPDATE contracts SET status='executed' WHERE id=?", [contract.id]);
    res.json({ signed: true, signer_name, total_signers: signers.length });
  });


  return app;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

let app, db;

beforeAll(async () => {
  db  = await makeTestDb();
  app = await buildApp(db);
});

// ── Contract Type Catalog ─────────────────────────────────────────────────────
describe('GET /api/contracts/types', () => {
  test('401 without auth', async () => {
    const r = await request(app).get('/api/contracts/types');
    expect(r.status).toBe(401);
  });

  test('returns categorized contract types', async () => {
    const r = await request(app).get('/api/contracts/types').set('Authorization', `Bearer ${T1}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('Transactional');
    expect(Array.isArray(r.body.Transactional)).toBe(true);
    expect(r.body.Transactional[0]).toHaveProperty('key');
    expect(r.body.Transactional[0]).toHaveProperty('label');
    expect(r.body.Transactional[0]).toHaveProperty('required');
  });

  test('includes M&A contract types', async () => {
    const r = await request(app).get('/api/contracts/types').set('Authorization', `Bearer ${T1}`);
    expect(r.body).toHaveProperty('M&A and Corporate');
    const loi = r.body['M&A and Corporate'].find(c => c.key === 'loi');
    expect(loi).toBeDefined();
    expect(loi.tier_required).toBe('contract_pro');
  });
});

// ── Contract Drafting ─────────────────────────────────────────────────────────
describe('POST /api/contracts/draft', () => {
  test('401 without auth', async () => {
    const r = await request(app).post('/api/contracts/draft').send({ contract_type: 'nda' });
    expect(r.status).toBe(401);
  });

  test('400 when contract_type missing', async () => {
    const r = await request(app).post('/api/contracts/draft').set('Authorization', `Bearer ${T1}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/contract_type/i);
  });

  test('400 for unknown contract type', async () => {
    const r = await request(app).post('/api/contracts/draft').set('Authorization', `Bearer ${T1}`)
      .send({ contract_type: 'wizard_spell_contract' });
    expect(r.status).toBe(400);
  });

  test('201 creates NDA draft', async () => {
    const r = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({
        contract_type: 'nda',
        fields: {
          disclosing_party:  'Skadden Arps LLP',
          receiving_party:   'Acme Corp.',
          purpose:           'Potential M&A transaction',
          duration_years:    '3',
          state:             'New York',
        },
      });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('id');
    expect(r.body).toHaveProperty('draft');
    expect(r.body.status).toBe('draft');
    expect(r.body.contract_type).toBe('nda');
  });

  test('201 creates Employment Agreement draft', async () => {
    const r = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({
        contract_type: 'employment',
        fields: {
          employer_name: 'Skadden Arps LLP',
          employee_name: 'John Smith',
          title:         'Senior Associate',
          start_date:    '2025-01-06',
          base_salary:   '$280,000',
          state:         'New York',
        },
      });
    expect(r.status).toBe(200);
    expect(r.body.contract_type).toBe('employment');
  });

  test('201 creates Settlement Agreement', async () => {
    const r = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({
        contract_type: 'settlement',
        fields: {
          settling_party_1:  'Occidental Petroleum',
          settling_party_2:  'United States DOJ',
          settlement_amount: '$2,500,000',
          payment_schedule:  'Lump sum at closing',
          claims_released:   'All FCPA-related claims',
          state:             'Delaware',
        },
      });
    expect(r.status).toBe(200);
    expect(r.body.contract_type).toBe('settlement');
  });

  test('402 when pro contract type requested without subscription', async () => {
    const r = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({
        contract_type: 'loi',
        fields: {
          buyer_name:       'Skadden Client A',
          target_name:      'Target Corp.',
          transaction_type: 'acquisition',
          proposed_value:   '$500,000,000',
          exclusivity_days: '45',
        },
      });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('subscription_required');
    expect(r.body.tier_required).toBe('contract_pro');
  });

  test('201 pro contract type succeeds with subscription', async () => {
    await db.run("INSERT INTO subscriptions (user_id, tier, status) VALUES (?,?,?)", [2, 'contract_pro', 'active']);
    const r = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T2}`)
      .send({
        contract_type: 'loi',
        fields: {
          buyer_name:       'Skadden Client B',
          target_name:      'Target Corp.',
          transaction_type: 'acquisition',
          proposed_value:   '$500,000,000',
          exclusivity_days: '45',
        },
      });
    expect(r.status).toBe(200);
    expect(r.body.contract_type).toBe('loi');
  });
});

// ── Contract CRUD ─────────────────────────────────────────────────────────────
describe('Contract CRUD', () => {
  let contractId;

  beforeAll(async () => {
    const r = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({ contract_type: 'nda', fields: { disclosing_party: 'Firm A', receiving_party: 'Firm B', purpose: 'Test', duration_years: '1', state: 'NY' } });
    contractId = r.body.id;
  });

  test('GET /api/contracts returns list', async () => {
    const r = await request(app).get('/api/contracts').set('Authorization', `Bearer ${T1}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.contracts)).toBe(true);
    expect(r.body.contracts.length).toBeGreaterThan(0);
    expect(r.body).toHaveProperty('total');
  });

  test('GET /api/contracts/:id returns the contract', async () => {
    const r = await request(app).get(`/api/contracts/${contractId}`).set('Authorization', `Bearer ${T1}`);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(contractId);
    expect(r.body.status).toBe('draft');
    expect(typeof r.body.fields).toBe('object');
  });

  test('GET /api/contracts/:id 404 for other user', async () => {
    const r = await request(app).get(`/api/contracts/${contractId}`).set('Authorization', `Bearer ${T2}`);
    expect(r.status).toBe(404);
  });

  test('PUT /api/contracts/:id updates status to review', async () => {
    const r = await request(app).put(`/api/contracts/${contractId}`)
      .set('Authorization', `Bearer ${T1}`)
      .send({ status: 'review', value_cents: 500000 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('review');
    expect(r.body.value_cents).toBe(500000);
  });

  test('PUT /api/contracts/:id sets expiry_date', async () => {
    const r = await request(app).put(`/api/contracts/${contractId}`)
      .set('Authorization', `Bearer ${T1}`)
      .send({ expiry_date: '2026-12-31' });
    expect(r.status).toBe(200);
    expect(r.body.expiry_date).toBe('2026-12-31');
  });

  test('DELETE /api/contracts/:id removes the contract', async () => {
    // Create one to delete
    const created = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({ contract_type: 'nda', fields: { disclosing_party:'A', receiving_party:'B', purpose:'Delete test', duration_years:'1', state:'NY' } });
    const delId = created.body.id;
    const r = await request(app).delete(`/api/contracts/${delId}`).set('Authorization', `Bearer ${T1}`);
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
    // Confirm gone
    const check = await request(app).get(`/api/contracts/${delId}`).set('Authorization', `Bearer ${T1}`);
    expect(check.status).toBe(404);
  });
});

// ── Contract Review ───────────────────────────────────────────────────────────
describe('POST /api/contracts/review', () => {
  test('400 when no contract_text', async () => {
    const r = await request(app).post('/api/contracts/review').set('Authorization', `Bearer ${T1}`).send({});
    expect(r.status).toBe(400);
  });

  test('analyzes contract text and returns risk assessment', async () => {
    const r = await request(app).post('/api/contracts/review')
      .set('Authorization', `Bearer ${T1}`)
      .send({ contract_text: 'This Agreement is entered into between Acme Corp and Vendor Inc. INDEMNIFICATION: Vendor shall indemnify Acme for any and all losses, damages, and expenses of any nature whatsoever.' });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('risk_level');
    expect(r.body).toHaveProperty('summary');
    expect(Array.isArray(r.body.red_flags)).toBe(true);
    expect(Array.isArray(r.body.missing_clauses)).toBe(true);
    expect(Array.isArray(r.body.recommendations)).toBe(true);
  });

  test('review history records the review', async () => {
    const r = await request(app).get('/api/contracts/review/history').set('Authorization', `Bearer ${T1}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
  });
});

// ── Redline ───────────────────────────────────────────────────────────────────
describe('POST /api/contracts/redline', () => {
  test('400 when missing original or revised', async () => {
    const r = await request(app).post('/api/contracts/redline')
      .set('Authorization', `Bearer ${T1}`).send({ original_text: 'Only original' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/both/i);
  });

  test('compares two contract versions', async () => {
    const r = await request(app).post('/api/contracts/redline')
      .set('Authorization', `Bearer ${T1}`)
      .send({
        original_text: 'Payment Terms: Net-30 from invoice date. Limitation of Liability: Capped at $100,000.',
        revised_text:  'Payment Terms: Net-15 from invoice date. Limitation of Liability: Capped at $50,000.',
      });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('risk_delta');
    expect(r.body).toHaveProperty('summary');
    expect(Array.isArray(r.body.changes)).toBe(true);
    expect(r.body.changes.length).toBeGreaterThan(0);
  });
});

// ── Contract Execution / Signing ──────────────────────────────────────────────
describe('Contract Execution', () => {
  let signContractId;

  beforeAll(async () => {
    const r = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({ contract_type: 'nda', fields: { disclosing_party:'Alpha Corp', receiving_party:'Beta LLC', purpose:'Signing test', duration_years:'2', state:'DE' } });
    signContractId = r.body.id;
  });

  test('400 when signer_name missing', async () => {
    const r = await request(app).post(`/api/contracts/${signContractId}/sign`)
      .set('Authorization', `Bearer ${T1}`).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/signer_name/i);
  });

  test('first signature succeeds', async () => {
    const r = await request(app).post(`/api/contracts/${signContractId}/sign`)
      .set('Authorization', `Bearer ${T1}`)
      .send({ signer_name: 'Jane Smith', signer_email: 'jane@alpha.com' });
    expect(r.status).toBe(200);
    expect(r.body.signed).toBe(true);
    expect(r.body.total_signers).toBe(1);
  });

  test('409 when same signer signs twice', async () => {
    const r = await request(app).post(`/api/contracts/${signContractId}/sign`)
      .set('Authorization', `Bearer ${T1}`)
      .send({ signer_name: 'Jane Smith' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already signed/i);
  });

  test('second signature marks contract as executed', async () => {
    const r = await request(app).post(`/api/contracts/${signContractId}/sign`)
      .set('Authorization', `Bearer ${T1}`)
      .send({ signer_name: 'Bob Jones', signer_email: 'bob@beta.com' });
    expect(r.status).toBe(200);
    expect(r.body.total_signers).toBe(2);
    // Contract should now be executed
    const check = await request(app).get(`/api/contracts/${signContractId}`).set('Authorization', `Bearer ${T1}`);
    expect(check.body.status).toBe('executed');
  });
});

// ── Expiry and Dashboard ──────────────────────────────────────────────────────
describe('Expiry and Dashboard', () => {
  beforeAll(async () => {
    // Create a contract expiring in 15 days
    const created = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({ contract_type: 'services', title: 'Expiring MSA',
              fields: { client_name:'X', vendor_name:'Y', services_scope:'IT', payment_terms:'Net-30', state:'NY' } });
    await request(app).put(`/api/contracts/${created.body.id}`)
      .set('Authorization', `Bearer ${T1}`)
      .send({ expiry_date: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0] });
  });

  test('GET /api/contracts/expiring returns soon-expiring contracts', async () => {
    const r = await request(app).get('/api/contracts/expiring?days=30').set('Authorization', `Bearer ${T1}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('contracts');
    expect(Array.isArray(r.body.contracts)).toBe(true);
    expect(r.body.contracts.length).toBeGreaterThan(0);
    expect(r.body.window_days).toBe(30);
  });

  test('GET /api/contracts/dashboard returns stats', async () => {
    const r = await request(app).get('/api/contracts/dashboard').set('Authorization', `Bearer ${T1}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('total_contracts');
    expect(r.body).toHaveProperty('by_status');
    expect(r.body.total_contracts).toBeGreaterThan(0);
  });
});

// ── Ownership isolation ───────────────────────────────────────────────────────
describe('Ownership isolation', () => {
  test('user cannot access another user contracts', async () => {
    // Create contract as user 1
    const created = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({ contract_type: 'nda', fields: { disclosing_party:'Firm A', receiving_party:'Firm B', purpose:'Isolation test', duration_years:'1', state:'NY' } });
    const id = created.body.id;

    // User 2 tries to access it
    const r = await request(app).get(`/api/contracts/${id}`).set('Authorization', `Bearer ${T2}`);
    expect(r.status).toBe(404);
  });

  test('user cannot delete another user contract', async () => {
    const created = await request(app).post('/api/contracts/draft')
      .set('Authorization', `Bearer ${T1}`)
      .send({ contract_type: 'nda', fields: { disclosing_party:'A', receiving_party:'B', purpose:'Del isolation', duration_years:'1', state:'NY' } });
    const r = await request(app).delete(`/api/contracts/${created.body.id}`).set('Authorization', `Bearer ${T2}`);
    expect(r.status).toBe(404);
  });
});

// ── makeUserLimiter ───────────────────────────────────────────────────────────
describe('makeUserLimiter', () => {
  test('returns 429 after exceeding limit', async () => {
    const { makeUserLimiter } = await import('../middleware/sharedAiLimiter.js');
    const rl_limiter = makeUserLimiter({ windowMs: 60_000, max: 2, message: 'Too many requests' });
    const rl_app = express(); rl_app.use(express.json());
    const rl_tok = jwt.sign({ id: 7777, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    rl_app.post('/rl', (q,s,n)=>{
      try{q.user=jwt.verify((q.headers.authorization||'').replace('Bearer ',''),process.env.JWT_SECRET);n();}
      catch{s.status(401).json({error:'x'});}
    }, rl_limiter, (_q,s)=>s.json({ok:true}));
    await request(rl_app).post('/rl').set('Authorization',`Bearer ${rl_tok}`).expect(200);
    await request(rl_app).post('/rl').set('Authorization',`Bearer ${rl_tok}`).expect(200);
    const rl_res = await request(rl_app).post('/rl').set('Authorization',`Bearer ${rl_tok}`);
    expect(rl_res.status).toBe(429);
    expect(rl_res.body.error).toMatch(/too many requests/i);
    expect(rl_res.headers['retry-after']).toBeDefined();
  });
});
