#!/usr/bin/env node
/**
 * route-sweep.mjs — call EVERY mounted Express route as six kinds of caller,
 * with valid and junk input, against a running server, and fail on:
 *   - any 5xx (a 503 is allowed only with a known "feature unavailable" code),
 *   - a hang (no answer within --timeout, default 10 s),
 *   - a signed-in-only route answering a guest, a staff route answering a
 *     consumer, or one person's resource answering somebody else (IDOR),
 *   - an error body that is not { error: <string>, message: <string> } JSON,
 *     or that carries a stack trace / SQL text,
 *   - an error message that is not in the request language (?lang= /
 *     Accept-Language: the same text for en and es / vi),
 *   - a mounted route missing from openapi.json (or the reverse), and a route
 *     file under src/routes that app.js never mounts,
 *   - verified lawyer / bail-agent rows changed by the sweep (md5 before/after).
 *
 * Usage (from backend/, server already running in production mode):
 *   node scripts/route-sweep.mjs http://localhost:4000 --db-url <postgres url> --admin-key <ADMIN_KEY>
 *     [--only /api/cases] [--concurrency 6] [--timeout 10000] [--json out.json] [--list]
 *
 * Route discovery imports src/app.js in this process (lib/route-walker.mjs)
 * to read the router tree; requests go to <baseUrl>. The callers are created
 * through the real sign-up route; roles that cannot be self-assigned (admin)
 * and the firm membership are set the way an operator would. Everything the
 * sweep creates is removed at the end (accounts deleted through the API,
 * leftovers by user id). Exit code 1 when any finding remains.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const BASE = (argv.find(a => /^https?:\/\//.test(a)) || 'http://localhost:4000').replace(/\/+$/, '');
const DB_URL = opt('--db-url', process.env.DATABASE_URL || null);
const ADMIN_KEY = opt('--admin-key', process.env.ADMIN_KEY || null);
const ONLY = opt('--only', null);
const CONCURRENCY = Number(opt('--concurrency', 6));
const TIMEOUT_MS = Number(opt('--timeout', 10000));
const JSON_OUT = opt('--json', null);
const LIST_ONLY = argv.includes('--list');

// ── 1. Discover the mounted routes ────────────────────────────────────────────
const { collectRoutes, toOpenApiPath } = await import('./lib/route-walker.mjs');
const mounted = await collectRoutes();
const findings = [];
const finding = (kind, route, detail) => findings.push({ kind, route, detail });

if (LIST_ONLY) {
  for (const r of mounted) console.log(`${r.method.padEnd(6)} ${r.path}  ${r.auth ? 'auth' : ''}${r.staff ? ' staff' : ''}  ${r.file || ''}`);
  process.exit(0);
}

// Parity: openapi.json ↔ mounted routes.
{
  const spec = JSON.parse(fs.readFileSync(path.resolve(ROOT, '../openapi.json'), 'utf8'));
  const inSpec = new Set();
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const m of Object.keys(ops)) if (['get', 'post', 'put', 'patch', 'delete'].includes(m)) inSpec.add(`${m.toUpperCase()} ${p}`);
  }
  const live = new Set(mounted.map(r => `${r.method} ${toOpenApiPath(r.path)}`));
  for (const k of live) if (!inSpec.has(k)) finding('openapi_missing', k, 'mounted but not in openapi.json (npm run generate:openapi)');
  for (const k of inSpec) if (!live.has(k)) finding('openapi_stale', k, 'in openapi.json but not mounted');
}
// Every router file under src/routes must be reachable from app.js.
{
  const srcRoot = path.resolve(ROOT, 'src');
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(path.join(srcRoot, 'app.js'));
  const walkDir = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walkDir(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walkDir(path.join(srcRoot, 'routes')).filter(f => f.endsWith('.js'))) {
    const text = fs.readFileSync(f, 'utf8');
    if (/express\.Router\(|Router\(\)/.test(text) && !seen.has(f)) finding('unmounted_router', path.relative(ROOT, f), 'router file never imported from app.js');
  }
}

// Body / query field names each router file reads (junk is sent in exactly those).
const fieldCache = new Map();
function fieldsOf(file) {
  if (!file) return { body: [], query: [] };
  if (fieldCache.has(file)) return fieldCache.get(file);
  let text = '';
  try { text = fs.readFileSync(path.resolve(ROOT, file), 'utf8'); } catch { /* none */ }
  const body = new Set(); const query = new Set();
  for (const m of text.matchAll(/req\.body\??\.([A-Za-z_]\w*)/g)) body.add(m[1]);
  for (const m of text.matchAll(/req\.query\??\.([A-Za-z_]\w*)/g)) query.add(m[1]);
  for (const a of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:\(?\s*)?req\.(body|query)\b/g)) {
    for (const m of text.matchAll(new RegExp(`\\b${a[1]}\\??\\.([A-Za-z_]\\w*)`, 'g'))) (a[2] === 'body' ? body : query).add(m[1]);
  }
  for (const m of text.matchAll(/\{([^{}]{1,600})\}\s*=\s*req\.(body|query)\b/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/[:=\s]/)[0].replace(/^\.\.\./, '');
      if (/^[A-Za-z_]\w*$/.test(name)) (m[2] === 'body' ? body : query).add(name);
    }
  }
  const out = { body: [...body].slice(0, 40), query: [...query].slice(0, 25) };
  fieldCache.set(file, out);
  return out;
}

