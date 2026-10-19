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
 *   H12  bail calculator lists the schedule, a row opens the breakdown (range +
 *        fee note; no unsourced 10% estimate).
 *   H11  create a case with a court date → reminders are planned (toast + API),
 *        "Remind me" re-plans without the old 400.
 *   M1   a message with quotes / < / ' renders exactly as typed.
 *   M7   /welcome at 1280: each slide is exactly as wide as the carousel.
 *   CORE "Just arrested?" end to end at 390×844 in America/Chicago: guest →
 *        Just arrested → state rights card (sources) → combined lawyer + bail
 *        results with a filter → report a listing → sign up → add a court date
 *        (courthouse) → .ics download (content checked) → reminders at 7d / 3d /
 *        1d / morning-of (schedule rows checked) → share with a family follower
 *        (consent + code) → the follower's account sees the court date but not
 *        the case notes → airplane mode: rights card + court date still shown.
 *   I18N "Just arrested?" in Spanish (es-US) and Vietnamese (vi-VN) browsers:
 *        the app starts in the device language, every API call carries it
 *        (Accept-Language), and the hub (3 steps), the state's rights card,
 *        the combined results (server notes) and the court-date guidance are
 *        in that language — no English sentence from en.json on any of them.
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
  const disabledBefore = await acceptTerms(page, label, { mustScroll });
  const login = await apiCall('POST', '/auth/login', { body: { identifier: email, password }, ip: freshIp() });
  return { email, password, token: login.body && login.body.token, disabledBefore };
}

/** Pass the Terms gate that opens after sign-up. Returns aria-disabled before scrolling. */
async function acceptTerms(page, label, { mustScroll }) {
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
  return disabledBefore;
}


// ── CORE: the "Just arrested?" path end to end ───────────────────────────────
const dayPlus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
/** Client-side navigation (no reload) — used once the network is off. */
async function spaGo(page, pathname) {
  await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); }, pathname);
  await page.waitForTimeout(1200);
  if (process.env.JOURNEY_DEBUG) console.log('SPA', pathname);
}
const bodyText = (page) => page.locator('body').innerText().catch(() => '');

