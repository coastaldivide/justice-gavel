#!/usr/bin/env node
/**
 * web-smoke.cjs — headless runtime smoke test of the exported web build.
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4100/api npx expo export --platform web --output-dir dist
 *   node scripts/web-smoke.cjs dist ../notes/fe-screens [--api http://localhost:4100/api] [--port 8081]
 *
 * Needs Playwright + Chromium (not a project dependency): set PLAYWRIGHT_MODULE
 * to the playwright package path if `require('playwright')` does not resolve.
 *
 * Phases
 *   A  "real" backend: API requests go wherever the bundle points (a backend
 *      may or may not be running there). Walks age gate → onboarding → login →
 *      register → guest browsing → every tab → every deep link in
 *      src/navigation/linking.ts → every MoreStack screen via the desktop
 *      bridge (window.__navigateTo).
 *   B  mocked backend: login succeeds; billing returns 503 payments_unavailable,
 *      AI returns 503 ai_unavailable. Verifies the friendly states and records
 *      the exact login/register request payloads.
 *
 * A screen "fails" on: uncaught page error, the ErrorBoundary text
 * ("Something went wrong"), or an (almost) empty page.
 * Request storms: any screen that issues more than STORM_MAX (default 4)
 * identical API requests (same method + URL incl. query) within STORM_WINDOW_MS
 * (default 3000) fails the run — that is the signature of an effect/dependency
 * loop refetching on every render.
 * Exit code 1 when any screen fails, on any uncaught page error, on any console
 * error (network-level 4xx/5xx/connection noise excluded), or on a storm.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-smoke-out'));
const apiArg = process.argv.indexOf('--api');
const API = (apiArg > 0 ? process.argv[apiArg + 1] : 'http://localhost:4100/api').replace(/\/$/, '');
// Serve on an origin the backend's CORS allow-list accepts (Expo dev origin by default).
const portArg = process.argv.indexOf('--port');
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) : 8081;
fs.mkdirSync(OUT, { recursive: true });

// ── Static server with SPA fallback ─────────────────────────────────────────
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

// ── Routes to visit ─────────────────────────────────────────────────────────
function linkingPaths() {
  const src = fs.readFileSync(path.join(ROOT, 'src/navigation/linking.ts'), 'utf8');
  const main = src.slice(src.indexOf('MainTabs:'), src.indexOf('GuestNav:'));
  const guest = src.slice(src.indexOf('GuestNav:'));
  const grab = (s) => [...s.matchAll(/^\s+(\w+):\s+'([^']*)',/gm)].map(m => ({
    screen: m[1], path: '/' + m[2].replace(/:(\w+)\?/g, '1').replace(/:(\w+)/g, '1'),
  }));
  return { main: grab(main), guest: grab(guest) };
}
function moreStackScreens() {
  const src = fs.readFileSync(path.join(ROOT, 'src/navigation/AppNavigator.tsx'), 'utf8');
  return [...new Set([...src.matchAll(/<MoreStack\.Screen\s+name="(\w+)"/g)].map(m => m[1]))];
}

const STORM_MAX = Number(process.env.STORM_MAX || 4);
const STORM_WINDOW_MS = Number(process.env.STORM_WINDOW_MS || 3000);
/** Groups requests by (screen, method+url) and returns every group with more than
 *  STORM_MAX requests inside any STORM_WINDOW_MS sliding window. */
function findStorms(reqs) {
  const groups = new Map();
  for (const r of reqs) {
    const k = r.at + '\u0000' + r.key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.t);
  }
  const storms = [];
  for (const [k, ts] of groups) {
    ts.sort((a, b) => a - b);
    let worst = 0;
    for (let i = 0, j = 0; j < ts.length; j++) {
      while (ts[j] - ts[i] > STORM_WINDOW_MS) i++;
      worst = Math.max(worst, j - i + 1);
    }
    if (worst > STORM_MAX) { const [at, key] = k.split('\u0000'); storms.push({ at, request: key, inWindow: worst, total: ts.length }); }
  }
  return storms;
}