// ── 2. HTTP ───────────────────────────────────────────────────────────────────
let ipSeq = 0;
const freshIp = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${(ipSeq & 255) || 1}`; };
let requestCount = 0;

async function call(method, urlPath, { token, body, rawBody, lang, headers = {}, adminKey } = {}) {
  requestCount++;
  const h = { Accept: 'application/json', 'X-Forwarded-For': freshIp(), 'X-Timezone': 'America/Chicago', ...headers };
  if (lang) h['Accept-Language'] = lang;
  if (token) h.Authorization = `Bearer ${token}`;
  if (adminKey) h['X-Admin-Key'] = adminKey;
  let payload;
  if (rawBody !== undefined) { h['Content-Type'] = 'application/json'; payload = rawBody; }
  else if (body !== undefined && method !== 'GET') { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + urlPath, { method, headers: h, body: payload, signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, text, json, type: res.headers.get('content-type') || '', ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, text: '', json: null, type: '', ms: Date.now() - t0, timeout: e.name === 'AbortError', err: e.message };
  } finally { clearTimeout(timer); }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// ── 3. Database (admin role, firm membership, cleanup, provider checksum) ─────
let pg = null;
async function q(sql, params = []) {
  if (!DB_URL) return [];
  if (!pg) { const { default: P } = await import('pg'); pg = new P.Pool({ connectionString: DB_URL, max: 2 }); }
  return (await pg.query(sql, params)).rows;
}
const providerChecksum = async () => {
  const [l] = await q(`SELECT COUNT(*) AS n, md5(string_agg(t::text, '' ORDER BY id)) AS h FROM lawyers t`);
  const [b] = await q(`SELECT COUNT(*) AS n, md5(string_agg(t::text, '' ORDER BY id)) AS h FROM bail_agents t`);
  return `${l?.n}:${l?.h} / ${b?.n}:${b?.h}`;
};

// ── 4. Callers ────────────────────────────────────────────────────────────────
const TAG = `sw${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const PASSWORD = 'Sweep!' + crypto.randomBytes(6).toString('hex') + 'A1';
const people = {};
async function signUp(name, extra = {}) {
  const email = `${name}.${TAG}@sweep.test`;
  const r = await call('POST', '/api/auth/register', { body: { identifier: email, password: PASSWORD, displayName: `Sweep ${name}`, ...extra } });
  if (!r.json?.token) throw new Error(`register ${name}: ${r.status} ${r.text.slice(0, 200)}`);
  const p = { name, email, token: r.json.token, refreshToken: r.json.refreshToken, id: r.json.user.id };
  await call('POST', '/api/auth/accept-tos', { token: p.token, body: { checkbox_tos: true, checkbox_no_advice: true, scroll_completed: true, platform: 'web' } });
  await call('POST', '/api/auth/disclaimer/accept', { token: p.token, body: {} });
  people[name] = p;
  return p;
}
async function relogin(p) {
  const r = await call('POST', '/api/auth/login', { body: { identifier: p.email, password: PASSWORD } });
  if (r.json?.token) { p.token = r.json.token; p.refreshToken = r.json.refreshToken; return true; }
  return false;
}

console.log(`Route sweep → ${BASE}  (${mounted.length} mounted routes, tag ${TAG})`);
const checksumBefore = DB_URL ? await providerChecksum() : null;

// Owners hold the resources; the six callers below never own them.
const ownerC = await signUp('ownerc');
const ownerA = await signUp('ownera', { accountType: 'attorney', isAttorney: true, barNumber: `SW${Date.now() % 1e6}`, barState: 'TN' });
const ownerB = await signUp('ownerb', { accountType: 'bail_agent' });
const consumer = await signUp('consumer');
const attorney = await signUp('attorney', { accountType: 'attorney', isAttorney: true, barNumber: `SX${Date.now() % 1e6}`, barState: 'TN' });
const bail = await signUp('bail', { accountType: 'bail_agent' });
const member = await signUp('member', { accountType: 'attorney', isAttorney: true, barNumber: `SM${Date.now() % 1e6}`, barState: 'TN' });
const admin = await signUp('admin');
if (DB_URL) {
  await q(`UPDATE users SET role = 'admin', is_admin = 1 WHERE id = $1`, [admin.id]);
  await q(`UPDATE users SET bar_verified = 1 WHERE id = ANY($1)`, [[ownerA.id, attorney.id, member.id]]);
}

// ── 5. Resources owned by the owners (for the IDOR checks) ────────────────────
const R = {};   // name → { id, owner }
const seedNotes = [];
async function seed(name, owner, method, p, body, pick = (j) => j?.id) {
  const r = await call(method, p, { token: owner.token, body });
  const id = r.status < 300 ? pick(r.json) : null;
  if (id == null) { seedNotes.push(`${name}: ${method} ${p} → ${r.status} ${r.text.slice(0, 160)}`); return null; }
  R[name] = { id, owner };
  return id;
}
const firstLawyer = (await call('GET', '/api/providers/lawyers?limit=1')).json;
const lawyerId = Array.isArray(firstLawyer) ? firstLawyer[0]?.id : firstLawyer?.data?.[0]?.id;
const caseId = await seed('case', ownerC, 'POST', '/api/cases', { title: `Sweep case ${TAG}`, charge: 'Theft', state: 'TN', notes: 'private note' });
if (caseId) {
  await seed('courtDate', ownerC, 'POST', '/api/court-dates', { case_id: caseId, court_date: '2031-03-04', court_time: '09:00', hearing_type: 'arraignment', location: 'Sweep Court' }, j => j?.id ?? j?.court_date?.id);
  await seed('message', ownerC, 'POST', `/api/messages/${caseId}`, { body: 'hello from the sweep' }, j => j?.id ?? j?.message?.id);
  await seed('caseEvent', ownerC, 'POST', `/api/cases/${caseId}/events`, { title: 'Sweep event', event_date: '2031-01-02', event_type: 'note' }, j => j?.id ?? j?.event?.id);
}
if (lawyerId) await seed('savedLawyer', ownerC, 'POST', '/api/saved/lawyers', { lawyer_id: lawyerId }, j => j?.id ?? j?.saved?.id);
await seed('familyContact', ownerC, 'POST', '/api/family/contacts', { name: 'Sweep Mom', phone: '+16155550111', relationship: 'parent' }, j => j?.id ?? j?.contact?.id);
await seed('chatSession', ownerC, 'POST', '/api/chat/ask', { message: 'What are my rights at a traffic stop?', sessionId: `sweep-${TAG}` }, () => `sweep-${TAG}`);
await seed('job', ownerC, 'POST', '/api/chat/ask', { message: 'Second question', sessionId: `sweep-${TAG}` }, j => j?.jobId ?? j?.job_id);
const firmId = await seed('firm', ownerA, 'POST', '/api/firms', { name: `Sweep Firm ${TAG}` });
if (firmId) {
  const inv = await call('POST', `/api/firms/${firmId}/members/invite`, { token: ownerA.token, body: { email: member.email, role: 'associate' } });
  const acc = inv.json?.token ? await call('POST', '/api/firms/accept-invite', { token: member.token, body: { token: inv.json.token } }) : inv;
  if (acc.status !== 200) seedNotes.push(`firm member: ${inv.status} ${acc.status} ${acc.text.slice(0, 160)}`);
}
const matterId = await seed('matter', ownerA, 'POST', '/api/matters', { title: `Sweep matter ${TAG}`, client_name: 'Pat Client', notes: 'privileged' });
if (matterId) {
  await seed('timeEntry', ownerA, 'POST', '/api/time/entries', { matter_id: matterId, hours: 1.5, narrative: 'Sweep research', rate: 200, entry_date: '2031-01-02' }, j => j?.id ?? j?.entry?.id);
  await seed('privilegeEntry', ownerA, 'POST', '/api/privilege/entries', { matter_id: matterId, doc_type: 'memo', privilege_basis: 'attorney_client', description: 'Sweep memo', doc_date: '2031-01-02' }, j => j?.id ?? j?.entry?.id);
  await seed('matterEvent', ownerA, 'POST', `/api/matters/${matterId}/events`, { title: 'Sweep hearing', event_date: '2031-01-02', event_type: 'hearing' }, j => j?.id ?? j?.event?.id);
}
await seed('researchSession', ownerA, 'POST', '/api/research/ask', { query: 'What is the standard for a Terry stop on the street?' }, j => j?.sessionId ?? j?.session_id);
await seed('webhookSub', ownerA, 'POST', '/api/webhooks/outbound/subscriptions', { name: 'Sweep hook', url: 'https://example.com/hook', events: ['matter.created'] }, j => j?.id ?? j?.subscription?.id);
await seed('enrollment', ownerB, 'POST', '/api/checkins/enroll', { defendant_name: 'Sweep Defendant', defendant_phone: '+16155550122', frequency: 'weekly' }, j => j?.id ?? j?.enrollment?.id ?? j?.enrollment_id);
// Every resource must exist, or its IDOR checks silently test nothing.
for (const n of seedNotes) finding('seed', n.split(':')[0], n);
console.log(`Seeded: ${Object.entries(R).map(([k, v]) => `${k}=${v.id}`).join(' ')}`);

// Which owned resource a path parameter names: [path regex, { param: resource }].
const OWNED = [
  [/^\/api\/cases\/:id\b/, { id: 'case', eventId: 'caseEvent' }],
  [/^\/api\/cases\/:caseId\b/, { caseId: 'case' }],
  [/^\/api\/messages\/:caseId$/, { caseId: 'case' }],
  [/^\/api\/messages\/:id$/, { id: 'message' }],
  [/^\/api\/court-dates\/:id\b/, { id: 'courtDate' }],
  [/^\/api\/chat\/history\/:sessionId$/, { sessionId: 'chatSession' }],
  [/^\/api\/jobs\/:id$/, { id: 'job' }],
  [/^\/api\/saved\/lawyers\/:id$/, { id: 'savedLawyer' }],
  [/^\/api\/family\/contacts\/:id$/, { id: 'familyContact' }],
  [/^\/api\/hague-contacts\/intake\/:caseId$/, { caseId: 'case' }],
  [/^\/api\/matters\/:id\b/, { id: 'matter', eid: 'matterEvent' }],
  [/^\/api\/(time|privilege|docket|analytics|matter-intelligence)\/(matter\/)?:matterId\b/, { matterId: 'matter' }],
  [/^\/api\/matter-intelligence\/:id\/analytics$/, { id: 'matter' }],
  [/^\/api\/conflicts\/ethics-wall\/:matterId\b/, { matterId: 'matter' }],
  [/^\/api\/audit\/matter\/:id$/, { id: 'matter' }],
  [/^\/api\/time\/entries\/:id$/, { id: 'timeEntry' }],
  [/^\/api\/privilege\/entries\/:id\b/, { id: 'privilegeEntry' }],
  [/^\/api\/firms\/:id\b/, { id: 'firm' }],
  [/^\/api\/(conflicts\/[\w-]+(\/log)?|sso\/config|sso\/test)\/:firmId$/, { firmId: 'firm' }],
  [/^\/api\/research\/session\/:id$/, { id: 'researchSession' }],
  [/^\/api\/webhooks\/outbound\/subscriptions\/:id\b/, { id: 'webhookSub' }],
  [/^\/api\/webhooks\/outbound\/deliveries\/:subId$/, { subId: 'webhookSub' }],
  [/^\/api\/checkins\/.*:(enrollmentId|id)\b/, { enrollmentId: 'enrollment', id: 'enrollment' }],
];
// User-id parameters: the owner's own id (somebody else's for every caller).
const USER_PARAMS = new Set(['userId', 'uid', 'attorneyId', 'memberId']);
// Firm-scoped resources a firm member may legitimately reach (not an IDOR for `member`).
const FIRM_SHARED = new Set(['firm', 'matter', 'matterEvent', 'timeEntry', 'privilegeEntry', 'webhookSub']);

// A 200 with somebody else's id that reveals and changes nothing (checked by hand; keep the reason):
const IDOR_OK = new Map([
  ['GET /api/chat/history/:sessionId', 'rows are filtered by the caller (user_id): another person\'s session id gives []'],
  ['DELETE /api/chat/history/:sessionId', 'deletes only the caller\'s own rows (WHERE user_id = caller)'],
  ['POST /api/messages/direct/:userId/read', 'marks read only messages sent TO the caller by that user (marked: 0 otherwise)'],
  ['POST /api/attorney/inbox/direct/:userId/read', 'marks read only messages sent TO the caller by that user (marked: 0 otherwise)'],
]);
// Callers that are machines (Stripe): no request language to follow.
const MACHINE_ROUTES = /^(\/api)?\/webhooks\/stripe$|^\/api\/billing\/webhook$/;

// Real directory rows: read-only. Non-GET admin calls on them get an id that does not exist.
const PROVIDER_WRITE = /^\/api\/admin\/(lawyers|bail|proposals|listing-claims|listing-reports)\b/;
// Calls that start network jobs / scrapers or end the caller's session are made only with junk.
const NO_VALID_CALL = [
  /^POST \/api\/bot\//, /^POST \/api\/admin\/(refresh|scrape|import|run|health-scan|bot)/, /^POST \/api\/arrests\/ingest/,
  /^POST \/api\/auth\/(logout|logout-all|change-password|reset-password)$/, /^DELETE \/api\/auth\/account$/,
];

function resolveParams(route, who) {
  const names = [...route.path.matchAll(/:([A-Za-z_]\w*)/g)].map(m => m[1]);
  const owned = OWNED.find(([re]) => re.test(route.path))?.[1] || {};
  const values = {}; const used = [];
  for (const n of names) {
    const res = owned[n] && R[owned[n]];
    if (res && !(PROVIDER_WRITE.test(route.path))) { values[n] = res.id; used.push({ param: n, resource: owned[n], owner: res.owner }); continue; }
    if (USER_PARAMS.has(n)) { const o = route.path.includes('/firms/') || route.path.includes('/matters/') ? ownerA : ownerC; values[n] = o.id; used.push({ param: n, resource: 'user', owner: o }); continue; }
    if (n === 'lawyerId') { values[n] = lawyerId || 1; continue; }
    if (n === 'state') { values[n] = 'TN'; continue; }
    if (n === 'countryCode') { values[n] = 'MX'; continue; }
    if (n === 'type') { values[n] = 'drugs'; continue; }
    if (n === 'provider') { values[n] = 'clio'; continue; }
    if (n === 'table') { values[n] = 'lawyers'; continue; }
    if (n === 'county') { values[n] = 'Davidson'; continue; }
    if (n === 'code' || n === 'token' || n === 'name') { values[n] = `sweep${TAG}`; continue; }
    if (n === 'id' && /\/(lawyers|providers\/lawyers|match\/profile)\b/.test(route.path) && route.method === 'GET') { values[n] = lawyerId || 1; continue; }
    if (n === 'id' && /\/(bail|providers\/bail)\b/.test(route.path) && route.method === 'GET') { values[n] = 1; continue; }
    values[n] = 999999999;
  }
  const fill = (vals) => route.path.replace(/:([A-Za-z_]\w*)/g, (_, n) => encodeURIComponent(String(vals[n])));
  void who;
  return { url: fill(values), used, fill, names };
}

const JUNK_PARAMS = ['abc', '-1', '0', '9'.repeat(30), 'x'.repeat(3000), "1' OR '1'='1", '..%2F..%2Fetc%2Fpasswd', '1e309'];
const HUGE = 'A'.repeat(20000);
function junkBodies(fields) {
  const names = fields.length ? fields : ['id', 'name', 'email', 'text'];
  const fillAll = (v) => Object.fromEntries(names.map(n => [n, v]));
  return [
    { label: 'objects', body: fillAll({ $ne: null, __proto__x: 1 }) },
    { label: 'arrays', body: fillAll([1, 'two', null]) },
    { label: 'negative', body: fillAll(-1) },
    { label: 'huge', body: fillAll(HUGE) },
    { label: 'bools', body: fillAll(true) },
    { label: 'array-root', body: [1, 2, 3] },
  ];
}

// ── 6. Checks on one response ─────────────────────────────────────────────────
const OK_503 = new Set(['payments_unavailable', 'ai_unavailable', 'storage_unavailable', 'email_unavailable', 'video_unavailable',
  'sms_unavailable', 'auth_unavailable', 'feature_unavailable', 'service_unavailable', 'search_unavailable', 'integration_unavailable',
  'sso_unavailable', 'transcription_unavailable', 'unavailable', 'upload_busy', 'push_unavailable', 'queue_unavailable', 'not_configured', 'ai_busy', 'ai_timeout', 'scheduler_unavailable']);
const LEAK = [/\n\s+at [\w$.<>]+ \(/, /node_modules\//, /\/src\/[\w/]+\.js:\d+/, /syntax error at or near/i, /column "[^"]+" (of relation|does not exist)/i,
  /relation "[^"]+" does not exist/i, /duplicate key value violates/i, /invalid input syntax for type/i, /violates (check|foreign key|not-null) constraint/i,
  /\bSequelize|\bSQLITE_|ECONNREFUSED/];

function checkResponse(route, who, variant, r) {
  const where = `${route.method} ${route.path}`;
  const tag = `${who}/${variant}`;
  if (r.timeout) return finding('hang', where, `${tag}: no answer within ${TIMEOUT_MS} ms`);
  if (r.status === 0) return finding('no_response', where, `${tag}: ${r.err}`);
  const code = r.json && typeof r.json === 'object' ? (r.json.code || r.json.error) : null;
  if (r.status >= 500 && !(r.status === 503 && OK_503.has(code))) finding('5xx', where, `${tag}: ${r.status} ${r.text.slice(0, 200)}`);
  for (const re of LEAK) if (re.test(r.text)) { finding('leak', where, `${tag}: ${r.status} body matches ${re} — ${r.text.slice(0, 160)}`); break; }
  if (r.json && typeof r.json === 'object' && 'stack' in r.json) finding('leak', where, `${tag}: body has a stack field`);
  if (r.status >= 400 && route.path.startsWith('/api')) {
    const j = r.json;
    if (!j || typeof j !== 'object' || Array.isArray(j)) finding('shape', where, `${tag}: ${r.status} error is not a JSON object (${r.type}) ${r.text.slice(0, 80)}`);
    else if (typeof j.error !== 'string' || typeof j.message !== 'string' || !j.message.trim()) finding('shape', where, `${tag}: ${r.status} error body lacks error/message strings: ${r.text.slice(0, 120)}`);
  }
}

// ── 7. The sweep ──────────────────────────────────────────────────────────────
const callers = [
  { who: 'guest', p: null },
  { who: 'consumer', p: consumer },
  { who: 'attorney', p: attorney },
  { who: 'bail', p: bail },
  { who: 'member', p: member },
  { who: 'admin', p: admin, adminKey: ADMIN_KEY },
];
const isSessionKiller = (r) => NO_VALID_CALL.some(re => re.test(`${r.method} ${r.path}`));
let targets = mounted.filter(r => !ONLY || r.path.startsWith(ONLY));
// Deletes last, so resources stay in place for the other checks.
const order = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };
targets = targets.sort((a, b) => (order[a.method] ?? 9) - (order[b.method] ?? 9) || a.path.localeCompare(b.path));

