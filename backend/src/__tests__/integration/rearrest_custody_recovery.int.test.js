/**
 * rearrest_custody_recovery.int.test.js — re-arrest alerts (A4), release / transfer alerts for
 * families (A9), sharing a forfeited bond with a recovery agent (B4) and the Tennessee quarterly
 * report (B5), on the real app + real Postgres with a fake roster feed, fake Telnyx and a fake
 * Expo push server. The ⚖ settings are unset here (tests run with them ON) except where a test
 * turns one off to check the 503.
 *
 *   RC1  roster ingest: a booking seen again is updated, never inserted twice
 *   RC2  re-arrest: strong (name + DOB from the bond or the questionnaire), possible (name only),
 *        different DOB = no match; never on sample / taken-down / sealed rows; never twice;
 *        push + e-mail + text (5¢, bd_texts) + timeline + dashboard; confirm / dismiss; coverage
 *   RC3  custody: follow needs consent; status change → one alert (push + text); the same roster
 *        again → nothing; booking missing → "no longer listed … call … to confirm" (never
 *        "released"); STOP blocks the text; takedown → no alert and no details; unfollow
 *   RC4  recovery sharing: only forfeited bonds, rule acknowledged, banned state refused; the
 *        invited account only; read-only view logged and shown to the agent; access ends on
 *        reinstatement and on revoke
 *   RC5  Tennessee quarterly report: counts and liability per county, CSV + PDF with the citation
 *   RC6  every ⚖ setting off → 503 feature_unavailable and hidden in /access
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { describeIntegration, initSuite } from './_harness.js';
import { matchNewArrests } from '../../services/bondDesk/rearrest.js';
import { previousQuarter, quarterRange } from '../../services/bondDesk/tnReport.js';
import { todayInZone } from '../../utils/timezone.js';

const TZ = 'America/Chicago';

describeIntegration('re-arrest alerts, custody alerts, recovery sharing, Tennessee report (real Postgres)', () => {
  const ctx = initSuite();
  const texts = [];
  const pushes = [];
  let telnyx; let expo;
  let agent; let family; let recov; let stranger;
  let FEED_ID; let FEED_URL; let SOURCE;
  let roster = [];
  const realFetch = global.fetch;
  let ipN = 0;
  const req = (m, path, who) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.88.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (who) r = r.set(who.headers);
    return r;
  };
  const ingest = async () => (await import('../../services/arrest_ingest.js')).runIngestion({ dryRun: false });
  const newBond = async (body) => {
    const r = await req('post', '/api/bond-desk/bonds', agent).send({ bond_amount_cents: 500000, state: 'TN', county: 'Davidson', ...body });
    expect(r.status).toBe(201);
    return r.body.bond;
  };
  const setStatus = async (bondId, status, extra = {}) => {
    const r = await req('post', `/api/bond-desk/bonds/${bondId}/status`, agent).send({ status, date: todayInZone(TZ), ...extra });
    expect(r.status).toBe(200);
    return r.body.bond;
  };
  const pushesTo = (token) => pushes.filter((p) => p.to === token);

  beforeAll(async () => {
    if (!ctx.app) return;
    const fakeServer = (sink, reply) => http.createServer((rq, rs) => {
      let d = ''; rq.on('data', (c) => { d += c; });
      rq.on('end', () => { const body = JSON.parse(d || 'null'); sink(body); rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(reply(body))); });
    });
    telnyx = fakeServer((b) => texts.push(b), () => ({ data: { id: `rc_tx_${texts.length}` } }));
    expo = fakeServer((b) => pushes.push(...(Array.isArray(b) ? b : [b])), (b) => ({ data: (Array.isArray(b) ? b : [b]).map((_, k) => ({ status: 'ok', id: `p${k}` })) }));
    await Promise.all([telnyx, expo].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
    process.env.TELNYX_API_KEY = 'KEY_test';
    process.env.TELNYX_FROM_NUMBER = '+16155550100';
    process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyx.address().port}`;
    process.env.EXPO_PUSH_API_URL = `http://127.0.0.1:${expo.address().port}/--/api/v2`;
    FEED_ID = `rc_${ctx.tag}`.slice(0, 40);
    FEED_URL = `https://roster.example.gov/${ctx.tag}.json`;
    SOURCE = `feed_${FEED_ID}`;
    process.env.ARREST_FEED_URLS = JSON.stringify([{ id: FEED_ID, url: FEED_URL, state: 'TN', county: 'Davidson', jail_phone: '(615) 555-0199' }]);
    global.fetch = async (url, opts) => {
      if (String(url) === FEED_URL) return new Response(JSON.stringify({ records: roster }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return realFetch(url, opts);
    };

    agent = await ctx.register({ displayName: 'RC Agent', accountType: 'bail_agent' });
    family = await ctx.register({ displayName: 'RC Family' });
    recov = await ctx.register({ displayName: 'RC Recovery', identifier: `${ctx.tag}-recovery@it.example.test` });
    stranger = await ctx.register({ displayName: 'RC Stranger' });
    expect((await req('post', '/api/billing/bondsman/profile', agent).send({ company_name: 'Sigma Bail Bonds', license_number: 'TN-77', license_state: 'TN', states: ['TN'], counties: ['Davidson'] })).status).toBe(200);
    await ctx.db.run(`UPDATE bondsman_profiles SET phone = '615-555-0177', email = ? WHERE user_id = ?`, [`${ctx.tag}-agency@it.example.test`, agent.user.id]);
    await ctx.db.run('UPDATE users SET timezone = ? WHERE id IN (?, ?)', [TZ, agent.user.id, family.user.id]);
    await ctx.db.run(`INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, amount_cents) VALUES (?, 'starter', 'active', 'sub_rc_1', 9900)`, [agent.user.id]);
    for (const [u, tok] of [[agent, 'ExponentPushToken[rc-agent]'], [family, 'ExponentPushToken[rc-family]']]) {
      expect((await req('post', '/api/push/token', u).send({ token: tok })).status).toBeLessThan(300);
    }
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM bd_bonds WHERE agent_id = ?', [agent.user.id]);
      await db.run('DELETE FROM bd_texts WHERE agent_id = ?', [agent.user.id]);
      await db.run('DELETE FROM bd_alert_settings WHERE agent_id = ?', [agent.user.id]);
      await db.run('DELETE FROM bondsman_subscriptions WHERE user_id = ?', [agent.user.id]);
      await db.run('DELETE FROM bondsman_profiles WHERE user_id = ?', [agent.user.id]);
      await db.run(`DELETE FROM arrest_records WHERE source = ? OR (source = 'seed_v1' AND name LIKE 'RCTEST%')`, [SOURCE]);
      await db.run(`DELETE FROM sms_opt_outs WHERE phone = '+16155550160'`);   // only this suite's number
    });
  });
  afterAll(async () => {
    global.fetch = realFetch;
    for (const s of [telnyx, expo]) if (s) await new Promise((r) => s.close(r));
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'EXPO_PUSH_API_URL', 'ARREST_FEED_URLS',
      'BOND_REARREST_ALERTS_ENABLED', 'CUSTODY_ALERTS_ENABLED', 'BOND_RECOVERY_SHARING_ENABLED']) delete process.env[k];
  });

  const rec = (o) => ({ booking_date: todayInZone(TZ), charges: 'THEFT UNDER $1,000', bail_amount: 1500, jail_location: 'Davidson County Jail', status: 'In custody', ...o });
  let bondStrong; let bondPossible; let bondAnswers; let bondClosed;

  test('RC1 a booking seen again is updated, never inserted twice', async () => {
    if (!ctx.app) return;
    roster = [rec({ name: 'Lena Ostrova', booking_id: 'RC-001' }), rec({ name: 'Lena Ostrova', booking_id: 'RC-001' }), rec({ name: 'Paul Dimm', booking_date: '2026-10-01' })];
    const first = await ingest();
    expect(first.sources[0]).toMatchObject({ inserted: 2, skipped: 1, updated: 0 });
    const again = await ingest();
    expect(again.sources[0]).toMatchObject({ inserted: 0, updated: 2 });
    const n = await ctx.db.get('SELECT COUNT(*)::int AS n FROM arrest_records WHERE source = ?', [SOURCE]);
    expect(n.n).toBe(2);
    const row = await ctx.db.get('SELECT source_key, jail_phone, last_seen_at FROM arrest_records WHERE source = ? AND name = ?', [SOURCE, 'Lena Ostrova']);
    expect(row).toMatchObject({ source_key: 'b:RC-001', jail_phone: '(615) 555-0199' });
    expect(row.last_seen_at).toBeTruthy();
  });

  test('RC2 re-arrest matches: strong, possible, no match; never twice; alerts, timeline, dashboard', async () => {
    if (!ctx.app) return;
    expect((await req('put', '/api/bond-desk/rearrest-settings', agent).send({ rearrest_text: true, alert_phone: '615-555-0171' })).status).toBe(200);
    bondStrong = await newBond({ defendant_name: 'Rhea Quill', defendant_dob: '1990-04-05' });
    bondPossible = await newBond({ defendant_name: 'Owen Marsh' });
    bondAnswers = await newBond({ defendant_name: 'Ida Vance' });
    bondClosed = await newBond({ defendant_name: 'Cole Brandt', defendant_dob: '1980-02-02' });
    for (const b of [bondStrong, bondPossible, bondAnswers]) await setStatus(b.id, 'active');
    // bondClosed stays a prospect: never watched
    // the defendant's questionnaire answer carries Ida's date of birth
    const pk = await ctx.db.get(`INSERT INTO bd_packets (bond_id, agent_id, form_ids, questions) VALUES (?, ?, '{}', 'basic') RETURNING id`, [bondAnswers.id, agent.user.id]);
    await ctx.db.run(`INSERT INTO bd_signers (packet_id, role, name, token_hash, token_expires_at, answers) VALUES (?, 'defendant', 'Ida Vance', ?, NOW() + INTERVAL '1 day', ?::jsonb)`,
      [pk.id, createHash('sha256').update(`rc-${ctx.tag}`).digest('hex'), JSON.stringify({ dob: '1975-07-09', address: '12 Elm St, Nashville', phone: '615-555-0144', employer: 'Acme Mill' })]);
    const pushBefore = pushesTo('ExponentPushToken[rc-agent]').length;
    roster = [
      rec({ name: 'QUILL, RHEA', dob: '1990-04-05', booking_id: 'RC-101' }),          // strong (bond DOB)
      rec({ name: 'Owen Marsh', booking_id: 'RC-102' }),                                // possible (no DOB anywhere)
      rec({ name: 'Ida M. Vance', dob: '1975-07-09', booking_id: 'RC-103' }),          // strong (questionnaire DOB)
      rec({ name: 'Rhea Quill', dob: '1985-01-01', booking_id: 'RC-104' }),            // different DOB: not her
      rec({ name: 'Cole Brandt', dob: '1980-02-02', booking_id: 'RC-105' }),           // bond is only a prospect
    ];
    const r = await ingest();
    expect(r.rearrest).toEqual({ checked: 5, strong: 2, possible: 1 });
    const rows = await ctx.db.all('SELECT bond_id, match, status, push_status, text_status FROM bd_rearrests WHERE agent_id = ? ORDER BY bond_id', [agent.user.id]);
    expect(rows.map((x) => [Number(x.bond_id), x.match, x.status])).toEqual([
      [bondStrong.id, 'strong', 'alerted'], [bondPossible.id, 'possible', 'pending'], [bondAnswers.id, 'strong', 'alerted']]);
    expect(rows.some((x) => Number(x.bond_id) === bondClosed.id)).toBe(false);   // a prospect is never watched
    expect(rows.find((x) => Number(x.bond_id) === bondStrong.id)).toMatchObject({ push_status: 'sent', text_status: 'sent' });
    expect(rows.find((x) => Number(x.bond_id) === bondPossible.id).text_status).toBeNull();   // texts only for strong matches
    expect(pushesTo('ExponentPushToken[rc-agent]').length - pushBefore).toBe(3);
    const bill = await ctx.db.all(`SELECT cents FROM bd_texts WHERE agent_id = ? AND purpose = 'rearrest_alert'`, [agent.user.id]);
    expect(bill).toEqual([{ cents: 5 }, { cents: 5 }]);
    const sms = texts.filter((t) => t.to === '+16155550171');
    expect(sms).toHaveLength(2);
    expect(sms[0].text).toContain('STOP');
    // never twice: matching the same bookings again adds nothing
    const ids = (await ctx.db.all('SELECT id FROM arrest_records WHERE source = ?', [SOURCE])).map((x) => Number(x.id));
    expect(await matchNewArrests(ctx.db, ids)).toMatchObject({ strong: 0, possible: 0 });
    // never on sample / taken-down / sealed rows
    const seed = await ctx.db.get(`INSERT INTO arrest_records (name, booking_date, source, dob, county, state) VALUES ('RCTEST Owen Marsh', NOW(), 'seed_v1', NULL, 'Davidson', 'TN') RETURNING id`);
    await ctx.db.run(`UPDATE arrest_records SET name = 'Owen Marsh' WHERE id = ?`, [seed.id]);
    const down = await ctx.db.get(`INSERT INTO arrest_records (name, booking_date, source, source_key, county, state, suppressed) VALUES ('Owen Marsh', NOW(), ?, 'b:RC-900', 'Davidson', 'TN', 1) RETURNING id`, [SOURCE]);
    const sealed = await ctx.db.get(`INSERT INTO arrest_records (name, booking_date, source, source_key, county, state, status) VALUES ('Owen Marsh', NOW(), ?, 'b:RC-901', 'Davidson', 'TN', 'Sealed') RETURNING id`, [SOURCE]);
    expect(await matchNewArrests(ctx.db, [seed.id, down.id, sealed.id])).toEqual({ checked: 0, strong: 0, possible: 0 });
    await ctx.db.run('UPDATE arrest_records SET name = ? WHERE id = ?', ['RCTEST seed', seed.id]);
    // the bond shows coverage honestly and its matches; the timeline and the dashboard list them
    const view = await req('get', `/api/bond-desk/bonds/${bondPossible.id}/rearrests`, agent);
    expect(view.status).toBe(200);
    expect(view.body.coverage).toEqual({ feeds_configured: true, counties: [{ county: 'Davidson', state: 'TN' }] });
    expect(view.body.matches).toHaveLength(1);
    expect(view.body.matches[0]).toMatchObject({ match: 'possible', status: 'pending', booking: { county: 'Davidson', state: 'TN' } });
    const dash = await req('get', '/api/bond-desk/dashboard', agent);
    expect(dash.body.rearrests.map((x) => x.defendant_name).sort()).toEqual(['Ida Vance', 'Owen Marsh', 'Rhea Quill']);
    expect(dash.body.rearrests[0].status).toBe('pending');   // possible matches first: they need a decision
    const mid = view.body.matches[0].id;
    expect((await req('post', `/api/bond-desk/rearrests/${mid}/dismiss`, agent)).body).toMatchObject({ ok: true, status: 'dismissed' });
    expect((await req('post', `/api/bond-desk/rearrests/${mid}/confirm`, agent)).status).toBe(409);
    expect((await req('post', `/api/bond-desk/rearrests/${mid}/confirm`, stranger)).status).toBe(403);
    const tl = await req('get', `/api/bond-desk/bonds/${bondPossible.id}/timeline`, agent);
    expect(tl.body.events.map((e) => e.kind)).toEqual(['rearrest_dismissed', 'rearrest_possible']);
  });

  let followId; let arrestQuill;
  /** A zone where the local hour is now `hour` (Etc/GMT zones: the sign is inverted). */
  const zoneAtHour = (hour, now = new Date()) => {
    let off = (hour - now.getUTCHours() + 24) % 24; if (off > 12) off -= 24;
    return off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
  };
  test('RC3 custody alerts: consent, one alert per change, "no longer listed", STOP, takedown, unfollow', async () => {
    if (!ctx.app) return;
    arrestQuill = Number((await ctx.db.get(`SELECT id FROM arrest_records WHERE source = ? AND source_key = 'b:RC-101'`, [SOURCE])).id);
    const st = await req('get', '/api/custody/status', family);
    expect(st.body).toMatchObject({ enabled: true, max_follows: 10 });
    expect((await req('get', `/api/custody/arrest/${arrestQuill}`, family)).body).toEqual({ follow_id: null, trackable: true });
    const noConsent = await req('post', '/api/custody/follows', family).send({ arrest_id: arrestQuill });
    expect([noConsent.status, noConsent.body.code]).toEqual([400, 'consent_required']);
    const noTextConsent = await req('post', '/api/custody/follows', family).send({ arrest_id: arrestQuill, consent: true, text_opt_in: true, phone: '615-555-0160' });
    expect(noTextConsent.body.code).toBe('text_consent_required');
    const seed = await ctx.db.get(`SELECT id FROM arrest_records WHERE source = 'seed_v1' LIMIT 1`);
    if (seed) expect((await req('post', '/api/custody/follows', family).send({ arrest_id: seed.id, consent: true })).status).toBe(404);
    // RF5: texts go only to the account's VERIFIED phone, never to a number typed in
    const unverified = await req('post', '/api/custody/follows', family).send({ arrest_id: arrestQuill, consent: true, text_opt_in: true, phone: '615-555-0160', text_consent: true });
    expect([unverified.status, unverified.body.code]).toEqual([409, 'phone_not_verified']);
    await ctx.db.run('UPDATE users SET phone = ?, phone_verified_phone = ?, phone_verified_at = NOW(), timezone = ? WHERE id = ?', ['+16155550160', '+16155550160', zoneAtHour(12), family.user.id]);
    expect((await req('get', '/api/custody/status', family)).body.verified_phone_last4).toBe('0160');
    const other = await req('post', '/api/custody/follows', family).send({ arrest_id: arrestQuill, consent: true, text_opt_in: true, phone: '615-555-0169', text_consent: true });
    expect([other.status, other.body.code]).toEqual([409, 'phone_not_verified']);
    const f = await req('post', '/api/custody/follows', family).send({ arrest_id: arrestQuill, consent: true, text_opt_in: true, text_consent: true });
    expect(f.status).toBe(201);
    followId = f.body.follow_id;
    expect((await req('post', '/api/custody/follows', family).send({ arrest_id: arrestQuill, consent: true })).body.code).toBe('already_following');
    // same roster, new status for Rhea → one alert
    const base = roster;
    roster = base.map((x) => (x.booking_id === 'RC-101' ? { ...x, status: 'Transferred', jail_location: 'Riverbend Facility' } : x));
    const pushBefore = pushesTo('ExponentPushToken[rc-family]').length;
    await ingest();
    const famPush = pushesTo('ExponentPushToken[rc-family]').slice(pushBefore);
    expect(famPush).toHaveLength(2);   // status changed + facility changed
    expect(famPush.map((p) => p.body).join(' ')).toContain('"Transferred" (before: "In custody")');
    const famText = texts.filter((t) => t.to === '+16155550160');
    expect(famText).toHaveLength(2);
    expect(famText[0].text).toMatch(/^Justice Gavel: .*Reply STOP to opt out\.$/);
    // the same roster again: nothing new
    await ingest();
    expect(pushesTo('ExponentPushToken[rc-family]').length - pushBefore).toBe(2);
    // the booking is missing from a complete roster → "no longer listed", with the jail's phone; never "released"
    roster = roster.filter((x) => x.booking_id !== 'RC-101');
    await ingest();
    const gone = pushesTo('ExponentPushToken[rc-family]').slice(pushBefore + 2);
    expect(gone).toHaveLength(1);
    expect(gone[0].body).toContain('is no longer listed on the Davidson County roster as of');
    expect(gone[0].body).toContain('Call (615) 555-0199 to confirm.');
    for (const p of pushesTo('ExponentPushToken[rc-family]')) expect(p.body.toLowerCase()).not.toContain('released');
    await ingest();   // still missing: not alerted twice
    expect(pushesTo('ExponentPushToken[rc-family]').length - pushBefore).toBe(3);
    const list = await req('get', '/api/custody/follows', family);
    expect(list.body.follows[0]).toMatchObject({ available: true, booking: { listed: false, status: 'Transferred', facility: 'Riverbend Facility' } });
    expect(list.body.follows[0].events.map((e) => e.kind).sort()).toEqual(['facility_changed', 'not_listed', 'status_changed']);
    // STOP from the number: the next alert is pushed but not texted
    await ctx.db.run('INSERT INTO sms_opt_outs (phone) VALUES (?) ON CONFLICT DO NOTHING', ['+16155550160']);
    roster = [...roster, { ...base.find((x) => x.booking_id === 'RC-101'), status: 'Transferred', jail_location: 'Riverbend Facility' }];
    await ingest();   // listed again
    const last = await ctx.db.get(`SELECT a.text_status, a.push_status FROM custody_alerts a JOIN custody_events e ON e.id = a.event_id
                                     WHERE a.follow_id = ? AND e.kind = 'listed_again'`, [followId]);
    expect(last).toEqual({ text_status: 'opted_out', push_status: 'sent' });
    expect(texts.filter((t) => t.to === '+16155550160')).toHaveLength(3);   // status, facility, not listed — not the 4th
    // a takedown: no alert, and the follow shows no details any more
    await ctx.db.run('UPDATE arrest_records SET suppressed = 1 WHERE id = ?', [arrestQuill]);
    roster = roster.map((x) => (x.booking_id === 'RC-101' ? { ...x, status: 'Released per roster' } : x));
    const before = pushesTo('ExponentPushToken[rc-family]').length;
    await ingest();
    expect(pushesTo('ExponentPushToken[rc-family]').length).toBe(before);
    const hidden = await req('get', '/api/custody/follows', family);
    expect(hidden.body.follows[0]).toEqual(expect.objectContaining({ available: false }));
    expect(hidden.body.follows[0].booking).toBeUndefined();
    await ctx.db.run('UPDATE arrest_records SET suppressed = 0 WHERE id = ?', [arrestQuill]);
    // someone else cannot touch the follow; the follower can unfollow any time
    expect((await req('delete', `/api/custody/follows/${followId}`, stranger)).status).toBe(404);
    expect((await req('delete', `/api/custody/follows/${followId}`, family)).body).toEqual({ ok: true });
    expect((await req('get', '/api/custody/follows', family)).body.follows).toEqual([]);
  });

  test('RF5 custody texts: only to the verified phone; held at night (21:00–08:00 local) and sent in the morning', async () => {
    if (!ctx.app) return;
    const { sendHeldCustodyTexts } = await import('../../services/custodyAlerts.js');
    const night = new Date();
    await ctx.db.run('UPDATE users SET timezone = ? WHERE id = ?', [zoneAtHour(2, night), family.user.id]);
    await ctx.db.run('DELETE FROM sms_opt_outs WHERE phone = ?', ['+16155550160']);
    const f = await req('post', '/api/custody/follows', family).send({ arrest_id: arrestQuill, consent: true, text_opt_in: true, text_consent: true });
    expect(f.status).toBe(201);
    const fid = f.body.follow_id;
    roster = roster.map((x) => (x.booking_id === 'RC-101' ? { ...x, status: 'Court hold' } : x));
    const t0 = texts.filter((t) => t.to === '+16155550160').length;
    const p0 = pushesTo('ExponentPushToken[rc-family]').length;
    await ingest();
    expect(pushesTo('ExponentPushToken[rc-family]').length).toBe(p0 + 1);          // push and e-mail at once
    expect(texts.filter((t) => t.to === '+16155550160').length).toBe(t0);           // the text waits
    const held = await ctx.db.get(`SELECT a.id, a.text_status FROM custody_alerts a WHERE a.follow_id = ?`, [fid]);
    expect(held.text_status).toBe('held');
    // still night: nothing; 07:59 local: nothing; 08:00 local: sent once
    expect(await sendHeldCustodyTexts(ctx.db, { now: night })).toMatchObject({ sent: 0 });
    const at8 = night.getTime() + (6 * 60 - night.getUTCMinutes()) * 60_000 - night.getUTCSeconds() * 1000;   // 08:00:00 local
    expect(await sendHeldCustodyTexts(ctx.db, { now: new Date(at8 - 60_000) })).toMatchObject({ sent: 0 });
    const morning = new Date(at8 + 60_000);
    expect(await sendHeldCustodyTexts(ctx.db, { now: morning })).toMatchObject({ sent: 1 });
    expect(await sendHeldCustodyTexts(ctx.db, { now: morning })).toMatchObject({ sent: 0 });
    const sent = texts.filter((t) => t.to === '+16155550160').slice(t0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/Court hold.*Reply STOP to opt out\.$/);
    expect((await ctx.db.get('SELECT text_status, provider_id FROM custody_alerts WHERE id = ?', [held.id]))).toEqual({ text_status: 'sent', provider_id: expect.any(String) });
    // the verified phone changed since: a held text is not sent to the old number
    roster = roster.map((x) => (x.booking_id === 'RC-101' ? { ...x, status: 'In custody' } : x));
    await ingest();
    await ctx.db.run('UPDATE users SET phone = ? WHERE id = ?', ['+16155550168', family.user.id]);   // the trigger drops the verification
    expect(await sendHeldCustodyTexts(ctx.db, { now: morning })).toMatchObject({ sent: 0 });
    expect((await ctx.db.get(`SELECT text_status FROM custody_alerts WHERE follow_id = ? ORDER BY id DESC LIMIT 1`, [fid])).text_status).toBe('skipped');
    expect((await req('delete', `/api/custody/follows/${fid}`, family)).body).toEqual({ ok: true });
  });

  let shareLink; let shareId;
  test('RC4 recovery sharing: forfeited only, rule acknowledged, invited account only, views logged, ends on reinstatement', async () => {
    if (!ctx.app) return;
    const deadline = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const active = await req('post', `/api/bond-desk/bonds/${bondAnswers.id}/recovery/shares`, agent).send({ email: recov.email, rule_acknowledged: true });
    expect([active.status, active.body.code]).toEqual([409, 'share_not_forfeited']);
    await setStatus(bondAnswers.id, 'forfeited', { deadline_on: deadline });
    const info = await req('get', `/api/bond-desk/bonds/${bondAnswers.id}/recovery`, agent);
    expect(info.body.state_rule).toMatchObject({ state: 'TN', allowed: true, checked: 'secondary' });
    expect(info.body.state_rule.law).toContain('40-11-318');
    const noAck = await req('post', `/api/bond-desk/bonds/${bondAnswers.id}/recovery/shares`, agent).send({ email: recov.email });
    expect(noAck.body.code).toBe('share_rule_ack');
    const s = await req('post', `/api/bond-desk/bonds/${bondAnswers.id}/recovery/shares`, agent).send({ email: recov.email, rule_acknowledged: true, share_locations: false });
    expect(s.status).toBe(201);
    shareLink = s.body.link; shareId = s.body.share.id;
    const token = /\/recovery\/([A-Za-z0-9_-]+)$/.exec(shareLink)[1];
    const stored = await ctx.db.get('SELECT token_hash FROM bd_recovery_shares WHERE id = ?', [shareId]);
    expect(stored.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    // a state whose rule says recovery is not allowed: refused
    const il = await newBond({ defendant_name: 'Mara Kent', state: 'IL', county: 'Cook' });
    await setStatus(il.id, 'active'); await setStatus(il.id, 'forfeited', { deadline_on: deadline });
    expect((await req('post', `/api/bond-desk/bonds/${il.id}/recovery/shares`, agent).send({ email: recov.email, rule_acknowledged: true })).body.code).toBe('share_not_allowed_state');
    // only the invited account can accept; then it is bound to it
    expect((await req('post', '/api/recovery-shares/accept', stranger).send({ token })).body.code).toBe('share_wrong_account');
    expect((await req('post', '/api/recovery-shares/accept', recov).send({ token })).body).toEqual({ share_id: shareId });
    expect((await req('get', '/api/recovery-shares', recov)).body.shares).toEqual([expect.objectContaining({ id: shareId, defendant_name: 'Ida Vance', agency: 'Sigma Bail Bonds' })]);
    expect((await req('get', `/api/recovery-shares/${shareId}`, stranger)).status).toBe(404);
    const view = await req('get', `/api/recovery-shares/${shareId}`, recov);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      defendant: { name: 'Ida Vance', photo_available: false },
      bond: { forfeiture_deadline_on: deadline, state: 'TN' },
      addresses: [{ value: '12 Elm St, Nashville', source: 'questionnaire' }],
      phones: [{ value: '615-555-0144', source: 'questionnaire' }],
      agent: { agency: 'Sigma Bail Bonds', phone: '615-555-0177' },
      state_rule: { state: 'TN' },
    });
    expect(view.body.rearrests).toEqual([expect.objectContaining({ match: 'strong', county: 'Davidson' })]);
    expect((await req('get', `/api/recovery-shares/${shareId}/photo`, recov)).status).toBe(404);
    // the agent sees the share and every view
    const mine = await req('get', `/api/bond-desk/bonds/${bondAnswers.id}/recovery`, agent);
    expect(mine.body.shares[0]).toMatchObject({ id: shareId, status: 'active', invite_email: recov.email });
    expect(mine.body.shares[0].views.map((v) => v.what)).toEqual(['details']);
    // reinstated → access ends by itself
    await setStatus(bondAnswers.id, 'active');
    expect((await req('get', `/api/recovery-shares/${shareId}`, recov)).body.code).toBe('share_ended');
    expect((await req('get', '/api/recovery-shares', recov)).body.shares).toEqual([]);
    const ended = await req('get', `/api/bond-desk/bonds/${bondAnswers.id}/recovery`, agent);
    expect(ended.body.shares[0]).toMatchObject({ status: 'ended', ended_reason: 'reinstated' });
    // revoke: forfeit again, share, revoke → the invite stops working
    await setStatus(bondAnswers.id, 'forfeited', { deadline_on: deadline });
    const s2 = await req('post', `/api/bond-desk/bonds/${bondAnswers.id}/recovery/shares`, agent).send({ email: recov.email, rule_acknowledged: true });
    expect(s2.status).toBe(201);
    expect((await req('post', `/api/bond-desk/recovery/shares/${s2.body.share.id}/revoke`, agent)).body).toEqual({ ok: true });
    const t2 = /\/recovery\/([A-Za-z0-9_-]+)$/.exec(s2.body.link)[1];
    expect((await req('post', '/api/recovery-shares/accept', recov).send({ token: t2 })).body.code).toBe('share_ended');
    const tl = await req('get', `/api/bond-desk/bonds/${bondAnswers.id}/timeline`, agent);
    expect(tl.body.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['recovery_shared', 'recovery_accepted', 'recovery_ended']));
  });

  test('RC5 Tennessee quarterly report: per county, CSV and PDF cite the law', async () => {
    if (!ctx.app) return;
    const q = previousQuarter(todayInZone(TZ));
    const range = quarterRange(q);
    const mk = async (name, county, state, amount, posted, extra = {}) => {
      const b = await newBond({ defendant_name: name, county, state, bond_amount_cents: amount });
      await ctx.db.run(`UPDATE bd_bonds SET status = ?, posted_on = ?, discharged_on = ? WHERE id = ?`, [extra.status || 'active', posted, extra.discharged || null, b.id]);
      return b;
    };
    await mk('Q One', 'Davidson County', 'TN', 100000, range.from);
    await mk('Q Two', 'davidson', 'TN', 250000, range.to);
    await mk('Q Three', 'Shelby', 'TN', 50000, range.from, { status: 'exonerated', discharged: range.to });
    await mk('Q Four', 'Fulton', 'GA', 999900, range.from);                // not Tennessee
    await mk('Q Five', null, 'TN', 70000, range.from);                     // no county: listed, not counted
    const r = await req('get', `/api/bond-desk/reports/tn-quarterly?quarter=${q}`, agent);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ quarter: q, period_from: range.from, period_to: range.to, due_on: range.due, checked_on: '2026-10-27' });
    expect(r.body.citation).toContain('40-11-314');
    const dav = r.body.counties.find((c) => c.county === 'Davidson');
    expect(dav).toMatchObject({ bonds_issued: 2, liability_issued_cents: 350000, open_bonds_at_end: 2, liability_open_at_end_cents: 350000 });
    expect(r.body.counties.find((c) => c.county === 'Shelby')).toMatchObject({ bonds_issued: 1, liability_issued_cents: 50000, open_bonds_at_end: 0 });
    expect(r.body.counties.find((c) => c.county === 'Fulton')).toBeUndefined();
    expect(r.body.needs_county.map((x) => x.defendant_name)).toEqual(['Q Five']);
    expect(r.body.totals.bonds_issued).toBe(3);
    const csv = await req('get', `/api/bond-desk/reports/tn-quarterly?quarter=${q}&format=csv`, agent);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Required by');
    expect(csv.text).toContain('40-11-314');
    expect(csv.text).toContain('2026-10-27');
    expect(csv.text).toContain('Davidson,2,3500.00,2,3500.00');
    const pdf = await req('get', `/api/bond-desk/reports/tn-quarterly?quarter=${q}&format=pdf`, agent).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((await req('get', '/api/bond-desk/reports/tn-quarterly?quarter=2026-Q9', agent)).status).toBe(400);
  });

  test('RC6 with the settings off: 503 feature_unavailable, and /access tells the app to hide them', async () => {
    if (!ctx.app) return;
    process.env.BOND_REARREST_ALERTS_ENABLED = 'false';
    process.env.CUSTODY_ALERTS_ENABLED = 'false';
    process.env.BOND_RECOVERY_SHARING_ENABLED = 'false';
    try {
      expect((await req('get', '/api/bond-desk/access', agent)).body.features).toEqual({ rearrest_alerts: false, recovery_sharing: false });
      for (const [m, p, who] of [['get', `/api/bond-desk/bonds/${bondStrong.id}/rearrests`, agent], ['get', `/api/bond-desk/bonds/${bondStrong.id}/recovery`, agent],
        ['get', '/api/custody/follows', family], ['get', '/api/recovery-shares', recov]]) {
        const r = await req(m, p, who);
        expect([r.status, r.body.code]).toEqual([503, 'feature_unavailable']);
      }
      expect((await req('get', '/api/custody/status', family)).body.enabled).toBe(false);
      expect((await req('get', '/api/bond-desk/dashboard', agent)).body.rearrests).toEqual([]);
      // ingest runs, but nothing is matched or alerted
      roster = [rec({ name: 'Rhea Quill', dob: '1990-04-05', booking_id: 'RC-201' })];
      const r = await ingest();
      expect(r.rearrest).toBeUndefined();
    } finally {
      for (const k of ['BOND_REARREST_ALERTS_ENABLED', 'CUSTODY_ALERTS_ENABLED', 'BOND_RECOVERY_SHARING_ENABLED']) delete process.env[k];
    }
  });
});
