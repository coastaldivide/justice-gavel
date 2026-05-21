/**
 * recovery_agents.test.js — Fugitive recovery agent directory
 *
 * Tests: state required validation, city filter, armed filter,
 * GPS proximity sort, laws/:state endpoint, laws summary endpoint,
 * auth enforcement, banned-state handling (IL, KY, DC).
 */
import express  from 'express';
import request  from 'supertest';
import jwt      from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id = 1, role = 'user') =>
  jwt.sign({ id, role, email: `u${id}@test.com` }, SECRET, { expiresIn: '1h' });

// Inline RECOVERY_LAWS for tests (mirrors the real route)
const RECOVERY_LAWS = {
  TN: { allowed: true,  license: true,  law: 'TCA §40-11-132', notes: 'Must be licensed.' },
  IL: { allowed: false, license: false,  law: '725 ILCS 5/110-7', notes: 'Commercial bail effectively prohibited.' },
  KY: { allowed: false, license: false,  law: 'KRS §431.510', notes: 'Commercial bail effectively banned.' },
  DC: { allowed: false, license: false,  notes: 'DC does not use commercial bail.' },
  CA: { allowed: true,  license: true,   law: 'CA PC §1299', notes: 'Must be licensed PI or bail agent.' },
};

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS recovery_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      city TEXT,
      state TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      lat REAL,
      lng REAL,
      website TEXT,
      license_number TEXT,
      license_required INTEGER DEFAULT 0,
      armed_certified INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      reviews INTEGER DEFAULT 0,
      bio TEXT,
      available_24_7 INTEGER DEFAULT 0,
      hours TEXT,
      law_note TEXT,
      active INTEGER DEFAULT 1
    );
  `);

  await db.exec(`
    INSERT INTO recovery_agents
      (name, city, state, phone, lat, lng, armed_certified, rating, reviews, active)
    VALUES
      ('Alpha Recovery',  'Nashville', 'TN', '615-555-0001', 36.17,  -86.78, 1, 4.8, 50, 1),
      ('Beta Recovery',   'Memphis',   'TN', '901-555-0002', 35.15,  -90.05, 0, 4.2, 30, 1),
      ('Gamma Recovery',  'Nashville', 'TN', '615-555-0003', 36.20,  -86.80, 0, 3.9, 10, 1),
      ('Delta Recovery',  'Los Angeles','CA','213-555-0004', 34.05, -118.24, 1, 4.5, 20, 1),
      ('Inactive Agent',  'Nashville', 'TN', '615-555-0005', 36.17,  -86.78, 0, 3.0,  5, 0);
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

  // GET / — search agents
  router.get('/', auth, async (req, res) => {
    try {
      const { state, city, armed, lat, lng, limit = 20, offset = 0 } = req.query;
      if (!state) return res.status(400).json({ error: 'State is required (e.g. ?state=TN)' });

      const stateUpper = state.slice(0, 2).toUpperCase();
      const safeLimit  = Math.min(parseInt(limit, 10) || 20, 100);
      const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
      const stateLaw   = RECOVERY_LAWS[stateUpper] || null;

      const conditions = ['state = ?', 'active = 1', 'phone IS NOT NULL'];
      const params     = [stateUpper];

      if (city) {
        conditions.push('LOWER(city) LIKE ?');
        params.push(`%${city.toLowerCase().slice(0, 50)}%`);
      }
      if (armed === '1' || armed === 'true') {
        conditions.push('armed_certified = 1');
      }

      const where = 'WHERE ' + conditions.join(' AND ');
      let orderBy = 'ORDER BY rating DESC, reviews DESC';
      if (lat && lng) {
        const la = parseFloat(lat), ln = parseFloat(lng);
        if (!isNaN(la) && !isNaN(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180) {
          orderBy = `ORDER BY ((lat - ${la}) * (lat - ${la}) + (lng - ${ln}) * (lng - ${ln})) ASC`;
        }
      }

      const agents = await db.all(
        `SELECT id, name, city, state, phone, address, lat, lng, website,
                license_number, license_required, armed_certified,
                rating, reviews, bio, available_24_7, hours, law_note
         FROM recovery_agents ${where} ${orderBy} LIMIT ? OFFSET ?`,
        [...params, safeLimit, safeOffset]
      );
      const total = await db.get(
        `SELECT COUNT(*) as cnt FROM recovery_agents ${where}`,
        params
      );

      res.json({ agents, total: total.cnt, state_law: stateLaw,
        disclaimer: 'Recovery agent laws vary by state. Verify licensing before engaging.' });
    } catch (e) {
      res.status(500).json({ error: 'Server error.' });
    }
  });

  // GET /laws/:state
  router.get('/laws/:state', auth, (req, res) => {
    const state = (req.params.state || '').toUpperCase().slice(0, 2);
    const law   = RECOVERY_LAWS[state];
    if (!law) return res.status(404).json({ error: `No law data for state: ${state}` });
    res.json({ state, ...law, disclaimer: 'Verify with your state bar or DOI.' });
  });

  // GET /laws — summary
  router.get('/laws', auth, (req, res) => {
    res.json({
      laws: RECOVERY_LAWS,
      summary: {
        allowed:          Object.values(RECOVERY_LAWS).filter(l => l.allowed).length,
        license_required: Object.values(RECOVERY_LAWS).filter(l => l.allowed && l.license).length,
        banned:           Object.values(RECOVERY_LAWS).filter(l => !l.allowed).length,
      },
      disclaimer: 'For informational purposes only.',
    });
  });

  app.use('/recovery-agents', router);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /recovery-agents — auth', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('401 without token', async () => {
    const r = await request(app).get('/recovery-agents?state=TN');
    expect(r.status).toBe(401);
  });
});