const isStaffPath = (r) => r.staff || /^\/api\/admin\b/.test(r.path) || /^\/api\/bot\b/.test(r.path) || /^\/api\/impact\b/.test(r.path);
const langSamples = [];

async function sweepRoute(route) {
  const where = `${route.method} ${route.path}`;
  const { body: bodyFields, query: queryFields } = fieldsOf(route.file);
  const killer = isSessionKiller(route);
  for (const c of callers) {
    const token = c.p?.token;
    const { url, used } = resolveParams(route, c.who);
    const send = (u, opts = {}) => call(route.method, u, { token, adminKey: c.adminKey, ...opts });

    // a) "valid" call: owners' ids, empty body (skipped for session-ending / job-starting routes)
    if (!killer) {
      const r = await send(url, { body: {} });
      checkResponse(route, c.who, 'valid', r);
      const ok = r.status >= 200 && r.status < 300;
      if (c.who === 'guest' && route.auth && r.status !== 401) finding('auth', where, `guest got ${r.status} on a signed-in route`);
      if (ok && c.who !== 'admin' && isStaffPath(route) && c.who !== 'guest') finding('staff', where, `${c.who} got ${r.status} on a staff route`);
      if (ok && c.who === 'guest' && isStaffPath(route)) finding('staff', where, `guest got ${r.status} on a staff route`);
      if (ok && used.length && c.who !== 'admin' && !IDOR_OK.has(where)) {
        for (const u of used) {
          if (u.owner === c.p) continue;
          if (c.who === 'member' && (FIRM_SHARED.has(u.resource) || u.resource === 'user')) continue;
          finding('idor', where, `${c.who} got ${r.status} with ${u.owner.name}'s ${u.resource} (${u.param}=${R[u.resource]?.id ?? u.owner.id}): ${r.text.slice(0, 120)}`);
        }
      }
      if (r.status === 401 && c.p && !route.path.startsWith('/api/auth')) {
        const me = await call('GET', '/api/auth/me', { token });
        if (me.status === 401) { finding('session', where, `${c.who}'s session ended after this call`); await relogin(c.p); }
      }
      // language: an error a person can see must follow ?lang= and Accept-Language
      if (r.status >= 400 && r.json?.message && !killer && !MACHINE_ROUTES.test(route.path)) {
        langSamples.push({ route, c, url, en: r.json.message, status: r.status });
      }
    }
    // b) junk: path params, bodies, query strings, broken JSON (consumer + admin get all of it; others a sample)
    const heavy = c.who === 'consumer' || c.who === 'admin' || c.who === 'guest';
    const { fill, names } = resolveParams(route, c.who);
    if (names.length) {
      for (const j of heavy ? JUNK_PARAMS : JUNK_PARAMS.slice(0, 3)) {
        const vals = Object.fromEntries(names.map(n => [n, decodeURIComponent(j)]));
        const r = await send(fill(vals), { body: {} });
        checkResponse(route, c.who, `param:${j.slice(0, 12)}`, r);
        if (PROVIDER_WRITE.test(route.path) && r.status < 300 && route.method !== 'GET') finding('provider_write', where, `${c.who} junk id ${j.slice(0, 12)} → ${r.status}`);
      }
    }
    if (route.method !== 'GET' && route.method !== 'DELETE') {
      for (const jb of heavy ? junkBodies(bodyFields) : junkBodies(bodyFields).slice(0, 2)) {
        const r = await send(PROVIDER_WRITE.test(route.path) ? url.replace(/\d{1,9}(?=\/|$)/g, '999999999') : url, { body: jb.body });
        checkResponse(route, c.who, `body:${jb.label}`, r);
      }
      if (heavy) checkResponse(route, c.who, 'body:broken-json', await send(url, { rawBody: '{"a":' }));
    } else if (heavy && route.method === 'GET') {
      const qf = queryFields.length ? queryFields : ['limit', 'page'];
      for (const v of ['-1', 'x'.repeat(3000), 'abc', "' OR 1=1--"]) {
        // Long values only in the first two fields: the URL stays under Node's 16 KB header limit.
        const qs = qf.map((n, i) => `${encodeURIComponent(n)}=${encodeURIComponent(v.length > 100 && i > 1 ? 'x' : v)}`).join('&') + `&${qf[0]}=dup`;
        const r = await send(`${url}${url.includes('?') ? '&' : '?'}${qs}`);
        checkResponse(route, c.who, `query:${v.slice(0, 8)}`, r);
      }
    }
  }
}

