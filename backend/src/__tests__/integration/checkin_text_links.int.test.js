/**
 * checkin_text_links.int.test.js — check-ins by text link (A2), the missed-check-in alert (A3),
 * location alerts (B1) and the "Your bail agent" card (B6), on the real app + real Postgres with a
 * fake Telnyx and a fake Expo push server.
 *
 *   CT1  enrolling by text: consent and a paid plan are required; the link text goes out (5¢ in
 *        bd_texts); only the SHA-256 of the token is stored
 *   CT2  the public page: agency + first name only; invalid / expired / rotated links refused
 *   CT3  checking in by link: one counted per local day, extras recorded but not counted;
 *        location stored only when shared
 *   CT4  reminder texts: once per day, inside quiet hours; STOP blocks every text
 *   CT5  missed check-ins: one row per enrollment and day, the agent is pushed once, paused
 *        enrollments are not alerted, the gentle text to the defendant goes once
 *   CT6  location alerts: outside the radius → recorded + agent pushed; 503 when the setting is off
 *   CT7  "Your bail agent" card: agency, court date, balance, next check-in — only for the person
 *   CT8  Bond Desk dashboard lists missed check-ins of bonds linked to an enrollment
 */
import http from 'node:http';
import { describeIntegration, initSuite } from './_harness.js';
import { runCheckinTexts, runMissedCheckins, hashLinkToken } from '../../services/checkinTexts.js';
import { todayInZone, addDays, zonedDateTimeToUtc } from '../../utils/timezone.js';

const TZ = 'America/Chicago';
const tokenOf = (text) => (/\/c\/([A-Za-z0-9_-]{40,60})/.exec(text || '') || [])[1];

