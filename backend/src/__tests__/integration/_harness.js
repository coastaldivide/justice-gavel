/**
 * _harness.js — shared setup for the route-integration suites (*.int.test.js).
 *
 * These suites exercise the REAL Express app (src/app.js) over supertest against
 * a REAL migrated Postgres database. They run only when TEST_DATABASE_URL points
 * at a database with every supabase/migrations/*.sql applied (CI's jg_ci), and
 * are skipped otherwise — exactly like the existing PG-gated suites
 * (arrest_visibility.test.js, alerts_takedown_pg.test.js).
 *
 * Isolation model: all suites share the one migrated database (so they can run
 * in parallel with each other and with the other PG-gated suites, which connect
 * to the same DB directly). Every row a suite creates is namespaced by a unique
 * TAG (users get `<tag>-<n>@it.example.test` emails) and removed in afterAll.
 * Suites never modify or delete the verified lawyer / bail-agent seed rows and
 * never truncate anything.
 *
 * Owner constraint honoured here: payments stay DISABLED (the global test env
 * sets a fake STRIPE_SECRET so unit tests can construct clients; these suites
 * delete it before importing the app so billing/consultations return the real
 * 503 payments_unavailable the production deployment returns without keys).
 *
 * Anthropic is never called for real: initSuite() starts a local mock server
 * on 127.0.0.1:<random port> and points ANTHROPIC_BASE_URL at it BEFORE app.js
 * (and therefore utils/ai.js) is imported. The mock speaks the documented API
 * (scripts/anthropic-mock-lib.mjs: structured outputs, thinking blocks, cache
 * usage, refusals + server-side fallback, count_tokens, 400s for bad requests).
 * Tests steer it with ctx.anthropic.replyText / status / mode / json / category /
 * refuseModels / citeMode (auto | none | foreign | blocks) / blocks, and (AI step 3) Message Batches
 * through ctx.anthropic.batches with ctx.anthropic.extra = { batchPolls, batchErrors, batchJson,
 * pages, fetchUrls, rogueFetch }.
 */
import { randomBytes } from 'crypto';
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import { freshState, messageResponse, streamEvents, countTokensResponse, requestProblem, createBatchStore, batchRoute, createFileStore, filesRoute } from '../../../scripts/anthropic-mock-lib.mjs';

export const PG_URL = process.env.TEST_DATABASE_URL || '';

/**
 * Directory rows a suite inserts for itself carry this marker in source_id.
 * Checksums of the verified directory leave them out, so suites that insert
 * (and remove) fixtures can run in parallel with suites that prove the real
 * rows never change.
 */
export const FIXTURE_MARK = 'JGTEST';

/** md5 + count of the verified lawyer / bail-agent rows (fixtures excluded). */
export async function providerChecksum(db) {
  const notFixture = `WHERE COALESCE(t.source_id, '') NOT ILIKE '%${FIXTURE_MARK}%'`;
  const l = await db.get(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) AS h, COUNT(*) AS n FROM lawyers t ${notFixture}`);
  const b = await db.get(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) AS h, COUNT(*) AS n FROM bail_agents t ${notFixture}`);
  return `${l.n}:${l.h}/${b.n}:${b.h}`;
}
export const describeIntegration = PG_URL ? describe : describe.skip;

/** Tables that may hold rows keyed by user_id for users a suite created. */
const USER_SCOPED_TABLES = [
  'refresh_tokens', 'password_resets', 'user_disclaimer_acceptance',
  'tos_acceptance_log', 'push_tokens', 'scheduled_pushes', 'chat_sessions',
  'chat_messages', 'ai_jobs', 'message_attachments', 'case_events',
  'case_status_history', 'case_family_access', 'saved_lawyers',
  'consultation_bookings', 'callback_requests', 'reviews', 'subscriptions',
  'expungement_check_log', 'audit_log', 'attorney_profiles', 'motions',
];

