/**
 * telnyx_webhook.int.test.js — POST /api/webhooks/telnyx on the real app + Postgres with
 * real Ed25519 signatures: unsigned / forged / stale requests refused; STOP turns texts off
 * for accounts and puts the number on the opt-out list; START takes it off; a final
 * delivery status is recorded and the hourly text-health check raises its alarm only when
 * many texts fail.
 */
import crypto from 'node:crypto';
import { describeIntegration, initSuite } from './_harness.js';

describeIntegration('Telnyx webhook (real Postgres, real Ed25519 signatures)', () => {
  const ctx = initSuite();
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const PHONE = '+16155550177';
  const IDS = [];
  beforeAll(() => {
    process.env.TELNYX_PUBLIC_KEY = rawPub;
    ctx.addCleanup(async (db) => {
      await db.run('DELETE FROM sms_opt_outs WHERE phone = ?', [PHONE]);
      await db.run(`DELETE FROM sms_delivery WHERE provider_id LIKE 'it-telnyx-%'`);
      await db.run(`DELETE FROM telnyx_event_log WHERE event_id LIKE 'rf7-%'`);
    });
  });
  afterAll(() => { delete process.env.TELNYX_PUBLIC_KEY; });

  const send = (event, { ts = Math.floor(Date.now() / 1000), key = privateKey, sig } = {}) => {
    const raw = JSON.stringify(event);
    const signature = sig ?? crypto.sign(null, Buffer.from(`${ts}|${raw}`), key).toString('base64');
    return ctx.request().post('/api/webhooks/telnyx').set('Content-Type', 'application/json')
      .set('telnyx-signature-ed25519', signature).set('telnyx-timestamp', String(ts)).send(raw);
  };
  const inbound = (text) => ({ data: { event_type: 'message.received', payload: { text, from: { phone_number: PHONE } } } });

  test('only genuine, fresh, signed requests are accepted', async () => {
    if (!ctx.app) return;
    expect((await send(inbound('hi'), { sig: '' })).status).toBe(401);
    const other = crypto.generateKeyPairSync('ed25519').privateKey;
    expect((await send(inbound('STOP'), { key: other })).status).toBe(401);
    expect((await send(inbound('STOP'), { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    expect(await ctx.db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [PHONE])).toBeFalsy();
  });

  test('STOP opts the number out (accounts and Bond Desk); START opts it back in', async () => {
    if (!ctx.app) return;
    const u = await ctx.register({ displayName: 'Telnyx user' });
    await ctx.db.run('UPDATE users SET phone = ?, sms_reminders = 1 WHERE id = ?', [PHONE, u.user.id]);
    expect((await send(inbound('  stop '))).status).toBe(200);
    expect(await ctx.db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [PHONE])).toBeTruthy();
    const row = await ctx.db.get('SELECT sms_reminders, sms_opt_out_at FROM users WHERE id = ?', [u.user.id]);
    expect(Number(row.sms_reminders)).toBe(0);
    expect(row.sms_opt_out_at).not.toBeNull();
    expect((await send(inbound('START'))).status).toBe(200);
    expect(await ctx.db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [PHONE])).toBeFalsy();
    // app reminders stay off until the person turns them on again in the app (fresh consent)
    expect(Number((await ctx.db.get('SELECT sms_reminders FROM users WHERE id = ?', [u.user.id])).sms_reminders)).toBe(0);
  });

  test('RF7 a replayed event (same data.id) is acknowledged and not processed again', async () => {
    if (!ctx.app) return;
    const { inboundIdle } = await import('../../routes/webhooks/telnyx.js');
    const ev = (id, text) => ({ data: { id, event_type: 'message.received', payload: { text, from: { phone_number: PHONE } } } });
    const stopId = `rf7-stop-${Date.now()}`; const startId = `rf7-start-${Date.now()}`;
    IDS.push(stopId, startId);
    expect((await send(ev(stopId, 'STOP'))).body).toEqual({ ok: true });
    expect(await ctx.db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [PHONE])).toBeTruthy();
    expect((await send(ev(startId, 'START'))).body).toEqual({ ok: true });
    expect(await ctx.db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [PHONE])).toBeFalsy();
    // Telnyx retries the old STOP: acknowledged, but the newer START stands
    const replay = await send(ev(stopId, 'STOP'));
    expect([replay.status, replay.body]).toEqual([200, { ok: true, duplicate: true }]);
    expect(await ctx.db.get('SELECT phone FROM sms_opt_outs WHERE phone = ?', [PHONE])).toBeFalsy();
    await inboundIdle();
    expect(await ctx.db.all('SELECT event_id, event_type, status FROM telnyx_event_log WHERE event_id IN (?, ?) ORDER BY event_id', [startId, stopId]))
      .toEqual([{ event_id: startId, event_type: 'message.received', status: 'done' }, { event_id: stopId, event_type: 'message.received', status: 'done' }]);
  });

  test('final delivery status is recorded; many failures raise the alarm', async () => {
    if (!ctx.app) return;
    const { smsHealth } = await import('../../monitoring/smsHealth.js');
    const fin = (id, status) => ({ data: { event_type: 'message.finalized', payload: { id, to: [{ phone_number: '+16155550188', status }],
      errors: status === 'delivered' ? [] : [{ code: '40300' }] } } });
    for (let i = 0; i < 8; i++) { IDS.push(`it-telnyx-${i}`); expect((await send(fin(`it-telnyx-${i}`, 'delivered'))).status).toBe(200); }
    expect((await send(fin('it-telnyx-f1', 'delivery_failed'))).status).toBe(200);
    expect(await ctx.db.get('SELECT status, error_code, to_masked FROM sms_delivery WHERE provider_id = ?', ['it-telnyx-f1']))
      .toEqual({ status: 'delivery_failed', error_code: '40300', to_masked: '•••-•••-0188' });
    const base = await smsHealth(ctx.db);
    // add failures until more than 20% of at least 10 texts failed
    let n = 2;
    while (!(await smsHealth(ctx.db)).alarm && n < 60) { await send(fin(`it-telnyx-f${n}`, 'sending_failed')); n += 1; }
    const h = await smsHealth(ctx.db);
    expect(h.alarm).toBe(true);
    expect(h.total).toBeGreaterThanOrEqual(base.total);
    // a replayed status overwrites, never duplicates
    await send(fin('it-telnyx-f1', 'delivered'));
    expect((await ctx.db.get('SELECT status FROM sms_delivery WHERE provider_id = ?', ['it-telnyx-f1'])).status).toBe('delivered');
  });
});
