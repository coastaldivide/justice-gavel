#!/usr/bin/env node
/**
 * web-journeys-core-scope.cjs — the SHIPPED (core-path) web build, headless Chromium, real API.
 *
 * The other journey scripts run against the full build (EXPO_PUBLIC_FULL_APP=1) so every screen's
 * code is exercised. This one checks what the default build adds on top (constants/features.ts,
 * navigation/CoreOnlyGate.tsx, Oct 26 2026 core-path focus):
 *
 *   S1 the core path opens: Home, "Just arrested?", Court dates (signed out and in)
 *   S2 parked screens (legal insurance, Golden Gavel, arrest monitor, housing rights) show the
 *      "Not available yet" card with a way back to "Just arrested?" — signed out and signed in
 *   S3 professional screens (lawyer dashboard, conflict check) show "For professional accounts"
 *      to a consumer, and the real screen to an attorney account
 *   S4 no page errors and no failed API request on any of the above
 *
 *   node scripts/web-journeys-core-scope.cjs dist out --api http://localhost:4300/api [--port 8300]
 * Exit 1 on any failure.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-core-scope-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4300/api')).replace(/\/$/, '');
const PORT = Number(arg('--port', 8300));
fs.mkdirSync(OUT, { recursive: true });

const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'en.json'), 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p);
  if (!f.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    if (path.extname(p)) { res.writeHead(404); return res.end('nf'); }
    f = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const results = [];
const pass = (id, detail) => { results.push({ id, ok: true }); console.log('PASS ', id, '-', detail); };
const fail = (id, detail) => { results.push({ id, ok: false }); console.log('FAIL ', id, '-', detail); };

let ipSeq = Math.floor(Math.random() * 200);
const freshIp = () => `10.78.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
async function apiCall(method, p, { token, body } = {}) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': freshIp(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}
async function newUser(tag, accountType) {
  const email = `u-${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { body: { identifier: email, password: 'CorrectHorse9!', displayName: `Core ${tag}`, ...(accountType ? { accountType } : {}) } });
  const token = reg.body && reg.body.token;
  if (!token) throw new Error(`register ${reg.status}`);
  await apiCall('POST', '/auth/accept-tos', { token, body: { checkbox_tos: true, checkbox_no_advice: true, scroll_completed: true, platform: 'web' } });
  await apiCall('POST', '/auth/disclaimer/accept', { token });
  return { token, user: reg.body.user };
}

const base = `http://localhost:${PORT}`;
const byTid = (page, id) => page.locator(`[data-testid="${id}"]`);
let lastPage = null;

async function open(browser, account = null) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Chicago', serviceWorkers: 'block',
    extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  const page = await ctx.newPage();
  lastPage = page;
  const errors = []; const failed = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  page.on('response', r => { if (r.url().startsWith(API) && r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(API.length).split('?')[0]}`); });
  await page.goto(base + '/age-check', { waitUntil: 'domcontentloaded' });
  await page.evaluate((acc) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('age_verified', '1');
    localStorage.setItem('has_browsed', 'true');
    localStorage.setItem('lang', 'en');
    if (acc) { sessionStorage.setItem('jg_token', acc.token); sessionStorage.setItem('jg_user', JSON.stringify(acc.user)); }
  }, account);
  return { ctx, page, errors, failed };
}
async function go(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); }
const clean = (s, who) => {
  if (s.errors.length) throw new Error(`${who}: page errors ${s.errors.slice(0, 3).join(' | ')}`);
  if (s.failed.length) throw new Error(`${who}: failed requests ${[...new Set(s.failed)].join(' | ')}`);
};
async function journey(id, fn) {
  try { pass(id, (await fn()) || 'ok'); }
  catch (e) {
    fail(id, e.message);
    if (lastPage) await lastPage.screenshot({ path: path.join(OUT, `FAIL-${id.split(' ')[0]}.png`) }).catch(() => {});
  }
}

const PARKED = ['/legal-insurance', '/golden-gavel', '/arrest-monitor', '/housing-rights'];
const PRO = [['/attorney-dashboard', 'attorney-dashboard-screen'], ['/conflict-check', 'conflict-check-screen']];

async function gateCard(page, pathName, titleKey) {
  await go(page, pathName);
  await byTid(page, 'core-unavailable').waitFor({ timeout: 15000 });
  const txt = await byTid(page, 'core-unavailable').innerText();
  if (!txt.includes(EN[titleKey])) throw new Error(`${pathName}: "${txt.slice(0, 80)}"`);
  if (!(await byTid(page, 'core-unavailable-home').count())) throw new Error(`${pathName}: no way back`);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const consumer = await newUser('cons');
  const atty = await newUser('atty', 'attorney');

  await journey('S1 Core path opens (signed out and signed in)', async () => {
    for (const [who, acc] of [['guest', null], ['consumer', consumer]]) {
      const s = await open(browser, acc);
      await go(s.page, '/');
      await byTid(s.page, 'home-screen').waitFor({ timeout: 20000 });
      await go(s.page, '/just-arrested');
      if (await byTid(s.page, 'core-unavailable').count()) throw new Error(`${who}: "Just arrested?" gated`);
      await go(s.page, '/court-dates');
      if (await byTid(s.page, 'core-unavailable').count()) throw new Error(`${who}: court dates gated`);
      clean(s, who);
      await s.ctx.close();
    }
    return 'Home, Just arrested?, Court dates open for a guest and a consumer';
  });

  await journey('S2 Parked screens show "Not available yet" (signed out and signed in)', async () => {
    for (const [who, acc] of [['guest', null], ['consumer', consumer]]) {
      const s = await open(browser, acc);
      for (const p of PARKED) await gateCard(s.page, p, 'core_unavailable_title');
      await s.page.screenshot({ path: path.join(OUT, `S2-parked-${who}.png`) });
      await byTid(s.page, 'core-unavailable-home').click();
      await s.page.waitForURL(/just-arrested/, { timeout: 10000 });
      clean(s, who);
      await s.ctx.close();
    }
    return `${PARKED.length} parked screens gated for a guest and a consumer; the button opens "Just arrested?"`;
  });

  await journey('S3 Professional screens: consumer sees the notice, attorney sees the screen', async () => {
    const c = await open(browser, consumer);
    for (const [p] of PRO) await gateCard(c.page, p, 'core_pro_only_title');
    clean(c, 'consumer');
    await c.ctx.close();
    const a = await open(browser, atty);
    for (const [p, tid] of PRO) {
      await go(a.page, p);
      await byTid(a.page, tid).waitFor({ timeout: 20000 });
      if (await byTid(a.page, 'core-unavailable').count()) throw new Error(`attorney gated on ${p}`);
    }
    clean(a, 'attorney');
    await a.ctx.close();
    return `${PRO.length} professional screens: notice for a consumer, the screen for an attorney`;
  });

  await browser.close();
  server.close();
  const failedN = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failedN}/${results.length} passed`);
  process.exit(failedN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
