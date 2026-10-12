#!/usr/bin/env node
/**
 * web-journeys.cjs — headless, REAL-backend journeys for the audit11 product
 * findings. Unlike web-smoke.cjs (which only checks that screens render), each
 * journey performs the user's actual task and asserts its visible outcome, and
 * fails on an ErrorBoundary ("Something went wrong") that appears AFTER data
 * arrives — the gap that let the bail-calculator crash ship green.
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4100/api npx expo export --platform web --output-dir dist
 *   node scripts/web-journeys.cjs dist out --api http://localhost:4100/api [--server-log path] [--port 8081]
 *
 * The backend must be a real server (production mode is fine) whose CORS list
 * includes http://localhost:<port>, with an Anthropic mock behind
 * ANTHROPIC_BASE_URL for the chat journey.
 *
 * Journeys
 *   H10  register → Terms gate → accept, at 1280×900 (content fits, no scroll
 *        event) AND 390×844 (must scroll); the backend must then report the ToS
 *        AND the AI disclaimer as accepted.
 *   M6   chat answers through /chat/stream; no "Cannot set headers" in the log.
 *   H12  bail calculator lists the schedule, a row opens the bond breakdown.
 *   H11  create a case with a court date → reminders are planned (toast + API),
 *        "Remind me" re-plans without the old 400.
 *   M1   a message with quotes / < / ' renders exactly as typed.
 *   M7   /welcome at 1280: each slide is exactly as wide as the carousel.
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
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4100/api')).replace(/\/$/, '');
const PORT = Number(arg('--port', 8081));
const SERVER_LOG = arg('--server-log', null);
fs.mkdirSync(OUT, { recursive: true });

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
const pass = (id, detail) => { results.push({ id, ok: true, detail }); console.log('PASS ', id, '-', detail); };
const fail = (id, detail) => { results.push({ id, ok: false, detail }); console.log('FAIL ', id, '-', detail); };

let ipSeq = Math.floor(Math.random() * 200);
const freshIp = () => `10.77.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function apiCall(method, p, { token, body, ip } = {}) {
  const r = await fetch(API + p, { method, headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}

async function newContext(browser, viewport) {
  const ip = freshIp();
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', extraHTTPHeaders: { 'X-Forwarded-For': ip } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  return { ctx, page, errors, ip };
}
const boundary = async (page) => /Something went wrong/i.test(await page.locator('body').innerText().catch(() => ''));
const byTid = (page, id) => page.locator(`[data-testid="${id}"]`);

/** Register through the real UI and pass the Terms gate. Returns { email, password, token }. */
async function registerAndAcceptTerms(page, base, label, { mustScroll }) {
  const email = `journey-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@journeys.test`;
  const password = 'CorrectHorse9!';
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('age_verified', '1'); });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  // the real first-run path: welcome → "Sign in" → login → "Create one"
  await page.getByText(/Already have an account\?|Sign in \/ Create account/).first().click({ timeout: 15000 });
  await page.getByLabel('Create one').click({ timeout: 10000 });
  await byTid(page, 'register-email-input').fill(email, { timeout: 15000 });
  await byTid(page, 'register-password-input').fill(password);
  await page.getByPlaceholder('How should we address you?').fill('Journey User').catch(() => {});
  await byTid(page, 'register-submit-button').click();
  const accept = byTid(page, 'tos-accept-button');
  await accept.waitFor({ timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, `${label}-tos-open.png`) });
  // tick the boxes themselves (the first row's label contains a "Terms of
  // Service" link — clicking the row's centre would open the full terms)
  await byTid(page, 'tos-check-terms').click({ position: { x: 10, y: 10 } });
  await byTid(page, 'tos-check-no-advice').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(400);
  const disabledBefore = await accept.getAttribute('aria-disabled');
  if (mustScroll) {
    if (disabledBefore !== 'true') throw new Error(`${label}: "I Agree" was enabled before reading to the end on a small screen`);
    await byTid(page, 'tos-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(500);
  }
  const disabled = await accept.getAttribute('aria-disabled');
  if (disabled === 'true') throw new Error(`${label}: "I Agree" stays disabled with both boxes checked (viewport ${JSON.stringify(page.viewportSize())})`);
  await accept.click();
  await accept.waitFor({ state: 'detached', timeout: 15000 }).catch(async () => {
    if (await accept.isVisible()) throw new Error(`${label}: Terms modal still open after "I Agree"`);
  });
  await page.screenshot({ path: path.join(OUT, `${label}-after-accept.png`) });
  const login = await apiCall('POST', '/auth/login', { body: { identifier: email, password }, ip: freshIp() });
  return { email, password, token: login.body && login.body.token, disabledBefore };
}

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const base = `http://localhost:${PORT}`;
  const browser = await chromium.launch();
  const logBefore = SERVER_LOG && fs.existsSync(SERVER_LOG) ? fs.statSync(SERVER_LOG).size : 0;
  let desk;

  // ── H10 on desktop (and the rest of the journeys in the same session) ─────
  try {
    desk = await newContext(browser, { width: 1280, height: 900 });
    const u = await registerAndAcceptTerms(desk.page, base, 'H10-desktop-1280x900', { mustScroll: false });
    const tos = await apiCall('GET', '/auth/tos-status', { token: u.token });
    const disc = await apiCall('GET', '/auth/disclaimer/status', { token: u.token });
    if (tos.body?.needs_acceptance === false && disc.body?.required === false) pass('H10 desktop 1280×900', `I Agree usable without scrolling (aria-disabled before click: ${u.disabledBefore}); backend: ToS accepted, AI disclaimer accepted`);
    else fail('H10 desktop 1280×900', `backend tos=${JSON.stringify(tos.body)} disclaimer=${JSON.stringify(disc.body)}`);
    desk.user = u;
  } catch (e) { fail('H10 desktop 1280×900', e.message); }

  // ── H10 on a phone viewport ────────────────────────────────────────────
  try {
    const ph = await newContext(browser, { width: 390, height: 844 });
    const u = await registerAndAcceptTerms(ph.page, base, 'H10-phone-390x844', { mustScroll: true });
    const disc = await apiCall('GET', '/auth/disclaimer/status', { token: u.token });
    if (disc.body?.required === false) pass('H10 phone 390×844', 'disabled until scrolled to the end, then accepted; AI disclaimer recorded');
    else fail('H10 phone 390×844', `disclaimer=${JSON.stringify(disc.body)}`);
    await ph.ctx.close();
  } catch (e) { fail('H10 phone 390×844', e.message); }

  const page = desk && desk.page;
  const user = desk && desk.user;

  // ── M6: chat (stream path) after accepting the gate ─────────────────────
  if (page && user) try {
    await page.goto(base + '/chat', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const pick = page.getByText('Something Else', { exact: true });
    if (await pick.count()) await pick.first().click().catch(() => {});
    const box = page.getByPlaceholder('Ask anything -- What should I do? How do I get out?');
    await box.fill('What should I say if police ask me questions?');
    await page.getByText('↑', { exact: true }).last().click();
    await page.getByText(/MOCK REPLY/).first().waitFor({ timeout: 20000 });
    const sorry = await page.getByText(/Sorry, I had trouble responding/i).count();
    await page.screenshot({ path: path.join(OUT, 'M6-chat.png') });
    let headerErr = 0;
    if (SERVER_LOG && fs.existsSync(SERVER_LOG)) {
      const fd = fs.openSync(SERVER_LOG, 'r'); const len = fs.statSync(SERVER_LOG).size - logBefore;
      const buf = Buffer.alloc(Math.max(0, len)); fs.readSync(fd, buf, 0, buf.length, logBefore); fs.closeSync(fd);
      headerErr = (buf.toString('utf8').match(/Cannot set headers|ERR_HTTP_HEADERS_SENT/g) || []).length;
    }
    if (!sorry && !headerErr && !(await boundary(page))) pass('M6 chat stream', 'answer streamed and rendered; 0 "Cannot set headers" in server log');
    else fail('M6 chat stream', `error bubble=${sorry}, header errors in log=${headerErr}`);
  } catch (e) { fail('M6 chat stream', e.message); await page.screenshot({ path: path.join(OUT, 'FAIL-M6.png') }).catch(() => {}); }

  // ── H12: bail calculator ─────────────────────────────────────────────────
  if (page) try {
    await page.goto(base + '/bail-calculator', { waitUntil: 'networkidle' });
    const row = byTid(page, 'bail-schedule-row').first();
    await row.waitFor({ timeout: 15000 });
    const n = await byTid(page, 'bail-schedule-row').count();
    await page.getByPlaceholder('e.g. DUI, assault, theft…').fill('DUI');
    await page.waitForTimeout(400);
    await byTid(page, 'bail-schedule-row').first().click();
    await byTid(page, 'bail-bond-cost').first().waitFor({ timeout: 5000 });
    const cost = await byTid(page, 'bail-bond-cost').first().innerText();
    // the explanation box must be readable (text colour differs from its background)
    const contrastOk = await byTid(page, 'bail-how-bondsmen-work').first().evaluate(el => {
      const bg = getComputedStyle(el).backgroundColor; const fg = getComputedStyle(el.querySelector('div[dir]') || el).color;
      return bg !== fg;
    }).catch(() => false);
    if (!contrastOk) throw new Error('"How bail bondsmen work" text is the same colour as its background');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'H12-bail-calculator.png') });
    if (!(await boundary(page)) && desk.errors.filter(e => /filter is not a function/.test(e)).length === 0) pass('H12 bail calculator', `${n} schedule rows; breakdown shown ("${cost.replace(/\s+/g, ' ').trim()}")`);
    else fail('H12 bail calculator', 'ErrorBoundary / crash after data load');
  } catch (e) { fail('H12 bail calculator', e.message); await page.screenshot({ path: path.join(OUT, 'FAIL-H12.png') }).catch(() => {}); }

  // ── H11: case with a court date → reminders ──────────────────────────────
  if (page && user) try {
    const court = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
    await page.goto(base + '/cases', { waitUntil: 'networkidle' });
    await byTid(page, 'case-add-button').click({ timeout: 10000 });
    await byTid(page, 'case-title-input').fill('Journey DUI case');
    await page.getByPlaceholder('YYYY-MM-DD (e.g. 2025-11-15)').fill(court);
    await page.getByLabel('Save', { exact: true }).click();
    await page.getByText(/Court reminders set/).first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'H11-case-reminders-toast.png') });
    await page.waitForTimeout(3500);
    await byTid(page, 'case-remind-me').first().click({ timeout: 10000 });
    const toast = page.getByText(/Court reminders set|Court reminders are set|Could not set reminder/).first();
    await toast.waitFor({ timeout: 10000 });
    const toastText = await toast.innerText();
    const rem = await apiCall('GET', '/push/reminders', { token: user.token });
    const court4 = (rem.body || []).filter(r => r.type === 'court_reminder' && r.court_date === court).length;
    if (!/Could not/.test(toastText) && court4 === 4) pass('H11 court reminders', `case saved with ${court} → 4 court reminders planned; "Remind me" → "${toastText.slice(0, 60)}…"`);
    else fail('H11 court reminders', `toast="${toastText}", court reminders=${court4}`);
  } catch (e) { fail('H11 court reminders', e.message); }

  // ── M1: text renders exactly as typed ────────────────────────────────────
  if (page && user) try {
    const text = 'I don\'t know what "bail" means <3';
    const cas = await apiCall('POST', '/cases', { token: user.token, body: { title: 'State v. "Doe"' } });
    await apiCall('POST', `/messages/${cas.body.id}`, { token: user.token, body: { body: text } });
    await page.goto(base + `/messages/${cas.body.id}`, { waitUntil: 'networkidle' });
    await page.getByText(text, { exact: true }).first().waitFor({ timeout: 10000 });
    const body = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(OUT, 'M1-message.png') });
    if (!/&quot;|&#x27;|&lt;/.test(body)) pass('M1 exact text', 'message with \' " < shown verbatim, no HTML entities on screen');
    else fail('M1 exact text', 'HTML entities visible');
  } catch (e) { fail('M1 exact text', e.message); }

  // ── M7: welcome carousel on desktop ──────────────────────────────────────
  try {
    const w = await newContext(browser, { width: 1280, height: 900 });
    await w.page.goto(base + '/', { waitUntil: 'networkidle' });
    await w.page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('age_verified', '1'); });
    await w.page.goto(base + '/welcome', { waitUntil: 'networkidle' });
    await w.page.waitForTimeout(1500);
    const car = await byTid(w.page, 'onboarding-carousel').boundingBox();
    const slides = byTid(w.page, 'onboarding-slide');
    const first = await slides.first().boundingBox();
    const titleVisible = await slides.first().locator('div[dir="auto"]').first().isVisible().catch(() => false);
    await w.page.screenshot({ path: path.join(OUT, 'M7-welcome-1280.png') });
    // advance one slide and check it lines up with the carousel again
    await w.page.getByLabel(/Next/i).first().click().catch(() => {});
    await w.page.waitForTimeout(900);
    const second = await slides.nth(1).boundingBox();
    await w.page.screenshot({ path: path.join(OUT, 'M7-welcome-1280-slide2.png') });
    const aligned = car && first && Math.abs(first.width - car.width) <= 1 && Math.abs(first.x - car.x) <= 1;
    const aligned2 = car && second && Math.abs(second.x - car.x) <= 2;
    if (aligned && aligned2 && titleVisible) pass('M7 welcome carousel', `carousel ${Math.round(car.width)} px; slide 1 ${Math.round(first.width)} px at x=${Math.round(first.x - car.x)}; slide 2 x=${Math.round(second.x - car.x)} after Next`);
    else fail('M7 welcome carousel', `carousel=${JSON.stringify(car)} slide1=${JSON.stringify(first)} slide2=${JSON.stringify(second)} titleVisible=${titleVisible}`);
    await w.ctx.close();
  } catch (e) { fail('M7 welcome carousel', e.message); }

  if (desk) {
    const pe = desk.errors.filter(Boolean);
    if (pe.length) fail('no uncaught page errors', pe.slice(0, 5).join(' | ')); else pass('no uncaught page errors', 'desktop session');
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'web-journeys-report.json'), JSON.stringify(results, null, 2));
  const bad = results.filter(r => !r.ok);
  console.log(`\nJOURNEYS: ${results.length}  FAILED: ${bad.length}`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
