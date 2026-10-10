/**
 * alerts_takedown_pg.test.js — the arrest takedown / disposition flow
 * (routes/alerts.js) against Postgres with all supabase/migrations applied.
 * Set TEST_DATABASE_URL to run it (CI does); skipped otherwise. The fake-DB
 * authorization matrix is in alerts_takedown.test.js.
 *
 * Inserts its own users / arrest row (unique tag) and deletes them afterwards.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const tok = (id, role = 'user') => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });

const PG_URL = process.env.TEST_DATABASE_URL || '';
const describePg = PG_URL ? describe : describe.skip;

describePg('arrest takedown flow on Postgres (real router + migrations)', () => {
  const TAG = `ZZTakedown${Date.now()}`;
  let db; let app; const ids = {};

  beforeAll(async () => {
    process.env.DATABASE_URL = PG_URL;
    ({ getDb: db } = await import('../db/index.js'));
    db = await db();
    const user = async (suffix, role, isAdmin = 0) => Number((await db.get(
      `INSERT INTO users (email, name, role, is_admin) VALUES (?, ?, ?, ?) RETURNING id`,
      [`${TAG.toLowerCase()}-${suffix}@example.test`, `${TAG} ${suffix}`, role, isAdmin]
    )).id);
    ids.user  = await user('user', 'user');
    ids.admin = await user('admin', 'admin');
    ids.flag  = await user('flag', 'user', 1);
    ids.record = Number((await db.get(
      `INSERT INTO arrest_records (name, booking_date, charges, county, state, source, case_number, suppressed)
       VALUES (?, NOW(), 'Test charge', 'Zedcounty', 'TN', 'county_roster', ?, 0) RETURNING id`,
      [`${TAG} Person`, `${TAG}-1`]
    )).id);
    const { default: alertsRouter } = await import('../routes/alerts.js');
    app = express();
    app.use(express.json());
    app.use('/api/alerts', alertsRouter);
  });

  afterAll(async () => {
    if (!db) return;
    await db.run('DELETE FROM arrest_takedown_log WHERE arrest_id = ?', [ids.record]).catch(() => {});
    await db.run('DELETE FROM arrest_records WHERE case_number LIKE ?', [`${TAG}%`]).catch(() => {});
    await db.run('DELETE FROM users WHERE email LIKE ?', [`${TAG.toLowerCase()}-%`]).catch(() => {});
    const { closeDb } = await import('../db/index.js');
    await closeDb();
  });

  const as = (id, role = 'user') => ({ Authorization: `Bearer ${tok(id, role)}` });
  const suppressed = async () => Number((await db.get('SELECT suppressed FROM arrest_records WHERE id = ?', [ids.record])).suppressed);

  it('user request stays pending; staff approval suppresses; disposition is staff-only', async () => {
    const req1 = await request(app).delete(`/api/alerts/record/${ids.record}`).set(as(ids.user, 'admin'))
      .send({ reason: 'This is my record and the case was dismissed.', relationship: 'self' });
    expect(req1.status).toBe(202);
    expect(await suppressed()).toBe(0);

    const dup = await request(app).delete(`/api/alerts/record/${ids.record}`).set(as(ids.user)).send({ reason: 'again' });
    expect(dup.body.duplicate).toBe(true);
    const pending = await db.all(`SELECT id, status, taken_down_at FROM arrest_takedown_log WHERE arrest_id = ?`, [ids.record]);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
    expect(pending[0].taken_down_at).toBeNull();

    expect((await request(app).post(`/api/alerts/takedown-requests/${pending[0].id}/approve`).set(as(ids.user, 'admin'))).status).toBe(403);
    const queue = await request(app).get('/api/alerts/takedown-requests').set(as(ids.admin, 'admin'));
    expect(queue.status).toBe(200);
    expect(queue.body.requests.some(r => Number(r.id) === Number(pending[0].id))).toBe(true);

    const ok = await request(app).post(`/api/alerts/takedown-requests/${pending[0].id}/approve`).set(as(ids.flag)).send({ note: 'ID checked' });
    expect(ok.status).toBe(200);
    expect(await suppressed()).toBe(1);
    const done = await db.get('SELECT status, reviewed_by, review_note, taken_down_at FROM arrest_takedown_log WHERE id = ?', [pending[0].id]);
    expect(done).toMatchObject({ status: 'approved', review_note: 'ID checked' });
    expect(Number(done.reviewed_by)).toBe(ids.flag);
    expect(done.taken_down_at).not.toBeNull();

    expect((await request(app).post(`/api/alerts/record/${ids.record}/disposition`).set(as(ids.user, 'admin')).send({ disposition: 'dismissed' })).status).toBe(403);
    const disp = await request(app).post(`/api/alerts/record/${ids.record}/disposition`).set(as(ids.admin, 'admin'))
      .send({ disposition: 'dismissed', disposition_date: '2026-03-01', court: 'General Sessions' });
    expect(disp.status).toBe(200);
    const rec = await db.get('SELECT disposition, disposition_date, disposition_court FROM arrest_records WHERE id = ?', [ids.record]);
    expect(rec).toMatchObject({ disposition: 'dismissed', disposition_date: '2026-03-01', disposition_court: 'General Sessions' });
  });
});
