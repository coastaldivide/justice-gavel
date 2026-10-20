/**
 * server_h.int.test.js — section H (server-wide) regressions, on the real app
 * and a migrated Postgres (TEST_DATABASE_URL), with fake Daily.co and Expo push
 * servers on 127.0.0.1.
 *
 *   H1  one error format in the request language; bad input is a 4xx, never a 500
 *   H2  matter time / docket lookups: another account's matter is 404 (was 200 + any
 *       firm-less docket entry)
 *   H3  video: the invited attorney gets a push in their language and their own
 *       (owner) join token; strangers and ended sessions cannot join
 *   H4  AI job status answers from any instance; only the owner sees it; a job
 *       left by a dead instance reads as timed out
 *   H5  scheduled jobs claim each fire once (two instances → one run); the
 *       consultation reminder goes out once, in each person's language
 *   H6  the closed-case expungement push is planned once per case, localized
 *   H7  push tokens: validated, moved off another account, dead ones removed
 *       from tickets and from receipts
 *   H8  docket deadline push: once, in the assignee's language
 *   H9  billing writes answer a guest 401 (sign in), not 503; removed routes stay gone
 *   H10 booking / welcome e-mails in the recipient's language
 *   H11 multi-page motion PDF renders (was endless recursion + native crash)
 *   H12 an attorney's recorded outcome closes the case the way the app reads it
 *   H13 an unreachable AI service reads as "busy" (503), never a bare 500
 *   H14 a re-plan while one reminder is being sent neither fails (was 409) nor
 *       duplicates that reminder
 */
import http from 'node:http';
import { jest } from '@jest/globals';
import { initSuite, describeIntegration } from './_harness.js';

jest.setTimeout(60_000);

// ── Fake Daily.co and Expo push ───────────────────────────────────────────────
const daily = { requests: [], server: null, url: null };
const expo = { sent: [], receiptsAsked: [], server: null, url: null, deadTickets: new Set() };
function listen(handler) {
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => { let body = null; try { body = JSON.parse(data); } catch { /* none */ } handler(req, res, body); });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

let ticketSeq = 0;
beforeAll(async () => {
  daily.server = await listen((req, res, body) => {
    daily.requests.push({ method: req.method, path: req.url, body, auth: req.headers.authorization });
    if (req.method === 'POST' && req.url === '/rooms') return json(res, 200, { name: body.name, url: `https://jg.daily.test/${body.name}` });
    if (req.method === 'POST' && req.url === '/meeting-tokens') return json(res, 200, { token: `tok-${body.properties.user_id}-${body.properties.is_owner ? 'owner' : 'guest'}` });
    if (req.method === 'DELETE') return json(res, 200, { deleted: true });
    return json(res, 200, { name: 'x' });
  });
  daily.url = `http://127.0.0.1:${daily.server.address().port}`;
  expo.server = await listen((req, res, body) => {
    if (req.url === '/push/send') {
      const data = (body || []).map(m => {
        expo.sent.push(m);
        if (String(m.to).includes('DEADTICKET')) return { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } };
        const id = `ticket-${++ticketSeq}`;
        if (String(m.to).includes('DEADRECEIPT')) expo.deadTickets.add(id);
        return { status: 'ok', id };
      });
      return json(res, 200, { data });
    }
    if (req.url === '/push/getReceipts') {
      expo.receiptsAsked.push(...(body?.ids || []));
      return json(res, 200, { data: Object.fromEntries((body?.ids || []).map(id => [id, expo.deadTickets.has(id)
        ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }])) });
    }
    return json(res, 404, {});
  });
  expo.url = `http://127.0.0.1:${expo.server.address().port}`;
  process.env.DAILY_API_KEY = 'daily-test-key';
  process.env.DAILY_API_BASE = daily.url;
  process.env.EXPO_PUSH_API_URL = expo.url;
});
afterAll(async () => {
  delete process.env.DAILY_API_KEY; delete process.env.DAILY_API_BASE; delete process.env.EXPO_PUSH_API_URL;
  await new Promise(r => daily.server.close(r));
  await new Promise(r => expo.server.close(r));
});

const token = (tag) => `ExponentPushToken[${tag}]`;
const pushesTo = (t) => expo.sent.filter(m => m.to === t);