// Owners can read their own resources (proves each id fill is right, so a
// stranger's 4xx on the same URL really is the access check).
// (Not checked: a public page, and two lookups that are empty until the owner saves something.)
const OWNER_READ_SKIP = new Set(['/api/firms/:id/public-profile', '/api/hague-contacts/intake/:caseId', '/api/sso/test/:firmId']);
for (const route of mounted.filter(r => r.method === 'GET' && !OWNER_READ_SKIP.has(r.path) && OWNED.some(([re]) => re.test(r.path)))) {
  const { url, used } = resolveParams(route, 'owner');
  const owners = [...new Set(used.map(u => u.owner))];
  if (owners.length !== 1 || used.some(u => !R[u.resource] && u.resource !== 'user')) continue;
  const r = await call('GET', url, { token: owners[0].token });
  if (r.status >= 300) finding('owner_read', `GET ${route.path}`, `${owners[0].name} got ${r.status} on their own resource: ${r.text.slice(0, 120)}`);
}

const t0 = Date.now();
await pool(targets, CONCURRENCY, async (route, k) => {
  await sweepRoute(route);
  if ((k + 1) % 100 === 0) console.log(`  … ${k + 1}/${targets.length} routes, ${requestCount} requests, ${findings.length} findings`);
});

// Language: the same error must read differently in Spanish and Vietnamese.
const seenLang = new Set();
await pool(langSamples, CONCURRENCY, async (s) => {
  const where = `${s.route.method} ${s.route.path}`;
  const key = `${where} ${s.en}`;
  if (seenLang.has(key)) return;
  seenLang.add(key);
  if (!/[a-z]{3,}\s+[a-z]{2,}/i.test(s.en)) return;   // codes / numbers only
  const sep = s.url.includes('?') ? '&' : '?';
  for (const lang of ['es', 'vi']) {
    const a = await call(s.route.method, `${s.url}${sep}lang=${lang}`, { token: s.c.p?.token, body: {} });
    const b = await call(s.route.method, s.url, { token: s.c.p?.token, body: {}, lang: `${lang}-US,${lang};q=0.9` });
    for (const [how, r] of [['?lang', a], ['Accept-Language', b]]) {
      if (r.status === s.status && r.json?.message && r.json.message === s.en) {
        finding('language', where, `${s.c.who} ${s.status}: "${s.en.slice(0, 90)}" is the same in ${lang} (${how})`);
        return;
      }
    }
  }
});

