#!/usr/bin/env node
/**
 * smoke-test.mjs — end-to-end smoke test for the Justice Gavel API.
 *
 * Usage:
 *   node scripts/smoke-test.mjs [baseUrl] [options]
 *
 *   baseUrl                 default http://localhost:4000
 *   --db-url <url>          Postgres URL used to verify rows were persisted
 *                           (default: $DATABASE_URL; DB checks are skipped if unset)
 *   --expect-db-down        only assert that /health returns 503 (server pointed at a bad DB)
 *   --anthropic-mock <port> start a mock Anthropic API on <port>. Start the server with
 *                           ANTHROPIC_API_KEY=<anything> ANTHROPIC_BASE_URL=http://127.0.0.1:<port>
 *                           and the AI checks verify the outgoing request (model, key).
 *                           Without this flag the AI check expects 503 ai_unavailable
 *                           (server started WITHOUT ANTHROPIC_API_KEY).
 *   --expect-model <id>     model the mock must receive (default claude-sonnet-4-6)
 *   --payments-live         Stripe is configured: skip the 503 payments_unavailable check
 *   --keep-user             do not delete the smoke-test user at the end
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */
import http from 'node:http';
import crypto from 'node:crypto';

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def;
};
const BASE = (argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:4000').replace(/\/+$/, '');
const DB_URL = opt('--db-url', process.env.DATABASE_URL || null);
const EXPECT_DB_DOWN = !!opt('--expect-db-down', false);
const MOCK_PORT = opt('--anthropic-mock', null);
const EXPECT_MODEL = opt('--expect-model', 'claude-sonnet-4-6');
const PAYMENTS_LIVE = !!opt('--payments-live', false);
const KEEP_USER = !!opt('--keep-user', false);

// ── tiny test harness ─────────────────────────────────────────────────────────
const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, note });
    console.log(`  ✔ ${name}${note ? `  (${note})` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: e.message });
    console.log(`  ✘ ${name}\n      ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function call(method, path, { body, token, headers = {}, raw } = {}) {
  const h = { Accept: 'application/json', ...headers };
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}
const brief = (r) => `${r.status} ${(r.text || '').slice(0, 200)}`;

// ── optional Postgres verification ────────────────────────────────────────────
let pool = null;
async function q(sql, params = []) {
  if (!DB_URL) return null;
  if (!pool) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
  }
  return (await pool.query(sql, params)).rows;
}

