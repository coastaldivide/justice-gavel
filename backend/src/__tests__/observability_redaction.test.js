/**
 * observability_redaction.test.js — checklist items 15 + 34.
 *
 *  15  Nothing secret or personal reaches a log line, a Sentry event or an
 *      alert: passwords, tokens, API keys, Authorization headers, e-mail
 *      addresses, phone numbers are scrubbed (utils/redact.js), in text AND
 *      JSON log formats, in plain strings, structured fields and errors.
 *  34  Production logs are one JSON object per line, and every line written
 *      while a request is handled carries that request's id.
 *
 * Before: logger.js wrote whatever it was given (`[email] … → jane@x.com`,
 * `Payment link sent to +1615…`), JSON lines had no request_id, Sentry's
 * beforeSend only cleared six top-level body keys and kept query strings and
 * breadcrumbs, and alert e-mails/webhooks carried raw `extras`.
 */
import { jest } from '@jest/globals';
import { spawnSync } from 'child_process';
import http from 'http';
import request from 'supertest';
import { redact, redactString, stripQuery } from '../utils/redact.js';
import logger, { runWithRequestContext, currentRequestId } from '../utils/logger.js';
import { scrubSentryEvent } from '../instrument.js';

const BACKEND = decodeURIComponent(new URL('../../', import.meta.url).pathname);

const SECRET_LINE = 'login failed for jane.doe@example.com from (615) 555-0100 '
  + 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.c2lnbmF0dXJlLXZhbHVl key sk-ant-api03-ABCDEFGHIJKLMNOP '
  + 'stripe sk_live_51ABCDEFGHIJ password=hunter2 ExponentPushToken[xxxxyyyyzzzz]';
const LEAKS = [/jane\.doe/, /555-0100/, /eyJhbGci/, /sk-ant-api03/, /sk_live_51/, /hunter2/, /xxxxyyyyzzzz/];

describe('redact()', () => {
  test('free text: e-mail, phone, bearer, JWT, provider keys, key=value secrets, push tokens', () => {
    const out = redactString(SECRET_LINE);
    for (const re of LEAKS) expect(out).not.toMatch(re);
    expect(out).toContain('***@example.com');     // domain kept for correlation
    expect(out).toContain('[phone]');
  });

  test('structured fields: secret and PII keys replaced, counters kept, nested + arrays + cycles', () => {
    const a = { userId: 7, password: 'p', refreshToken: 'r', 'x-api-key': 'k', email: 'a@b.co', input_tokens: 12,
      nested: { phone: '6155550100', note: 'call me at 615-555-0100', list: [{ token: 't' }] } };
    a.self = a;
    const r = redact(a);
    expect(r).toMatchObject({ userId: 7, password: '[REDACTED]', refreshToken: '[REDACTED]', 'x-api-key': '[REDACTED]', email: '[REDACTED]', input_tokens: 12 });
    expect(r.nested.phone).toBe('[REDACTED]');
    expect(r.nested.note).toBe('call me at [phone]');
    expect(r.nested.list[0].token).toBe('[REDACTED]');
    expect(r.self).toBe('[Circular]');
    expect(stripQuery('/api/arrests/search?name=Jo%20Doe')).toBe('/api/arrests/search');
  });

  test('ids, dates, uuids and money are not mistaken for phone numbers', () => {
    const s = 'case 12345 on 2026-10-18 req 550e8400-e29b-41d4-a716-446655440000 $2,400.00 at 12:30:45';
    expect(redactString(s)).toBe(s);
  });
});

describe('logger (text format, as in tests/dev)', () => {
  test('scrubs strings, errors and objects, and stamps the request id', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runWithRequestContext({ requestId: 'req-abc' }, async () => {
        await Promise.resolve();                      // context survives awaits
        expect(currentRequestId()).toBe('req-abc');
        logger.error(SECRET_LINE, new Error('db said password=topsecret'), { email: 'z@z.io', phone: '6155550199' });
      });
      const line = spy.mock.calls.map(c => c.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n');
      for (const re of [...LEAKS, /topsecret/, /z@z\.io/, /6155550199/]) expect(line).not.toMatch(re);
      expect(line).toContain('[req req-abc]');
      expect(currentRequestId()).toBeNull();
    } finally { spy.mockRestore(); }
  });
});

