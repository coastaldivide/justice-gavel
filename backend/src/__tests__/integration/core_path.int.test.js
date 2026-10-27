/**
 * core_path.int.test.js — "Just arrested?" core path on real Postgres.
 *
 *   1  rights card: public, every section sourced + dated, state notice,
 *      database rows (with a source) override, rows without one are ignored
 *   2  combined lawyer + bail results: public, filters, open-now / 24-7,
 *      ranking by distance + completeness, public defender + inmate lookup;
 *      "report a listing" queues a report and NEVER changes a provider row
 *   3  court dates: sign-in required, many per case, past archived, 7d/3d/1d/
 *      morning-of reminders per hearing (court_date_id), courthouse details,
 *      .ics content, missed-date guidance, IDOR matrix, push → web push → email → SMS (Telnyx) chain
 *   4  family followers: owner consent required, code accept, follower sees
 *      court dates but never notes/charges, gets reminders, revocable (both
 *      sides), strangers locked out
 */
import http from 'http';
import { describeIntegration, initSuite, providerChecksum } from './_harness.js';

const expo = { server: null, received: [], ticket: 'ok' };
const telnyx = { server: null, received: [] };

const NASHVILLE = { lat: 36.1627, lng: -86.7816 };
const dayPlus = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describeIntegration('core path: rights → lawyer + bail → court dates → family (real Postgres)', () => {
  beforeAll(async () => {
    expo.server = http.createServer((req, res) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        const msgs = JSON.parse(data || '[]');
        expo.received.push(...msgs);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: msgs.map((_, i) => (expo.ticket === 'ok'
          ? { status: 'ok', id: `t-${Date.now()}-${i}` }
          : { status: 'error', message: 'DeviceNotRegistered', details: { error: 'DeviceNotRegistered' } })) }));
      });
    });
    await new Promise(r => expo.server.listen(0, '127.0.0.1', r));
    process.env.EXPO_PUSH_API_URL = `http://127.0.0.1:${expo.server.address().port}/--/api/v2`;

    // Telnyx Messaging API v2 mock (POST /messages, Bearer key, JSON body)
    telnyx.server = http.createServer((req, res) => {
      let data = '';
      req.on('data', c => { data += c; });
      req.on('end', () => {
        let json = null; try { json = JSON.parse(data); } catch { /* keep null */ }
        telnyx.received.push({ url: req.url, auth: req.headers.authorization, json });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { id: `msg-${telnyx.received.length}`, record_type: 'message' } }));
      });
    });
    await new Promise(r => telnyx.server.listen(0, '127.0.0.1', r));
    delete process.env.RESEND_API_KEY;
    process.env.ADMIN_KEY = 'core-path-admin-key-0123456789';
  });

  const ctx = initSuite();
  let alice, bob, carol, dave, dispatch, md5Before;
  const reportIds = [];

  const providerMd5 = () => providerChecksum(ctx.db);   // fixtures of parallel suites excluded
  async function deliverNow(id) {
    await ctx.db.run(`UPDATE scheduled_pushes SET deliver_at = NOW() - INTERVAL '1 minute' WHERE id = ?`, [id]);
    await dispatch({ now: new Date() });
    return ctx.db.get('SELECT status, channel, error FROM scheduled_pushes WHERE id = ?', [id]);
  }

  beforeAll(async () => {
    if (!ctx.app) return;
    ({ dispatchDueReminders: dispatch } = await import('../../services/reminderDispatcher.js'));
    alice = await ctx.register({ displayName: 'Alice Defendant' });
    bob   = await ctx.register({ displayName: 'Bob Stranger' });
    carol = await ctx.register({ displayName: 'Carol Mom' });
    dave  = await ctx.register({ displayName: 'Dave Other' });
    for (const u of [alice, bob, carol, dave]) {
      await ctx.request().post('/api/push/timezone').set(u.headers).send({ timezone: 'America/Chicago' });
    }
    md5Before = await providerMd5();
    ctx.addCleanup(async (db) => {
      if (reportIds.length) await db.run(`DELETE FROM listing_reports WHERE id IN (${reportIds.map(() => '?').join(',')})`, reportIds);
      await db.run(`DELETE FROM rights_cards WHERE source LIKE 'JGTEST%' OR topic LIKE 'jgtest%'`);
    });
  });

  afterAll(async () => {
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE']) delete process.env[k];
    if (expo.server) await new Promise(r => expo.server.close(r));
    if (telnyx.server) await new Promise(r => telnyx.server.close(r));
  });

  // ── 1. Know your rights ───────────────────────────────────────────────────
  it('1: rights card is public; every section has a source and a last-reviewed date', async () => {
    const r = await ctx.request().get('/api/rights/tn');
    expect(r.status).toBe(200);
    expect(r.body.state).toBe('TN');
    expect(r.body.general).toHaveLength(8);
    // the built-in state notes are unreviewed (no citation, no reviewer): never shown
    expect(r.body.state_specific).toEqual([]);
    for (const s of r.body.general) {
      expect(s.source).toEqual(expect.any(String));
      expect(s.last_reviewed).toBe('2026-04');
      expect(s.lawyer_reviewed).toBe(false);
    }
    expect(r.body.state_notice).toBe("State-specific details for Tennessee haven't been reviewed yet — ask a local lawyer or public defender.");
    expect(JSON.stringify(r.body)).not.toMatch(/T\.C\.A\.|You must provide your name/);
    expect(r.body.script.say.map(x => x.text)).toContain('I am invoking my right to remain silent.');
    expect(JSON.stringify(r.body)).not.toMatch(/10\s?%/);          // no unsourced bail-fee estimate
    const general = await ctx.request().get('/api/rights/US');
    expect(general.status).toBe(200);
    expect(general.body.state_specific).toEqual([]);
    expect((await ctx.request().get('/api/rights/ZZ')).status).toBe(400);
  });

  it('1: a state without reviewed notes gets the general card + "haven\'t been reviewed yet"', async () => {
    const r = await ctx.request().get('/api/rights/PR');
    expect(r.status).toBe(200);
    expect(r.body.general).toHaveLength(8);
    expect(r.body.state_specific).toEqual([]);
    expect(r.body.state_notice).toBe("State-specific details for Puerto Rico haven't been reviewed yet — ask a local lawyer or public defender.");
    const states = await ctx.request().get('/api/rights/states');
    expect(states.body.states.find(s => s.code === 'PR').state_specific_available).toBe(false);
    expect(states.body.states.find(s => s.code === 'TN').state_specific_available).toBe(false);
  });

  it('1: a rights_cards row WITH a source replaces the bundled section; one without a source is never shown', async () => {
    await ctx.db.run(
      `INSERT INTO rights_cards (topic, title, content, state, source, source_url, content_verified_at, reviewed_by, language)
       VALUES ('stop_identify', 'IF STOPPED — TENNESSEE (reviewed)', 'JGTEST reviewed text', 'TN', 'JGTEST Tenn. Code citation', 'https://example.test/tca', '2026-09-01', 'JGTEST Reviewer, Esq.', 'en'),
              ('jgtest_unsourced', 'UNSOURCED', 'must not show', 'TN', NULL, NULL, NULL, NULL, 'en')`);
    const r = await ctx.request().get('/api/rights/TN');
    const s = r.body.state_specific.find(x => x.topic === 'stop_identify');
    expect(s).toEqual(expect.objectContaining({
      body: 'JGTEST reviewed text', source: 'JGTEST Tenn. Code citation', last_reviewed: '2026-09-01', lawyer_reviewed: true,
    }));
    expect(JSON.stringify(r.body)).not.toContain('must not show');
    expect(r.body.state_notice).toBeNull();
    const states = await ctx.request().get('/api/rights/states');
    expect(states.body.states.find(x => x.code === 'TN').state_specific_available).toBe(true);
    await ctx.db.run(`DELETE FROM rights_cards WHERE source LIKE 'JGTEST%' OR topic LIKE 'jgtest%'`);
  });

  // ── 2. Lawyer + bail together ─────────────────────────────────────────────
  it('2: guest search returns lawyers AND bail agents, ranked by distance + completeness', async () => {
    const r = await ctx.request().get('/api/help/nearby').query(NASHVILLE);
    expect(r.status).toBe(200);
    expect(r.body.lawyers.length).toBeGreaterThan(0);
    expect(r.body.bail_agents.length).toBeGreaterThan(0);
    for (const list of [r.body.lawyers, r.body.bail_agents]) {
      const buckets = list.map(p => Math.floor(p.distance_km / 5));
      expect(buckets).toEqual([...buckets].sort((a, b) => a - b));
      for (const p of list) {
        expect(p).toEqual(expect.objectContaining({ distance_km: expect.any(Number), completeness: expect.any(Number) }));
        expect([true, false, null]).toContain(p.open_now);
        expect(p).not.toHaveProperty('golden_gavel');
        expect(p).not.toHaveProperty('sort_priority');
      }
    }
    expect(r.body.meta.ranking).toMatch(/Never by payment/);
    expect(r.body.public_defender).toEqual(expect.objectContaining({ name: expect.any(String) }));
    expect(r.body.inmate_lookup.length).toBeGreaterThan(0);
    expect((await ctx.request().get('/api/help/nearby')).status).toBe(400);
  });

  it('2: filters — open now, 24/7, charge, language, free consultation, distance', async () => {
    const open = await ctx.request().get('/api/help/nearby').query({ ...NASHVILLE, open_now: 1 });
    expect([...open.body.lawyers, ...open.body.bail_agents].every(p => p.open_now === true)).toBe(true);
    const h24 = await ctx.request().get('/api/help/nearby').query({ ...NASHVILLE, h24: 1 });
    expect(h24.body.bail_agents.length).toBeGreaterThan(0);
    expect([...h24.body.lawyers, ...h24.body.bail_agents].every(p => p.is_24_7 && /Open 24 hours/.test(p.hours))).toBe(true);
    const dui = await ctx.request().get('/api/help/nearby').query({ ...NASHVILLE, charge: 'DUI', type: 'lawyers' });
    expect(dui.body.bail_agents).toEqual([]);
    expect(dui.body.lawyers.every(p => /dui|dwi|drunk|owi/i.test([p.name, p.organization, p.website, ...p.specialties].join(' ')))).toBe(true);
    const es = await ctx.request().get('/api/help/nearby').query({ ...NASHVILLE, language: 'Spanish' });
    expect(es.body.lawyers.every(p => p.languages.some(l => /spanish/i.test(l)))).toBe(true);
    const near = await ctx.request().get('/api/help/nearby').query({ ...NASHVILLE, max_km: 10 });
    expect([...near.body.lawyers, ...near.body.bail_agents].every(p => p.distance_km <= 10)).toBe(true);
    const free = await ctx.request().get('/api/help/nearby').query({ ...NASHVILLE, free_consult: 1, type: 'lawyers' });
    expect(free.body.lawyers.every(p => p.free_consultation === true)).toBe(true);
    const byCity = await ctx.request().get('/api/help/nearby').query({ city: 'Nashville, TN' });
    expect(byCity.status).toBe(200);
    expect(byCity.body.meta.state).toBe('TN');
  });

  it('2: report a listing → queued for admins; double tap = one report; provider rows untouched', async () => {
    const lawyer = await ctx.db.get(`SELECT id FROM lawyers WHERE state = 'TN' ORDER BY id LIMIT 1`);
    const first = await ctx.request().post('/api/help/reports').send({ provider_type: 'lawyer', provider_id: lawyer.id, reason: 'wrong_phone', details: 'Number is disconnected' });
    expect(first.status).toBe(201);
    reportIds.push(first.body.report_id);
    const again = await ctx.request().post('/api/help/reports').send({ provider_type: 'lawyer', provider_id: lawyer.id, reason: 'wrong_phone' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(expect.objectContaining({ duplicate: true, report_id: first.body.report_id }));
    const signedIn = await ctx.request().post('/api/help/reports').set(alice.headers).send({ provider_type: 'lawyer', provider_id: lawyer.id, reason: 'closed' });
    expect(signedIn.status).toBe(201);
    reportIds.push(signedIn.body.report_id);
    expect((await ctx.request().post('/api/help/reports').send({ provider_type: 'lawyer', provider_id: lawyer.id, reason: 'nope' })).status).toBe(400);
    expect((await ctx.request().post('/api/help/reports').send({ provider_type: 'judge', provider_id: lawyer.id, reason: 'closed' })).status).toBe(400);
    expect((await ctx.request().post('/api/help/reports').send({ provider_type: 'bail_agent', provider_id: 999999999, reason: 'closed' })).status).toBe(404);
    const row = await ctx.db.get('SELECT table_name, record_id, reason, status, reporter_user_id FROM listing_reports WHERE id = ?', [signedIn.body.report_id]);
    expect(row).toEqual(expect.objectContaining({ table_name: 'lawyers', record_id: Number(lawyer.id), status: 'pending', reporter_user_id: alice.user.id }));

    // the admin queue sees it; a plain user does not
    expect((await ctx.request().get('/api/admin/listing-reports').set(alice.headers).set('X-Admin-Key', process.env.ADMIN_KEY)).status).toBe(403);
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [bob.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(bob.user.id);
    const q = await ctx.request().get('/api/admin/listing-reports').set(bob.headers).set('X-Admin-Key', process.env.ADMIN_KEY);
    expect(q.status).toBe(200);
    expect(q.body.reports.map(x => x.id)).toEqual(expect.arrayContaining(reportIds));
    const done = await ctx.request().post(`/api/admin/listing-reports/${first.body.report_id}`).set(bob.headers).set('X-Admin-Key', process.env.ADMIN_KEY).send({ status: 'dismissed', note: 'checked' });
    expect(done.status).toBe(200);
    await ctx.db.run(`UPDATE users SET role = 'user' WHERE id = ?`, [bob.user.id]);
    invalidateUserCache(bob.user.id);

    expect(await providerMd5()).toBe(md5Before);
  });

  it('2: claim your listing → admin approves → in-app messages reach the claimant; the listing row is untouched', async () => {
    const lawyer = await ctx.db.get(`SELECT id FROM lawyers t WHERE state = 'TN'
        AND NOT EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = t.id) AND user_id IS NULL ORDER BY id DESC LIMIT 1`);
    const attorney = await ctx.register({ displayName: 'Atty Claimant' });
    expect((await ctx.request().post('/api/help/claims').send({ provider_type: 'lawyer', provider_id: lawyer.id, license_number: 'BPR012345' })).status).toBe(401);
    expect((await ctx.request().post('/api/help/claims').set(attorney.headers).send({ provider_type: 'lawyer', provider_id: lawyer.id })).status).toBe(400);
    const claim = await ctx.request().post('/api/help/claims').set(attorney.headers).send({ provider_type: 'lawyer', provider_id: lawyer.id, license_number: 'BPR012345', license_state: 'TN' });
    expect(claim.status).toBe(201);
    const dup = await ctx.request().post('/api/help/claims').set(attorney.headers).send({ provider_type: 'lawyer', provider_id: lawyer.id, license_number: 'BPR012345' });
    expect(dup.body.duplicate).toBe(true);
    // before approval the listing cannot receive in-app messages
    const before = await ctx.request().post('/api/messages/bulk').set(alice.headers).send({ lawyer_ids: [lawyer.id], message: 'Can you help with a DUI?' });
    expect(before.body.sent).toBe(0);
    expect(before.body.skipped[0].reason).toBe('no_account');
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [bob.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(bob.user.id);
    const list = await ctx.request().get('/api/admin/listing-claims').set(bob.headers).set('X-Admin-Key', process.env.ADMIN_KEY);
    expect(list.body.claims.map(c => Number(c.id))).toContain(claim.body.claim_id);
    const ok = await ctx.request().post(`/api/admin/listing-claims/${claim.body.claim_id}`).set(bob.headers).set('X-Admin-Key', process.env.ADMIN_KEY).send({ decision: 'approve' });
    expect(ok.status).toBe(200);
    await ctx.db.run(`UPDATE users SET role = 'user' WHERE id = ?`, [bob.user.id]);
    invalidateUserCache(bob.user.id);
    const link = await ctx.db.get('SELECT user_id FROM attorney_profiles WHERE lawyer_id = ?', [lawyer.id]);
    expect(Number(link.user_id)).toBe(attorney.user.id);
    const after = await ctx.request().post('/api/messages/bulk').set(alice.headers).send({ lawyer_ids: [lawyer.id], message: 'Can you help with a DUI?' });
    expect(after.body.sent).toBe(1);
    const mine = await ctx.request().get('/api/help/claims/mine').set(attorney.headers);
    expect(mine.body.claims[0].status).toBe('approved');
    ctx.addCleanup(async (db) => { await db.run('DELETE FROM attorney_profiles WHERE lawyer_id = ? AND user_id = ?', [lawyer.id, attorney.user.id]); });
    expect(await providerMd5()).toBe(md5Before);
  });

  it('2: bail ranges are served only when checked against an official schedule — unverified rows are withheld; no invented agent-fee estimate', async () => {
    const r = await ctx.request().get('/api/help/bail-schedule').query({ state: 'TN', charge: 'dui' });
    expect(r.status).toBe(200);
    // Legal accuracy review (Oct 2026): no seeded bail row names an official schedule, so none is shown as fact.
    expect(r.body.meta.verified_only).toBe(true);
    expect(r.body.data.every(x => /^https?:\/\//.test(x.source_url || '') && x.verified_by)).toBe(true);
    expect(r.body.data.length + r.body.meta.withheld).toBeGreaterThan(0);
    expect(r.body.meta.fee_estimate_available).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/10\s?%/);
    expect((await ctx.request().get('/api/help/bail-schedule').query({ state: 'ZZ' })).status).toBe(400);
  });

  // ── 3. Never miss a court date ────────────────────────────────────────────
  let caseId; let cd1; let cd2;
  it('3: court dates need an account', async () => {
    expect((await ctx.request().get('/api/court-dates')).status).toBe(401);
    expect((await ctx.request().post('/api/court-dates').send({ court_date: dayPlus(10) })).status).toBe(401);
  });

  it('3: add a court date (new case) → 7d / 3d / 1d / morning-of reminders at local wall-clock times', async () => {
    const ch = await ctx.db.get(`SELECT id, name, address, phone FROM courthouses WHERE state = 'TN' ORDER BY id LIMIT 1`);
    const court = dayPlus(12);
    const r = await ctx.request().post('/api/court-dates').set(alice.headers).set('X-Timezone', 'America/Chicago')
      .send({ case_title: 'DUI — Davidson County', court_date: court, court_time: '09:30', hearing_type: 'arraignment', courthouse_id: ch.id, state: 'TN' });
    expect(r.status).toBe(201);
    cd1 = r.body; caseId = r.body.case_id;
    expect(r.body.courthouse).toEqual(expect.objectContaining({ id: Number(ch.id), name: ch.name, address: ch.address }));
    expect(r.body.courthouse.directions_url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
    expect(r.body.reminders.map(x => x.days_before).sort()).toEqual([0, 1, 3, 7]);
    const fmt = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    const minus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const at = Object.fromEntries(r.body.reminders.map(x => [x.days_before, fmt(x.deliver_at)]));
    expect(at[7]).toBe(`${minus(court, 7)}, 09:00`);
    expect(at[3]).toBe(`${minus(court, 3)}, 09:00`);
    expect(at[1]).toBe(`${minus(court, 1)}, 18:00`);
    expect(at[0]).toBe(`${court}, 06:30`);
    const rows = await ctx.db.all(`SELECT court_date_id, notification_type, deliver_at FROM scheduled_pushes WHERE case_id = ? AND status = 'pending'`, [caseId]);
    expect(rows).toHaveLength(6);
    expect(rows.every(x => Number(x.court_date_id) === cd1.id)).toBe(true);
    expect(rows.filter(x => x.notification_type === 'court_reminder')).toHaveLength(4);
    // A7: "Did you make it to court?" at 15:00 on the day; A6: the morning-after message at 09:00 the next day
    const ask = rows.find(x => x.notification_type === 'court_checkin');
    const fu = rows.find(x => x.notification_type === 'court_missed_followup');
    expect(fmt(ask.deliver_at)).toBe(`${court}, 15:00`);
    expect(fmt(fu.deliver_at)).toBe(`${minus(court, -1)}, 09:00`);
    const c = await ctx.db.get('SELECT next_court_date, title FROM cases WHERE id = ?', [caseId]);
    expect(c).toEqual({ next_court_date: court, title: 'DUI — Davidson County' });
  });

  it('3: several hearings per case, each with its own reminder set; duplicates refused; past dates archived', async () => {
    const r = await ctx.request().post('/api/court-dates').set(alice.headers).send({ case_id: caseId, court_date: dayPlus(30), hearing_type: 'pretrial' });
    expect(r.status).toBe(201);
    cd2 = r.body;
    expect(r.body.reminders).toHaveLength(4);
    const pending = await ctx.db.all(`SELECT court_date_id FROM scheduled_pushes WHERE case_id = ? AND status = 'pending' AND notification_type = 'court_reminder'`, [caseId]);
    expect(pending).toHaveLength(8);
    const dup = await ctx.request().post('/api/court-dates').set(alice.headers).send({ case_id: caseId, court_date: dayPlus(30) });
    expect(dup.status).toBe(409);
    const past = await ctx.request().post('/api/court-dates').set(alice.headers).send({ case_id: caseId, court_date: dayPlus(-20), hearing_type: 'arraignment' });
    expect(past.status).toBe(201);
    expect(past.body.reminders).toEqual([]);
    const list = await ctx.request().get('/api/court-dates').set(alice.headers).query({ case_id: caseId });
    expect(list.body.upcoming.map(x => x.id)).toEqual([cd1.id, cd2.id]);
    expect(list.body.past.map(x => x.id)).toEqual([past.body.id]);
    expect(list.body.past[0].archived).toBe(true);
    expect((await ctx.request().post('/api/court-dates').set(alice.headers).send({ court_date: '2026-02-30' })).status).toBe(400);
    expect((await ctx.request().post('/api/court-dates').set(alice.headers).send({ court_date: dayPlus(5), court_time: '25:00' })).status).toBe(400);
  });

  it('3: .ics — timed event in the user\'s zone with VTIMEZONE; all-day event for a date without a time', async () => {
    const timed = await ctx.request().get(`/api/court-dates/${cd1.id}/ics`).set(alice.headers);
    expect(timed.status).toBe(200);
    expect(timed.headers['content-type']).toMatch(/^text\/calendar/);
    expect(timed.headers['content-disposition']).toMatch(/attachment; filename="court-date-\d{4}-\d{2}-\d{2}\.ics"/);
    const t = timed.text;
    const ymd = cd1.court_date.replace(/-/g, '');
    expect(t.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(t).toContain('BEGIN:VTIMEZONE\r\nTZID:America/Chicago');
    expect(t).toContain(`DTSTART;TZID=America/Chicago:${ymd}T093000`);
    expect(t).toContain(`DTEND;TZID=America/Chicago:${ymd}T103000`);
    expect(t).toContain(`UID:court-date-${cd1.id}@justicegavel.app`);
    expect(t).toContain('SUMMARY:Court: DUI — Davidson County');
    expect(t).toContain(`LOCATION:${cd1.courthouse.name.replace(/,/g, '\\,')}`);
    expect(t).toMatch(/BEGIN:VEVENT[\s\S]*END:VEVENT\r\nEND:VCALENDAR\r\n$/);
    expect(t.split('\r\n').every(l => Buffer.byteLength(l) <= 75)).toBe(true);
    const allDay = await ctx.request().get(`/api/court-dates/${cd2.id}/ics`).set(alice.headers);
    const d = cd2.court_date.replace(/-/g, '');
    const next = new Date(Date.parse(`${cd2.court_date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
    expect(allDay.text).toContain(`DTSTART;VALUE=DATE:${d}`);
    expect(allDay.text).toContain(`DTEND;VALUE=DATE:${next}`);
    expect(allDay.text).not.toContain('VTIMEZONE');
  });

  it('3: moving a hearing re-plans only its reminders; the old rows are stale at send time', async () => {
    const before = await ctx.db.all(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending'`, [cd2.id]);
    const moved = await ctx.request().patch(`/api/court-dates/${cd2.id}`).set(alice.headers).send({ court_date: dayPlus(33) });
    expect(moved.status).toBe(200);
    expect(moved.body.reminders).toHaveLength(4);
    const old = await ctx.db.all(`SELECT status FROM scheduled_pushes WHERE id IN (${before.map(() => '?').join(',')})`, before.map(r => r.id));
    expect(old.every(r => r.status === 'cancelled')).toBe(true);
    expect((await ctx.db.all(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending'`, [cd1.id]))).toHaveLength(6);
    await ctx.db.run(`UPDATE scheduled_pushes SET status = 'pending', error = NULL WHERE id = ?`, [before[0].id]);
    expo.received.length = 0;
    const stale = await deliverNow(before[0].id);
    expect(stale).toEqual(expect.objectContaining({ status: 'cancelled', error: 'court_date_changed' }));
    expect(expo.received).toHaveLength(0);
  });

  it('3: a due reminder goes out by push; "missed" cancels the rest and returns guidance ending with "call your lawyer or the court clerk"', async () => {
    await ctx.request().post('/api/push/token').set(alice.headers).send({ token: 'ExponentPushToken[core-path-alice]' });
    const rem = await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [cd1.id]);
    expo.received.length = 0;
    const sent = await deliverNow(rem.id);
    expect(sent).toEqual(expect.objectContaining({ status: 'sent', channel: 'push' }));
    expect(expo.received.find(m => m.to === 'ExponentPushToken[core-path-alice]').data).toEqual(expect.objectContaining({ type: 'court_reminder', court_date_id: cd1.id }));

    const extra = await ctx.request().post('/api/court-dates').set(alice.headers).send({ case_id: caseId, court_date: dayPlus(8), hearing_type: 'status' });
    const missed = await ctx.request().patch(`/api/court-dates/${extra.body.id}`).set(alice.headers).send({ status: 'missed' });
    expect(missed.status).toBe(200);
    expect(missed.body.reminders).toEqual([]);
    expect(missed.body.guidance.steps.at(-1).text).toBe('Call your lawyer or the court clerk.');
    expect(missed.body.guidance.steps.every(s => typeof s.source === 'string' && s.source.length)).toBe(true);
    const left = await ctx.db.get(`SELECT COUNT(*) AS n FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending'`, [extra.body.id]);
    expect(Number(left.n)).toBe(0);
    const g = await ctx.request().get('/api/court-dates/guidance');
    expect(g.status).toBe(200);
    expect(g.body.checklist.wear[0].text).toMatch(/No orange/);
    const del = await ctx.request().delete(`/api/court-dates/${extra.body.id}`).set(alice.headers);
    expect(del.status).toBe(200);
  });

  it('3: a push Expo accepted but whose receipt failed is handed back and goes to the next channel (never counted as delivered)', async () => {
    const { requeueAfterPushReceiptFailure } = await import('../../services/reminderDispatcher.js');
    const rem = await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [cd1.id]);
    const sent = await deliverNow(rem.id);
    expect(sent).toEqual(expect.objectContaining({ status: 'sent', channel: 'push' }));
    const { expo_ticket_id: ticket } = await ctx.db.get('SELECT expo_ticket_id FROM scheduled_pushes WHERE id = ?', [rem.id]);
    expect(ticket).toBeTruthy();
    // e.g. APNs/FCM credentials missing in EAS → receipt { status: 'error', details: { error: 'InvalidCredentials' } }
    expect(await requeueAfterPushReceiptFailure(ctx.db, [{ ticket_id: ticket, error: 'InvalidCredentials' }])).toBe(1);
    const back = await ctx.db.get('SELECT status, delivered, data FROM scheduled_pushes WHERE id = ?', [rem.id]);
    expect(back.status).toBe('pending');
    expect(Number(back.delivered)).toBe(0);
    expect(JSON.parse(back.data)).toEqual(expect.objectContaining({ skip_push: true, push_receipt_error: 'InvalidCredentials' }));
    // No e-mail provider and no texts in this test → undeliverable with the real reason (not retried by push)
    expo.received.length = 0;
    const after = await deliverNow(rem.id);
    expect(after.status).toBe('undeliverable');
    expect(after.error).toMatch(/push_receipt: InvalidCredentials/);
    expect(expo.received).toHaveLength(0);
    // handled once: a second receipt for the same ticket changes nothing
    expect(await requeueAfterPushReceiptFailure(ctx.db, [{ ticket_id: ticket, error: 'InvalidCredentials' }])).toBe(0);
  });

  it('3: IDOR — another user cannot read, change, export or add to my court dates', async () => {
    const s = bob.headers;
    expect((await ctx.request().get(`/api/court-dates/${cd1.id}`).set(s)).status).toBe(404);
    expect((await ctx.request().patch(`/api/court-dates/${cd1.id}`).set(s).send({ status: 'cancelled' })).status).toBe(404);
    expect((await ctx.request().delete(`/api/court-dates/${cd1.id}`).set(s)).status).toBe(404);
    expect((await ctx.request().get(`/api/court-dates/${cd1.id}/ics`).set(s)).status).toBe(404);
    expect((await ctx.request().get(`/api/court-dates/${cd1.id}/reminders`).set(s)).status).toBe(404);
    expect((await ctx.request().post('/api/court-dates').set(s).send({ case_id: caseId, court_date: dayPlus(40) })).status).toBe(404);
    const theirs = await ctx.request().get('/api/court-dates').set(s);
    expect([...theirs.body.upcoming, ...theirs.body.past].some(x => x.case_id === caseId)).toBe(false);
    const mine = await ctx.db.get(`SELECT status, deleted_at FROM court_dates WHERE id = ?`, [cd1.id]);
    expect(mine).toEqual({ status: 'scheduled', deleted_at: null });
  });

  it('3: fallback chain — no device → SMS when Telnyx is configured and the user opted in; otherwise undeliverable', async () => {
    const r = await ctx.request().post('/api/court-dates').set(dave.headers).send({ case_title: 'Dave case', court_date: dayPlus(6) });
    const pick = async () => (await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [r.body.id])).id;
    // Telnyx not configured → texts are skipped cleanly; no e-mail provider → undeliverable (never "sent")
    const noSms = await deliverNow(await pick());
    expect(noSms).toEqual(expect.objectContaining({ status: 'undeliverable', channel: null }));
    expect(noSms.error).toMatch(/sms_not_configured/);
    // configured, opted in
    Object.assign(process.env, {
      TELNYX_API_KEY: 'KEYjgtest', TELNYX_FROM_NUMBER: '+16155550000',
      TELNYX_API_BASE: `http://127.0.0.1:${telnyx.server.address().port}`,
    });
    expect((await ctx.request().put('/api/court-dates/preferences').set(dave.headers).send({ sms_reminders: true })).status).toBe(400); // no phone yet
    const pref = await ctx.request().put('/api/court-dates/preferences').set(dave.headers).send({ sms_reminders: true, phone: '(615) 555-0142' });
    expect(pref.body).toEqual(expect.objectContaining({ ok: true, sms_available: true }));
    const viaSms = await deliverNow(await pick());
    expect(viaSms).toEqual(expect.objectContaining({ status: 'sent', channel: 'sms' }));
    const msg = telnyx.received.at(-1);
    expect(msg.url).toBe('/messages');
    expect(msg.auth).toBe('Bearer KEYjgtest');
    expect(msg.json).toEqual(expect.objectContaining({ to: '+16155550142', from: '+16155550000' }));
    expect(msg.json.text).toMatch(/^Justice Gavel: .*court is tomorrow.*a warrant can be issued.*Reply STOP to opt out\.$/);
    // consent was recorded (migration 31)
    const consent = await ctx.db.get('SELECT sms_consent_at, sms_consent_phone, sms_consent_text_v FROM users WHERE id = ?', [dave.user?.id ?? dave.id]);
    expect(consent.sms_consent_at).toBeTruthy();
    expect(consent.sms_consent_phone).toBe('+16155550142');
    // opted out → back to e-mail
    await ctx.request().put('/api/court-dates/preferences').set(dave.headers).send({ sms_reminders: false });
    const optedOut = await deliverNow(await pick());
    expect(optedOut.status).toBe('undeliverable');
    expect(optedOut.error).toMatch(/sms_not_opted_in/);
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE']) delete process.env[k];
  });

  // ── 4. Family followers ───────────────────────────────────────────────────
  let invite; let followId;
  it('4: sharing needs the owner\'s explicit consent; strangers get 404', async () => {
    await ctx.request().put(`/api/cases/${caseId}`).set(alice.headers).send({ notes: 'SECRET NOTE: I was at the bar until 2am' });
    await ctx.db.run(`UPDATE cases SET charge = 'JGTEST-CHARGE DUI 2nd' WHERE id = ?`, [caseId]);
    const noConsent = await ctx.request().post(`/api/cases/${caseId}/followers`).set(alice.headers).send({ email: carol.email });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.code).toBe('consent_required');
    expect((await ctx.request().post(`/api/cases/${caseId}/followers`).set(bob.headers).send({ consent: true })).status).toBe(404);
    const ok = await ctx.request().post(`/api/cases/${caseId}/followers`).set(alice.headers).send({ consent: true, email: carol.email, name: 'Mom' });
    expect(ok.status).toBe(201);
    expect(ok.body.invite_code).toMatch(/^[A-Z2-9]{10}$/);
    invite = ok.body;
    const row = await ctx.db.get('SELECT invite_code_hash, owner_consent_at, status FROM case_family_access WHERE id = ?', [invite.id]);
    expect(row.status).toBe('pending');
    expect(row.owner_consent_at).toBeTruthy();
    expect(row.invite_code_hash).not.toContain(invite.invite_code);   // only the hash is stored
  });

  it('4: the follower accepts and sees the court dates — never notes or charges — and gets reminders', async () => {
    expect((await ctx.request().post('/api/following/accept').set(alice.headers).send({ code: invite.invite_code })).status).toBe(400); // own case
    const acc = await ctx.request().post('/api/following/accept').set(carol.headers).send({ code: invite.invite_code.toLowerCase().replace(/(.{5})/, '$1-') });
    expect(acc.status).toBe(201);
    followId = acc.body.following.follow_id;
    expect((await ctx.request().post('/api/following/accept').set(dave.headers).send({ code: invite.invite_code })).status).toBe(404); // single use
    const f = await ctx.request().get('/api/following').set(carol.headers);
    expect(f.status).toBe(200);
    const c = f.body.following.find(x => x.case_id === caseId);
    expect(c.case_title).toBe('DUI — Davidson County');
    expect(c.owner_first_name).toBe('Alice');
    expect(c.court_dates.map(d => d.id)).toEqual(expect.arrayContaining([cd1.id, cd2.id]));
    expect(c.court_dates.find(d => d.id === cd1.id).courthouse.name).toEqual(expect.any(String));
    const blob = JSON.stringify(f.body);
    expect(blob).not.toMatch(/SECRET NOTE|bar until 2am|JGTEST-CHARGE/);
    expect(blob).not.toContain('"notes"');
    const legacy = await ctx.request().get('/api/cases/family').set(carol.headers);
    expect(JSON.stringify(legacy.body)).not.toMatch(/SECRET NOTE|JGTEST-CHARGE/);
    expect(legacy.body.find(x => x.id === caseId).court_dates.length).toBeGreaterThan(0);

    const rem = await ctx.db.all(`SELECT court_date_id FROM scheduled_pushes WHERE user_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending'`, [carol.user.id]);
    expect(rem.length).toBe(8);   // two upcoming hearings × 4
    // the follower's reminders track a new hearing added later, too
    const later = await ctx.request().post('/api/court-dates').set(alice.headers).send({ case_id: caseId, court_date: dayPlus(45) });
    const rem2 = await ctx.db.get(`SELECT COUNT(*) AS n FROM scheduled_pushes WHERE user_id = ? AND court_date_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending'`, [carol.user.id, later.body.id]);
    expect(Number(rem2.n)).toBe(4);
    const one = await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE user_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [carol.user.id]);
    await ctx.request().post('/api/push/token').set(carol.headers).send({ token: 'ExponentPushToken[core-path-carol]' });
    const sent = await deliverNow(one.id);
    expect(sent).toEqual(expect.objectContaining({ status: 'sent', channel: 'push' }));
  });

  it('4: the follower cannot reach anything else of the case (no notes, events, messages, court-date edits)', async () => {
    const s = carol.headers;
    expect((await ctx.request().get(`/api/court-dates/${cd1.id}`).set(s)).status).toBe(404);
    expect((await ctx.request().patch(`/api/court-dates/${cd1.id}`).set(s).send({ status: 'cancelled' })).status).toBe(404);
    expect((await ctx.request().get(`/api/court-dates/${cd1.id}/ics`).set(s)).status).toBe(404);
    expect((await ctx.request().get(`/api/cases/${caseId}/events`).set(s)).status).toBe(404);
    expect((await ctx.request().get(`/api/cases/${caseId}/followers`).set(s)).status).toBe(404);
    expect((await ctx.request().put(`/api/cases/${caseId}`).set(s).send({ title: 'hijack' })).status).toBe(404);
    const msgs = await ctx.request().get(`/api/messages/${caseId}`).set(s);
    expect([403, 404]).toContain(msgs.status);
    const list = await ctx.request().get('/api/cases').set(s);
    expect(JSON.stringify(list.body)).not.toMatch(/SECRET NOTE/);
    // a stranger can neither list nor revoke the owner's followers
    expect((await ctx.request().delete(`/api/cases/${caseId}/followers/${followId}`).set(dave.headers)).status).toBe(404);
    expect((await ctx.request().delete(`/api/following/${followId}`).set(dave.headers)).status).toBe(404);
  });

  it('4: the owner revokes → the follower loses access and pending reminders; a stale follower row is cancelled at send time', async () => {
    const owners = await ctx.request().get(`/api/cases/${caseId}/followers`).set(alice.headers);
    expect(owners.body.find(x => x.id === followId)).toEqual(expect.objectContaining({ status: 'active', share_reminders: true }));
    const stale = await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE user_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [carol.user.id]);
    const rev = await ctx.request().delete(`/api/cases/${caseId}/followers/${followId}`).set(alice.headers);
    expect(rev.status).toBe(200);
    const pending = await ctx.db.get(`SELECT COUNT(*) AS n FROM scheduled_pushes WHERE user_id = ? AND notification_type = 'follower_court_reminder' AND status = 'pending'`, [carol.user.id]);
    expect(Number(pending.n)).toBe(0);
    expect((await ctx.request().get('/api/following').set(carol.headers)).body.following.some(x => x.case_id === caseId)).toBe(false);
    await ctx.db.run(`UPDATE scheduled_pushes SET status = 'pending', error = NULL WHERE id = ?`, [stale.id]);
    const r = await deliverNow(stale.id);
    expect(r).toEqual(expect.objectContaining({ status: 'cancelled', error: 'follow_revoked' }));
  });

  it('4: the follower can leave on their own; a closed case stops everyone\'s reminders', async () => {
    const inv = await ctx.request().post(`/api/cases/${caseId}/followers`).set(alice.headers).send({ consent: true, share_reminders: true });
    const acc = await ctx.request().post('/api/following/accept').set(carol.headers).send({ code: inv.body.invite_code });
    expect(acc.status).toBe(201);
    const leave = await ctx.request().delete(`/api/following/${acc.body.following.follow_id}`).set(carol.headers);
    expect(leave.status).toBe(200);
    expect((await ctx.request().get('/api/following').set(carol.headers)).body.following).toEqual([]);
    await ctx.request().put(`/api/cases/${caseId}`).set(alice.headers).send({ status: 'Closed' });
    const n = await ctx.db.get(`SELECT COUNT(*) AS n FROM scheduled_pushes WHERE case_id = ? AND status = 'pending' AND notification_type IN ('court_reminder', 'follower_court_reminder')`, [caseId]);
    expect(Number(n.n)).toBe(0);
    expect(await providerMd5()).toBe(md5Before);
  });
});
