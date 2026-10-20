#!/usr/bin/env node
/**
 * web-journeys-guides.cjs — section F (specialized legal guides) journeys against
 * a REAL backend in production mode (no Stripe / e-mail keys) with an Anthropic
 * mock (for the petition draft).
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4300/api npx expo export --platform web --output-dir dist
 *   node scripts/web-journeys-guides.cjs dist out --api http://localhost:4300/api [--port 8300]
 *
 *   F1  Expungement (guest, 390 px): CA + dismissed → the recorded rule's verdict with
 *       the statute it names as its source and "not reviewed by a lawyer"; CA lawyers;
 *       "Check another" → "not sure" → no verdict; "still open" → no verdict; TN
 *       domestic violence (rule names no statute) → no verdict, note labelled
 *   F2  Expungement in the browser for 12 states × dismissed / felony: every answer shows
 *       the chosen state (it always answered for Tennessee) and a verdict only with a
 *       statute
 *   F3  Expungement es: Spanish verdict, "notes are in English" label, no English UI;
 *       the petition draft needs a session (guest → sign-in sheet; signed in → draft)
 *   F4  Child support: no dollar estimate anywhere; "no official formula recorded" for
 *       the chosen state
 *   F5  Diversion: /mental-health-diversion opens the mental-health tab; answers give a
 *       neutral summary (no "you may qualify"); "Find specialty courts" opens the
 *       directory on mental-health courts
 *   F6  Specialty courts (vi): state picker, translated eligibility, Call / Directions /
 *       Website, a source line on every card
 *   F7  Hague: contacts from stored data with sources; Mexico's authority; a guest
 *       starting an intake gets Sign in; a signed-in parent picks a case and records
 *       it (bad date refused, then 5 next steps)
 *   F8  ICE detention: official locator (www.ice.gov/locator) opens, share text carries
 *       it, call buttons are tel: links, page switches to English and back
 *   F9  Legal insurance: says there is no insurance product, shows the real plans
 *       (Legal Pro $34.99), never calls /insurance
 *   F10 Family court → child support / Hague; Housing eviction → Tenant rights;
 *       Expungement juvenile link → Juvenile sealing tab with a state filter
 *   F11 API down: Hague, Specialty courts, Expungement, Legal insurance show a friendly
 *       error with Try again — no crash
 *   F12 every guide in es / pt / vi at 390 px shows the "not reviewed by a lawyer" notice
 *       and no raw keys / horizontal overflow
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
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-guides-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4300/api')).replace(/\/$/, '');
const PORT = Number(arg('--port', 8300));
fs.mkdirSync(OUT, { recursive: true });

const I18N = path.join(ROOT, 'src', 'i18n');
const L = Object.fromEntries(['en', 'es', 'pt', 'vi'].map(l => [l, JSON.parse(fs.readFileSync(path.join(I18N, `${l}.json`), 'utf8'))]));
const LOCALES = { en: 'en-US', es: 'es-US', pt: 'pt-BR', vi: 'vi-VN' };
const tx = (lang, key, p = {}) => String(L[lang][key]).replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m));
const KEYS = new Set(Object.keys(L.en));

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
const freshIp = () => `10.71.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
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
async function newUser(tag) {
  const email = `f-${tag}-${uniq()}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { body: { identifier: email, password: PASSWORD, displayName: `Fran ${tag}` } });
  if (!reg.body || !reg.body.token) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const token = reg.body.token;
  await apiCall('POST', '/auth/accept-tos', { token, body: { checkbox_tos: true, checkbox_no_advice: true, scroll_completed: true, platform: 'web' } });
  await apiCall('POST', '/auth/disclaimer/accept', { token });
  return { token, refreshToken: reg.body.refreshToken, user: reg.body.user, email };
}

const base = `http://localhost:${PORT}`;
const byTid = (page, id) => page.locator(`[data-testid="${id}"]`);
const bodyText = (page) => page.locator('body').innerText().catch(() => '');
let lastPage = null;

async function open(browser, { lang = 'en', viewport = { width: 390, height: 844 }, account = null, state = null } = {}) {
  const ctx = await browser.newContext({ viewport, locale: LOCALES[lang], timezoneId: 'America/Chicago', serviceWorkers: 'block',
    extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  const page = await ctx.newPage();
  lastPage = page;
  const errors = []; const failed = []; const calls = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('request', r => { if (r.url().startsWith(API)) calls.push(`${r.method()} ${r.url().slice(API.length)}`); });
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(API)) failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(API.length)}`); });
  await page.addInitScript(() => {
    window.__opened = []; window.__shared = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
    // RN-web opens tel: by assigning window.location (after new URL(...)): record those instead of navigating.
    const RealURL = window.URL;
    window.URL = class extends RealURL { constructor(u, b) { super(u, b); if (/^tel:|^sms:/.test(String(u))) { window.__opened.push(String(u)); return new RealURL('about:blank'); } } };
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared.push(d); } });
  });
  await page.goto(base + '/age-check', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([acc, lg, st]) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('age_verified', '1'); localStorage.setItem('onboarding_done', 'true'); localStorage.setItem('has_browsed', 'true');
    if (lg !== 'en') localStorage.setItem('lang', lg);
    if (st) localStorage.setItem('jg_user_state', st);
    if (acc) {
      sessionStorage.setItem('jg_token', acc.token);
      if (acc.refreshToken) sessionStorage.setItem('jg_refresh_token', acc.refreshToken);
      sessionStorage.setItem('jg_user', JSON.stringify(acc.user));
    }
  }, [account, lang, state]);
  return { ctx, page, errors, failed, calls, opened: () => page.evaluate(() => window.__opened.slice()), shared: () => page.evaluate(() => window.__shared.slice()) };
}
async function go(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(600); }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
const ONLY = String(process.env.ONLY || '').split(',').filter(Boolean);
async function journey(id, fn) {
  if (ONLY.length && !ONLY.includes(id.split(' ')[0])) return;
  try { const d = await fn(); pass(id, d || 'ok'); }
  catch (e) {
    fail(id, e.message);
    if (lastPage) await lastPage.screenshot({ path: path.join(OUT, `FAIL-${id.split(' ')[0]}.png`), fullPage: true }).catch(() => {});
  }
}
async function until(fn, ms = 10000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 200)); }
}
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const rawKeys = (text) => [...new Set((text.match(/\b[a-z][a-z0-9]*_[a-z0-9_]{3,}\b/g) || []).filter(k => KEYS.has(k)))];
const allErrors = [];
const allFailed = [];
const done = async (s, { allow = [] } = {}) => {
  allErrors.push(...s.errors);
  allFailed.push(...s.failed.filter(f => !allow.some(a => f.includes(a))));
  await s.ctx.close();
};

async function pickState(page, pickerId, code) {
  await byTid(page, pickerId).click();
  await byTid(page, `${pickerId}-${code}`).click();
}
async function checkRecord(page, { state, status, type }) {
  await pickState(page, 'expungement-state-picker', state);
  await byTid(page, `expungement-status-${status}`).click();
  if (type) await byTid(page, `expungement-type-${type}`).click();
  await byTid(page, 'expungement-check-button').click();
  await byTid(page, 'expungement-result-screen').waitFor({ timeout: 15000 });
  return byTid(page, 'expungement-verdict').innerText();
}

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const browser = await chromium.launch();

  // ── F1 ──────────────────────────────────────────────────────────────────
  await journey('F1 Expungement (guest 390): sourced verdict, unknown, still open, unsourced rule', async () => {
    const s = await open(browser);
    await go(s.page, '/expungement');
    await byTid(s.page, 'expungement-check-button').click();
    await byTid(s.page, 'expungement-error').waitFor();                       // no state chosen
    let v = await checkRecord(s.page, { state: 'CA', status: 'Dismissed' });
    if (v !== tx('en', 'exp_r_eligible')) throw new Error(`CA dismissed verdict: ${v}`);
    const src = await byTid(s.page, 'expungement-source').innerText();
    if (!src.includes('PC 851.91') || !/recorded/.test(src)) throw new Error(`source line: ${src}`);
    if (!(await byTid(s.page, 'expungement-notice').isVisible())) throw new Error('no "not reviewed" notice');
    if (!(await bodyText(s.page)).includes('California')) throw new Error('not about California');
    await byTid(s.page, 'expungement-attorney').first().waitFor({ timeout: 10000 });
    await shot(s.page, 'F1-ca-dismissed');
    await byTid(s.page, 'expungement-start-over').click();
    v = await checkRecord(s.page, { state: 'CA', status: 'Convicted', type: 'unknown' });
    if (v !== tx('en', 'exp_r_unknown')) throw new Error(`not sure verdict: ${v}`);
    await byTid(s.page, 'expungement-start-over').click();
    v = await checkRecord(s.page, { state: 'CA', status: 'Open' });
    if (v !== tx('en', 'exp_r_case_open')) throw new Error(`open verdict: ${v}`);
    await byTid(s.page, 'expungement-start-over').click();
    v = await checkRecord(s.page, { state: 'TN', status: 'Convicted', type: 'domestic' });
    if (v !== tx('en', 'exp_r_unsourced')) throw new Error(`TN domestic verdict: ${v}`);
    const rule = await byTid(s.page, 'expungement-rule').innerText();
    if (!rule.includes(tx('en', 'exp_rule_title_unsourced')) || !rule.includes(tx('en', 'pen_source_unknown'))) throw new Error(`unsourced rule card: ${rule}`);
    if (await byTid(s.page, 'expungement-wait-years').count()) throw new Error('waiting period shown without a source');
    await shot(s.page, 'F1-tn-domestic');
    if (s.failed.length) throw new Error(`failed requests: ${s.failed.join(', ')}`);   // no guest log-visit 401
    if (s.calls.some(c => c.includes('log-visit'))) throw new Error('guest called log-visit');
    await done(s);
    return 'CA dismissed eligible (PC 851.91) · not sure → unknown · open → no verdict · TN DV → unsourced, no wait';
  });

  // ── F2 ──────────────────────────────────────────────────────────────────
  await journey('F2 Expungement for 12 states in the browser: right state, verdict only with a statute', async () => {
    const s = await open(browser);
    const sample = ['AL', 'AK', 'DC', 'FL', 'IL', 'LA', 'NJ', 'NY', 'OR', 'TX', 'WA', 'WY'];
    const seen = [];
    for (const st of sample) {
      await go(s.page, '/expungement');
      const v = await checkRecord(s.page, { state: st, status: 'Convicted', type: 'felony' });
      const text = await bodyText(s.page);
      const names = { AL: 'Alabama', AK: 'Alaska', DC: 'Washington D.C.', FL: 'Florida', IL: 'Illinois', LA: 'Louisiana', NJ: 'New Jersey', NY: 'New York', OR: 'Oregon', TX: 'Texas', WA: 'Washington', WY: 'Wyoming' };
      if (!text.includes(names[st])) throw new Error(`${st}: page does not name ${names[st]}`);
      if (/Tennessee/.test(text) && st !== 'TN') throw new Error(`${st}: answered for Tennessee`);
      const verdict = [tx('en', 'exp_r_eligible'), tx('en', 'exp_r_conditional'), tx('en', 'exp_r_not_eligible')].includes(v);
      const src = await byTid(s.page, 'expungement-source').innerText().catch(() => '');
      if (verdict && src.includes(tx('en', 'pen_source_unknown'))) throw new Error(`${st}: verdict without a statute`);
      seen.push(`${st}:${verdict ? 'verdict' : 'none'}`);
    }
    if (s.failed.length || s.errors.length) throw new Error(`${s.failed.join(', ')} ${s.errors.join(', ')}`);
    await done(s);
    return seen.join(' ');
  });

  // ── F3 ──────────────────────────────────────────────────────────────────
  await journey('F3 Expungement es + petition draft needs a session', async () => {
    const g = await open(browser, { lang: 'es' });
    await go(g.page, '/expungement');
    const v = await checkRecord(g.page, { state: 'TX', status: 'Convicted', type: 'misdemeanor' });
    if (v !== tx('es', 'exp_r_conditional')) throw new Error(`es verdict: ${v}`);
    const text = await bodyText(g.page);
    if (!text.includes(tx('es', 'pen_notes_english'))) throw new Error('English notes not labelled');
    if (!text.includes('Texas')) throw new Error('state name missing');
    if (rawKeys(text).length) throw new Error(`raw keys ${rawKeys(text)}`);
    await byTid(g.page, 'expungement-draft').click();
    await until(async () => (await bodyText(g.page)).includes(tx('es', 'x_auth_gate_sign_continue')), 8000, 'sign-in sheet');
    await shot(g.page, 'F3-es-guest-draft');
    await done(g);
    const me = await newUser('f3');
    const s = await open(browser, { account: me });
    await go(s.page, '/expungement');
    await checkRecord(s.page, { state: 'IL', status: 'Dismissed' });
    await byTid(s.page, 'expungement-draft').click();
    await byTid(s.page, 'expungement-draft-modal').waitFor({ timeout: 20000 });
    const draft = await bodyText(s.page);
    if (!/MOCK REPLY/.test(draft) || !draft.includes(tx('en', 'x_legal_notice_ai_generated_draft_not'))) throw new Error('draft / AI notice missing');
    await shot(s.page, 'F3-draft');
    if (!s.calls.some(c => c.startsWith('POST /expungement/log-visit'))) throw new Error('signed-in visit not logged');
    await done(s);
    return 'es conditional (TX) with English-notes label · guest → sign in · signed in → AI draft with notice';
  });

  // ── F4 ──────────────────────────────────────────────────────────────────
  await journey('F4 Child support: no invented dollar estimate, unavailable for the state', async () => {
    const s = await open(browser, { state: 'GA' });
    await go(s.page, '/child-support');
    await byTid(s.page, 'child-support-unavailable').waitFor();
    let text = await bodyText(s.page);
    if (!text.includes(tx('en', 'cs_unavailable_title', { state: 'Georgia' }))) throw new Error('GA not preselected');
    await pickState(s.page, 'child-support-state', 'OH');
    text = await bodyText(s.page);
    if (!text.includes(tx('en', 'cs_unavailable_title', { state: 'Ohio' }))) throw new Error('state change not shown');
    if (/\$\s?\d/.test(text)) throw new Error('a dollar amount is shown');
    await byTid(s.page, 'child-support-guide').click();
    await byTid(s.page, 'family-court-screen').waitFor();
    await shot(s.page, 'F4-family-support-tab');
    if (!(await bodyText(s.page)).includes(L.en.x_family_court_how_child_support_calculated)) throw new Error('guide did not open on the support tab');
    await done(s);
    return 'GA → OH unavailable, no $ figures, guide opens on the support tab';
  });

  // ── F5 ──────────────────────────────────────────────────────────────────
  await journey('F5 Diversion: mental-health link, neutral summary, specialty courts on that type', async () => {
    const s = await open(browser);
    await go(s.page, '/mental-health-diversion');
    await byTid(s.page, 'diversion-screen').waitFor();
    const sel = await byTid(s.page, 'diversion-tab-mental').evaluate(el => el.outerHTML.slice(0, 260));
    if (!/aria-selected="true"/.test(sel)) throw new Error(`mental tab not selected: ${sel}`);
    await byTid(s.page, 'diversion-q-diagnosis').click();
    await byTid(s.page, 'diversion-summary').waitFor();
    const text = await bodyText(s.page);
    if (/may qualify|criteria met/i.test(text)) throw new Error('verdict wording still shown');
    if (!text.includes(tx('en', 'div_answered', { yes: 1, total: 6 }))) throw new Error('summary count');
    await byTid(s.page, 'diversion-courts').click();
    await byTid(s.page, 'specialty-courts-screen').waitFor();
    await until(async () => (await byTid(s.page, 'specialty-type-Mental-Health-Court').getAttribute('aria-checked')) === 'true', 8000, 'mental-health filter');
    await shot(s.page, 'F5-courts-mh');
    await done(s);
    return 'mental tab selected · 1 of 6 summary, no verdict · courts filtered to mental health';
  });

  // ── F6 ──────────────────────────────────────────────────────────────────
  await journey('F6 Specialty courts (vi): state picker, translated text, contacts, sources', async () => {
    const s = await open(browser, { lang: 'vi' });
    await go(s.page, '/specialty-courts');
    await byTid(s.page, 'specialty-court').first().waitFor({ timeout: 10000 });
    await pickState(s.page, 'specialty-state', 'TN');
    await until(async () => (await byTid(s.page, 'specialty-count').innerText()).includes(tx('vi', 'sc_count_other', { n: 5, where: 'Tennessee' })), 8000, 'TN count');
    const n = await byTid(s.page, 'specialty-court').count();
    if (n !== 5) throw new Error(`TN courts ${n}`);
    if (await byTid(s.page, 'specialty-source').count() !== n) throw new Error('a card without a source line');
    await byTid(s.page, 'specialty-court').first().locator('[role="button"]').first().click();
    await byTid(s.page, 'specialty-details').waitFor();
    const d = await byTid(s.page, 'specialty-details').innerText();
    if (!/Cựu chiến binh|cựu chiến binh/.test(d)) throw new Error(`eligibility not in Vietnamese: ${d.slice(0, 120)}`);
    await byTid(s.page, 'contact-call').first().click();
    const opened = await s.opened();
    if (!opened.some(u => /^tel:\+16158625000$/.test(u))) throw new Error(`call link: ${opened}`);
    await byTid(s.page, 'specialty-type-Drug-Court').click();
    await until(async () => (await byTid(s.page, 'specialty-court').count()) === 2, 5000, 'TN drug courts');
    await pickState(s.page, 'specialty-state', 'WY');
    await byTid(s.page, 'specialty-empty').waitFor();
    await shot(s.page, 'F6-vi-wy-empty');
    if (rawKeys(await bodyText(s.page)).length) throw new Error('raw keys');
    await done(s);
    return 'TN 5 courts with sources · vi eligibility · tel:+16158625000 · drug filter 2 · WY empty state';
  });

  // ── F7 ──────────────────────────────────────────────────────────────────
  await journey('F7 Hague: stored contacts with sources, Mexico authority, intake guest/signed in', async () => {
    const g = await open(browser);
    await go(g.page, '/hague');
    await byTid(g.page, 'hague-us-authority').waitFor({ timeout: 10000 });
    const card = await byTid(g.page, 'hague-us-authority').innerText();
    if (!card.includes('(888) 407-4747') || !card.includes('U.S. Department of State')) throw new Error(`US card: ${card}`);
    await byTid(g.page, 'hague-call-emergency').click();
    if (!(await g.opened()).includes('tel:+18884074747')) throw new Error(`emergency tel link: ${await g.opened()}`);
    if (await byTid(g.page, 'hague-resource-fbi').count() !== 1) throw new Error('FBI resource missing');
    if ((await bodyText(g.page)).includes('ic3.gov')) throw new Error('IC3 still shown');
    await byTid(g.page, 'hague-open-lookup').click();
    await byTid(g.page, 'hague-country-MX').click();
    await byTid(g.page, 'hague-authority').waitFor();
    const auth = await byTid(g.page, 'hague-authority').innerText();
    if (!auth.includes('SEGOB') || !auth.includes('HCCH member state registry')) throw new Error(`MX authority: ${auth}`);
    await byTid(g.page, 'hague-start-intake').click();
    await byTid(g.page, 'hague-sign-in').waitFor();
    await shot(g.page, 'F7-guest-intake');
    if (g.failed.length) throw new Error(`guest failed requests: ${g.failed}`);
    await done(g);

    const me = await newUser('f7');
    const c = await apiCall('POST', '/cases', { token: me.token, body: { title: 'Custody — Rivera', state: 'TX' } });
    const caseId = c.body.id || (c.body.case && c.body.case.id);
    const s = await open(browser, { account: me, lang: 'es' });
    await go(s.page, '/hague');
    await byTid(s.page, 'hague-open-lookup').click();
    await byTid(s.page, 'hague-country-MX').click();
    await byTid(s.page, 'hague-authority').waitFor();
    if (!(await bodyText(s.page)).includes('México')) throw new Error('country name not localized');
    await byTid(s.page, 'hague-start-intake').click();
    await byTid(s.page, `hague-case-${caseId}`).click();
    await byTid(s.page, 'hague-child-name').fill('Ana Rivera');
    await byTid(s.page, 'hague-child-age').fill('6');
    await byTid(s.page, 'hague-date').fill('2026-02-30');
    await byTid(s.page, 'hague-submit').click();
    await byTid(s.page, 'hague-form-error').waitFor();
    await byTid(s.page, 'hague-date').fill('2026-09-15');
    await byTid(s.page, 'hague-submit').click();
    await byTid(s.page, 'hague-done').waitFor({ timeout: 10000 });
    const doneText = await bodyText(s.page);
    if (!doneText.includes(tx('es', 'x_hague_contact_intake_recorded'))) throw new Error('not recorded');
    if ((doneText.match(/^\d$/gm) || []).length < 5) throw new Error('next steps missing');
    await shot(s.page, 'F7-es-done');
    const row = await apiCall('GET', `/hague-contacts/intake/${caseId}`, { token: me.token });
    if (row.body.intake.country_code !== 'MX' || row.body.intake.abduction_date !== '2026-09-15') throw new Error(`stored ${JSON.stringify(row.body)}`);
    await done(s, { allow: ['400 POST /hague-contacts/report-intake'] });
    return 'US card from stored data (tel:+18884074747) · FBI page, no IC3 · MX SEGOB with source · guest → sign in · es intake: bad date refused, recorded';
  });

  // ── F8 ──────────────────────────────────────────────────────────────────
  await journey('F8 ICE detention: official locator, share, tel links, language switch', async () => {
    const s = await open(browser, { lang: 'es' });
    await go(s.page, '/ice-detention');
    await byTid(s.page, 'ice-detention-screen').waitFor();
    if (!(await bodyText(s.page)).includes(tx('es', 'iced_not_reviewed'))) throw new Error('notice missing');
    await byTid(s.page, 'ice-locator-btn').click();
    await byTid(s.page, 'ice-call-0').click();
    const opened = await s.opened();
    if (!opened.includes('https://www.ice.gov/locator')) throw new Error(`locator opened ${opened}`);
    if (!opened.some(u => /^tel:\+?1?2107873745$/.test(u))) throw new Error(`call link ${opened}`);
    const src = await byTid(s.page, 'ice-locator-source').innerText();
    if (!src.includes('ice.gov')) throw new Error(`locator source ${src}`);
    await byTid(s.page, 'ice-share-btn').click();
    const shared = await s.shared();
    if (!shared.length || !String(shared[0].text || shared[0].message || '').includes('https://www.ice.gov/locator')) throw new Error(`share ${JSON.stringify(shared)}`);
    await byTid(s.page, 'ice-lang-toggle').click();
    await until(async () => (await bodyText(s.page)).includes(L.en.iced_rights_label), 5000, 'English page');
    if (!(await bodyText(s.page)).includes(L.en.iced_not_reviewed)) throw new Error('notice not in English after switch');
    await byTid(s.page, 'ice-lang-toggle').click();
    await until(async () => (await bodyText(s.page)).includes(L.es.iced_rights_label), 5000, 'back to Spanish');
    const off = await overflowX(s.page);
    if (off > 1) throw new Error(`overflow ${off}`);
    await shot(s.page, 'F8-es');
    await done(s);
    return 'www.ice.gov/locator with ice.gov source · tel:+12107873745 · share carries the locator · es ↔ en';
  });

  // ── F9 ──────────────────────────────────────────────────────────────────
  await journey('F9 Legal insurance: no fake product, real plan prices', async () => {
    const s = await open(browser);
    await go(s.page, '/legal-insurance');
    await byTid(s.page, 'insurance-plan').first().waitFor({ timeout: 10000 });
    const text = await bodyText(s.page);
    if (!text.includes(tx('en', 'ins_none_title'))) throw new Error('no-insurance notice');
    const pro = await byTid(s.page, 'insurance-price-legal_pro').innerText();
    if (!pro.includes('$34.99')) throw new Error(`Legal Pro price ${pro}`);
    if (/Insurance Partners|\$19\.99\/mo.*Legal Pro/.test(text)) throw new Error('fake quote text');
    if (s.calls.some(c => c.includes('/insurance'))) throw new Error('called /insurance');
    await byTid(s.page, 'insurance-see-plans').click();
    await byTid(s.page, 'consumer-subscription-screen').first().waitFor({ timeout: 10000 });
    await done(s);
    return 'no insurance product · Legal Pro $34.99 · plans screen opens';
  });

  // ── F10 ─────────────────────────────────────────────────────────────────
  await journey('F10 Entry points: family court → support / Hague, housing → tenant, juvenile sealing', async () => {
    const s = await open(browser, { state: 'NV' });
    await go(s.page, '/family-court');
    await byTid(s.page, 'family-court-hague').click();
    await byTid(s.page, 'hague-contact-screen').waitFor();
    await go(s.page, '/family-court');
    await s.page.getByText(L.en.x_family_court_child_support, { exact: true }).first().click();
    await byTid(s.page, 'family-court-child-support').click();
    await byTid(s.page, 'child-support-screen').waitFor();
    await go(s.page, '/housing-rights');
    await s.page.getByText(L.en.x_housing_rights_eviction_defense, { exact: true }).first().click();
    await byTid(s.page, 'housing-tenant-now').click();
    await byTid(s.page, 'tenant-rights-screen').waitFor();
    await byTid(s.page, 'tenant-situation-lockout').click();
    await byTid(s.page, 'tenant-guidance').waitFor();
    if (!(await byTid(s.page, 'tenant-rights-screen').locator('[data-testid="unreviewed-notice"]').isVisible())) throw new Error('tenant notice');
    await go(s.page, '/expungement');
    await byTid(s.page, 'expungement-juvenile-link').click();
    await byTid(s.page, 'juvenile-justice-screen').waitFor();
    await byTid(s.page, 'juvenile-state').waitFor();
    const rows = await byTid(s.page, 'juvenile-row-source').count();
    if (rows !== 1 || !(await bodyText(s.page)).includes('Nevada')) throw new Error(`juvenile sealing rows ${rows}`);
    await pickState(s.page, 'juvenile-state', 'ALL');
    if (await byTid(s.page, 'juvenile-row-source').count() !== 51) throw new Error('all states');
    await shot(s.page, 'F10-juvenile');
    await done(s);
    return 'Hague / child support / tenant rights reachable · juvenile sealing NV (1) → all (51), each with a source line';
  });

  // ── F11 ─────────────────────────────────────────────────────────────────
  await journey('F11 API down: friendly errors with Try again, no crash', async () => {
    const s = await open(browser);
    await s.page.route(`${API}/**`, r => r.abort('connectionrefused'));
    for (const [p, id] of [['/hague', 'hague-load-error'], ['/specialty-courts', 'specialty-error'], ['/legal-insurance', 'insurance-error']]) {
      await go(s.page, p);
      await byTid(s.page, id).waitFor({ timeout: 10000 });
    }
    await go(s.page, '/expungement');
    await pickState(s.page, 'expungement-state-picker', 'TN');
    await byTid(s.page, 'expungement-check-button').click();
    await byTid(s.page, 'expungement-error').waitFor({ timeout: 10000 });
    const text = await bodyText(s.page);
    if (/Something went wrong/i.test(text)) throw new Error('error boundary');
    await shot(s.page, 'F11-expungement-offline');
    s.failed.length = 0;
    await done(s);
    return 'Hague / Specialty courts / Insurance / Expungement each show an error state';
  });

  // ── F12 ─────────────────────────────────────────────────────────────────
  await journey('F12 es / pt / vi at 390: notice on every guide, no raw keys, no overflow', async () => {
    const routes = ['/expungement', '/child-support', '/diversion', '/family-court', '/hague', '/housing-rights', '/tenant-rights',
      '/ice-detention', '/immigration-consequences', '/juvenile-justice', '/specialty-courts'];
    const bad = [];
    for (const lang of ['es', 'pt', 'vi']) {
      const s = await open(browser, { lang });
      for (const r of routes) {
        await go(s.page, r);
        const text = await bodyText(s.page);
        const notice = await s.page.locator('[data-testid$="notice"]').count();
        if (!notice) bad.push(`${lang}${r}: no notice`);
        const k = rawKeys(text); if (k.length) bad.push(`${lang}${r}: keys ${k}`);
        const off = await overflowX(s.page); if (off > 1) bad.push(`${lang}${r}: overflow ${off}`);
      }
      await done(s);
    }
    if (bad.length) throw new Error(bad.join('; '));
    return `${routes.length} guides × 3 languages`;
  });

  // ── totals ──────────────────────────────────────────────────────────────
  if (allErrors.length) fail('page errors', allErrors.slice(0, 5).join(' | ')); else pass('page errors', 'none');
  if (allFailed.length) fail('failed requests', allFailed.slice(0, 8).join(' | ')); else pass('failed requests', 'none');

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
