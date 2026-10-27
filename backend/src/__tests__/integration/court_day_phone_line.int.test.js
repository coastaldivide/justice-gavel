/**
 * court_day_phone_line.int.test.js — migration 40 on the real app + real Postgres, with a fake
 * Telnyx (texts and Call Control commands) and a fake Expo push server.
 *
 *   PV1  phone verification: the code goes by text and is stored only as an HMAC; wrong codes
 *        count, 5 lock it, expired codes are refused; limits per number; a changed phone loses it
 *   PV2  an attacker who registers with someone else's phone / e-mail sees nothing (card, check-in
 *        list, status); a held pre-verification link comes back only when the phone is verified
 *   A8a  "Plan your court day": saved on the court date, owner only; 211, the county's cited
 *        transit agency (or none), directions; the reminder text links to the court date
 *   A8b  "Offer a ride": followers who get reminders offer, the owner is pushed and answers, the
 *        follower is told; followers without reminders cannot
 *   A8c  the check-in link page shows the next court date with help links
 *   A10  the phone line: unsigned / badly signed → 401, off → 503; menu in English and Spanish;
 *        caller-ID match reads only day, time, court and room; texting; keypad entry; missed-court
 *        guidance; per-caller limit; the call log keeps no full number
 *   B11  results: admin only; publishing refused under 100 answers; the snapshot is immutable;
 *        the public page shows only what was published
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { describeIntegration, initSuite } from './_harness.js';
import { todayInZone, addDays } from '../../utils/timezone.js';

const TZ = 'America/Chicago';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB_B64 = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

describeIntegration('court-day plan, ride offers, phone verification, phone line, results (real Postgres)', () => {
  const ctx = initSuite();
  const texts = []; const calls = []; const pushes = [];
  let telnyx; let expo;
  let owner; let follower; let quietFollower; let victim; let attacker; let agent; let admin;
  let ipN = 0;
  const req = (m, path, who) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.88.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (who) r = r.set(who.headers);
    return r;
  };
  const textsTo = (p) => texts.filter((t) => t.to === p);
  const codeFor = (p) => (/\b(\d{6})\b/.exec(textsTo(p).at(-1)?.text || '') || [])[1];
  const today = () => todayInZone(TZ);
  const verifyDirect = (u, phone) => ctx.db.run(
    'UPDATE users SET phone = ?, phone_verified_phone = ?, phone_verified_at = NOW() WHERE id = ?', [phone, phone, u.user.id]);

  beforeAll(async () => {
    if (!ctx.app) return;
    const fake = (onReq) => http.createServer((rq, rs) => {
      let d = ''; rq.on('data', (c) => { d += c; });
      rq.on('end', () => { const out = onReq(rq.url, JSON.parse(d || 'null')); rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(out)); });
    });
    telnyx = fake((url, body) => {
      if (url === '/messages') { texts.push(body); return { data: { id: `pl_tx_${texts.length}` } }; }
      calls.push({ url, body }); return { data: { result: 'ok' } };
    });
    expo = fake((url, body) => { pushes.push(...(Array.isArray(body) ? body : [body])); return { data: (Array.isArray(body) ? body : [body]).map((_, k) => ({ status: 'ok', id: `x${k}` })) }; });
    await Promise.all([telnyx, expo].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
    Object.assign(process.env, {
      TELNYX_API_KEY: 'KEY_pl', TELNYX_FROM_NUMBER: '+16155550100', TELNYX_API_BASE: `http://127.0.0.1:${telnyx.address().port}`,
      EXPO_PUSH_API_URL: `http://127.0.0.1:${expo.address().port}/--/api/v2`, TELNYX_PUBLIC_KEY: PUB_B64,
      TELNYX_VOICE_NUMBER: '+18005550199',
    });
    [owner, follower, quietFollower, victim, attacker, admin] = await Promise.all(
      ['Olive Owner', 'Fran Follower', 'Quinn Quiet', 'Vic Victim', 'Al Attacker', 'Ada Admin'].map((n) => ctx.register({ displayName: n })));
    agent = await ctx.register({ displayName: 'PL Agent', accountType: 'bail_agent' });
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(admin.user.id);
    for (const [u, tok] of [[owner, 'ExponentPushToken[pl-owner]'], [follower, 'ExponentPushToken[pl-follower]']]) {
      expect((await req('post', '/api/push/token', u).send({ token: tok })).status).toBeLessThan(300);
    }
    ctx.addCleanup(async (db) => {
      await db.run(`DELETE FROM checkin_enrollments WHERE bondsman_id = ?`, [agent.user.id]);
      await db.run(`DELETE FROM bd_bonds WHERE agent_id = ?`, [agent.user.id]);
      await db.run(`DELETE FROM voice_calls WHERE call_control_id LIKE 'v3:pl-%'`);
      await db.run(`DELETE FROM sms_opt_outs WHERE phone LIKE '+1615555%'`);
      await db.transaction(async (tx) => {
        await tx.get(`SELECT set_config('jg.results_purge', 'on', true)`);
        await tx.run('DELETE FROM results_snapshots WHERE published_by = ?', [admin.user.id]);
      });
    });
  });
  afterAll(async () => {
    for (const s of [telnyx, expo]) if (s) await new Promise((r) => s.close(r));
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'EXPO_PUSH_API_URL', 'TELNYX_PUBLIC_KEY', 'TELNYX_VOICE_NUMBER', 'TELNYX_VOICE_ENABLED']) delete process.env[k];
  });

  // ── Phone verification ────────────────────────────────────────────────────
  test('PV1 the code is texted, stored only as an HMAC, limited, locked after 5 wrong tries; a new phone loses it', async () => {
    if (!ctx.app) return;
    expect((await req('post', '/api/me/phone/verify').send({ phone: '615-555-0201' })).status).toBe(401);
    expect((await req('post', '/api/me/phone/verify', owner).send({ phone: '12' })).body.code).toBe('bad_phone');
    const s = await req('post', '/api/me/phone/verify', owner).send({ phone: '(615) 555-0201' });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ sent: true, phone_masked: '•••-•••-0201' });
    const code = codeFor('+16155550201');
    expect(code).toMatch(/^\d{6}$/);
    expect(textsTo('+16155550201').at(-1).text).toMatch(/STOP/);
    const row = await ctx.db.get('SELECT code_hash, phone FROM phone_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', [owner.user.id]);
    expect(row.code_hash).not.toContain(code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    // a second code to the same number within a minute is refused
    expect((await req('post', '/api/me/phone/verify', owner).send({ phone: '6155550201' })).body.code).toBe('code_just_sent');
    const wrong = code === '000000' ? '111111' : '000000';
    const w1 = await req('post', '/api/me/phone/confirm', owner).send({ code: wrong });
    expect([w1.status, w1.body.code, w1.body.left]).toEqual([400, 'wrong_code', 4]);
    const ok = await req('post', '/api/me/phone/confirm', owner).send({ code });
    expect([ok.status, ok.body.verified]).toEqual([200, true]);
    expect((await req('get', '/api/me/phone', owner)).body).toMatchObject({ phone: '+16155550201', phone_verified: true });
    // changing the phone anywhere drops the verification (database trigger)
    expect((await req('post', '/api/auth/update-profile', owner).send({ phone: '615-555-0299' })).status).toBe(200);
    expect((await req('get', '/api/me/phone', owner)).body.phone_verified).toBe(false);
    // 5 wrong tries lock the code
    await ctx.db.run(`UPDATE phone_verifications SET created_at = created_at - INTERVAL '2 minutes' WHERE user_id = ?`, [owner.user.id]);
    expect((await req('post', '/api/me/phone/verify', owner).send({ phone: '615-555-0201' })).status).toBe(200);
    const good = codeFor('+16155550201');
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect((await req('post', '/api/me/phone/confirm', owner).send({ code: bad })).body.code).toBe('wrong_code');
    expect((await req('post', '/api/me/phone/confirm', owner).send({ code: bad })).body.code).toBe('code_locked');
    expect((await req('post', '/api/me/phone/confirm', owner).send({ code: good })).body.code).toBe('no_code');
    // an expired code is refused
    await ctx.db.run(`UPDATE phone_verifications SET created_at = created_at - INTERVAL '2 minutes' WHERE user_id = ?`, [owner.user.id]);
    expect((await req('post', '/api/me/phone/verify', owner).send({ phone: '615-555-0201' })).status).toBe(200);
    await ctx.db.run(`UPDATE phone_verifications SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = ? AND status = 'pending'`, [owner.user.id]);
    expect((await req('post', '/api/me/phone/confirm', owner).send({ code: codeFor('+16155550201') })).body.code).toBe('code_expired');
    // a number that replied STOP gets no code
    await ctx.db.run(`INSERT INTO sms_opt_outs (phone) VALUES ('+16155550298') ON CONFLICT DO NOTHING`);
    expect((await req('post', '/api/me/phone/verify', owner).send({ phone: '615-555-0298' })).body.code).toBe('opted_out');
  });

  test('PV2 an attacker with the victim\'s phone and e-mail sees nothing; the verified owner does; held links return on verification', async () => {
    if (!ctx.app) return;
    await ctx.db.run(`INSERT INTO bondsman_profiles (user_id, company_name, phone) VALUES (?, 'Kappa Bail', '615-555-0400')`, [agent.user.id]);
    const e = await ctx.db.get(
      `INSERT INTO checkin_enrollments (bondsman_id, defendant_name, defendant_phone, defendant_email, court_date, check_in_freq, active, channel, created_at, updated_at)
       VALUES (?, 'Vic Victim', '+16155550210', ?, CAST(? AS date), 'daily', 1, 'app', NOW(), NOW()) RETURNING id`,
      [agent.user.id, victim.email, addDays(today(), 12)]);
    // the attacker registers with the victim's e-mail as contact and puts the victim's phone on the account
    await ctx.db.run('UPDATE users SET phone = ? WHERE id = ?', ['+16155550210', attacker.user.id]);
    await ctx.db.run('UPDATE users SET email = ? WHERE id = ?', [`${ctx.tag}-x-${victim.email}`, attacker.user.id]);
    for (const path of ['/api/me/bail-agent', '/api/checkins/mine', `/api/checkins/status/${e.id}`]) {
      const r = await req('get', path, attacker);
      expect(JSON.stringify(r.body)).not.toContain('Kappa');
      expect(JSON.stringify(r.body)).not.toContain('Vic Victim');
    }
    expect((await req('get', '/api/me/bail-agent', attacker)).body).toMatchObject({ agents: [], phone_verified: false, verify_prompt: false });
    // the victim's e-mail matches the enrollment too: still nothing without a verified phone
    expect((await req('get', '/api/me/bail-agent', victim)).body.agents).toEqual([]);
    // the attacker cannot verify the number (the code goes to the victim's phone)
    expect((await req('post', '/api/me/phone/verify', attacker).send({ phone: '+16155550210' })).status).toBe(200);
    expect((await req('post', '/api/me/phone/confirm', attacker).send({ code: '123456' === codeFor('+16155550210') ? '654321' : '123456' })).body.code).toBe('wrong_code');
    // the victim verifies (after the per-number gap) and gets the card
    await ctx.db.run(`UPDATE phone_verifications SET created_at = created_at - INTERVAL '2 minutes' WHERE phone = '+16155550210'`);
    expect((await req('post', '/api/me/phone/verify', victim).send({ phone: '615-555-0210' })).status).toBe(200);
    expect((await req('post', '/api/me/phone/confirm', victim).send({ code: codeFor('+16155550210') })).body.linked).toBe(1);
    const card = await req('get', '/api/me/bail-agent', victim);
    expect(card.body.agents[0]).toMatchObject({ enrollment_id: Number(e.id), agency: { name: 'Kappa Bail' } });
    expect((await req('get', '/api/me/bail-agent', attacker)).body.agents).toEqual([]);
    // a link made before verification existed (held by migration 40): hidden, prompt shown, back after verifying
    const held = await ctx.db.get(
      `INSERT INTO checkin_enrollments (bondsman_id, defendant_name, defendant_phone, check_in_freq, active, channel, held_user_id, held_at, created_at, updated_at)
       VALUES (?, 'Fran Follower', '+16155550220', 'daily', 1, 'app', ?, NOW(), NOW(), NOW()) RETURNING id`, [agent.user.id, follower.user.id]);
    const before = await req('get', '/api/me/bail-agent', follower);
    expect(before.body).toMatchObject({ agents: [], verify_prompt: true });
    await verifyDirect(follower, '+16155550220');
    const after = await req('get', '/api/me/bail-agent', follower);
    expect(after.body.agents.map((a) => a.enrollment_id)).toEqual([Number(held.id)]);
    expect(after.body.verify_prompt).toBe(false);
    expect((await ctx.db.get('SELECT held_user_id FROM checkin_enrollments WHERE id = ?', [held.id])).held_user_id).toBeNull();
  });

  // ── A8 ─────────────────────────────────────────────────────────────────────
  let cd; let followId; let pd;
  test('A8a the plan is saved on the court date; help links name the cited transit agency; the reminder text links here', async () => {
    if (!ctx.app) return;
    const ch = await ctx.db.get(`SELECT id FROM courthouses WHERE state = 'TN' AND county = 'Davidson' LIMIT 1`);
    const r = await req('post', '/api/court-dates', owner).set('X-Timezone', TZ).send({ case_title: 'PL case', court_date: addDays(today(), 9), court_time: '09:30', courthouse_id: ch.id, location: 'Room 4B' });
    expect(r.status).toBe(201);
    cd = r.body;
    const g = await req('get', `/api/court-dates/${cd.id}`, owner);
    expect(g.body.plan.map((i) => i.id)).toEqual(['ride', 'time_off', 'child_care', 'documents', 'address_room']);
    expect(g.body.help).toMatchObject({
      call_211: { phone: '211', url: 'https://www.211.org' },
      transit: { agency: 'WeGo Public Transit', source_url: expect.stringMatching(/^https:\/\//), checked: '2026-10-27' },
      public_defender: null,
    });
    expect(g.body.help.directions_url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
    expect(g.body.ride_offers).toEqual([]);
    expect((await req('put', `/api/court-dates/${cd.id}/plan`, owner).send({ items: { bus: { done: true } } })).status).toBe(400);
    expect((await req('put', `/api/court-dates/${cd.id}/plan`, owner).send({ items: { ride: { note: 'x'.repeat(201) } } })).body.code).toBe('note_too_long');
    const s = await req('put', `/api/court-dates/${cd.id}/plan`, owner).send({ items: { ride: { done: true, note: 'Bus 52 at 8:10' }, child_care: { done: false, note: 'Ask Mom' } } });
    expect(s.status).toBe(200);
    expect(s.body.plan.find((i) => i.id === 'ride')).toEqual({ id: 'ride', done: true, note: 'Bus 52 at 8:10' });
    await req('put', `/api/court-dates/${cd.id}/plan`, owner).send({ items: { documents: { done: true } } });
    const again = await req('get', `/api/court-dates/${cd.id}`, owner);
    expect(again.body.plan.filter((i) => i.done).map((i) => i.id)).toEqual(['ride', 'documents']);
    // someone else's court date: 404, plan untouched
    expect((await req('put', `/api/court-dates/${cd.id}/plan`, attacker).send({ items: { ride: { done: false } } })).status).toBe(404);
    // a courthouse in a county without a cited agency: 211 and directions only
    const { helpLinks } = await import('../../services/courtDayHelp.js');
    expect(helpLinks({ county: 'Lake', state: 'TN', address: '1 Main St' }).transit).toBeNull();
    // the reminder text (A6 plan prompt) carries the link to this court date, within 2 segments
    const { courtSmsText } = await import('../../services/reminderDispatcher.js');
    const { smsSegments } = await import('../../services/smsText.js');
    const row = await ctx.db.get(`SELECT * FROM scheduled_pushes WHERE court_date_id = ? AND notification_type = 'court_reminder' LIMIT 1`, [cd.id]);
    const text = await courtSmsText(ctx.db, row, JSON.parse(row.data), 'en');
    expect(text).toContain(`/court-dates/${cd.id}`);
    expect(smsSegments(text).segments).toBeLessThanOrEqual(2);
  });

  test('A8b a follower who gets reminders offers a ride; the owner is pushed and answers; the follower is told', async () => {
    if (!ctx.app) return;
    const inv = await req('post', `/api/cases/${cd.case_id}/followers`, owner).send({ consent: true, name: 'Fran', share_reminders: true });
    expect(inv.status).toBe(201);
    const acc = await req('post', '/api/following/accept', follower).send({ code: inv.body.invite_code });
    followId = acc.body.following.follow_id;
    const quiet = await req('post', `/api/cases/${cd.case_id}/followers`, owner).send({ consent: true, share_reminders: false });
    const qacc = await req('post', '/api/following/accept', quietFollower).send({ code: quiet.body.invite_code });
    const list = await req('get', '/api/following', follower);
    expect(list.body.following[0].court_dates.find((d) => d.id === cd.id)).toMatchObject({ can_offer_ride: true, ride_offer: null });
    expect((await req('get', '/api/following', quietFollower)).body.following[0].court_dates[0].can_offer_ride).toBe(false);
    expect((await req('post', `/api/following/${qacc.body.following.follow_id}/court-dates/${cd.id}/ride-offer`, quietFollower)).body.code).toBe('reminders_off');
    expect((await req('post', `/api/following/${followId}/court-dates/${cd.id}/ride-offer`, attacker)).status).toBe(404);
    const n = pushes.length;
    const o = await req('post', `/api/following/${followId}/court-dates/${cd.id}/ride-offer`, follower);
    expect([o.status, o.body.status]).toEqual([201, 'offered']);
    const toOwner = pushes.slice(n).find((p) => p.to === 'ExponentPushToken[pl-owner]');
    expect(toOwner.body).toMatch(/^Fran offered a ride to court on /);
    // offering twice does not push twice
    expect((await req('post', `/api/following/${followId}/court-dates/${cd.id}/ride-offer`, follower)).body.already).toBe(true);
    const offers = (await req('get', `/api/court-dates/${cd.id}`, owner)).body.ride_offers;
    expect(offers).toEqual([expect.objectContaining({ name: 'Fran', status: 'offered' })]);
    expect((await req('post', `/api/court-dates/${cd.id}/ride-offers/${offers[0].id}`, attacker).send({ decision: 'accept' })).status).toBe(404);
    const m = pushes.length;
    const d = await req('post', `/api/court-dates/${cd.id}/ride-offers/${offers[0].id}`, owner).send({ decision: 'accept' });
    expect([d.status, d.body.status]).toEqual([200, 'accepted']);
    expect(pushes.slice(m).find((p) => p.to === 'ExponentPushToken[pl-follower]').body).toMatch(/^Olive accepted your ride to court on /);
    expect((await req('get', '/api/following', follower)).body.following[0].court_dates.find((x) => x.id === cd.id).ride_offer).toBe('accepted');
    expect((await req('delete', `/api/following/${followId}/court-dates/${cd.id}/ride-offer`, follower)).body.status).toBe('withdrawn');
  });

  test('A8c the check-in link page shows the next Bond Desk court date with help links', async () => {
    if (!ctx.app) return;
    const { newLinkToken, hashLinkToken } = await import('../../services/checkinTexts.js');
    const e = await ctx.db.get(
      `INSERT INTO checkin_enrollments (bondsman_id, defendant_name, defendant_phone, check_in_freq, active, channel, created_at, updated_at)
       VALUES (?, 'Lee Linkpage', '+16155550230', 'daily', 1, 'sms', NOW(), NOW()) RETURNING id`, [agent.user.id]);
    const b = await ctx.db.get(
      `INSERT INTO bd_bonds (agent_id, status, defendant_name, defendant_phone, county, state, court_name, bond_amount_cents, checkin_enrollment_id, charges)
       VALUES (?, 'active', 'Lee Linkpage', '+16155550230', 'Knox', 'TN', 'Knox County Criminal Court', 500000, ?, 'SECRET-CHARGE') RETURNING id`, [agent.user.id, e.id]);
    await ctx.db.run(`INSERT INTO bd_court_dates (bond_id, court_date, court_time, room) VALUES (?, CAST(? AS date), '13:30', 'Div. III')`, [b.id, addDays(today(), 5)]);
    const token = newLinkToken();
    await ctx.db.run(`INSERT INTO checkin_link_tokens (enrollment_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL '30 days')`, [e.id, hashLinkToken(token)]);
    const page = await req('get', `/api/checkins/link/${token}`);
    expect(page.status).toBe(200);
    expect(page.body.court).toMatchObject({ date: addDays(today(), 5), time: '13:30', court_name: 'Knox County Criminal Court', room: 'Div. III',
      help: { call_211: { phone: '211' }, transit: { agency: 'Knoxville Area Transit (KAT)' } } });
    expect(JSON.stringify(page.body)).not.toContain('SECRET-CHARGE');
  });

  // ── A10 phone line ─────────────────────────────────────────────────────────
  const sign = (body, ts = Math.floor(Date.now() / 1000)) => ({
    'telnyx-timestamp': String(ts),
    'telnyx-signature-ed25519': crypto.sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64'),
  });
  let callN = 0;
  const voice = async (event_type, payload) => {
    const body = JSON.stringify({ data: { event_type, payload } });
    return ctx.request().post('/api/webhooks/telnyx-voice').set('Content-Type', 'application/json').set(sign(body)).send(body);
  };
  const stateOf = (cmd) => JSON.parse(Buffer.from(cmd.body.client_state, 'base64').toString('utf8'));
  const lastCmd = () => calls.at(-1);

  test('A10a unsigned or badly signed webhooks are refused; the line is off by default', async () => {
    if (!ctx.app) return;
    const body = JSON.stringify({ data: { event_type: 'call.initiated', payload: { call_control_id: 'v3:pl-x', from: '+16155550210', to: '+18005550199', direction: 'incoming' } } });
    expect((await ctx.request().post('/api/webhooks/telnyx-voice').set('Content-Type', 'application/json').send(body)).status).toBe(401);
    const forged = { 'telnyx-timestamp': String(Math.floor(Date.now() / 1000)), 'telnyx-signature-ed25519': Buffer.alloc(64).toString('base64') };
    expect((await ctx.request().post('/api/webhooks/telnyx-voice').set('Content-Type', 'application/json').set(forged).send(body)).status).toBe(401);
    expect((await ctx.request().post('/api/webhooks/telnyx-voice').set('Content-Type', 'application/json').set(sign(body, Math.floor(Date.now() / 1000) - 900)).send(body)).status).toBe(401);
    const off = await ctx.request().post('/api/webhooks/telnyx-voice').set('Content-Type', 'application/json').set(sign(body)).send(body);
    expect([off.status, off.body.code]).toEqual([503, 'feature_unavailable']);
    expect(calls).toHaveLength(0);
    // the app shows the line's number only when it is on
    expect((await req('get', '/api/court-dates/guidance')).body.phone_line).toBeNull();
  });

  test('A10b caller ID match: English and Spanish menus, the date read aloud (nothing else), the text, missed-court guidance', async () => {
    if (!ctx.app) return;
    process.env.TELNYX_VOICE_ENABLED = 'true';
    expect((await req('get', '/api/court-dates/guidance')).body.phone_line).toEqual({ number: '+18005550199', languages: ['en', 'es'] });
    // a Bond Desk defendant with two hearings; the bond carries details that must never be read
    const b = await ctx.db.get(
      `INSERT INTO bd_bonds (agent_id, status, defendant_name, defendant_phone, county, state, court_name, bond_amount_cents, charges, case_number)
       VALUES (?, 'active', 'Pat Phoneline', '(615) 555-0240', 'Davidson', 'TN', 'General Sessions Court', 900000, 'SECRET-CHARGE', 'CASE-SECRET') RETURNING id`, [agent.user.id]);
    const d1 = addDays(today(), 8); const d2 = addDays(today(), 30);
    await ctx.db.run(`INSERT INTO bd_court_dates (bond_id, court_date, court_time, court_name, room) VALUES (?, CAST(? AS date), '09:00', 'General Sessions Court', '5C'), (?, CAST(? AS date), '10:00', NULL, NULL)`,
      [b.id, d1, b.id, d2]);
    const id = `v3:pl-${++callN}`;
    const base = { call_control_id: id, from: '+16155550240', to: '+18005550199', direction: 'incoming' };
    // another number on the account is ignored
    expect((await voice('call.initiated', { ...base, call_control_id: 'v3:pl-other', to: '+18005550000' })).body.action).toBe('other_number');
    expect((await voice('call.initiated', base)).body.action).toBe('answer');
    expect(lastCmd().url).toBe(`/calls/${encodeURIComponent(id)}/actions/answer`);
    expect((await voice('call.answered', { ...base, client_state: lastCmd().body.client_state })).body.action).toBe('language_menu');
    expect(lastCmd().url).toMatch(/gather_using_speak$/);
    expect(lastCmd().body).toMatchObject({ payload_type: 'ssml', valid_digits: '12' });
    expect(lastCmd().body.payload).toContain('para español, oprima 2'.replace('para', 'Para'));
    // Spanish
    const g1 = await voice('call.gather.ended', { ...base, digits: '2', status: 'valid', client_state: lastCmd().body.client_state });
    expect(g1.body).toMatchObject({ action: 'menu', matched: true });
    expect(lastCmd().body).toMatchObject({ language: 'es-US', voice: 'Polly.Lupe' });
    expect(lastCmd().body.payload).toMatch(/oprima 1/);
    // 1 → the soonest hearing: day, time, court and room only
    await voice('call.gather.ended', { ...base, digits: '1', status: 'valid', client_state: lastCmd().body.client_state });
    const said = lastCmd().body.payload;
    expect(said).toMatch(/Su próxima fecha de corte es el .*9:00 de la mañana.*General Sessions Court.*Sala 5C/);
    for (const secret of ['SECRET-CHARGE', 'CASE-SECRET', 'Pat', '9000', 'Phoneline']) expect(said).not.toContain(secret);
    // 2 → texted to the number on file, once an hour
    const t0 = textsTo('+16155550240').length;
    await voice('call.gather.ended', { ...base, digits: '2', status: 'valid', client_state: lastCmd().body.client_state });
    expect(textsTo('+16155550240').length).toBe(t0 + 1);
    expect(textsTo('+16155550240').at(-1).text).toMatch(/^Justice Gavel: Su próxima fecha de corte .*Responda STOP para cancelar\.$/);
    expect(lastCmd().body.payload).toMatch(/Enviamos su próxima fecha de corte/);
    await voice('call.gather.ended', { ...base, digits: '2', status: 'valid', client_state: lastCmd().body.client_state });
    expect(textsTo('+16155550240').length).toBe(t0 + 1);
    expect(lastCmd().body.payload).toMatch(/Ya enviamos un mensaje/);
    // 3 → the missed-court guidance
    await voice('call.gather.ended', { ...base, digits: '3', status: 'valid', client_state: lastCmd().body.client_state });
    expect(lastCmd().body.payload).toMatch(/Llame a su abogado|secretario/);
    // no answer → goodbye, then hang up
    await voice('call.gather.ended', { ...base, digits: '', status: 'timeout', client_state: lastCmd().body.client_state });
    expect(lastCmd().url).toMatch(/\/speak$/);
    await voice('call.speak.ended', { ...base, client_state: lastCmd().body.client_state });
    expect(lastCmd().url).toMatch(/\/hangup$/);
    await voice('call.hangup', base);
    const log = await ctx.db.get('SELECT * FROM voice_calls WHERE call_control_id = ?', [id]);
    expect(log).toMatchObject({ lang: 'es', matched: 'caller_id', heard_date: true, texted: 'sent', heard_missed: true, caller_last4: '0240' });
    expect(log.ended_at).toBeTruthy();
    expect(JSON.stringify(log)).not.toContain('6155550240');
    // STOP is respected
    await ctx.db.run(`INSERT INTO sms_opt_outs (phone) VALUES ('+16155550240') ON CONFLICT DO NOTHING`);
    await ctx.db.run(`UPDATE voice_calls SET started_at = started_at - INTERVAL '2 hours' WHERE call_control_id = ?`, [id]);
    const st = encodeURIComponent; void st;
    const s2 = Buffer.from(JSON.stringify({ s: 'menu', l: 'en', p: '+16155550240', m: 'caller_id' })).toString('base64');
    await voice('call.gather.ended', { ...base, digits: '2', status: 'valid', client_state: s2 });
    expect(textsTo('+16155550240').length).toBe(t0 + 1);
    expect(lastCmd().body.payload).toMatch(/replied STOP/);
  });

  test('A10c unknown caller: keypad entry of the number on file (a verified account), 3 tries; per-caller limit', async () => {
    if (!ctx.app) return;
    process.env.TELNYX_VOICE_ENABLED = 'true';
    const id = `v3:pl-${++callN}`;
    const base = { call_control_id: id, from: '+12125550111', to: '+18005550199', direction: 'incoming' };
    await voice('call.initiated', base);
    await voice('call.answered', { ...base, client_state: lastCmd().body.client_state });
    expect((await voice('call.gather.ended', { ...base, digits: '1', status: 'valid', client_state: lastCmd().body.client_state })).body).toMatchObject({ matched: false });
    expect(lastCmd().body).toMatchObject({ language: 'en-US', voice: 'Polly.Joanna' });
    expect((await voice('call.gather.ended', { ...base, digits: '1', status: 'valid', client_state: lastCmd().body.client_state })).body.action).toBe('ask_phone');
    expect(lastCmd().body).toMatchObject({ minimum_digits: 10 });
    // a number with nothing on file
    expect((await voice('call.gather.ended', { ...base, digits: '6155550999', status: 'valid', client_state: lastCmd().body.client_state })).body.action).toBe('keypad_not_found');
    // the owner's court date (A8a), found through the owner's VERIFIED phone only
    await verifyDirect(owner, '+16155550250');
    await voice('call.gather.ended', { ...base, digits: '1', status: 'valid', client_state: lastCmd().body.client_state });
    expect((await voice('call.gather.ended', { ...base, digits: '6155550250', status: 'valid', client_state: lastCmd().body.client_state })).body.action).toBe('read_date');
    expect(lastCmd().body.payload).toMatch(/Your next court date is .*9:30 AM.*Room 4B/);
    expect(lastCmd().body.payload).not.toContain('PL case');
    // a new call: an unverified number on an account is not "on file"; the 4th number on one call ends it
    const id2 = `v3:pl-${++callN}`;
    const b2 = { ...base, call_control_id: id2 };
    await ctx.db.run('UPDATE users SET phone = ? WHERE id = ?', ['+16155550251', attacker.user.id]);
    await voice('call.initiated', b2);
    await voice('call.answered', { ...b2, client_state: lastCmd().body.client_state });
    await voice('call.gather.ended', { ...b2, digits: '1', status: 'valid', client_state: lastCmd().body.client_state });
    for (const n of ['6155550251', '6155550253', '6155550254']) {
      expect((await voice('call.gather.ended', { ...b2, digits: '1', status: 'valid', client_state: lastCmd().body.client_state })).body.action).toBe('ask_phone');
      expect((await voice('call.gather.ended', { ...b2, digits: n, status: 'valid', client_state: lastCmd().body.client_state })).body.action).toBe('keypad_not_found');
    }
    await voice('call.gather.ended', { ...b2, digits: '1', status: 'valid', client_state: lastCmd().body.client_state });
    expect((await voice('call.gather.ended', { ...b2, digits: '6155550255', status: 'valid', client_state: lastCmd().body.client_state })).body.action).toBe('keypad_limited');
    expect((await ctx.db.get('SELECT keypad_tries FROM voice_calls WHERE call_control_id = ?', [id2])).keypad_tries).toBe(4);
    // per caller: the 7th call in an hour is answered with "call later" and hung up
    for (let i = 0; i < 4; i++) await voice('call.initiated', { ...base, call_control_id: `v3:pl-${++callN}` });
    const lim = `v3:pl-${++callN}`;
    expect((await voice('call.initiated', { ...base, call_control_id: lim })).body.action).toBe('answer_limited');
    expect((await voice('call.answered', { ...base, call_control_id: lim, client_state: lastCmd().body.client_state })).body.action).toBe('limited');
    expect(lastCmd().url).toMatch(/\/speak$/);
    expect((await ctx.db.get('SELECT refused FROM voice_calls WHERE call_control_id = ?', [lim])).refused).toBe('rate_limited');
    delete process.env.TELNYX_VOICE_ENABLED;
  });

  // ── B11 results ────────────────────────────────────────────────────────────
  test('B11 admin only; under 100 answers nothing is published; the snapshot is immutable; the public page shows it', async () => {
    if (!ctx.app) return;
    const existing = await ctx.db.get('SELECT COUNT(*)::int AS n FROM results_snapshots');
    if (existing.n === 0) expect((await req('get', '/api/results')).body.code).toBe('not_published');
    expect((await req('get', '/api/admin/results/preview')).status).toBe(401);
    expect((await req('get', '/api/admin/results/preview', owner)).status).toBe(403);
    expect((await req('post', '/api/admin/results/publish', owner).send({})).status).toBe(403);
    expect((await req('get', '/api/admin/results/preview', admin).query({ from: '2026-13-01' })).body.code).toBe('bad_period');
    expect((await req('get', '/api/admin/results/preview', admin).query({ to: addDays(today(), 3) })).body.code).toBe('period_not_over');
    // a far-past period with a known population: 60 attended, 20 missed, 15 rescheduled, 5 no answer
    const from = '2001-03-01'; const to = '2001-03-31';
    const b = await ctx.db.get(`INSERT INTO bd_bonds (agent_id, status, defendant_name, bond_amount_cents) VALUES (?, 'exonerated', 'Results Bond', 100000) RETURNING id`, [agent.user.id]);
    let seq = 0;
    const add = async (n, status, asked = true) => {
      for (let i = 0; i < n; i++) {
        await ctx.db.run(`INSERT INTO bd_court_dates (bond_id, court_date, court_time, status, asked_at) VALUES (?, CAST(? AS date) + CAST(? AS int), make_time(0, 0, 0) + make_interval(mins => CAST(? AS int)), ?, ?)`,
          [b.id, from, seq % 28, seq++, status, asked ? '2001-03-15T12:00:00Z' : null]);
      }
    };
    await add(60, 'attended'); await add(20, 'missed'); await add(15, 'rescheduled'); await add(5, 'scheduled');
    const p1 = await req('get', '/api/admin/results/preview', admin).query({ from, to });
    expect(p1.body).toMatchObject({ court_dates: 100, asked: 100, answered: 95, attended: 60, missed: 20, rescheduled: 15, no_answer: 5,
      appearance_rate: 75, can_publish: false, min_answered: 100 });
    const refused = await req('post', '/api/admin/results/publish', admin).send({ from, to });
    expect([refused.status, refused.body.code, refused.body.answered]).toEqual([409, 'sample_too_small', 95]);
    await add(5, 'attended');
    const pub = await req('post', '/api/admin/results/publish', admin).send({ from, to });
    expect(pub.status).toBe(201);
    expect(pub.body.snapshot).toMatchObject({ period: { from, to }, answered: 100, attended: 65, appearance_rate: 76.5, methods_version: 1 });
    expect(pub.body.snapshot.methods).toMatch(/not a controlled study/);
    // immutable
    await expect(ctx.db.run('UPDATE results_snapshots SET methods = ? WHERE id = ?', ['x', pub.body.snapshot.id])).rejects.toThrow(/immutable/);
    await expect(ctx.db.run('DELETE FROM results_snapshots WHERE id = ?', [pub.body.snapshot.id])).rejects.toThrow(/immutable/);
    // the new hearings do not change what was published
    await add(10, 'missed');
    const pubView = await req('get', '/api/results');
    expect(pubView.status).toBe(200);
    expect(pubView.body.snapshot).toMatchObject({ id: pub.body.snapshot.id, attended: 65, missed: 20, appearance_rate: 76.5 });
    expect(pubView.body.snapshot.published_by).toBeUndefined();
    expect((await req('get', '/api/admin/results/snapshots', admin)).body.snapshots[0].id).toBe(pub.body.snapshot.id);
  });
});
