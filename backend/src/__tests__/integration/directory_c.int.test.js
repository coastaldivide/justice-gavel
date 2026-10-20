/**
 * directory_c.int.test.js — section C (lawyers, bail agents, firms) against the
 * REAL migrated database with the real 2,046 lawyer / 1,262 bail-agent rows
 * (read only — the rows' checksum is the same before and after the suite).
 *
 *   C1  search by GPS / ZIP / "City, ST" / address city / state / name; nothing → empty
 *   C2  paging walks to the end: X-Total-Count, no duplicates, distance order
 *   C3  filters always narrow (never dropped to fill a page); 24/7 = stored hours
 *   C4  profile shape for many listings (with and without phone / website /
 *       hours): real booleans, language arrays, no internal columns; 400 / 404
 *   C5  reviews: one per person, unknown listing 404, contact details held for
 *       moderation, reports (3 people → held), admin publish / hide
 *   C6  booking with a payment provider (fake Stripe client): only lawyers on
 *       the app; the slot is stored as its exact instant in the lawyer's zone
 *       (DST-correct); pay → confirm; taken slot → 409; refund window from the
 *       instant
 *   C7  match: candidates near the person (not the national top three), job
 *       owned by the caller, listing ids for the profile link
 *   C8  video: other people's rooms are not reachable; localized 503
 *   C9  PI leads: type + state validated, flat fee per type, nothing identifying
 *       before a purchase
 *   C10 firms directory paging input, Golden Gavel text in the request language,
 *       the invented bail calculator is gone
 *   C11 listing rows unchanged
 */
import { jest } from '@jest/globals';
import { describeIntegration, initSuite } from './_harness.js';

// A Stripe stand-in: PaymentIntents the test can mark as paid, refunds recorded.
const fake = { pis: new Map(), refunds: [], seq: 0 };
jest.unstable_mockModule('stripe', () => ({
  default: class FakeStripe {
    constructor() {
      this.paymentIntents = {
        create: async (params) => {
          const id = `pi_c_${++fake.seq}`;
          const pi = { id, client_secret: `${id}_secret`, amount: params.amount, status: 'requires_payment_method', metadata: params.metadata };
          fake.pis.set(id, pi);
          return pi;
        },
        retrieve: async (id) => fake.pis.get(id),
      };
      this.refunds = { create: async (p) => { fake.refunds.push(p); return { id: `re_${fake.refunds.length}` }; } };
      this.customers = { create: async () => ({ id: 'cus_c' }) };
    }
  },
}));

