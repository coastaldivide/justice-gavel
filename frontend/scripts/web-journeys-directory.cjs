#!/usr/bin/env node
/**
 * web-journeys-directory.cjs — section C (lawyers, bail agents, firms) journeys
 * against a REAL backend in production mode (no Stripe / video / e-mail keys)
 * and the real 2,046 lawyer / 1,262 bail-agent rows (read only).
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4300/api npx expo export --platform web --output-dir dist
 *   node scripts/web-journeys-directory.cjs dist out --api http://localhost:4300/api \
 *        --db-url postgres://postgres:postgres@localhost:5432/jg_dbg [--port 8300]
 *
 *   C1  Lawyers near me (GPS): total, nearest first, Call / Text / Directions /
 *       Website links well-formed, phone formatted; scroll to the end of the list
 *   C2  No location permission: says so; ZIP / "City, ST" / nonsense searches
 *   C3  Filters (es): case type narrows, a language nobody lists → empty state in
 *       Spanish naming the filter → clear filters restores the list
 *   C4  Save on the list → Saved screen → remove there → list shows "Save" again;
 *       survives a reload (server); a guest's Save goes to sign in
 *   C5  Profiles (vi, 390 px): many listings incl. no phone / no website / no hours —
 *       no stray "0", no '["English"]', localized weekdays, nothing off-screen
 *   C6  Reviews: post (5★) → posted; reload → "you reviewed"; another person
 *       reports it; a review with a phone number waits for moderation
 *   C7  Bail agents (pt): formatted call link, 24/7 filter narrows, scroll to end
 *   C8  Booking in America/Chicago: server prices, a Texas lawyer's 9:00 AM shown
 *       as 9:00 AM CDT, a New York lawyer's 9:00 AM as 8:00 AM CDT with the
 *       lawyer's time noted; terms = the platform fee is final once confirmed (Oct 26 policy); payments off → friendly
 *       message, nothing stored; a lawyer not on the app → phone instead
 *   C9  AI match: job polled → 3 nearest cards with a report; location off →
 *       asks for a place; "Richmond, VA" → Richmond lawyers
 *   C10 PI lead (es): $100 note for employment; state required; submitted with state
 *   C11 Search / Saved as a guest → sign-in prompts; Golden Gavel / Booking → no 401s
 *   C12 Firms + Golden Gavel (es): themed background, no stray "0", Spanish
 *       criteria; video consult with no provider → Spanish message
 *   C13 Offline: Lawyers → error + Try again; Bail → last results, labelled
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
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-directory-out'));
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
const freshIp = () => `10.68.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
async function apiCall(method, p, { token, body, lang } = {}) {
  const r = await fetch(API + p, { method, headers: {
    'Content-Type': 'application/json', 'X-Forwarded-For': freshIp(), ...(lang ? { 'Accept-Language': lang } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j, headers: r.headers };
}
const PASSWORD = 'CorrectHorse9!';
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
async function newUser(tag, { accountType } = {}) {
  const email = `c-${tag}-${uniq()}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { body: { identifier: email, password: PASSWORD, displayName: `Casey ${tag}`, ...(accountType ? { accountType } : {}) } });
  if (!reg.body || !reg.body.token) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const token = reg.body.token;
  await apiCall('POST', '/auth/accept-tos', { token, body: { checkbox_tos: true, checkbox_no_advice: true, scroll_completed: true, platform: 'web' } });
  await apiCall('POST', '/auth/disclaimer/accept', { token });
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
const NASHVILLE = { latitude: 36.1627, longitude: -86.7816 };

async function open(browser, { lang = 'en', viewport = { width: 390, height: 844 }, account = null, geo = true, offline = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: LOCALES[lang], timezoneId: 'America/Chicago', serviceWorkers: 'block',
    acceptDownloads: true, extraHTTPHeaders: { 'X-Forwarded-For': freshIp() },
    ...(geo ? { geolocation: NASHVILLE, permissions: ['geolocation'] } : { permissions: [] }) });
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
  await page.evaluate(([acc, lg]) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('age_verified', '1');
    localStorage.setItem('onboarding_done', 'true');
    localStorage.setItem('has_browsed', 'true');
    localStorage.setItem('lawyers_need_shown', 'true');
    if (lg !== 'en') localStorage.setItem('lang', lg);
    if (acc) {
      sessionStorage.setItem('jg_token', acc.token);
      if (acc.refreshToken) sessionStorage.setItem('jg_refresh_token', acc.refreshToken);
      sessionStorage.setItem('jg_user', JSON.stringify(acc.user));
    }
  }, [account, lang]);
  if (offline) await page.route(`${API}/**`, r => r.abort('internetdisconnected'));
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
const pathOf = (page) => page.url().replace(base, '').split('?')[0];
const count = (page, id) => byTid(page, id).count();
/** Scroll the list until "end of the list" shows; returns how many cards were rendered at most. */
async function scrollToEnd(page, listId, endId, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await byTid(page, endId).count()) return true;
    await byTid(page, listId).evaluate(el => {
      const sc = [el, ...el.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 10 && getComputedStyle(d).overflowY !== 'visible') || el;
      sc.scrollTop = sc.scrollHeight;
    }).catch(() => {});
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(350);
  }
  return false;
}
/** Text nodes that are a lone "0" (a numeric `&&` rendered as text). */
const strayZeros = (page) => page.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n = 0; let node;
  while ((node = w.nextNode())) if (node.textContent.trim() === '0' && node.parentElement && !node.parentElement.closest('input,textarea,select')) n++;
  return n;
});
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const allErrors = [];
const allFailed = [];
const done = async (s, { allow = [] } = {}) => {
  allErrors.push(...s.errors);
  allFailed.push(...s.failed.filter(f => !allow.some(a => f.includes(a))));
  await s.ctx.close();
};

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const browser = await chromium.launch();

  // ── C1 ────────────────────────────────────────────────────────────────────
  await journey('C1 Lawyers near me: total, nearest first, well-formed contact links, scroll to the end', async () => {
    const api = await apiCall('GET', '/providers/lawyers?lat=36.1627&lng=-86.7816&limit=1');
    const total = Number(api.headers.get('x-total-count'));
    const s = await open(browser);
    await go(s.page, '/lawyers');
    await byTid(s.page, 'lawyers-total').waitFor({ timeout: 15000 });
    if (!(await byTid(s.page, 'lawyers-total').innerText()).includes(String(total))) throw new Error(`total badge ≠ ${total}`);
    const firstName = await byTid(s.page, 'lawyer-name').first().innerText();
    if (firstName.trim() !== api.body[0].name) throw new Error(`first card ${firstName} ≠ nearest ${api.body[0].name}`);
    const card = byTid(s.page, 'lawyer-card').first();
    const callText = await card.locator('[data-testid="contact-call"]').innerText();
    if (!/\(\d{3}\) \d{3}-\d{4}/.test(callText)) throw new Error(`phone not formatted: ${callText}`);
    for (const id of ['contact-call', 'contact-text', 'contact-directions', 'contact-website']) await card.locator(`[data-testid="${id}"]`).click();
    await s.page.waitForTimeout(400);
    const opened = await s.opened();
    const want = [/^tel:\+1\d{10}$/, /^sms:\+1\d{10}$/, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/, /^https?:\/\/[^\s]+$/];
    for (const [i, re] of want.entries()) if (!re.test(opened[i] || '')) throw new Error(`link ${i} malformed: ${opened[i]}`);
    await shot(s.page, 'C1-lawyers-near');
    if (!(await scrollToEnd(s.page, 'lawyer-list', 'lawyers-end'))) throw new Error('never reached the end of the list');
    const endText = await byTid(s.page, 'lawyers-end').innerText();
    if (!endText.includes(String(total))) throw new Error(`end line "${endText}" does not count ${total}`);
    if (await overflowX(s.page) > 1) throw new Error('horizontal overflow at 390 px');
    await shot(s.page, 'C1-lawyers-end');
    await done(s);
    return `${total} near Nashville, nearest "${firstName.slice(0, 30)}", ${opened.slice(0, 4).map(u => u.split(':')[0]).join('/')}, scrolled to "${endText}"`;
  });

  // ── C2 ────────────────────────────────────────────────────────────────────
  await journey('C2 No location permission: says so; ZIP / "City, ST" / nonsense', async () => {
    const s = await open(browser, { geo: false });
    await go(s.page, '/lawyers');
    await byTid(s.page, 'lawyers-location-off').waitFor({ timeout: 15000 });
    const search = async (q) => {
      await byTid(s.page, 'lawyers-search-input').fill(q);
      await byTid(s.page, 'lawyers-search-submit').click();
      await until(async () => (await byTid(s.page, 'lawyers-place').innerText().catch(() => '')).includes(q), 10000, `results for ${q}`);
      await s.page.waitForTimeout(600);
    };
    await search('37219');
    const zipFirst = await byTid(s.page, 'lawyer-card').first().innerText();
    if (!zipFirst.includes('37219')) throw new Error(`ZIP search first card not in 37219: ${zipFirst.slice(0, 80)}`);
    await search('Richmond, VA');
    const cards = await byTid(s.page, 'lawyer-card').allInnerTexts();
    if (!cards.length || !cards.every(c => /Richmond, VA/.test(c))) throw new Error('City search returned other cities');
    await search('zzqqxx');
    await byTid(s.page, 'lawyers-empty').waitFor({ timeout: 8000 });
    if (!(await byTid(s.page, 'lawyers-empty').innerText()).includes('zzqqxx')) throw new Error('empty text does not name the query');
    await shot(s.page, 'C2-no-location');
    await done(s);
    return `hint shown; 37219 → ${zipFirst.split('\n')[0].slice(0, 30)}; Richmond, VA → ${cards.length} Richmond cards; nonsense → empty`;
  });

  // ── C3 ────────────────────────────────────────────────────────────────────
  await journey('C3 Filters (es): case type narrows; unknown language → Spanish empty state; clear restores', async () => {
    const s = await open(browser, { lang: 'es' });
    await go(s.page, '/lawyers');
    await byTid(s.page, 'lawyers-total').waitFor({ timeout: 15000 });
    const before = Number((await byTid(s.page, 'lawyers-total').innerText()).replace(/\D/g, ''));
    await byTid(s.page, 'lawyers-filters').click();
    await byTid(s.page, 'filter-case-type').selectOption('Family Law');
    await byTid(s.page, 'filter-apply').click();
    await until(async () => { const t = await byTid(s.page, 'lawyers-total').innerText().catch(() => ''); return t && Number(t.replace(/\D/g, '')) !== before; }, 10000, 'total to change');
    const family = Number((await byTid(s.page, 'lawyers-total').innerText()).replace(/\D/g, ''));
    const fam = await apiCall('GET', '/providers/lawyers?lat=36.1627&lng=-86.7816&caseType=Family%20Law&limit=1');
    if (family !== Number(fam.headers.get('x-total-count'))) throw new Error(`family total ${family} ≠ server ${fam.headers.get('x-total-count')}`);
    const familyCards = await byTid(s.page, 'lawyer-name').allInnerTexts();
    if (!familyCards.every(n => /family|divorce|custody/i.test(n))) throw new Error(`a card does not match Family Law: ${familyCards.join(' | ').slice(0, 200)}`);
    await byTid(s.page, 'lawyers-filters').click();
    await byTid(s.page, 'filter-language').selectOption('Spanish');
    await byTid(s.page, 'filter-apply').click();
    await byTid(s.page, 'lawyers-empty').waitFor({ timeout: 10000 });
    const empty = await byTid(s.page, 'lawyers-empty').innerText();
    if (!empty.includes(tx('es', 'lang_name_spanish'))) throw new Error(`empty state does not name the language: ${empty}`);
    if (!empty.includes(tx('es', 'lw_empty_filtered', { filters: '' }).slice(0, 25))) throw new Error(`empty state not Spanish: ${empty}`);
    await shot(s.page, 'C3-filters-empty-es');
    await byTid(s.page, 'lawyers-clear-filters').click();
    await until(async () => Number((await byTid(s.page, 'lawyers-total').innerText().catch(() => '0')).replace(/\D/g, '')) === before, 10000, 'list restored');
    await done(s);
    return `all ${before} → Familia ${family} (all named family/divorce/custody) → + Spanish 0 (Spanish empty state) → cleared ${before}`;
  });

  // ── C4 ────────────────────────────────────────────────────────────────────
  await journey('C4 Save on the list → Saved → remove there → list says Save again; reload keeps it; guest → sign in', async () => {
    const acc = await newUser('c4');
    const s = await open(browser, { account: acc });
    await go(s.page, '/lawyers');
    await byTid(s.page, 'lawyer-card').first().waitFor({ timeout: 15000 });
    const name = (await byTid(s.page, 'lawyer-name').first().innerText()).trim();
    await byTid(s.page, 'lawyer-card-save').first().click();
    await until(async () => (await byTid(s.page, 'lawyer-card-save').first().innerText()).includes(tx('en', 'lw_saved')), 8000, 'saved star');
    const [row] = await sql(`SELECT s.id FROM saved_lawyers s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, [acc.email]);
    if (!row) throw new Error('not saved on the server');
    await s.page.reload({ waitUntil: 'networkidle' }); await s.page.waitForTimeout(1500);
    await until(async () => (await byTid(s.page, 'lawyer-card-save').first().innerText().catch(() => '')).includes(tx('en', 'lw_saved')), 10000, 'saved after reload');
    await go(s.page, '/saved/attorneys');
    await s.page.getByText(name).first().waitFor({ timeout: 10000 });
    await byTid(s.page, 'saved-remove').first().click();
    await until(async () => !(await s.page.getByText(name).count()), 8000, 'removed from Saved');
    const left = await sql(`SELECT s.id FROM saved_lawyers s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, [acc.email]);
    if (left.length) throw new Error('still saved on the server');
    await s.page.goBack(); await s.page.waitForTimeout(800);
    await go(s.page, '/lawyers');
    await until(async () => (await byTid(s.page, 'lawyer-card-save').first().innerText().catch(() => '')).includes(tx('en', 'lw_save')), 10000, 'Save again on the list');
    await done(s);
    const g = await open(browser);
    await go(g.page, '/lawyers');
    await byTid(g.page, 'lawyer-card-save').first().waitFor({ timeout: 15000 });
    await byTid(g.page, 'lawyer-card-save').first().click();
    await byTid(g.page, 'login-screen').waitFor({ timeout: 8000 });
    const pending = await g.page.evaluate(() => localStorage.getItem('pending_save_lawyer'));
    if (!pending) throw new Error('guest save intent not kept for after sign-in');
    await done(g);
    return `saved "${name.slice(0, 30)}" (server row), kept after reload, removed on Saved (one confirm), list shows Save; guest → sign in with the save pending`;
  });

  // ── C5 ────────────────────────────────────────────────────────────────────
  await journey('C5 Profiles (vi, 390 px): many listings incl. missing phone / website / hours', async () => {
    const ids = (await sql(`(SELECT id FROM lawyers WHERE phone IS NULL OR phone = '' LIMIT 3)
      UNION ALL (SELECT id FROM lawyers WHERE website IS NULL OR website = '' LIMIT 3)
      UNION ALL (SELECT id FROM lawyers WHERE hours IS NULL OR hours = '' LIMIT 3)
      UNION ALL (SELECT id FROM lawyers ORDER BY md5(id::text) LIMIT 6)`)).map(r => Number(r.id));
    const s = await open(browser, { lang: 'vi' });
    const weekday = new Date(Date.UTC(2024, 0, 1, 12)).toLocaleDateString('vi-VN', { weekday: 'long', timeZone: 'UTC' });
    let withHours = 0; let noPhone = 0;
    for (const id of ids) {
      await go(s.page, `/attorney/${id}`);
      await byTid(s.page, 'lawyer-profile-screen').waitFor({ timeout: 10000 });
      const text = await bodyText(s.page);
      if (await strayZeros(s.page)) throw new Error(`${id}: stray "0" on screen`);
      if (/\["|undefined|NaN|\[object Object\]/.test(text)) throw new Error(`${id}: raw value on screen`);
      if (await overflowX(s.page) > 1) throw new Error(`${id}: horizontal overflow`);
      if (await count(s.page, 'contact-no-phone')) noPhone++;
      else if (!/\(\d{3}\) \d{3}-\d{4}/.test(text)) throw new Error(`${id}: phone not formatted`);
      if (await count(s.page, 'lp-hours')) { withHours++; if (!/24\/7|Mở cửa/.test(text) && !text.toLowerCase().includes(weekday.toLowerCase())) throw new Error(`${id}: hours not in Vietnamese`); }
      if (!text.includes(tx('vi', 'lp_app_reviews_title').toUpperCase()) && !text.includes(tx('vi', 'lp_app_reviews_title'))) throw new Error(`${id}: reviews section missing`);
    }
    await shot(s.page, 'C5-profile-vi');
    await done(s);
    return `${ids.length} profiles: ${noPhone} with no phone (says so), ${withHours} with hours (Vietnamese), no stray 0 / raw values / overflow`;
  });

  // ── C6 ────────────────────────────────────────────────────────────────────
  await journey('C6 Reviews: post → posted; reload → reviewed; another person reports it; a phone number waits for moderation', async () => {
    const [{ id }] = await sql(`SELECT id FROM lawyers WHERE state = 'GA' ORDER BY md5(id::text) LIMIT 1`);
    const a = await newUser('c6a'); const b = await newUser('c6b'); const c = await newUser('c6c');
    const s = await open(browser, { account: a });
    await go(s.page, `/attorney/${id}`);
    await byTid(s.page, 'write-review-button').click();
    await byTid(s.page, 'review-star-5').click();
    await s.page.locator('[data-testid="review-form"] textarea').fill('Called back within the hour and explained the next steps.');
    await byTid(s.page, 'review-post').click();
    await byTid(s.page, 'review-submitted').waitFor({ timeout: 8000 });
    if (!(await byTid(s.page, 'review-submitted').innerText()).includes(tx('en', 'x_lawyer_profile_thanks_review_was_posted').slice(0, 9))) {
      const t = await byTid(s.page, 'review-submitted').innerText();
      if (!/posted/i.test(t)) throw new Error(`posted message: ${t}`);
    }
    await s.page.reload({ waitUntil: 'networkidle' }); await s.page.waitForTimeout(1200);
    await byTid(s.page, 'review-mine').waitFor({ timeout: 8000 });
    if (await count(s.page, 'write-review-button')) throw new Error('can review twice');
    await done(s);
    const r = await open(browser, { account: b });
    await go(r.page, `/attorney/${id}`);
    await byTid(r.page, 'review-item').first().waitFor({ timeout: 10000 });
    await byTid(r.page, 'review-report').first().click();
    await r.page.getByText(tx('en', 'lp_report_false')).click();
    await r.page.getByText(tx('en', 'lp_reported')).first().waitFor({ timeout: 8000 });
    await done(r);
    const [rep] = await sql(`SELECT COUNT(*)::int AS n FROM review_reports rr JOIN reviews rv ON rv.id = rr.review_id
      JOIN users u ON u.id = rr.user_id WHERE rv.entity_id = $1 AND u.email = $2`, [id, b.email]);
    if (rep.n !== 1) throw new Error(`report not stored (${rep.n})`);
    const h = await open(browser, { account: c });
    await go(h.page, `/attorney/${id}`);
    await byTid(h.page, 'write-review-button').click();
    await byTid(h.page, 'review-star-1').click();
    await h.page.locator('[data-testid="review-form"] textarea').fill('Use my lawyer instead: 615-555-0177');
    await byTid(h.page, 'review-post').click();
    await byTid(h.page, 'review-submitted').waitFor({ timeout: 8000 });
    const held = await byTid(h.page, 'review-submitted').innerText();
    if (!/check/i.test(held)) throw new Error(`moderation message missing: ${held}`);
    if ((await byTid(h.page, 'review-item').allInnerTexts()).some(x => x.includes('615-555-0177'))) throw new Error('held review is listed');
    const g = await apiCall('GET', `/reviews?entity_type=lawyer&entity_id=${id}&limit=100`);
    if (JSON.stringify(g.body).includes('615-555-0177')) throw new Error('held review is public');
    await shot(h.page, 'C6-review-held');
    await done(h);
    return `posted, no second review form after reload, report stored, review with a phone number held ("${held.slice(0, 50)}…")`;
  });

  // ── C7 ────────────────────────────────────────────────────────────────────
  await journey('C7 Bail agents (pt): formatted call link, 24/7 narrows, scroll to the end', async () => {
    const s = await open(browser, { lang: 'pt' });
    await go(s.page, '/bail');
    await byTid(s.page, 'bail-total').waitFor({ timeout: 15000 });
    const total = Number((await byTid(s.page, 'bail-total').innerText()).replace(/\D/g, ''));
    const call = byTid(s.page, 'bail-agent-card').first().locator('[data-testid="contact-call"]');
    if (!/\(\d{3}\) \d{3}-\d{4}/.test(await call.innerText())) throw new Error('phone not formatted');
    await call.click(); await s.page.waitForTimeout(300);
    if (!/^tel:\+1\d{10}$/.test((await s.opened())[0] || '')) throw new Error(`tel link: ${(await s.opened())[0]}`);
    await byTid(s.page, 'bail-filter-24').click();
    await until(async () => Number((await byTid(s.page, 'bail-total').innerText().catch(() => '0')).replace(/\D/g, '')) !== total, 10000, '24/7 total');
    const t24 = Number((await byTid(s.page, 'bail-total').innerText()).replace(/\D/g, ''));
    if (!(t24 < total)) throw new Error(`24/7 did not narrow (${t24} vs ${total})`);
    const badges = await byTid(s.page, 'bail-agent-card').allInnerTexts();
    if (!badges.every(b => b.includes(tx('pt', 'lw_open_24_7')))) throw new Error('a 24/7 result has no 24/7 badge');
    await byTid(s.page, 'bail-filter-24').click();
    await until(async () => Number((await byTid(s.page, 'bail-total').innerText().catch(() => '0')).replace(/\D/g, '')) === total, 10000, 'filter off');
    if (!(await scrollToEnd(s.page, 'bail-agent-list', 'bail-end'))) throw new Error('never reached the end');
    await shot(s.page, 'C7-bail-pt');
    await done(s);
    return `${total} agents near Nashville; tel:+1…; 24/7 → ${t24}; scrolled to the end`;
  });

  // ── C8 ────────────────────────────────────────────────────────────────────
  await journey('C8 Booking in America/Chicago: server prices, lawyer-zone slots shown in the phone zone, payments off', async () => {
    const pick = (st) => sql(`SELECT l.id, l.name FROM lawyers l WHERE l.state = $1 AND l.user_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = l.id) ORDER BY md5(l.id::text) LIMIT 1`, [st]).then(r => r[0]);
    const tx1 = await pick('TX'); const ny = await pick('NY'); const off = await pick('OH');
    const a1 = await newUser('c8tx', { accountType: 'attorney' }); const a2 = await newUser('c8ny', { accountType: 'attorney' });
    // sign-up already made each attorney's profile row (one per account): link the listing on it
    for (const [u, l] of [[a1, tx1], [a2, ny]]) {
      await sql('INSERT INTO attorney_profiles (user_id, lawyer_id) VALUES ($1, $2) ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET lawyer_id = EXCLUDED.lawyer_id', [u.user.id, l.id]);
    }
    try {
      const acc = await newUser('c8');
      const s = await open(browser, { account: acc });
      await go(s.page, `/booking/${tx1.id}`);
      await byTid(s.page, 'booking-fee-15').waitFor({ timeout: 10000 });
      const fees = [await byTid(s.page, 'booking-fee-15').innerText(), await byTid(s.page, 'booking-fee-30').innerText(), await byTid(s.page, 'booking-fee-60').innerText()];
      if (fees.join() !== '$10.00,$15.00,$25.00') throw new Error(`prices ${fees}`);
      await byTid(s.page, 'booking-next').click();
      const first = (await byTid(s.page, 'booking-time').first().innerText()).trim();
      if (!/^9:00 AM C[DS]T$/.test(first)) throw new Error(`Texas 9:00 AM shown as "${first}"`);
      if (await count(s.page, 'booking-zone-note')) throw new Error('zone note shown for the same zone');
      await byTid(s.page, 'booking-time').first().click();
      await byTid(s.page, 'booking-confirm-button').click();
      const terms = await byTid(s.page, 'booking-refund-terms').innerText();
      // Oct 26 2026 owner decision: no refund window — the platform fee is final once the booking is confirmed
      if (terms.trim() !== tx('en', 'bk_fee_terms')) throw new Error(`refund terms: ${terms}`);
      await byTid(s.page, 'booking-confirm').click();
      await s.page.getByText(tx('en', 'bk_payments_unavailable').slice(0, 40)).first().waitFor({ timeout: 8000 });
      const stored = await sql('SELECT COUNT(*)::int AS n FROM consultation_bookings b JOIN users u ON u.id = b.user_id WHERE u.email = $1', [acc.email]);
      if (stored[0].n !== 0) throw new Error('a booking was stored without payment');
      await shot(s.page, 'C8-booking-payments-off');
      await go(s.page, `/booking/${ny.id}`);
      await byTid(s.page, 'booking-next').click();
      const nyFirst = (await byTid(s.page, 'booking-time').first().innerText()).trim();
      if (!/^8:00 AM C[DS]T$/.test(nyFirst)) throw new Error(`New York 9:00 AM shown as "${nyFirst}" in Chicago`);
      await byTid(s.page, 'booking-time').first().click();
      const note = await byTid(s.page, 'booking-zone-note').innerText();
      if (!/9:00 AM E[DS]T/.test(note)) throw new Error(`lawyer time note: ${note}`);
      await shot(s.page, 'C8-booking-ny-from-chicago');
      await go(s.page, `/booking/${off.id}`);
      await byTid(s.page, 'booking-not-on-app').waitFor({ timeout: 8000 });
      if (!(await count(s.page, 'contact-call')) && !(await count(s.page, 'contact-no-phone'))) throw new Error('no phone offered');
      await done(s, { allow: ['503 POST /consultations/book'] });
      return `prices ${fees.join(' / ')}; TX "${first}"; NY "${nyFirst}" + "${note}"; refund 2 h; payments off → message, 0 rows; OH (not on app) → phone`;
    } finally {
      await sql('DELETE FROM attorney_profiles WHERE lawyer_id IN ($1, $2)', [tx1.id, ny.id]);
    }
  });

  // ── C9 ────────────────────────────────────────────────────────────────────
  await journey('C9 AI match: 3 nearest cards with a report; location off → asks; "Richmond, VA" → Richmond', async () => {
    const acc = await newUser('c9');
    const s = await open(browser, { account: acc });
    await go(s.page, '/match');
    await byTid(s.page, 'match-submit').click();
    await until(async () => (await count(s.page, 'match-card')) === 3, 30000, '3 match cards');
    const cards = await byTid(s.page, 'match-card').allInnerTexts();
    if (!cards.every(c => /Nashville|TN/.test(c))) throw new Error('a match is not near Nashville');
    if ((await count(s.page, 'match-report')) !== 3) throw new Error('reports missing');
    await shot(s.page, 'C9-match');
    await done(s);
    const o = await open(browser, { account: acc, geo: false });
    await go(o.page, '/match');
    await byTid(o.page, 'match-submit').click();
    await until(async () => (await byTid(o.page, 'match-status').innerText().catch(() => '')).includes(tx('en', 'mt_need_place').slice(0, 20)), 10000, 'ask for a place');
    await byTid(o.page, 'match-place').fill('Richmond, VA');
    await byTid(o.page, 'match-submit').click();
    await until(async () => (await count(o.page, 'match-card')) > 0, 30000, 'Richmond cards');
    const rc = await byTid(o.page, 'match-card').allInnerTexts();
    if (!rc.every(c => /Richmond, VA/.test(c))) throw new Error('Richmond search returned other places');
    await done(o);
    return `3 Nashville matches with reports; location off → asks; Richmond, VA → ${rc.length} Richmond cards`;
  });

  // ── C10 ───────────────────────────────────────────────────────────────────
  await journey('C10 PI lead (es): $100 for employment; state required; submitted with the state', async () => {
    const acc = await newUser('c10');
    const s = await open(browser, { lang: 'es', account: acc });
    await go(s.page, '/case-review?caseType=Employment');
    await s.page.getByText(tx('es', 'x_pilead_attorneys_pay_flat_connection', { PI_LEAD_FEE_DISPLAY: '$100' })).waitFor({ timeout: 10000 });
    await s.page.getByText(tx('es', 'x_pilead_minor'), { exact: true }).click();
    await s.page.locator('textarea').fill('Me despidieron un día después de reportar un problema de seguridad.');
    await byTid(s.page, 'pilead-city').fill('Nashville');
    await byTid(s.page, 'pilead-state').selectOption('TN');
    await s.page.getByLabel(tx('es', 'x_pilead_submit_case_attorneys')).click();
    await s.page.getByText(tx('es', 'x_pilead_case_review')).waitFor({ timeout: 8000 });
    const [row] = await sql(`SELECT p.case_type, p.state, p.city, p.lead_fee_cents FROM pi_leads p JOIN users u ON u.id = p.user_id WHERE u.email = $1`, [acc.email]);
    if (!row || row.state !== 'TN' || row.case_type !== 'employment' || Number(row.lead_fee_cents) !== 10000) throw new Error(`lead ${JSON.stringify(row)}`);
    await shot(s.page, 'C10-pilead-es');
    await done(s);
    return `note "$100"; lead stored ${row.case_type} / ${row.city}, ${row.state} / ${row.lead_fee_cents}¢`;
  });

  // ── C11 ───────────────────────────────────────────────────────────────────
  await journey('C11 Guests: Search / Saved ask to sign in; Golden Gavel, Booking: no 401s', async () => {
    const s = await open(browser);
    await go(s.page, '/search');
    await byTid(s.page, 'search-signed-out').waitFor({ timeout: 8000 });
    await go(s.page, '/saved/attorneys');
    await byTid(s.page, 'saved-signed-out').waitFor({ timeout: 8000 });
    await go(s.page, '/golden-gavel');
    await go(s.page, '/booking/2193');
    await s.page.waitForTimeout(800);
    const fails = s.failed.filter(f => f.startsWith('401'));
    if (fails.length) throw new Error(`401s: ${fails.join(', ')}`);
    await done(s);
    return 'both show a sign-in prompt, no 401 requests';
  });

  // ── C12 ───────────────────────────────────────────────────────────────────
  await journey('C12 Firms + Golden Gavel + video (es): themed, no stray 0, Spanish text', async () => {
    const acc = await newUser('c12');
    const s = await open(browser, { lang: 'es', account: acc });
    await go(s.page, '/firms');
    const bg = await byTid(s.page, 'firm-discovery-screen').evaluate(el => getComputedStyle(el).backgroundColor);
    if (/rgb\(74, 144, 226\)|rgb\(77, 145, 213\)/.test(bg)) throw new Error(`light-blue background ${bg}`);
    if (await overflowX(s.page) > 1) throw new Error('firms overflow at 390 px');
    await shot(s.page, 'C12-firms-es');
    await go(s.page, '/golden-gavel');
    await s.page.waitForTimeout(800);
    if (await strayZeros(s.page)) throw new Error('stray 0 on Golden Gavel');
    const gg = await bodyText(s.page);
    if (/more months active|Bronze Gavel ·/.test(gg)) throw new Error('English criteria on Golden Gavel');
    if (!/meses más de actividad/.test(gg)) throw new Error('Spanish criteria missing');
    await shot(s.page, 'C12-golden-gavel-es');
    await go(s.page, '/video-consult');
    await s.page.getByText(tx('es', 'x_video_consultation_start_video_call')).click();
    await s.page.getByText('Las videoconsultas todavía no están disponibles').first().waitFor({ timeout: 8000 });
    if (!(await bodyText(s.page)).includes(tx('es', 'x_video_consultation_end_end_encrypted_daily'))) throw new Error('video copy');
    await shot(s.page, 'C12-video-es');
    await done(s, { allow: ['503 POST /video/session'] });
    return `firm background ${bg}; Golden Gavel Spanish, no stray 0; video → Spanish "not available" message`;
  });

  // ── C13 ───────────────────────────────────────────────────────────────────
  await journey('C13 Offline: Lawyers → error + Try again; Bail → last results, labelled', async () => {
    const on = await open(browser);
    await go(on.page, '/bail');
    await byTid(on.page, 'bail-agent-card').first().waitFor({ timeout: 15000 });
    const cached = await on.page.evaluate(() => Object.keys(localStorage).filter(k => /bail/i.test(k)));
    const store = await on.page.evaluate(() => JSON.stringify(localStorage));
    await done(on);
    const s = await open(browser, { offline: true });
    await s.page.evaluate((st) => { for (const [k, v] of Object.entries(JSON.parse(st))) localStorage.setItem(k, v); }, store);
    await go(s.page, '/lawyers');
    await byTid(s.page, 'lawyers-error').waitFor({ timeout: 20000 });
    await go(s.page, '/bail');
    await byTid(s.page, 'bail-from-cache').waitFor({ timeout: 20000 });
    if (!(await byTid(s.page, 'bail-agent-card').count())) throw new Error('no saved bail agents shown offline');
    await shot(s.page, 'C13-offline');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `lawyers: error + Try again; bail: saved results (${cached.join(', ') || 'cache'}) labelled`;
  });

  const pageErrors = [...new Set(allErrors)];
  if (pageErrors.length) fail('page errors', pageErrors.join(' | ')); else pass('page errors', 'none');
  const unexpected = [...new Set(allFailed)];
  if (unexpected.length) fail('failed API requests', unexpected.join(' | ')); else pass('failed API requests', 'none unexpected');

  await browser.close();
  server.close();
  if (pool) await pool.end();
  const failedCount = results.filter(r => !r.ok).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failedCount} passed, ${failedCount} failed`);
  process.exit(failedCount ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
