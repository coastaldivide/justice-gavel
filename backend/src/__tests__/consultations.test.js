/**
 * consultations.test.js — Booking, slots, cancel, double-book prevention
 */
import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { makeTestDb } from './helpers/sqliteHelper.js';

const SECRET = process.env.JWT_SECRET;
const tok = (id=1) => jwt.sign({ id, role:'user' }, SECRET, { expiresIn:'1h' });
const safeInt = (v, d=0) => { const n=parseInt(v,10); return isNaN(n)?d:n; };

async function buildSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS consultation_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      lawyer_id TEXT, lawyer_name TEXT NOT NULL,
      lawyer_phone TEXT DEFAULT '',
      date_slot TEXT NOT NULL, time_slot TEXT NOT NULL,
      duration_min INTEGER DEFAULT 30,
      platform_fee_cents INTEGER DEFAULT 1500,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'confirmed',
      stripe_pi_id TEXT,
      meeting_link TEXT,
      confirmed_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

async function buildApp(db) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const FEE = { 15:1000, 30:1500, 60:2500 };

  function auth(req, res, next) {
    const t=(req.headers.authorization||'').replace('Bearer ','');
    if (!t) return res.status(401).json({ error:'missing token' });
    try { req.user=jwt.verify(t,SECRET); next(); }
    catch { res.status(401).json({ error:'invalid token' }); }
  }

  function generateSlots() {
    const slots=[], TIMES=['9:00 AM','10:00 AM','11:00 AM'];
    for (let d=1; d<=3; d++) {
      const date=new Date(); date.setDate(date.getDate()+d);
      if (date.getDay()===0) continue;
      slots.push({ date:date.toISOString().split('T')[0], times:TIMES.map(t=>({time:t,available:true})) });
    }
    return slots;
  }

  router.get('/slots/:lawyerId', async (req, res) => {
    try { res.json({ lawyer_id:req.params.lawyerId, slots:generateSlots() }); }
    catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.get('/', auth, async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM consultation_bookings WHERE user_id=? ORDER BY date_slot DESC', [req.user.id]);
      res.json(rows);
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.post('/book', auth, async (req, res) => {
    const { lawyer_name, date_slot, time_slot, duration_min=30, notes='' } = req.body;
    if (!lawyer_name?.trim()) return res.status(400).json({ error:'lawyer_name required' });
    if (!date_slot)           return res.status(400).json({ error:'date_slot required' });
    if (!time_slot)           return res.status(400).json({ error:'time_slot required' });
    const feeCents = FEE[duration_min]??1500;
    try {
      const conflict = await db.get(
        `SELECT id FROM consultation_bookings WHERE user_id=? AND date_slot=? AND time_slot=? AND status NOT IN ('cancelled')`,
        [req.user.id, date_slot, time_slot]
      );
      if (conflict) return res.status(409).json({ error:'You already have a booking at this time.' });
      const meetingLink = `https://meet.justicegavel.app/consult/${Math.random().toString(36).slice(2,10).toUpperCase()}`;
      const result = await db.run(
        `INSERT INTO consultation_bookings (user_id, lawyer_name, date_slot, time_slot, duration_min, platform_fee_cents, notes, status, stripe_pi_id, meeting_link, confirmed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        [req.user.id, lawyer_name.trim(), date_slot, time_slot, duration_min, feeCents, notes.trim(), 'confirmed','pi_mock_consult', meetingLink]
      );
      const booking = await db.get('SELECT * FROM consultation_bookings WHERE id=?', [result.lastID]);
      res.json({ success:true, mock:true, booking, fee_charged:`$${(feeCents/100).toFixed(2)}` });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  router.post('/:id/cancel', auth, async (req, res) => {
    try {
      const booking = await db.get('SELECT * FROM consultation_bookings WHERE id=? AND user_id=?',
        [safeInt(req.params.id), req.user.id]);
      if (!booking) return res.status(404).json({ error:'Booking not found' });
      if (booking.status==='cancelled') return res.status(400).json({ error:'Already cancelled' });
      await db.run("UPDATE consultation_bookings SET status='cancelled' WHERE id=?", [safeInt(req.params.id)]);
      res.json({ success:true, message:'Booking cancelled.' });
    } catch { res.status(500).json({ error:'Server error.' }); }
  });

  app.use('/consultations', router);
  return app;
}

describe('GET /consultations/slots/:lawyerId', () => {
  let app;
  beforeAll(async () => { const db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('returns slot structure without auth', async () => {
    const r = await request(app).get('/consultations/slots/123');
    expect(r.status).toBe(200);
    expect(r.body.lawyer_id).toBe('123');
    expect(Array.isArray(r.body.slots)).toBe(true);
    expect(r.body.slots[0]).toHaveProperty('date');
    expect(r.body.slots[0]).toHaveProperty('times');
  });
  test('no Sundays in slots', async () => {
    const r = await request(app).get('/consultations/slots/1');
    for (const slot of r.body.slots) {
      expect(new Date(slot.date + 'T12:00:00').getDay()).not.toBe(0);
    }
  });
});

describe('POST /consultations/book', () => {
  let app, db;
  beforeAll(async () => { db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('401 without token', async () => {
    const r = await request(app).post('/consultations/book').send({ lawyer_name:'A', date_slot:'2026-06-01', time_slot:'9:00 AM' });
    expect(r.status).toBe(401);
  });
  test('400 without lawyer_name', async () => {
    const r = await request(app).post('/consultations/book').set('Authorization',`Bearer ${tok()}`).send({ date_slot:'2026-06-01', time_slot:'9:00 AM' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/lawyer_name/);
  });
  test('400 without date_slot', async () => {
    const r = await request(app).post('/consultations/book').set('Authorization',`Bearer ${tok()}`).send({ lawyer_name:'Bob', time_slot:'9:00 AM' });
    expect(r.status).toBe(400);
  });
  test('201 creates booking successfully', async () => {
    const r = await request(app).post('/consultations/book').set('Authorization',`Bearer ${tok()}`)
      .send({ lawyer_name:'Alice Atty', date_slot:'2026-06-15', time_slot:'10:00 AM', duration_min:30 });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.booking).toHaveProperty('id');
    expect(r.body.booking.status).toBe('confirmed');
    expect(r.body.fee_charged).toBe('$15.00');
  });
  test('409 double-booking same slot', async () => {
    await request(app).post('/consultations/book').set('Authorization',`Bearer ${tok(2)}`)
      .send({ lawyer_name:'Bob Bail', date_slot:'2026-07-01', time_slot:'2:00 PM' });
    const r = await request(app).post('/consultations/book').set('Authorization',`Bearer ${tok(2)}`)
      .send({ lawyer_name:'Carol Counsel', date_slot:'2026-07-01', time_slot:'2:00 PM' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already have a booking/i);
  });
  test('fee scales with duration', async () => {
    const r60 = await request(app).post('/consultations/book').set('Authorization',`Bearer ${tok(3)}`)
      .send({ lawyer_name:'Dan Def', date_slot:'2026-08-01', time_slot:'11:00 AM', duration_min:60 });
    expect(r60.body.fee_charged).toBe('$25.00');
    const r15 = await request(app).post('/consultations/book').set('Authorization',`Bearer ${tok(3)}`)
      .send({ lawyer_name:'Dan Def', date_slot:'2026-08-01', time_slot:'1:00 PM', duration_min:15 });
    expect(r15.body.fee_charged).toBe('$10.00');
  });
  test('meeting_link is included in booking', async () => {
    const r = await request(app).post('/consultations/book').set('Authorization',`Bearer ${tok(4)}`)
      .send({ lawyer_name:'Eve', date_slot:'2026-09-01', time_slot:'3:00 PM' });
    expect(r.body.booking.meeting_link).toContain('meet.justicegavel.app');
  });
});

describe('GET /consultations + POST cancel', () => {
  let app, db;
  beforeAll(async () => { db=await makeTestDb(); await buildSchema(db); app=await buildApp(db); });

  test('GET / returns only own bookings', async () => {
    await db.run("INSERT INTO consultation_bookings (user_id, lawyer_name, date_slot, time_slot) VALUES (1,'A','2026-05-01','9:00 AM')");
    await db.run("INSERT INTO consultation_bookings (user_id, lawyer_name, date_slot, time_slot) VALUES (2,'B','2026-05-01','9:00 AM')");
    const r = await request(app).get('/consultations').set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    expect(r.body.every(b => b.user_id === 1)).toBe(true);
  });
  test('POST /:id/cancel cancels booking', async () => {
    const row = await db.get("SELECT id FROM consultation_bookings WHERE user_id=1 LIMIT 1");
    const r = await request(app).post(`/consultations/${row.id}/cancel`).set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(200);
    const updated = await db.get('SELECT status FROM consultation_bookings WHERE id=?', [row.id]);
    expect(updated.status).toBe('cancelled');
  });
  test('POST /:id/cancel 400 on already-cancelled', async () => {
    const row = await db.get("SELECT id FROM consultation_bookings WHERE user_id=1 AND status='cancelled' LIMIT 1");
    const r = await request(app).post(`/consultations/${row.id}/cancel`).set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already cancelled/i);
  });
  test('POST /:id/cancel 404 for another user booking', async () => {
    const row = await db.get("SELECT id FROM consultation_bookings WHERE user_id=2 LIMIT 1");
    const r = await request(app).post(`/consultations/${row.id}/cancel`).set('Authorization',`Bearer ${tok(1)}`);
    expect(r.status).toBe(404);
  });
});