// ── optional mock Anthropic API ───────────────────────────────────────────────
const mockRequests = [];
let mockServer = null;
async function startMock(port) {
  mockServer = http.createServer((req, res) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(data); } catch { /* ignore */ }
      mockRequests.push({ path: req.url, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_mock', type: 'message', role: 'assistant', model: body?.model,
        content: [{ type: 'text', text: 'MOCK REPLY: this is general legal information, not legal advice.' }],
        stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 12 },
      }));
    });
  });
  await new Promise((resolve, reject) => { mockServer.listen(Number(port), '127.0.0.1', resolve).on('error', reject); });
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nJustice Gavel smoke test → ${BASE}${DB_URL ? '  (DB checks on)' : '  (DB checks off)'}\n`);

  if (EXPECT_DB_DOWN) {
    await check('GET /health returns 503 when the database is unreachable', async () => {
      const r = await call('GET', '/health');
      assert(r.status === 503, `expected 503, got ${brief(r)}`);
      assert(r.json?.db === 'error', `expected db=error, got ${brief(r)}`);
      return 'db=error';
    });
    return finish();
  }

  if (MOCK_PORT) await startMock(MOCK_PORT);

  await check('GET /health → 200 with db ok', async () => {
    const r = await call('GET', '/health');
    assert(r.status === 200, `expected 200, got ${brief(r)}`);
    assert(r.json?.db === 'ok' && r.json?.ok === true, `db not ok: ${brief(r)}`);
    // The DB probe is cached (~5 s): an immediate second call must not re-query.
    const r2 = await call('GET', '/health');
    assert(r2.status === 200 && r2.json?.db_cached === true, `second /health not served from cache: ${brief(r2)}`);
    return `payments=${r.json?.features?.payments} ai=${r.json?.features?.ai}, cached probe ok`;
  });

  // Exact payload shape sent by frontend RegisterScreen.tsx
  const email = `smoke+${Date.now()}_${crypto.randomBytes(3).toString('hex')}@example.com`;
  const password = 'SmokeTest!' + crypto.randomBytes(4).toString('hex');
  let token = null, refreshToken = null, userId = null;

  await check('POST /api/auth/register (RegisterScreen payload)', async () => {
    const r = await call('POST', '/api/auth/register', {
      body: { identifier: email, password, displayName: 'Smoke Tester', isAttorney: false },
    });
    assert(r.status === 201 || r.status === 200, `expected 201, got ${brief(r)}`);
    assert(r.json?.token && r.json?.refreshToken && r.json?.user?.id, `missing token/user: ${brief(r)}`);
    token = r.json.token; refreshToken = r.json.refreshToken; userId = r.json.user.id;
    return `user ${userId}`;
  });

  await check('register duplicate → 409', async () => {
    const r = await call('POST', '/api/auth/register', { body: { identifier: email, password } });
    assert(r.status === 409, `expected 409, got ${brief(r)}`);
  });

  await check('register with invalid body → 400 (not 500)', async () => {
    const r = await call('POST', '/api/auth/register', { body: { identifier: email, password: 'short' } });
    assert(r.status === 400, `expected 400, got ${brief(r)}`);
  });

  await check('POST /api/auth/login {identifier,password}', async () => {
    const r = await call('POST', '/api/auth/login', { body: { identifier: email.toUpperCase(), password } });
    assert(r.status === 200 && r.json?.token, `expected 200 + token, got ${brief(r)}`);
    token = r.json.token; refreshToken = r.json.refreshToken;
  });

  await check('login with wrong password → 401', async () => {
    const r = await call('POST', '/api/auth/login', { body: { identifier: email, password: 'wrong-password-123' } });
    assert(r.status === 401, `expected 401, got ${brief(r)}`);
  });

  await check('GET /api/auth/me', async () => {
    const r = await call('GET', '/api/auth/me', { token });
    assert(r.status === 200, `expected 200, got ${brief(r)}`);
    assert(r.json?.id === userId && r.json?.email === email, `wrong user: ${brief(r)}`);
  });

  await check('refresh token rotation (single use)', async () => {
    const r1 = await call('POST', '/api/auth/refresh', { body: { refreshToken } });
    assert(r1.status === 200 && r1.json?.refreshToken && r1.json?.token, `rotate failed: ${brief(r1)}`);
    assert(r1.json.refreshToken !== refreshToken, 'refresh token was not rotated');
    const reuse = await call('POST', '/api/auth/refresh', { body: { refreshToken } });
    assert(reuse.status === 401, `reusing an old refresh token should be 401, got ${brief(reuse)}`);
    // reuse revokes all sessions → log in again for the rest of the run
    const l = await call('POST', '/api/auth/login', { body: { identifier: email, password } });
    assert(l.status === 200, `re-login failed: ${brief(l)}`);
    token = l.json.token; refreshToken = l.json.refreshToken;
  });

  await check('refresh with bearer access token (mobile app path)', async () => {
    const r = await call('POST', '/api/auth/refresh', { token, body: {} });
    assert(r.status === 200 && r.json?.token, `expected 200 + token, got ${brief(r)}`);
    token = r.json.token; refreshToken = r.json.refreshToken;
  });

  await check('AI chat before disclaimer → 451', async () => {
    const r = await call('POST', '/api/chat/ask', { token, body: { message: 'What are my rights?', sessionId: 'smoke-' + userId } });
    assert(r.status === 451, `expected 451, got ${brief(r)}`);
  });

  await check('disclaimer accept → status not required', async () => {
    const s0 = await call('GET', '/api/auth/disclaimer/status', { token });
    assert(s0.status === 200 && s0.json?.required === true, `expected required=true first, got ${brief(s0)}`);
    const a = await call('POST', '/api/auth/disclaimer/accept', { token, body: {} });
    assert(a.status === 200 && a.json?.accepted === true, `accept failed: ${brief(a)}`);
    const s1 = await call('GET', '/api/auth/disclaimer/status', { token });
    assert(s1.status === 200 && s1.json?.required === false, `still required: ${brief(s1)}`);
  });

  if (!MOCK_PORT) {
    await check('AI chat after disclaimer, no ANTHROPIC_API_KEY → 503 ai_unavailable', async () => {
      const r = await call('POST', '/api/chat/ask', { token, body: { message: 'What are my rights?', sessionId: 'smoke-' + userId } });
      assert(r.status === 503 && r.json?.error === 'ai_unavailable', `expected 503 ai_unavailable, got ${brief(r)}`);
    });
  } else {
    await check(`AI chat → request reaches Anthropic API with model ${EXPECT_MODEL}`, async () => {
      const r = await call('POST', '/api/chat/ask', { token, body: { message: 'What are my rights if arrested?', sessionId: 'smoke-' + userId } });
      assert(r.status === 200 && r.json?.jobId, `expected 200 + jobId, got ${brief(r)}`);
      let job = null;
      for (let i = 0; i < 40; i++) {
        await new Promise(res => { setTimeout(res, 250); });
        const j = await call('GET', `/api/jobs/${r.json.jobId}`, { token });
        assert(j.status === 200, `job poll failed: ${brief(j)}`);
        job = j.json;
        if (job.status === 'done' || job.status === 'failed') break;
      }
      assert(job?.status === 'done', `job not done: ${JSON.stringify(job)}`);
      assert(/MOCK REPLY/.test(job.result?.reply || ''), `unexpected reply: ${JSON.stringify(job.result)}`);
      const sent = mockRequests.find(m => m.path === '/v1/messages');
      assert(sent, 'mock Anthropic API received no /v1/messages request');
      assert(sent.body?.model === EXPECT_MODEL, `model sent was ${sent.body?.model}`);
      assert(sent.headers['x-api-key'], 'no x-api-key header sent');
      return `model=${sent.body.model}`;
    });
  }

  await check('arrest search hides seeded sample records (SHOW_SAMPLE_ARRESTS off)', async () => {
    // Migration 01 seeds 600 generated rows (source seed_v1) in these counties.
    let seen = 0;
    for (const [county, state] of [['Harris', 'TX'], ['Hillsborough', 'FL'], ['Hamilton', 'TN']]) {
      const r = await call('GET', `/api/arrests/search?county=${county}&state=${state}&limit=100`, { token });
      assert(r.status === 200 && Array.isArray(r.json?.records), `search failed: ${brief(r)}`);
      assert(r.json.records.every(x => x.is_sample === false), `sample record returned: ${brief(r)}`);
      seen += r.json.records.length;
    }
    const recent = await call('GET', '/api/arrests/recent?hours=8760&state=TX', { token });
    assert(recent.status === 200 && recent.json.records.every(x => x.is_sample === false), `recent leaked samples: ${brief(recent)}`);
    const seedRows = await q("SELECT count(*)::int AS n FROM arrest_records WHERE source = 'seed_v1'");
    return seedRows ? `${seedRows[0].n} seed rows kept in DB, ${seen} returned` : `${seen} returned`;
  });

  await check('arrest search reports honest feed coverage (feeds_configured)', async () => {
    // With ARREST_FEED_URLS unset the API must say so, so the app can show
    // "No public arrest feeds configured" instead of implying live coverage.
    const expected = !!process.env.ARREST_FEED_URLS;
    const r = await call('GET', '/api/arrests/search?name=smoketest', { token });
    assert(r.status === 200, `search failed: ${brief(r)}`);
    assert(r.json?.feeds_configured === expected, `feeds_configured should be ${expected}: ${brief(r)}`);
    const recent = await call('GET', '/api/arrests/recent?hours=24', { token });
    assert(recent.status === 200 && recent.json?.feeds_configured === expected, `recent feeds_configured: ${brief(recent)}`);
    return `feeds_configured=${r.json.feeds_configured}`;
  });

  await check('bondsman pricing quotes the flat lead fee', async () => {
    const r = await call('GET', '/api/billing/bondsman/tiers');
    assert(r.status === 200, `tiers failed: ${brief(r)}`);
    assert(r.json?.lead_fee?.cents === 10000 && r.json.lead_fee.model === 'flat', `unexpected lead_fee: ${brief(r)}`);
    return r.json.lead_fee.display;
  });

  let caseId = null;
  await check('POST /api/cases → persisted', async () => {
    const r = await call('POST', '/api/cases', {
      token, body: { title: 'Smoke test case', status: 'Open', next_court_date: '2026-12-01', notes: 'smoke notes' },
    });
    assert(r.status === 201, `expected 201, got ${brief(r)}`);
    caseId = r.json?.id;
    assert(caseId, `no id: ${brief(r)}`);
    const rows = await q('SELECT id, user_id, title, status, notes FROM cases WHERE id = $1', [caseId]);
    if (rows) {
      assert(rows.length === 1 && Number(rows[0].user_id) === userId, `case not in DB: ${JSON.stringify(rows)}`);
      assert(rows[0].notes && rows[0].notes !== 'smoke notes', 'notes were not encrypted at rest');
      return `case ${caseId} verified in Postgres`;
    }
    return `case ${caseId}`;
  });

  await check('GET /api/cases lists the case', async () => {
    const r = await call('GET', '/api/cases', { token });
    assert(r.status === 200 && Array.isArray(r.json), `expected 200 + array (what the app reads), got ${brief(r)}`);
    assert(r.json.some(c => c.id === caseId), 'created case not listed');
    const p = await call('GET', '/api/cases?page=1&limit=10', { token });
    assert(p.status === 200 && Array.isArray(p.json?.data) && p.json?.pagination, `paginated form: ${brief(p)}`);
    return `${r.json.length} case(s)`;
  });

  await check('court date round trip keeps the calendar day (create → list → update)', async () => {
    const day = '2026-11-20';
    const c = await call('POST', '/api/cases', { token, body: { title: 'Court date smoke', status: 'Open', next_court_date: day } });
    assert(c.status === 201 && c.json?.id, `create failed: ${brief(c)}`);
    assert(c.json.next_court_date === day, `create returned ${c.json.next_court_date}`);
    const l = await call('GET', '/api/cases', { token });
    const row = (l.json || []).find(x => x.id === c.json.id);
    assert(row, 'case not listed');
    // Exactly 'YYYY-MM-DD' — an ISO timestamp here is what made devices west of UTC show Nov 19.
    assert(row.next_court_date === day, `list returned next_court_date=${JSON.stringify(row.next_court_date)}`);
    const u = await call('PUT', `/api/cases/${c.json.id}`, { token, body: { next_court_date: '2027-01-05T18:30:00-08:00' } });
    assert(u.status === 200 && u.json?.next_court_date === '2027-01-05', `update returned ${brief(u)}`);
    const t = await q(`SELECT data_type FROM information_schema.columns WHERE table_name='cases' AND column_name='next_court_date'`);
    if (t) assert(t[0]?.data_type === 'date', `cases.next_court_date is ${t[0]?.data_type}, expected date`);
    return `${day} → ${row.next_court_date}; local-time update kept 2027-01-05`;
  });

  await check('case messages: encrypted at rest, plaintext in the thread', async () => {
    const text = 'Smoke message about my hearing';
    const s = await call('POST', `/api/messages/${caseId}`, { token, body: { body: text } });
    assert(s.status === 200 && s.json?.message?.body === text, `send failed: ${brief(s)}`);
    const g = await call('GET', `/api/messages/${caseId}`, { token });
    assert(g.status === 200 && g.json?.messages?.some(m => m.body === text), `thread: ${brief(g)}`);
    const rows = await q('SELECT body FROM case_messages WHERE id = $1', [s.json.message.id]);
    if (rows) assert(rows[0]?.body && rows[0].body !== text && rows[0].body.split(':').length === 3, 'message body not encrypted at rest');
    return rows ? 'ciphertext verified in Postgres' : 'ok';
  });

  let lawyerIds = [];
  await check('lawyer search by state + city returns real rows', async () => {
    const r = await call('GET', '/api/providers/lawyers?state=GA&city=Atlanta&limit=10', { token });
    assert(r.status === 200 && Array.isArray(r.json), `expected 200 + array, got ${brief(r)}`);
    assert(r.json.length > 0, 'no lawyers returned for Atlanta, GA');
    assert(r.json.every(l => l.state === 'GA' && /atlanta/i.test(l.city)), 'returned lawyers outside Atlanta, GA');
    lawyerIds = r.json.slice(0, 2).map(l => l.id);
    const r2 = await call('GET', '/api/providers/lawyers?city=' + encodeURIComponent('Atlanta, GA') + '&limit=5');
    assert(r2.status === 200 && r2.json.length > 0, `"City, ST" form failed: ${brief(r2)}`);
    return `${r.json.length} lawyers`;
  });

  await check('lawyer search by GPS', async () => {
    const r = await call('GET', '/api/providers/lawyers?lat=36.1627&lng=-86.7816&limit=5');
    assert(r.status === 200 && Array.isArray(r.json) && r.json.length > 0, `expected rows, got ${brief(r)}`);
    assert(r.json[0].distanceKm != null, 'no distance on GPS results');
  });

  await check('bail agent search returns rows', async () => {
    const r = await call('GET', '/api/providers/bail?state=CA&city=' + encodeURIComponent('Los Angeles') + '&limit=10');
    assert(r.status === 200 && Array.isArray(r.json), `expected 200 + array, got ${brief(r)}`);
    assert(r.json.length > 0, 'no bail agents returned for Los Angeles, CA');
    const g = await call('GET', '/api/providers/bail?lat=34.05&lng=-118.24&radiusKm=80&limit=5');
    assert(g.status === 200 && g.json.length > 0, `GPS bail search failed: ${brief(g)}`);
    return `${r.json.length} agents`;
  });

  // ── "Just arrested?" core path ─────────────────────────────────────────────
  const ipFrom = (ip) => ({ 'X-Forwarded-For': ip });
  await check('core path 1: rights card is public, sourced and dated; unreviewed state notes never shown', async () => {
    const r = await call('GET', '/api/rights/TN');
    assert(r.status === 200 && r.json?.general?.length === 8, `rights TN: ${brief(r)}`);
    assert(Array.isArray(r.json.state_specific) && r.json.state_specific.length === 0, 'unreviewed state notes shown for TN');
    assert(r.json.state_notice === "State-specific details for Tennessee haven't been reviewed yet — ask a local lawyer or public defender.", `TN notice: ${r.json.state_notice}`);
    assert(r.json.general.every(s => s.source && s.last_reviewed), 'a rights section has no source / last-reviewed date');
    assert(!/10\s?%/.test(r.text), 'unsourced bail-fee estimate in the rights card');
    const pr = await call('GET', '/api/rights/PR');
    assert(pr.status === 200 && /Puerto Rico haven't been reviewed yet/.test(pr.json?.state_notice || ''), `PR: ${brief(pr)}`);
    return `${r.json.general.length} sourced general sections; state notes pending review`;
  });

  await check('core path 2: guest lawyer + bail results with filters; report a listing never edits it', async () => {
    const r = await call('GET', '/api/help/nearby?lat=36.1627&lng=-86.7816&limit=5');
    assert(r.status === 200 && r.json?.lawyers?.length > 0 && r.json?.bail_agents?.length > 0, `nearby: ${brief(r)}`);
    assert(/Never by payment/.test(r.json.meta?.ranking || ''), 'ranking note missing');
    const f = await call('GET', '/api/help/nearby?lat=36.1627&lng=-86.7816&h24=1&limit=5');
    assert(f.status === 200 && [...f.json.lawyers, ...f.json.bail_agents].every(p => p.is_24_7), `24/7 filter: ${brief(f)}`);
    const target = r.json.bail_agents[0];
    const before = await q('SELECT md5(t::text) AS h FROM bail_agents t WHERE id = $1', [target.id]);
    const rep = await call('POST', '/api/help/reports', { body: { provider_type: 'bail_agent', provider_id: target.id, reason: 'wrong_hours', details: 'smoke test' }, headers: ipFrom('10.250.1.1') });
    assert(rep.status === 201 && rep.json?.report_id, `report: ${brief(rep)}`);
    const dup = await call('POST', '/api/help/reports', { body: { provider_type: 'bail_agent', provider_id: target.id, reason: 'wrong_hours' }, headers: ipFrom('10.250.1.1') });
    assert(dup.status === 200 && dup.json?.duplicate === true, `duplicate report: ${brief(dup)}`);
    if (before) {
      const after = await q('SELECT md5(t::text) AS h FROM bail_agents t WHERE id = $1', [target.id]);
      assert(after[0].h === before[0].h, 'the reported bail-agent row changed');
      await q('DELETE FROM listing_reports WHERE id = $1', [rep.json.report_id]);
    }
    const claim = await call('POST', '/api/help/claims', { token, body: { provider_type: 'bail_agent', provider_id: target.id, license_number: 'SMOKE-123' } });
    assert(claim.status === 201 && claim.json?.status === 'pending', `claim: ${brief(claim)}`);
    if (before) {
      const after2 = await q('SELECT md5(t::text) AS h FROM bail_agents t WHERE id = $1', [target.id]);
      assert(after2[0].h === before[0].h, 'the claimed bail-agent row changed');
    }
    return `${r.json.lawyers.length} lawyers + ${r.json.bail_agents.length} bail agents; report + claim queued, listing unchanged`;
  });

  let courtDateId = null; let coreCaseId = null;
  await check('core path 3: court date → 7d/3d/1d/morning-of reminders; .ics; guidance', async () => {
    const day = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const r = await call('POST', '/api/court-dates', { token, headers: { 'X-Timezone': 'America/Chicago' }, body: { case_title: 'Smoke court date', court_date: day, court_time: '09:00', state: 'TN' } });
    assert(r.status === 201 && r.json?.id, `create: ${brief(r)}`);
    courtDateId = r.json.id; coreCaseId = r.json.case_id;
    const days = (r.json.reminders || []).map(x => x.days_before).sort().join(',');
    assert(days === '0,1,3,7', `reminder plan ${days}`);
    const ics = await call('GET', `/api/court-dates/${courtDateId}/ics`, { token });
    assert(ics.status === 200 && /^text\/calendar/.test(ics.headers.get('content-type') || ''), `ics: ${ics.status}`);
    assert(ics.text.includes(`DTSTART;TZID=America/Chicago:${day.replace(/-/g, '')}T090000`) && ics.text.includes('BEGIN:VTIMEZONE'), 'ics DTSTART/VTIMEZONE wrong');
    const g = await call('GET', '/api/court-dates/guidance');
    assert(g.status === 200 && g.json?.missed?.steps?.at(-1)?.text === 'Call your lawyer or the court clerk.', `guidance: ${brief(g)}`);
    const anon = await call('GET', '/api/court-dates');
    assert(anon.status === 401, `court dates without sign-in: ${anon.status}`);
    return `court date ${courtDateId} on ${day}, 4 reminders, .ics ok`;
  });

  await check('core path 4: family follower (consent, code) sees court dates but not notes; revocable', async () => {
    assert(coreCaseId, 'no case from the court-date check');
    await call('PUT', `/api/cases/${coreCaseId}`, { token, body: { notes: 'SMOKE PRIVATE NOTE' } });
    const noConsent = await call('POST', `/api/cases/${coreCaseId}/followers`, { token, body: {} });
    assert(noConsent.status === 400 && noConsent.json?.code === 'consent_required', `no consent: ${brief(noConsent)}`);
    const inv = await call('POST', `/api/cases/${coreCaseId}/followers`, { token, body: { consent: true, name: 'Smoke Mom' } });
    assert(inv.status === 201 && inv.json?.invite_code, `invite: ${brief(inv)}`);
    const famEmail = `smoke-family-${crypto.randomBytes(4).toString('hex')}@smoke.example.test`;
    const fam = await call('POST', '/api/auth/register', { body: { identifier: famEmail, password, displayName: 'Smoke Family' }, headers: ipFrom('10.250.1.2') });
    assert(fam.status === 201 || fam.status === 200, `family sign-up: ${brief(fam)}`);
    const famToken = fam.json.token;
    try {
      const acc = await call('POST', '/api/following/accept', { token: famToken, body: { code: inv.json.invite_code } });
      assert(acc.status === 201, `accept: ${brief(acc)}`);
      const f = await call('GET', '/api/following', { token: famToken });
      const c = (f.json?.following || []).find(x => x.case_id === coreCaseId);
      assert(c && c.court_dates.some(d => d.id === courtDateId), `follower list: ${brief(f)}`);
      assert(!/SMOKE PRIVATE NOTE/.test(f.text), 'follower can see case notes');
      const peek = await call('GET', `/api/court-dates/${courtDateId}`, { token: famToken });
      assert(peek.status === 404, `follower reads owner court date directly: ${peek.status}`);
      const rev = await call('DELETE', `/api/cases/${coreCaseId}/followers/${acc.json.following.follow_id}`, { token });
      assert(rev.status === 200, `revoke: ${brief(rev)}`);
      const after = await call('GET', '/api/following', { token: famToken });
      assert(!(after.json?.following || []).some(x => x.case_id === coreCaseId), 'still following after revoke');
    } finally {
      await call('DELETE', '/api/auth/account', { token: famToken, body: { password } });
    }
    return 'consent required, code accepted, notes hidden, revoke works';
  });

  await check('core path 5: the core path answers in es / pt / vi (rights card, guidance, results notes, court dates)', async () => {
    const want = {
      es: { say: 'Estoy ejerciendo mi derecho a guardar silencio.', last: 'Llame a su abogado o al secretario del tribunal.', notice: /^Los detalles específicos de Tennessee/ },
      pt: { say: 'Estou exercendo meu direito de permanecer em silêncio.', last: 'Ligue para o seu advogado ou para a secretaria do tribunal.', notice: /^Os detalhes específicos de Tennessee/ },
      vi: { say: 'Tôi đang thực hiện quyền giữ im lặng của mình.', last: 'Hãy gọi cho luật sư của bạn hoặc thư ký tòa án.', notice: /^Thông tin riêng của Tennessee/ },
    };
    for (const [lang, w] of Object.entries(want)) {
      const r = await call('GET', '/api/rights/TN', { headers: { 'Accept-Language': lang } });
      assert(r.status === 200 && r.json?.language === lang && r.json.general.length === 8, `rights ${lang}: ${brief(r)}`);
      assert(r.json.general.every(sec => sec.language === lang), `rights ${lang}: a section is not in ${lang}`);
      assert(r.json.script.say[0].text === w.say && w.notice.test(r.json.state_notice || ''), `rights ${lang}: script / notice ${r.json.state_notice}`);
      const g = await call('GET', `/api/court-dates/guidance?lang=${lang}`);
      assert(g.json?.language === lang && g.json.missed.steps.at(-1).text === w.last, `guidance ${lang}: ${brief(g)}`);
      const h = await call('GET', '/api/help/nearby?state=TN&limit=1', { headers: { 'Accept-Language': lang } });
      assert(h.status === 200 && h.json?.meta?.language === lang && !/Never by payment/.test(h.json.meta.ranking), `help ${lang}: ${brief(h)}`);
      if (courtDateId) {
        const cd = await call('GET', `/api/court-dates/${courtDateId}`, { token, headers: { 'Accept-Language': lang } });
        assert(cd.status === 200 && cd.json?.language === lang && cd.json.guidance?.language === lang, `court date ${lang}: ${brief(cd)}`);
      }
    }
    const fr = await call('GET', '/api/rights/TN', { headers: { 'Accept-Language': 'fr-FR' } });
    assert(fr.json?.language === 'en', `unsupported language should be served in English: ${fr.json?.language}`);
    return 'es, pt, vi served (language field = language served); unsupported → en';
  });

  await check('POST /api/messages/bulk (LawyersScreen payload) reports who was messaged / skipped', async () => {
    assert(lawyerIds.length === 2, 'no lawyer ids from the search check');
    const r = await call('POST', '/api/messages/bulk', { token, body: { lawyer_ids: lawyerIds, message: 'Smoke: are you available for a consultation?' } });
    assert(r.status === 200, `expected 200, got ${brief(r)}`);
    assert(typeof r.json?.sent === 'number' && Array.isArray(r.json?.skipped), `bad shape: ${brief(r)}`);
    assert(r.json.sent + r.json.skipped.length === 2, `sent+skipped != 2: ${brief(r)}`);
    assert(r.json.skipped.every(x => ['no_account', 'self', 'duplicate', 'not_found'].includes(x.reason)), `bad skip reason: ${brief(r)}`);
    const tooMany = await call('POST', '/api/messages/bulk', { token, body: { lawyer_ids: [1, 2, 3, 4], message: 'x' } });
    assert(tooMany.status === 400, `4 recipients should be 400, got ${brief(tooMany)}`);
    const empty = await call('POST', '/api/messages/bulk', { token, body: { lawyer_ids: lawyerIds, message: '  ' } });
    assert(empty.status === 400, `empty message should be 400, got ${brief(empty)}`);
    return `sent=${r.json.sent}, skipped=${r.json.skipped.map(x => x.reason).join(',') || 'none'}`;
  });

  await check('POST /api/messages/attachment (multipart) → stored encrypted, downloadable', async () => {
    // 1x1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/jpeg' }), 'doc_smoke.jpg');
    form.append('case_id', String(caseId));
    const r = await call('POST', '/api/messages/attachment', { token, raw: form });
    assert(r.status === 201 && r.json?.id && r.json?.attachment?.mime_type === 'image/png', `upload: ${brief(r)}`);
    assert(r.json.attachment.message_id, 'attachment not posted into the case thread');
    const dl = await fetch(BASE + r.json.url, { headers: { Authorization: `Bearer ${token}` } });
    const bytes = Buffer.from(await dl.arrayBuffer());
    assert(dl.status === 200 && bytes.equals(png), `download: ${dl.status}, ${bytes.length} bytes`);
    const bad = new FormData();
    bad.append('file', new Blob(['#!/bin/sh\necho hi\n'], { type: 'image/png' }), 'x.png');
    const rb = await call('POST', '/api/messages/attachment', { token, raw: bad });
    assert(rb.status === 415, `non-image should be 415, got ${brief(rb)}`);
    const noauth = await fetch(BASE + r.json.url);
    assert(noauth.status === 401, `download without auth should be 401, got ${noauth.status}`);
    return `attachment ${r.json.id} (${r.json.attachment.size_bytes} B, round trip ok)`;
  });

  await check('bail calculator', async () => {
    const r = await call('POST', '/api/bail/calculate', {
      body: { state: 'TN', charge_type: 'felony', severity: 'medium', prior_record: 'none', flight_risk: 'low', employed: true },
    });
    assert(r.status === 200 && typeof r.json?.recommended === 'number', `expected recommendation, got ${brief(r)}`);
    return `$${r.json.recommended}`;
  });

  await check('courthouse + legal reference data', async () => {
    const c = await call('GET', '/api/courthouses?state=TN', { token });
    assert(c.status === 200 && Array.isArray(c.json) && c.json.length > 0, `courthouses: ${brief(c)}`);
    const b = await call('GET', '/api/legaldata/bail?state=TN&limit=200', { token });
    assert(b.status === 200 && b.json?.data?.length > 0, `legaldata bail: ${brief(b)}`);
    const d = await call('GET', '/api/legaldata/dui?state=TN', { token });
    assert(d.status === 200 && d.json?.data?.length > 0, `legaldata dui: ${brief(d)}`);
    return `${c.json.length} courthouses, ${b.json.data.length} bail rows`;
  });

  await check('password reset request stores a token', async () => {
    const r = await call('POST', '/api/auth/forgot-password', { body: { email } });
    assert(r.status === 200 && r.json?.sent === true, `expected 200, got ${brief(r)}`);
    const rows = await q('SELECT token, expires_at FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [userId]);
    if (rows) {
      assert(rows.length === 1, `expected 1 reset token row, got ${rows.length}`);
      assert(/^[0-9a-f]{64}$/.test(rows[0].token), 'reset token not stored as a hash');
      return 'token row verified in Postgres';
    }
  });

  await check('billing without Stripe → 503 payments_unavailable', async () => {
    const r = await call('POST', '/api/billing/subscribe', { token, body: { tier: 'advisor' } });
    if (PAYMENTS_LIVE) { assert(r.status !== 404 && r.status < 500, `billing route broken: ${brief(r)}`); return 'payments live — skipped'; }
    assert(r.status === 503 && r.json?.error === 'payments_unavailable', `expected 503 payments_unavailable, got ${brief(r)}`);
  });

  await check('stripe webhook with bad signature → 400 (not 404)', async () => {
    const raw = JSON.stringify({ id: 'evt_smoke', type: 'invoice.payment_succeeded', data: { object: {} } });
    for (const path of ['/webhooks/stripe', '/api/webhooks/stripe', '/api/billing/webhook']) {
      const r = await call('POST', path, { raw, headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' } });
      assert(r.status === 400, `${path}: expected 400, got ${brief(r)}`);
    }
  });

  await check('CORS: allowed origin preflight ok, unknown origin → 403', async () => {
    const ok = await fetch(BASE + '/api/auth/login', { method: 'OPTIONS', headers: {
      Origin: 'https://justicegavel.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
    assert(ok.status === 204 || ok.status === 200, `preflight status ${ok.status}`);
    assert(ok.headers.get('access-control-allow-origin') === 'https://justicegavel.app', 'missing ACAO header');
    const bad = await call('GET', '/health', { headers: { Origin: 'https://evil.example' } });
    assert(bad.status === 403, `expected 403 for unknown origin, got ${bad.status}`);
  });

  await check('security headers: HSTS, nosniff, CSP frame-ancestors none, request id, no-store on /api', async () => {
    const r = await fetch(BASE + '/api/health');
    const h = (k) => r.headers.get(k) || '';
    assert(/max-age=\d{7,}/.test(h('strict-transport-security')), `HSTS: ${h('strict-transport-security')}`);
    assert(h('x-content-type-options') === 'nosniff', 'nosniff missing');
    assert(/frame-ancestors 'none'/.test(h('content-security-policy')), 'CSP frame-ancestors missing');
    assert(/^[\w.-]{8,}$/.test(h('x-request-id')), 'X-Request-ID missing');
    assert(/no-store/.test(h('cache-control')), `Cache-Control on /api: ${h('cache-control')}`);
  });

  // Each limiter is tripped from its own client address (trust proxy 1 →
  // X-Forwarded-For), so the rest of the run is unaffected.
  const fromIp = (ip) => ({ 'X-Forwarded-For': ip });
  await check('rate limits: failed logins, sign-ups and password resets → 429', async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await call('POST', '/api/auth/login', { body: { identifier: `nobody-${i}@smoke.example.test`, password: 'Wrong123!' }, headers: fromIp('10.250.0.1') });
    assert(last.status === 429, `11th failed login: expected 429, got ${last.status}`);
    for (let i = 0; i < 6; i++) last = await call('POST', '/api/auth/register', { body: {}, headers: fromIp('10.250.0.2') });
    assert(last.status === 429, `6th sign-up attempt: expected 429, got ${last.status}`);
    for (let i = 0; i < 6; i++) last = await call('POST', '/api/auth/forgot-password', { body: { identifier: 'nobody@smoke.example.test' }, headers: fromIp('10.250.0.3') });
    assert(last.status === 429, `6th reset request: expected 429, got ${last.status}`);
  });

  await check('Idempotency-Key: a retried POST /api/cases replays the first answer (one case)', async () => {
    const key = `smoke-${crypto.randomUUID()}`;
    const body = { title: `smoke idem ${key.slice(-6)}` };
    const a = await call('POST', '/api/cases', { token, body, headers: { 'Idempotency-Key': key } });
    const b = await call('POST', '/api/cases', { token, body, headers: { 'Idempotency-Key': key } });
    assert(a.status === 201 && b.status === 201, `statuses ${a.status}/${b.status}`);
    assert(a.json?.id && a.json.id === b.json?.id, `ids differ: ${a.json?.id} vs ${b.json?.id}`);
    assert(b.headers.get('idempotent-replayed') === 'true', 'replay header missing');
    if (DB_URL) {
      const rows = await q('SELECT COUNT(*)::int AS n FROM cases WHERE user_id = $1 AND title = $2', [userId, body.title]);
      assert(rows[0].n === 1, `expected 1 case, found ${rows[0].n}`);
    }
  });

  await check('logout revokes the refresh token', async () => {
    const r = await call('POST', '/api/auth/logout', { token, body: { refreshToken } });
    assert(r.status === 200, `expected 200, got ${brief(r)}`);
    const again = await call('POST', '/api/auth/refresh', { body: { refreshToken } });
    assert(again.status === 401, `refresh after logout should be 401, got ${brief(again)}`);
  });

  if (!KEEP_USER && userId) {
    await check('cleanup: DELETE /api/auth/account', async () => {
      const r = await call('DELETE', '/api/auth/account', { token, body: { password } });
      assert(r.status === 200, `expected 200, got ${brief(r)}`);
      const rows = await q('SELECT id FROM users WHERE id = $1', [userId]);
      if (rows) assert(rows.length === 0, 'user row still present');
    });
  }

  return finish();
}

function finish() {
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ''}\n`);
  if (pool) pool.end().catch(() => {});
  if (mockServer) mockServer.close();
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(e => { console.error('smoke test crashed:', e); process.exitCode = 1; if (mockServer) mockServer.close(); });
