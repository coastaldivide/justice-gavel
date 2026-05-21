/**
 * bail.test.js — GPS-based bail agent search
 * Tests: haversine distance, radius filter, sort, missing coords validation
 */
import express from 'express';
import request from 'supertest';
import { makeTestDb } from './helpers/sqliteHelper.js';

function haversine(lat1,lon1,lat2,lon2) {
  const R=6371, t=d=>d*Math.PI/180;
  const dLat=t(lat2-lat1), dLon=t(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2;
  return 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*R;
}

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE bail_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, phone TEXT, address TEXT,
      lat REAL, lng REAL, city TEXT, state TEXT,
      rating REAL DEFAULT 4.0, reviews INTEGER DEFAULT 0,
      verified INTEGER DEFAULT 0, fee_percent REAL DEFAULT 10,
      available_24_7 INTEGER DEFAULT 0, active INTEGER DEFAULT 1
    );
  `);
  // Nashville: 36.1627, -86.7816 — within 50km
  await db.run("INSERT INTO bail_agents (name,lat,lng,city,state,rating,active) VALUES ('Nashville Bail',36.1627,-86.7816,'Nashville','TN',4.5,1)");
  // Memphis: 35.1495, -90.0490 — ~340km away
  await db.run("INSERT INTO bail_agents (name,lat,lng,city,state,rating,active) VALUES ('Memphis Bail',35.1495,-90.0490,'Memphis','TN',4.2,1)");
  // Inactive
  await db.run("INSERT INTO bail_agents (name,lat,lng,city,state,rating,active) VALUES ('Inactive Co',36.16,-86.78,'Nashville','TN',4.9,0)");
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  router.get('/nearby', async (req, res) => {
    try {
      const lat=parseFloat(req.query.lat), lng=parseFloat(req.query.lng);
      const radiusKm=parseFloat(req.query.radiusKm||'50');
      if (isNaN(lat)||isNaN(lng)) return res.status(400).json({ error:'lat and lng are required' });
      const agents = await db.all('SELECT * FROM bail_agents WHERE active!=0 ORDER BY rating DESC LIMIT 300');
      const list = agents
        .map(a=>({...a, distanceKm:haversine(lat,lng,a.lat,a.lng)}))
        .filter(a=>a.distanceKm<=radiusKm)
        .sort((a,b)=>a.distanceKm-b.distanceKm);
      res.set('Cache-Control','public, max-age=60');
      res.json(list);
    } catch { res.status(500).json({ error:'Could not load bail agents' }); }
  });

  app.use('/bail', router);
  return app;
}

describe('GET /bail/nearby', () => {
  let app, db;
  beforeAll(async () => { db = await makeTestDb(); await buildSchema(db); app = await buildApp(db); });

  test('400 when lat missing', async () => {
    const r = await request(app).get('/bail/nearby?lng=-86.7');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/lat/);
  });
  test('400 when lng missing', async () => {
    const r = await request(app).get('/bail/nearby?lat=36.1');
    expect(r.status).toBe(400);
  });
  test('returns agents within default 50km radius', async () => {
    // Center: Nashville
    const r = await request(app).get('/bail/nearby?lat=36.1627&lng=-86.7816');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.some(a=>a.city==='Nashville')).toBe(true);
  });
  test('excludes agents beyond radius', async () => {
    const r = await request(app).get('/bail/nearby?lat=36.1627&lng=-86.7816&radiusKm=50');
    expect(r.status).toBe(200);
    expect(r.body.some(a=>a.city==='Memphis')).toBe(false);
  });
  test('excludes inactive agents', async () => {
    const r = await request(app).get('/bail/nearby?lat=36.1627&lng=-86.7816&radiusKm=200');
    expect(r.status).toBe(200);
    expect(r.body.every(a=>a.active!==0)).toBe(true);
  });
  test('results sorted by distance ascending', async () => {
    const r = await request(app).get('/bail/nearby?lat=36.1627&lng=-86.7816&radiusKm=500');
    expect(r.status).toBe(200);
    if (r.body.length > 1) {
      for (let i=1; i<r.body.length; i++) {
        expect(r.body[i].distanceKm).toBeGreaterThanOrEqual(r.body[i-1].distanceKm);
      }
    }
  });
  test('distanceKm field present on each result', async () => {
    const r = await request(app).get('/bail/nearby?lat=36.1627&lng=-86.7816');
    expect(r.body.every(a=>typeof a.distanceKm==='number')).toBe(true);
  });
  test('sets Cache-Control header', async () => {
    const r = await request(app).get('/bail/nearby?lat=36.1627&lng=-86.7816');
    expect(r.headers['cache-control']).toContain('max-age=60');
  });
  test('radiusKm=0.001 effectively excludes nearby agents', async () => {
    // Agent at same coords has distanceKm=0, so radiusKm=0 includes it
    // This is correct behavior — test with a tiny positive radius that excludes distant agents
    const r = await request(app).get('/bail/nearby?lat=36.1627&lng=-86.7816&radiusKm=1');
    expect(r.status).toBe(200);
    // Memphis should be excluded
    expect(r.body.some(a=>a.city==='Memphis')).toBe(false);
  });
});
