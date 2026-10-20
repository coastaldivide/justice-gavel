/**
 * cases_court_d.int.test.js — section D (cases & court) regressions on the
 * real app + real Postgres:
 *
 *   D1  court reminders (7 d / 3 d / 1 d / morning of) land on the right local
 *       wall-clock time in six zones, across DST changes (US fall-back and
 *       spring-forward, UK, Sydney), are written in the person's language, a
 *       late-added date is reminded right away, and the dispatcher claims each
 *       row only once its instant has come
 *   D2  a court date is the same calendar day whatever zone the phone is in;
 *       the .ics file is valid RFC 5545 (CRLF, folded lines, VTIMEZONE), uses the
 *       COURT's zone for a timed hearing and has alarms in the person's language
 *   D3  deleting a case ends everything shared from it (follows, share link,
 *       messages, documents); a deleted case cannot be edited; errors are in the
 *       request's language; an event date must be a real date (was a 500)
 *   D4  check-ins: only bail agents enroll; the defendant finds the enrollment by
 *       their account's e-mail; "today" is the defendant's day (an 11:30 PM
 *       check-in in Chicago is not tomorrow's); one per day; the bail agent is
 *       notified; the reminder is planned at 10:00 / 18:00 local in the
 *       defendant's language and dropped once they checked in; compliance math
 *   D5  messages: newest-last order with ties broken by id, unread per thread and
 *       for counsel, counsel flow (invite → accept → reply); case documents open
 *       for the owner and active counsel only — never for a family follower, a
 *       stranger or revoked counsel
 *   D6  family emergency connection: 503 without Stripe; with Stripe (fake
 *       client) quote → PaymentIntent → contacts only after a verified payment,
 *       booked once, someone else's payment is a 404
 *   D7  matter analytics no longer answer for someone else's matter
 */
import { jest } from '@jest/globals';
import { describeIntegration, initSuite } from './_harness.js';

const fake = { pis: new Map(), seq: 0 };
jest.unstable_mockModule('stripe', () => ({
  default: class FakeStripe {
    constructor() {
      this.paymentIntents = {
        create: async (params) => {
          const id = `pi_d_${++fake.seq}`;
          const pi = { id, client_secret: `${id}_secret`, amount: params.amount, status: 'requires_payment_method', metadata: params.metadata };
          fake.pis.set(id, pi);
          return pi;
        },
        retrieve: async (id) => fake.pis.get(id) || null,
      };
      this.customers = { create: async () => ({ id: 'cus_d' }), list: async () => ({ data: [] }) };
    }
  },
}));

// The billing module creates its Stripe client (the fake above) when it is first
// imported; D6 switches the key off to check the 503 and back on for the paid path.
const STRIPE_KEY = 'sk_test_section_d';