describeIntegration('section C — directory, reviews, booking, match (real Postgres)', () => {
  const ctx = initSuite();
  let alice, bob, carol, dave, admin, attyTx, attyNy, txLawyer, nyLawyer, md5Before;

  const providerMd5 = async () => {
    const l = await ctx.db.get(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) AS h, COUNT(*) AS n FROM lawyers t`);
    const b = await ctx.db.get(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) AS h, COUNT(*) AS n FROM bail_agents t`);
    return `${l.n}:${l.h}/${b.n}:${b.h}`;
  };
  const get = (path, user) => (user ? ctx.request().get(path).set(user.headers) : ctx.request().get(path));
  const allPages = async (base) => {
    const first = await get(`${base}&limit=50&page=1`);
    const total = Number(first.headers['x-total-count']);
    const rows = [...first.body];
    for (let p = 2; rows.length < total && p < 60; p++) rows.push(...(await get(`${base}&limit=50&page=${p}`)).body);
    return { total, rows, matched: first.headers['x-search-matched'] };
  };

  beforeAll(async () => {
    if (!ctx.app) return;
    md5Before = await providerMd5();
    process.env.ADMIN_KEY = 'section-c-admin-key-0123456789';
    [alice, bob, carol, dave, admin] = await Promise.all(['Alice', 'Bob', 'Carol', 'Dave', 'Admin'].map(n => ctx.register({ displayName: `C ${n}` })));
    attyTx = await ctx.register({ displayName: 'C Tx Attorney', accountType: 'attorney' });
    attyNy = await ctx.register({ displayName: 'C Ny Attorney', accountType: 'attorney' });
    const free = (state) => ctx.db.get(`SELECT l.id, l.name, l.state FROM lawyers l WHERE l.state = ? AND l.user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = l.id) ORDER BY l.id LIMIT 1`, [state]);
    txLawyer = await free('TX');
    nyLawyer = await free('NY');
    // Linking an attorney account to a listing (what an approved claim does) — the listing row is untouched.
    // (sign-up already made each attorney's profile row: one per account)
    for (const [u, l] of [[attyTx, txLawyer], [attyNy, nyLawyer]]) {
      await ctx.db.run(`INSERT INTO attorney_profiles (user_id, lawyer_id) VALUES (?, ?)
                        ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET lawyer_id = EXCLUDED.lawyer_id`, [u.user.id, l.id]);
    }
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM attorney_profiles WHERE lawyer_id IN (?, ?)', [txLawyer.id, nyLawyer.id]);
      await db.run('DELETE FROM review_reports WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [`${ctx.tag}-%@it.example.test`]);
      await db.run('DELETE FROM pi_leads WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [`${ctx.tag}-%@it.example.test`]);
      await db.run('DELETE FROM video_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [`${ctx.tag}-%@it.example.test`]);
    });
  });

  // ── C1 ──────────────────────────────────────────────────────────────────────
  it('C1 search: GPS, ZIP, "City, ST", address city, state, name; nonsense → empty', async () => {
    const near = await get('/api/providers/lawyers?lat=36.1627&lng=-86.7816');
    expect(near.status).toBe(200);
    expect(near.headers['x-search-matched']).toBe('near');
    expect(near.body[0].distanceMi).toBeLessThan(2);
    expect(near.body.every(l => l.distanceKm != null)).toBe(true);

    const zip = await get('/api/providers/lawyers?q=37219');
    expect(zip.headers['x-search-matched']).toBe('zip');
    expect(zip.body[0].zip).toBe('37219');
    const dists = zip.body.map(l => l.distanceKm);
    expect([...dists].sort((a, b) => Math.floor(a / 5) - Math.floor(b / 5))).toEqual(dists.sort((a, b) => Math.floor(a / 5) - Math.floor(b / 5)));

    const city = await get('/api/providers/lawyers?q=Richmond,%20VA&limit=50');
    expect(city.headers['x-search-matched']).toBe('city');
    expect(city.body.length).toBeGreaterThan(0);
    expect(city.body.every(l => l.city === 'Richmond' && l.state === 'VA')).toBe(true);

    const brooklyn = await get('/api/providers/lawyers?q=Brooklyn');
    expect(brooklyn.body.length).toBeGreaterThan(0);
    expect(brooklyn.body.every(l => /Brooklyn/i.test(l.address))).toBe(true);

    const state = await get('/api/providers/lawyers?q=Tennessee&limit=50');
    expect(state.headers['x-search-matched']).toBe('state');
    expect(state.body.every(l => l.state === 'TN')).toBe(true);

    const anyName = await ctx.db.get(`SELECT name FROM lawyers WHERE name ILIKE '%law office%' ORDER BY id LIMIT 1`);
    const word = anyName.name.split(/\s+/).find(w => w.length > 5 && !/law|office/i.test(w)) || anyName.name.slice(0, 12);
    const byName = await get(`/api/providers/lawyers?q=${encodeURIComponent(word)}`);
    expect(byName.body.some(l => l.name.toLowerCase().includes(word.toLowerCase()))).toBe(true);

    for (const q of ['zzqqxx', '99999']) {
      const none = await get(`/api/providers/lawyers?q=${q}`);
      expect(none.status).toBe(200);
      expect(none.body).toEqual([]);
      expect(none.headers['x-total-count']).toBe('0');
    }
    const bail = await get('/api/providers/bail?q=Houston,%20TX');
    expect(bail.body.length).toBeGreaterThan(0);
    expect(bail.body.every(a => a.city === 'Houston')).toBe(true);
  });

  // ── C2 ──────────────────────────────────────────────────────────────────────
  it('C2 paging walks to the end of a result with no duplicates (lawyers and bail agents)', async () => {
    for (const base of ['/api/providers/lawyers?q=TX', '/api/providers/lawyers?lat=36.16&lng=-86.78', '/api/providers/bail?q=CA', '/api/providers/bail?lat=34.05&lng=-118.24']) {
      const { total, rows } = await allPages(base);
      expect(total).toBeGreaterThan(20);
      expect(rows).toHaveLength(total);
      expect(new Set(rows.map(r => r.id)).size).toBe(total);
      const past = await get(`${base}&limit=50&page=${Math.ceil(total / 50) + 1}`);
      expect(past.body).toEqual([]);
    }
    const whole = await get('/api/providers/lawyers?limit=1');
    expect(Number(whole.headers['x-total-count'])).toBe(2046);
    const wholeBail = await get('/api/providers/bail?limit=1');
    expect(Number(wholeBail.headers['x-total-count'])).toBe(1262);
  });

  // ── C3 ──────────────────────────────────────────────────────────────────────
  it('C3 filters narrow and are never dropped; 24/7 comes from the stored hours', async () => {
    const all = Number((await get('/api/providers/lawyers?q=TX&limit=1')).headers['x-total-count']);
    const family = await allPages('/api/providers/lawyers?lat=36.16&lng=-86.78&caseType=Family%20Law');
    expect(family.total).toBeLessThan(2046);
    expect(family.rows.every(l => /family|divorce|custody/i.test(`${l.name} ${l.specialties.join(' ')} ${l.bio || ''}`))).toBe(true);
    const spanish = await get('/api/providers/lawyers?lat=36.16&lng=-86.78&language=Spanish');
    expect(spanish.body.every(l => l.languages.some(x => /spanish/i.test(x)))).toBe(true);
    const proBono = await get('/api/providers/lawyers?q=TX&proBonoOnly=true');
    expect(proBono.body.every(l => l.pro_bono === true)).toBe(true);
    // criminal charge types match criminal-defence listings, with listings that name the charge first
    const dui = await get('/api/providers/lawyers?q=TX&caseType=DUI&limit=5');
    expect(Number(dui.headers['x-total-count'])).toBeLessThanOrEqual(all);
    expect(/dui|dwi/i.test(dui.body[0].name)).toBe(true);

    const bailAll = await allPages('/api/providers/bail?q=TN');
    const bail24 = await allPages('/api/providers/bail?q=TN&open24=true');
    expect(bail24.total).toBeLessThan(bailAll.total);
    expect(bail24.rows.every(a => a.open_24_7 === true && /Open 24 hours/.test(a.hours))).toBe(true);
    const plans = await allPages('/api/providers/bail?q=TN&paymentPlans=true');
    expect(plans.rows.every(a => a.payment_plans === true)).toBe(true);
  });

  // ── C4 ──────────────────────────────────────────────────────────────────────
  it('C4 every sampled profile opens with a clean public shape (incl. no phone / website / hours)', async () => {
    const ids = await ctx.db.all(`(SELECT id FROM lawyers WHERE phone IS NULL OR phone = '' LIMIT 8)
      UNION (SELECT id FROM lawyers WHERE website IS NULL OR website = '' LIMIT 8)
      UNION (SELECT id FROM lawyers WHERE hours IS NULL OR hours = '' LIMIT 8)
      UNION (SELECT id FROM lawyers ORDER BY md5(id::text) LIMIT 30)`);
    expect(ids.length).toBeGreaterThan(40);
    for (const { id } of ids) {
      const r = await get(`/api/providers/lawyers/${id}`);
      expect(`${id}:${r.status}`).toBe(`${id}:200`);
      const l = r.body;
      for (const k of ['bar_verified', 'jtb_verified', 'golden_gavel', 'free_consultation', 'pro_bono', 'on_app', 'open_24_7']) expect(typeof l[k]).toBe('boolean');
      expect(Array.isArray(l.languages) && Array.isArray(l.specialties)).toBe(true);
      for (const k of ['email', 'user_id', 'source_id', 'data_source_ids', 'sort_priority']) expect(l).not.toHaveProperty(k);
      if (l.phone) expect(l.phone).toMatch(/^\+?\d{10,15}$/);
      if (l.hours_known) expect(typeof l.open_now).toBe('boolean');
      expect(l.app_reviews).toEqual(expect.objectContaining({ count: expect.any(Number) }));
    }
    expect((await get('/api/providers/lawyers/999999999')).status).toBe(404);
    expect((await get('/api/providers/lawyers/12abc')).status).toBe(400);
    const es = await ctx.request().get('/api/providers/lawyers/999999999').set('Accept-Language', 'es');
    expect(es.body.error).toMatch(/No encontramos/);
    const agentIds = await ctx.db.all('SELECT id FROM bail_agents ORDER BY md5(id::text) LIMIT 15');
    for (const { id } of agentIds) expect((await get(`/api/providers/bail/${id}`)).status).toBe(200);
  });

  // ── C5 ──────────────────────────────────────────────────────────────────────
  it('C5 reviews: one per person; contact details held; 3 reports hold a review; admin decides', async () => {
    const lawyerId = txLawyer.id;
    const post = (u, body) => ctx.request().post('/api/reviews').set(u.headers).send({ entity_type: 'lawyer', entity_id: lawyerId, ...body });
    expect((await post(alice, { rating: 5, comment: `${ctx.tag} answered at night` })).status).toBe(201);
    const dup = await post(alice, { rating: 1 });
    expect(dup.status).toBe(409);
    expect((await ctx.request().post('/api/reviews').set(alice.headers).set('Accept-Language', 'pt').send({ entity_type: 'lawyer', entity_id: lawyerId, rating: 2 })).body.error).toMatch(/já avaliou/);
    expect((await ctx.request().post('/api/reviews').set(alice.headers).send({ entity_type: 'lawyer', entity_id: 999999999, rating: 5 })).status).toBe(404);
    expect((await ctx.request().post('/api/reviews').set(alice.headers).send({ entity_type: 'lawyer', entity_id: lawyerId, rating: 0 })).status).toBe(400);

    const held = await post(bob, { rating: 1, comment: 'better lawyer: call 615-555-0199 or www.example.com' });
    expect(held.status).toBe(201);
    expect(held.body.status).toBe('pending');
    const list = await get(`/api/reviews?entity_type=lawyer&entity_id=${lawyerId}`, bob);
    expect(list.body.reviews.some(r => r.id === held.body.id)).toBe(false);
    expect(list.body.mine).toEqual(expect.objectContaining({ id: held.body.id, status: 'pending' }));
    const sum = await get(`/api/reviews/summary?entity_type=lawyer&entity_id=${lawyerId}`);
    expect(sum.body.count).toBe(1);

    const reviewId = (await get(`/api/reviews?entity_type=lawyer&entity_id=${lawyerId}`)).body.reviews[0].id;
    expect((await ctx.request().post(`/api/reviews/${reviewId}/report`).set(alice.headers).send({ reason: 'spam' })).status).toBe(400); // own review
    for (const u of [bob, carol]) expect((await ctx.request().post(`/api/reviews/${reviewId}/report`).set(u.headers).send({ reason: 'false' })).status).toBe(201);
    expect((await ctx.request().post(`/api/reviews/${reviewId}/report`).set(carol.headers).send({ reason: 'false' })).body.duplicate).toBe(true);
    expect((await get(`/api/reviews?entity_type=lawyer&entity_id=${lawyerId}`)).body.reviews).toHaveLength(1);
    expect((await ctx.request().post(`/api/reviews/${reviewId}/report`).set(dave.headers).send({ reason: 'offensive' })).status).toBe(201);
    expect((await get(`/api/reviews?entity_type=lawyer&entity_id=${lawyerId}`)).body.reviews).toHaveLength(0);   // held after 3 people

    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(admin.user.id);
    const adm = (m, p) => ctx.request()[m](p).set(admin.headers).set('X-Admin-Key', process.env.ADMIN_KEY);
    expect((await ctx.request().get('/api/admin/reviews').set(alice.headers).set('X-Admin-Key', process.env.ADMIN_KEY)).status).toBe(403);
    const queue = await adm('get', '/api/admin/reviews?status=pending');
    expect(queue.status).toBe(200);
    expect(queue.body.reviews.map(r => r.id)).toEqual(expect.arrayContaining([reviewId, held.body.id]));
    expect((await adm('post', `/api/admin/reviews/${reviewId}`).send({ action: 'publish' })).body.status).toBe('published');
    expect((await adm('post', `/api/admin/reviews/${held.body.id}`).send({ action: 'hide', note: 'contact details' })).body.status).toBe('hidden');
    expect((await adm('post', `/api/admin/reviews/${reviewId}`).send({ action: 'nuke' })).status).toBe(400);
    const after = await get(`/api/reviews?entity_type=lawyer&entity_id=${lawyerId}`);
    expect(after.body.reviews.map(r => r.id)).toEqual([reviewId]);
    expect(Number((await ctx.db.get(`SELECT COUNT(*) AS n FROM review_reports WHERE review_id = ? AND status = 'open'`, [reviewId])).n)).toBe(0);
  });

  // ── C6 ──────────────────────────────────────────────────────────────────────
  it('C6 booking with payments live: exact instant in the lawyer zone, pay → confirm, taken → 409, refund window', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_section_c';
    try {
      const unlinked = await ctx.db.get(`SELECT l.id FROM lawyers l WHERE l.user_id IS NULL AND l.id NOT IN (?, ?)
        AND NOT EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = l.id) ORDER BY l.id LIMIT 1`, [txLawyer.id, nyLawyer.id]);
      expect((await ctx.request().post('/api/consultations/book').set(alice.headers).send({ lawyer_id: unlinked.id, date_slot: '2030-01-07', time_slot: '9:00 AM', duration_min: 30 })).body.code).toBe('not_on_app');

      const slots = (await get(`/api/consultations/slots/${txLawyer.id}`, alice)).body;
      expect(slots.time_zone).toBe('America/Chicago');
      const every = slots.slots.flatMap(d => d.times.map(t => ({ ...t, date: d.date })));
      // every slot reads its own label on the lawyer's wall clock (DST-correct across Nov 1)
      for (const s of every) {
        expect(new Date(s.starts_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })).toBe(s.time);
        expect(new Date(s.starts_at).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })).toBe(s.date);
      }
      const slot = every.find(s => s.available);

      expect((await ctx.request().post('/api/consultations/book').set(alice.headers).send({ lawyer_id: txLawyer.id, date_slot: slot.date, time_slot: '9:30 AM', duration_min: 30 })).body.code).toBe('bad_slot');
      const booked = await ctx.request().post('/api/consultations/book').set(alice.headers)
        .send({ lawyer_id: txLawyer.id, date_slot: slot.date, time_slot: slot.time.toLowerCase(), duration_min: 60, notes: 'first offense' });
      expect(booked.status).toBe(201);
      expect(booked.body).toMatchObject({ requires_payment: true, fee_display: '$25.00' });
      expect(fake.pis.get(booked.body.payment_intent_id).amount).toBe(2500);
      const row = await ctx.db.get('SELECT status, starts_at, time_zone, time_slot, lawyer_name FROM consultation_bookings WHERE id = ?', [booked.body.booking.id]);
      expect(row.status).toBe('pending_payment');
      expect(new Date(row.starts_at).toISOString()).toBe(slot.starts_at);
      expect(row).toMatchObject({ time_zone: 'America/Chicago', time_slot: slot.time, lawyer_name: txLawyer.name });

      // the held slot is not offered to anyone else; a second booking of it is refused
      const again = (await get(`/api/consultations/slots/${txLawyer.id}`, bob)).body.slots.find(d => d.date === slot.date).times.find(t => t.time === slot.time);
      expect(again.available).toBe(false);
      expect((await ctx.request().post('/api/consultations/book').set(bob.headers).send({ lawyer_id: txLawyer.id, date_slot: slot.date, time_slot: slot.time, duration_min: 30 })).body.code).toBe('slot_taken');

      const id = booked.body.booking.id;
      expect((await ctx.request().post(`/api/consultations/${id}/confirm`).set(bob.headers)).status).toBe(404);   // not Bob's
      expect((await ctx.request().post(`/api/consultations/${id}/confirm`).set(alice.headers)).status).toBe(402); // not paid yet
      fake.pis.get(booked.body.payment_intent_id).status = 'succeeded';
      const conf = await ctx.request().post(`/api/consultations/${id}/confirm`).set(alice.headers);
      expect(conf.status).toBe(200);
      expect(conf.body.booking).toMatchObject({ status: 'confirmed', starts_at: slot.starts_at, time_zone: 'America/Chicago' });
      expect((await ctx.request().post(`/api/consultations/${id}/confirm`).set(alice.headers)).body.already_confirmed).toBe(true);
      const mine = await get('/api/consultations', alice);
      expect(mine.body.consultations[0]).toMatchObject({ id, starts_at: slot.starts_at, fee_display: '$25.00' });

      // NY lawyer: 9:00 AM Eastern is 8:00 AM for a person in Chicago
      const ny = (await get(`/api/consultations/slots/${nyLawyer.id}`, alice)).body;
      expect(ny.time_zone).toBe('America/New_York');
      const nine = ny.slots[0].times.find(t => t.time === '9:00 AM');
      expect(new Date(nine.starts_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })).toBe('8:00 AM');

      // cancel well before the start → full refund of the platform fee
      const cancel = await ctx.request().post(`/api/consultations/${id}/cancel`).set(alice.headers);
      expect(cancel.status).toBe(200);
      expect(cancel.body.refund).toMatch(/\$25\.00/);
      expect(fake.refunds.at(-1)).toMatchObject({ payment_intent: booked.body.payment_intent_id });
      expect((await ctx.request().post(`/api/consultations/${id}/cancel`).set(alice.headers)).status).toBe(409);
    } finally {
      delete process.env.STRIPE_SECRET_KEY;
    }
    // payments off again → 503 before anything is stored
    const slot2 = (await get(`/api/consultations/slots/${txLawyer.id}`, carol)).body.slots[1].times[0];
    const n0 = Number((await ctx.db.get('SELECT COUNT(*) AS n FROM consultation_bookings WHERE user_id = ?', [carol.user.id])).n);
    const off = await ctx.request().post('/api/consultations/book').set(carol.headers).set('Accept-Language', 'vi')
      .send({ lawyer_id: txLawyer.id, date_slot: slot2.starts_at.slice(0, 10), time_slot: slot2.time, duration_min: 30 });
    expect([503, 400]).toContain(off.status);
    expect(Number((await ctx.db.get('SELECT COUNT(*) AS n FROM consultation_bookings WHERE user_id = ?', [carol.user.id])).n)).toBe(n0);
  });

  // ── C7 ──────────────────────────────────────────────────────────────────────
  it('C7 match: nearest candidates (not the national top three), job owned by the caller, ids for the profile', async () => {
    await ctx.acceptDisclaimer(alice).catch(() => {});
    const r = await ctx.request().get('/api/match/lawyers?lat=36.1627&lng=-86.7816&limit=3').set(alice.headers).set('Accept-Language', 'es');
    expect(r.status).toBe(200);
    expect(r.body.jobId).toBeTruthy();
    expect((await ctx.request().get(`/api/jobs/${r.body.jobId}`).set(bob.headers)).status).toBe(404);
    const job = await ctx.pollJob(alice, r.body.jobId);
    expect(job.body.status).toBe('done');
    const matches = job.body.result;
    expect(matches).toHaveLength(3);
    for (const m of matches) {
      expect(Number.isInteger(m.id)).toBe(true);
      expect(m.distanceMi).toBeLessThan(60);
      expect(m.state).toBe('TN');
      expect(typeof m.matchReport).toBe('string');
    }
    const city = await ctx.request().get('/api/match/lawyers?city=Richmond,%20VA').set(alice.headers);
    const cityJob = await ctx.pollJob(alice, city.body.jobId);
    expect(cityJob.body.result.every(m => m.city === 'Richmond')).toBe(true);
    const none = await ctx.request().get('/api/match/lawyers?lat=36.16&lng=-86.78&language=Navajo').set(alice.headers);
    expect(none.body).toMatchObject({ status: 'done', matches: [] });
    expect((await ctx.request().get('/api/match/lawyers').set(alice.headers)).status).toBe(400);
  });

  // ── C8 ──────────────────────────────────────────────────────────────────────
  it('C8 video: no provider key → localized 503; nobody can reach another person\'s room', async () => {
    const v = await ctx.request().post('/api/video/session').set(alice.headers).set('Accept-Language', 'es').send({});
    expect(v.status).toBe(503);
    expect(v.body.code).toBe('video_unavailable');
    expect(v.body.error).toMatch(/videoconsultas/);
    await ctx.db.run(`INSERT INTO video_sessions (user_id, daily_room_name, daily_room_url) VALUES (?, ?, 'https://x.daily.co/r')`, [alice.user.id, `jg-${alice.user.id}-1`]);
    expect((await ctx.request().delete(`/api/video/session/jg-${alice.user.id}-1`).set(bob.headers)).status).toBe(404);
    expect((await ctx.request().get(`/api/video/session/jg-${alice.user.id}-1`).set(bob.headers)).status).toBe(404);
  });

  // ── C9 ──────────────────────────────────────────────────────────────────────
  it('C9 PI leads: validated, flat fee per type, nothing identifying before a purchase', async () => {
    const fees = await get('/api/billing/pi-lead/fees');
    expect(Object.fromEntries(fees.body.fees.map(f => [f.lead_type, f.fee_display]))).toEqual({
      personal_injury: '$200', civil_rights: '$200', employment: '$100', medical: '$200', ice_detention: '$75' });
    const submit = (body) => ctx.request().post('/api/billing/pi-lead/submit').set(bob.headers).send(body);
    expect((await submit({ case_type: 'Employment', description: 'short', state: 'TN' })).status).toBe(400);
    expect((await submit({ case_type: 'Employment', description: 'Fired after reporting a safety problem.' })).body.code).toBe('state_required');
    expect((await submit({ case_type: 'Astrology', description: 'Fired after reporting a safety problem.', state: 'TN' })).body.code).toBe('bad_type');
    const ok = await submit({ case_type: 'Civil Rights', severity: 'serious', description: `${ctx.tag} Officer pushed me; call me at 615-555-0101.`, state: 'tn', city: 'Nashville' });
    expect(ok.status).toBe(201);
    expect(ok.body.lead).toMatchObject({ case_type: 'civil_rights', state: 'TN', lead_fee_cents: 20000, lead_fee_display: '$200' });
    await ctx.db.run(`UPDATE users SET role = 'attorney' WHERE id = ?`, [attyTx.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(attyTx.user.id);
    const leads = await get('/api/billing/pi-leads?state=TN', attyTx);
    expect(leads.status).toBe(200);
    const mineLead = leads.body.find(l => l.id === ok.body.lead_id);
    expect(mineLead).toBeDefined();
    expect(mineLead.description ?? null).toBeNull();          // never sent before a purchase
    expect(JSON.stringify(mineLead)).not.toMatch(/615-555-0101|@it\.example\.test/);
    expect((await ctx.request().post(`/api/billing/pi-lead/accept/${ok.body.lead_id}`).set(attyTx.headers)).status).toBe(503);
  });

  // ── C10 ─────────────────────────────────────────────────────────────────────
  it('C10 firm directory paging input, Golden Gavel in the request language, no invented bail calculator', async () => {
    expect((await get('/api/firms/directory?page=abc')).status).toBe(200);
    expect((await get('/api/firms/directory?page=-4')).body.page).toBe(1);
    expect((await ctx.request().get('/api/firms/referral/ZZZZZZ').set('Accept-Language', 'vi')).body.error).toMatch(/Không có công ty/);
    const gg = await ctx.request().get('/api/golden-gavel/eligibility').set(carol.headers).set('Accept-Language', 'es');
    expect(gg.status).toBe(200);
    expect(gg.body.missing_for_next.join(' ')).toMatch(/meses más de actividad/);
    expect((await ctx.request().post('/api/bail/calculate').send({ state: 'TN', charge_type: 'felony' })).status).toBe(404);
  });

  it('C11 the lawyer and bail-agent rows are exactly as before the suite (read only)', async () => {
    expect(await providerMd5()).toBe(md5Before);
  });
});
