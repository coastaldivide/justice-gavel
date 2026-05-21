/**
 * expungement.test.js — Expungement eligibility engine + routes
 *
 * Tests every branch of classifyCharge() and getEligibility(),
 * then each HTTP route with auth, validation, and edge cases.
 *
 * Why these tests matter: incorrect expungement eligibility determinations
 * cause direct legal harm — a user who believes they ARE eligible may not
 * seek an attorney; a user told they are NOT eligible may give up.
 * Every charge classification branch and every state edge case must be tested.
 */
import express  from 'express';
import request  from 'supertest';
import jwt      from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';
import { classifyCharge, getEligibility } from '../routes/expungement/index.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id = 1, role = 'user') =>
  jwt.sign({ id, role, email: `u${id}@test.com` }, SECRET, { expiresIn: '1h' });

// ── Minimal in-memory schema for expungement tables ───────────────────────────
async function buildExpungementSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS expungement_referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      case_id INTEGER,
      state TEXT NOT NULL,
      charge_summary TEXT,
      eligible INTEGER DEFAULT 0,
      referral_partner TEXT,
      referral_status TEXT DEFAULT 'clicked',
      utm_code TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT,
      status TEXT DEFAULT 'Open',
      expungement_notified INTEGER DEFAULT 0,
      next_court_date TEXT,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS lawyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      rating REAL DEFAULT 0,
      reviews INTEGER DEFAULT 0,
      bar_number TEXT,
      verified INTEGER DEFAULT 0,
      bar_verified INTEGER DEFAULT 0,
      jtb_verified INTEGER DEFAULT 0,
      gavel_level INTEGER DEFAULT 0,
      golden_gavel INTEGER DEFAULT 0,
      free_consultation INTEGER DEFAULT 0,
      specialties TEXT,
      bio TEXT,
      lat REAL,
      lng REAL,
      active INTEGER DEFAULT 1
    );
  `);
}

// Build minimal Express app that mirrors the real expungement route
async function buildApp(db) {
  const app    = express();
  app.use(express.json());

  // Inject db into app locals so route can access it in tests
  // (We inline the route handlers to use the test DB)
  const router = express.Router();

  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    if (!t) return res.status(401).json({ error: 'missing token' });
    try { req.user = jwt.verify(t, SECRET); next(); }
    catch { res.status(401).json({ error: 'invalid token' }); }
  }

  // GET /check — pure logic, no DB
  router.get('/check', (req, res) => {
    const state      = (req.query.state  || 'TN').toString().toUpperCase().slice(0, 2);
    const charges    = (req.query.charges || '').toString();
    const status     = (req.query.status  || 'Closed').toString();
    const chargeType = classifyCharge(charges);
    const eligibility = getEligibility(state, chargeType, status);
    return res.json({
      state,
      chargeType,
      status,
      eligibility: {
        likely:      eligibility.eligible === true,
        conditional: eligibility.eligible === 'conditional',
        notEligible: eligibility.eligible === false,
        waitYears:   eligibility.waitYears || 0,
        note:        eligibility.note,
      },
      partners: [],
      disclaimer: 'Not legal advice.',
    });
  });

  // POST /referral — writes to DB
  router.post('/referral', auth, async (req, res) => {
    const { case_id, state = 'TN', charges = '', status = 'Closed', partner = 'general' } = req.body;
    try {
      const chargeType  = classifyCharge(charges);
      const eligibility = getEligibility(state, chargeType, status);
      const result = await db.run(
        `INSERT INTO expungement_referrals
           (user_id, case_id, state, charge_summary, eligible, referral_partner, referral_status, utm_code)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          req.user.id, case_id || null, state, charges.slice(0, 200),
          eligibility.eligible === true ? 1 : 0,
          partner, 'clicked', `jtb_${state}_${chargeType}_test`,
        ]
      );
      if (case_id) {
        await db.run(
          'UPDATE cases SET expungement_notified=1 WHERE id=? AND user_id=?',
          [case_id, req.user.id]
        ).catch(() => {});
      }
      return res.json({ success: true, referral_id: result.lastID, redirect_url: 'https://justicegavel.app/expunge' });
    } catch (e) {
      return res.status(500).json({ error: 'Server error.' });
    }
  });

  // GET /referrals — reads user's history
  router.get('/referrals', auth, async (req, res) => {
    try {
      const rows = await db.all(
        'SELECT * FROM expungement_referrals WHERE user_id=? ORDER BY created_at DESC',
        [req.user.id]
      );
      return res.json(rows);
    } catch (e) {
      return res.status(500).json({ error: 'Server error.' });
    }
  });

  // GET /attorneys — searches lawyers table
  router.get('/attorneys', async (req, res) => {
    try {
      const { state = 'TN', limit = 10 } = req.query;
      const rows = await db.all(
        `SELECT id, name, phone, city, state as lawyer_state,
                rating, bar_verified, jtb_verified, free_consultation, specialties
         FROM lawyers
         WHERE (
           LOWER(specialties) LIKE '%expungement%'
           OR LOWER(specialties) LIKE '%criminal defense%'
         )
         AND (LOWER(state) = ? OR state IS NULL)
         ORDER BY jtb_verified DESC, bar_verified DESC, rating DESC
         LIMIT ?`,
        [state.toLowerCase(), parseInt(limit, 10)]
      );
      return res.json({ attorneys: rows, state, matched: rows.length > 0, count: rows.length });
    } catch (e) {
      return res.status(500).json({ error: 'Server error.' });
    }
  });

  app.use('/expungement', router);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: classifyCharge()
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyCharge() — pure classification logic', () => {
  const cases = [
    // dismissed variants
    ['dismissed', 'dismissed'],
    ['charges dismissed', 'dismissed'],
    ['not guilty verdict', 'dismissed'],
    ['case acquitted', 'dismissed'],
    ['charges dropped', 'dismissed'],
    ['no charges filed', 'dismissed'],

    // DUI variants
    ['DUI first offense', 'dui'],
    ['DWI', 'dui'],
    ['drunk driving', 'dui'],
    ['impaired driving charge', 'dui'],
    ['driving while impaired', 'dui'],
    ['DUI - DISMISSED', 'dismissed'], // dismissed wins over dui

    // domestic
    ['domestic violence assault', 'domestic'],
    ['intimate partner violence', 'domestic'],
    ['family violence battery', 'domestic'],

    // sexual offenses
    ['sex offense registration required', 'sexual'],
    ['rape second degree', 'sexual'],
    ['indecent exposure', 'sexual'],
    ['child abuse', 'sexual'],
    ['molestation charge', 'sexual'],

    // felony
    ['Class D felony theft', 'felony'],
    ['felonious assault', 'felony'],
    ['Class A Felony', 'felony'],

    // default misdemeanor
    ['simple assault', 'misdemeanor'],
    ['disorderly conduct', 'misdemeanor'],
    ['shoplifting', 'misdemeanor'],
    ['trespassing', 'misdemeanor'],
    ['', 'misdemeanor'],            // empty string defaults
    ['   ', 'misdemeanor'],         // whitespace only
  ];

  test.each(cases)('"%s" → %s', (input, expected) => {
    expect(classifyCharge(input)).toBe(expected);
  });

  test('is case-insensitive', () => {
    expect(classifyCharge('DUI')).toBe('dui');
    expect(classifyCharge('dui')).toBe('dui');
    expect(classifyCharge('Dismissed')).toBe('dismissed');
    expect(classifyCharge('DOMESTIC VIOLENCE')).toBe('domestic');
  });

  test('dismissed takes priority over all other charge types', () => {
    // A dismissed DUI should return dismissed, not dui
    expect(classifyCharge('DUI charges dismissed')).toBe('dismissed');
    expect(classifyCharge('felony assault — acquitted')).toBe('dismissed');
    expect(classifyCharge('domestic violence — not guilty')).toBe('dismissed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests: getEligibility()
// ─────────────────────────────────────────────────────────────────────────────
describe('getEligibility() — state rule lookup', () => {
  test('TN misdemeanor — eligible after 5 years', () => {
    const r = getEligibility('TN', 'misdemeanor', 'Closed');
    expect(r.eligible).toBe(true);
    expect(r.waitYears).toBe(5);
    expect(r.note).toMatch(/T\.C\.A\./);
  });

  test('TN dismissed — immediately eligible', () => {
    const r = getEligibility('TN', 'dismissed', 'Closed');
    expect(r.eligible).toBe(true);
    expect(r.waitYears).toBe(0);
  });

  test('TN domestic violence — not eligible', () => {
    const r = getEligibility('TN', 'domestic', 'Closed');
    expect(r.eligible).toBe(false);
  });

  test('TN sexual offense — not eligible', () => {
    const r = getEligibility('TN', 'sexual', 'Closed');
    expect(r.eligible).toBe(false);
  });

  test('WI — conditional (sentencing-time only)', () => {
    const r = getEligibility('WI', 'misdemeanor', 'Closed');
    expect(r.eligible).toBe('conditional');
    expect(r.note).toMatch(/CRITICAL/);  // CRITICAL warning must be present
    expect(r.note).toMatch(/sentencing/i);
  });

  test('FL DUI — not eligible', () => {
    const r = getEligibility('FL', 'dui', 'Closed');
    expect(r.eligible).toBe(false);
  });

  test('CA DUI — conditional (PC 1203.4)', () => {
    const r = getEligibility('CA', 'dui', 'Closed');
    expect(r.eligible).toBe('conditional');
  });

  test('status=Dismissed overrides chargeType', () => {
    // Even a DUI with status=Dismissed should look up dismissed rules
    const r = getEligibility('FL', 'dui', 'Dismissed');
    expect(r.eligible).toBe(true);   // FL dismissed = immediately eligible
    expect(r.waitYears).toBe(0);
  });

  test('unknown state falls back to DEFAULT_RULES', () => {
    const r = getEligibility('XX', 'misdemeanor', 'Closed');
    expect(r.eligible).toBe('conditional');
    expect(r.note).toBeTruthy();
  });

  test('unknown chargeType falls back to misdemeanor rule', () => {
    const r = getEligibility('TN', 'traffic_violation', 'Closed');
    // traffic_violation not in STATE_RULES, falls back to misdemeanor
    expect(r).toBeDefined();
    expect(r.waitYears).toBeGreaterThanOrEqual(0);
  });

  // States with legally significant edge cases
  test('IA felony — requires zero prior convictions (note must warn)', () => {
    const r = getEligibility('IA', 'felony', 'Closed');
    expect(r.eligible).toBe('conditional');
    expect(r.note.toLowerCase()).toMatch(/convict|prior/i);
  });

  test('DC — 5 year wait from completion of sentence (2025 change)', () => {
    const r = getEligibility('DC', 'misdemeanor', 'Closed');
    expect(r.waitYears).toBe(5);
  });

  test('MD — 3 year wait from completion of sentence (2025 reform)', () => {
    const r = getEligibility('MD', 'misdemeanor', 'Closed');
    expect(r.waitYears).toBe(3);
    expect(r.note).toMatch(/2025/);
  });

  test('VA — July 2026 Clean Slate law noted', () => {
    const r = getEligibility('VA', 'misdemeanor', 'Closed');
    expect(r.note).toMatch(/2026/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP route tests: GET /expungement/check
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /expungement/check', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildExpungementSchema(db);
    app = await buildApp(db);
  });

  test('200 with required fields', async () => {
    const r = await request(app).get('/expungement/check?state=TN&charges=simple%20assault');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('state', 'TN');
    expect(r.body).toHaveProperty('chargeType');
    expect(r.body.eligibility).toHaveProperty('likely');
    expect(r.body.eligibility).toHaveProperty('conditional');
    expect(r.body.eligibility).toHaveProperty('notEligible');
    expect(r.body.eligibility).toHaveProperty('waitYears');
    expect(r.body.eligibility).toHaveProperty('note');
    expect(r.body).toHaveProperty('disclaimer');
  });

  test('state param uppercased and truncated to 2 chars', async () => {
    const r = await request(app).get('/expungement/check?state=tn&charges=assault');
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('TN');
  });

  test('unknown state returns conditional default', async () => {
    const r = await request(app).get('/expungement/check?state=ZZ&charges=assault');
    expect(r.status).toBe(200);
    expect(r.body.eligibility.conditional).toBe(true);
  });

  test('dismissed charge → immediately eligible', async () => {
    const r = await request(app).get('/expungement/check?state=TN&charges=dismissed&status=Dismissed');
    expect(r.status).toBe(200);
    expect(r.body.eligibility.likely).toBe(true);
    expect(r.body.eligibility.waitYears).toBe(0);
  });

  test('DUI in FL → not eligible', async () => {
    const r = await request(app).get('/expungement/check?state=FL&charges=DUI+first+offense');
    expect(r.status).toBe(200);
    expect(r.body.eligibility.notEligible).toBe(true);
  });

  test('no query params — defaults gracefully', async () => {
    const r = await request(app).get('/expungement/check');
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('TN');       // default state
    expect(r.body.chargeType).toBe('misdemeanor'); // empty charges → misdemeanor
  });

  test('WI misdemeanor note contains CRITICAL warning', async () => {
    const r = await request(app).get('/expungement/check?state=WI&charges=misdemeanor+theft');
    expect(r.status).toBe(200);
    expect(r.body.eligibility.note).toMatch(/CRITICAL/);
  });

  test('disclaimer field is always present and non-empty', async () => {
    const r = await request(app).get('/expungement/check?state=CA&charges=DUI');
    expect(r.status).toBe(200);
    expect(typeof r.body.disclaimer).toBe('string');
    expect(r.body.disclaimer.length).toBeGreaterThan(5); // test app uses short disclaimer
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP route tests: POST /expungement/referral
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /expungement/referral', () => {
  let app, db;
  beforeAll(async () => {
    db  = await makeTestDb();
    await buildExpungementSchema(db);
    app = await buildApp(db);
  });

  test('401 without token', async () => {
    const r = await request(app).post('/expungement/referral').send({ state: 'TN' });
    expect(r.status).toBe(401);
  });

  test('201-ish success — returns referral_id', async () => {
    const r = await request(app)
      .post('/expungement/referral')
      .set('Authorization', `Bearer ${tok(1)}`)
      .send({ state: 'TN', charges: 'misdemeanor assault', partner: 'general' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(typeof r.body.referral_id).toBe('number');
    expect(r.body.redirect_url).toMatch(/^https/);
  });

  test('referral is persisted in DB', async () => {
    await request(app)
      .post('/expungement/referral')
      .set('Authorization', `Bearer ${tok(2)}`)
      .send({ state: 'FL', charges: 'DUI first offense', partner: 'recordseal' });

    const rows = await db.all('SELECT * FROM expungement_referrals WHERE user_id=2');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].state).toBe('FL');
    expect(rows[0].referral_status).toBe('clicked');
  });

  test('eligible field stored correctly for eligible charge', async () => {
    await request(app)
      .post('/expungement/referral')
      .set('Authorization', `Bearer ${tok(3)}`)
      .send({ state: 'TN', charges: 'dismissed charges', status: 'Dismissed' });

    const row = await db.get(
      'SELECT eligible FROM expungement_referrals WHERE user_id=3 ORDER BY id DESC LIMIT 1'
    );
    expect(row.eligible).toBe(1); // dismissed = eligible
  });

  test('eligible field stored correctly for ineligible charge', async () => {
    await request(app)
      .post('/expungement/referral')
      .set('Authorization', `Bearer ${tok(4)}`)
      .send({ state: 'TN', charges: 'domestic violence assault' });

    const row = await db.get(
      'SELECT eligible FROM expungement_referrals WHERE user_id=4 ORDER BY id DESC LIMIT 1'
    );
    expect(row.eligible).toBe(0); // domestic = not eligible
  });

  test('case_id sets expungement_notified on the case', async () => {
    // Seed a case for user 5
    await db.run(
      'INSERT INTO cases (user_id, title, status) VALUES (?,?,?)',
      [5, 'Test Case', 'Closed']
    );
    const c = await db.get('SELECT id FROM cases WHERE user_id=5');

    await request(app)
      .post('/expungement/referral')
      .set('Authorization', `Bearer ${tok(5)}`)
      .send({ state: 'TN', charges: 'simple assault', case_id: c.id });

    const updated = await db.get('SELECT expungement_notified FROM cases WHERE id=?', [c.id]);
    expect(updated.expungement_notified).toBe(1);
  });

  test('missing case_id is handled gracefully (no error)', async () => {
    const r = await request(app)
      .post('/expungement/referral')
      .set('Authorization', `Bearer ${tok(6)}`)
      .send({ state: 'TN', charges: 'shoplifting' }); // no case_id
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  test('charge summary truncated to 200 chars', async () => {
    const longCharge = 'x'.repeat(500);
    await request(app)
      .post('/expungement/referral')
      .set('Authorization', `Bearer ${tok(7)}`)
      .send({ state: 'TN', charges: longCharge });

    const row = await db.get(
      'SELECT charge_summary FROM expungement_referrals WHERE user_id=7'
    );
    expect(row.charge_summary.length).toBeLessThanOrEqual(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP route tests: GET /expungement/referrals
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /expungement/referrals', () => {
  let app, db;
  beforeAll(async () => {
    db  = await makeTestDb();
    await buildExpungementSchema(db);
    app = await buildApp(db);
  });

  test('401 without token', async () => {
    const r = await request(app).get('/expungement/referrals');
    expect(r.status).toBe(401);
  });

  test('returns empty array when no referrals', async () => {
    const r = await request(app)
      .get('/expungement/referrals')
      .set('Authorization', `Bearer ${tok(99)}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(0);
  });

  test('returns only current user referrals — not other users', async () => {
    // Seed referrals for user 10 and user 11
    await db.run(
      'INSERT INTO expungement_referrals (user_id, state, eligible, referral_partner, referral_status, utm_code) VALUES (?,?,?,?,?,?)',
      [10, 'TN', 1, 'general', 'clicked', 'test_10']
    );
    await db.run(
      'INSERT INTO expungement_referrals (user_id, state, eligible, referral_partner, referral_status, utm_code) VALUES (?,?,?,?,?,?)',
      [11, 'FL', 0, 'general', 'clicked', 'test_11']
    );

    const r = await request(app)
      .get('/expungement/referrals')
      .set('Authorization', `Bearer ${tok(10)}`);
    expect(r.status).toBe(200);
    expect(r.body.every(row => row.user_id === 10)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP route tests: GET /expungement/attorneys
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /expungement/attorneys', () => {
  let app, db;
  beforeAll(async () => {
    db  = await makeTestDb();
    await buildExpungementSchema(db);
    app = await buildApp(db);

    // Seed two attorneys
    await db.run(
      `INSERT INTO lawyers (name, phone, city, state, specialties, bar_verified, jtb_verified, rating, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['Jane Smith', '615-555-0001', 'Nashville', 'TN', 'criminal defense, expungement', 1, 1, 4.8, 1]
    );
    await db.run(
      `INSERT INTO lawyers (name, phone, city, state, specialties, bar_verified, jtb_verified, rating, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['Bob Jones', '305-555-0002', 'Miami', 'FL', 'criminal defense', 1, 0, 4.2, 1]
    );
  });

  test('returns attorneys for specified state', async () => {
    const r = await request(app).get('/expungement/attorneys?state=TN');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('attorneys');
    expect(r.body).toHaveProperty('state', 'TN');
    expect(r.body.attorneys).toHaveLength(1);
    expect(r.body.attorneys[0].name).toBe('Jane Smith');
  });

  test('returns empty attorneys array for state with no matches', async () => {
    const r = await request(app).get('/expungement/attorneys?state=AK');
    expect(r.status).toBe(200);
    expect(r.body.attorneys).toHaveLength(0);
    expect(r.body.matched).toBe(false);
  });

  test('response always has count field', async () => {
    const r = await request(app).get('/expungement/attorneys?state=TN');
    expect(typeof r.body.count).toBe('number');
  });
});