describe('GET /recovery-agents — validation', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('400 when state param is missing', async () => {
    const r = await request(app)
      .get('/recovery-agents')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/state/i);
  });

  test('state param is uppercased', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=tn')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.agents.length).toBeGreaterThan(0);
  });
});

describe('GET /recovery-agents — search and filter', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('returns only active agents', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    // 'Inactive Agent' has active=0, should not appear
    const names = r.body.agents.map(a => a.name);
    expect(names).not.toContain('Inactive Agent');
  });

  test('city filter narrows results', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN&city=Memphis')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.agents.every(a => a.city.toLowerCase().includes('memphis'))).toBe(true);
  });

  test('armed=1 returns only armed-certified agents', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN&armed=1')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.agents.every(a => a.armed_certified === 1)).toBe(true);
  });

  test('armed=true also works', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN&armed=true')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.agents.length).toBeGreaterThan(0);
    expect(r.body.agents.every(a => a.armed_certified === 1)).toBe(true);
  });

  test('GPS sort — closest agent appears first', async () => {
    // Memphis is at 35.15, -90.05
    // Alpha is at 36.17, -86.78 (Nashville — far)
    // Beta  is at 35.15, -90.05 (Memphis — same location)
    const r = await request(app)
      .get('/recovery-agents?state=TN&lat=35.15&lng=-90.05')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.agents[0].name).toBe('Beta Recovery');
  });

  test('invalid GPS coordinates fall back to rating sort', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN&lat=999&lng=999')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    // Should not error, just sort by rating
    expect(r.body.agents[0].rating).toBeGreaterThanOrEqual(r.body.agents[1]?.rating ?? 0);
  });

  test('limit param is respected', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN&limit=2')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.agents.length).toBeLessThanOrEqual(2);
  });

  test('limit capped at 100', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN&limit=9999')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    // Should not error; max 100 applied
    expect(r.body.agents.length).toBeLessThanOrEqual(100);
  });

  test('response includes state_law field', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('state_law');
    expect(r.body.state_law.allowed).toBe(true);
  });

  test('state where bail bonding is banned returns state_law.allowed=false', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=IL')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.state_law.allowed).toBe(false);
  });

  test('empty state returns empty agents array', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=WY')  // no agents seeded for WY
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.agents).toHaveLength(0);
    expect(r.body.total).toBe(0);
  });

  test('total field reflects actual count', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(typeof r.body.total).toBe('number');
    expect(r.body.total).toBe(r.body.agents.length); // with limit=20 and 3 active TN agents
  });

  test('disclaimer is always present', async () => {
    const r = await request(app)
      .get('/recovery-agents?state=TN')
      .set('Authorization', `Bearer ${tok()}`);
    expect(typeof r.body.disclaimer).toBe('string');
    expect(r.body.disclaimer.length).toBeGreaterThan(10);
  });
});

describe('GET /recovery-agents/laws/:state', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('401 without token', async () => {
    const r = await request(app).get('/recovery-agents/laws/TN');
    expect(r.status).toBe(401);
  });

  test('200 for known state', async () => {
    const r = await request(app)
      .get('/recovery-agents/laws/TN')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('TN');
    expect(r.body).toHaveProperty('allowed');
    expect(r.body).toHaveProperty('license');
    expect(r.body).toHaveProperty('disclaimer');
  });

  test('404 for unknown state', async () => {
    const r = await request(app)
      .get('/recovery-agents/laws/ZZ')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(404);
  });

  test('state uppercased (tn → TN)', async () => {
    const r = await request(app)
      .get('/recovery-agents/laws/tn')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('TN');
  });

  test('IL law shows allowed=false with warning note', async () => {
    const r = await request(app)
      .get('/recovery-agents/laws/IL')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body.allowed).toBe(false);
    expect(r.body.notes).toMatch(/prohibit|ban|grey/i);
  });
});

describe('GET /recovery-agents/laws — all states summary', () => {
  let app;
  beforeAll(async () => {
    const db = await makeTestDb();
    await buildSchema(db);
    app = await buildApp(db);
  });

  test('returns laws object and summary', async () => {
    const r = await request(app)
      .get('/recovery-agents/laws')
      .set('Authorization', `Bearer ${tok()}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('laws');
    expect(r.body).toHaveProperty('summary');
    expect(r.body.summary).toHaveProperty('allowed');
    expect(r.body.summary).toHaveProperty('banned');
    expect(r.body.summary).toHaveProperty('license_required');
  });

  test('summary counts are internally consistent', async () => {
    const r = await request(app)
      .get('/recovery-agents/laws')
      .set('Authorization', `Bearer ${tok()}`);
    const { allowed, banned } = r.body.summary;
    const total = Object.keys(r.body.laws).length;
    expect(allowed + banned).toBe(total);
  });
});