// ── 8. Clean up ───────────────────────────────────────────────────────────────
for (const p of Object.values(people)) {
  await relogin(p);
  const d = await call('DELETE', '/api/auth/account', { token: p.token, body: { password: PASSWORD, confirm: 'DELETE' } });
  if (d.status >= 300) console.log(`  cleanup: delete ${p.name} → ${d.status} ${d.text.slice(0, 120)}`);
}
if (DB_URL) {
  const ids = Object.values(people).map(p => p.id);
  await q(`DELETE FROM users WHERE id = ANY($1)`, [ids]).catch(e => console.log(`  cleanup: users ${e.message}`));
  const after = await providerChecksum();
  if (after !== checksumBefore) finding('provider_write', 'lawyers / bail_agents', `checksum changed: ${checksumBefore} → ${after}`);
  await pg.end();
}

// ── 9. Report ─────────────────────────────────────────────────────────────────
const byKind = findings.reduce((a, f) => ((a[f.kind] = (a[f.kind] || 0) + 1), a), {});
console.log(`\nSwept ${targets.length} routes × ${callers.length} callers: ${requestCount} requests in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const grouped = new Map();
for (const f of findings) {
  const k = `${f.kind} ${f.route}`;
  if (!grouped.has(k)) grouped.set(k, []);
  grouped.get(k).push(f.detail);
}
for (const [k, details] of grouped) console.log(`  ✘ ${k}\n      ${details.slice(0, 3).join('\n      ')}${details.length > 3 ? `\n      (+${details.length - 3} more)` : ''}`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, routes: targets.length, requests: requestCount, byKind, findings, seeded: Object.fromEntries(Object.entries(R).map(([k, v]) => [k, v.id])), seedNotes }, null, 2));
console.log(findings.length ? `\n${grouped.size} problems (${findings.length} findings): ${JSON.stringify(byKind)}` : '\nNo findings.');
process.exit(findings.length ? 1 : 0);
