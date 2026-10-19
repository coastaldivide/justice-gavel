/**
 * input_fuzz.int.test.js — checklist item 5: the create endpoints on the core
 * path reject wrong types, missing fields and oversized values with a 4xx —
 * never a 500, never a stored row. (Every malformed payload below is sent to
 * the real app on real Postgres.)
 */
import { describeIntegration, initSuite } from './_harness.js';

const BIG = 'x'.repeat(200_000);
const BAD_VALUES = [123, ['a', 'b'], { nested: { a: 1 } }, null, true, BIG];

describeIntegration('malformed input never 500s (real Postgres)', () => {
  const ctx = initSuite({ anthropicMock: true });
  let u, caseId;
  beforeAll(async () => {
    if (!ctx.app) return;
    u = await ctx.register({ displayName: 'Fuzz' });
    await ctx.acceptDisclaimer(u);
    caseId = (await ctx.request().post('/api/cases').set(u.headers).send({ title: `${ctx.tag} fuzz case` })).body.id;
  });

  const targets = () => [
    ['post', '/api/cases', ['title', 'next_court_date', 'notes', 'state', 'status']],
    ['put', `/api/cases/${caseId}`, ['title', 'next_court_date', 'notes', 'status']],
    ['post', `/api/cases/${caseId}/events`, ['title', 'event_type', 'event_date', 'amount_cents']],
    ['post', `/api/messages/${caseId}`, ['body', 'message_type']],
    ['post', '/api/push/reminders', ['title', 'body', 'deliver_at', 'case_id']],
    ['post', '/api/saved/lawyers', ['name', 'lawyer_id', 'provider_id', 'notes', 'specialties']],
    ['post', '/api/reviews', ['entity_id', 'entity_type', 'rating', 'comment']],
    ['post', '/api/feedback', ['rating', 'comment']],
    ['post', '/api/family/contacts', ['name', 'phone', 'email']],
    ['post', '/api/arrests/monitors', ['watch_name', 'name', 'county', 'state']],
    ['post', '/api/chat/ask', ['message', 'sessionId', 'caseContext']],
    ['post', '/api/auth/login', ['identifier', 'password']],
    ['post', '/api/auth/register', ['identifier', 'password', 'displayName']],
    ['post', '/api/alerts', ['contacts', 'userName', 'lat', 'lng']],
  ];

  it('wrong types, nulls and 200 KB strings get 4xx (or a sanitised 2xx), never 5xx', async () => {
    const fails = [];
    const statuses = {};
    // Every request comes from its own client address (trust proxy 1) so the
    // IP rate limiters don't mask the handlers.
    let ipSeq = 0;
    const ip = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`; };
    for (const [method, url, fields] of targets()) {
      for (const field of fields) {
        for (const bad of BAD_VALUES) {
          const r = await ctx.request()[method](url).set(u.headers).set('X-Forwarded-For', ip()).send({ [field]: bad });
          statuses[r.status] = (statuses[r.status] || 0) + 1;
          if (r.status >= 500) fails.push(`${method.toUpperCase()} ${url} {${field}: ${typeof bad === 'string' ? 'BIG' : JSON.stringify(bad)}} → ${r.status}`);
        }
      }
      // non-object bodies
      for (const body of ['"just a string"', '[1,2,3]', '{bad json']) {
        const r = await ctx.request()[method](url).set(u.headers).set('X-Forwarded-For', ip()).set('Content-Type', 'application/json').send(body);
        if (r.status >= 500) fails.push(`${method.toUpperCase()} ${url} body=${body} → ${r.status}`);
      }
    }
    console.log('fuzz statuses', JSON.stringify(statuses));
    expect(fails).toEqual([]);
    // the probe must actually reach the handlers (not just the rate limiter)
    expect((statuses[429] || 0)).toBeLessThan(Object.values(statuses).reduce((a, b) => a + b, 0) / 4);
  }, 240_000);

  it('a 200 KB case title is never stored', async () => {
    await ctx.request().post('/api/cases').set(u.headers).send({ title: BIG });
    const r = await ctx.db.get('SELECT MAX(LENGTH(title)) AS n FROM cases WHERE user_id = ?', [u.user.id]);
    expect(Number(r.n)).toBeLessThanOrEqual(300);
  });
});