describeIntegration('section H — server-wide', () => {
  const ctx = initSuite();
  const lang = async (u, l) => ctx.db.run('UPDATE users SET preferred_language = ? WHERE id = ?', [l, u.user.id]);
  const setToken = async (u, t) => {
    const r = await ctx.request().post('/api/push/token').set(u.headers).send({ expoPushToken: t, platform: 'ios' });
    expect(r.status).toBe(200);
  };
  const attorneyAccount = (n) => ctx.register({ accountType: 'attorney', isAttorney: true, barNumber: `H${Date.now() % 1e6}${n}`, barState: 'TN' });

  ctx.addCleanup(async (db, tag) => {
    const ids = (await db.all('SELECT id FROM users WHERE email LIKE ?', [`${tag}-%@it.example.test`])).map(u => Number(u.id));
    if (!ids.length) return;
    for (const sql of [
      'DELETE FROM video_sessions WHERE user_id = ANY(?) OR attorney_id = ANY(?)',
      'DELETE FROM case_assignments WHERE user_id = ANY(?) OR defender_id = ANY(?)',
      'DELETE FROM consultation_bookings WHERE user_id = ANY(?) OR user_id = ANY(?)',
      'DELETE FROM docket_entries WHERE user_id = ANY(?) OR assigned_to = ANY(?)',
      'DELETE FROM push_tickets WHERE user_id = ANY(?) OR user_id = ANY(?)',
      'DELETE FROM ai_job_state WHERE user_id = ANY(?) OR user_id = ANY(?)',
      'DELETE FROM subscriptions WHERE user_id = ANY(?) OR user_id = ANY(?)',
      'DELETE FROM attorney_profiles WHERE user_id = ANY(?) OR user_id = ANY(?)',
      'DELETE FROM case_status_history WHERE user_id = ANY(?) OR user_id = ANY(?)',
    ]) await db.run(sql, [ids, ids]).catch(() => {});
    await db.run(`DELETE FROM job_runs WHERE job LIKE 'h-test-%'`).catch(() => {});
  });

  // ── H1 ──────────────────────────────────────────────────────────────────────
  test('H1 errors: { error, code, message } in the request language; bad input → 4xx', async () => {
    const guest = await ctx.request().get('/api/cases?lang=es');
    expect(guest.status).toBe(401);
    expect(guest.body).toMatchObject({ code: 'missing_token', message: 'Inicie sesión para continuar.' });
    const vi = await ctx.request().get('/api/cases').set('Accept-Language', 'vi-VN,vi;q=0.9');
    expect(vi.body.message).toBe('Vui lòng đăng nhập để tiếp tục.');
    const nf = await ctx.request().get('/api/does-not-exist?lang=pt');
    expect(nf.status).toBe(404);
    expect(nf.body).toMatchObject({ code: 'not_found', message: 'Não encontramos o que você procurava.' });
    const broken = await ctx.request().post('/api/auth/login?lang=es').set('Content-Type', 'application/json').send('{"identifier":');
    expect(broken.status).toBe(400);
    expect(broken.body).toMatchObject({ code: 'invalid_json', message: 'No pudimos leer los datos enviados. Inténtelo de nuevo.' });
    expect(broken.body.message).not.toMatch(/Unexpected|JSON at position/);   // (outside production the library text is in `detail`)

    const u = await ctx.register();
    const huge = await ctx.request().delete(`/api/cases/${'9'.repeat(30)}`).set(u.headers);
    expect(huge.status).toBeLessThan(500);
    const obj = await ctx.request().post('/api/firms').set(u.headers).send({ name: { $ne: null } });
    expect(obj.status).toBe(400);
    const contacts = await ctx.request().post('/api/alerts/family-contacts?lang=es').set(u.headers).send({ name: ['x'], phone: { a: 1 } });
    expect(contacts.status).toBe(400);
    expect(contacts.body.message).toBe('Ingrese un nombre y un número de teléfono o un correo electrónico.');
  });

  test('H1b a production 500 never carries internals', async () => {
    const { shapeErrorBody } = await import('../../middleware/errorShape.js');
    const out = shapeErrorBody({ error: 'relation "x" does not exist', sql: 'SELECT …', stack: ['at x'] }, 500, 'es', { prod: true });
    expect(out).toEqual({ error: 'server_error', code: 'server_error', message: 'Algo salió mal de nuestro lado. Inténtelo de nuevo.', status: 500 });
  });

  // ── H2 ──────────────────────────────────────────────────────────────────────
  test('H2 time / docket matter routes: owner 200, stranger 404', async () => {
    const owner = await attorneyAccount(1);
    const stranger = await ctx.register();
    const m = await ctx.request().post('/api/matters').set(owner.headers).send({ title: `H2 ${ctx.tag}`, client_name: 'Pat' });
    expect(m.status).toBe(201);
    await ctx.db.run(`INSERT INTO docket_entries (matter_id, title, due_date, status, user_id) VALUES (?, 'Firm-less entry', '2031-01-01', 'pending', ?)`, [m.body.id, owner.user.id]);
    for (const p of [`/api/time/matter/${m.body.id}`, `/api/time/matter/${m.body.id}/billing-summary`, `/api/docket/matter/${m.body.id}`]) {
      expect((await ctx.request().get(p).set(owner.headers)).status).toBe(200);
      const s = await ctx.request().get(p).set(stranger.headers);
      expect(s.status).toBe(404);
      expect(JSON.stringify(s.body)).not.toContain('Firm-less entry');
    }
    await ctx.db.run('DELETE FROM docket_entries WHERE matter_id = ?', [m.body.id]);
    await ctx.db.run('DELETE FROM matters WHERE id = ?', [m.body.id]);
  });

  // ── H3 ──────────────────────────────────────────────────────────────────────
  test('H3 video: invited attorney gets a localized push and an owner token; others cannot join', async () => {
    const client = await ctx.register();
    const atty = await attorneyAccount(2);
    const other = await attorneyAccount(3);
    await lang(atty, 'es');
    await setToken(atty, token(`h3-atty-${ctx.tag}`));
    await ctx.db.run(`INSERT INTO subscriptions (user_id, tier, status, stripe_sub_id, created_at) VALUES (?, 'legal_pro', 'active', ?, NOW())`, [client.user.id, `sub_h3_${ctx.tag}`]);
    const c = await ctx.request().post('/api/cases').set(client.headers).send({ title: `H3 ${ctx.tag}` });
    await ctx.db.run(`INSERT INTO case_assignments (case_id, defender_id, assigned_by, user_id, status, assigned_at) VALUES (?, ?, ?, ?, 'active', NOW())`,
      [c.body.id ?? c.body.case?.id, atty.user.id, client.user.id, client.user.id]);

    // an attorney with no link to the client cannot be invited
    const notLinked = await ctx.request().post('/api/video/session').set(client.headers).send({ attorney_id: other.user.id });
    expect(notLinked.status).toBe(404);

    const s = await ctx.request().post('/api/video/session').set(client.headers).send({ attorney_id: atty.user.id, topic: 'Bail hearing' });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ attorney_invited: true, token: `tok-${client.user.id}-guest` });
    expect(daily.requests.every(r => r.auth === 'Bearer daily-test-key')).toBe(true);
    const invite = pushesTo(token(`h3-atty-${ctx.tag}`)).pop();
    expect(invite).toMatchObject({ title: '📹 Consulta por video', data: { type: 'video_invite', screen: 'VideoConsultation', room: s.body.room_name } });
    expect(invite.body).toMatch(/inició una videollamada con usted/);

    const join = await ctx.request().post(`/api/video/session/${s.body.room_name}/join`).set(atty.headers).send({});
    expect(join.status).toBe(200);
    expect(join.body).toMatchObject({ room_name: s.body.room_name, token: `tok-${atty.user.id}-owner` });
    expect(join.body.join_url).toBe(`${s.body.room_url}?t=${join.body.token}`);
    expect((await ctx.request().get('/api/video/sessions/me').set(atty.headers)).body.sessions.map(x => x.room_name)).toContain(s.body.room_name);

    expect((await ctx.request().post(`/api/video/session/${s.body.room_name}/join`).set(other.headers).send({})).status).toBe(404);
    expect((await ctx.request().delete(`/api/video/session/${s.body.room_name}`).set(other.headers)).status).toBe(404);
    expect((await ctx.request().delete(`/api/video/session/${s.body.room_name}`).set(atty.headers)).status).toBe(200);
    const late = await ctx.request().post(`/api/video/session/${s.body.room_name}/join?lang=es`).set(client.headers).send({});
    expect(late.status).toBe(410);
    expect(late.body.message).toBe('Esta videollamada ya terminó.');
  });

  // ── H4 ──────────────────────────────────────────────────────────────────────
  test('H4 AI job status from another instance; owner only; orphan → timed out', async () => {
    const owner = await ctx.register();
    const stranger = await ctx.register();
    const id = `h4-${ctx.tag}`;
    await ctx.db.run(`INSERT INTO ai_job_state (id, type, user_id, status, result, instance, queued_at, completed_at)
                      VALUES (?, 'chat', ?, 'done', ?::jsonb, 'other-instance', NOW(), NOW())`, [id, owner.user.id, JSON.stringify({ answer: 'from B' })]);
    const r = await ctx.request().get(`/api/jobs/${id}`).set(owner.headers);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id, status: 'done', result: { answer: 'from B' } });
    expect((await ctx.request().get(`/api/jobs/${id}`).set(stranger.headers)).status).toBe(404);
    await ctx.db.run(`INSERT INTO ai_job_state (id, type, user_id, status, instance, queued_at) VALUES (?, 'chat', ?, 'processing', 'gone', NOW() - INTERVAL '1 hour')`, [`${id}-orphan`, owner.user.id]);
    const o = await ctx.request().get(`/api/jobs/${id}-orphan?lang=es`).set(owner.headers);
    expect(o.body).toMatchObject({ status: 'failed', code: 'ai_timeout' });
    // a job enqueued here is written before its id is handed out
    const { enqueue } = await import('../../services/aiQueue.js');
    const jid = await enqueue('chat', async () => ({ ok: 1 }), owner.user.id);
    expect(await ctx.db.get('SELECT user_id FROM ai_job_state WHERE id = ?', [jid])).toEqual({ user_id: owner.user.id });
  });

  // ── H5 ──────────────────────────────────────────────────────────────────────
  test('H5 a scheduled fire runs on one instance only', async () => {
    const { runScheduled, runOnce } = await import('../../utils/jobLock.js');
    const fire = { date: new Date('2031-05-05T03:00:00Z') };
    let nightly = 0;
    const [a, b] = await Promise.all([1, 2].map(() => runScheduled('h-test-nightly', fire, async () => { nightly++; })));
    expect(nightly).toBe(1);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    expect(await ctx.db.get(`SELECT status, instance FROM job_runs WHERE job = 'h-test-nightly' AND run_key = '2031-05-05T03:00'`))
      .toMatchObject({ status: 'ok' });
    expect((await runScheduled('h-test-nightly', undefined, async () => 'manual')).result).toBe('manual');   // no context: always runs
    let runs = 0;
    const results = await Promise.all([1, 2].map(() => runOnce('h-test-once', 'w1', async () => { runs++; })));
    expect(runs).toBe(1);
    expect(results.filter(r => r.ran)).toHaveLength(1);
  });

  test('H5b consultation reminder: once across instances, each person in their language', async () => {
    const client = await ctx.register();
    const atty = await attorneyAccount(4);
    await lang(client, 'es'); await lang(atty, 'pt');
    await setToken(client, token(`h5-client-${ctx.tag}`));
    await setToken(atty, token(`h5-atty-${ctx.tag}`));
    const lawyer = await ctx.db.get(`SELECT id, name FROM lawyers WHERE id NOT IN (SELECT lawyer_id FROM attorney_profiles WHERE lawyer_id IS NOT NULL) ORDER BY id DESC LIMIT 1`);
    await ctx.db.run(`INSERT INTO attorney_profiles (user_id, lawyer_id) VALUES (?, ?)
                      ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET lawyer_id = EXCLUDED.lawyer_id`, [atty.user.id, lawyer.id]);
    const now = new Date('2031-06-01T15:00:00Z');
    const startsAt = new Date(now.getTime() + 24 * 3_600_000);
    const b = await ctx.db.get(`INSERT INTO consultation_bookings (user_id, lawyer_id, lawyer_name, date_slot, time_slot, starts_at, time_zone, duration_min, platform_fee_cents, status)
                                VALUES (?, ?, ?, '2031-06-02', '10:00', ?, 'America/Chicago', 30, 1500, 'confirmed') RETURNING id`,
      [client.user.id, lawyer.id, lawyer.name, startsAt.toISOString()]);
    const { runConsultationReminderSweep } = await import('../../services/scheduler.js');
    await Promise.all([runConsultationReminderSweep(ctx.db, now), runConsultationReminderSweep(ctx.db, now)]);
    await runConsultationReminderSweep(ctx.db, now);
    const toClient = pushesTo(token(`h5-client-${ctx.tag}`)).filter(m => m.data?.type === 'consultation_reminder');
    const toAtty = pushesTo(token(`h5-atty-${ctx.tag}`)).filter(m => m.data?.type === 'consultation_reminder');
    expect(toClient).toHaveLength(1);
    expect(toAtty).toHaveLength(1);
    expect(toClient[0].title).toBe('📅 Consulta mañana');
    expect(toClient[0].body).toMatch(/^.+ — lunes, 2 de junio · 10:00 a\.\s?m\. CDT\.$/);
    expect(toAtty[0].title).toBe('📅 Consulta com cliente amanhã');
    expect((await ctx.db.get('SELECT reminder_sent FROM consultation_bookings WHERE id = ?', [b.id])).reminder_sent).toBeTruthy();
  });

  // ── H6 ──────────────────────────────────────────────────────────────────────
  test('H6 closed-case expungement push: planned once, in the owner\'s language', async () => {
    const u = await ctx.register();
    await lang(u, 'vi');
    const c = await ctx.request().post('/api/cases').set(u.headers).send({ title: `H6 ${ctx.tag}` });
    const caseId = c.body.id ?? c.body.case?.id;
    await ctx.db.run(`UPDATE cases SET status = 'Closed', close_outcome = 'dismissed', closed_at = NOW() - INTERVAL '30 days' WHERE id = ?`, [caseId]);
    const { runExpungementTriggerSweep } = await import('../../services/scheduler.js');
    expect((await runExpungementTriggerSweep(ctx.db)).planned).toBe(1);
    expect((await runExpungementTriggerSweep(ctx.db)).planned).toBe(0);
    const rows = await ctx.db.all(`SELECT title, body, notification_type FROM scheduled_pushes WHERE dedupe_key = ?`, [`expunge:${caseId}`]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ notification_type: 'expungement', title: '📋 Vụ việc của bạn đã kết thúc — bước tiếp theo?' });
    expect(rows[0].body).toContain(`H6 ${ctx.tag}`);
  });

  // ── H7 ──────────────────────────────────────────────────────────────────────
  test('H7 push tokens: validated, taken over by the device\'s new account, dead ones removed', async () => {
    const a = await ctx.register();
    const b = await ctx.register();
    expect((await ctx.request().post('/api/push/token').set(a.headers).send({ expoPushToken: { $ne: 1 } })).status).toBe(400);
    expect((await ctx.request().post('/api/push/token').set(a.headers).send({ expoPushToken: 'true' })).status).toBe(400);
    const shared = token(`h7-shared-${ctx.tag}`);
    await setToken(a, shared);
    await setToken(b, shared);
    expect(await ctx.db.get('SELECT COUNT(*)::int AS n FROM push_tokens WHERE token = ?', [shared])).toEqual({ n: 1 });
    expect(await ctx.db.get('SELECT user_id FROM push_tokens WHERE token = ?', [shared])).toEqual({ user_id: b.user.id });

    const { sendPushToUser, checkPushReceipts } = await import('../../services/pushDelivery.js');
    const deadNow = token(`DEADTICKET-${ctx.tag}`);
    await setToken(a, deadNow);
    await sendPushToUser(a.user.id, { title: 't', body: 'b' });
    expect(await ctx.db.get('SELECT COUNT(*)::int AS n FROM push_tokens WHERE token = ?', [deadNow])).toEqual({ n: 0 });

    const deadLater = token(`DEADRECEIPT-${ctx.tag}`);
    await setToken(a, deadLater);
    await sendPushToUser(a.user.id, { title: 't', body: 'b' });
    const t = await ctx.db.get('SELECT ticket_id, user_id FROM push_tickets WHERE token = ?', [deadLater]);
    expect(t.user_id).toBe(a.user.id);
    const r = await checkPushReceipts({ minAgeMinutes: 0 });
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(expo.receiptsAsked).toContain(t.ticket_id);
    expect(await ctx.db.get('SELECT COUNT(*)::int AS n FROM push_tokens WHERE token = ?', [deadLater])).toEqual({ n: 0 });
    expect((await ctx.db.get('SELECT receipt_error FROM push_tickets WHERE ticket_id = ?', [t.ticket_id])).receipt_error).toBe('DeviceNotRegistered');
  });

  // ── H8 ──────────────────────────────────────────────────────────────────────
  test('H8 docket deadline push: once, in the assignee\'s language', async () => {
    const atty = await attorneyAccount(5);
    await lang(atty, 'vi');
    await setToken(atty, token(`h8-${ctx.tag}`));
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await ctx.db.run(`INSERT INTO docket_entries (title, due_date, due_time, status, reminder_days, assigned_to, user_id)
                      VALUES (?, ?, '09:30', 'pending', 2, ?, ?)`, [`H8 filing ${ctx.tag}`, tomorrow, atty.user.id, atty.user.id]);
    const sched = await import('../../services/scheduler.js');
    await sched.runDocketReminderSweep();
    await sched.runDocketReminderSweep();
    const got = pushesTo(token(`h8-${ctx.tag}`)).filter(m => m.data?.type === 'deadline_reminder');
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe('⚖️ Hạn chót ngày mai');
    expect(got[0].body).toBe(`H8 filing ${ctx.tag} lúc 09:30`);
  });

  // ── H9 ──────────────────────────────────────────────────────────────────────
  test('H9 billing writes ask a guest to sign in; removed routes are gone', async () => {
    const r = await ctx.request().post('/api/billing/subscribe?lang=es').send({ tier: 'legal_pro' });
    expect(r.status).toBe(401);
    const u = await ctx.register();
    const s = await ctx.request().post('/api/billing/subscribe').set(u.headers).send({ tier: 'legal_pro' });
    expect(s.status).toBe(503);
    expect(s.body.error).toBe('payments_unavailable');
    for (const [m, p] of [['post', '/api/push/send'], ['post', '/api/push/receipts'], ['get', '/api/pretrial/dashboard'], ['post', '/api/pretrial/enroll']]) {
      expect((await ctx.request()[m](p).set(u.headers).send({})).status).toBe(404);
    }
  });

  // ── H10 ─────────────────────────────────────────────────────────────────────
  test('H10 booking and welcome e-mails are written in the recipient\'s language', async () => {
    const email = await import('../../services/email.js');
    const c = await email.sendBookingConfirmation({ to: 'x@example.test', lang: 'es', clientName: 'Ana', attorneyName: 'Lic. Ruiz',
      when: 'martes, 2 de junio · 10:00 a. m. CDT', durationMin: 30, feeDisplay: '$15.00', refundHours: 2 });
    expect(c).toMatchObject({ mock: true, subject: 'Consulta confirmada — Lic. Ruiz, martes, 2 de junio · 10:00 a. m. CDT' });
    const a = await email.sendAttorneyBookingAlert({ to: 'y@example.test', lang: 'vi', clientName: null, attorneyName: 'Ls. Tran',
      when: 'thứ ba', durationMin: 30 });
    expect(a.subject.startsWith('Có lịch tư vấn mới — ')).toBe(true);
    expect(a.subject.endsWith(', thứ ba')).toBe(true);
    const w = await email.sendWelcome('z@example.test', 'Lia', 'pt');
    expect(w.subject).toBe('Boas-vindas ao Justice Gavel');
  });

  // ── H11 ─────────────────────────────────────────────────────────────────────
  test('H11 a long motion renders to a multi-page PDF', async () => {
    const u = await ctx.register();
    const text = Array.from({ length: 300 }, (_, i) => `Paragraph ${i}: the defendant respectfully moves the court.`).join('\n');
    const r = await ctx.request().post('/api/motions/export/preview').set(u.headers).send({ motion_text: text, motion_type: 'Motion to suppress' })
      .buffer(true).parse((res, cb) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect((r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(3);
  });

  // ── H12 ─────────────────────────────────────────────────────────────────────
  test('H12 an attorney\'s recorded outcome closes the case and stops its court reminders', async () => {
    const client = await ctx.register();
    const atty = await attorneyAccount(6);
    const c = await ctx.request().post('/api/cases').set(client.headers).send({ title: `H12 ${ctx.tag}` });
    const caseId = c.body.id ?? c.body.case?.id;
    await ctx.db.run(`INSERT INTO case_assignments (case_id, defender_id, assigned_by, user_id, status, assigned_at) VALUES (?, ?, ?, ?, 'active', NOW())`,
      [caseId, atty.user.id, client.user.id, client.user.id]);
    await ctx.db.run(`INSERT INTO scheduled_pushes (user_id, title, deliver_at, notification_type, case_id, status, dedupe_key)
                      VALUES (?, 'court', NOW() + INTERVAL '2 days', 'court_reminder', ?, 'pending', ?)`, [client.user.id, caseId, `h12:${ctx.tag}`]);
    const r = await ctx.request().post(`/api/attorney/cases/${caseId}/outcome`).set(atty.headers).send({ outcome: 'dismissed', notes: 'ok' });
    expect(r.status).toBe(200);
    expect((await ctx.db.get('SELECT status FROM cases WHERE id = ?', [caseId])).status).toBe('Closed');
    expect((await ctx.db.get('SELECT status FROM scheduled_pushes WHERE dedupe_key = ?', [`h12:${ctx.tag}`])).status).toBe('cancelled');
  });

  // ── H13 ─────────────────────────────────────────────────────────────────────
  test('H13 an unreachable AI service is "busy" (503), not an unknown failure', async () => {
    const { aiErrorCode } = await import('../../services/aiClient.js');
    const conn = Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' });
    expect(aiErrorCode(conn)).toBe('ai_busy');
    expect(aiErrorCode(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4399'), { code: 'ECONNREFUSED' }))).toBe('ai_busy');
    expect(aiErrorCode(new TypeError('fetch failed'))).toBe('ai_busy');
    expect(aiErrorCode(new Error('something else entirely'))).toBe('ai_failed');
  });

  // ── H14 ─────────────────────────────────────────────────────────────────────
  test('H14 changing time zone while a court reminder is being sent: save works, no duplicate', async () => {
    const u = await ctx.register();
    const tzReq = (method, url, tz) => ctx.request()[method](url).set(u.headers).set('X-Timezone', tz);
    const c1 = await tzReq('post', '/api/cases', 'America/Chicago').send({ title: `H14 a ${ctx.tag}`, state: 'TN' });
    const d1 = await tzReq('post', '/api/court-dates', 'America/Chicago').send({ case_id: c1.body.id, court_date: '2027-03-10', court_time: '09:00' });
    expect(d1.status).toBe(201);
    // the dispatcher has claimed one of this hearing's reminders and is sending it
    const inFlight = await ctx.db.get(`SELECT id, dedupe_key FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending' ORDER BY deliver_at LIMIT 1`, [d1.body.id]);
    await ctx.db.run(`UPDATE scheduled_pushes SET status = 'sending', claimed_at = NOW() WHERE id = ?`, [inFlight.id]);
    // a new zone re-plans every upcoming hearing of the user, this one included
    const c2 = await tzReq('post', '/api/cases', 'Pacific/Honolulu').send({ title: `H14 b ${ctx.tag}`, state: 'TN' });
    const d2 = await tzReq('post', '/api/court-dates', 'Pacific/Honolulu').send({ case_id: c2.body.id, court_date: '2027-03-11', court_time: '09:00' });
    expect(d2.status).toBe(201);
    const live = await ctx.db.all(`SELECT dedupe_key, COUNT(*) AS n FROM scheduled_pushes WHERE court_date_id = ? AND status IN ('pending', 'sending') GROUP BY dedupe_key`, [d1.body.id]);
    expect(live.length).toBeGreaterThan(1);
    expect(live.every(r => Number(r.n) === 1)).toBe(true);
    expect(live.map(r => r.dedupe_key)).toContain(inFlight.dedupe_key);
  });
});
