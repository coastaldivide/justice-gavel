/**
 * staging_guard.test.js — staging can never text / e-mail real people, and the staging
 * test-client header (smoke test / route sweep) works on staging only (docs/STAGING.md).
 */
import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { sendSms, smsRecipientAllowed, stagingAllowedPhones } from '../services/sms.js';
import { sendEmail, emailRecipientAllowed, stagingAllowedEmails } from '../services/email.js';
import { stagingTestClient, stagingTestClientIp } from '../middleware/stagingTestClient.js';
import { checkAppEnv } from '../config.js';
import { envReport } from '../../scripts/lib/envReport.mjs';
import { redact } from '../utils/redact.js';
import { scrubSentryEvent as scrubEvent } from '../instrument.js';

const KEY = 'k'.repeat(40);
const KEYS = ['APP_ENV', 'STAGING_ALLOWED_PHONES', 'STAGING_ALLOWED_EMAILS', 'STAGING_TEST_KEY',
  'TELNYX_API_KEY', 'TELNYX_FROM_NUMBER', 'TELNYX_API_BASE', 'RESEND_API_KEY'];
let saved;
beforeEach(() => { saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]])); });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('staging outbound guard — texts', () => {
  it('allow-list parsing: E.164 normalised, junk dropped', () => {
    expect([...stagingAllowedPhones('+16155550100, (615) 555-0101 ,junk,')]).toEqual(['+16155550100', '+16155550101']);
    expect(stagingAllowedPhones('').size).toBe(0);
  });

  it('outside staging every number is allowed (production unchanged)', () => {
    for (const APP_ENV of ['production', 'test', 'development', undefined]) {
      expect(smsRecipientAllowed('+16155550199', { APP_ENV, STAGING_ALLOWED_PHONES: '' })).toBe(true);
    }
  });

  it('on staging only listed numbers; an empty list allows nobody', () => {
    const env = { APP_ENV: 'staging', STAGING_ALLOWED_PHONES: '+16155550100' };
    expect(smsRecipientAllowed('615-555-0100', env)).toBe(true);
    expect(smsRecipientAllowed('+16155550199', env)).toBe(false);
    expect(smsRecipientAllowed('+16155550100', { APP_ENV: 'staging' })).toBe(false);
  });

  it('sendSms on staging: unlisted → skipped without a request; listed → sent', async () => {
    const got = [];
    const srv = http.createServer((req, res) => {
      let d = ''; req.on('data', c => { d += c; });
      req.on('end', () => { got.push(JSON.parse(d)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":{"id":"m1"}}'); });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    Object.assign(process.env, { APP_ENV: 'staging', STAGING_ALLOWED_PHONES: '+16155550100', TELNYX_API_KEY: 'K', TELNYX_FROM_NUMBER: '+16155550000', TELNYX_API_BASE: `http://127.0.0.1:${srv.address().port}` });
    try {
      await expect(sendSms({ to: '+16155550199', body: 'x' })).resolves.toEqual({ skipped: true, reason: 'staging_recipient_not_allowed' });
      expect(got).toHaveLength(0);
      await expect(sendSms({ to: '(615) 555-0100', body: 'hi' })).resolves.toEqual({ ok: true, id: 'm1' });
      expect(got.map(g => g.to)).toEqual(['+16155550100']);
      process.env.APP_ENV = 'production';     // production: no allow-list applies
      await expect(sendSms({ to: '+16155550199', body: 'x' })).resolves.toEqual({ ok: true, id: 'm1' });
    } finally { await new Promise(r => srv.close(r)); }
  });
});

describe('staging outbound guard — e-mail', () => {
  it('allow-list: exact addresses and @domains', () => {
    const l = stagingAllowedEmails('You@Mail.example.org, @yourcompany.com, nonsense');
    expect([...l.addresses]).toEqual(['you@mail.example.org']);
    expect([...l.domains]).toEqual(['yourcompany.com']);
    const env = { APP_ENV: 'staging', STAGING_ALLOWED_EMAILS: 'you@mail.example.org,@yourcompany.com' };
    expect(emailRecipientAllowed('YOU@mail.example.org', env)).toBe(true);
    expect(emailRecipientAllowed('anyone@yourcompany.com', env)).toBe(true);
    expect(emailRecipientAllowed('other@mail.example.org', env)).toBe(false);
    expect(emailRecipientAllowed('you+jg-demo@mail.example.org', env)).toBe(true);     // plus-address of a listed address
    expect(emailRecipientAllowed('other+you@mail.example.org', env)).toBe(false);
    expect(emailRecipientAllowed('x@notyourcompany.com', env)).toBe(false);
    expect(emailRecipientAllowed('smoke@example.com', { APP_ENV: 'staging' })).toBe(false);
    expect(emailRecipientAllowed('anyone@example.com', { APP_ENV: 'production' })).toBe(true);
  });

  it('send on staging drops unlisted recipients; none left → skipped, never throws', async () => {
    delete process.env.RESEND_API_KEY;       // log-only transport: the result shows who it would go to
    Object.assign(process.env, { APP_ENV: 'staging', STAGING_ALLOWED_EMAILS: '@yourcompany.com' });
    await expect(sendEmail({ to: 'smoke@example.com', subject: 's', text: 't' })).resolves.toEqual({ skipped: true, reason: 'staging_recipient_not_allowed' });
    const r = await sendEmail({ to: ['a@yourcompany.com', 'b@example.com'], subject: 's', text: 't' });
    expect(r.to).toEqual(['a@yourcompany.com']);
    process.env.APP_ENV = 'test';
    const p = await sendEmail({ to: 'b@example.com', subject: 's', text: 't' });
    expect(p.to).toBe('b@example.com');
  });
});

describe('staging test-client header', () => {
  const H = (key, ip) => ({ 'x-staging-test-key': key, 'x-test-client-ip': ip });
  const STG = { APP_ENV: 'staging', NODE_ENV: 'production', STAGING_TEST_KEY: KEY };

  it('staging + right key + valid IP → that IP', () => {
    expect(stagingTestClientIp(H(KEY, '10.9.8.7'), STG)).toBe('10.9.8.7');
    expect(stagingTestClientIp(H(KEY, '2001:db8::1'), STG)).toBe('2001:db8::1');
  });

  it('inert outside staging, with a wrong / missing / short key, or a bad IP', () => {
    expect(stagingTestClientIp(H(KEY, '10.9.8.7'), { ...STG, APP_ENV: 'production' })).toBeNull();
    expect(stagingTestClientIp(H(KEY, '10.9.8.7'), { ...STG, APP_ENV: undefined })).toBeNull();
    expect(stagingTestClientIp(H(KEY.slice(1) + 'x', '10.9.8.7'), STG)).toBeNull();
    expect(stagingTestClientIp(H(undefined, '10.9.8.7'), STG)).toBeNull();
    expect(stagingTestClientIp(H('short', '10.9.8.7'), { ...STG, STAGING_TEST_KEY: 'short' })).toBeNull();
    expect(stagingTestClientIp(H(KEY, '10.9.8.7'), { ...STG, STAGING_TEST_KEY: '' })).toBeNull();
    for (const bad of ['999.1.1.1', 'localhost', '10.0.0.1, 10.0.0.2', '', 'x'.repeat(60)]) {
      expect(stagingTestClientIp(H(KEY, bad), STG)).toBeNull();
    }
  });

  function app(env) {
    const a = express();
    a.set('trust proxy', 1);
    a.use(stagingTestClient({ env }));
    a.get('/ip', (req, res) => res.json({ ip: req.ip, key: req.headers['x-staging-test-key'] ?? null, tip: req.headers['x-test-client-ip'] ?? null }));
    return a;
  }

  it('middleware: staging overrides req.ip and strips both headers', async () => {
    const r = await request(app(STG)).get('/ip').set('X-Forwarded-For', '203.0.113.7').set('X-Staging-Test-Key', KEY).set('X-Test-Client-Ip', '10.1.2.3');
    expect(r.body).toEqual({ ip: '10.1.2.3', key: null, tip: null });
  });

  it('middleware: production ignores the headers (req.ip from the proxy) and still strips them', async () => {
    const r = await request(app({ ...STG, APP_ENV: 'production' })).get('/ip').set('X-Forwarded-For', '203.0.113.7').set('X-Staging-Test-Key', KEY).set('X-Test-Client-Ip', '10.1.2.3');
    expect(r.body).toEqual({ ip: '203.0.113.7', key: null, tip: null });
    const w = await request(app(STG)).get('/ip').set('X-Forwarded-For', '203.0.113.7').set('X-Staging-Test-Key', 'wrong'.repeat(10)).set('X-Test-Client-Ip', '10.1.2.3');
    expect(w.body.ip).toBe('203.0.113.7');
  });

  it('the key never reaches logs or Sentry', () => {
    expect(redact({ 'x-staging-test-key': KEY, 'x-test-client-ip': '10.1.2.3' })).toEqual({ 'x-staging-test-key': '[REDACTED]', 'x-test-client-ip': '[REDACTED]' });
    const ev = scrubEvent({ request: { url: '/x', headers: { 'x-staging-test-key': KEY, 'x-test-client-ip': '10.1.2.3', accept: 'a' } } });
    expect(ev.request.headers).toEqual({ accept: 'a' });
  });

  it('check-env fails on STAGING_TEST_KEY in production and on a short key; boot only warns', () => {
    const base = { NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(40), JWT_REFRESH_SECRET: 'r'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(64), DATABASE_URL: 'postgres://x' };
    expect(envReport({ ...base, APP_ENV: 'production', STAGING_TEST_KEY: KEY }).errors.join(' ')).toMatch(/STAGING_TEST_KEY is set in production/);
    expect(envReport({ ...base, APP_ENV: 'staging', STAGING_TEST_KEY: 'short' }).errors.join(' ')).toMatch(/at least 32/);
    const ok = envReport({ ...base, APP_ENV: 'staging', STAGING_TEST_KEY: KEY, STAGING_ALLOWED_PHONES: '+16155550100', STAGING_ALLOWED_EMAILS: '@x.com' });
    expect(ok.errors).toEqual([]);
    expect(ok.staging).toEqual({ allowedPhones: 1, allowedEmails: 1, testKey: true });
    expect(envReport({ ...base, APP_ENV: 'staging', STAGING_ALLOWED_PHONES: '6155550100' }).errors.join(' ')).toMatch(/E\.164/);
    const boot = checkAppEnv({ NODE_ENV: 'production', APP_ENV: 'production', STAGING_TEST_KEY: KEY });
    expect(boot.errors).toEqual([]);
    expect(boot.warnings.join(' ')).toMatch(/STAGING_TEST_KEY/);
  });
});