export function initSuite({ anthropicMock = false } = {}) {
  const TAG = `it${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  let seq = 0;

  const ctx = {
    tag: TAG,
    app: null,
    db: null,
    /** supertest agent factory: ctx.request().get('/api/...') */
    request: () => request(ctx.app),
    attachmentsDir: null,
    anthropic: { server: null, port: null, requests: [], replyText: 'MOCK REPLY: general legal information, not legal advice.', status: 200, mode: 'ok', json: null,
      // Message Batches + web fetch (AI step 3): a batch store and the web-fetch / batch steering fields
      batches: createBatchStore(), extra: {},
      // Files API (AI step 4): an in-memory file store; image / document file_id blocks resolve against it
      files: createFileStore() },
    _cleanups: [],
    /** Register extra cleanup SQL to run before the generic user purge. */
    addCleanup(fn) { ctx._cleanups.push(fn); },
  };

  beforeAll(async () => {
    if (!PG_URL) return;

    // Payments must be disabled-by-default (production has no Stripe key yet).
    delete process.env.STRIPE_SECRET;
    delete process.env.STRIPE_SECRET_KEY;

    // Attachments: a writable local dir so upload/download round-trips work.
    ctx.attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jg-it-attach-'));
    process.env.ATTACHMENTS_STORAGE = 'local';
    process.env.ATTACHMENTS_DIR = ctx.attachmentsDir;

    if (anthropicMock) {
      ctx.anthropic.server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', c => { chunks.push(c); });
        req.on('end', () => {
          const raw = Buffer.concat(chunks);
          const data = String(req.headers['content-type'] || '').startsWith('multipart/') ? '' : raw.toString('utf8');
          let body = null;
          try { body = JSON.parse(data); } catch { /* keep null */ }
          ctx.anthropic.requests.push({ path: req.url, method: req.method, headers: req.headers, body, bytes: raw.length });
          {
            const fr = filesRoute(ctx.anthropic.files, req.method, req.url, raw, req.headers);
            if (fr) { res.writeHead(fr.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(fr.json)); }
          }
          {
            const a0 = ctx.anthropic;
            const st = freshState({ text: a0.replyText, mode: a0.mode || 'ok', json: a0.json ?? null, ...(a0.extra || {}) });
            const br = batchRoute(a0.batches, req.method, req.url, body, req.headers, st, `http://127.0.0.1:${a0.port}`);
            if (br) {
              if (br.text !== undefined) { res.writeHead(br.status, { 'Content-Type': 'application/binary' }); return res.end(br.text); }
              res.writeHead(br.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(br.json));
            }
          }
          if (req.url.endsWith('/count_tokens')) {
            const r = countTokensResponse(body, { files: ctx.anthropic.files });
            res.writeHead(r.status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(r.body));
          }
          if (ctx.anthropic.status !== 200) {
            res.writeHead(ctx.anthropic.status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'mock failure' } }));
          }
          const a = ctx.anthropic;
          const state = freshState({ text: a.replyText, mode: a.mode || 'ok', json: a.json ?? null,
            category: a.category ?? 'general_harms', refuseModels: a.refuseModels ?? null,
            citeMode: a.citeMode || 'auto', blocks: a.blocks ?? null, ...(a.extra || {}), files: a.files });
          if (body?.stream) {
            const problem = requestProblem(body, req.headers);
            if (problem) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: problem } }));
            }
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            for (const e of streamEvents(body, state)) {
              if (e.drop) { req.socket.destroy(); return; }
              if (e.error) { res.write(`event: error\ndata: ${JSON.stringify(e.error)}\n\n`); break; }
              res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
            }
            return res.end();
          }
          const r = messageResponse(body, state, req.headers);
          res.writeHead(r.status, { 'Content-Type': 'application/json', ...r.headers });
          res.end(JSON.stringify(r.body));
        });
      });
      await new Promise((resolve, reject) => {
        ctx.anthropic.server.listen(0, '127.0.0.1', resolve).on('error', reject);
      });
      ctx.anthropic.port = ctx.anthropic.server.address().port;
      process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${ctx.anthropic.port}`;
    }

    // Point the app at the migrated database, THEN import it (utils/ai.js and
    // db/index.js read their env at first import / first call).
    process.env.DATABASE_URL = PG_URL;
    ctx.app = (await import('../../app.js')).default;
    const { getDb } = await import('../../db/index.js');
    ctx.db = await getDb();
  }, 120_000);

  afterAll(async () => {
    if (!PG_URL || !ctx.db) return;
    const db = ctx.db;
    // Suite-specific cleanup first (rows not keyed by user_id).
    for (const fn of ctx._cleanups.reverse()) {
      try { await fn(db, TAG); } catch { /* best effort */ }
    }
    try {
      const users = await db.all('SELECT id FROM users WHERE email LIKE ?', [`${TAG}-%@it.example.test`]);
      const ids = users.map(u => Number(u.id));
      if (ids.length) {
        const inList = ids.map(() => '?').join(',');
        const purge = async (sql, params) => {
          try { await db.run(sql, params); } catch { /* table/column may not exist */ }
        };
        await purge(`DELETE FROM case_messages WHERE sender_id IN (${inList}) OR case_id IN (SELECT id FROM cases WHERE user_id IN (${inList}))`, [...ids, ...ids]);
        await purge(`DELETE FROM messages WHERE sender_id IN (${inList}) OR recipient_id IN (${inList})`, [...ids, ...ids]);
        for (const t of USER_SCOPED_TABLES) {
          await purge(`DELETE FROM ${t} WHERE user_id IN (${inList})`, ids);
        }
        await purge(`DELETE FROM cases WHERE user_id IN (${inList})`, ids);
        await purge(`DELETE FROM users WHERE id IN (${inList})`, ids);
      }
    } catch { /* best effort */ }

    const { closeDb } = await import('../../db/index.js');
    await closeDb().catch(() => {});
    if (ctx.anthropic.server) await new Promise(r => ctx.anthropic.server.close(r));
    if (ctx.attachmentsDir) fs.rmSync(ctx.attachmentsDir, { recursive: true, force: true });
  }, 60_000);

  /**
   * Register a user through the real route. Returns
   * { token, refreshToken, user, email, headers } — headers is ready to pass
   * to supertest's .set().
   */
  ctx.register = async (overrides = {}) => {
    const email = overrides.identifier || `${TAG}-${++seq}@it.example.test`;
    const res = await request(ctx.app).post('/api/auth/register').send({
      identifier: email,
      password: 'CorrectHorse9!',
      ...overrides,
    });
    if (res.status !== 201) {
      throw new Error(`test register failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return { ...res.body, email, password: overrides.password || 'CorrectHorse9!', headers: { Authorization: `Bearer ${res.body.token}` } };
  };

  /** Accept the current AI disclaimer for a registered user. */
  ctx.acceptDisclaimer = async (user) => {
    const res = await request(ctx.app).post('/api/auth/disclaimer/accept').set(user.headers).send({});
    if (res.status !== 200) throw new Error(`disclaimer accept failed: ${res.status}`);
    return res.body;
  };

  /** Poll GET /api/jobs/:id until the job settles (done/failed) or times out. */
  ctx.pollJob = async (user, jobId, { timeoutMs = 20_000, intervalMs = 100 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const res = await request(ctx.app).get(`/api/jobs/${jobId}`).set(user.headers);
      last = res;
      if (res.status === 200 && ['done', 'failed'].includes(res.body.status)) return res;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`job ${jobId} did not settle in ${timeoutMs}ms (last: ${last && JSON.stringify(last.body)})`);
  };

  return ctx;
}
