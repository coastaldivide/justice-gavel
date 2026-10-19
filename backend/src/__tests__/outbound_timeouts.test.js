/**
 * outbound_timeouts.test.js — checklist item 27: every outside call has a
 * timeout, and transient failures are retried where that is safe.
 *
 * Behaviour (utils/http.js fetchWithTimeout, services/aiClient.js) against a
 * local server that hangs / fails:
 *   - a hung service is abandoned after timeoutMs (ETIMEDOUT), also while the
 *     body is being read;
 *   - 503/429 are retried with backoff (Retry-After honoured) and then
 *     succeed; nothing is retried when retries = 0 or after the caller aborts;
 *   - anthropicFetch retries an overloaded (529) AI call and meters it.
 * Static guard: no `fetch(` anywhere in src/ (outside utils/http.js) without
 * a signal, every Anthropic SDK client is built in aiClient.js with a timeout,
 * and every Stripe client sets a timeout.
 *
 * Before: 21 fetch calls (AI, Whisper, Daily.co, Coinbase, OAuth token
 * exchange, DMS/CalDAV/practice-management, the feedback webhook) had no
 * timeout at all; Resend e-mail and the Anthropic SDK used library defaults
 * (none / 10 min).
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fetchWithTimeout } from '../utils/http.js';

const SRC = decodeURIComponent(new URL('../', import.meta.url).pathname);

let server, base;
const hits = {};
beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    const n = hits[req.url];
    if (req.url === '/hang') return;                                   // never answers
    if (req.url === '/slow-body') { res.writeHead(200); res.write('{"a":'); return; } // body never ends
    if (req.url === '/flaky') {
      if (n < 3) { res.writeHead(503, { 'Retry-After': '0' }); return res.end('busy'); }
      return res.end(JSON.stringify({ ok: true, n }));
    }
    if (req.url === '/always503') { res.writeHead(503); return res.end('no'); }
    if (req.url === '/v1/messages') {
      if (n === 1) { res.writeHead(529); return res.end('{"type":"error","error":{"type":"overloaded_error"}}'); }
      return res.end(JSON.stringify({ model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } }));
    }
    res.end('ok');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
});

describe('fetchWithTimeout', () => {
  test('a hung service is abandoned after timeoutMs with ETIMEDOUT', async () => {
    const t0 = Date.now();
    await expect(fetchWithTimeout(`${base}/hang`, {}, { timeoutMs: 300 })).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test('the timeout also covers a body that never finishes', async () => {
    const res = await fetchWithTimeout(`${base}/slow-body`, {}, { timeoutMs: 300 });
    await expect(res.text()).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });

  test('transient 503s are retried (Retry-After honoured) and then succeed', async () => {
    const res = await fetchWithTimeout(`${base}/flaky`, {}, { timeoutMs: 1000, retries: 3, retryDelayMs: 10 });
    expect(res.status).toBe(200);
    expect((await res.json()).n).toBe(3);
  });

  test('no retry when retries = 0; retries stop at the limit', async () => {
    const one = await fetchWithTimeout(`${base}/always503`, {}, { timeoutMs: 1000 });
    expect(one.status).toBe(503);
    const before = hits['/always503'];
    const many = await fetchWithTimeout(`${base}/always503`, {}, { timeoutMs: 1000, retries: 2, retryDelayMs: 5 });
    expect(many.status).toBe(503);
    expect(hits['/always503'] - before).toBe(3);
  });

  test('a caller abort is not retried and not reported as a timeout', async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const p = fetchWithTimeout(`${base}/hang`, { signal: ctrl.signal }, { timeoutMs: 5000, retries: 3 });
    await expect(p).rejects.not.toMatchObject({ code: 'ETIMEDOUT' });
  });
});

describe('anthropicFetch', () => {
  test('retries an overloaded (529) completion, then returns it', async () => {
    process.env.ANTHROPIC_BASE_URL = base;
    const { anthropicFetch } = await import('../services/aiClient.js');
    const res = await anthropicFetch({ body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 5, messages: [] }) },
      { route: 'test', fetchImpl: (url, init) => fetch(url.replace(/^https?:\/\/[^/]+/, base), init) });
    expect(res.status).toBe(200);
    expect((await res.json()).content[0].text).toBe('hi');
    expect(hits['/v1/messages']).toBe(2);
  });
});

describe('static guard: no outbound call without a timeout', () => {
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'node_modules') walk(p); }
      else if (p.endsWith('.js')) files.push(p);
    }
  })(SRC);

  // Comments may mention fetch(); only code counts.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l)).join('\n');

  // Find the argument list of each call `name(`…`)` and test it.
  function calls(rawSrc, name) {
    const src = code(rawSrc);
    const out = [];
    const re = new RegExp(`(?<![\\w.])${name}\\(`, 'g');
    let m;
    while ((m = re.exec(src))) {
      let depth = 0, j = m.index + name.length, q = null;
      for (; j < src.length; j++) {
        const c = src[j];
        if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === '`') { q = c; continue; }
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) break;
      }
      out.push({ line: src.slice(0, m.index).split('\n').length, args: src.slice(m.index, j + 1) });
    }
    return out;
  }

  test('every bare fetch() passes an abort signal (everything else uses fetchWithTimeout / anthropicFetch)', () => {
    const bad = [];
    for (const f of files) {
      const rel = path.relative(SRC, f);
      if (rel === path.join('utils', 'http.js')) continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const c of calls(src, 'fetch')) {
        if (!/signal\s*:/.test(c.args)) bad.push(`${rel}:${c.line}`);
      }
      for (const c of calls(src, 'fetchImpl')) {
        if (!/signal\s*:/.test(c.args)) bad.push(`${rel}:${c.line} (fetchImpl)`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('Anthropic SDK clients are only built in aiClient.js (timeout + retries); Stripe clients set a timeout', () => {
    const sdk = [], stripe = [];
    for (const f of files) {
      const rel = path.relative(SRC, f);
      const src = fs.readFileSync(f, 'utf8');
      for (const c of calls(src, 'new Anthropic')) {
        // app code: only aiClient.js; operator CLIs (src/scripts) must still set a timeout
        if (rel !== path.join('services', 'aiClient.js') && !(rel.startsWith('scripts') && /timeout\s*:/.test(c.args))) sdk.push(`${rel}:${c.line}`);
      }
      for (const c of calls(src, 'new Stripe')) {
        if (!/timeout\s*:/.test(c.args) && !/signature_verification_only/.test(c.args)) stripe.push(`${rel}:${c.line}`);
      }
    }
    expect(sdk).toEqual([]);
    expect(stripe).toEqual([]);
    const client = fs.readFileSync(path.join(SRC, 'services/aiClient.js'), 'utf8');
    expect(client).toMatch(/new Anthropic\(\{[^}]*timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES/);
    const email = fs.readFileSync(path.join(SRC, 'services/email.js'), 'utf8');
    expect(email).toMatch(/signal: AbortSignal\.timeout\(EMAIL_TIMEOUT_MS\)/);
  });
});
