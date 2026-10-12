/**
 * audit11 H1 — POST /api/checkins/remind-all is scheduler/staff only.
 * audit11 H2 — check-in status/history routes require auth + ownership
 * (the enrolling bondsman, the enrolled defendant, or staff); enrollment ids
 * are not enumerable and defendants' PII is not public.
 */
import { describeIntegration, initSecuritySuite, leaks } from './_world.js';

describeIntegration('H1/H2 — check-in routes', () => {
  const ctx = initSecuritySuite();
  let bondsman, defendant, stranger, staff, enrollmentId;

  beforeAll(async () => {
    if (!ctx.app) return;
    process.env.ADMIN_KEY = 'test-admin-key-0123456789abcdef';
    bondsman  = await ctx.persona('BondsmanB');
    defendant = await ctx.persona('Defendant');
    stranger  = await ctx.persona('Stranger');
    staff     = await ctx.persona('Ops', { role: 'admin' });
    const r = await ctx.request().post('/api/checkins/enroll').set(bondsman.headers).send({
      defendant_name: 'Dee Fendant', defendant_phone: '615-555-0199', defendant_email: defendant.email,
      case_number: '2026-CR-777', court_date: '2026-12-01',
    });
    expect(r.status).toBe(200);
    enrollmentId = r.body.enrollment.id;
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM checkin_records WHERE enrollment_id = ?', [enrollmentId]).catch(() => {});
      await db.run('DELETE FROM checkin_enrollments WHERE id = ?', [enrollmentId]);
    });
  });

  it('H1 ATTACK: anonymous / ordinary users cannot trigger the reminder blast', async () => {
    expect((await ctx.request().post('/api/checkins/remind-all')).status).toBe(401);
    expect((await ctx.request().post('/api/checkins/remind-all').set('X-Admin-Key', 'wrong-key-0123456789abcdef0000')).status).toBe(401);
    expect((await ctx.request().post('/api/checkins/remind-all').set(stranger.headers)).status).toBe(403);
  });

  it('H1 LEGIT: staff (or the scheduler with the admin key) can run it', async () => {
    const r = await ctx.request().post('/api/checkins/remind-all').set(staff.headers);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(expect.objectContaining({ reminded: expect.any(Number), total_due: expect.any(Number) }));
    const k = await ctx.request().post('/api/checkins/remind-all').set('X-Admin-Key', process.env.ADMIN_KEY);
    expect(k.status).toBe(200);
  });

  it('H2 ATTACK: status/history are not public and not readable by other users', async () => {
    for (const path of [`/api/checkins/status/${enrollmentId}`, `/api/checkins/my/${enrollmentId}`]) {
      const anon = await ctx.request().get(path);
      expect(anon.status).toBe(401);
      expect(leaks(anon, '615-555-0199')).toBe(false);
      const s = await ctx.request().get(path).set(stranger.headers);
      expect(s.status).toBe(404);
      expect(leaks(s, 'Dee Fendant')).toBe(false);
      expect(leaks(s, '2026-CR-777')).toBe(false);
    }
    // a stranger cannot check in for, or annotate, someone else's enrollment
    expect((await ctx.request().post('/api/checkins/submit').set(stranger.headers).send({ enrollment_id: enrollmentId })).status).toBe(404);
    expect((await ctx.request().patch(`/api/checkins/enrollments/${enrollmentId}/note`).set(stranger.headers).send({ note: 'x' })).status).toBe(404);
    const row = await ctx.db.get('SELECT user_id, supervisor_note FROM checkin_enrollments WHERE id = ?', [enrollmentId]);
    expect(row.user_id).toBeNull();
    expect(row.supervisor_note).toBeNull();
  });

  it('H2 LEGIT: the defendant (matched by account email) sees their own status and checks in', async () => {
    const s = await ctx.request().get(`/api/checkins/status/${enrollmentId}`).set(defendant.headers);
    expect(s.status).toBe(200);
    expect(s.body.enrollment.defendant_name).toBe('Dee Fendant');
    expect(s.body.enrollment.stripe_sub_id).toBeUndefined();   // billing internals stay with the bondsman
    const linked = await ctx.db.get('SELECT user_id FROM checkin_enrollments WHERE id = ?', [enrollmentId]);
    expect(Number(linked.user_id)).toBe(defendant.id);
    const sub = await ctx.request().post('/api/checkins/submit').set(defendant.headers).send({ enrollment_id: enrollmentId, notes: 'Home' });
    expect(sub.status).toBe(200);
    const my = await ctx.request().get(`/api/checkins/my/${enrollmentId}`).set(defendant.headers);
    expect(my.status).toBe(200);
    // once linked, a later account with the same contact cannot take it over
    expect((await ctx.request().get(`/api/checkins/status/${enrollmentId}`).set(stranger.headers)).status).toBe(404);
  });

  it('H2 LEGIT: the bondsman and staff still see the full enrollment', async () => {
    const b = await ctx.request().get(`/api/checkins/status/${enrollmentId}`).set(bondsman.headers);
    expect(b.status).toBe(200);
    expect(b.body.enrollment.defendant_phone).toBe('615-555-0199');
    expect((await ctx.request().get(`/api/checkins/history/${enrollmentId}`).set(bondsman.headers)).status).toBe(200);
    expect((await ctx.request().get(`/api/checkins/status/${enrollmentId}`).set(staff.headers)).status).toBe(200);
    expect((await ctx.request().patch(`/api/checkins/enrollments/${enrollmentId}/note`).set(bondsman.headers).send({ note: 'ok' })).status).toBe(200);
  });
});