async function coreJourney(browser, base) {
  const ID = 'CORE';
  const step = async (name, fn) => {
    try { const d = await fn(); pass(`${ID} ${name}`, d || 'ok'); return true; }
    catch (e) { fail(`${ID} ${name}`, e.message); await ctx.page.screenshot({ path: path.join(OUT, `FAIL-CORE-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {}); return false; }
  };
  const ip = freshIp();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Chicago', acceptDownloads: true,
    serviceWorkers: 'block', extraHTTPHeaders: { 'X-Forwarded-For': ip } });
  const page = await context.newPage();
  const ctx = { page };
  const errors = [];
  page.on('pageerror', e => { errors.push(String(e && e.message || e)); if (process.env.JOURNEY_DEBUG) console.log('PAGEERROR', e && e.stack); });
  if (process.env.JOURNEY_DEBUG) {
    await page.addInitScript(() => {
      window.addEventListener('unhandledrejection', (ev) => { console.log('UNHANDLED', String(ev.reason && (ev.reason.stack || ev.reason.message || ev.reason)), ev.reason && ev.reason.name); });
      window.addEventListener('error', (ev) => { console.log('WINERROR', ev.message, ev.filename, ev.lineno, ev.error && ev.error.stack); });
    });
    page.on('console', m => { if (/UNHANDLED|WINERROR/.test(m.text())) console.log(m.text().slice(0, 1500)); });
  }
  const state = {};

  let ok = await step('1 guest opens the app → "Just arrested?" → step 1 of 3', async () => {
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('age_verified', '1'); });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await byTid(page, 'onboarding-just-arrested').click({ timeout: 15000 });
    await byTid(page, 'core-step-rights').waitFor({ timeout: 20000 });
    const t = await byTid(page, 'core-step-label').innerText();
    if (!/STEP 1 OF 3/.test(t)) throw new Error(`step label "${t}"`);
    if (await boundary(page)) throw new Error('ErrorBoundary');
    return 'first screen → Just arrested hub, no account';
  });

  if (ok) ok = await step('2 rights card for the state, every section sourced', async () => {
    await byTid(page, 'core-state-button').click();
    await byTid(page, 'core-state-TN').click({ timeout: 10000 });
    await page.getByText('“I am invoking my right to remain silent.”').first().waitFor({ timeout: 10000 });
    const src = await byTid(page, 'core-script-source').innerText();
    if (!/Source:.*Last reviewed: April 2026/.test(src)) throw new Error(`script source line: "${src}"`);
    await byTid(page, 'core-open-rights-card').click();
    // unreviewed state notes are never shown: the review-pending notice instead
    await byTid(page, 'rights-state-notice').filter({ hasText: /Tennessee haven't been reviewed yet/ }).first().waitFor({ timeout: 15000 });
    if (await byTid(page, 'rights-state-section').count()) throw new Error('an unreviewed state section is shown');
    if (/You must provide your name|T\.C\.A\./.test(await bodyText(page))) throw new Error('unreviewed state note text on the rights card');
    const sources = await byTid(page, 'rights-source').count();
    const sections = await byTid(page, 'rights-section').count();
    if (sources < sections || sections < 8) throw new Error(`${sections} sections but ${sources} source lines`);
    const txt = await bodyText(page);
    if (/Subscribe|10%/.test(txt)) throw new Error('paywall or unsourced fee text on the rights card');
    await page.screenshot({ path: path.join(OUT, 'CORE-2-rights-TN.png') });
    return `${sections} general sections, each with source + last reviewed; Tennessee notes pending review; no paywall`;
  });

  if (ok) ok = await step('3 combined lawyer + bail results with a filter', async () => {
    await page.goto(base + '/just-arrested', { waitUntil: 'networkidle' });
    await byTid(page, 'core-step-body').waitFor({ timeout: 15000 });
    if (await byTid(page, 'core-next-1').count()) await byTid(page, 'core-next-1').click();
    await byTid(page, 'core-find-help').click({ timeout: 10000 });
    await byTid(page, 'help-lawyer-card').first().waitFor({ timeout: 20000 });
    const lawyers = await byTid(page, 'help-lawyer-card').count();
    const bail = await byTid(page, 'help-bail-card').count();
    if (!lawyers || !bail) throw new Error(`lawyers=${lawyers} bail=${bail}`);
    await byTid(page, 'help-filter-24').click();
    await page.waitForTimeout(2500);
    const cards = await byTid(page, 'help-bail-card').count() + await byTid(page, 'help-lawyer-card').count();
    const badges = await byTid(page, 'help-247-badge').count();
    if (!cards || badges !== cards) throw new Error(`24/7 filter: ${cards} cards but ${badges} 24/7 badges`);
    const note = await byTid(page, 'help-ranking-note').innerText();
    if (!/Never by payment/.test(note)) throw new Error('ranking note missing');
    await page.screenshot({ path: path.join(OUT, 'CORE-3-help-24-7.png') });
    return `${lawyers} lawyers + ${bail} bail agents together; 24/7 filter → ${cards} listings, all 24/7`;
  });

  if (ok) ok = await step('4 report a listing → queued (twice = one report)', async () => {
    await byTid(page, 'help-report').first().click();
    await byTid(page, 'report-modal').waitFor({ timeout: 5000 });
    await byTid(page, 'report-reason-wrong_hours').click();
    await byTid(page, 'report-submit').click();
    await page.getByText(/our team will check this listing/).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
    await byTid(page, 'help-report').first().click();
    await byTid(page, 'report-reason-wrong_hours').click();
    await byTid(page, 'report-submit').click();
    await page.getByText(/You already reported this/).first().waitFor({ timeout: 10000 });
    return 'report accepted; a repeat is recognised as the same report';
  });

  if (ok) ok = await step('5 court dates need an account — clear prompt for a guest', async () => {
    await page.goto(base + '/court-dates', { waitUntil: 'networkidle' });
    await byTid(page, 'court-dates-sign-in').waitFor({ timeout: 15000 });
    return 'guest sees "Sign in to save your court date…"';
  });

  if (ok) ok = await step('6 sign up', async () => {
    state.email = `core-${Date.now().toString(36)}@journeys.test`; state.password = 'CorrectHorse9!';
    await byTid(page, 'court-dates-register').click();
    await byTid(page, 'register-email-input').fill(state.email, { timeout: 15000 });
    await byTid(page, 'register-password-input').fill(state.password);
    await page.getByPlaceholder('How should we address you?').fill('Casey Journey').catch(() => {});
    await byTid(page, 'register-submit-button').click();
    await acceptTerms(page, 'CORE-6', { mustScroll: true });
    const login = await apiCall('POST', '/auth/login', { body: { identifier: state.email, password: state.password }, ip: freshIp() });
    state.token = login.body && login.body.token;
    if (!state.token) throw new Error(`login after sign-up: ${login.status}`);
    return 'registered in the app, Terms accepted';
  });

  if (ok) ok = await step('7 add a court date with its courthouse → detail with 4 reminders', async () => {
    state.day = dayPlus(15);
    await page.goto(base + '/court-dates', { waitUntil: 'networkidle' });
    await byTid(page, 'court-date-add').click({ timeout: 15000 });
    await byTid(page, 'court-form-date').waitFor({ timeout: 10000 });
    if (await byTid(page, 'court-form-title').count()) await byTid(page, 'court-form-title').fill('DUI — Davidson County');
    await byTid(page, 'court-form-date').fill(state.day);
    await byTid(page, 'court-form-time').fill('09:30');
    await byTid(page, 'court-form-hearing-arraignment').click();
    await byTid(page, 'court-form-courthouse-q').fill('Davidson');
    await byTid(page, 'court-form-courthouse-search').click();
    await byTid(page, 'court-form-courthouse-option').first().click({ timeout: 10000 });
    await byTid(page, 'court-form-save').click();
    await byTid(page, 'court-date-detail-screen').waitFor({ timeout: 20000 });
    await byTid(page, 'court-date-courthouse').waitFor({ timeout: 10000 });
    await byTid(page, 'court-reminder-row').nth(3).waitFor({ timeout: 10000 });
    const rows = await byTid(page, 'court-reminder-row').count();
    if (rows !== 4) throw new Error(`${rows} reminder rows`);
    state.cdId = Number((page.url().match(/court-dates\/(\d+)/) || [])[1]);
    if (!state.cdId) {
      const list = await apiCall('GET', '/court-dates', { token: state.token });
      state.cdId = list.body.upcoming[0].id;
    }
    await page.screenshot({ path: path.join(OUT, 'CORE-7-court-date.png') });
    return `court date ${state.day} 09:30 saved (id ${state.cdId}) with courthouse; 4 reminders listed`;
  });

  if (ok) ok = await step('8 .ics downloads with a correct VEVENT in America/Chicago', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), byTid(page, 'court-date-ics').click()]);
    const file = path.join(OUT, dl.suggestedFilename());
    await dl.saveAs(file);
    const ics = fs.readFileSync(file, 'utf8');
    const ymd = state.day.replace(/-/g, '');
    const need = ['BEGIN:VCALENDAR', 'BEGIN:VTIMEZONE', 'TZID:America/Chicago', `DTSTART;TZID=America/Chicago:${ymd}T093000`, `DTEND;TZID=America/Chicago:${ymd}T103000`, 'SUMMARY:Court: DUI — Davidson County', 'LOCATION:', 'END:VEVENT', 'END:VCALENDAR'];
    const missing = need.filter(n => !ics.includes(n));
    if (missing.length) throw new Error(`.ics missing ${missing.join(', ')}`);
    if (dl.suggestedFilename() !== `court-date-${state.day}.ics`) throw new Error(`filename ${dl.suggestedFilename()}`);
    return `${dl.suggestedFilename()} (${ics.length} bytes): DTSTART;TZID=America/Chicago:${ymd}T093000, VTIMEZONE, LOCATION`;
  });

  if (ok) ok = await step('9 reminders scheduled at 7d / 3d / 1d / morning-of (schedule rows)', async () => {
    const r = await apiCall('GET', `/court-dates/${state.cdId}/reminders`, { token: state.token });
    const fmt = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
    const minus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
    const got = Object.fromEntries((r.body.reminders || []).map(x => [x.days_before, fmt(x.deliver_at)]));
    const want = { 7: `${minus(state.day, 7)}, 09:00`, 3: `${minus(state.day, 3)}, 09:00`, 1: `${minus(state.day, 1)}, 18:00`, 0: `${state.day}, 06:30` };
    for (const k of Object.keys(want)) if (got[k] !== want[k]) throw new Error(`days_before ${k}: got ${got[k]}, want ${want[k]} (zone ${r.body.time_zone})`);
    if (r.body.time_zone !== 'America/Chicago') throw new Error(`zone ${r.body.time_zone}`);
    return `4 rows: ${Object.values(want).join(' · ')} (America/Chicago)`;
  });

  if (ok) ok = await step('10 share with a family follower (consent + code)', async () => {
    const cd = await apiCall('GET', `/court-dates/${state.cdId}`, { token: state.token });
    state.caseId = cd.body.case_id;
    await apiCall('PUT', `/cases/${state.caseId}`, { token: state.token, body: { notes: 'JOURNEY SECRET NOTE: talked to the officer' } });
    await byTid(page, 'court-date-share-family').click();
    await byTid(page, 'family-name').fill('Mom');
    const create = byTid(page, 'family-create-invite');
    if ((await create.getAttribute('aria-disabled')) !== 'true') throw new Error('invite possible without consent');
    await byTid(page, 'family-consent').click();
    await create.click();
    state.code = (await byTid(page, 'family-code-text').innerText({ timeout: 10000 })).trim();
    if (!/^[A-Z2-9]{10}$/.test(state.code)) throw new Error(`code "${state.code}"`);
    return `consent required; code ${state.code.slice(0, 3)}… created`;
  });

  let follower;
  if (ok) ok = await step('11 follower account sees the court date but not the notes', async () => {
    follower = await newContext(browser, { width: 1280, height: 900 });
    const u = await registerAndAcceptTerms(follower.page, base, 'CORE-11-follower', { mustScroll: false });
    await follower.page.goto(base + '/court-dates', { waitUntil: 'networkidle' });
    await byTid(follower.page, 'follow-code-input').fill(state.code, { timeout: 15000 });
    await byTid(follower.page, 'follow-code-submit').click();
    await byTid(follower.page, 'following-court-date').first().waitFor({ timeout: 15000 });
    const txt = await bodyText(follower.page);
    if (!/DUI — Davidson County/.test(txt)) throw new Error('followed case title not shown');
    if (/JOURNEY SECRET NOTE|talked to the officer/.test(txt)) throw new Error('follower sees the case notes');
    const api = await apiCall('GET', '/following', { token: u.token });
    const blob = JSON.stringify(api.body);
    if (/JOURNEY SECRET NOTE/.test(blob) || !blob.includes(state.day)) throw new Error('follower API leaks notes or misses the date');
    const peek = await apiCall('GET', `/court-dates/${state.cdId}`, { token: u.token });
    if (peek.status !== 404) throw new Error(`follower can open the owner's court date directly: ${peek.status}`);
    const rem = await apiCall('GET', '/push/reminders', { token: u.token });
    const fr = (rem.body || []).filter(x => x.type === 'follower_court_reminder' && x.court_date === state.day).length;
    if (fr !== 4) throw new Error(`follower reminders: ${fr}`);
    await follower.page.screenshot({ path: path.join(OUT, 'CORE-11-follower.png') });
    return 'follower sees the date + courthouse, gets the same 4 reminders; notes hidden; direct read → 404';
  });

  if (ok) ok = await step('12 airplane mode: rights card, court date and saved contacts still shown', async () => {
    // visit them once online (the app keeps a copy), then cut the network
    await page.evaluate(() => localStorage.setItem('contacts', JSON.stringify(['6155550101', '', ''])));
    await page.goto(base + '/emergency-share', { waitUntil: 'networkidle' });
    await page.getByText('6155550101').first().waitFor({ timeout: 15000 });
    await page.goto(base + '/rights', { waitUntil: 'networkidle' });
    await byTid(page, 'rights-state-notice').filter({ hasText: /Tennessee haven't been reviewed yet/ }).first().waitFor({ timeout: 15000 });
    await page.goto(base + '/court-dates', { waitUntil: 'networkidle' });
    await byTid(page, 'court-date-row').first().waitFor({ timeout: 15000 });
    if (process.env.JOURNEY_DEBUG) console.log('OFFLINE ON');
    await context.setOffline(true);
    await spaGo(page, '/rights');
    await byTid(page, 'rights-offline').waitFor({ timeout: 15000 });
    await byTid(page, 'rights-state-notice').filter({ hasText: /Tennessee haven't been reviewed yet/ }).first().waitFor({ timeout: 5000 });
    await byTid(page, 'rights-section').first().waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(OUT, 'CORE-12-offline-rights.png') });
    await spaGo(page, '/court-dates');
    await byTid(page, 'court-dates-offline').waitFor({ timeout: 15000 });
    const txt = await bodyText(page);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(state.day);
    const label = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    if (!txt.includes(label)) throw new Error(`offline court dates do not show ${label}`);
    await page.screenshot({ path: path.join(OUT, 'CORE-12-offline-court-dates.png') });
    await spaGo(page, '/emergency-share');
    await page.getByText('6155550101').first().waitFor({ timeout: 10000 });
    await spaGo(page, '/just-arrested');
    await byTid(page, 'core-step-1').click({ timeout: 10000 });   // the hub resumes at the saved step
    await page.getByText('“I am invoking my right to remain silent.”').first().waitFor({ timeout: 10000 });
    await context.setOffline(false);
    return `offline: rights card (Tennessee, saved copy), court date ${label}, saved emergency contact and the step-1 script shown`;
  });

  const pe = errors.filter(Boolean);
  if (pe.length) fail(`${ID} no uncaught page errors`, pe.slice(0, 5).join(' | ')); else pass(`${ID} no uncaught page errors`, 'core journey session');
  if (follower) await follower.ctx.close();
  await context.close();
}

// ── I18N: the core path in Spanish and Vietnamese ───────────────────────────
const I18N_DIR = path.join(ROOT, 'src', 'i18n');
const readLang = (l) => JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${l}.json`), 'utf8'));
/** English sentence fragments (2+ words, 8+ chars) from en.json that the target language never uses. */
function englishFragments(target) {
  const all = Object.values(target).join('\n');
  const out = new Set();
  for (const v of Object.values(readLang('en'))) {
    for (const raw of String(v).split(/[.!?:;—•\n()“”"·→←]+/)) {
      const f = raw.trim();
      if (f.length < 8 || (f.match(/[A-Za-z]{2,}/g) || []).length < 2 || /\{\w+\}/.test(f) || all.includes(f)) continue;
      // Example place names in placeholders ("Shelby County") are proper nouns that real
      // provider / jail records also carry — data, not app text.
      if (/^(?:[A-Z][a-z]+ )+County$/.test(f)) continue;
      out.add(f);
    }
  }
  return [...out];
}
async function langJourney(browser, base, lang, locale) {
  const ID = `I18N-${lang}`;
  const L = readLang(lang);
  const fragments = englishFragments(L);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale, timezoneId: 'America/Chicago',
    serviceWorkers: 'block', extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  const apiLangs = new Set();
  const otherLang = [];
  page.on('request', r => { if (r.url().startsWith(API)) { const h = r.headers()['accept-language'] || '(none)'; apiLangs.add(h); if (h !== lang) otherLang.push(`${r.method()} ${r.url().slice(API.length)} [${h}]`); } });
  // `data`: server records shown as-is (provider / public-defender names, firm names) — not app text.
  const noEnglish = async (where, data = []) => {
    let txt = await bodyText(page);
    for (const d of data.filter(Boolean).sort((x, y) => y.length - x.length)) txt = txt.split(d).join(' ');
    const leaks = fragments.filter(f => txt.includes(f));
    if (leaks.length) throw new Error(`${where}: English text shown: ${leaks.slice(0, 5).map(x => JSON.stringify(x)).join(', ')}`);
    if (/Something went wrong/i.test(txt)) throw new Error(`${where}: ErrorBoundary`);
    return txt;
  };
  const step = async (name, fn) => {
    try { pass(`${ID} ${name}`, (await fn()) || 'ok'); return true; }
    catch (e) { fail(`${ID} ${name}`, e.message); await page.screenshot({ path: path.join(OUT, `FAIL-${ID}-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {}); return false; }
  };
  const fill = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m));

  let ok = await step('1 the app opens in the device language; hub step 1 + the script', async () => {
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('age_verified', '1'); });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await byTid(page, 'onboarding-just-arrested').click({ timeout: 15000 });
    await byTid(page, 'core-step-rights').waitFor({ timeout: 20000 });
    const label = await byTid(page, 'core-step-label').innerText();
    if (label.trim() !== fill(L.ja_step_of, { n: 1 })) throw new Error(`step label "${label}"`);
    await byTid(page, 'core-state-button').click();
    await byTid(page, 'core-state-TN').click({ timeout: 10000 });
    await page.getByText(`“${L.rs_say_1}”`).first().waitFor({ timeout: 10000 });
    await byTid(page, 'core-state-notice').filter({ hasText: fill(L.rc_state_pending, { state: 'Tennessee' }).slice(0, 25) }).first().waitFor({ timeout: 15000 });
    const src = await byTid(page, 'core-script-source').innerText();
    if (!src.startsWith(`${L.rc_source}: ${L.rc_script_source}`)) throw new Error(`source line "${src}"`);
    await noEnglish('hub step 1');
    return `"${label.trim()}", script + source + Tennessee notice in ${lang}`;
  });

  if (ok) ok = await step('2 rights card: 8 sections from the server in the language', async () => {
    await byTid(page, 'core-open-rights-card').click();
    await byTid(page, 'rights-state-notice').first().waitFor({ timeout: 15000 });
    const n = await byTid(page, 'rights-section').count();
    if (n !== 8) throw new Error(`${n} sections`);
    const txt = await noEnglish('rights card');
    for (const k of ['rc_b1', 'rc_b5', 'rc_b8']) if (!txt.includes(L[k].split('\n')[0])) throw new Error(`${k} not shown in ${lang}`);
    const card = await apiCall('GET', `/rights/TN?lang=${lang}`);
    if (card.body?.language !== lang) throw new Error(`server language ${card.body?.language}`);
    await page.screenshot({ path: path.join(OUT, `${ID}-2-rights.png`) });
    return `8 sections, server language=${card.body.language}`;
  });

  if (ok) ok = await step('3 steps 2 and 3: combined results with the server notes, court-date prompt and missed-date guidance', async () => {
    await page.goto(base + '/just-arrested', { waitUntil: 'networkidle' });
    await byTid(page, 'core-step-body').waitFor({ timeout: 15000 });
    if (await byTid(page, 'core-next-1').count()) await byTid(page, 'core-next-1').click();
    await byTid(page, 'core-step-help').waitFor({ timeout: 10000 });
    await noEnglish('hub step 2');
    await byTid(page, 'core-find-help').click({ timeout: 10000 });
    await byTid(page, 'help-lawyer-card').first().waitFor({ timeout: 20000 });
    const note = await byTid(page, 'help-ranking-note').innerText();
    const srv = await apiCall('GET', `/help/nearby?state=TN&lang=${lang}`);
    if (!note.includes(srv.body.meta.ranking)) throw new Error(`ranking note not the server's ${lang} text: "${note}"`);
    const records = [...(srv.body.lawyers || []), ...(srv.body.bail_agents || [])].flatMap(p => [p.name, p.organization, p.address]);
    const pd = srv.body.public_defender || {};
    await noEnglish('help now', [...records, pd.name, pd.eligibility, pd.about]);
    await page.goto(base + '/court-dates', { waitUntil: 'networkidle' });
    await byTid(page, 'court-dates-sign-in').waitFor({ timeout: 15000 });
    await page.getByText(L.ja_missed).first().click();
    await byTid(page, 'missed-guidance').waitFor({ timeout: 10000 });
    const txt = await noEnglish('court dates (guest)');
    if (!txt.includes(L.cg_missed_4)) throw new Error('missed-date guidance last step not shown in the language');
    await page.screenshot({ path: path.join(OUT, `${ID}-3-court-dates.png`) });
    return 'results notes = server text; sign-in prompt, checklist and missed-date guidance in the language';
  });

  let token = null;
  if (ok) ok = await step('3b sign up in the language (form, Terms gate)', async () => {
    const email = `i18n-${lang}-${Date.now().toString(36)}@journeys.test`; const password = 'CorrectHorse9!';
    await byTid(page, 'court-dates-register').click();
    await byTid(page, 'register-email-input').fill(email, { timeout: 15000 });
    await byTid(page, 'register-password-input').fill(password);
    await page.getByPlaceholder(L.x_rg_how_should_we_address).fill('Ana').catch(() => {});
    await noEnglish('register');
    await byTid(page, 'register-submit-button').click();
    await byTid(page, 'tos-accept-button').waitFor({ timeout: 20000 });
    await noEnglish('terms gate');
    await acceptTerms(page, `${ID}-3b`, { mustScroll: true });
    const login = await apiCall('POST', '/auth/login', { body: { identifier: email, password }, ip: freshIp() });
    token = login.body && login.body.token;
    if (!token) throw new Error(`login after sign-up: ${login.status}`);
    return 'register form + Terms gate in the language';
  });

  if (ok) ok = await step('3c case screen: a case with its status and court date in the language', async () => {
    const title = lang === 'vi' ? 'Vụ 9' : 'Caso 9';
    const cas = await apiCall('POST', '/cases', { token, body: { title, case_type: 'DUI', state: 'TN', next_court_date: dayPlus(20) } });
    if (cas.status >= 300) throw new Error(`create case: ${cas.status}`);
    await page.goto(base + '/cases', { waitUntil: 'networkidle' });
    await page.getByText(title).first().waitFor({ timeout: 15000 });
    const txt = await noEnglish('case screen');
    const status = cas.body?.status || cas.body?.case?.status;
    if (status === 'Open' && !txt.includes(L.case_status_open)) throw new Error('case status not shown in the language');
    await page.screenshot({ path: path.join(OUT, `${ID}-3c-cases.png`) });
    return `case list, status "${L.case_status_open}"`;
  });

  if (ok) ok = await step('3d Settings in the language', async () => {
    await page.goto(base + '/settings', { waitUntil: 'networkidle' });
    await byTid(page, 'settings-screen').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await noEnglish('settings');
    await page.screenshot({ path: path.join(OUT, `${ID}-3d-settings.png`) });
    return 'settings rows, account and language sections';
  });

  if (ok) await step('4 every API call carried the language', async () => {
    const langs = [...apiLangs];
    if (!langs.length || langs.some(x => x !== lang)) throw new Error(`Accept-Language seen: ${langs.join(', ')}; not the app language: ${otherLang.slice(0, 6).join(' | ')}`);
    return `Accept-Language: ${langs.join(', ')} on every request`;
  });
  if (errors.length) fail(`${ID} no uncaught page errors`, errors.slice(0, 3).join(' | ')); else pass(`${ID} no uncaught page errors`, `${lang} session`);
  await context.close();
}

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const base = `http://localhost:${PORT}`;
  const browser = await chromium.launch();
  const logBefore = SERVER_LOG && fs.existsSync(SERVER_LOG) ? fs.statSync(SERVER_LOG).size : 0;
  let desk;

  // ── CORE: "Just arrested?" end to end ──────────────────────────────────────
  if (!process.argv.includes('--skip-core')) await coreJourney(browser, base).catch(e => fail('CORE journey', e.message));
  // ── I18N: the same path in Spanish and Vietnamese ─────────────────────────
  if (!process.argv.includes('--skip-i18n')) {
    await langJourney(browser, base, 'es', 'es-US').catch(e => fail('I18N-es journey', e.message));
    await langJourney(browser, base, 'vi', 'vi-VN').catch(e => fail('I18N-vi journey', e.message));
  }
  if (process.argv.includes('--only-core')) {
    await browser.close(); server.close();
    fs.writeFileSync(path.join(OUT, 'web-journeys-report.json'), JSON.stringify(results, null, 2));
    const badC = results.filter(r => !r.ok);
    console.log(`\nJOURNEYS: ${results.length}  FAILED: ${badC.length}`);
    process.exit(badC.length ? 1 : 0);
  }

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
    await byTid(page, 'bail-fee-note').first().waitFor({ timeout: 5000 });
    const cost = await byTid(page, 'bail-fee-note').first().innerText();
    if (/10\s?%/.test(await page.locator('body').innerText())) throw new Error('unsourced "10%" bail-agent fee estimate shown');
    // the explanation box must be readable (text colour differs from its background)
    const contrastOk = await byTid(page, 'bail-how-bondsmen-work').first().evaluate(el => {
      const bg = getComputedStyle(el).backgroundColor; const fg = getComputedStyle(el.querySelector('div[dir]') || el).color;
      return bg !== fg;
    }).catch(() => false);
    if (!contrastOk) throw new Error('"How bail bondsmen work" text is the same colour as its background');
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'H12-bail-calculator.png') });
    if (!(await boundary(page)) && desk.errors.filter(e => /filter is not a function/.test(e)).length === 0) pass('H12 bail calculator', `${n} schedule rows; breakdown shows the range + honest fee note ("${cost.replace(/\s+/g, ' ').trim().slice(0, 60)}…"), no 10% estimate`);
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