describeIntegration('section D — cases, court dates, check-ins, messages (real Postgres)', () => {
  beforeAll(() => { process.env.STRIPE_SECRET_KEY = STRIPE_KEY; });
  afterAll(() => { delete process.env.STRIPE_SECRET_KEY; });
  const ctx = initSuite();
  const svc = {};
  let owner, other, follower, agent, defendant, attorney;
  const req = (m, path, user, lang) => {
    let r = ctx.request()[m](path);
    if (user) r = r.set(user.headers);
    if (lang) r = r.set('Accept-Language', lang);
    return r;
  };

  beforeAll(async () => {
    if (!ctx.app) return;
    svc.court = await import('../../services/courtReminders.js');
    svc.dispatch = await import('../../services/reminderDispatcher.js');
    svc.checkin = await import('../../services/checkinReminders.js');
    svc.ics = await import('../../services/ics.js');
    [owner, other, follower, defendant] = await Promise.all(['Owner', 'Other', 'Follower', 'Defendant'].map(n => ctx.register({ displayName: `D ${n}` })));
    agent = await ctx.register({ displayName: 'D Agent', accountType: 'bail_agent' });
    attorney = await ctx.register({ displayName: 'D Attorney', accountType: 'attorney' });
  });

  /** A case + one hearing for a user whose zone/language we set; returns { caseId, courtDateId }. */
  async function hearing(user, { tz, lang = 'en', date, time = null, state = null }) {
    await ctx.db.run('UPDATE users SET timezone = ?, preferred_language = ? WHERE id = ?', [tz, lang, user.user.id]);
    const c = await ctx.db.get(`INSERT INTO cases (user_id, title, status, state, notes, updated_at) VALUES (?, 'Reminder case', 'Open', ?, '', NOW()) RETURNING id`, [user.user.id, state]);
    const cd = await ctx.db.get(`INSERT INTO court_dates (case_id, user_id, court_date, court_time) VALUES (?, ?, CAST(? AS date), CAST(? AS time)) RETURNING id`,
      [c.id, user.user.id, date, time]);
    return { caseId: Number(c.id), courtDateId: Number(cd.id) };
  }
  const plan = async (courtDateId, now) => (await svc.court.scheduleForCourtDate(ctx.db, courtDateId, new Date(now))).reminders.map(r => r.deliver_at);

  // ── D1 ────────────────────────────────────────────────────────────────────
  test.each([
    ['America/New_York (fall back Nov 1)', 'America/New_York', '2026-11-03', ['2026-10-27T13:00:00.000Z', '2026-10-31T13:00:00.000Z', '2026-11-02T23:00:00.000Z', '2026-11-03T11:30:00.000Z']],
    ['America/Los_Angeles (spring forward Mar 14)', 'America/Los_Angeles', '2027-03-15', ['2027-03-08T17:00:00.000Z', '2027-03-12T17:00:00.000Z', '2027-03-15T01:00:00.000Z', '2027-03-15T13:30:00.000Z']],
    ['Europe/London (BST ends Oct 25)', 'Europe/London', '2026-10-27', ['2026-10-20T08:00:00.000Z', '2026-10-24T08:00:00.000Z', '2026-10-26T18:00:00.000Z', '2026-10-27T06:30:00.000Z']],
    ['Pacific/Honolulu', 'Pacific/Honolulu', '2026-12-01', ['2026-11-24T19:00:00.000Z', '2026-11-28T19:00:00.000Z', '2026-12-01T04:00:00.000Z', '2026-12-01T16:30:00.000Z']],
    ['Asia/Tokyo', 'Asia/Tokyo', '2026-12-01', ['2026-11-24T00:00:00.000Z', '2026-11-28T00:00:00.000Z', '2026-11-30T09:00:00.000Z', '2026-11-30T21:30:00.000Z']],
    ['Australia/Sydney (DST starts Oct 4)', 'Australia/Sydney', '2026-10-05', ['2026-09-27T23:00:00.000Z', '2026-10-01T23:00:00.000Z', '2026-10-04T07:00:00.000Z', '2026-10-04T19:30:00.000Z']],
  ])('D1 %s: 7 d 9:00, 3 d 9:00, 1 d 18:00, morning-of 6:30 local', async (_label, tz, date, expected) => {
    if (!ctx.app) return;
    const { courtDateId } = await hearing(owner, { tz, date });
    expect(await plan(courtDateId, '2026-09-01T00:00:00Z')).toEqual(expected);
  });

  test('D1 text is in the person\'s language; a date added the evening before is reminded at once', async () => {
    if (!ctx.app) return;
    const { courtDateId } = await hearing(owner, { tz: 'America/Chicago', lang: 'vi', date: '2026-11-10', time: '09:30' });
    const rows = (await svc.court.scheduleForCourtDate(ctx.db, courtDateId, new Date('2026-09-01T00:00:00Z'))).reminders;
    expect(rows.map(r => r.title)).toEqual(expect.arrayContaining([expect.stringMatching(/7 ngày/), expect.stringMatching(/NGÀY MAI|ngày mai/i)]));
    expect(rows[3].body).toMatch(/9:30|09:30/);
    // 20:00 CST the evening before: the 18:00 one is gone, the morning one remains (6:30 tomorrow)
    const late = await plan(courtDateId, '2026-11-10T02:00:00Z');
    expect(late).toEqual(['2026-11-10T12:30:00.000Z']);
    // 7:00 on the day itself: nothing left in the plan → one immediate reminder
    const now = '2026-11-10T13:00:00.000Z';
    expect(await plan(courtDateId, now)).toEqual([now]);
    await ctx.db.run('UPDATE users SET preferred_language = NULL WHERE id = ?', [owner.user.id]);
  });

  test('D1 the dispatcher sends a reminder at its instant, not before', async () => {
    if (!ctx.app) return;
    const { courtDateId } = await hearing(owner, { tz: 'America/New_York', date: '2026-11-03' });
    await plan(courtDateId, '2026-09-01T00:00:00Z');
    const first = await ctx.db.get(`SELECT id, deliver_at FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [courtDateId]);
    expect(new Date(first.deliver_at).toISOString()).toBe('2026-10-27T13:00:00.000Z');
    // keep every other pending row out of this run
    await ctx.db.run(`UPDATE scheduled_pushes SET deliver_at = deliver_at + INTERVAL '10 years' WHERE status = 'pending' AND id <> ?`, [first.id]);
    await svc.dispatch.dispatchDueReminders({ db: ctx.db, now: new Date('2026-10-27T12:59:00Z') });
    expect((await ctx.db.get('SELECT status FROM scheduled_pushes WHERE id = ?', [first.id])).status).toBe('pending');
    await svc.dispatch.dispatchDueReminders({ db: ctx.db, now: new Date('2026-10-27T13:00:00Z') });
    // no push token / e-mail provider in the test → undeliverable (never a fake "sent"), but it was handled on time
    expect((await ctx.db.get('SELECT status FROM scheduled_pushes WHERE id = ?', [first.id])).status).toBe('undeliverable');
    await ctx.db.run(`UPDATE scheduled_pushes SET deliver_at = deliver_at - INTERVAL '10 years' WHERE status = 'pending' AND deliver_at > NOW() + INTERVAL '9 years'`);
  });

  // ── D2 ────────────────────────────────────────────────────────────────────
  test('D2 the court day never shifts with the phone\'s zone; .ics is valid and in the court\'s zone', async () => {
    if (!ctx.app) return;
    const c = await req('post', '/api/cases', owner).set('X-Timezone', 'Pacific/Honolulu').send({ title: 'Zone case', state: 'TN' });
    expect(c.status).toBe(201);
    const cd = await req('post', '/api/court-dates', owner, 'es').set('X-Timezone', 'Pacific/Honolulu')
      .send({ case_id: c.body.id, court_date: '2026-12-14', court_time: '09:30', hearing_type: 'arraignment' });
    expect(cd.status).toBe(201);
    for (const tz of ['Pacific/Honolulu', 'Asia/Tokyo', 'America/New_York']) {
      const r = await req('get', `/api/court-dates/${cd.body.id}`, owner).set('X-Timezone', tz);
      expect(r.body.court_date).toBe('2026-12-14');
      expect(r.body.court_time).toBe('09:30');
    }
    const ics = await req('get', `/api/court-dates/${cd.body.id}/ics?lang=es`, owner).buffer(true).parse((res, cb) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', x => { d += x; }); res.on('end', () => cb(null, d));
    });
    const text = ics.body;
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/\n/);
    expect(text).toMatch(/BEGIN:VTIMEZONE\r\nTZID:America\/Chicago/);       // Tennessee court, not the phone's Honolulu
    expect(text).toMatch(/DTSTART;TZID=America\/Chicago:20261214T093000/);
    expect(text).toMatch(/DESCRIPTION:Corte mañana: Zone case/);
    expect(text).not.toMatch(/ tomorrow| in 2 hours/);
    expect((text.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
    // all-day when there is no time: the day itself, next day as the exclusive end
    const plain = svc.ics.buildCourtDateIcs({ uid: 'x@y', courtDate: '2026-12-31', summary: 'A, B; C' });
    expect(plain).toMatch(/DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
    expect(plain).toMatch(/SUMMARY:A\\, B\\; C/);
  });

  // ── D3 ────────────────────────────────────────────────────────────────────
  test('D3 deleting a case ends its follows, share link, messages and documents', async () => {
    if (!ctx.app) return;
    const c = await req('post', '/api/cases', owner).send({ title: 'To delete', next_court_date: '2026-12-20' });
    const id = c.body.id;
    const bad = await req('post', `/api/cases/${id}/events`, owner, 'es').send({ title: 'Audiencia', event_date: 'mañana' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/AAAA-MM-DD/);
    const inv = await req('post', `/api/cases/${id}/followers`, owner).send({ consent: true });
    expect((await req('post', '/api/following/accept', follower).send({ code: inv.body.invite_code })).status).toBe(201);
    const share = await req('post', `/api/cases/${id}/share`, owner);
    expect(share.body.share_url).toBeUndefined();
    const up = await req('post', '/api/messages/attachment', owner).field('case_id', String(id))
      .attach('file', Buffer.from('%PDF-1.4\n%test\n'), 'charge.pdf');
    expect(up.status).toBe(201);
    expect((await req('delete', `/api/cases/${id}`, other)).status).toBe(404);
    expect((await req('delete', `/api/cases/${id}`, owner)).status).toBe(200);
    expect((await req('get', '/api/following', follower)).body.following.find(f => f.case_id === id)).toBeUndefined();
    expect((await req('get', `/api/cases/shared/${share.body.token}`)).status).toBe(404);
    expect((await req('get', `/api/messages/${id}`, owner)).status).toBe(404);
    expect((await req('get', `/api/messages/attachment/${up.body.id}`, owner)).status).toBe(404);
    const edit = await req('put', `/api/cases/${id}`, owner, 'pt').send({ title: 'zombie' });
    expect(edit.status).toBe(404);
    expect(edit.body.error).toBe('Caso não encontrado.');
    expect((await req('delete', `/api/cases/${id}`, owner)).status).toBe(404);
  });

  // ── D4 ────────────────────────────────────────────────────────────────────
  test('D4 check-ins: agents only, found by e-mail, the defendant\'s day, one per day, agent notified', async () => {
    if (!ctx.app) return;
    expect((await req('post', '/api/checkins/enroll', owner).send({ defendant_name: 'X Y', defendant_email: defendant.email })).status).toBe(403);
    const noContact = await req('post', '/api/checkins/enroll', agent, 'es').send({ defendant_name: 'X Y' });
    expect(noContact.status).toBe(400);
    expect(noContact.body.error).toMatch(/teléfono o el correo/);
    const en = await req('post', '/api/checkins/enroll', agent).send({ defendant_name: 'Dana Defendant', defendant_email: defendant.email.toUpperCase(), check_in_freq: 'daily' });
    expect(en.status).toBe(201);
    expect(en.body.checkin_link).toMatch(/\/checkin\?enrollmentId=\d+$/);
    expect(en.body.enrollment.stripe_sub_id ?? null).toBeNull();
    const eid = en.body.enrollment.id;
    expect((await req('get', `/api/checkins/status/${eid}`, other)).status).toBe(404);
    const mine = await req('get', '/api/checkins/mine', defendant).set('X-Timezone', 'America/Chicago').set('Accept-Language', 'vi');
    expect(mine.body.enrollments.map(e => e.id)).toEqual([eid]);
    expect(mine.body.enrollments[0].agent_name).toBe('D Agent');
    // planned reminder: 10:00 / 18:00 Chicago in Vietnamese
    const st = await ctx.db.get(`SELECT title, deliver_at FROM scheduled_pushes WHERE notification_type = 'checkin_reminder' AND user_id = ? AND status = 'pending'`, [defendant.user.id]);
    expect(st.title).toMatch(/điểm danh/);
    const local = new Date(st.deliver_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false });
    expect(['10:00', '18:00']).toContain(local);

    // the local day: 23:30 Chicago on Oct 19 is 04:30Z on Oct 20
    const e = await ctx.db.get('SELECT * FROM checkin_enrollments WHERE id = ?', [eid]);
    await ctx.db.run(`INSERT INTO checkin_records (enrollment_id, user_id, status, checked_in_at) VALUES (?, ?, 'submitted', '2026-10-20T04:30:00Z')`, [eid, defendant.user.id]);
    expect((await svc.checkin.checkinState(ctx.db, e, new Date('2026-10-20T04:45:00Z'))).done).toBe(true);     // still Oct 19 in Chicago
    const nextDay = await svc.checkin.checkinState(ctx.db, e, new Date('2026-10-20T05:30:00Z'));                // 00:30 on Oct 20
    expect(nextDay.done).toBe(false);
    expect(nextDay.today).toBe('2026-10-20');
    expect(nextDay.last_day).toBe('2026-10-19');
    // reminder for Oct 20 not done at 11:00 → 18:00 CDT; the dispatcher drops it once checked in
    const p = await svc.checkin.planCheckinReminder(ctx.db, eid, new Date('2026-10-20T16:00:00Z'));
    expect(p.deliver_at).toBe('2026-10-20T23:00:00.000Z');
    await ctx.db.run(`INSERT INTO checkin_records (enrollment_id, user_id, status, checked_in_at) VALUES (?, ?, 'submitted', '2026-10-20T17:00:00Z')`, [eid, defendant.user.id]);
    const row = await ctx.db.get(`SELECT * FROM scheduled_pushes WHERE notification_type = 'checkin_reminder' AND user_id = ? AND status = 'pending'`, [defendant.user.id]);
    expect(await svc.checkin.checkinReminderStale(ctx.db, row, JSON.parse(row.data), new Date('2026-10-20T23:00:00Z'))).toBe('already_checked_in');
    // compliance over Oct 19–20 for an enrollment created Oct 19: 2 of 2
    await ctx.db.run(`UPDATE checkin_enrollments SET created_at = '2026-10-19T15:00:00Z' WHERE id = ?`, [eid]);
    const c = await svc.checkin.compliance(ctx.db, { ...e, created_at: '2026-10-19T15:00:00Z' }, { now: new Date('2026-10-21T03:00:00Z') });
    expect(c).toEqual({ expected: 2, completed: 2, missed: 0, rate: 100 });
    const c2 = await svc.checkin.compliance(ctx.db, { ...e, created_at: '2026-10-19T15:00:00Z' }, { now: new Date('2026-10-22T20:00:00Z') });
    expect(c2).toMatchObject({ completed: 2, missed: 1 });   // Oct 21 missed, Oct 22 still open
    await ctx.db.run('DELETE FROM checkin_records WHERE enrollment_id = ?', [eid]);

    // the real submit: once a day, the agent hears about it
    const s1 = await req('post', '/api/checkins/submit', defendant).send({ enrollment_id: eid, lat: 36.16, lng: -86.78 });
    expect(s1.status).toBe(201);
    const s2 = await req('post', '/api/checkins/submit', defendant, 'es').send({ enrollment_id: eid });
    expect(s2.status).toBe(409);
    expect(s2.body.error).toBe('Ya se registró hoy.');
    expect((await req('post', '/api/checkins/submit', other).send({ enrollment_id: eid })).status).toBe(404);
    const hist = await req('get', `/api/checkins/history/${eid}`, agent);
    expect(hist.body.records[0].lat).toBeCloseTo(36.16);
    expect(hist.body.enrollment.user_id).toBeUndefined();
    expect((await req('get', `/api/checkins/history/${eid}`, defendant)).status).toBe(404);
    // "Check-in reminders" off in Settings: the reminder is not sent
    const later = await svc.checkin.planCheckinReminder(ctx.db, eid, new Date(Date.now() + 2 * 86_400_000));
    const planned = await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE notification_type = 'checkin_reminder' AND user_id = ? AND status = 'pending' AND deliver_at = ?`, [defendant.user.id, later.deliver_at]);
    await ctx.db.run('UPDATE users SET notif_checkin_reminders = 0 WHERE id = ?', [defendant.user.id]);
    await svc.dispatch.dispatchDueReminders({ db: ctx.db, now: new Date(later.deliver_at) });
    expect(await ctx.db.get('SELECT status, error FROM scheduled_pushes WHERE id = ?', [planned.id])).toEqual({ status: 'skipped', error: 'user_preference' });
    expect(await svc.checkin.planCheckinReminder(ctx.db, eid, new Date(Date.now() + 3 * 86_400_000))).toBeNull();   // and none is planned while off
    expect((await req('put', `/api/checkins/enrollments/${eid}`, agent).send({ active: false })).status).toBe(200);
    expect(await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE notification_type = 'checkin_reminder' AND user_id = ? AND status = 'pending'`, [defendant.user.id])).toBeUndefined();
  });

  // ── D5 ────────────────────────────────────────────────────────────────────
  test('D5 messages: order, unread, counsel flow, document permissions', async () => {
    if (!ctx.app) return;
    const c = await req('post', '/api/cases', owner).send({ title: 'Messages case' });
    const id = c.body.id;
    const inv = await req('post', `/api/cases/${id}/followers`, owner).send({ consent: true });
    await req('post', '/api/following/accept', follower).send({ code: inv.body.invite_code });
    // two messages in the same instant come back in the order they were written
    const at = '2026-10-01T12:00:00Z';
    await ctx.db.run(`INSERT INTO case_messages (case_id, sender_id, sender_type, body, message_type, sent_at) VALUES (?, ?, 'user', 'first', 'chat', ?), (?, ?, 'user', 'second', 'chat', ?)`,
      [id, owner.user.id, at, id, owner.user.id, at]);
    expect((await req('get', `/api/messages/${id}`, owner)).body.messages.map(m => m.body)).toEqual(['first', 'second']);
    // counsel: invite by account, accept, reply
    const ci = await req('post', `/api/cases/${id}/counsel`, owner).send({ attorney_user_id: attorney.user.id });
    expect(ci.status).toBe(201);
    expect((await req('get', `/api/messages/${id}`, attorney)).status).toBe(403);      // pending is not counsel yet
    expect((await req('post', `/api/attorney/inbox/accept/${ci.body.assignment_id}`, attorney)).status).toBe(200);
    expect((await req('get', '/api/messages/unread/count', attorney)).body.count).toBe(2);
    const reply = await req('post', `/api/messages/${id}`, attorney).send({ body: '<b>Hi</b> & welcome' });
    expect(reply.body.message.body).toBe('<b>Hi</b> & welcome');                       // stored as typed; the app shows plain text
    const threads = await req('get', '/api/messages/threads', owner);
    expect(threads.body.threads.find(t => t.case_id === id)).toMatchObject({ unread: 1, counsel_count: 1, role: 'client' });
    expect((await req('get', `/api/messages/${id}`, owner)).body.messages.at(-1).sender_type).toBe('attorney');
    expect((await req('get', '/api/messages/threads', owner)).body.threads.find(t => t.case_id === id).unread).toBe(0);
    // the client cannot delete the attorney's message; the attorney can
    expect((await req('delete', `/api/messages/${reply.body.message.id}`, owner)).status).toBe(403);
    // documents
    const up = await req('post', '/api/messages/attachment', owner).field('case_id', String(id)).attach('file', Buffer.from('%PDF-1.4\n%doc\n'), 'bail slip.pdf');
    expect(up.status).toBe(201);
    const exe = await req('post', '/api/messages/attachment', owner).field('case_id', String(id)).attach('file', Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00'), 'x.pdf');
    expect(exe.status).toBe(415);
    expect((await req('get', `/api/messages/attachment/${up.body.id}`, owner)).status).toBe(200);
    expect((await req('get', `/api/messages/attachment/${up.body.id}`, attorney)).status).toBe(200);
    expect((await req('get', `/api/messages/attachment/${up.body.id}`, follower)).status).toBe(404);
    expect((await req('get', `/api/messages/attachment/${up.body.id}`, other)).status).toBe(404);
    expect((await req('get', `/api/messages/${id}`, follower)).status).toBe(404);
    expect((await req('delete', `/api/cases/${id}/counsel/${attorney.user.id}`, owner)).status).toBe(200);
    expect((await req('get', `/api/messages/attachment/${up.body.id}`, attorney)).status).toBe(404);
    // the uploader deleting the message takes the document with it
    expect((await req('delete', `/api/messages/${up.body.attachment.message_id}`, owner)).status).toBe(200);
    expect((await req('get', `/api/messages/attachment/${up.body.id}`, owner)).status).toBe(404);
  });

  // ── D6 ────────────────────────────────────────────────────────────────────
  test('D6 family emergency connection: 503 without Stripe; paid flow with a verified payment', async () => {
    if (!ctx.app) return;
    const q = await req('get', '/api/billing/family/quote');
    expect(q.body).toMatchObject({ price_cents: 2899, lawyers: 3, bail_agents: 2 });
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const off = await req('post', '/api/billing/family/connect', owner).send({ family_name: 'Ana', family_phone: '615 555 0100', state: 'TN' });
      expect(off.status).toBe(503);
      expect(off.body.error).toBe('payments_unavailable');
      expect((await req('post', '/api/billing/family/confirm', owner).send({ payment_intent_id: 'pi_x' })).status).toBe(503);
    } finally { process.env.STRIPE_SECRET_KEY = STRIPE_KEY; }
    expect((await req('post', '/api/billing/family/connect', owner).send({ family_name: 'Ana', family_phone: '12' })).status).toBe(400);
    const pay = await req('post', '/api/billing/family/connect', owner).send({ family_name: 'Ana', family_phone: '615 555 0100', state: 'TN' });
    expect(pay.status).toBe(200);
    expect(pay.body).toMatchObject({ requires_payment: true, amount_cents: 2899 });
    expect(pay.body.attorneys).toBeUndefined();
    const pi = pay.body.payment_intent_id;
    expect((await req('post', '/api/billing/family/confirm', owner).send({ payment_intent_id: pi })).status).toBe(402);
    fake.pis.get(pi).status = 'succeeded';
    expect((await req('post', '/api/billing/family/confirm', other).send({ payment_intent_id: pi })).status).toBe(404);
    const ok = await req('post', '/api/billing/family/confirm', owner).send({ payment_intent_id: pi });
    expect(ok.status).toBe(200);
    expect(ok.body.attorneys.length).toBe(3);
    expect(ok.body.bail_agents.length).toBe(2);
    expect([...ok.body.attorneys, ...ok.body.bail_agents].every(a => a.phone && a.state === 'TN')).toBe(true);
    await req('post', '/api/billing/family/confirm', owner).send({ payment_intent_id: pi });
    expect(Number((await ctx.db.get('SELECT COUNT(*) AS n FROM revenue_log WHERE stripe_pi_id = ?', [pi])).n)).toBe(1);
    expect((await ctx.db.get('SELECT status FROM family_connections WHERE stripe_pi_id = ?', [pi])).status).toBe('paid');
    await ctx.db.run('DELETE FROM revenue_log WHERE stripe_pi_id = ?', [pi]);
    await ctx.db.run('DELETE FROM family_connections WHERE stripe_pi_id = ?', [pi]);
  });

  // ── D7 ────────────────────────────────────────────────────────────────────
  test('D7 matter analytics need access to the matter', async () => {
    if (!ctx.app) return;
    const m = await ctx.db.get(`INSERT INTO matters (title, client_name, created_by, status) VALUES ('Consumer matter', 'Client', ?, 'open') RETURNING id`, [owner.user.id]);
    expect((await req('get', `/api/matter-intelligence/${m.id}/analytics`, other)).status).toBe(404);
    const mine = await req('get', `/api/matter-intelligence/${m.id}/analytics`, owner);
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual({ matter_id: Number(m.id), event_count: 0, docket_count: 0, recent_docket: [] });
    await ctx.db.run('DELETE FROM matters WHERE id = ?', [m.id]);
  });
});
