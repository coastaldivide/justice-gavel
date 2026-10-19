/**
 * review_regressions.int.test.js — bugs found by the independent review of the
 * core path (court dates, family followers) and the checklist work, replayed
 * against the real app on real Postgres.
 *
 *   R1  parallel re-plans of one hearing (double-tapped save, PATCH racing the
 *       backfill / a time-zone reschedule) left 5–8 pending copies of every
 *       reminder → the person got the same court reminder many times.
 *       Fixed: per-hearing advisory lock (courtReminders.withHearingLock).
 *   R2  the family invite code — a one-time secret stored only as a SHA-256 —
 *       was written in plain text to idempotency_keys.response_body (24 h).
 *       Fixed: the route sets res.locals.idempotencyNoStore.
 *   R3  two people accepting the same code at the same moment: the loser got
 *       201 with no follow and follower reminders were planned for them.
 *       Fixed: the accepting UPDATE must win (RETURNING) or 404.
 *   R4  account deletion left the user's idempotency rows (cached response
 *       bodies: case titles, court dates) and kept listing reports keyed by
 *       sha256("u:<id>") — a reversible pseudonym. Fixed: migration 21
 *       idempotency_keys.user_id + USER_REFS; reporter_key replaced.
 */
import { createHash } from 'crypto';
import { describeIntegration, initSuite } from './_harness.js';

const dayPlus = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describeIntegration('independent review regressions (real Postgres)', () => {
  const ctx = initSuite();
  const reportIds = [];
  beforeAll(() => {
    ctx.addCleanup(async (db) => {
      if (reportIds.length) await db.run(`DELETE FROM listing_reports WHERE id IN (${reportIds.map(() => '?').join(',')})`, reportIds);
    });
  });

  it('R1: eight parallel saves of one hearing leave exactly one 7d / 3d / 1d / morning-of set', async () => {
    const u = await ctx.register({ displayName: 'Race Owner' });
    const cd = await ctx.request().post('/api/court-dates').set({ ...u.headers, 'X-Timezone': 'America/New_York' })
      .send({ case_title: `${ctx.tag} race`, court_date: dayPlus(15), court_time: '08:00' });
    expect(cd.status).toBe(201);
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      ctx.request().patch(`/api/court-dates/${cd.body.id}`).set(u.headers).send({ location: `Room ${i}` })));
    expect(rs.map(r => r.status)).toEqual(Array(8).fill(200));
    const rows = await ctx.db.all(
      `SELECT data FROM scheduled_pushes WHERE court_date_id = ? AND notification_type = 'court_reminder' AND status = 'pending'`, [cd.body.id]);
    expect(rows.map(r => JSON.parse(r.data).days_before).sort()).toEqual([0, 1, 3, 7]);
  });

  it('R2 + R3: the invite code never reaches idempotency_keys, and a code raced by six people has one winner', async () => {
    const owner = await ctx.register({ displayName: 'Code Owner' });
    const cd = await ctx.request().post('/api/court-dates').set(owner.headers)
      .send({ case_title: `${ctx.tag} follow`, court_date: dayPlus(20) });
    const key = `${ctx.tag}-invite-1`;
    const inv = await ctx.request().post(`/api/cases/${cd.body.case_id}/followers`).set({ ...owner.headers, 'Idempotency-Key': key })
      .send({ consent: true, name: 'Mom' });
    expect(inv.status).toBe(201);
    const code = inv.body.invite_code;
    const leaked = await ctx.db.get(`SELECT COUNT(*) AS n FROM idempotency_keys WHERE response_body LIKE ?`, [`%${code}%`]);
    expect(Number(leaked.n)).toBe(0);

    const racers = [];
    for (let i = 0; i < 6; i++) racers.push(await ctx.register({ displayName: `Racer ${i}` }));
    const res = await Promise.all(racers.map(r => ctx.request().post('/api/following/accept').set(r.headers).send({ code })));
    const winners = res.filter(r => r.status === 201);
    expect(winners).toHaveLength(1);
    expect(winners[0].body.following.case_id).toBe(cd.body.case_id);
    expect(res.filter(r => r.status !== 201).every(r => r.status === 404)).toBe(true);
    const ids = racers.map(r => r.user.id);
    const withReminders = await ctx.db.all(
      `SELECT DISTINCT user_id FROM scheduled_pushes WHERE notification_type = 'follower_court_reminder' AND status = 'pending'
          AND user_id IN (${ids.map(() => '?').join(',')})`, ids);
    expect(withReminders).toHaveLength(1);
    const active = await ctx.db.get(`SELECT COUNT(*) AS n FROM case_family_access WHERE case_id = ? AND status = 'active'`, [cd.body.case_id]);
    expect(Number(active.n)).toBe(1);
  });

  it('R4: account deletion removes the user\'s idempotency rows and unlinks their listing reports', async () => {
    const u = await ctx.register({ displayName: 'Leaving Reporter' });
    const cd = await ctx.request().post('/api/court-dates').set({ ...u.headers, 'Idempotency-Key': `${ctx.tag}-cd-1` })
      .send({ case_title: `${ctx.tag} PRIVATE CASE TITLE`, court_date: dayPlus(9) });
    expect(cd.status).toBe(201);
    const lawyer = await ctx.db.get('SELECT id FROM lawyers ORDER BY id DESC LIMIT 1');
    const rep = await ctx.request().post('/api/help/reports').set({ ...u.headers, 'Idempotency-Key': `${ctx.tag}-rep-1` })
      .send({ provider_type: 'lawyer', provider_id: lawyer.id, reason: 'closed' });
    expect(rep.status).toBe(201);
    reportIds.push(rep.body.report_id);
    // the middleware stores the response just after it is sent: wait for it
    let mine = 0;
    for (let i = 0; i < 50 && mine < 2; i++) {
      mine = Number((await ctx.db.get('SELECT COUNT(*) AS n FROM idempotency_keys WHERE user_id = ?', [u.user.id])).n);
      if (mine < 2) await new Promise(r => setTimeout(r, 50));
    }
    expect(mine).toBe(2);

    const del = await ctx.request().delete('/api/auth/account').set(u.headers).send({ password: u.password });
    expect(del.status).toBe(200);
    const left = await ctx.db.get(`SELECT COUNT(*) AS n FROM idempotency_keys WHERE key LIKE ? OR response_body LIKE ?`,
      [`${ctx.tag}-%`, `%${ctx.tag} PRIVATE CASE TITLE%`]);
    expect(Number(left.n)).toBe(0);
    const report = await ctx.db.get('SELECT reporter_user_id, reporter_key FROM listing_reports WHERE id = ?', [rep.body.report_id]);
    expect(report.reporter_user_id).toBeNull();
    const pseudonym = createHash('sha256').update(`u:${u.user.id}`).digest('hex').slice(0, 40);
    expect(report.reporter_key).not.toBe(pseudonym);
  });
});