describeIntegration('check-ins by text link, missed alerts, location alerts, bail-agent card (real Postgres)', () => {
  const ctx = initSuite();
  const texts = [];
  const pushes = [];
  let telnyx; let expo;
  let agent; let noPlan; let defendant; let stranger;
  const enrollments = [];
  let ipN = 0;
  const req = (m, path, who) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.77.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (who) r = r.set(who.headers);
    return r;
  };
  const enroll = async (body, who = agent) => {
    const r = await req('post', '/api/checkins/enroll', who).set('X-Timezone', TZ).send(body);
    if (r.status === 201) enrollments.push(r.body.enrollment.id);
    return r;
  };
  const textsTo = (phone) => texts.filter((t) => t.to === phone);

  beforeAll(async () => {
    if (!ctx.app) return;
    const fakeServer = (sink, reply) => http.createServer((rq, rs) => {
      let d = ''; rq.on('data', (c) => { d += c; });
      rq.on('end', () => { const body = JSON.parse(d || 'null'); sink(body); rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(reply(body))); });
    });
    telnyx = fakeServer((b) => texts.push(b), () => ({ data: { id: `ck_tx_${texts.length}` } }));
    expo = fakeServer((b) => pushes.push(...(Array.isArray(b) ? b : [b])), (b) => ({ data: (Array.isArray(b) ? b : [b]).map((_, k) => ({ status: 'ok', id: `p${k}` })) }));
    await Promise.all([telnyx, expo].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
    process.env.TELNYX_API_KEY = 'KEY_test';
    process.env.TELNYX_FROM_NUMBER = '+16155550100';
    process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyx.address().port}`;
    process.env.EXPO_PUSH_API_URL = `http://127.0.0.1:${expo.address().port}/--/api/v2`;
    agent = await ctx.register({ displayName: 'CT Agent', accountType: 'bail_agent' });
    noPlan = await ctx.register({ displayName: 'CT No Plan', accountType: 'bail_agent' });
    defendant = await ctx.register({ displayName: 'Dana Linked' });
    stranger = await ctx.register({ displayName: 'CT Stranger' });
    for (const [a, name] of [[agent, 'Gamma Bail Bonds'], [noPlan, 'Delta Bail']]) {
      expect((await req('post', '/api/billing/bondsman/profile', a).send({ company_name: name, license_number: 'TN-9', license_state: 'TN', states: ['TN'], counties: ['Davidson'] })).status).toBe(200);
    }
    await ctx.db.run(`UPDATE bondsman_profiles SET phone = '615-555-0188' WHERE user_id = ?`, [agent.user.id]);
    await ctx.db.run(`UPDATE users SET timezone = ? WHERE id IN (?, ?)`, [TZ, agent.user.id, noPlan.user.id]);
    await ctx.db.run(`INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, amount_cents) VALUES (?, 'starter', 'active', 'sub_ck_1', 9900)`, [agent.user.id]);
    expect((await req('post', '/api/push/token', agent).send({ token: 'ExponentPushToken[ck-agent]' })).status).toBeLessThan(300);
    ctx.addCleanup(async (db) => {
      const ids = [agent, noPlan].map((a) => a.user.id).join(',');
      if (enrollments.length) {
        await db.run(`UPDATE bd_bonds SET checkin_enrollment_id = NULL WHERE checkin_enrollment_id IN (${enrollments.join(',')})`);
        await db.run(`DELETE FROM checkin_records WHERE enrollment_id IN (${enrollments.join(',')})`);
        await db.run(`DELETE FROM checkin_enrollments WHERE id IN (${enrollments.join(',')})`);
      }
      await db.run(`DELETE FROM bd_bonds WHERE agent_id IN (${ids})`);
      await db.run(`DELETE FROM bd_texts WHERE agent_id IN (${ids})`);
      await db.run(`DELETE FROM bondsman_subscriptions WHERE user_id IN (${ids})`);
      await db.run(`DELETE FROM bondsman_profiles WHERE user_id IN (${ids})`);
      await db.run(`DELETE FROM sms_opt_outs WHERE phone LIKE '+1615555%'`);
    });
  });
  afterAll(async () => {
    for (const s of [telnyx, expo]) if (s) await new Promise((r) => s.close(r));
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'EXPO_PUSH_API_URL', 'CHECKIN_LOCATION_ALERTS_ENABLED']) delete process.env[k];
  });

  // a moment at hh:mm local time on `day` in Chicago
  const at = (day, hh, mm = 0) => zonedDateTimeToUtc(day, hh, mm, TZ);
  const today = () => todayInZone(TZ);
  let sms; let firstToken; const PHONE = '+16155550161';

  test('CT1 enrolling by text needs consent and a plan; the link text goes out and is billed; the token is stored hashed', async () => {
    if (!ctx.app) return;
    const base = { defendant_name: 'Sam Q Textwell', defendant_phone: '(615) 555-0161', check_in_freq: 'daily', channel: 'sms', case_number: '2026-CR-55' };
    const noConsent = await enroll(base);
    expect([noConsent.status, noConsent.body.code]).toEqual([400, 'consent_required']);
    const noPhone = await enroll({ ...base, defendant_phone: undefined, defendant_email: 'x@it.example.test', consent_confirmed: true });
    expect([noPhone.status, noPhone.body.code]).toEqual([400, 'phone_required']);
    const plan = await enroll({ ...base, consent_confirmed: true }, noPlan);
    expect([plan.status, plan.body.code]).toEqual([403, 'plan_required']);
    const bad = await enroll({ ...base, consent_confirmed: true, channel: 'pigeon' });
    expect([bad.status, bad.body.code]).toEqual([400, 'bad_channel']);
    const r = await enroll({ ...base, consent_confirmed: true, lang: 'es' });
    expect(r.status).toBe(201);
    sms = r.body.enrollment;
    expect(sms).toMatchObject({ channel: 'sms', text_consent: true, missed_text_defendant: true });
    expect(sms.sms_consent_phone).toBeUndefined();
    expect(r.body.text_status).toBe('sent');
    const sent = textsTo(PHONE);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Gamma Bail Bonds');
    expect(sent[0].text).toContain('STOP');
    expect(sent[0].text).toContain('Sam');                              // Spanish text, first name
    expect(sent[0].text).toMatch(/Hola/);
    firstToken = tokenOf(sent[0].text);
    expect(firstToken).toBeTruthy();
    expect(r.body.checkin_link).toContain(`/c/${firstToken}`);
    const bill = await ctx.db.all(`SELECT purpose, cents FROM bd_texts WHERE agent_id = ?`, [agent.user.id]);
    expect(bill).toEqual([{ purpose: 'checkin_link', cents: 5 }]);
    const stored = await ctx.db.all('SELECT token_hash FROM checkin_link_tokens WHERE enrollment_id = ?', [sms.id]);
    expect(stored).toEqual([{ token_hash: hashLinkToken(firstToken) }]);
    const leak = await ctx.db.get(`SELECT COUNT(*)::int AS n FROM checkin_link_tokens WHERE token_hash = ? OR token_hash LIKE ?`, [firstToken, `%${firstToken.slice(0, 20)}%`]);
    expect(leak.n).toBe(0);
    // the agent's list shows the channel and the last text; no app link for a text enrollment
    const list = await req('get', '/api/checkins/enrollments', agent);
    const row = list.body.enrollments.find((e) => e.id === sms.id);
    expect(row).toMatchObject({ channel: 'sms', checkin_link: null, text_ready: true, last_text: { kind: 'link', status: 'sent' } });
    expect(list.body).toMatchObject({ can_text: true, text_cents: 5, location_alerts_enabled: true });
  });

  test('CT2 the public page shows the agency and first name only; bad / rotated / expired links are refused', async () => {
    if (!ctx.app) return;
    const page = await req('get', `/api/checkins/link/${firstToken}`).set('X-Timezone', TZ);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ agency: { name: 'Gamma Bail Bonds', phone: '615-555-0188' }, first_name: 'Sam', frequency: 'daily', checked_in_today: false });
    const raw = JSON.stringify(page.body);
    for (const secret of ['Textwell', '2026-CR-55', '5550161']) expect(raw).not.toContain(secret);
    expect((await req('get', '/api/checkins/link/short')).status).toBe(404);
    const unknown = await req('get', `/api/checkins/link/${'A'.repeat(43)}`);
    expect([unknown.status, unknown.body.code]).toEqual([404, 'link_invalid']);
    expect((await req('post', `/api/checkins/link/${'B'.repeat(43)}`).send({})).status).toBe(404);
    // reset link: every earlier one stops working, the new one works
    const rot = await req('post', `/api/checkins/enrollments/${sms.id}/link`, agent).send({ rotate: true });
    expect(rot.status).toBe(200);
    expect(rot.body).toMatchObject({ status: 'sent', rotated: true });
    const old = await req('get', `/api/checkins/link/${firstToken}`);
    expect([old.status, old.body.code]).toEqual([410, 'link_expired']);
    firstToken = tokenOf(rot.body.link);
    expect((await req('get', `/api/checkins/link/${firstToken}`)).status).toBe(200);
    // another agent cannot resend someone else's link
    expect((await req('post', `/api/checkins/enrollments/${sms.id}/link`, noPlan).send({})).status).toBe(404);
    // an expired token
    await ctx.db.run(`INSERT INTO checkin_link_tokens (enrollment_id, token_hash, expires_at) VALUES (?, ?, NOW() - INTERVAL '1 minute')`, [sms.id, hashLinkToken('E'.repeat(43))]);
    const exp = await req('get', `/api/checkins/link/${'E'.repeat(43)}`);
    expect([exp.status, exp.body.code]).toEqual([410, 'link_expired']);
  });

  test('CT3 checking in by link: one counted per day, extras recorded but not counted; location only when shared', async () => {
    if (!ctx.app) return;
    const first = await req('post', `/api/checkins/link/${firstToken}`).set('X-Timezone', TZ).send({ lat: 36.1627, lng: -86.7816, note: 'At work' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ counted: true, location_shared: true, checked_in_today: true });
    const second = await req('post', `/api/checkins/link/${firstToken}`).send({ note: 'again' });
    expect(second.status).toBe(201);
    expect(second.body.counted).toBe(false);
    const rows = await ctx.db.all('SELECT via, counted, status, lat, lng, notes FROM checkin_records WHERE enrollment_id = ? ORDER BY id', [sms.id]);
    expect(rows.map((r) => [r.via, r.counted, r.status, r.lat == null])).toEqual([['link', true, 'submitted', false], ['link', false, 'extra', true]]);
    const hist = await req('get', `/api/checkins/history/${sms.id}`, agent);
    expect(hist.status).toBe(200);
    expect(hist.body.compliance.completed).toBe(1);
    const list = await req('get', '/api/checkins/enrollments', agent);
    expect(list.body.enrollments.find((e) => e.id === sms.id).total_checkins).toBe(1);
    expect((await req('post', `/api/checkins/link/${firstToken}`).send({ lat: 999, lng: 1 })).status).toBe(400);
    expect((await req('post', `/api/checkins/link/${firstToken}`).send({ lat: 36 })).status).toBe(400);
    // a stopped enrollment's link stops working
    expect((await req('put', `/api/checkins/enrollments/${sms.id}`, agent).send({ active: false })).status).toBe(200);
    const stopped = await req('get', `/api/checkins/link/${firstToken}`);
    expect([stopped.status, stopped.body.code]).toEqual([410, 'enrollment_stopped']);
    expect((await req('put', `/api/checkins/enrollments/${sms.id}`, agent).send({ active: true })).status).toBe(200);
  });

  test('RF12 opening the link never replaces the time zone the agent set; it fills one only when none is set', async () => {
    if (!ctx.app) return;
    const set = await req('patch', `/api/checkins/enrollments/${sms.id}/settings`, agent).send({ time_zone: 'America/Denver' });
    expect(set.status).toBe(200);
    expect((await req('get', `/api/checkins/link/${firstToken}`).set('X-Timezone', 'America/New_York')).status).toBe(200);
    expect((await ctx.db.get('SELECT time_zone FROM checkin_enrollments WHERE id = ?', [sms.id])).time_zone).toBe('America/Denver');
    await ctx.db.run('UPDATE checkin_enrollments SET time_zone = NULL WHERE id = ?', [sms.id]);
    await req('get', `/api/checkins/link/${firstToken}`).set('X-Timezone', 'America/New_York');
    expect((await ctx.db.get('SELECT time_zone FROM checkin_enrollments WHERE id = ?', [sms.id])).time_zone).toBe('America/New_York');
    await req('get', `/api/checkins/link/${firstToken}`).set('X-Timezone', 'America/Los_Angeles');
    expect((await ctx.db.get('SELECT time_zone FROM checkin_enrollments WHERE id = ?', [sms.id])).time_zone).toBe('America/New_York');
    await ctx.db.run('UPDATE checkin_enrollments SET time_zone = ? WHERE id = ?', [TZ, sms.id]);
  });

  test('CT4 reminder texts go once per due day inside quiet hours; STOP blocks every text', async () => {
    if (!ctx.app) return;
    const phone = '+16155550162';
    const r = await enroll({ defendant_name: 'Rita Remind', defendant_phone: phone, channel: 'sms', consent_confirmed: true, check_in_freq: 'daily' });
    expect(r.status).toBe(201);
    const id = r.body.enrollment.id;
    // monitoring started three days ago (enrollment day is never reminded / missed)
    await ctx.db.run(`UPDATE checkin_enrollments SET active_since = NOW() - INTERVAL '3 days', time_zone = ? WHERE id = ?`, [TZ, id]);
    const d = today();
    const before = textsTo(phone).length;
    await runCheckinTexts(ctx.db, { now: at(d, 7, 30) });                // before 09:00 → nothing
    expect(textsTo(phone).length).toBe(before);
    await runCheckinTexts(ctx.db, { now: at(d, 10, 5) });
    expect(textsTo(phone).length).toBe(before + 1);
    expect(textsTo(phone).at(-1).text).toMatch(/due today/);
    await runCheckinTexts(ctx.db, { now: at(d, 11, 0) });                // already reminded today
    expect(textsTo(phone).length).toBe(before + 1);
    expect(await ctx.db.get(`SELECT COUNT(*)::int AS n FROM checkin_texts WHERE enrollment_id = ? AND kind = 'reminder'`, [id])).toEqual({ n: 1 });
    // STOP: no resend, no reminder
    await ctx.db.run('INSERT INTO sms_opt_outs (phone) VALUES (?) ON CONFLICT DO NOTHING', [phone]);
    const resend = await req('post', `/api/checkins/enrollments/${id}/link`, agent).send({});
    expect([resend.status, resend.body.code]).toEqual([409, 'opted_out']);
    await ctx.db.run(`DELETE FROM checkin_texts WHERE enrollment_id = ? AND kind = 'reminder'`, [id]);
    await runCheckinTexts(ctx.db, { now: at(d, 12, 0) });
    expect(textsTo(phone).length).toBe(before + 1);
    const st = await ctx.db.get(`SELECT status FROM checkin_texts WHERE enrollment_id = ? AND kind = 'reminder'`, [id]);
    expect(st.status).toBe('opted_out');
  });

  test('CT5 missed check-ins: one row per day, the agent is pushed once, paused enrollments skipped, one gentle text', async () => {
    if (!ctx.app) return;
    const phone = '+16155550163';
    const r = await enroll({ defendant_name: 'Max Missed', defendant_phone: phone, channel: 'sms', consent_confirmed: true, check_in_freq: 'daily' });
    const id = r.body.enrollment.id;
    const paused = await enroll({ defendant_name: 'Pat Paused', defendant_phone: '+16155550164', channel: 'sms', consent_confirmed: true });
    const pid = paused.body.enrollment.id;
    await ctx.db.run(`UPDATE checkin_enrollments SET active_since = NOW() - INTERVAL '5 days', time_zone = ? WHERE id IN (?, ?)`, [TZ, id, pid]);
    expect((await req('put', `/api/checkins/enrollments/${pid}`, agent).send({ active: false })).status).toBe(200);
    const d = today();
    const now = at(d, 0, 30);
    const pushedBefore = pushes.length;
    const r1 = await runMissedCheckins(ctx.db, { now });
    expect(r1.missed).toBeGreaterThanOrEqual(2);
    const rows = await ctx.db.all('SELECT local_day, agent_push, agent_email, defendant_text FROM checkin_missed WHERE enrollment_id = ? ORDER BY local_day', [id]);
    expect(rows.map((x) => x.local_day)).toEqual([addDays(d, -2), addDays(d, -1)]);
    expect(rows.map((x) => x.agent_push)).toEqual(['sent', 'sent']);
    expect(rows.map((x) => x.defendant_text)).toEqual([null, 'pending']);   // only yesterday is texted
    const agentPushes = pushes.slice(pushedBefore).filter((p) => p.to === 'ExponentPushToken[ck-agent]' && /Max Missed/.test(p.title));
    expect(agentPushes).toHaveLength(2);
    expect(await ctx.db.get('SELECT COUNT(*)::int AS n FROM checkin_missed WHERE enrollment_id = ?', [pid])).toEqual({ n: 0 });
    // a second run (or a second instance) alerts nobody again
    const n = pushes.length;
    await runMissedCheckins(ctx.db, { now });
    await runMissedCheckins(ctx.db, { now: at(d, 1, 30) });
    expect(pushes.length).toBe(n);
    expect(await ctx.db.get('SELECT COUNT(*)::int AS n FROM checkin_missed WHERE enrollment_id = ?', [id])).toEqual({ n: 2 });
    // the gentle text waits for daytime, goes once, carries a working link
    const before = textsTo(phone).length;
    await runCheckinTexts(ctx.db, { now: at(d, 6, 0) });
    expect(textsTo(phone).length).toBe(before);
    await runCheckinTexts(ctx.db, { now: at(d, 9, 15) });
    const missedTexts = textsTo(phone).slice(before).filter((t) => /missed/.test(t.text));
    expect(missedTexts).toHaveLength(1);
    expect((await req('get', `/api/checkins/link/${tokenOf(missedTexts[0].text)}`)).status).toBe(200);
    await runCheckinTexts(ctx.db, { now: at(d, 9, 45) });
    expect(textsTo(phone).slice(before).filter((t) => /missed/.test(t.text))).toHaveLength(1);
    expect((await ctx.db.get(`SELECT defendant_text FROM checkin_missed WHERE enrollment_id = ? AND local_day = ?`, [id, addDays(d, -1)])).defendant_text).toBe('sent');
    // the agent sees it
    const missed = await req('get', '/api/checkins/missed', agent);
    expect(missed.body.missed.filter((m) => m.enrollment_id === id)).toHaveLength(2);
    expect((await req('get', '/api/checkins/missed', stranger)).body.missed).toEqual([]);
    // the agent's own text alert: needs a phone; billed as checkin_alert
    expect((await req('put', '/api/checkins/agent-settings', agent).send({ missed_alert_text: true })).status).toBe(400);
    expect((await req('put', '/api/checkins/agent-settings', noPlan).send({ missed_alert_text: true, alert_phone: '6155550170' })).status).toBe(403);
    expect((await req('put', '/api/checkins/agent-settings', agent).send({ missed_alert_text: true, alert_phone: '6155550170' })).status).toBe(200);
    await ctx.db.run('DELETE FROM checkin_missed WHERE enrollment_id = ?', [id]);
    await runMissedCheckins(ctx.db, { now });
    expect(textsTo('+16155550170').length).toBe(2);
    expect((await ctx.db.get(`SELECT COUNT(*)::int AS n FROM bd_texts WHERE agent_id = ? AND purpose = 'checkin_alert'`, [agent.user.id])).n).toBe(2);
    await req('put', '/api/checkins/agent-settings', agent).send({ missed_alert_text: false });
  });

  test('CT6 location alerts: outside the radius is recorded and the agent is pushed; off → 503', async () => {
    if (!ctx.app) return;
    const r = await enroll({ defendant_name: 'Lou Located', defendant_phone: '615-555-0178', check_in_freq: 'daily' });
    const id = r.body.enrollment.id;
    // links go only through a verified phone (migration 40)
    await ctx.db.run(`UPDATE users SET phone = '+16155550178', phone_verified_phone = '+16155550178', phone_verified_at = NOW() WHERE id = ?`, [defendant.user.id]);
    expect((await req('put', `/api/checkins/enrollments/${id}/home`, agent).send({ lat: 36.1627, lng: -86.7816, radius_miles: 0 })).status).toBe(400);
    expect((await req('put', `/api/checkins/enrollments/${id}/home`, stranger).send({ lat: 36.1627, lng: -86.7816, radius_miles: 10 })).status).toBe(404);
    const home = await req('put', `/api/checkins/enrollments/${id}/home`, agent).send({ lat: 36.1627, lng: -86.7816, radius_miles: 10 });
    expect([home.status, home.body.home.radius_miles]).toEqual([200, 10]);
    // the linked defendant checks in from Memphis (~196 miles)
    const n = pushes.length;
    const sub = await req('post', '/api/checkins/submit', defendant).send({ enrollment_id: id, lat: 35.1495, lng: -90.049 });
    expect(sub.status).toBe(201);
    const rec = await ctx.db.get('SELECT outside_radius, distance_miles, location_alert_at FROM checkin_records WHERE enrollment_id = ?', [id]);
    expect(rec.outside_radius).toBe(true);
    expect(rec.distance_miles).toBeGreaterThan(190);
    expect(rec.location_alert_at).toBeTruthy();
    expect(pushes.slice(n).some((p) => /away from home/.test(p.title))).toBe(true);
    const hist = await req('get', `/api/checkins/history/${id}`, agent);
    expect(hist.body.records[0]).toMatchObject({ outside_radius: true });
    expect(hist.body.enrollment.home).toEqual({ lat: 36.1627, lng: -86.7816, radius_miles: 10 });
    // a check-in without location is never compared
    expect((await req('put', `/api/checkins/enrollments/${id}/home`, agent).send({ record_id: hist.body.records[0].id, radius_miles: 5 })).status).toBe(200);
    process.env.CHECKIN_LOCATION_ALERTS_ENABLED = 'false';
    try {
      const off = await req('put', `/api/checkins/enrollments/${id}/home`, agent).send({ lat: 36, lng: -86, radius_miles: 5 });
      expect([off.status, off.body.code]).toEqual([503, 'feature_unavailable']);
      expect((await req('get', '/api/checkins/enrollments', agent)).body.location_alerts_enabled).toBe(false);
    } finally { delete process.env.CHECKIN_LOCATION_ALERTS_ENABLED; }
  });

  test('CT7 "Your bail agent": agency, court date, balance and next check-in — only for that person', async () => {
    if (!ctx.app) return;
    const r = await enroll({ defendant_name: 'Dana Linked', defendant_email: defendant.email, defendant_phone: '(615) 555-0177', court_date: addDays(today(), 20), check_in_freq: 'weekly' });
    const id = r.body.enrollment.id;
    // the matching e-mail alone links nothing (e-mail is not verified); a verified phone does
    expect((await req('get', '/api/me/bail-agent', defendant)).body.agents.find((a) => a.enrollment_id === id)).toBeUndefined();
    expect((await req('post', '/api/me/phone/verify', defendant).send({ phone: '615-555-0177' })).status).toBe(200);
    const code = (/\b(\d{6})\b/.exec(textsTo('+16155550177').at(-1).text) || [])[1];
    const ok = await req('post', '/api/me/phone/confirm', defendant).send({ code });
    expect([ok.status, ok.body.verified]).toEqual([200, true]);
    const bond = await req('post', '/api/bond-desk/bonds', agent).send({
      defendant_name: 'Dana Linked', bond_amount_cents: 1_000_000, state: 'tn', court_date: addDays(today(), 10), checkin_enrollment_id: id,
    });
    expect(bond.status).toBe(201);
    const bid = bond.body.bond.id;
    expect((await req('patch', `/api/bond-desk/bonds/${bid}`, agent).send({ status: 'active' })).status).toBeLessThan(300);
    expect((await req('post', `/api/bond-desk/bonds/${bid}/charges`, agent).send({ kind: 'premium', amount_cents: 100_000 })).status).toBe(201);
    expect((await req('post', `/api/bond-desk/bonds/${bid}/payments`, agent).send({ amount_cents: 25_000, method: 'cash', payer_name: 'Dana' })).status).toBe(201);
    expect((await req('get', '/api/me/bail-agent')).status).toBe(401);
    const card = await req('get', '/api/me/bail-agent', defendant);
    expect(card.status).toBe(200);
    const mine = card.body.agents.find((a) => a.enrollment_id === id);
    expect(mine).toMatchObject({
      agency: { name: 'Gamma Bail Bonds', phone: '615-555-0188' },
      next_court_date: addDays(today(), 10),
      check_in: { frequency: 'weekly', done_for_period: false },
      bond: { balance_cents: 75_000 },
    });
    // another signed-in person sees nothing of it (authorization)
    const other = await req('get', '/api/me/bail-agent', stranger);
    expect(other.status).toBe(200);
    expect(other.body.agents).toEqual([]);
    expect(JSON.stringify(other.body)).not.toContain('Gamma');
    // the agent's own account is not the defendant either
    expect((await req('get', '/api/me/bail-agent', agent)).body.agents).toEqual([]);
  });

  test('CT8 the Bond Desk dashboard lists missed check-ins of bonds linked to an enrollment', async () => {
    if (!ctx.app) return;
    const r = await enroll({ defendant_name: 'Bo Bonded', defendant_email: 'bo@it.example.test', check_in_freq: 'daily' });
    const id = r.body.enrollment.id;
    const bond = await req('post', '/api/bond-desk/bonds', agent).send({ defendant_name: 'Bo Bonded', bond_amount_cents: 200_000, state: 'tn', checkin_enrollment_id: id });
    expect(bond.status).toBe(201);
    await ctx.db.run(`UPDATE checkin_enrollments SET active_since = NOW() - INTERVAL '4 days' WHERE id = ?`, [id]);
    await runMissedCheckins(ctx.db);
    const dash = await req('get', '/api/bond-desk/dashboard', agent);
    expect(dash.status).toBe(200);
    expect(dash.body.missed_checkins.filter((m) => m.enrollment_id === id).length).toBeGreaterThanOrEqual(1);
    expect(dash.body.missed_checkins.find((m) => m.enrollment_id === id)).toMatchObject({ bond_id: bond.body.bond.id, defendant_name: 'Bo Bonded' });
  });
});
