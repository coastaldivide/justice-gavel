/**
 * alerts_takedown.test.js — authorization for arrest-record takedowns and
 * dispositions (routes/alerts.js).
 *
 * Before step 3 any signed-in user could suppress, or set the disposition of,
 * any arrest record by id. Now:
 *   - any signed-in user can only FILE a takedown request (pending review);
 *   - staff — role admin/super_admin/staff or is_admin = 1, read from the users
 *     table rather than the JWT — approve/reject requests, suppress directly and
 *     record dispositions.
 *
 * This file runs the REAL router against an in-memory fake of db/index.js.
 * alerts_takedown_pg.test.js runs the same flow on Postgres (TEST_DATABASE_URL).
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const tok = (id, role = 'user') => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });

describe('arrest takedown / disposition authorization (fake DB)', () => {
  const state = {};
  const reset = () => {
    state.users = {
      1: { role: 'user', is_admin: 0 },          // ordinary user
      2: { role: 'admin', is_admin: 0 },         // staff by role
      3: { role: 'user', is_admin: 1 },          // staff by is_admin flag
      4: { role: 'user', is_admin: 0 },          // token says admin, DB says user
      5: { role: 'user', is_admin: 0 },          // another ordinary user (own rate-limit bucket)
    };
    state.records = { 10: { id: 10, suppressed: 0, disposition: null }, 11: { id: 11, suppressed: 0, disposition: null } };
    state.log = [];
  };

  const fakeDb = {
    async get(sql, p = []) {
      if (/FROM users WHERE id = \?/.test(sql)) return state.users[p[0]] ?? undefined;
      if (/SELECT id FROM arrest_records WHERE id = \?/.test(sql)) return state.records[p[0]] ? { id: p[0] } : undefined;
      if (/FROM arrest_takedown_log WHERE arrest_id = \? AND requested_by = \? AND status = 'pending'/.test(sql)) {
        return state.log.find(r => r.arrest_id === p[0] && r.requested_by === p[1] && r.status === 'pending');
      }
      if (/SELECT id, arrest_id, status FROM arrest_takedown_log WHERE id = \?/.test(sql)) return state.log.find(r => r.id === p[0]);
      throw new Error(`unexpected get: ${sql}`);
    },
    async all(sql, p = []) {
      if (/FROM arrest_takedown_log t/.test(sql)) return state.log.filter(r => r.status === p[0]);
      throw new Error(`unexpected all: ${sql}`);
    },
    async run(sql, p = []) {
      if (/UPDATE arrest_records SET suppressed = 1/.test(sql)) {
        const rec = state.records[p[1]]; if (!rec) return { changes: 0 };
        rec.suppressed = 1; rec.suppressed_reason = p[0]; return { changes: 1 };
      }
      if (/UPDATE arrest_records SET disposition = \?/.test(sql)) {
        const rec = state.records[p[3]]; if (!rec) return { changes: 0 };
        Object.assign(rec, { disposition: p[0], disposition_date: p[1], disposition_court: p[2] }); return { changes: 1 };
      }
      if (/INSERT INTO arrest_takedown_log/.test(sql)) {
        const status = /'approved'/.test(sql) ? 'approved' : 'pending';
        const row = { id: state.log.length + 100, arrest_id: p[0], requested_by: p[2], status, reason: p[3], requestor: p[4], relationship: p[5] };
        state.log.push(row); return { lastID: row.id, changes: 1 };
      }
      if (/UPDATE arrest_takedown_log\s+SET status = \?, reviewed_by/.test(sql)) {
        const row = state.log.find(r => r.id === p[5] && r.status === 'pending'); if (!row) return { changes: 0 };
        Object.assign(row, { status: p[0], reviewed_by: p[1], review_note: p[2] }); return { changes: 1 };
      }
      throw new Error(`unexpected run: ${sql}`);
    },
  };

  let app;
  beforeAll(async () => {
    jest.unstable_mockModule('../db/index.js', () => ({ getDb: async () => fakeDb }));
    const { default: alertsRouter } = await import('../routes/alerts.js');
    app = express();
    app.use(express.json());
    app.use('/api/alerts', alertsRouter);
  });
  beforeEach(reset);

  const as = (id, role) => ({ Authorization: `Bearer ${tok(id, role)}` });

  it('requires sign-in', async () => {
    expect((await request(app).delete('/api/alerts/record/10')).status).toBe(401);
    expect((await request(app).post('/api/alerts/record/10/disposition').send({ disposition: 'dismissed' })).status).toBe(401);
    expect((await request(app).get('/api/alerts/takedown-requests')).status).toBe(401);
  });

  it('an ordinary user can only file a pending request — the record is not suppressed', async () => {
    const noReason = await request(app).delete('/api/alerts/record/10').set(as(1));
    expect(noReason.status).toBe(400);

    const r = await request(app).delete('/api/alerts/record/10').set(as(1))
      .send({ reason: 'This is me; the charge was dismissed.', relationship: 'self', contact: 'me@example.com' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'pending', success: true });
    expect(state.records[10].suppressed).toBe(0);
    expect(state.log).toHaveLength(1);
    expect(state.log[0]).toMatchObject({ arrest_id: 10, requested_by: 1, status: 'pending', relationship: 'self', requestor: 'me@example.com' });

    const again = await request(app).delete('/api/alerts/record/10').set(as(1)).send({ reason: 'again' });
    expect(again.status).toBe(202);
    expect(again.body.duplicate).toBe(true);
    expect(state.log).toHaveLength(1);
  });

  it('404 for an unknown record, 400 for a bad id', async () => {
    expect((await request(app).delete('/api/alerts/record/999').set(as(1)).send({ reason: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/alerts/record/abc').set(as(1)).send({ reason: 'x' })).status).toBe(400);
  });

  it('a role claim in the token is not trusted: the users table decides', async () => {
    const r = await request(app).delete('/api/alerts/record/10').set(as(4, 'admin')).send({ reason: 'please remove' });
    expect(r.status).toBe(202);
    expect(state.records[10].suppressed).toBe(0);
  });

  it('staff (by role or is_admin) suppress immediately, with an audit row', async () => {
    const r = await request(app).delete('/api/alerts/record/10').set(as(2, 'admin'));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('suppressed');
    expect(state.records[10].suppressed).toBe(1);
    expect(state.log[0]).toMatchObject({ arrest_id: 10, requested_by: 2, status: 'approved' });

    const r2 = await request(app).delete('/api/alerts/record/11').set(as(3));
    expect(r2.status).toBe(200);
    expect(state.records[11].suppressed).toBe(1);
  });

  it('only staff see the review queue and approve / reject', async () => {
    // the takedown limiter allows 5 requests / hour per user; user 1 used its quota above
    expect((await request(app).delete('/api/alerts/record/10').set(as(5)).send({ reason: 'mine' })).status).toBe(202);
    expect((await request(app).delete('/api/alerts/record/11').set(as(5)).send({ reason: 'also mine' })).status).toBe(202);
    const [first, second] = state.log;

    expect((await request(app).get('/api/alerts/takedown-requests').set(as(5))).status).toBe(403);
    expect((await request(app).get('/api/alerts/takedown-requests').set(as(4, 'admin'))).status).toBe(403);
    const q = await request(app).get('/api/alerts/takedown-requests').set(as(2, 'admin'));
    expect(q.status).toBe(200);
    expect(q.body.requests.map(x => x.id)).toEqual([first.id, second.id]);

    expect((await request(app).post(`/api/alerts/takedown-requests/${first.id}/approve`).set(as(5))).status).toBe(403);
    expect(state.records[10].suppressed).toBe(0);

    const ok = await request(app).post(`/api/alerts/takedown-requests/${first.id}/approve`).set(as(2, 'admin')).send({ note: 'verified ID' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', arrest_id: 10 });
    expect(state.records[10].suppressed).toBe(1);
    expect(first).toMatchObject({ status: 'approved', reviewed_by: 2, review_note: 'verified ID' });
    expect((await request(app).post(`/api/alerts/takedown-requests/${first.id}/approve`).set(as(2, 'admin'))).status).toBe(409);

    const no = await request(app).post(`/api/alerts/takedown-requests/${second.id}/reject`).set(as(3)).send({ note: 'not the subject' });
    expect(no.status).toBe(200);
    expect(second.status).toBe('rejected');
    expect(state.records[11].suppressed).toBe(0);
    expect((await request(app).post('/api/alerts/takedown-requests/12345/approve').set(as(2, 'admin'))).status).toBe(404);
  });

  it('dispositions: staff only, validated, 404 for a missing record', async () => {
    const denied = await request(app).post('/api/alerts/record/10/disposition').set(as(1)).send({ disposition: 'dismissed' });
    expect(denied.status).toBe(403);
    expect(state.records[10].disposition).toBeNull();
    expect((await request(app).post('/api/alerts/record/10/disposition').set(as(4, 'admin')).send({ disposition: 'dismissed' })).status).toBe(403);

    expect((await request(app).post('/api/alerts/record/10/disposition').set(as(2, 'admin')).send({ disposition: 'nope' })).status).toBe(400);
    expect((await request(app).post('/api/alerts/record/10/disposition').set(as(2, 'admin')).send({ disposition: 'dismissed', disposition_date: '03/01/2026' })).status).toBe(400);
    expect((await request(app).post('/api/alerts/record/999/disposition').set(as(2, 'admin')).send({ disposition: 'dismissed' })).status).toBe(404);

    const ok = await request(app).post('/api/alerts/record/10/disposition').set(as(3))
      .send({ disposition: 'dismissed', disposition_date: '2026-03-01', court: 'Davidson County General Sessions' });
    expect(ok.status).toBe(200);
    expect(state.records[10]).toMatchObject({ disposition: 'dismissed', disposition_date: '2026-03-01', disposition_court: 'Davidson County General Sessions' });
  });
});
