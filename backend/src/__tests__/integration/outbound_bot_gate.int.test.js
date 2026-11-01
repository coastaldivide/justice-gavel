/**
 * outbound_bot_gate.int.test.js — the nightly paid-lead bot (services/outbound_bot.js), debug scan
 * Oct 30 2026 (docs/DEBUG_SCAN_2026-10-30.md issues 3 and 13), on real Postgres.
 *
 * The bot's texts are a stub (never sent); what it really sends is a lead-summary e-mail to each
 * directory lawyer with an e-mail address, recorded in outbound_messages.
 *
 *   OB1  ⚖ OUTBOUND_BOT_ENABLED unset in production → nothing sent or recorded, arrests not marked
 *   OB2  a dry run reports what it would send and sends nothing (it used to send the e-mails)
 *   OB3  on: the e-mail goes out once and the arrest is marked alerted
 *   OB4  the e-mail claims only what the app does (no "top placement"), its links exist, and the
 *        one-click unsubscribe works (signed per address); an unsubscribed lawyer gets nothing more
 */
import { describeIntegration, initSuite, FIXTURE_MARK } from './_harness.js';

describeIntegration('Outbound bot: counsel flag and dry run (real Postgres)', () => {
  const ctx = initSuite();
  let bot;
  const TAG = `ob${Date.now()}`;
  const EMAIL = `${TAG}@lawyer.example.test`;
  const COUNTY = `Ob${Date.now().toString(36)}`;
  const saved = {};
  const KEYS = ['OUTBOUND_BOT_ENABLED', 'APP_ENV', 'RESEND_API_KEY'];

  beforeAll(async () => {
    if (!ctx.app) return;
    for (const k of KEYS) saved[k] = process.env[k];
    delete process.env.RESEND_API_KEY;   // e-mail is logged, not delivered; outbound_messages still records it
    bot = await import('../../services/outbound_bot.js');
    // a directory lawyer in a county no other fixture uses (fixture rows are outside the directory checksum)
    await ctx.db.run(`INSERT INTO lawyers (name, city, state, email, active, source_id) VALUES ('OB Test Lawyer', ?, 'TN', ?, 1, ?)`,
      [COUNTY, EMAIL, `${FIXTURE_MARK}_${TAG}`]);
    await ctx.db.run(
      `INSERT INTO arrest_records (name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney, source, alert_sent, created_at)
       VALUES ('Obi Testlead', CURRENT_DATE, 'DUI', 2500, ?, 'TN', 'Ob County Jail', 0, ?, 0, NOW())`, [COUNTY, TAG]);
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM outbound_messages WHERE recipient_email = ?', [EMAIL]).catch(() => {});
      await db.run('DELETE FROM opt_outs WHERE email = ?', [EMAIL]).catch(() => {});
      await db.run('DELETE FROM lawyers WHERE source_id = ?', [`${FIXTURE_MARK}_${TAG}`]);
      await db.run('DELETE FROM arrest_records WHERE source = ?', [TAG]);
    });
  });
  afterAll(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  const sentToLawyer = async () => (await ctx.db.get('SELECT COUNT(*)::int AS n FROM outbound_messages WHERE recipient_email = ?', [EMAIL])).n;
  const alerted = async () => (await ctx.db.get('SELECT alert_sent FROM arrest_records WHERE source = ?', [TAG])).alert_sent;

  test('OB1 the flag is off in production unless set: nothing is sent', async () => {
    if (!ctx.app) return;
    process.env.APP_ENV = 'production';
    delete process.env.OUTBOUND_BOT_ENABLED;
    const r = await bot.runOutboundBot({ runType: 'nightly', forceRun: true });
    expect(r).toEqual({ skipped: true, reason: 'counsel_flag_off' });
    expect(await sentToLawyer()).toBe(0);
    expect(await alerted()).toBe(0);   // the lead waits until counsel clears the bot
  });

  test('OB2 a dry run sends nothing and reports what it would send', async () => {
    if (!ctx.app) return;
    const r = await bot.runOutboundBot({ runType: 'manual', forceRun: true, dryRun: true });
    expect(r.planned).toBeGreaterThan(0);
    expect(r.messagesSent).toBe(0);
    expect(await sentToLawyer()).toBe(0);
    expect(await alerted()).toBe(0);
  });

  test('OB3 on: the lawyer gets the summary once and the arrest is marked alerted', async () => {
    if (!ctx.app) return;
    process.env.OUTBOUND_BOT_ENABLED = 'true';
    const r = await bot.runOutboundBot({ runType: 'nightly', forceRun: true });
    expect(r.skipped).toBeUndefined();
    expect(await sentToLawyer()).toBe(1);
    expect(await alerted()).toBe(1);
    await bot.runOutboundBot({ runType: 'nightly', forceRun: true });
    expect(await sentToLawyer()).toBe(1);   // never twice
  });

  test('OB4 truthful e-mail, working links, one-click unsubscribe', async () => {
    if (!ctx.app) return;
    const { body } = await ctx.db.get('SELECT body FROM outbound_messages WHERE recipient_email = ?', [EMAIL]);
    expect(body).not.toMatch(/top placement|arrest alerts|free 30-day trial/i);
    expect(body).toContain('https://justicegavel.app/attorney-dashboard');
    const m = /(https:\/\/\S+\/api\/bot\/unsubscribe\?e=[^&\s]+&t=[0-9a-f]{32})/.exec(body);
    expect(m).toBeTruthy();
    const path = m[1].replace(/^https:\/\/[^/]+/, '');
    // a tampered token or another address is refused
    expect((await ctx.request().get(path.replace(/t=[0-9a-f]{32}/, `t=${'0'.repeat(32)}`))).status).toBe(400);
    expect((await ctx.request().get(path.replace(/e=[^&]+/, 'e=someone%40else.test'))).status).toBe(400);
    expect((await ctx.request().get('/api/bot/unsubscribe')).status).toBe(400);
    // opening the link (or a mail scanner opening it) changes nothing: it shows one button
    const shown = await ctx.request().get(path);
    expect(shown.status).toBe(200);
    expect(shown.text).toMatch(/Stop these e-mails\?/);
    expect(shown.text).toMatch(/<form method="post" action="\/api\/bot\/unsubscribe">/);
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM opt_outs WHERE email = ?', [EMAIL])).n).toBe(0);
    // the button posts the signed pair
    const q = new URLSearchParams(path.split('?')[1]);
    expect((await ctx.request().post('/api/bot/unsubscribe').type('form').send({ e: q.get('e'), t: '0'.repeat(32) })).status).toBe(400);
    const done = await ctx.request().post('/api/bot/unsubscribe').type('form').send({ e: q.get('e'), t: q.get('t') });
    expect(done.status).toBe(200);
    expect(done.text).toMatch(/You are unsubscribed/);
    expect((await ctx.request().post('/api/bot/unsubscribe').type('form').send({ e: q.get('e'), t: q.get('t') })).status).toBe(200);   // twice is fine
    expect((await ctx.db.get('SELECT COUNT(*)::int AS n FROM opt_outs WHERE email = ?', [EMAIL])).n).toBe(1);
    // a new arrest in the county: the unsubscribed lawyer gets nothing
    await ctx.db.run(
      `INSERT INTO arrest_records (name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney, source, alert_sent, created_at)
       VALUES ('Obi Second', CURRENT_DATE, 'THEFT', 900, ?, 'TN', 'Ob County Jail', 0, ?, 0, NOW())`, [COUNTY, TAG]);
    await bot.runOutboundBot({ runType: 'nightly', forceRun: true });
    expect(await sentToLawyer()).toBe(1);
  });
});
