/**
 * public_defender.int.test.js — the public defender channel (A11, ⚖ PUBLIC_DEFENDER_CHANNEL_ENABLED)
 * on the real app + real Postgres, a fake Telnyx server, real Ed25519-signed inbound webhooks and a
 * fake Stripe with invoicing (helpers/fakeStripeConnect.js):
 *
 *   PD1  offices: admin only; the first office admin is invited by e-mail and accepts with that address;
 *        staff invites, seats_full at the seat count, roles, never the last admin; one office per person
 *   PD2  CSV upload: preview with per-row errors, all or nothing, de-duplicated by phone + case number,
 *        re-upload updates court dates; clients one by one; another office's clients are invisible
 *   PD3  reminders: nothing before the consent basis (who + when stored); then the plan in the office's
 *        zone under the office's name, sent once (second run = nothing), STOP respected; never in bd_texts
 *   PD4  "Did you make it?": reply 3 → missed + the "act today" text now; reply 1 → attended; morning after
 *   PD5  two-way: other texts go to the inbox of the office that texted the number most recently;
 *        unread counts, newest first, paging; staff reply "{office}: …"; STOP → 409; handled
 *   PD6  dashboard (appearance per month, baseline vs pilot, opt-outs) and the CSV / ZIP export
 *   PD7  annual invoice through Stripe: preview, create (setup fee + clients × $2), idempotent per
 *        office + year, a failure is retried without a second invoice, next year has no setup fee
 *   PD8  setting off: 503 feature_unavailable, status says disabled, the job and the inbox do nothing
 */
import { jest } from '@jest/globals';
import http from 'node:http';
import crypto from 'node:crypto';
import { describeIntegration, initSuite } from './_harness.js';
import { newFakeState, fakeStripeClass } from '../helpers/fakeStripeConnect.js';
import { zonedDateTimeToUtc, todayInZone, addDays } from '../../utils/timezone.js';

const fake = newFakeState();
jest.unstable_mockModule('stripe', () => ({ default: fakeStripeClass(fake) }));

const TZ = 'America/Chicago';   // Davidson County, TN
const P = { a: '+16155550401', b: '+16155550402', c: '+16155550403', d: '+16155550404', shared: '+16155550405' };

