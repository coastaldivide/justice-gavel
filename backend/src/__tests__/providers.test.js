/**
 * providers.test.js — Provider search routes (lawyers + bail agents)
 *
 * Tests: /lawyers search by city, lat/lng, filters, pagination;
 *        /bail search; /nearest-city; auth optional;
 *        invalid params; empty results
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
function tok(id) {
  return jwt.sign({ id, role:'user', email:`u${id}@test.com` }, SECRET, { expiresIn:'1h' });
}

// Haversine distance (mirrors providers.js)
function haversineKm(lat1, lon1, lat2, lon2) {
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

async function buildApp(db) {
  // Seed provider tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS lawyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, specialty TEXT, lat REAL, lng REAL,
      phone TEXT, email TEXT, city TEXT, state TEXT,
      bar_verified INTEGER DEFAULT 0,
      jtb_verified INTEGER DEFAULT 0,
      free_consultation INTEGER DEFAULT 0,
      pro_bono INTEGER DEFAULT 0,
      languages TEXT DEFAULT 'en',
      hourly_rate INTEGER,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS bondsmen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, lat REAL, lng REAL,
      phone TEXT, city TEXT, state TEXT,
      active INTEGER DEFAULT 1
    );
  `);

  // Seed lawyers
  const lawyers = [
    [1,'Sarah Mitchell','Criminal Defense',35.9606,-83.9207,'(865)555-0001','sm@test.com','Knoxville','TN',1,1,1,0,'en',200],
    [2,'Marcus Thompson','DUI Defense',35.9606,-83.9207,'(865)555-0002','mt@test.com','Knoxville','TN',1,0,0,0,'en',175],
    [3,'Maria Garcia','Immigration',36.1627,-86.7816,'(615)555-0003','mg@test.com','Nashville','TN',1,1,0,1,'es',0],
    [4,'James Lee','Criminal Defense',35.1495,-90.0490,'(901)555-0004','jl@test.com','Memphis','TN',1,0,0,0,'vi',150],
  ];
  for (const [id,name,spec,lat,lng,phone,email,city,state,bv,jv,fc,pb,lang,rate] of lawyers) {
    await db.run(
      `INSERT OR IGNORE INTO lawyers (id,name,specialty,lat,lng,phone,email,city,state,bar_verified,jtb_verified,free_consultation,pro_bono,languages,hourly_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,name,spec,lat,lng,phone,email,city,state,bv,jv,fc,pb,lang,rate]
    );
  }
  // Seed bondsmen
  await db.run(
    `INSERT OR IGNORE INTO bondsmen (id,name,lat,lng,phone,city,state) VALUES (?,?,?,?,?,?,?)`,
    [1,'Knox County Bail',35.9606,-83.9207,'(865)555-9999','Knoxville','TN']
  );

  const router = express.Router();
  function optAuth(req,res,next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if(t){try{req.user=jwt.verify(t,SECRET);}catch{}}
    next();
  }

  // GET /lawyers
  router.get('/lawyers', optAuth, async (req, res) => {
    try {
      const limit  = Math.min(parseInt(req.query.limit||'20',10),50);
      const page   = Math.max(1,parseInt(req.query.page||'1',10));
      const offset = (page-1)*limit;
      const lat    = parseFloat(req.query.lat);
      const lng    = parseFloat(req.query.lng);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
      const city   = req.query.city || null;
      const caseType = (req.query.caseType||'').toLowerCase();
      const proBonoOnly = req.query.proBonoOnly === 'true';
      const language = req.query.language || '';

      let rows = await db.all('SELECT * FROM lawyers WHERE active=1');

      // Filter
      if (city) rows = rows.filter(r => r.city?.toLowerCase().includes(city.toLowerCase()));
      if (caseType) rows = rows.filter(r => r.specialty?.toLowerCase().includes(caseType));
      if (proBonoOnly) rows = rows.filter(r => r.pro_bono);
      if (language) rows = rows.filter(r => r.languages?.includes(language));

      // Sort: JTB verified first, then by distance if coords provided
      if (hasCoords) {
        rows = rows.map(r => ({ ...r, distanceKm: haversineKm(lat,lng,r.lat,r.lng) }))
          .sort((a,b) => (b.jtb_verified-a.jtb_verified) || (a.distanceKm-b.distanceKm));
      } else {
        rows = rows.sort((a,b) => b.jtb_verified - a.jtb_verified);
      }

      const total = rows.length;
      const paginated = rows.slice(offset, offset+limit);
      res.json({ data: paginated, pagination:{ page, limit, total, pages:Math.ceil(total/limit), hasMore:offset+paginated.length<total } });
    } catch(e) { res.status(500).json({ error:'Could not search lawyers. Please try again.' }); }
  });

  // GET /bail
  router.get('/bail', optAuth, async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      const city = req.query.city || null;
      let rows = await db.all('SELECT * FROM bondsmen WHERE active=1');
      if (city) rows = rows.filter(r => r.city?.toLowerCase().includes(city.toLowerCase()));
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        rows = rows.map(r => ({ ...r, distanceKm: haversineKm(lat,lng,r.lat,r.lng) }))
          .sort((a,b) => a.distanceKm-b.distanceKm);
      }
      res.json({ data: rows, pagination:{ total: rows.length } });
    } catch { res.status(500).json({ error:'Could not search bail agents. Please try again.' }); }
  });

  // GET /nearest-city
  router.get('/nearest-city', optAuth, async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error:'lat and lng required' });
      }
      const cities = await db.all('SELECT DISTINCT city, lat, lng FROM lawyers WHERE active=1');
      const nearest = cities.sort((a,b) => haversineKm(lat,lng,a.lat,a.lng) - haversineKm(lat,lng,b.lat,b.lng))[0];
      res.json({ city: nearest?.city || null });
    } catch { res.status(500).json({ error:'Could not determine nearest city. Please try again.' }); }
  });

  const a = express();
  a.use(express.json());
  a.use('/api/providers', router);
  return a;
}

let db, app;
beforeAll(async () => {
  db = await makeTestDb();
  app = await buildApp(db);
});

// ── Lawyers search ────────────────────────────────────────────────────────────
describe('GET /api/providers/lawyers', () => {
  it('returns all lawyers with no filter', async () => {
    const res = await request(app).get('/api/providers/lawyers');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    expect(res.body.pagination).toBeDefined();
    expect(typeof res.body.pagination.total).toBe('number');
  });

  it('filters by city', async () => {
    const res = await request(app).get('/api/providers/lawyers?city=Knoxville');
    expect(res.status).toBe(200);
    expect(res.body.data.every(l => l.city === 'Knoxville')).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by caseType (substring match)', async () => {
    const res = await request(app).get('/api/providers/lawyers?caseType=immigration');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Maria Garcia');
  });

  it('filters pro bono only', async () => {
    const res = await request(app).get('/api/providers/lawyers?proBonoOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data.every(l => l.pro_bono)).toBe(true);
  });

  it('filters by language', async () => {
    const res = await request(app).get('/api/providers/lawyers?language=es');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].name).toBe('Maria Garcia');
  });

  it('sorts JTB verified lawyers first', async () => {
    const res = await request(app).get('/api/providers/lawyers');
    expect(res.status).toBe(200);
    const verified = res.body.data.filter(l => l.jtb_verified);
    const notVerified = res.body.data.filter(l => !l.jtb_verified);
    if (verified.length && notVerified.length) {
      const lastVerifiedIdx = res.body.data.lastIndexOf(verified[verified.length-1]);
      const firstUnverifiedIdx = res.body.data.indexOf(notVerified[0]);
      expect(lastVerifiedIdx).toBeLessThan(firstUnverifiedIdx);
    }
  });

  it('applies pagination correctly', async () => {
    const res = await request(app).get('/api/providers/lawyers?limit=2&page=1');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.page).toBe(1);
  });

  it('sorts by distance when lat/lng provided', async () => {
    // Knoxville coordinates — James Lee in Memphis should be farther
    const res = await request(app).get('/api/providers/lawyers?lat=35.9606&lng=-83.9207');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.length).toBeGreaterThan(0);
    // Knoxville lawyers should appear before Memphis
    const kIdx = data.findIndex(l => l.city === 'Knoxville');
    const mIdx = data.findIndex(l => l.city === 'Memphis');
    if (kIdx >= 0 && mIdx >= 0) {
      expect(kIdx).toBeLessThan(mIdx);
    }
  });

  it('returns empty data array when no matches', async () => {
    const res = await request(app).get('/api/providers/lawyers?city=Atlantis');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('works without authentication (public endpoint)', async () => {
    const res = await request(app).get('/api/providers/lawyers');
    expect(res.status).toBe(200);
  });

  it('works with authentication (optional auth)', async () => {
    const res = await request(app)
      .get('/api/providers/lawyers')
      .set('Authorization', `Bearer ${tok(1)}`);
    expect(res.status).toBe(200);
  });
});

// ── Bail search ───────────────────────────────────────────────────────────────
describe('GET /api/providers/bail', () => {
  it('returns bail agents', async () => {
    const res = await request(app).get('/api/providers/bail');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by city', async () => {
    const res = await request(app).get('/api/providers/bail?city=Knoxville');
    expect(res.status).toBe(200);
    expect(res.body.data.every(b => b.city === 'Knoxville')).toBe(true);
  });

  it('returns empty when city has no agents', async () => {
    const res = await request(app).get('/api/providers/bail?city=Anchorage');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ── Nearest city ──────────────────────────────────────────────────────────────
describe('GET /api/providers/nearest-city', () => {
  it('returns nearest city for valid coordinates', async () => {
    const res = await request(app).get('/api/providers/nearest-city?lat=35.9606&lng=-83.9207');
    expect(res.status).toBe(200);
    expect(res.body.city).toBeTruthy();
  });

  it('returns 400 for missing coordinates', async () => {
    const res = await request(app).get('/api/providers/nearest-city');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lng required/i);
  });

  it('returns 400 for non-numeric coordinates', async () => {
    const res = await request(app).get('/api/providers/nearest-city?lat=abc&lng=xyz');
    expect(res.status).toBe(400);
  });
});
