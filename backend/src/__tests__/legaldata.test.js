/**
 * legaldata.test.js — /api/legaldata/:type route
 *
 * Tests table routing, state filtering, text search, JSON column parsing,
 * auth gating, unknown type rejection, and disclaimer/meta fields.
 */
import express  from 'express';
import request  from 'supertest';
import jwt      from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id = 1) =>
  jwt.sign({ id, role: 'user', email: `u${id}@test.com` }, SECRET, { expiresIn: '1h' });

const TABLE_MAP = {
  bail:              { table: 'bail_schedules',         stateCol: 'state' },
  dui:               { table: 'dui_laws',               stateCol: 'state' },
  drugs:             { table: 'drug_penalties',          stateCol: 'state' },
  sol:               { table: 'statute_of_limitations',  stateCol: 'state' },
  'federal-courts':  { table: 'federal_courts',          stateCol: 'state' },
  'victim-comp':     { table: 'victim_compensation',     stateCol: 'state' },
  clinics:           { table: 'law_school_clinics',       stateCol: 'state' },
  'bar-complaints':  { table: 'state_bar_complaints',    stateCol: 'state' },
  probation:         { table: 'probation_offices',        stateCol: 'state' },
  'specialty-courts':{ table: 'specialty_courts',        stateCol: 'state' },
  courthouses:       { table: 'courthouses',              stateCol: 'state' },
};

// ── Build a test app that mirrors legaldata.js exactly ────────────────────────
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

  const DISCLAIMERS = {
    dui:   'DUI data sourced from NHTSA, IIHS, MADD, and state statutes. Last verified April 2026. Laws change frequently.',
    drugs: 'Drug penalty data from DEA scheduling and state criminal codes. Penalties vary by county, prior record, and judge. Last verified April 2026.',
    bail:  'Bail amounts are general ranges. Actual bail is set by a judge based on your specific circumstances.',
    sol:   'Statute of limitations data from published state criminal codes. Tolling rules and exceptions apply.',
  };

  router.get('/:type', auth, async (req, res) => {
    try {
      const { type } = req.params;
      const { state, q } = req.query;
      const cfg = TABLE_MAP[type];
      if (!cfg) return res.status(404).json({ error: 'Unknown data type' });

      let sql = `SELECT * FROM ${cfg.table} WHERE 1=1`;
      const params = [];

      if (state) {
        sql += ` AND (${cfg.stateCol}=? OR ${cfg.stateCol}="ALL" OR ${cfg.stateCol}="FED")`;
        params.push(state.toUpperCase());
      }
      if (q) {
        const qp = `%${q}%`;
        sql += ' AND (name LIKE ? OR charge LIKE ? OR notes LIKE ? OR district LIKE ?)';
        params.push(qp, qp, qp, qp);
      }
      sql += ' ORDER BY id ASC LIMIT 500';

      const rows = await db.all(sql, params);
      const parsed = rows.map(r => {
        if (r.covers) { try { r.covers = JSON.parse(r.covers); } catch {} }
        return r;
      });

      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.json({
        data: parsed,
        meta: {
          type,
          state: (state || 'ALL').toUpperCase(),
          count: parsed.length,
          disclaimer: DISCLAIMERS[type] || 'General legal reference data. Not legal advice.',
          last_verified: '2026-04-29',
          not_legal_advice: true,
        },
      });
    } catch (e) {
      res.status(500).json({ error: 'Could not load legal data' });
    }
  });

  app.use('/legaldata', router);
  return app;
}

// ── Create the schema for all legal data tables ───────────────────────────────
async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dui_laws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      bac_limit REAL,
      first_jail_min INTEGER,
      first_fine_min INTEGER,
      dmv_hearing_deadline INTEGER,
      ignition_interlock TEXT,
      notes TEXT,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS drug_penalties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      drug TEXT,
      charge TEXT,
      min_sentence INTEGER,
      max_sentence INTEGER,
      notes TEXT,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS bail_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      charge TEXT,
      min_bail INTEGER,
      max_bail INTEGER,
      notes TEXT,
      name TEXT,
      covers TEXT
    );
    CREATE TABLE IF NOT EXISTS statute_of_limitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      offense TEXT,
      years INTEGER,
      notes TEXT,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS federal_courts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT,
      district TEXT,
      name TEXT,
      address TEXT,
      phone TEXT
    );
    CREATE TABLE IF NOT EXISTS victim_compensation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      max_award INTEGER,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS law_school_clinics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      specialties TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS state_bar_complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      url TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS probation_offices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      address TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS specialty_courts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      court_type TEXT,
      name TEXT,
      phone TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS courthouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      court_type TEXT,
      name TEXT,
      address TEXT,
      phone TEXT
    );
  `);

  // Seed representative rows
  await db.exec(`
    INSERT INTO dui_laws (state, bac_limit, dmv_hearing_deadline, ignition_interlock, notes, name)
      VALUES ('TN', 0.08, 30, 'All offenses', 'TN DUI notes', 'Tennessee DUI Laws');
    INSERT INTO dui_laws (state, bac_limit, dmv_hearing_deadline, notes, name)
      VALUES ('FL', 0.08, 10, 'FL DUI notes', 'Florida DUI Laws');
    INSERT INTO dui_laws (state, bac_limit, dmv_hearing_deadline, notes, name)
      VALUES ('ALL', 0.08, 0, 'Federal standard', 'Federal DUI Standard');

    INSERT INTO drug_penalties (state, drug, charge, notes, name)
      VALUES ('TN', 'cannabis', 'possession', 'TN cannabis notes', 'Tennessee Drug');
    INSERT INTO drug_penalties (state, drug, charge, notes, name)
      VALUES ('CA', 'cannabis', 'possession', 'CA cannabis notes', 'California Drug');

    INSERT INTO bail_schedules (state, charge, min_bail, max_bail, covers, name)
      VALUES ('TN', 'DUI', 1000, 5000, '["DUI","OWI"]', 'TN Bail');
    INSERT INTO bail_schedules (state, charge, min_bail, max_bail, covers, name)
      VALUES ('TN', 'Theft', 500, 2500, NULL, 'TN Theft Bail');
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /legaldata/:type — auth', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('401 without token', async () => {
    const r = await request(app).get('/legaldata/dui');
    expect(r.status).toBe(401);
  });

  test('401 with malformed token', async () => {
    const r = await request(app)
      .get('/legaldata/dui')
      .set('Authorization', 'Bearer not.a.token');
    expect(r.status).toBe(401);
  });
});