const FILTER_CONSOLE = /Failed to load resource|net::ERR_|ERR_CONNECTION_REFUSED|status of (4|5)\d\d/;

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const consoleErrors = []; const pageErrors = []; const apiCalls = []; const payloads = {}; const timedRequests = [];
  let current = 'boot';
  page.on('console', m => { if (m.type() === 'error' && !FILTER_CONSOLE.test(m.text())) consoleErrors.push({ at: current, text: m.text().slice(0, 300) }); });
  page.on('pageerror', e => pageErrors.push({ at: current, text: String((e && e.stack) || e).slice(0, 600) }));
  page.on('request', r => {
    if (!r.url().startsWith(API)) return;
    apiCalls.push(r.method() + ' ' + r.url().slice(API.length).split('?')[0]);
    timedRequests.push({ at: current, key: r.method() + ' ' + r.url().slice(API.length), t: Date.now() });
  });

  const results = [];
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const step = async (label, fn) => {
    current = label;
    try { await fn(); console.log('ok   ', label); return true; }
    catch (e) { console.log('FAIL ', label, '-', String(e.message).split('\n')[0]); results.push({ label, ok: false, why: String(e.message).split('\n')[0] }); return false; }
  };
  /** Check the currently rendered screen. */
  const check = async (label, { screenshot } = {}) => {
    current = label;
    const errsBefore = pageErrors.length;
    await page.waitForTimeout(1500);
    const txt = await page.locator('body').innerText().catch(() => '');
    const boundary = /Something went wrong/i.test(txt);
    const blank = txt.replace(/\s+/g, '').length < 15;
    const newPageErrors = pageErrors.slice(errsBefore).filter(e => e.at === label);
    const ok = !boundary && !blank && newPageErrors.length === 0;
    results.push({ label, ok, boundary, blank, chars: txt.length, pageErrors: newPageErrors.map(e => e.text.split('\n')[0]) });
    if (!ok || screenshot) await shot((ok ? '' : 'FAIL-') + (screenshot || label.replace(/[^\w-]+/g, '_')));
    console.log(ok ? 'ok   ' : 'FAIL ', label, ok ? '' : JSON.stringify({ boundary, blank, pageErrors: newPageErrors.map(e => e.text.split('\n')[0]) }));
    return ok;
  };
  const browseAsGuest = async () => {
    await page.evaluate(() => { localStorage.setItem('age_verified', '1'); localStorage.setItem('has_browsed', 'true'); localStorage.setItem('onboarding_done', 'true'); });
  };

  // ── Phase A: first launch flow ───────────────────────────────────────────
  console.log(`\n== Phase A (API ${API}: whatever is running there) ==`);
  current = 'launch';
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await check('launch → age gate', { screenshot: '01-age-gate' });
  await step('age gate: enter adult birth year', async () => {
    await page.getByLabel('Enter your birth year').fill('1990', { timeout: 8000 });
    await page.getByLabel('Continue').click();
  });
  await check('onboarding', { screenshot: '02-onboarding' });
  await step('onboarding → login', () => page.getByText(/Already have an account\?|Sign in \/ Create account/).first().click({ timeout: 5000 }));
  await check('login screen', { screenshot: '03-login' });
  await step('login: submit credentials', async () => {
    await page.getByTestId('login-email-input').fill('smoke@example.com');
    await page.getByTestId('login-password-input').fill('wrongpassword1');
    await page.getByTestId('login-password-input').press('Enter');
    await page.waitForTimeout(3000);
  });
  await check('login after submit (error shown, no crash)', { screenshot: '04-login-error' });
  await step('login → register', () => page.getByLabel('Create one').click({ timeout: 4000 }));
  await check('register screen', { screenshot: '05-register' });
  await step('register → back', async () => { await page.goBack(); await page.waitForTimeout(1000); });
  await step('browse without account', async () => {
    const btn = page.getByText(/Search Without an Account|Browse without|Continue as guest|without an account/i).first();
    if (await btn.count()) await btn.click({ timeout: 4000 });
    else { await browseAsGuest(); await page.goto(base + '/', { waitUntil: 'networkidle' }); }
  });
  await check('home (guest)', { screenshot: '06-home' });

  for (const [tab, name] of [['Lawyers', '07-tab-lawyers'], ['Bail Help', '08-tab-bail'], ['AI Help', '09-tab-chat'], ['Resources', '10-tab-resources'], ['Home', '11-tab-home']]) {
    const pick = page.getByText('Something Else', { exact: true });
    if (await pick.count()) await pick.first().click({ timeout: 2000 }).catch(() => {});
    if (await step('tab ' + tab, () => page.getByText(tab, { exact: true }).last().click({ timeout: 4000 }))) {
      await check('tab ' + tab, { screenshot: name });
    }
  }

  // ── Deep links: every path in linking.ts ─────────────────────────────────
  const { main, guest } = linkingPaths();
  console.log(`\n-- deep links: ${main.length} main-app paths --`);
  for (const { screen, path: p } of main) {
    current = `link ${p} (${screen})`;
    await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(800);
    await check(`link ${p} (${screen})`);
  }
  for (const [p, n] of [['/rights', '12-rights'], ['/deadlines', '13-deadlines'], ['/settings', '14-settings'], ['/plans', '15-plans'], ['/payments', '16-payments'], ['/offline', '17-offline']]) {
    await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1500); await shot(n);
  }

  // ── Every MoreStack screen through the desktop bridge (no params) ────────
  const stack = moreStackScreens();
  console.log(`\n-- programmatic navigation: ${stack.length} MoreStack screens --`);
  await page.goto(base + '/home', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  for (const s of stack) {
    current = `nav ${s}`;
    await page.evaluate((name) => window.__navigateTo && window.__navigateTo(name), s).catch(() => {});
    await page.waitForTimeout(400);
    const ok = await check(`nav ${s}`);
    if (!ok) { await page.goto(base + '/home', { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(1000); }
  }

  // ── Guest navigator deep links (fresh, signed-out state) ─────────────────
  console.log(`\n-- guest paths: ${guest.length} --`);
  for (const { screen, path: p } of guest) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('age_verified', '1'); });
    current = `guest ${p} (${screen})`;
    await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(800);
    await check(`guest ${p} (${screen})`);
  }

  // ── Phase B: mocked backend ──────────────────────────────────────────────
  console.log('\n== Phase B (mocked backend: login ok, payments/AI 503) ==');
  const fakeJwt = (() => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 1, role: 'user', iat: Math.floor(Date.now() / 1000) })}.sig`;
  })();
  await ctx.route(API + '/**', async route => {
    const req = route.request(); const u = req.url(); const m = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.includes('/auth/login')) { payloads.login = req.postDataJSON(); return json(200, { token: fakeJwt, refreshToken: 'r', user: { id: 1, role: 'user', displayName: 'Smoke' } }); }
    if (u.includes('/auth/register')) { payloads.register = req.postDataJSON(); return json(201, { token: fakeJwt, refreshToken: 'r', user: { id: 2, role: 'user', displayName: 'New' } }); }
    if (m === 'POST' && (u.includes('/billing/') || u.includes('/pay/')))
      return json(503, { error: 'payments_unavailable', message: 'Payments are not configured.' });
    if (u.includes('/chat'))
      return json(503, { error: 'ai_unavailable', message: 'AI is not configured.' });
    if (u.includes('/billing/') && m === 'GET') return json(200, { subscription: null, tier: 'free' });
    return json(200, {});
  });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('age_verified', '1'); });
  await page.goto(base + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // Register payload (guest Register screen)
  await step('register: submit (mocked 201)', async () => {
    const onb = page.getByText(/Already have an account\?|Sign in \/ Create account/).first();
    if (await onb.count()) { await onb.click(); await page.waitForTimeout(1000); }
    if (!(await page.getByTestId('register-screen').count())) { await page.getByLabel('Create one').click({ timeout: 4000 }); await page.waitForTimeout(1000); }
    await page.getByTestId('register-email-input').fill('new.user@example.com');
    await page.getByTestId('register-password-input').fill('correcthorse1');
    await page.getByPlaceholder('How should we address you?').fill('New User').catch(() => {});
    await page.getByTestId('register-submit-button').click({ timeout: 4000 });
    await page.waitForTimeout(2500);
  });
  await check('home after register (authed)', { screenshot: '18-home-after-register' });
  // Login payload
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('age_verified', '1'); });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await step('login: valid credentials (mocked 200)', async () => {
    const onb = page.getByText(/Already have an account\?|Sign in \/ Create account/).first();
    if (await onb.count()) { await onb.click(); await page.waitForTimeout(1000); }
    await page.getByTestId('login-email-input').fill('smoke@example.com');
    await page.getByTestId('login-password-input').fill('correcthorse1');
    await page.getByTestId('login-password-input').press('Enter');
    await page.waitForTimeout(2500);
  });
  await check('home after login (authed)', { screenshot: '19-home-authed' });

  for (const [p, re, n] of [['/plans', /Start Free Trial|Upgrade|Subscribe|Get /i, '20-plans-payments-unavailable'],
                            ['/subscribe', /Add Intel Reports|Start Free Trial/i, '21-subscribe-payments-unavailable']]) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await step(`${p}: tap purchase (backend 503 payments_unavailable)`, async () => {
      await page.getByText(re).first().click({ timeout: 4000 });
      await page.getByText(/aren.t available yet/i).first().waitFor({ timeout: 6000 });
    });
    await check(`${p} after payments_unavailable`, { screenshot: n });
  }
  await page.goto(base + '/chat', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await step('chat: ask (backend 503 ai_unavailable)', async () => {
    await page.getByText('Know your rights', { exact: true }).locator('xpath=..').getByRole('button').first().click({ timeout: 4000 });
    await page.getByText(/temporarily unavailable/i).first().waitFor({ timeout: 8000 });
  });
  await check('chat after ai_unavailable', { screenshot: '22-ai-unavailable' });
  for (const s of ['Settings', 'Cases', 'ArrestMonitor', 'Payments', 'ConsumerSubscription', 'AttorneyDashboard']) {
    await page.evaluate((name) => window.__navigateTo && window.__navigateTo(name), s);
    await check(`authed nav ${s}`);
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.ok);
  const storms = findStorms(timedRequests);
  const report = { api: API, checked: results.length, failed, payloads, pageErrors, storms,
    apiRequestCount: timedRequests.length,
    consoleErrors: [...new Map(consoleErrors.map(e => [e.text, e])).values()],
    apiCalls: [...new Set(apiCalls)] };
  fs.writeFileSync(path.join(OUT, 'web-smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nCHECKS: ${results.length}  FAILED: ${failed.length}`);
  failed.forEach(f => console.log('  !', f.label, f.why || JSON.stringify({ boundary: f.boundary, blank: f.blank, pageErrors: f.pageErrors })));
  console.log('PAGE ERRORS (uncaught):', pageErrors.length);
  pageErrors.slice(0, 20).forEach(e => console.log('  -', e.at, '::', e.text.split('\n')[0]));
  console.log('CONSOLE ERRORS (unique, non-network):', report.consoleErrors.length);
  report.consoleErrors.slice(0, 30).forEach(e => console.log('  -', e.at, '::', e.text.split('\n')[0]));
  console.log(`REQUEST STORMS (> ${STORM_MAX} identical requests in ${STORM_WINDOW_MS} ms on one screen):`, storms.length,
    `(${timedRequests.length} API requests total)`);
  storms.slice(0, 30).forEach(s => console.log('  -', s.at, '::', s.request, `x${s.inWindow} in window, x${s.total} total`));
  console.log('PAYLOADS:', JSON.stringify(payloads));
  await browser.close();
  server.close();
  process.exit(failed.length || pageErrors.length || report.consoleErrors.length || storms.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