describeIntegration('Public defender channel (real Postgres, fake Telnyx + Stripe)', () => {
  const ctx = initSuite();
  const texts = [];
  let telnyx;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  let admin, pdAdmin, pdStaff, pdStaff2, other, outsider;
  let office, office2;
  let svc;
  let ipN = 0;
  const req = (m, path, who) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.93.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (who) r = r.set(who.headers);
    return r;
  };
  const pd = (m, path, who = pdAdmin) => req(m, `/api/pd${path}`, who);
  const adm = (m, path, who = admin) => req(m, `/api/admin/pd-offices${path}`, who);
  const inbound = (from, text) => {
    const raw = JSON.stringify({ data: { event_type: 'message.received', payload: { text, from: { phone_number: from } } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.sign(null, Buffer.from(`${ts}|${raw}`), privateKey).toString('base64');
    // the slow part (court answers, inbox routing) runs after Telnyx has its 200: wait for it
    return ctx.request().post('/api/webhooks/telnyx').set('Content-Type', 'application/json')
      .set('telnyx-signature-ed25519', sig).set('telnyx-timestamp', String(ts)).send(raw)
      .then(async (r) => { await (await import('../../routes/webhooks/telnyx.js')).inboundIdle(); return r; });
  };
  const textsTo = (to) => texts.filter((t) => t.to === to);
  const csv = (rows) => Buffer.from(['name,phone,language,case_number,court_dates,email', ...rows].join('\n'), 'utf8');
  const upload = (path, buf, who = pdAdmin) => pd('post', path, who).attach('file', buf, { filename: 'clients.csv', contentType: 'text/csv' });
  const tokenOf = (link) => String(link).split('/').pop();

  beforeAll(async () => {
    if (!ctx.app) return;
    telnyx = http.createServer((rq, rs) => {
      let data = '';
      rq.on('data', (c) => { data += c; });
      rq.on('end', () => {
        texts.push(JSON.parse(data || '{}'));
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ data: { id: `pd_tx_${ctx.tag}_${texts.length}` } }));
      });
    });
    await new Promise((r) => telnyx.listen(0, '127.0.0.1', r));
    Object.assign(process.env, {
      TELNYX_API_KEY: 'KEY_pd', TELNYX_FROM_NUMBER: '+16155550100', TELNYX_API_BASE: `http://127.0.0.1:${telnyx.address().port}`,
      TELNYX_PUBLIC_KEY: rawPub, PUBLIC_DEFENDER_CHANNEL_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_pd',
    });
    svc = await import('../../services/publicDefender/texts.js');
    [admin, pdAdmin, pdStaff, pdStaff2, other, outsider] = await Promise.all(['ADM', 'PDA', 'PDS', 'PDS2', 'OTH', 'OUT'].map((n) => ctx.register({ displayName: `PD ${n}` })));
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(admin.user.id);
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM pd_offices WHERE created_by = ?', [admin.user.id]);
      await db.run(`DELETE FROM sms_opt_outs WHERE phone IN (?, ?, ?, ?, ?)`, Object.values(P));
      await db.run(`DELETE FROM sms_delivery WHERE provider_id LIKE ?`, [`pd_tx_${ctx.tag}_%`]);
    });
  });
  afterAll(async () => {
    if (telnyx) await new Promise((r) => telnyx.close(r));
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'TELNYX_PUBLIC_KEY', 'PUBLIC_DEFENDER_CHANNEL_ENABLED', 'STRIPE_SECRET_KEY']) delete process.env[k];
  });

  test('PD1 offices, invitations, seats and roles', async () => {
    if (!ctx.app) return;
    expect((await adm('get', '', outsider)).status).toBe(403);
    expect((await ctx.request().get('/api/admin/pd-offices')).status).toBe(401);
    const bad = await adm('post', '').send({ name: 'X', state: 'Tennessee', admin_email: pdAdmin.email });
    expect(bad.body.code).toBe('bad_state');
    const c = await adm('post', '').send({ name: 'Metro Nashville Public Defender', county: 'Davidson', state: 'tn', phone: '615-555-0190', seat_limit: 3, admin_email: pdAdmin.email });
    expect(c.status).toBe(201);
    office = c.body.office;
    expect(office).toMatchObject({ name: 'Metro Nashville Public Defender', state: 'TN', county: 'Davidson', seat_limit: 3, billing_email: pdAdmin.email, consent: null });
    expect(c.body.invite.link).toMatch(/\/pd\/join\/[A-Za-z0-9_-]{40,}$/);
    // not a member yet
    expect((await pd('get', '/office')).body.code).toBe('not_member');
    expect((await pd('get', '/status')).body).toMatchObject({ enabled: true, member: null });
    // the invitation works for the invited address only
    const tok = tokenOf(c.body.invite.link);
    expect((await pd('get', `/invite/${tok}`, other)).body).toMatchObject({ office: office.name, role: 'admin', email_matches: false });
    expect((await pd('post', '/invite/accept', other).send({ token: tok })).body.code).toBe('invite_other_email');
    expect((await pd('post', '/invite/accept').send({ token: tok })).body).toEqual({ office: office.name, role: 'admin' });
    expect((await pd('post', '/invite/accept').send({ token: tok })).body.code).toBe('invite_used');
    expect((await pd('get', '/status')).body.member).toMatchObject({ office_id: office.id, role: 'admin', unread: 0 });
    // staff: invite, seats, roles
    const i1 = await pd('post', '/staff/invites').send({ email: pdStaff.email, role: 'staff' });
    expect(i1.status).toBe(201);
    const i2 = await pd('post', '/staff/invites').send({ email: pdStaff2.email });
    expect(i2.status).toBe(201);
    const full = await pd('post', '/staff/invites').send({ email: other.email });
    expect([full.status, full.body.code, full.body.limit]).toEqual([409, 'seats_full', 3]);
    expect((await pd('post', '/invite/accept', pdStaff).send({ token: tokenOf(i1.body.link) })).status).toBe(200);
    expect((await pd('post', '/staff/invites', pdStaff).send({ email: other.email })).body.code).toBe('office_admin_only');
    expect((await pd('post', '/office/consent', pdStaff).send({ agree: true })).status).toBe(403);
    const staff = await pd('get', '/staff', pdStaff);
    expect(staff.body.seats).toEqual({ limit: 3, used: 3, members: 2, pending: 1 });
    expect((await pd('delete', `/staff/invites/${i2.body.invite.id}`)).status).toBe(200);
    // the last admin cannot be removed or demoted
    expect((await pd('delete', `/staff/${pdAdmin.user.id}`)).body.code).toBe('last_admin');
    expect((await pd('patch', `/staff/${pdAdmin.user.id}`).send({ role: 'staff' })).body.code).toBe('last_admin');
    // JG admin raises the seat count and adds the second office used for routing tests
    expect((await adm('patch', `/${office.id}`).send({ seat_limit: 10 })).body.office.seat_limit).toBe(10);
    const c2 = await adm('post', '').send({ name: 'Knox County PD', county: 'Knox', state: 'TN', admin_email: other.email });
    expect(c2.status).toBe(201);
    office2 = c2.body.office;
    expect((await pd('post', '/invite/accept', other).send({ token: tokenOf(c2.body.invite.link) })).status).toBe(200);
    // one office per person
    const cross = await adm('post', `/${office2.id}/invites`).send({ email: pdStaff.email, role: 'staff' });
    expect((await pd('post', '/invite/accept', pdStaff).send({ token: tokenOf(cross.body.link) })).body.code).toBe('other_office');
    const list = await adm('get', '');
    expect(list.body.prices).toEqual({ setup_cents: 2000000, per_client_cents: 200 });
    expect(list.body.offices.find((o) => o.id === office.id)).toMatchObject({ members: 2, clients: 0 });
  });

  test('PD2 CSV upload: preview, all or nothing, de-duplication, re-upload updates court dates', async () => {
    if (!ctx.app) return;
    const today = todayInZone(TZ);
    const d10 = addDays(today, 10); const d20 = addDays(today, 20); const d30 = addDays(today, 30);
    const badFile = csv([
      `Ana Lopez,${P.a},es,GS-100,${d10},ana@example.test`,
      `No Phone,,en,GS-101,${d10},`,
      `Bad Lang,${P.b},klingon,GS-102,${d10},`,
      `Bad Date,${P.b},en,GS-103,2026-02-30,`,
      `Ana Again,${P.a},es,gs-100,${d20},`,
    ]);
    const prev = await upload('/clients/import/preview', badFile);
    expect(prev.status).toBe(200);
    expect(prev.body).toMatchObject({ total: 5, valid: 1, invalid: 4, adds: 1, max_rows: 5000 });
    expect(prev.body.rows[1].errors).toEqual([{ field: 'phone', code: 'required' }]);
    expect(prev.body.rows[2].errors).toEqual([{ field: 'language', code: 'bad_language' }]);
    expect(prev.body.rows[3].errors).toEqual([{ field: 'court_dates', code: 'bad_date' }]);
    expect(prev.body.rows[4].errors).toEqual([{ field: 'case_number', code: 'duplicate_row', line: 2 }]);
    const refused = await upload('/clients/import', badFile);
    expect([refused.status, refused.body.code]).toEqual([400, 'import_has_errors']);
    expect((await pd('get', '/clients')).body.total).toBe(0);   // nothing written
    const good = csv([
      `Ana Lopez,${P.a},Spanish,GS-100,${d10} 09:30; ${d20},ana@example.test`,
      `Ben Okafor,${P.b},en,GS-200,${d10},`,
      `Cam Tran,${P.c},vi,GS-300,${d30},`,
    ]);
    const imp = await upload('/clients/import', good);
    expect(imp.status).toBe(201);
    expect(imp.body).toEqual({ imported: 3, added: 3, updated: 0, court_dates_added: 4, court_dates_removed: 0 });
    // re-upload: Ana (same phone + case number, different case) is updated, d20 dropped, d30 added
    const again = csv([`Ana M. Lopez,${P.a},es,gs-100,${d10} 09:30; ${d30},`]);
    expect((await upload('/clients/import/preview', again)).body).toMatchObject({ adds: 0, updates: 1 });
    expect((await upload('/clients/import', again)).body).toEqual({ imported: 1, added: 0, updated: 1, court_dates_added: 1, court_dates_removed: 1 });
    const list = await pd('get', '/clients?q=lopez', pdStaff);
    expect(list.body.total).toBe(1);
    const ana = list.body.clients[0];
    expect(ana).toMatchObject({ name: 'Ana M. Lopez', lang: 'es', email: 'ana@example.test', case_number: 'GS-100', next_court_date: d10 });
    const det = await pd('get', `/clients/${ana.id}`);
    expect(det.body.court_dates.map((d) => [d.court_date, d.court_time])).toEqual([[d30, null], [d10, '09:30']]);
    // one by one
    const one = await pd('post', '/clients', pdStaff).send({ name: 'Dee Shared', phone: P.shared, lang: 'en', case_number: 'GS-400', court_dates: [{ court_date: d20, court_name: 'General Sessions' }] });
    expect(one.status).toBe(201);
    expect((await pd('post', '/clients').send({ name: 'Dup', phone: P.shared, case_number: 'gs-400' })).body.code).toBe('duplicate_client');
    expect((await pd('post', `/clients/${one.body.client.id}/court-dates`).send({ court_date: d20 })).body.code).toBe('duplicate_court_date');
    // the other office sees none of them
    expect((await pd('get', `/clients/${ana.id}`, other)).status).toBe(404);
    expect((await pd('get', '/clients', other)).body.total).toBe(0);
    // too many rows
    const big = csv(Array.from({ length: 5001 }, (_, i) => `P ${i},+1615556${String(i).padStart(4, '0')},en,C-${i},${d10},`));
    expect((await upload('/clients/import/preview', big)).body.file_errors).toEqual([{ code: 'too_many_rows', max: 5000 }]);
  });

  test('PD3 reminders: consent basis first, office name, sent once, STOP respected, not billed per text', async () => {
    if (!ctx.app) return;
    const today = todayInZone(TZ);
    const d10 = addDays(today, 10);
    // before the consent basis: planned nothing, sent nothing, staff cannot text
    await svc.runPdCourtReminders(ctx.db, { now: new Date() });
    expect(await ctx.db.get(`SELECT COUNT(*)::int AS n FROM pd_reminders WHERE office_id = ? AND status = 'pending'`, [office.id])).toEqual({ n: 0 });
    const ana = (await pd('get', '/clients?q=GS-100')).body.clients[0];
    expect((await pd('post', `/clients/${ana.id}/messages`).send({ body: 'Hello' })).body.code).toBe('consent_basis_required');
    expect((await pd('post', '/office/consent').send({ agree: false })).body.code).toBe('consent_required');
    const cons = await pd('post', '/office/consent').send({ agree: true });
    expect(cons.body.office.consent).toMatchObject({ by_user_id: pdAdmin.user.id, text: 'These clients gave this office their number and agreed to receive texts about their case.' });
    expect(cons.body.office.consent.at).toBeTruthy();
    await svc.runPdCourtReminders(ctx.db, { now: new Date() });
    const rows = await ctx.db.all(`SELECT r.step, r.send_at FROM pd_reminders r JOIN pd_court_dates cd ON cd.id = r.court_date_id
                                    WHERE r.pd_client_id = ? AND cd.court_date = ? AND r.status = 'pending' ORDER BY r.send_at`, [ana.id, d10]);
    const local = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    expect(rows.map((r) => [r.step, local(r.send_at)])).toEqual([
      ['d7', `${addDays(d10, -7)}, 09:00`], ['d3', `${addDays(d10, -3)}, 09:00`], ['d1', `${addDays(d10, -1)}, 18:00`],
      ['d0', `${d10}, 06:30`], ['ask', `${d10}, 15:00`], ['missed', `${addDays(d10, 1)}, 09:00`]]);
    // the 7-day text goes out at its time, once, under the office's name, in Spanish
    const at = new Date(zonedDateTimeToUtc(addDays(d10, -7), 9, 1, TZ));
    const before = texts.length;
    const r1 = await svc.runPdCourtReminders(ctx.db, { now: at });
    expect(r1.sent).toBeGreaterThanOrEqual(2);   // Ana and Ben (both on d10)
    const toAna = textsTo(P.a).slice(-1)[0];
    expect(toAna.text).toMatch(/^Metro Nashville Public Defender: Ana, tiene corte en 7 días/);
    expect(toAna.text).toMatch(/Responda STOP para cancelar\.$/);
    expect((await svc.runPdCourtReminders(ctx.db, { now: at })).sent).toBe(0);
    expect(texts.length - before).toBe(r1.sent);
    // logged in the conversation, delivery status joined; never billed per text
    const conv = await pd('get', `/clients/${ana.id}/messages`);
    expect(conv.body.messages[0]).toMatchObject({ direction: 'out', kind: 'reminder', status: 'sent' });
    expect(conv.body.messages[0].body).toBe(toAna.text);
    const raw = await ctx.db.get('SELECT body FROM pd_messages WHERE id = ?', [conv.body.messages[0].id]);
    expect(raw.body).not.toContain('Ana');   // encrypted at rest
    expect(await ctx.db.get(`SELECT COUNT(*)::int AS n FROM bd_texts WHERE to_masked LIKE '%0401'`)).toEqual({ n: 0 });
    // STOP from Ben: his next text is skipped
    expect((await inbound(P.b, 'STOP')).status).toBe(200);
    const at3 = new Date(zonedDateTimeToUtc(addDays(d10, -3), 9, 1, TZ));
    await svc.runPdCourtReminders(ctx.db, { now: at3 });
    const ben = (await pd('get', '/clients?q=Okafor')).body.clients[0];
    expect(ben.opted_out).toBe(true);
    const benRows = (await pd('get', `/clients/${ben.id}`)).body.court_dates[0].texts;
    expect(benRows.find((t) => t.step === 'd3')).toMatchObject({ status: 'skipped', reason: 'opted_out' });
    expect((await pd('post', `/clients/${ben.id}/messages`).send({ body: 'Hi' })).body.code).toBe('opted_out');
    // reminders off for a client cancels their texts
    await pd('patch', `/clients/${ben.id}`).send({ reminders_on: false });
    expect((await pd('get', `/clients/${ben.id}`)).body.court_dates[0].texts.filter((t) => t.status === 'pending')).toEqual([]);
  });

  test('PD4 "Did you make it?" replies set the status; missed → "act today" now; morning after', async () => {
    if (!ctx.app) return;
    const today = todayInZone(TZ);
    const d10 = addDays(today, 10);
    const ana = (await pd('get', '/clients?q=GS-100')).body.clients[0];
    const askAt = new Date(zonedDateTimeToUtc(d10, 15, 1, TZ));
    await svc.runPdCourtReminders(ctx.db, { now: askAt });
    expect(textsTo(P.a).slice(-1)[0].text).toMatch(/¿llegó a la corte hoy\? Responda 1 = fui/);
    // the reply arrives "now" in real time but the ask was sent at askAt (future): answer through the service with that clock
    const { handleCourtReplyText } = await import('../../services/courtReplies.js');
    const r = await handleCourtReplyText({ from: P.a, text: ' 3 ', now: new Date(askAt.getTime() + 60_000), db: ctx.db });
    expect(r).toMatchObject({ handled: true, kind: 'public_defender', status: 'missed', applied: true });
    expect(textsTo(P.a).slice(-1)[0].text).toMatch(/si faltó a la corte el .*actúe hoy: llame a su defensor público al \+16155550190/);
    const det = (await pd('get', `/clients/${ana.id}`)).body.court_dates.find((d) => d.court_date === d10);
    expect(det).toMatchObject({ status: 'missed', status_source: 'reply' });
    // the reply is logged in the conversation (already read, not an inbox item)
    const conv = (await pd('get', `/clients/${ana.id}/messages`)).body.messages;
    expect(conv.some((m) => m.direction === 'in' && m.body.trim() === '3')).toBe(true);
    // a second answer "1" overrides a reply-set status and is confirmed
    const r2 = await handleCourtReplyText({ from: P.a, text: '1', now: new Date(askAt.getTime() + 120_000), db: ctx.db });
    expect(r2).toMatchObject({ status: 'attended', applied: true });
    expect(textsTo(P.a).slice(-1)[0].text).toMatch(/marcada como asistida/);
    // office staff set it: a later reply only gets "we got your answer"
    await pd('patch', `/court-dates/${det.id}`).send({ status: 'rescheduled' });
    const r3 = await handleCourtReplyText({ from: P.a, text: '3', now: new Date(askAt.getTime() + 180_000), db: ctx.db });
    expect(r3).toMatchObject({ status: 'rescheduled', applied: false });
    // morning after for a hearing nobody marked (Cam, d30): the missed text goes at 09:00 the next day
    const d30 = addDays(today, 30);
    const morning = new Date(zonedDateTimeToUtc(addDays(d30, 1), 9, 1, TZ));
    await svc.runPdCourtReminders(ctx.db, { now: morning });
    expect(textsTo(P.c).slice(-1)[0].text).toMatch(/^Metro Nashville Public Defender: Cam, nếu bạn vắng mặt tại tòa/);
  });

  test('PD5 two-way messages: routing, inbox, staff reply, handled', async () => {
    if (!ctx.app) return;
    const today = todayInZone(TZ);
    // the shared number is a client of both offices; office 2 texted it most recently
    await pd('post', '/office/consent', other).send({ agree: true });
    const c2 = await pd('post', '/clients', other).send({ name: 'Dee Shared', phone: P.shared, case_number: 'KX-1', court_dates: [{ court_date: addDays(today, 40) }] });
    expect(c2.status).toBe(201);
    const s2 = await pd('post', `/clients/${c2.body.client.id}/messages`, other).send({ body: 'Please call our office.' });
    expect(s2.status).toBe(201);
    expect(textsTo(P.shared).slice(-1)[0].text).toBe('Knox County PD: Please call our office.');
    // RF9: the number is a client of BOTH offices → no office gets it (never the wrong office's
    // inbox); the sender is asked to call their office; Justice Gavel admins see it as unroutable
    expect((await inbound(P.shared, 'Can I get a ride to court?')).status).toBe(200);
    expect((await pd('get', '/inbox/unread', other)).body.unread).toBe(0);
    expect((await pd('get', '/inbox/unread')).body.unread).toBe(0);
    expect(textsTo(P.shared).slice(-1)[0].text).toMatch(/^Justice Gavel: .*call your public defender's office.* Reply STOP to opt out\.$/);
    expect((await adm('get', '/unroutable', outsider)).status).toBe(403);
    const un = await adm('get', '/unroutable');
    expect(un.status).toBe(200);
    expect(un.body.texts[0]).toMatchObject({ phone_last4: '0405', body: 'Can I get a ride to court?', replied: 'sent' });
    expect(un.body.texts[0].offices.map((o) => o.name).sort()).toEqual(['Knox County PD', 'Metro Nashville Public Defender']);
    // office 2 removes its client: the number belongs to one office again
    expect((await pd('delete', `/clients/${c2.body.client.id}`, other)).status).toBe(200);
    // office 1 texts it: now office 1 gets the next one
    const dee1 = (await pd('get', '/clients?q=GS-400')).body.clients[0];
    expect((await pd('post', `/clients/${dee1.id}/messages`, pdStaff).send({ body: 'Your hearing is at General Sessions.' })).status).toBe(201);
    expect(textsTo(P.shared).slice(-1)[0].text).toBe('Metro Nashville Public Defender: Your hearing is at General Sessions.');
    for (const t of ['Thank you', 'What do I wear?']) expect((await inbound(P.shared, t)).status).toBe(200);
    // STOP / HELP / START / a bare 2 never reach the inbox
    for (const t of ['HELP', '2']) await inbound(P.shared, t);
    const box = await pd('get', '/inbox', pdStaff);
    expect(box.body.unread_total).toBe(2);
    expect(box.body.conversations[0]).toMatchObject({ client_id: dee1.id, unread: 2, handled: false, last_direction: 'in', last_preview: 'What do I wear?' });
    expect(box.body.page_size).toBe(30);
    expect((await pd('get', '/inbox?filter=open', pdStaff)).body.conversations.map((c) => c.client_id)).toEqual([dee1.id]);
    expect((await pd('get', `/clients/${dee1.id}`)).body.client.unread).toBe(2);
    // opening the conversation reads it; newest first; paging
    const conv = await pd('get', `/clients/${dee1.id}/messages?limit=2`, pdStaff);
    expect(conv.body.messages.map((m) => m.body)).toEqual(['What do I wear?', 'Thank you']);
    expect(conv.body.next_before).toBe(conv.body.messages[1].id);
    const older = await pd('get', `/clients/${dee1.id}/messages?before=${conv.body.next_before}&limit=100`, pdStaff);
    expect(older.body.messages[0]).toMatchObject({ direction: 'out', kind: 'staff', body: 'Metro Nashville Public Defender: Your hearing is at General Sessions.', sent_by_name: 'PD PDS' });
    expect((await pd('get', '/inbox/unread')).body.unread).toBe(0);
    expect((await pd('get', `/clients/${dee1.id}/messages?before=abc`)).status).toBe(400);
    // handled → closed until the client writes again
    expect((await pd('post', `/clients/${dee1.id}/handled`).send({ handled: true })).status).toBe(200);
    expect((await pd('get', '/inbox?filter=open')).body.conversations).toEqual([]);
    await inbound(P.shared, 'One more question');
    expect((await pd('get', '/inbox?filter=open')).body.conversations.map((c) => c.client_id)).toEqual([dee1.id]);
    // limits
    expect((await pd('post', `/clients/${dee1.id}/messages`).send({ body: 'x'.repeat(481) })).body.code).toBe('too_long');
    expect((await pd('post', `/clients/${dee1.id}/messages`).send({ body: '  ' })).body.code).toBe('required');
    expect((await pd('get', `/clients/${dee1.id}/messages`, other)).status).toBe(404);
  });

  test('PD6 dashboard and export', async () => {
    if (!ctx.app) return;
    const today = todayInZone(TZ);
    // a past hearing for the appearance counts (Ana attended last week; Cam missed)
    const ana = (await pd('get', '/clients?q=GS-100')).body.clients[0];
    const past = await pd('post', `/clients/${ana.id}/court-dates`).send({ court_date: addDays(today, -7) });
    const pastId = past.body.court_dates.find((d) => d.court_date === addDays(today, -7)).id;
    await pd('patch', `/court-dates/${pastId}`).send({ status: 'attended' });
    const cam = (await pd('get', '/clients?q=GS-300')).body.clients[0];
    const past2 = await pd('post', `/clients/${cam.id}/court-dates`).send({ court_date: addDays(today, -6) });
    await pd('patch', `/court-dates/${past2.body.court_dates.find((d) => d.court_date === addDays(today, -6)).id}`).send({ status: 'missed' });
    const base = await pd('put', '/office/baseline').send({ pilot_start: addDays(today, -30), from: addDays(today, -120), to: addDays(today, -31), hearings: 200, appeared: 150, missed: 40, source: 'Office case management system report' });
    expect(base.status).toBe(200);
    expect((await pd('put', '/office/baseline').send({ from: '2026-01-01', to: '2026-03-31', hearings: 10, appeared: 9, missed: 5, source: 'x' })).body.code).toBe('baseline_sum');
    expect((await pd('put', '/office/baseline', pdStaff).send({})).status).toBe(403);
    const d = await pd('get', '/dashboard', pdStaff);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ clients: 4, opt_outs: 1, rate_definition: 'attended / (attended + missed)' });
    expect(d.body.baseline).toMatchObject({ hearings: 200, appeared: 150, missed: 40, appearance_rate: 78.9, source: 'Office case management system report' });
    expect(d.body.pilot).toMatchObject({ since: addDays(today, -30), attended: 1, missed: 1, appearance_rate: 50 });
    const months = d.body.appearance.reduce((n, m) => n + m.attended + m.missed, 0);
    expect(months).toBe(2);
    expect(d.body.upcoming.length).toBeGreaterThan(0);
    expect(d.body.messages[0].received).toBeGreaterThan(0);
    const one = await pd('get', '/export/messages.csv', pdStaff);
    expect(one.status).toBe(200);
    expect(one.headers['content-type']).toMatch(/text\/csv/);
    expect(one.text).toMatch(/^message_id,client_id,name,case_number,direction,kind,status,delivery,sent_by,at,text\r\n/);
    expect(one.text).toContain('What do I wear?');
    expect((await pd('get', '/export/opt_outs.csv')).text).toContain(P.b);
    expect((await pd('get', '/export/nope.csv')).status).toBe(404);
    const zip = await pd('get', '/export.zip', pdStaff).buffer(true).parse((res, cb) => { const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(zip.status).toBe(200);
    const { readZip } = await import('../../services/bondDesk/zip.js');
    const names = readZip(zip.body).map((e) => e.name);
    expect(names).toEqual(['clients.csv', 'court_dates.csv', 'appearance.csv', 'messages.csv', 'opt_outs.csv', 'baseline.csv', 'README.txt']);
  });

  test('PD7 annual invoice through Stripe: preview, create, idempotent, retried, no second setup fee', async () => {
    if (!ctx.app) return;
    expect((await adm('get', `/${office.id}/invoice-preview?year=2026`, outsider)).status).toBe(403);
    const prev = await adm('get', `/${office.id}/invoice-preview?year=2026`);
    expect(prev.body).toMatchObject({ year: 2026, existing: null, active_clients: 4, setup_cents: 2000000, per_client_cents: 200, clients_cents: 800, amount_cents: 2000800 });
    expect((await adm('post', `/${office.id}/invoices`).send({ year: 2026 })).body.code).toBe('confirm_required');
    // the first try fails on a line item: nothing is marked sent, the retry makes no second invoice
    fake.failNext = 'invoiceItems.create';
    const f = await adm('post', `/${office.id}/invoices`).send({ year: 2026, confirm: true });
    expect([f.status, f.body.code]).toEqual([502, 'payment_provider']);
    const ok = await adm('post', `/${office.id}/invoices`).send({ year: 2026, confirm: true });
    expect(ok.status).toBe(200);   // the row was created by the failed try
    expect(ok.body.invoice).toMatchObject({ year: 2026, status: 'sent', amount_cents: 2000800, active_clients: 4, last_error: null });
    const inv = fake.invoices.get(ok.body.invoice.stripe_invoice_id);
    expect(inv).toMatchObject({ status: 'open', sent: 1, collection_method: 'send_invoice', days_until_due: 30, amount_due: 2000800 });
    expect(fake.calls.filter((c) => c.name === 'invoices.create')).toHaveLength(1);
    expect(fake.items.filter((i) => i.invoice === inv.id).map((i) => [i.amount, i.description])).toEqual([
      [2000000, 'Setup fee (one time)'], [800, 'Active clients 2026: 4 × $2.00 (texts included)']]);
    // again: same invoice, nothing new
    const again = await adm('post', `/${office.id}/invoices`).send({ year: 2026, confirm: true });
    expect([again.status, again.body.created, again.body.invoice.id]).toEqual([200, false, ok.body.invoice.id]);
    expect(fake.invoices.size).toBe(1);
    expect((await adm('get', `/${office.id}/invoice-preview?year=2026`)).body.existing.status).toBe('sent');
    // next year: no setup fee
    expect((await adm('get', `/${office.id}/invoice-preview?year=2027`)).body).toMatchObject({ setup_cents: 0, amount_cents: 800 });
    const y2 = await adm('post', `/${office.id}/invoices`).send({ year: 2027, confirm: true });
    expect([y2.status, y2.body.invoice.amount_cents]).toEqual([201, 800]);
    expect((await adm('get', `/${office.id}`)).body.invoices.map((i) => i.year)).toEqual([2027, 2026]);
    expect((await adm('get', `/${office.id}/invoice-preview?year=1999`)).body.code).toBe('bad_year');
  });

  test('RF2 an invoice retried after Stripe forgot the idempotency keys gets no duplicate lines', async () => {
    if (!ctx.app) return;
    // the lines are added, then finalizing fails; the retry comes after Stripe's ~24-hour key window
    fake.failNext = 'invoices.finalizeInvoice';
    const f = await adm('post', `/${office2.id}/invoices`).send({ year: 2026, confirm: true });
    expect([f.status, f.body.code]).toEqual([502, 'payment_provider']);
    const row = await ctx.db.get('SELECT stripe_invoice_id FROM pd_invoices WHERE office_id = ? AND year = 2026', [office2.id]);
    const firstTry = fake.items.filter((i) => i.invoice === row.stripe_invoice_id).length;
    expect(firstTry).toBeGreaterThanOrEqual(1);
    fake.forgetKeys();
    const ok = await adm('post', `/${office2.id}/invoices`).send({ year: 2026, confirm: true });
    expect(ok.status).toBe(200);
    expect(ok.body.invoice.status).toBe('sent');
    const lines = fake.items.filter((i) => i.invoice === row.stripe_invoice_id);
    expect(lines).toHaveLength(firstTry);
    expect(lines.filter((i) => i.metadata.line === 'setup').map((i) => i.amount)).toEqual([2000000]);
    expect(fake.invoices.get(row.stripe_invoice_id)).toMatchObject({ status: 'open', amount_due: ok.body.invoice.amount_cents, sent: 1 });
  });

  test('PD8 setting off: 503, hidden, no texts, no inbox', async () => {
    if (!ctx.app) return;
    process.env.PUBLIC_DEFENDER_CHANNEL_ENABLED = 'false';
    try {
      expect((await pd('get', '/status')).body).toMatchObject({ enabled: false, member: null });
      const r = await pd('get', '/clients');
      expect([r.status, r.body.code]).toEqual([503, 'feature_unavailable']);
      expect((await adm('get', '')).status).toBe(503);
      expect(await svc.runPdCourtReminders(ctx.db)).toMatchObject({ skipped_job: 'feature_off', sent: 0 });
      const n = await ctx.db.get('SELECT COUNT(*)::int AS n FROM pd_messages WHERE office_id = ?', [office.id]);
      await inbound(P.shared, 'Anyone there?');
      expect(await ctx.db.get('SELECT COUNT(*)::int AS n FROM pd_messages WHERE office_id = ?', [office.id])).toEqual(n);
    } finally {
      process.env.PUBLIC_DEFENDER_CHANNEL_ENABLED = 'true';
    }
  });
});