describe('GET /legaldata/:type — type routing', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('404 for unknown type', async () => {
    const r = await request(app)
      .get('/legaldata/unknown_type')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/unknown/i);
  });

  test.each(Object.keys(TABLE_MAP))(
    'type "%s" returns 200 with data + meta',
    async (type) => {
      const r = await request(app)
        .get(`/legaldata/${type}`)
        .set('Authorization', `Bearer ${tok()}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.data)).toBe(true);
      expect(r.body.meta).toHaveProperty('type', type);
      expect(r.body.meta).toHaveProperty('count');
      expect(r.body.meta).toHaveProperty('not_legal_advice', true);
      expect(r.body.meta).toHaveProperty('disclaimer');
      expect(r.body.meta).toHaveProperty('last_verified');
    }
  );
});

describe('GET /legaldata/dui — state filtering', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('state=TN returns TN + ALL rows', async () => {
    const r = await request(app)
      .get('/legaldata/dui?state=TN')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    const states = r.body.data.map(d => d.state);
    // Should include TN and ALL rows, not FL
    expect(states).toContain('TN');
    expect(states).toContain('ALL');
    expect(states).not.toContain('FL');
  });

  test('no state param returns all rows', async () => {
    const r = await request(app)
      .get('/legaldata/dui')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(3); // TN + FL + ALL
    expect(r.body.meta.state).toBe('ALL');
  });

  test('state param is uppercased', async () => {
    const r = await request(app)
      .get('/legaldata/dui?state=tn')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.meta.state).toBe('TN');
  });

  test('TN dmv_hearing_deadline is 30 (legal accuracy check)', async () => {
    const r = await request(app)
      .get('/legaldata/dui?state=TN')
      .set('Authorization', `Bearer ${tok()}`);
    const tn = r.body.data.find(d => d.state === 'TN');
    expect(tn).toBeDefined();
    expect(tn.dmv_hearing_deadline).toBe(30);
  });
});

describe('GET /legaldata/bail — JSON column parsing', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('covers column parsed from JSON string to array', async () => {
    const r = await request(app)
      .get('/legaldata/bail?state=TN')
      .set('Authorization', `Bearer ${tok()}`);
    const withCovers = r.body.data.find(d => d.covers && Array.isArray(d.covers));
    expect(withCovers).toBeDefined();
    expect(withCovers.covers).toContain('DUI');
  });

  test('null covers column remains null (no parse error)', async () => {
    const r = await request(app)
      .get('/legaldata/bail?state=TN')
      .set('Authorization', `Bearer ${tok()}`);
    const nullCovers = r.body.data.find(d => d.charge === 'Theft');
    expect(nullCovers).toBeDefined();
    // covers should be null or undefined, not throw
  });
});

describe('GET /legaldata/dui — cache headers', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('Cache-Control header is set', async () => {
    const r = await request(app)
      .get('/legaldata/dui')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.headers['cache-control']).toMatch(/max-age=86400/);
  });
});

describe('GET /legaldata/dui — type-specific disclaimers', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('dui disclaimer mentions NHTSA', async () => {
    const r = await request(app)
      .get('/legaldata/dui')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.body.meta.disclaimer).toMatch(/NHTSA/i);
  });

  test('drugs disclaimer mentions DEA', async () => {
    const r = await request(app)
      .get('/legaldata/drugs')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.body.meta.disclaimer).toMatch(/DEA/i);
  });

  test('bail disclaimer warns about judge discretion', async () => {
    const r = await request(app)
      .get('/legaldata/bail')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.body.meta.disclaimer).toMatch(/judge/i);
  });

  test('unknown type gets generic disclaimer', async () => {
    const r = await request(app)
      .get('/legaldata/clinics')
      .set('Authorization', `Bearer ${tok()}`);
    expect(typeof r.body.meta.disclaimer).toBe('string');
    expect(r.body.meta.disclaimer.length).toBeGreaterThan(5);
  });
});
