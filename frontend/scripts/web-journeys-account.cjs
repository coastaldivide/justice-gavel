#!/usr/bin/env node
/**
 * web-journeys-account.cjs — section B (sign-up, sign-in & account) journeys
 * against a REAL backend in production mode (no e-mail / SMS / Stripe keys).
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4300/api npx expo export --platform web --output-dir dist
 *   node scripts/web-journeys-account.cjs dist out --api http://localhost:4300/api \
 *        --db-url postgres://postgres:postgres@localhost:5432/jg_dbg [--port 8300]
 *   (JWT_SECRET in the environment = the server's, for the expired-session journey B10)
 *
 *   B1  First launch: age gate (under 18 → back → adult) → intro; "Next" reaches the
 *       last slide on the web; "Sign in" opens the sign-in screen
 *   B2  Sign-in errors (es): wrong password → Spanish server text; "Forgot password"
 *       with a phone number → needs an e-mail; with an e-mail → honest "not available"
 *   B3  Register a consumer (pt): bad identifier → translated; Terms → Home; the
 *       account's language is pt on the server; reload keeps the session + language
 *   B4  Register an attorney / a bail agent → lands on their dashboard
 *   B5  Sign in as an attorney / a consumer from the signed-out flow → right home
 *   B6  Settings (vi → es): language saved to the profile + survives reload; About
 *       rows open their links; arrest-alert switch saved on the server; no legal-tip
 *       switch; guest Settings: sign-in button, no 401 calls
 *   B7  Sign out clears everything: server session revoked, personal data gone from
 *       the device, next start is Sign in; the next person sees none of it
 *   B8  Export downloads a JSON file; delete with a wrong password stays signed in
 *       (error shown); with the right one the account is gone and the app signed out
 *   B9  Reset password page: no token / wrong token / mismatch → messages; a real
 *       token → new password works, old one does not
 *   B10 Expired access token + valid refresh token → the app renews and stays signed in
 *   B11 Terms "Decline and sign out" → signed out, token gone
 *   B12 Register at 390 px in es / vi: account-type buttons on screen
 * Exit 1 on any failure.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-account-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4300/api')).replace(/\/$/, '');
const PORT = Number(arg('--port', 8300));
const DB_URL = arg('--db-url', process.env.DATABASE_URL || null);
fs.mkdirSync(OUT, { recursive: true });

const I18N = path.join(ROOT, 'src', 'i18n');
const L = Object.fromEntries(['en', 'es', 'pt', 'vi'].map(l => [l, JSON.parse(fs.readFileSync(path.join(I18N, `${l}.json`), 'utf8'))]));
const LOCALES = { en: 'en-US', es: 'es-US', pt: 'pt-BR', vi: 'vi-VN' };
const tx = (lang, key, p = {}) => String(L[lang][key]).replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m));

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
const freshIp = () => `10.67.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
async function apiCall(method, p, { token, body, lang } = {}) {
  const r = await fetch(API + p, { method, headers: {
    'Content-Type': 'application/json', 'X-Forwarded-For': freshIp(), ...(lang ? { 'Accept-Language': lang } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}
const PASSWORD = 'CorrectHorse9!';
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** An account made through the API; `accepted` = Terms + AI disclaimer done (as the app's gate would). */
async function newUser(tag, { accountType, accepted = true, lang } = {}) {
  const email = `b-${tag}-${uniq()}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { lang, body: { identifier: email, password: PASSWORD, displayName: `Riley ${tag}`, ...(accountType ? { accountType } : {}) } });
  if (!reg.body || !reg.body.token) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const token = reg.body.token;
  if (accepted) {
    await apiCall('POST', '/auth/accept-tos', { token, body: { checkbox_tos: true, checkbox_no_advice: true, scroll_completed: true, platform: 'web' } });
    await apiCall('POST', '/auth/disclaimer/accept', { token });
  }
  return { token, refreshToken: reg.body.refreshToken, user: reg.body.user, email };
}
let pool = null;
async function sql(q, params = []) {
  if (!DB_URL) throw new Error('--db-url required');
  if (!pool) {
    let pg; try { pg = require('pg'); } catch { pg = require(path.join(ROOT, '..', 'backend', 'node_modules', 'pg')); }
    pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
  }
  return (await pool.query(q, params)).rows;
}

const base = `http://localhost:${PORT}`;
const byTid = (page, id) => page.locator(`[data-testid="${id}"]`);
const bodyText = (page) => page.locator('body').innerText().catch(() => '');
let lastPage = null;

/**
 * A browser context in `lang` at `viewport`. `fresh` = nothing stored (a first
 * launch); otherwise age check done and `account` (if any) signed in.
 * Records page errors, failed API calls, window.open targets and dialogs.
 */
async function open(browser, { lang = 'en', viewport = { width: 390, height: 844 }, account = null, fresh = false, browsed = true, extra = {} } = {}) {
  const ctx = await browser.newContext({ viewport, locale: LOCALES[lang], timezoneId: 'America/Chicago', serviceWorkers: 'block',
    acceptDownloads: true, extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  const page = await ctx.newPage();
  lastPage = page;
  const errors = []; const failed = []; const dialogs = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(API)) failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(API.length)}`); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
    if (window.navigation) window.navigation.addEventListener('navigate', (e) => {
      const u = e.destination.url;
      if (/^(tel|sms|mailto):/.test(u)) { window.__opened.push(u); e.preventDefault(); }
    });
  });
  await page.goto(base + '/age-check', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([acc, fr, lg, br, ex]) => {
    localStorage.clear(); sessionStorage.clear();
    if (!fr) {
      localStorage.setItem('age_verified', '1');
      localStorage.setItem('onboarding_done', 'true');
      if (br) localStorage.setItem('has_browsed', 'true');
    }
    if (lg !== 'en') localStorage.setItem('lang', lg);
    for (const [k, v] of Object.entries(ex || {})) localStorage.setItem(k, v);
    if (acc) {
      sessionStorage.setItem('jg_token', acc.token);
      if (acc.refreshToken) sessionStorage.setItem('jg_refresh_token', acc.refreshToken);
      sessionStorage.setItem('jg_user', JSON.stringify(acc.user));
    }
  }, [account, fresh, lang, browsed, extra]);
  return { ctx, page, errors, failed, dialogs, opened: () => page.evaluate(() => window.__opened.slice()) };
}
async function go(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
const ONLY = String(process.env.ONLY || '').split(',').filter(Boolean);
async function journey(id, fn) {
  if (ONLY.length && !ONLY.includes(id.split(' ')[0])) return;
  try { const d = await fn(); pass(id, d || 'ok'); }
  catch (e) {
    fail(id, e.message);
    if (lastPage) await lastPage.screenshot({ path: path.join(OUT, `FAIL-${id.split(' ')[0]}.png`) }).catch(() => {});
  }
}
async function until(fn, ms = 10000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 200)); }
}
/** Accept the Terms modal the way a person does (scroll the summary, tick both boxes). */
async function acceptTerms(page) {
  await byTid(page, 'tos-accept-button').waitFor({ timeout: 15000 });
  await byTid(page, 'tos-check-terms').click({ position: { x: 8, y: 8 } });
  await byTid(page, 'tos-check-no-advice').click({ position: { x: 8, y: 8 } });
  // Scroll the summary until it has reached its end (the button unlocks then);
  // a fixed number of wheel turns was not enough on a busy machine.
  const bb = await byTid(page, 'tos-scroll').boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  for (let i = 0; i < 40 && !(await byTid(page, 'tos-accept-button').isEnabled()); i++) {
    await page.mouse.wheel(0, 500); await page.waitForTimeout(150);
  }
  await byTid(page, 'tos-accept-button').click({ timeout: 5000 });
  await until(async () => !(await byTid(page, 'tos-accept-button').isVisible().catch(() => false)), 10000, 'Terms modal to close');
}
const pathOf = (page) => page.url().replace(base, '').split('?')[0];
const storage = (page) => page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));

/** HS256 JWT signed with the server's secret (B10). */
function signJwt(payload, secret) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const browser = await chromium.launch();
  const allErrors = [];

  // ── B1 first launch ───────────────────────────────────────────────────────
  await journey('B1 First launch: age gate → intro → Next reaches the last slide → Sign in', async () => {
    const s = await open(browser, { fresh: true });
    await go(s.page, '/');
    await byTid(s.page, 'age-gate-screen').waitFor({ timeout: 10000 });
    const year = s.page.locator('input').first();
    if ((await year.getAttribute('placeholder')) !== tx('en', 'ag_year_placeholder')) throw new Error('year placeholder not from the catalog');
    await year.fill(String(new Date().getFullYear() - 12)); await s.page.keyboard.press('Enter');
    await s.page.getByText(tx('en', 'x_age_gate_go_back')).click();
    await s.page.locator('input').first().fill('1990'); await s.page.keyboard.press('Enter');
    await byTid(s.page, 'onboarding-screen').waitFor({ timeout: 10000 });
    if ((await storage(s.page)).local.age_verified !== 'true') throw new Error('age check not remembered');
    for (let i = 0; i < 3; i++) { await s.page.getByLabel(tx('en', 'onboard_next')).click(); await s.page.waitForTimeout(600); }
    await s.page.getByText(tx('en', 'onboard_signin_last')).waitFor({ timeout: 5000 });
    if (await s.page.getByLabel(tx('en', 'onboard_next')).count()) throw new Error('Next still shown on the last slide');
    await shot(s.page, 'B1-onboarding-last');
    await s.page.getByText(tx('en', 'onboard_signin_last')).click();
    await byTid(s.page, 'login-screen').waitFor({ timeout: 8000 });
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'under-18 path + back, adult → intro, 4th slide reached with Next, Sign in → login';
  });

  await journey('B1b Intro at 390 px (es, pt, vi): the three facts fit; the slide text is all reachable', async () => {
    const out = [];
    for (const lang of ['es', 'pt', 'vi']) {
      const s = await open(browser, { lang, browsed: false });
      await s.page.evaluate(() => localStorage.removeItem('onboarding_done'));
      await go(s.page, '/welcome');
      const over = await byTid(s.page, 'onboarding-stats').evaluate(el => [...el.querySelectorAll('div')]
        .filter(d => d.children.length === 0 && d.innerText.trim())
        .map(d => d.getBoundingClientRect()).filter(r => r.left < 0 || r.right > 390).length);
      if (over) throw new Error(`${lang}: ${over} fact labels outside the screen`);
      const slide = byTid(s.page, 'onboarding-slide').first();
      await slide.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const body = s.page.getByText(tx(lang, 'onboard_slide1_body')).first();
      const bb = await body.boundingBox(); const sb = await slide.boundingBox();
      if (!bb || bb.y + bb.height > sb.y + sb.height + 2) throw new Error(`${lang}: slide text cut off ${JSON.stringify({ bb, sb })}`);
      await shot(s.page, `B1b-intro-${lang}`);
      out.push(lang);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    return `${out.join(', ')}: facts inside 390 px, slide text reachable`;
  });

  // ── B2 sign-in errors ─────────────────────────────────────────────────────
  await journey('B2 Sign-in errors (es): server text in Spanish; reset needs an e-mail; honest when e-mail is off', async () => {
    const acc = await newUser('b2');
    const s = await open(browser, { lang: 'es', browsed: false });
    await go(s.page, '/');
    await byTid(s.page, 'login-screen').waitFor({ timeout: 10000 });
    await byTid(s.page, 'login-email-input').fill(acc.email);
    await byTid(s.page, 'login-password-input').fill('wrong-password');
    await byTid(s.page, 'login-submit-button').click();
    const err = byTid(s.page, 'login-error-message');
    await err.waitFor({ timeout: 8000 });
    const es = (await apiCall('POST', '/auth/login', { lang: 'es', body: { identifier: 'x@y.test', password: 'nope' } })).body.error;
    if (!(await err.innerText()).includes(es)) throw new Error(`login error not the Spanish server text: ${await err.innerText()}`);
    if (await s.page.locator('[data-testid="login-screen"]').count() !== 1) throw new Error('left the sign-in screen after a failed login');
    await byTid(s.page, 'login-email-input').fill('615 555 0100');
    await s.page.getByText(tx('es', 'x_lg_forgot_password')).click();
    await until(async () => (await err.innerText().catch(() => '')).includes(tx('es', 'lg_reset_needs_email').slice(0, 40)), 5000, 'needs-email message');
    await byTid(s.page, 'login-email-input').fill(acc.email);
    // the confirm ("Send a reset link to …?") is the browser dialog on the web — accepted by open()
    await s.page.getByText(tx('es', 'x_lg_forgot_password')).click();
    await until(async () => s.dialogs.some(d => d.includes(acc.email)), 5000, 'reset confirm dialog');
    const unavailable = (await apiCall('POST', '/auth/forgot-password', { lang: 'es', body: { email: acc.email } })).body.error;
    await s.page.getByText(unavailable).first().waitFor({ timeout: 8000 });
    await shot(s.page, 'B2-login-es');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `"${es.slice(0, 40)}…" / needs e-mail / "${unavailable.slice(0, 40)}…"`;
  });

  // ── B3 register consumer (pt) ─────────────────────────────────────────────
  await journey('B3 Register (pt): validation translated; Terms → Home; profile language pt; reload keeps session + language', async () => {
    const s = await open(browser, { lang: 'pt', browsed: false });
    await go(s.page, '/register');
    await byTid(s.page, 'register-screen').waitFor({ timeout: 10000 });
    await byTid(s.page, 'register-email-input').fill('not-an-email');
    await byTid(s.page, 'register-password-input').fill(PASSWORD);
    await byTid(s.page, 'register-submit-button').click();
    const e1 = await byTid(s.page, 'register-error-message').innerText();
    if (!e1.includes(tx('pt', 'rg_identifier_invalid'))) throw new Error(`bad identifier message: ${e1}`);
    const email = `b-b3-${uniq()}@journeys.test`;
    await byTid(s.page, 'register-email-input').fill(email);
    await byTid(s.page, 'register-submit-button').click();
    await acceptTerms(s.page);
    await until(async () => pathOf(s.page) === '/', 8000, 'Home');
    const [row] = await sql('SELECT preferred_language, tos_version_accepted FROM users WHERE email = $1', [email]);
    if (!row || row.preferred_language !== 'pt' || !row.tos_version_accepted) throw new Error(`profile ${JSON.stringify(row)}`);
    await s.page.reload({ waitUntil: 'networkidle' }); await s.page.waitForTimeout(1200);
    const st = await storage(s.page);
    if (!st.session.jg_token || !st.session.jg_refresh_token) throw new Error('session not kept across reload');
    if (await byTid(s.page, 'login-screen').count()) throw new Error('reload went to sign in');
    if (!(await bodyText(s.page)).includes(tx('pt', 'tab_home'))) throw new Error('language not Portuguese after reload');
    if (await byTid(s.page, 'tos-accept-button').count()) throw new Error('Terms asked again after reload');
    await shot(s.page, 'B3-home-pt');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'invalid → pt message; registered, Terms accepted, profile pt, reload: still signed in, pt';
  });

  // ── B4 register attorney / bail agent → their dashboard ──────────────────
  await journey('B4 Register as attorney → attorney dashboard; as bail agent → lead dashboard', async () => {
    const out = [];
    for (const [type, want] of [['attorney', '/attorney-dashboard'], ['bail_agent', '/bondsman-dashboard']]) {
      const s = await open(browser, { browsed: false });
      await go(s.page, '/register');
      await byTid(s.page, `register-type-${type}`).click();
      if (type === 'bail_agent') await byTid(s.page, 'register-bail-hint').waitFor({ timeout: 3000 });
      const email = `b-b4-${type}-${uniq()}@journeys.test`;
      await byTid(s.page, 'register-email-input').fill(email);
      await byTid(s.page, 'register-password-input').fill(PASSWORD);
      await byTid(s.page, 'register-submit-button').click();
      await acceptTerms(s.page);
      await until(async () => pathOf(s.page) === want, 10000, `${want} (at ${pathOf(s.page)})`);
      await s.page.waitForTimeout(1500);
      if (pathOf(s.page) !== want) throw new Error(`${type}: bounced to ${pathOf(s.page)}`);
      const [row] = await sql('SELECT role, user_type FROM users WHERE email = $1', [email]);
      if (type === 'attorney' && row.role !== 'attorney') throw new Error(`attorney role ${row.role}`);
      if (type === 'bail_agent' && row.user_type !== 'bail_agent') throw new Error(`bail agent type ${row.user_type}`);
      await shot(s.page, `B4-${type}`);
      out.push(`${type} → ${want}`);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    return out.join(', ');
  });

  // ── B5 sign in → right home ───────────────────────────────────────────────
  await journey('B5 Sign in from the signed-out flow: attorney → dashboard, consumer → Home', async () => {
    const out = [];
    for (const [type, want] of [['attorney', '/attorney-dashboard'], [undefined, '/']]) {
      const acc = await newUser('b5', { accountType: type });
      const s = await open(browser, { browsed: false });
      await go(s.page, '/');
      await byTid(s.page, 'login-email-input').fill(acc.email.toUpperCase());
      await byTid(s.page, 'login-password-input').fill(PASSWORD);
      await byTid(s.page, 'login-submit-button').click();
      await until(async () => pathOf(s.page) === want, 10000, `${want} (at ${pathOf(s.page)})`);
      await s.page.waitForTimeout(1200);
      if (pathOf(s.page) !== want) throw new Error(`${type || 'consumer'} ended on ${pathOf(s.page)}`);
      out.push(`${type || 'consumer'} → ${want}`);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    return out.join(', ');
  });

  // ── B6 settings ───────────────────────────────────────────────────────────
  await journey('B6 Settings: language → profile + reload; About links; arrest-alert switch saved; guest view', async () => {
    const acc = await newUser('b6');
    const s = await open(browser, { lang: 'vi', account: acc });
    await go(s.page, '/settings');
    await byTid(s.page, 'settings-screen').waitFor({ timeout: 10000 });
    // Notification switches = the four categories that are really sent (+ dark mode); no "daily legal tip"
    const switches = await s.page.getByRole('switch').count();
    if (switches !== 5) throw new Error(`expected 5 switches (dark mode + 4 notification categories), got ${switches}`);
    if (await s.page.getByText(tx('vi', 'x_st_send_test_notification')).count()) throw new Error('test push button on the web');
    await s.page.getByLabel(tx('vi', 'x_st_switch_language', { label: 'Español' })).click();
    await s.page.getByText(tx('es', 'x_st_appearance')).first().waitFor({ timeout: 5000 });
    await until(async () => (await sql('SELECT preferred_language FROM users WHERE id = $1', [acc.user.id]))[0].preferred_language === 'es', 8000, 'profile language es');
    await s.page.reload({ waitUntil: 'networkidle' }); await s.page.waitForTimeout(1000);
    // section titles are upper-cased by CSS (innerText follows it)
    if (!(await bodyText(s.page)).toLowerCase().includes(tx('es', 'x_st_appearance').toLowerCase())) throw new Error('Spanish not kept after reload');
    await s.page.getByLabel(tx('es', 'x_st_arrest_alerts')).click();
    await until(async () => Number((await sql('SELECT notif_arrest_alerts FROM users WHERE id = $1', [acc.user.id]))[0].notif_arrest_alerts) === 0, 8000, 'arrest alerts off on the server');
    await s.page.getByLabel(tx('es', 'hn_website')).click();
    await s.page.getByLabel(tx('es', 'x_feedback_button_send_feedback')).click();
    await s.page.waitForTimeout(500);
    const opened = await s.opened();
    if (!opened.some(u => u.startsWith('https://justicegavel.app')) || !opened.some(u => u.startsWith('mailto:support@'))) throw new Error(`About rows opened ${JSON.stringify(opened)}`);
    await shot(s.page, 'B6-settings-es');
    if (s.failed.length) throw new Error(`failed calls: ${s.failed.join(', ')}`);
    allErrors.push(...s.errors);
    await s.ctx.close();
    // guest
    const g = await open(browser, { lang: 'es' });
    await go(g.page, '/settings');
    await byTid(g.page, 'settings-sign-in-button').waitFor({ timeout: 8000 });
    await byTid(g.page, 'settings-notifs-signed-out').waitFor({ timeout: 3000 });
    if (await byTid(g.page, 'settings-logout-button').count()) throw new Error('guest sees Sign out');
    if (g.failed.length) throw new Error(`guest failed calls: ${g.failed.join(', ')}`);
    await byTid(g.page, 'settings-sign-in-button').click();
    await byTid(g.page, 'login-screen').waitFor({ timeout: 8000 });
    allErrors.push(...g.errors);
    await g.ctx.close();
    return 'vi → es saved (profile es) and kept after reload; arrest alerts off saved; website + feedback open; guest: sign-in, 0 failed calls';
  });

  // ── B7 sign out clears everything ─────────────────────────────────────────
  await journey('B7 Sign out: session revoked, personal data removed, next start = Sign in, next person sees nothing', async () => {
    const a = await newUser('b7a');
    const s = await open(browser, { account: a, extra: {
      contacts: JSON.stringify(['+16155550101', '', '']), userName: 'Riley b7a', arrest_info_v1: '{"jail":"Metro"}',
      cache_court_dates_v1: '{"list":[]}', jg_sync_queue: '[]', core_path_progress: '{"current":2}', jg_theme_mode: 'dark' } });
    await go(s.page, '/settings');
    await byTid(s.page, 'settings-logout-button').click();   // confirm = browser dialog, accepted
    await byTid(s.page, 'login-screen').waitFor({ timeout: 10000 });
    if (!s.dialogs.some(d => d.includes(tx('en', 'x_st_can_sign_back_any')))) throw new Error(`sign-out confirm text ${JSON.stringify(s.dialogs)}`);
    const st = await storage(s.page);
    const leftover = ['contacts', 'userName', 'arrest_info_v1', 'cache_court_dates_v1', 'jg_sync_queue', 'core_path_progress', 'has_browsed', 'user']
      .filter(k => k in st.local);
    if (leftover.length) throw new Error(`personal data left on the device: ${leftover.join(', ')}`);
    if (Object.keys(st.session).some(k => /token|user/.test(k))) throw new Error(`session keys left: ${Object.keys(st.session)}`);
    if (st.local.jg_theme_mode !== 'dark' || !st.local.age_verified) throw new Error('device settings were removed too');
    const reuse = await apiCall('POST', '/auth/refresh', { body: { refreshToken: a.refreshToken } });
    if (reuse.status !== 401) throw new Error(`refresh token still valid after sign-out (${reuse.status})`);
    await s.page.reload({ waitUntil: 'networkidle' }); await s.page.waitForTimeout(800);
    if (!(await byTid(s.page, 'login-screen').count())) throw new Error('restart after sign-out is not Sign in');
    // next person signs in on the same device
    const b = await newUser('b7b');
    await byTid(s.page, 'login-email-input').fill(b.email);
    await byTid(s.page, 'login-password-input').fill(PASSWORD);
    await byTid(s.page, 'login-submit-button').click();
    await until(async () => pathOf(s.page) === '/', 10000, 'Home');
    await s.page.getByText('Riley b7b').first().waitFor({ timeout: 8000 });
    if ((await bodyText(s.page)).includes('Riley b7a')) throw new Error('previous user name visible');
    await go(s.page, '/emergency');
    if ((await bodyText(s.page)).includes('6155550101') || (await s.page.locator('input[value*="555"]').count())) throw new Error("previous user's emergency contact visible");
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'refresh token revoked, 8 personal keys gone (theme / age check kept), restart → Sign in, next user sees only their own name and no contacts';
  });

  // ── B8 export / delete ────────────────────────────────────────────────────
  await journey('B8 Export downloads JSON; wrong password keeps you signed in; delete removes the account', async () => {
    const acc = await newUser('b8');
    const s = await open(browser, { account: acc });
    await go(s.page, '/settings');
    const [dl] = await Promise.all([s.page.waitForEvent('download', { timeout: 15000 }), byTid(s.page, 'account-export').click()]);
    const file = path.join(OUT, 'B8-export.json');
    await dl.saveAs(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (dl.suggestedFilename() !== 'justice-gavel-export.json' || JSON.stringify(data.data.profile).indexOf(acc.email) < 0) throw new Error('export file wrong');
    await byTid(s.page, 'account-delete-open').click();
    await byTid(s.page, 'account-delete-password').fill('not-my-password');
    await byTid(s.page, 'account-delete-confirm').click();
    await byTid(s.page, 'account-delete-error').waitFor({ timeout: 8000 });
    await s.page.waitForTimeout(800);
    if (!(await storage(s.page)).session.jg_token || await byTid(s.page, 'login-screen').count()) throw new Error('a wrong password signed the person out');
    await byTid(s.page, 'account-delete-password').fill(PASSWORD);
    await byTid(s.page, 'account-delete-confirm').click();
    await byTid(s.page, 'login-screen').waitFor({ timeout: 10000 });
    const gone = await sql('SELECT id FROM users WHERE email = $1', [acc.email]);
    if (gone.length) throw new Error('account still in the database');
    if ((await apiCall('POST', '/auth/login', { body: { identifier: acc.email, password: PASSWORD } })).status !== 401) throw new Error('deleted account can still sign in');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `export ${fs.statSync(file).size} bytes; wrong password → message, still signed in; deleted → row gone, sign-in refused`;
  });

  // ── B9 reset password page ────────────────────────────────────────────────
  await journey('B9 Reset password page: messages for missing / bad token and mismatch; a real token sets the new password', async () => {
    const acc = await newUser('b9');
    const s = await open(browser, { lang: 'es', browsed: false });
    await go(s.page, '/reset-password');
    await byTid(s.page, 'reset-password-no-token').waitFor({ timeout: 8000 });
    await go(s.page, '/reset-password?token=deadbeef');
    await byTid(s.page, 'reset-password-input').fill('NewPassword7!');
    await byTid(s.page, 'reset-password-confirm').fill('Different7!');
    await byTid(s.page, 'reset-password-submit').click();
    if (!(await byTid(s.page, 'reset-password-error').innerText()).includes(tx('es', 'rp_mismatch'))) throw new Error('mismatch not reported');
    await byTid(s.page, 'reset-password-confirm').fill('NewPassword7!');
    await byTid(s.page, 'reset-password-submit').click();
    const bad = (await apiCall('POST', '/auth/reset-password', { lang: 'es', body: { token: 'deadbeef', password: 'NewPassword7!' } })).body.error;
    await until(async () => (await byTid(s.page, 'reset-password-error').innerText().catch(() => '')) === bad, 8000, 'Spanish invalid-link message');
    // a real token (what the e-mail would carry), stored hashed like the server does
    const token = crypto.randomBytes(32).toString('hex');
    await sql("INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')", [acc.user.id, crypto.createHash('sha256').update(token).digest('hex')]);
    await go(s.page, `/reset-password?token=${token}`);
    await byTid(s.page, 'reset-password-input').fill('NewPassword7!');
    await byTid(s.page, 'reset-password-confirm').fill('NewPassword7!');
    await byTid(s.page, 'reset-password-submit').click();
    await byTid(s.page, 'reset-password-done').waitFor({ timeout: 8000 });
    await shot(s.page, 'B9-reset-done-es');
    await byTid(s.page, 'reset-password-sign-in').click();
    await byTid(s.page, 'login-screen').waitFor({ timeout: 8000 });
    await byTid(s.page, 'login-email-input').fill(acc.email);
    await byTid(s.page, 'login-password-input').fill('NewPassword7!');
    await byTid(s.page, 'login-submit-button').click();
    await until(async () => !!(await storage(s.page)).session.jg_token, 10000, 'signed in with the new password');
    if ((await apiCall('POST', '/auth/login', { body: { identifier: acc.email, password: PASSWORD } })).status !== 401) throw new Error('old password still works');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'no token → incomplete; mismatch; bad token → Spanish server text; real token → done → Sign in with the new password';
  });

  // ── B10 expired session renews ────────────────────────────────────────────
  await journey('B10 Expired access token + refresh token → renewed, stays signed in', async () => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET (the server\'s) not in the environment');
    const acc = await newUser('b10');
    const now = Math.floor(Date.now() / 1000);
    const expired = signJwt({ id: acc.user.id, role: 'user', iat: now - 31 * 86400, exp: now - 3600 }, secret);
    const s = await open(browser, { account: { ...acc, token: expired } });
    await go(s.page, '/cases');
    await s.page.waitForTimeout(1500);
    if (await byTid(s.page, 'login-screen').count()) throw new Error('signed out instead of renewing');
    const st = await storage(s.page);
    if (!st.session.jg_token || st.session.jg_token === expired) throw new Error('token not renewed');
    if (st.session.jg_refresh_token === acc.refreshToken) throw new Error('refresh token not rotated');
    const me = await apiCall('GET', '/auth/me', { token: st.session.jg_token });
    if (me.status !== 200) throw new Error(`renewed token rejected ${me.status}`);
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'expired token renewed with the refresh token (rotated), user stays on /cases';
  });

  // ── B11 decline terms ─────────────────────────────────────────────────────
  await journey('B11 Terms "Decline and sign out" signs out', async () => {
    const acc = await newUser('b11', { accepted: false });
    const s = await open(browser, { account: acc });
    await go(s.page, '/');
    await byTid(s.page, 'tos-decline-button').click();
    await byTid(s.page, 'login-screen').waitFor({ timeout: 10000 });
    const st = await storage(s.page);
    if (st.session.jg_token) throw new Error('token kept after decline');
    if ((await apiCall('POST', '/auth/refresh', { body: { refreshToken: acc.refreshToken } })).status !== 401) throw new Error('session not revoked on decline');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'declined → Sign in screen, token removed, session revoked';
  });

  // ── B12 register layout 390 px ────────────────────────────────────────────
  await journey('B12 Register at 390 px (es, vi): the three account types fit', async () => {
    const out = [];
    for (const lang of ['es', 'vi']) {
      const s = await open(browser, { lang, browsed: false });
      await go(s.page, '/register');
      for (const ty of ['consumer', 'attorney', 'bail_agent']) {
        const bb = await byTid(s.page, `register-type-${ty}`).boundingBox();
        if (!bb || bb.x < 0 || bb.x + bb.width > 390) throw new Error(`${lang} ${ty} off screen ${JSON.stringify(bb)}`);
      }
      await byTid(s.page, 'register-type-attorney').click();
      await shot(s.page, `B12-register-${lang}`);
      out.push(lang);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    return `${out.join(', ')}: all three buttons inside 390 px`;
  });

  // ── B13 sign in from inside the app ───────────────────────────────────────
  await journey('B13 Browsing → Settings → Sign in: back in the app signed in; an attorney then gets the dashboard', async () => {
    const out = [];
    for (const [type, want] of [[undefined, '/settings'], ['attorney', '/attorney-dashboard']]) {
      const acc = await newUser('b13', { accountType: type });
      const s = await open(browser, { lang: 'es' });
      await go(s.page, '/settings');
      await byTid(s.page, 'settings-sign-in-button').click();
      await byTid(s.page, 'login-screen').waitFor({ timeout: 8000 });
      await byTid(s.page, 'login-email-input').fill(acc.email);
      await byTid(s.page, 'login-password-input').fill(PASSWORD);
      await byTid(s.page, 'login-submit-button').click();
      await until(async () => pathOf(s.page) === want, 10000, `${want} (at ${pathOf(s.page)})`);
      if (type === undefined) {
        await byTid(s.page, 'settings-logout-button').waitFor({ timeout: 8000 }).catch(async () => {
          // Settings was mounted as a guest: it re-reads the session on focus
          throw new Error('Settings still shows the guest view after signing in');
        });
      }
      out.push(`${type || 'consumer'} → ${want}`);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    return out.join(', ');
  });

  const pageErrors = [...new Set(allErrors)];
  if (pageErrors.length) fail('page errors', pageErrors.join(' | ')); else pass('page errors', 'none');

  await browser.close();
  server.close();
  if (pool) await pool.end();
  const failedCount = results.filter(r => !r.ok).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failedCount} passed, ${failedCount} failed`);
  process.exit(failedCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
