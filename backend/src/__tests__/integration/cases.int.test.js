/**
 * cases.int.test.js — /api/cases CRUD, the court-date round trip, timeline
 * events and sharing, against real Postgres. Includes the IDOR matrix
 * (another signed-in user can never read or change my case) and the
 * invalid-body → 4xx paths the app relies on.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('cases routes (real Postgres)', () => {
  const ctx = initSuite();

  let owner, stranger;
  beforeAll(async () => {
    if (!ctx.app) return;
    owner = await ctx.register({ displayName: 'Case Owner' });
    stranger = await ctx.register({ displayName: 'Stranger' });
  });

  async function createCase(body = {}) {
    const res = await ctx.request().post('/api/cases').set(owner.headers)
      .send({ title: `${ctx.tag} case ${Math.random().toString(36).slice(2)}`, ...body });
    expect(res.status).toBe(201);
    return res.body;
  }

  it('creates a case with a court date and reads it back as the same calendar day', async () => {
    const cas = await createCase({ next_court_date: '2027-03-05', state: 'tn', notes: 'secret notes' });
    expect(cas).toMatchObject({ status: 'Open', state: 'TN' });
    expect(String(cas.next_court_date)).toContain('2027-03-05');

    // round trip through the list endpoint (plain array shape the app expects)
    const list = await ctx.request().get('/api/cases').set(owner.headers);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    const mine = list.body.find(c => c.id === cas.id);
    expect(String(mine.next_court_date)).toContain('2027-03-05');

    // DB: notes are encrypted at rest, never plaintext
    const row = await ctx.db.get('SELECT notes, next_court_date FROM cases WHERE id = ?', [cas.id]);
    expect(row.notes).not.toContain('secret notes');
    expect(String(row.next_court_date instanceof Date ? row.next_court_date.toISOString() : row.next_court_date)).toContain('2027-03-05');
  });

  it('?page= returns the paginated envelope', async () => {
    const res = await ctx.request().get('/api/cases?page=1&limit=2').set(owner.headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination.page', 1);
    expect(res.headers['x-total-count']).toBeDefined();
  });

  it('rejects impossible and malformed court dates with 400, on create and update', async () => {
    expect((await ctx.request().post('/api/cases').set(owner.headers)
      .send({ title: `${ctx.tag} bad date`, next_court_date: '2026-02-30' })).status).toBe(400);
    expect((await ctx.request().post('/api/cases').set(owner.headers)
      .send({ title: `${ctx.tag} bad date2`, next_court_date: 'March 5' })).status).toBe(400);
    const cas = await createCase();
    expect((await ctx.request().put(`/api/cases/${cas.id}`).set(owner.headers)
      .send({ next_court_date: '2026-13-01' })).status).toBe(400);
  });

  it('update changes status (writing status history) and the court date', async () => {
    const cas = await createCase({ next_court_date: '2027-01-10' });
    const upd = await ctx.request().put(`/api/cases/${cas.id}`).set(owner.headers)
      .send({ status: 'dismissed', next_court_date: '2027-02-11' });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe('Dismissed');                 // canonicalised
    expect(String(upd.body.next_court_date)).toContain('2027-02-11');

    const hist = await ctx.request().get(`/api/cases/${cas.id}/status-history`).set(owner.headers);
    expect(hist.status).toBe(200);
    expect(hist.body.history.some(h => h.old_status === 'Open' && h.new_status === 'Dismissed')).toBe(true);

    expect((await ctx.request().put(`/api/cases/${cas.id}`).set(owner.headers)
      .send({ status: 'NotAStatus' })).status).toBe(400);
    expect((await ctx.request().put(`/api/cases/${cas.id}`).set(owner.headers)
      .send({ title: '' })).status).toBe(400);
    expect((await ctx.request().post('/api/cases').set(owner.headers).send({})).status).toBe(400);
  });

  it('timeline events: add, list, delete — with a DB row behind each write', async () => {
    const cas = await createCase();
    const ev = await ctx.request().post(`/api/cases/${cas.id}/events`).set(owner.headers)
      .send({ event_type: 'hearing', title: 'Arraignment', event_date: '2027-04-01', location: 'Room 4B' });
    expect(ev.status).toBe(201);
    expect(ev.body.event).toMatchObject({ event_type: 'hearing', title: 'Arraignment' });
    expect(Number((await ctx.db.get('SELECT COUNT(*) AS n FROM case_events WHERE case_id = ?', [cas.id])).n)).toBe(1);

    const list = await ctx.request().get(`/api/cases/${cas.id}/events`).set(owner.headers);
    expect(list.status).toBe(200);
    expect(list.body.events).toHaveLength(1);

    expect((await ctx.request().post(`/api/cases/${cas.id}/events`).set(owner.headers)
      .send({ description: 'no title' })).status).toBe(400);

    const del = await ctx.request().delete(`/api/cases/${cas.id}/events/${ev.body.event.id}`).set(owner.headers);
    expect(del.status).toBe(200);
    expect(Number((await ctx.db.get('SELECT COUNT(*) AS n FROM case_events WHERE case_id = ?', [cas.id])).n)).toBe(0);
  });

  it('IDOR: a different signed-in user gets 404 on my case for every verb', async () => {
    const cas = await createCase({ next_court_date: '2027-06-01' });
    const s = stranger.headers;
    expect((await ctx.request().put(`/api/cases/${cas.id}`).set(s).send({ title: 'hijack' })).status).toBe(404);
    expect((await ctx.request().delete(`/api/cases/${cas.id}`).set(s)).status).toBe(404);
    expect((await ctx.request().get(`/api/cases/${cas.id}/events`).set(s)).status).toBe(404);
    expect((await ctx.request().post(`/api/cases/${cas.id}/events`).set(s).send({ title: 'x' })).status).toBe(404);
    expect((await ctx.request().post(`/api/cases/${cas.id}/share`).set(s)).status).toBe(404);
    expect((await ctx.request().post(`/api/cases/${cas.id}/invite`).set(s).send({ email: owner.email })).status).toBe(404);
    // and the stranger's list never contains it
    const list = await ctx.request().get('/api/cases').set(s);
    expect(list.body.some(c => c.id === cas.id)).toBe(false);
    // untouched in the DB
    const row = await ctx.db.get('SELECT title, deleted_at FROM cases WHERE id = ?', [cas.id]);
    expect(row.deleted_at).toBeNull();
    expect(row.title).not.toBe('hijack');
  });

  it('share link: token grants public read of the safe fields only, revoke kills it', async () => {
    const cas = await createCase({ next_court_date: '2027-07-04', notes: 'privileged' });
    const share = await ctx.request().post(`/api/cases/${cas.id}/share`).set(owner.headers);
    expect(share.status).toBe(200);
    expect(share.body.token).toMatch(/^[0-9a-f]{64}$/);

    const pub = await ctx.request().get(`/api/cases/shared/${share.body.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.title).toBe(cas.title);
    expect(pub.body.notes).toBeUndefined();          // notes never leak through a share link
    expect(pub.body.user_id).toBeUndefined();

    expect((await ctx.request().get('/api/cases/shared/doesnotexist')).status).toBe(404);

    const revoke = await ctx.request().delete(`/api/cases/${cas.id}/share`).set(owner.headers);
    expect(revoke.status).toBe(200);
    expect((await ctx.request().get(`/api/cases/shared/${share.body.token}`)).status).toBe(404);
  });

  it('delete soft-deletes (deleted_at) and the case leaves the list', async () => {
    const cas = await createCase();
    const del = await ctx.request().delete(`/api/cases/${cas.id}`).set(owner.headers);
    expect(del.status).toBe(200);
    const row = await ctx.db.get('SELECT deleted_at FROM cases WHERE id = ?', [cas.id]);
    expect(row.deleted_at).not.toBeNull();
    const list = await ctx.request().get('/api/cases').set(owner.headers);
    expect(list.body.some(c => c.id === cas.id)).toBe(false);
  });

  it('requires auth: 401 without a token', async () => {
    expect((await ctx.request().get('/api/cases')).status).toBe(401);
    expect((await ctx.request().post('/api/cases').send({ title: 'x' })).status).toBe(401);
  });
});
