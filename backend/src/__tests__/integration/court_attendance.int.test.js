/**
 * court_attendance.int.test.js — Bond Desk court-date reminders (A1), the morning-after text (A6)
 * and "Did you make it to court?" (A7) on the real app + real Postgres, a fake Telnyx server and
 * real Ed25519-signed inbound webhooks:
 *
 *   CA1  hearings: the bond form's court date becomes the first hearing; bd_bonds.court_date follows the next one
 *   CA2  plan: defendant + every confirmed indemnitor, 7d 09:00 / 3d 09:00 / 1d 18:00 / day-of 06:30 in the
 *        bond's county zone; "ask" 15:00 and "missed" 09:00 next day for the defendant only; no confirmation → nothing
 *   CA3  the job sends what is due once (twice run = nothing new), 5¢ each in bd_texts; STOP numbers skipped;
 *        delivery status shown on the timeline; a changed number needs a new confirmation
 *   CA4  a date added late still gets one text at once; deleting a hearing / closing the bond / the switch cancel
 *   CA5  morning after: unconfirmed → text to the defendant + agent alert; marked attended first → nothing
 *   CA6  reply "3" → missed + the "act today" text at once; "1" → attended + confirmation; unrelated text → nothing
 *   CA7  app users: "Did you make it?" by text → reply "2" → rescheduled; marked missed in the app → the
 *        morning-after message is queued now; never once attended
 *   CA8  metrics: admin per county / month for app users and Bond Desk; the agent's own report + CSV
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { describeIntegration, initSuite } from './_harness.js';
import { zonedDateTimeToUtc, todayInZone, addDays } from '../../utils/timezone.js';

describeIntegration('Court attendance: Bond Desk reminders, morning-after, "Did you make it?" (real Postgres)', () => {
  const ctx = initSuite();
  const texts = [];
  let telnyx;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  let agent, consumer, admin;
  let svc;
  let ipN = 0;
  const DEF = '+16155550311';
  const IND = '+16155550322';
  const IND2 = '+16155550333';
  const APP = '+16155550344';
  const req = (m, path, who) => {
    let r = ctx.request()[m](path).set('X-Forwarded-For', `10.89.${(++ipN >> 8) & 255}.${ipN & 255}`);
    if (who) r = r.set(who.headers);
    return r;
  };
  const bd = (m, path, who = agent) => req(m, `/api/bond-desk${path}`, who);
  const inbound = (from, text) => {
    const raw = JSON.stringify({ data: { event_type: 'message.received', payload: { text, from: { phone_number: from } } } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.sign(null, Buffer.from(`${ts}|${raw}`), privateKey).toString('base64');
    // the slow part (court answers, inbox routing) runs after Telnyx has its 200: wait for it
    return ctx.request().post('/api/webhooks/telnyx').set('Content-Type', 'application/json')
      .set('telnyx-signature-ed25519', sig).set('telnyx-timestamp', String(ts)).send(raw)
      .then(async (r) => { await (await import('../../routes/webhooks/telnyx.js')).inboundIdle(); return r; });
  };
  const rowsFor = (cdId) => ctx.db.all(`SELECT id, phone, step, court_day, send_at, status, reason, text_id FROM bd_reminders WHERE court_date_id = ? ORDER BY send_at, phone`, [cdId]);
  const local = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

  beforeAll(async () => {
    if (!ctx.app) return;
    telnyx = http.createServer((rq, rs) => {
      let data = '';
      rq.on('data', (c) => { data += c; });
      rq.on('end', () => {
        const j = JSON.parse(data || '{}');
        texts.push(j);
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ data: { id: `ca_tx_${texts.length}` } }));
      });
    });
    await new Promise((r) => telnyx.listen(0, '127.0.0.1', r));
    Object.assign(process.env, {
      TELNYX_API_KEY: 'KEY_ca', TELNYX_FROM_NUMBER: '+16155550100', TELNYX_API_BASE: `http://127.0.0.1:${telnyx.address().port}`,
      TELNYX_PUBLIC_KEY: rawPub, ADMIN_KEY: 'court-attendance-admin-key-0123456789',
    });
    svc = await import('../../services/bondDesk/courtDates.js');
    agent = await ctx.register({ displayName: 'CA agent', accountType: 'bail_agent' });
    consumer = await ctx.register({ displayName: 'CA consumer' });
    admin = await ctx.register({ displayName: 'CA admin' });
    const r = await req('post', '/api/billing/bondsman/profile', agent).send({ company_name: 'Second Chance Bail', license_number: 'TN-9', license_state: 'TN', states: ['TN'], counties: ['Knox'] });
    expect(r.status).toBe(200);
    await ctx.db.run(`UPDATE bondsman_profiles SET phone = '615-555-0199' WHERE user_id = ?`, [agent.user.id]);
    await ctx.db.run(`INSERT INTO bondsman_subscriptions (user_id, tier, status, stripe_sub_id, amount_cents) VALUES (?, 'starter', 'active', 'sub_ca_1', 9900)`, [agent.user.id]);
    await ctx.db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [admin.user.id]);
    const { invalidateUserCache } = await import('../../middleware/auth.js');
    invalidateUserCache(admin.user.id);
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM bd_texts WHERE agent_id = ?', [agent.user.id]);
      await db.run('DELETE FROM bondsman_subscriptions WHERE user_id = ?', [agent.user.id]);
      await db.run('DELETE FROM bondsman_profiles WHERE user_id = ?', [agent.user.id]);
      await db.run(`DELETE FROM sms_opt_outs WHERE phone IN (?, ?, ?, ?)`, [DEF, IND, IND2, APP]);
      await db.run(`DELETE FROM sms_delivery WHERE provider_id LIKE 'ca_tx_%'`);
    });
  });
  afterAll(async () => {
    if (telnyx) await new Promise((r) => telnyx.close(r));
    for (const k of ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'TELNYX_PUBLIC_KEY', 'ADMIN_KEY']) delete process.env[k];
  });

  /** An active bond in Knox County, TN (Eastern time), with one indemnitor; both numbers confirmed. */
  async function activeBond(extra = {}) {
    const b = await bd('post', '/bonds').send({ defendant_name: 'Jordan Rivers', bond_amount_cents: 250000, state: 'TN', county: 'Knox',
      defendant_phone: DEF, court_name: 'Knox County Criminal Court', ...extra });
    expect(b.status).toBe(201);
    const bond = b.body.bond;
    const s = await bd('post', `/bonds/${bond.id}/status`).send({ status: 'active', date: todayInZone('America/Chicago') });   // the agent's zone
    expect(s.status).toBe(200);
    const ind = await bd('post', `/bonds/${bond.id}/indemnitors`).send({ full_name: 'Casey Rivers', relationship: 'Sister', phone: IND });
    expect(ind.status).toBe(201);
    return { bond, ind: ind.body.indemnitor };
  }
  const confirm = async (bondId, to, indemnitorId) => {
    const r = await bd('put', `/bonds/${bondId}/text-consent`).send({ to, indemnitor_id: indemnitorId, consent_confirmed: true });
    expect(r.status).toBe(200);
    return r.body;
  };

  test('CA1 the bond form court date is the first hearing; bd_bonds.court_date is the next hearing', async () => {
    if (!ctx.app) return;
    const tz = 'America/New_York';
    const d20 = addDays(todayInZone(tz), 20);
    const d10 = addDays(todayInZone(tz), 10);
    const b = await bd('post', '/bonds').send({ defendant_name: 'Form Date', bond_amount_cents: 100000, state: 'TN', county: 'Knox', court_date: d20, court_name: 'Knox Sessions' });
    expect(b.status).toBe(201);
    let list = await bd('get', `/bonds/${b.body.bond.id}/court-dates`);
    expect(list.status).toBe(200);
    expect(list.body.court_dates).toEqual([expect.objectContaining({ court_date: d20, court_name: 'Knox Sessions', status: 'scheduled' })]);
    expect(list.body.time_zone).toBe('America/New_York');   // Knox County, TN is Eastern
    expect(list.body.reminders_on).toBe(true);
    const add = await bd('post', `/bonds/${b.body.bond.id}/court-dates`).send({ court_date: d10, court_time: '09:30', room: '3B' });
    expect(add.status).toBe(201);
    expect(add.body.court_date).toEqual(expect.objectContaining({ court_date: d10, court_time: '09:30', room: '3B', court_name: 'Knox Sessions' }));
    expect((await bd('get', `/bonds/${b.body.bond.id}`)).body.bond.court_date).toBe(d10);
    // validation, duplicates, another agent's / unknown ids
    expect((await bd('post', `/bonds/${b.body.bond.id}/court-dates`).send({ court_date: d10, court_time: '09:30' })).status).toBe(409);
    expect((await bd('post', `/bonds/${b.body.bond.id}/court-dates`).send({ court_date: '2026-02-30' })).body.code).toBe('bad_date');
    expect((await bd('post', `/bonds/${b.body.bond.id}/court-dates`).send({ court_date: d10, court_time: '25:00' })).body.code).toBe('bad_time');
    expect((await bd('patch', `/bonds/${b.body.bond.id}/court-dates/999999999`).send({ status: 'attended' })).status).toBe(404);
    expect((await bd('patch', `/bonds/${b.body.bond.id}/court-dates/${add.body.court_date.id}`).send({ status: 'lost' })).status).toBe(400);
    expect((await bd('get', `/bonds/${b.body.bond.id}/court-dates`, consumer)).status).toBe(403);
    // the form shows the next hearing: changing it there moves that hearing; deleting it moves the bond's date on
    await bd('patch', `/bonds/${b.body.bond.id}`).send({ court_date: addDays(d20, 1) });
    list = await bd('get', `/bonds/${b.body.bond.id}/court-dates`);
    expect(list.body.court_dates.map((c) => [c.id, c.court_date])).toEqual([[list.body.court_dates[0].id, d20], [add.body.court_date.id, addDays(d20, 1)]]);
    expect((await bd('get', `/bonds/${b.body.bond.id}`)).body.bond.court_date).toBe(d20);
    const del = await bd('delete', `/bonds/${b.body.bond.id}/court-dates/${list.body.court_dates[0].id}`);
    expect(del.status).toBe(200);
    expect((await bd('get', `/bonds/${b.body.bond.id}`)).body.bond.court_date).toBe(addDays(d20, 1));
  });

  let planBond; let planCd;
  test('CA2 the plan: both numbers, county zone, ask + missed for the defendant only; nothing without a confirmation', async () => {
    if (!ctx.app) return;
    const { bond, ind } = await activeBond();
    planBond = bond;
    const tz = 'America/New_York';
    const day = addDays(todayInZone(tz), 8);
    const add = await bd('post', `/bonds/${bond.id}/court-dates`).send({ court_date: day, court_time: '10:30', room: '6A' });
    expect(add.status).toBe(201);
    planCd = add.body.court_date.id;
    expect(await rowsFor(planCd)).toEqual([]);                    // nobody confirmed yet
    const second = await ctx.db.get(`INSERT INTO bd_indemnitors (bond_id, full_name, phone) VALUES (?, 'Unconfirmed Uncle', ?) RETURNING id`, [bond.id, IND2]);
    await confirm(bond.id, 'defendant');
    const after = await confirm(bond.id, 'indemnitor', ind.id);
    expect(after.recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: 'defendant', consent: true, phone_masked: '•••-•••-0311' }),
      expect.objectContaining({ to: 'indemnitor', indemnitor_id: ind.id, consent: true }),
      expect.objectContaining({ to: 'indemnitor', indemnitor_id: Number(second.id), consent: false }),
    ]));
    const rows = await rowsFor(planCd);
    const by = (phone) => rows.filter((r) => r.phone === phone).map((r) => [r.step, local(r.send_at, tz)]);
    const at = (d, hm) => `${addDays(day, d)}, ${hm}`;
    expect(by(DEF)).toEqual([['d7', at(-7, '09:00')], ['d3', at(-3, '09:00')], ['d1', at(-1, '18:00')], ['d0', at(0, '06:30')], ['ask', at(0, '15:00')], ['missed', at(1, '09:00')]]);
    expect(by(IND)).toEqual([['d7', at(-7, '09:00')], ['d3', at(-3, '09:00')], ['d1', at(-1, '18:00')], ['d0', at(0, '06:30')]]);
    expect(by(IND2)).toEqual([]);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    // re-planning (an unrelated save) changes nothing
    await svc.planBond(ctx.db, bond.id);
    expect((await rowsFor(planCd)).map((r) => [r.id, r.status])).toEqual(rows.map((r) => [r.id, r.status]));
    // the timeline
    const tl = await bd('get', `/bonds/${bond.id}/reminders`);
    expect(tl.status).toBe(200);
    expect(tl.body.reminders).toHaveLength(10);
    expect(tl.body.reminders[0]).toEqual(expect.objectContaining({ step: 'd7', status: 'pending', to_masked: expect.stringMatching(/•••-•••-03(11|22)/), delivery_status: null }));
  });

  test('CA3 the job sends each step once, bills 5¢ each, skips STOP numbers, shows delivery; a new number needs a new confirmation', async () => {
    if (!ctx.app) return;
    const rows = await rowsFor(planCd);
    const d7 = new Date(rows.find((r) => r.step === 'd7').send_at);
    const before = texts.length;
    const r1 = await svc.runBondCourtReminders(ctx.db, { now: d7, courtDateId: planCd });
    expect(r1.sent).toBe(2);
    const r2 = await svc.runBondCourtReminders(ctx.db, { now: d7, courtDateId: planCd });
    expect(r2.claimed).toBe(0);                                    // run twice: nothing new
    const sent = texts.slice(before);
    expect(sent.map((t) => t.to).sort()).toEqual([DEF, IND].sort());
    const def = sent.find((t) => t.to === DEF).text;
    const ind = sent.find((t) => t.to === IND).text;
    expect(def).toMatch(/^Second Chance Bail: Jordan, court is in 7 days, .+ at 10:30 AM at Knox County Criminal Court, room 6A\. If you miss it, a warrant can be issued and your bond can be forfeited\. .*bring ID.*How will you get there\?.*Reply STOP to opt out\.$/);
    expect(ind).toMatch(/^Second Chance Bail: You co-signed Jordan Rivers's bail bond\. Court is in 7 days.*the bond can be forfeited\..*Reply STOP to opt out\.$/);
    const { smsSegments } = await import('../../services/smsText.js');
    for (const t of [def, ind]) expect(smsSegments(t)).toEqual(expect.objectContaining({ encoding: 'GSM-7', segments: 2 }));
    const billed = await ctx.db.all(`SELECT purpose, cents, to_masked FROM bd_texts WHERE agent_id = ? AND bond_id = ? ORDER BY id`, [agent.user.id, planBond.id]);
    expect(billed).toEqual([expect.objectContaining({ purpose: 'court_reminder', cents: 5 }), expect.objectContaining({ purpose: 'court_reminder', cents: 5 })]);
    // delivery status from the carrier shows on the timeline
    const sentRow = (await rowsFor(planCd)).find((r) => r.step === 'd7' && r.phone === DEF);
    const prov = await ctx.db.get('SELECT provider_id FROM bd_texts WHERE id = ?', [sentRow.text_id]);
    await ctx.db.run(`INSERT INTO sms_delivery (provider_id, status) VALUES (?, 'delivered')`, [prov.provider_id]);
    const tl = await bd('get', `/bonds/${planBond.id}/reminders`);
    expect(tl.body.reminders.find((x) => x.id === Number(sentRow.id))).toEqual(expect.objectContaining({ status: 'sent', delivery_status: 'delivered', name: 'Jordan Rivers' }));
    // STOP from the indemnitor: the 3-day text to that number is skipped, the defendant's goes
    await ctx.db.run('INSERT INTO sms_opt_outs (phone) VALUES (?) ON CONFLICT DO NOTHING', [IND]);
    const d3 = new Date(rows.find((r) => r.step === 'd3').send_at);
    const r3 = await svc.runBondCourtReminders(ctx.db, { now: d3, courtDateId: planCd });
    expect([r3.sent, r3.skipped]).toEqual([1, 1]);
    expect((await rowsFor(planCd)).find((r) => r.step === 'd3' && r.phone === IND)).toEqual(expect.objectContaining({ status: 'skipped', reason: 'opted_out' }));
    expect((await bd('get', `/bonds/${planBond.id}/court-dates`)).body.recipients.find((p) => p.to === 'indemnitor' && p.phone === IND).opted_out).toBe(true);
    await ctx.db.run('DELETE FROM sms_opt_outs WHERE phone = ?', [IND]);
    // the defendant's number changes: the old number's pending texts stop until the agent confirms the new one
    await bd('patch', `/bonds/${planBond.id}`).send({ defendant_phone: '+16155550399' });
    const left = (await rowsFor(planCd)).filter((r) => r.phone === DEF && r.status === 'pending');
    expect(left).toEqual([]);
    await confirm(planBond.id, 'defendant');
    expect((await rowsFor(planCd)).filter((r) => r.phone === '+16155550399' && r.status === 'pending').map((r) => r.step)).toEqual(['d7', 'd3', 'd1', 'd0', 'ask', 'missed']);
    await bd('patch', `/bonds/${planBond.id}`).send({ defendant_phone: DEF });
    await confirm(planBond.id, 'defendant');
  });

  test('CA4 a late date gets one text at once; deleting, closing the bond and the switch cancel', async () => {
    if (!ctx.app) return;
    const tz = 'America/New_York';
    const today = todayInZone(tz);
    const before = texts.length;
    // tomorrow, entered now: whatever planned steps are already past, at least one text goes out
    const late = await bd('post', `/bonds/${planBond.id}/court-dates`).send({ court_date: addDays(today, 1), court_time: '08:00' });
    expect(late.status).toBe(201);
    const lateRows = await rowsFor(late.body.court_date.id);
    const due = lateRows.filter((r) => ['d1', 'd0', 'now'].includes(r.step) && r.phone === DEF);
    expect(due.length).toBeGreaterThanOrEqual(1);
    // and a hearing for today after every step passed → exactly one 'now' text per number, sent right away
    const todayCd = await ctx.db.get(`INSERT INTO bd_court_dates (bond_id, court_date) VALUES (?, CAST(? AS date)) RETURNING id`, [planBond.id, today]);
    const evening = zonedDateTimeToUtc(today, 23, 0, tz);
    await svc.planBondCourtDate(ctx.db, Number(todayCd.id), evening);
    const nowRows = (await rowsFor(Number(todayCd.id))).filter((r) => r.step === 'now');
    expect(nowRows.map((r) => r.phone).sort()).toEqual([DEF, IND].sort());
    await svc.runBondCourtReminders(ctx.db, { now: evening, courtDateId: Number(todayCd.id) });
    await svc.planBondCourtDate(ctx.db, Number(todayCd.id), new Date(evening.getTime() + 60_000));   // re-plan: no second 'now'
    expect((await rowsFor(Number(todayCd.id))).filter((r) => r.step === 'now' && r.status === 'sent')).toHaveLength(2);
    expect((await rowsFor(Number(todayCd.id))).filter((r) => r.status === 'pending' && r.step === 'now')).toHaveLength(0);
    expect(texts.length).toBeGreaterThan(before);
    // delete → its pending texts are cancelled
    await bd('delete', `/bonds/${planBond.id}/court-dates/${late.body.court_date.id}`);
    expect((await rowsFor(late.body.court_date.id)).filter((r) => r.status === 'pending')).toEqual([]);
    expect((await rowsFor(late.body.court_date.id)).some((r) => r.reason === 'court_date_deleted')).toBe(true);
    // switch off → cancelled; on → planned again
    let sw = await bd('put', `/bonds/${planBond.id}/reminders`).send({ on: false });
    expect(sw.body.reminders_on).toBe(false);
    expect((await rowsFor(planCd)).filter((r) => r.status === 'pending')).toEqual([]);
    sw = await bd('put', `/bonds/${planBond.id}/reminders`).send({ on: true, lang: 'es' });
    expect([sw.body.reminders_on, sw.body.text_lang]).toEqual([true, 'es']);
    expect((await rowsFor(planCd)).filter((r) => r.status === 'pending').length).toBeGreaterThan(0);
    expect((await bd('put', `/bonds/${planBond.id}/reminders`).send({ on: 'yes' })).status).toBe(400);
    await bd('put', `/bonds/${planBond.id}/reminders`).send({ on: true, lang: 'en' });
    // the bond is exonerated → everything pending is cancelled
    const { bond } = await activeBond({ defendant_name: 'Closed Case' });
    await confirm(bond.id, 'defendant');
    const cd = await bd('post', `/bonds/${bond.id}/court-dates`).send({ court_date: addDays(today, 9) });
    expect((await rowsFor(cd.body.court_date.id)).filter((r) => r.status === 'pending').length).toBe(6);
    expect((await bd('post', `/bonds/${bond.id}/status`).send({ status: 'exonerated', date: todayInZone('America/Chicago') })).status).toBe(200);
    const closed = await rowsFor(cd.body.court_date.id);
    expect(closed.every((r) => r.status === 'cancelled' && r.reason === 'bond_exonerated')).toBe(true);
  });

  test('CA5 morning after: unconfirmed → text to the defendant + agent alert; attended first → no text', async () => {
    if (!ctx.app) return;
    const tz = 'America/New_York';
    const rows = await rowsFor(planCd);
    const day = rows[0].court_day;
    const morning = zonedDateTimeToUtc(addDays(day, 1), 9, 30, tz);
    const before = texts.length;
    const r = await svc.runBondCourtReminders(ctx.db, { now: morning });
    const after = await rowsFor(planCd);
    expect(after.find((x) => x.step === 'missed' && x.phone === DEF).status).toBe('sent');
    expect(after.find((x) => x.step === 'ask' && x.phone === DEF)).toEqual(expect.objectContaining({ status: 'skipped', reason: 'too_late' }));
    expect(after.find((x) => x.step === 'd0' && x.phone === IND)).toEqual(expect.objectContaining({ status: 'skipped', reason: 'too_late' }));
    const missedText = texts.slice(before).find((t) => t.to === DEF).text;
    expect(missedText).toMatch(/^Second Chance Bail: Jordan, if you missed court on .+, act today: call the court clerk, your lawyer, or your bail agent at 615-555-0199\. What to do: https:\/\/justicegavel\.app\/missed-court Reply STOP to opt out\.$/);
    expect(r.alerts).toBeGreaterThanOrEqual(1);
    expect((await ctx.db.get('SELECT followup_at FROM bd_court_dates WHERE id = ?', [planCd])).followup_at).toBeTruthy();
    // a second run: no second alert, no second text
    const again = await svc.runBondCourtReminders(ctx.db, { now: new Date(morning.getTime() + 600_000) });
    expect(again.sent).toBe(0);
    // another hearing marked attended before the morning: no missed text
    const day2 = addDays(todayInZone(tz), 12);
    const cd2 = await bd('post', `/bonds/${planBond.id}/court-dates`).send({ court_date: day2 });
    expect((await bd('patch', `/bonds/${planBond.id}/court-dates/${cd2.body.court_date.id}`).send({ status: 'attended' })).body.court_date)
      .toEqual(expect.objectContaining({ status: 'attended', status_source: 'agent' }));
    const m2 = zonedDateTimeToUtc(addDays(day2, 1), 9, 30, tz);
    const b2 = texts.length;
    await svc.runBondCourtReminders(ctx.db, { now: m2 });
    expect(texts.slice(b2).filter((t) => /missed court/.test(t.text))).toEqual([]);
    expect((await rowsFor(cd2.body.court_date.id)).find((x) => x.step === 'missed')).toEqual(expect.objectContaining({ status: 'cancelled', reason: 'court_date_attended' }));
  });

  test('CA6 replies: "3" → missed + act-today text at once; "1" → attended; anything else → nothing', async () => {
    if (!ctx.app) return;
    const tz = 'America/New_York';
    const today = todayInZone(tz);
    const { bond } = await activeBond({ defendant_name: 'Reply Person' });
    await confirm(bond.id, 'defendant');
    const cd = await ctx.db.get(`INSERT INTO bd_court_dates (bond_id, court_date, court_name) VALUES (?, CAST(? AS date), 'Knox Court') RETURNING id`, [bond.id, today]);
    const cdId = Number(cd.id);
    const morning = zonedDateTimeToUtc(today, 8, 0, tz);
    await svc.planBondCourtDate(ctx.db, cdId, morning);
    const askAt = zonedDateTimeToUtc(today, 15, 0, tz);
    const b0 = texts.length;
    await svc.runBondCourtReminders(ctx.db, { now: askAt, courtDateId: cdId });
    const ask = texts.slice(b0).find((t) => t.to === DEF && /did you make it/.test(t.text));
    expect(ask.text).toBe('Second Chance Bail: Reply, did you make it to court today? Reply 1 = I went, 2 = it was rescheduled, 3 = I missed it. Reply STOP to opt out.');
    expect((await ctx.db.get('SELECT asked_at FROM bd_court_dates WHERE id = ?', [cdId])).asked_at).toBeTruthy();
    // unrelated / ambiguous replies change nothing and send nothing
    const b1 = texts.length;
    for (const t of ['maybe', '12', 'yes 3', '']) expect((await inbound(DEF, t)).status).toBe(200);
    expect((await ctx.db.get('SELECT status FROM bd_court_dates WHERE id = ?', [cdId])).status).toBe('scheduled');
    expect(texts.length).toBe(b1);
    // a forged reply is refused
    const raw = JSON.stringify({ data: { event_type: 'message.received', payload: { text: '3', from: { phone_number: DEF } } } });
    expect((await ctx.request().post('/api/webhooks/telnyx').set('Content-Type', 'application/json').set('telnyx-signature-ed25519', 'AAAA').set('telnyx-timestamp', String(Math.floor(Date.now() / 1000))).send(raw)).status).toBe(401);
    // "3": missed, the act-today text right away (billed), agent alerted
    expect((await inbound(DEF, ' 3 ')).status).toBe(200);
    const row = await ctx.db.get('SELECT status, status_source, followup_at FROM bd_court_dates WHERE id = ?', [cdId]);
    expect(row).toEqual(expect.objectContaining({ status: 'missed', status_source: 'reply' }));
    expect(row.followup_at).toBeTruthy();
    const reply = texts.slice(b1).find((t) => t.to === DEF);
    expect(reply.text).toMatch(/^Second Chance Bail: Reply, if you missed court on .+, act today: call the court clerk, your lawyer, or your bail agent/);
    expect((await ctx.db.all(`SELECT purpose FROM bd_texts WHERE bond_id = ? ORDER BY id`, [bond.id])).map((x) => x.purpose)).toEqual(expect.arrayContaining(['court_ask', 'court_missed']));
    // changed their mind: "1" → attended + a confirmation
    const b2 = texts.length;
    await inbound(DEF, '1');
    expect((await ctx.db.get('SELECT status FROM bd_court_dates WHERE id = ?', [cdId])).status).toBe('attended');
    expect(texts.slice(b2).find((t) => t.to === DEF).text).toMatch(/^Second Chance Bail: Thanks, Reply\. Court on .+ is marked as attended\.$/);
    // the agent's own status wins over a later reply
    await bd('patch', `/bonds/${bond.id}/court-dates/${cdId}`).send({ status: 'rescheduled' });
    const b3 = texts.length;
    await inbound(DEF, '3');
    expect((await ctx.db.get('SELECT status, status_source FROM bd_court_dates WHERE id = ?', [cdId]))).toEqual({ status: 'rescheduled', status_source: 'agent' });
    expect(texts.slice(b3).find((t) => t.to === DEF).text).toMatch(/We got your answer\.$/);
  });

  test('CA7 app users: asked by text, reply "2" → rescheduled; marked missed in the app → morning-after now; attended → never', async () => {
    if (!ctx.app) return;
    const { dispatchDueReminders } = await import('../../services/reminderDispatcher.js');
    const pref = await req('put', '/api/court-dates/preferences', consumer).send({ sms_reminders: true, phone: APP });
    expect(pref.status).toBe(200);
    const day = addDays(todayInZone('America/Chicago'), 2);
    const cd = await req('post', '/api/court-dates', consumer).set('X-Timezone', 'America/Chicago').send({ case_title: 'My DUI', court_date: day, state: 'TN' });
    expect(cd.status).toBe(201);
    const ask = await ctx.db.get(`SELECT id, deliver_at, data FROM scheduled_pushes WHERE court_date_id = ? AND notification_type = 'court_checkin' AND status = 'pending'`, [cd.body.id]);
    expect(local(ask.deliver_at, 'America/Chicago')).toBe(`${day}, 15:00`);
    expect(JSON.parse(ask.data)).toEqual(expect.objectContaining({ screen: 'CourtDateDetail', court_date_id: cd.body.id, ask: 1 }));
    await ctx.db.run(`UPDATE scheduled_pushes SET deliver_at = NOW() - INTERVAL '1 minute' WHERE id = ?`, [ask.id]);
    const b0 = texts.length;
    await dispatchDueReminders({ db: ctx.db, now: new Date() });
    expect((await ctx.db.get('SELECT status, channel FROM scheduled_pushes WHERE id = ?', [ask.id]))).toEqual({ status: 'sent', channel: 'sms' });
    expect(texts.slice(b0).find((t) => t.to === APP).text).toBe('Justice Gavel: Did you make it to court today? (My DUI) Reply 1 = I went, 2 = it was rescheduled, 3 = I missed it. Reply STOP to opt out.');
    expect((await ctx.db.get('SELECT asked_phone, asked_at FROM court_dates WHERE id = ?', [cd.body.id]))).toEqual(expect.objectContaining({ asked_phone: APP, asked_at: expect.anything() }));
    const b1 = texts.length;
    expect((await inbound(APP, '2')).status).toBe(200);
    expect(await ctx.db.get('SELECT status, status_source FROM court_dates WHERE id = ?', [cd.body.id])).toEqual({ status: 'rescheduled', status_source: 'reply' });
    expect(texts.slice(b1).find((t) => t.to === APP).text).toMatch(/^Justice Gavel: Thanks\. Court on .+ is marked as rescheduled\./);
    expect(await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND status = 'pending'`, [cd.body.id])).toBeUndefined();

    // a hearing today marked missed in the app → the morning-after message is due now, by text too
    const today = todayInZone('America/Chicago');
    const t = await req('post', '/api/court-dates', consumer).send({ case_id: cd.body.case_id, court_date: today, court_time: '08:00' });
    expect(t.status).toBe(201);
    const m = await req('patch', `/api/court-dates/${t.body.id}`, consumer).send({ status: 'missed' });
    expect(m.status).toBe(200);
    expect(m.body.guidance.steps.at(-1).text).toMatch(/lawyer or the court clerk/);
    const fu = await ctx.db.get(`SELECT id, deliver_at FROM scheduled_pushes WHERE court_date_id = ? AND notification_type = 'court_missed_followup' AND status = 'pending'`, [t.body.id]);
    expect(new Date(fu.deliver_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const b2 = texts.length;
    await dispatchDueReminders({ db: ctx.db, now: new Date() });
    expect(texts.slice(b2).find((x) => x.to === APP).text).toMatch(/^Justice Gavel: If you missed court on .+ \(My DUI\), act today: call the court clerk, your lawyer, or your bail agent\. What to do: https:\/\/justicegavel\.app\/missed-court Reply STOP to opt out\.$/);
    // marked again: never twice
    await req('patch', `/api/court-dates/${t.body.id}`, consumer).send({ status: 'missed' });
    expect(await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND notification_type = 'court_missed_followup' AND status = 'pending'`, [t.body.id])).toBeUndefined();

    // attended before the morning: the planned message is cancelled, and a stale row is cancelled at send time
    const later = await req('post', '/api/court-dates', consumer).send({ case_id: cd.body.case_id, court_date: addDays(today, 4) });
    const planned = await ctx.db.get(`SELECT id FROM scheduled_pushes WHERE court_date_id = ? AND notification_type = 'court_missed_followup' AND status = 'pending'`, [later.body.id]);
    expect(planned).toBeTruthy();
    await req('patch', `/api/court-dates/${later.body.id}`, consumer).send({ status: 'attended' });
    expect((await ctx.db.get('SELECT status FROM scheduled_pushes WHERE id = ?', [planned.id])).status).toBe('cancelled');
    await ctx.db.run(`UPDATE scheduled_pushes SET status = 'pending', error = NULL, deliver_at = NOW() - INTERVAL '1 minute' WHERE id = ?`, [planned.id]);
    const b3 = texts.length;
    await dispatchDueReminders({ db: ctx.db, now: new Date() });
    expect(await ctx.db.get('SELECT status, error FROM scheduled_pushes WHERE id = ?', [planned.id])).toEqual({ status: 'cancelled', error: 'court_date_not_scheduled' });
    expect(texts.length).toBe(b3);
  });

  test('RF11 a late text reply never overwrites a status the person set in the app; a reply can change a reply', async () => {
    if (!ctx.app) return;
    const today = todayInZone('America/Chicago');
    const caseId = Number((await ctx.db.get('SELECT case_id FROM court_dates WHERE user_id = ? ORDER BY id LIMIT 1', [consumer.user.id])).case_id);
    const cd = await req('post', '/api/court-dates', consumer).send({ case_id: caseId, court_date: today, court_time: '07:00' });
    expect(cd.status).toBe(201);
    await ctx.db.run('UPDATE court_dates SET asked_phone = ?, asked_at = NOW() WHERE id = ?', [APP, cd.body.id]);
    // the person marks it in the app first …
    expect((await req('patch', `/api/court-dates/${cd.body.id}`, consumer).send({ status: 'attended' })).status).toBe(200);
    expect(await ctx.db.get('SELECT status, status_source FROM court_dates WHERE id = ?', [cd.body.id])).toEqual({ status: 'attended', status_source: 'app' });
    // … then a late "3" by text: noted, nothing changed, no "act today" text
    const b0 = texts.length;
    expect((await inbound(APP, '3')).status).toBe(200);
    expect(await ctx.db.get('SELECT status, status_source FROM court_dates WHERE id = ?', [cd.body.id])).toEqual({ status: 'attended', status_source: 'app' });
    expect(texts.slice(b0).filter((x) => x.to === APP && /act today/.test(x.text))).toEqual([]);
    // a status that came from a reply can be corrected by the next reply
    const cd2 = await req('post', '/api/court-dates', consumer).send({ case_id: caseId, court_date: today, court_time: '07:30' });
    await ctx.db.run('UPDATE court_dates SET asked_phone = ?, asked_at = NOW() WHERE id = ?', [APP, cd2.body.id]);
    await inbound(APP, '2');
    expect((await ctx.db.get('SELECT status FROM court_dates WHERE id = ?', [cd2.body.id])).status).toBe('rescheduled');
    await inbound(APP, '1');
    expect(await ctx.db.get('SELECT status, status_source FROM court_dates WHERE id = ?', [cd2.body.id])).toEqual({ status: 'attended', status_source: 'reply' });
  });

  test('CA8 metrics: admin per county and month; the agent sees their own bonds (JSON + CSV)', async () => {
    if (!ctx.app) return;
    const month = todayInZone('America/New_York').slice(0, 7);
    expect((await req('get', '/api/admin/metrics/appearance', consumer).set('X-Admin-Key', process.env.ADMIN_KEY)).status).toBe(403);
    expect((await req('get', '/api/admin/metrics/appearance', admin)).status).toBe(401);
    expect((await req('get', '/api/admin/metrics/appearance?from=2026-13', admin).set('X-Admin-Key', process.env.ADMIN_KEY)).status).toBe(400);
    const m = await req('get', `/api/admin/metrics/appearance?from=${month}&to=${month}`, admin).set('X-Admin-Key', process.env.ADMIN_KEY);
    expect(m.status).toBe(200);
    const knox = m.body.bond_desk.find((r) => r.county === 'Knox' && r.state === 'TN' && r.month === month);
    expect(knox).toEqual(expect.objectContaining({ region: 'Knox, TN' }));
    expect(knox.asked).toBeGreaterThanOrEqual(1);
    expect(knox.rescheduled).toBeGreaterThanOrEqual(1);
    const tn = m.body.consumer.find((r) => r.state === 'TN' && r.county === null && r.month === month);
    expect(tn.missed).toBeGreaterThanOrEqual(1);
    for (const r of [...m.body.bond_desk, ...m.body.consumer]) {
      expect(Object.keys(r).sort()).toEqual(['asked', 'attended', 'county', 'missed', 'month', 'no_answer', 'region', 'rescheduled', 'state']);
    }
    // the agent's own report
    const mine = await bd('get', `/reports/appearance?from=${month}-01&to=${todayInZone('America/New_York')}`);
    expect(mine.status).toBe(200);
    expect(mine.body.rows.find((r) => r.region === 'Knox, TN')).toEqual(expect.objectContaining({ month }));
    expect(mine.body.totals.asked).toBeGreaterThanOrEqual(1);
    const csv = await bd('get', `/reports/appearance?format=csv&from=${month}-01`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe('County / state,Month,Asked,Attended,Rescheduled,Missed,No answer');
  });
});