describe('logger (JSON format, production default)', () => {
  test('one JSON object per line with request_id + merged structured fields, all scrubbed', () => {
    const script = `
      import('./src/utils/logger.js').then(async ({ default: l, runWithRequestContext }) => {
        await runWithRequestContext({ requestId: 'rid-9' }, async () => {
          await new Promise(r => setTimeout(r, 1));
          l.warn({ userId: 3, password: 'pw', email: 'q@q.io' }, ${JSON.stringify(SECRET_LINE)});
        });
        l.info('outside a request');
      });`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: BACKEND, env: { ...process.env, NODE_ENV: 'production', LOG_FORMAT: '', LOG_LEVEL: 'info' }, encoding: 'utf8',
    });
    const both = `${r.stdout}\n${r.stderr}`;
    const lines = both.split('\n').filter(l => l.startsWith('{'));
    expect(lines.length).toBeGreaterThan(0);
    const parsed = lines.map(l => JSON.parse(l));
    const warn = parsed.find(p => p.level === 'warn');
    const info = parsed.find(p => p.level === 'info');
    expect(warn).toMatchObject({ request_id: 'rid-9', userId: 3, password: '[REDACTED]', email: '[REDACTED]', service: 'justice-gavel-api' });
    for (const re of LEAKS) expect(JSON.stringify(warn)).not.toMatch(re);
    expect(info.request_id).toBeUndefined();
  }, 20_000);
});

describe('app: request id per request', () => {
  test('X-Request-ID is generated or echoed (when well-formed) and returned on errors', async () => {
    const { default: app } = await import('../app.js');
    const a = await request(app).get('/api/definitely-not-a-route');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app).get('/api/definitely-not-a-route').set('X-Request-ID', 'client-req-42');
    expect(b.headers['x-request-id']).toBe('client-req-42');
    const c = await request(app).get('/api/definitely-not-a-route').set('X-Request-ID', 'bad id with spaces');
    expect(c.headers['x-request-id']).not.toBe('bad id with spaces');
  }, 60_000);
});

describe('Sentry beforeSend', () => {
  test('drops bodies, cookies, auth headers and query strings; scrubs messages, exceptions, extras, breadcrumbs', () => {
    const ev = scrubSentryEvent({
      message: SECRET_LINE,
      request: { url: 'https://api.x/api/arrests/search?name=Jo', query_string: 'name=Jo', data: { password: 'x', name: 'Jo' },
        cookies: { s: '1' }, headers: { authorization: 'Bearer abc.def.ghi', 'x-admin-key': 'k', 'user-agent': 'ua' } },
      user: { id: 5, email: 'u@u.io', ip_address: '1.2.3.4' },
      exception: { values: [{ value: 'failed for jane.doe@example.com' }] },
      extra: { refreshToken: 'r', phone: '6155550100', ok: 1 },
      breadcrumbs: [{ message: 'GET /x?email=a@b.co', data: { url: 'https://h/p?token=1', password: 'p' } }],
    });
    const s = JSON.stringify(ev);
    for (const re of [...LEAKS, /u@u\.io/, /1\.2\.3\.4/, /abc\.def/, /name=Jo/, /"x-admin-key"/]) expect(s).not.toMatch(re);
    expect(ev.request.data).toBe('[Filtered]');
    expect(ev.request.url).toBe('https://api.x/api/arrests/search');
    expect(ev.user).toEqual({ id: 5 });
    expect(ev.extra).toEqual({ refreshToken: '[REDACTED]', phone: '[REDACTED]', ok: 1 });
    expect(ev.breadcrumbs[0].data.url).toBe('https://h/p');
    expect(ev.breadcrumbs[0].data.password).toBe('[REDACTED]');
  });
});

describe('alerts (errorNotifier) are scrubbed before they leave', () => {
  test('the webhook payload carries no PII or secrets', async () => {
    const bodies = [];
    const srv = http.createServer((req, res) => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => { bodies.push(d); res.end('ok'); }); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${srv.address().port}/hook`;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { notifyCritical } = await import('../monitoring/errorNotifier.js');
      await notifyCritical(`payment failed for jane.doe@example.com ${Date.now()}`, { code: `t-${Date.now()}`, customer_email: 'c@c.io', token: 'tok_123', note: 'call 615-555-0100' });
      const all = bodies.join('\n');
      expect(all).toContain('SEV-1');
      for (const re of [/jane\.doe/, /c@c\.io/, /tok_123/, /555-0100/]) expect(all).not.toMatch(re);
    } finally {
      spy.mockRestore();
      delete process.env.ALERT_WEBHOOK_URL;
      await new Promise(r => srv.close(r));
    }
  });
});

