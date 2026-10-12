/**
 * saved_reviews.int.test.js — /api/saved/lawyers (the personal contact list)
 * and /api/reviews (app reviews) against real Postgres. Review writes go to
 * the `reviews` table only — the verified lawyer rows are read, never changed.
 */
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('saved lawyers + reviews (real Postgres)', () => {
  const ctx = initSuite();

  let user, other, lawyerId, lawyerName, lawyerRowBefore;
  beforeAll(async () => {
    if (!ctx.app) return;
    user  = await ctx.register({ displayName: 'Saver' });
    other = await ctx.register({ displayName: 'Other Saver' });
    const row = await ctx.db.get(`SELECT id, name, phone, rating, reviews FROM lawyers WHERE city = 'Nashville' AND (active = 1 OR active IS NULL) ORDER BY id LIMIT 1`);
    lawyerId = Number(row.id);
    lawyerName = row.name;
    lawyerRowBefore = { name: row.name, phone: row.phone, rating: row.rating, reviews: row.reviews };
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM reviews WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [`${ctx.tag}-%@it.example.test`]);
    });
  });

  it('save by lawyer_id only — the snapshot is filled from the directory row', async () => {
    const res = await ctx.request().post('/api/saved/lawyers').set(user.headers).send({ lawyer_id: lawyerId });
    expect(res.status).toBe(201);
    expect(res.body.saved).toBe(true);

    const list = await ctx.request().get('/api/saved/lawyers').set(user.headers);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    const saved = list.body[0];
    expect(saved.name).toBe(lawyerName);               // real name, not '' / boolean (step-2 bug)
    expect(Number(saved.provider_id)).toBe(lawyerId);
    expect(Array.isArray(saved.specialties)).toBe(true);

    // saving again is idempotent
    const again = await ctx.request().post('/api/saved/lawyers').set(user.headers).send({ lawyer_id: lawyerId });
    expect(again.status).toBe(201);
    expect(again.body.already_saved).toBe(true);
    expect(Number((await ctx.db.get('SELECT COUNT(*) AS n FROM saved_lawyers WHERE user_id = ?', [user.user.id])).n)).toBe(1);
  });

  it('saved list is per-user; delete removes only my row; invalid id → 400', async () => {
    const otherList = await ctx.request().get('/api/saved/lawyers').set(other.headers);
    expect(otherList.body).toHaveLength(0);

    const mine = await ctx.request().get('/api/saved/lawyers').set(user.headers);
    const savedId = mine.body[0].id;

    // another user "deleting" my saved row must not remove it
    expect((await ctx.request().delete(`/api/saved/lawyers/${savedId}`).set(other.headers)).status).toBe(200);
    expect(Number((await ctx.db.get('SELECT COUNT(*) AS n FROM saved_lawyers WHERE id = ?', [savedId])).n)).toBe(1);

    expect((await ctx.request().delete('/api/saved/lawyers/abc').set(user.headers)).status).toBe(400);
    expect((await ctx.request().delete(`/api/saved/lawyers/${savedId}`).set(user.headers)).status).toBe(200);
    expect(Number((await ctx.db.get('SELECT COUNT(*) AS n FROM saved_lawyers WHERE id = ?', [savedId])).n)).toBe(0);
  });

  it('save without a name or id → 400; unauthenticated → 401', async () => {
    expect((await ctx.request().post('/api/saved/lawyers').set(user.headers).send({})).status).toBe(400);
    expect((await ctx.request().get('/api/saved/lawyers')).status).toBe(401);
  });

  it('review round trip: POST writes to reviews only; GET + summary aggregate it', async () => {
    const post = await ctx.request().post('/api/reviews').set(user.headers)
      .send({ entity_type: 'lawyer', entity_id: lawyerId, rating: 5, comment: `${ctx.tag} very helpful` });
    expect(post.status).toBe(200);
    expect(post.body).toMatchObject({ entity_type: 'lawyer', rating: 5 });

    const dup = await ctx.request().post('/api/reviews').set(user.headers)
      .send({ entity_type: 'lawyer', entity_id: lawyerId, rating: 1 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('duplicate_review');

    const list = await ctx.request().get(`/api/reviews?entity_type=lawyer&entity_id=${lawyerId}`);
    expect(list.status).toBe(200);
    expect(list.body.reviews.some(r => r.comment === `${ctx.tag} very helpful`)).toBe(true);

    const summary = await ctx.request().get(`/api/reviews/summary?entity_type=lawyer&entity_id=${lawyerId}`);
    expect(summary.status).toBe(200);
    expect(summary.body.count).toBeGreaterThanOrEqual(1);
    expect(summary.body.avg_rating).toBeGreaterThan(0);

    // the verified directory row was NOT modified by the app review
    const after = await ctx.db.get('SELECT name, phone, rating, reviews FROM lawyers WHERE id = ?', [lawyerId]);
    expect(after).toEqual(lawyerRowBefore);
  });

  it('review validation: bad entity_type / rating / missing fields → 400, guest → 401', async () => {
    const h = other.headers;
    expect((await ctx.request().post('/api/reviews').set(h).send({ entity_type: 'nonsense', entity_id: 1, rating: 5 })).status).toBe(400);
    expect((await ctx.request().post('/api/reviews').set(h).send({ entity_type: 'lawyer', entity_id: lawyerId, rating: 9 })).status).toBe(400);
    expect((await ctx.request().post('/api/reviews').set(h).send({ entity_type: 'lawyer' })).status).toBe(400);
    expect((await ctx.request().post('/api/reviews').send({ entity_type: 'lawyer', entity_id: 1, rating: 5 })).status).toBe(401);
    expect((await ctx.request().get('/api/reviews')).status).toBe(400); // entity filters required
  });
});
