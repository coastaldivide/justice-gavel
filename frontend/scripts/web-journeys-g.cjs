#!/usr/bin/env node
/**
 * web-journeys-g.cjs — section G (pro dashboards, payments & admin) journeys
 * against a REAL backend in production mode with NO Stripe keys.
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4300/api npx expo export --platform web --output-dir dist
 *   DATABASE_URL=postgres://… node scripts/web-journeys-g.cjs dist out --api http://localhost:4300/api [--port 8300]
 *   (DATABASE_URL is used once, to give one test account the admin role.)
 *
 *   G1  Consumer plans: every price on the screen is the server's price; Subscribe
 *       with payments off says so and nothing turns paid (server still says no plan)
 *   G2  Home: the plans card names the cheapest real plan and its real price (no
 *       "Intel tier"); the firm-trial tile is for attorneys only
 *   G3  Pro plans (attorney + bail agent): server prices; Subscribe → friendly message;
 *       Billing screen shows no plan; refund request with nothing charged is refused
 *   G4  Bar verification: attorney submits on the dashboard → admin approves in Admin
 *       review → dashboard says verified; the decision is in the audit log
 *   G5  Leads with payments off: verified attorney buys a case lead → friendly message,
 *       no contact shown; bail agent sets up the profile, buys a bail lead → friendly
 *       message; leads never show a full name before purchase
 *   G6  Direct messages: attorney claims a listing (admin approves) → a consumer
 *       messages that listing → the attorney inbox shows it (it was never shown
 *       before) → attorney replies → the consumer reads the reply
 *   G7  Firm trial + conflict check: start a trial (terms from the server), invite a
 *       colleague, add names: "JOSE RAMIREZ" finds "José Ramírez" (exact), "Jose Ramirez Jr" is a possible match
 *   G8  Admin review: non-admin accounts see "for administrators" and every
 *       /admin/queue route answers 403; the admin sees the four queues
 *   G9  es / pt / vi at 390 px: the nine screens — no raw keys, no English, no overflow
 *   G10 Desktop 1280 px: the nine screens render, no overflow
 *   G11 Signed out: the nine screens ask to sign in, nothing fails
 * Exit 1 on any failure.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-g-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4300/api')).replace(/\/$/, '');
const PORT = Number(arg('--port', 8300));
const DB_URL = process.env.DATABASE_URL || '';
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
const freshIp = () => `10.71.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
async function apiCall(method, p, { token, body, lang, tz = 'America/Chicago' } = {}) {
  const r = await fetch(API + p, { method, headers: {
    'Content-Type': 'application/json', 'X-Forwarded-For': freshIp(), 'X-Timezone': tz, ...(lang ? { 'Accept-Language': lang } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}
const PASSWORD = 'CorrectHorse9!';
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
async function newUser(tag, { accountType, name } = {}) {
  const email = `g-${tag}-${uniq()}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { body: { identifier: email, password: PASSWORD, displayName: name || `Gale ${tag}`, ...(accountType ? { accountType } : {}) } });
  if (!reg.body || !reg.body.token) throw new Error(`register ${reg.status} ${JSON.stringify(reg.body)}`);
  const token = reg.body.token;
  await apiCall('POST', '/auth/accept-tos', { token, body: { checkbox_tos: true, checkbox_no_advice: true, scroll_completed: true, platform: 'web' } });
  await apiCall('POST', '/auth/disclaimer/accept', { token });
  return { token, refreshToken: reg.body.refreshToken, user: reg.body.user, email };
}
async function login(email) {
  const r = await apiCall('POST', '/auth/login', { body: { identifier: email, password: PASSWORD } });
  if (!r.body?.token) throw new Error(`login ${r.status}`);
  return { token: r.body.token, refreshToken: r.body.refreshToken, user: r.body.user, email };
}
const sql = (q) => execFileSync('psql', [DB_URL, '-Atqc', q], { encoding: 'utf8' }).trim();
async function newAdmin() {
  if (!DB_URL) throw new Error('DATABASE_URL is needed to create the admin account');
  const u = await newUser('admin', { name: 'Ada Admin' });
  sql(`UPDATE users SET role = 'admin' WHERE id = ${Number(u.user.id)}`);
  const a = await login(u.email);
  // the server caches a user's live role for up to 60 s (middleware/auth.js)
  await until(async () => (await apiCall('GET', '/admin/queue/summary', { token: a.token })).status === 200, 70000, 'admin role live');
  return a;
}

const base = `http://localhost:${PORT}`;
const byTid = (page, id) => page.locator(`[data-testid="${id}"]`);
const bodyText = (page) => page.locator('body').innerText().catch(() => '');
let lastPage = null;

async function open(browser, { lang = 'en', viewport = { width: 390, height: 844 }, account = null } = {}) {
  const ctx = await browser.newContext({ viewport, locale: LOCALES[lang], timezoneId: 'America/Chicago', serviceWorkers: 'block',
    extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  const page = await ctx.newPage();
  lastPage = page;
  const errors = []; const failed = []; const dialogs = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(API)) failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(API.length)}`); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
  await page.goto(base + '/age-check', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([acc, lg]) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('age_verified', '1'); localStorage.setItem('onboarding_done', 'true'); localStorage.setItem('has_browsed', 'true');
    if (lg !== 'en') localStorage.setItem('lang', lg);
    if (acc) {
      sessionStorage.setItem('jg_token', acc.token);
      if (acc.refreshToken) sessionStorage.setItem('jg_refresh_token', acc.refreshToken);
      sessionStorage.setItem('jg_user', JSON.stringify(acc.user));
    }
  }, [account, lang]);
  return { ctx, page, errors, failed, dialogs };
}
async function go(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(700); }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }).catch(() => {});
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
  for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 250)); }
}
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const allErrors = [];
const allFailed = [];
const done = async (s, { allow = [] } = {}) => {
  allErrors.push(...s.errors);
  allFailed.push(...s.failed.filter(f => !allow.some(a => f.includes(a))));
  await s.ctx.close();
};
const PAY_OFF = (lang) => tx(lang, 'x_common_payments_aren_t_available');
// Expected 503s with payments off (the screen shows the friendly message for them).
const PAY_ALLOW = ['/billing/consumer/subscribe', '/billing/subscribe', '/billing/bondsman/subscribe', '/billing/pi-lead/accept/', '/billing/leads/'];

// Section G keys: used to spot raw keys or English left on translated pages.
const G_PREFIX = /^(ad|adm|ai|bd|bill|cc|dm|fa|plan|pay|home_plans|lead_type|st_(billing|inbox|conflicts|leads))_/;
const EN_G = Object.entries(L.en).filter(([k, v]) => G_PREFIX.test(k) && !/\{/.test(v) && v.length >= 14).map(([, v]) => v);
const RAW_KEY = /\b(?:ad|adm|ai|bd|bill|cc|dm|fa|plan|pay|lead_type|x)_[a-z0-9]+_[a-z0-9_]{2,}\b/g;

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const browser = await chromium.launch();
  const tiers = (await apiCall('GET', '/billing/tiers')).body.tiers;
  const consumerMonthly = tiers.filter(x => x.audience === 'consumer' && x.billing === 'monthly').sort((a, b) => a.monthly_cents - b.monthly_cents);
  const attorneyMonthly = tiers.filter(x => x.audience === 'attorney' && x.billing === 'monthly');
  const bondTiers = (await apiCall('GET', '/billing/bondsman/tiers')).body.tiers;

  const admin = await newAdmin();
  const consumer = await newUser('cons', { name: 'Maria Lopez' });
  const atty = await newUser('atty', { accountType: 'attorney', name: 'Avery Counsel' });
  const agent = await newUser('agent', { accountType: 'bail_agent', name: 'Bo Bonds' });

  // ── G1 ──────────────────────────────────────────────────────────────────
  await journey('G1 Consumer plans: server prices; payments off → friendly message, nothing paid', async () => {
    const s = await open(browser, { account: consumer });
    await go(s.page, '/plans');
    await byTid(s.page, `consumer-price-${consumerMonthly[0].key}`).waitFor({ timeout: 15000 });
    for (const x of consumerMonthly) {
      const shown = (await byTid(s.page, `consumer-price-${x.key}`).innerText()).trim();
      if (!shown.includes(x.display_price.replace('/mo', ''))) throw new Error(`${x.key}: screen "${shown}" vs server ${x.display_price}`);
    }
    const txt = await bodyText(s.page);
    if (/Intel tier|\$14\.99|\$9\.99/.test(txt)) throw new Error('invented price copy on the plans screen');
    await shot(s.page, 'G1-plans-390');
    await byTid(s.page, `subscribe-${consumerMonthly[0].key}`).click();
    await byTid(s.page, 'plan-notice').waitFor({ timeout: 10000 });
    const notice = await byTid(s.page, 'plan-notice').innerText();
    if (!notice.includes(PAY_OFF('en'))) throw new Error(`notice "${notice}"`);
    await shot(s.page, 'G1-plans-payments-off');
    const mine = await apiCall('GET', '/billing/consumer/subscription', { token: consumer.token });
    if (mine.body?.subscription) throw new Error('a subscription was recorded without payment');
    await done(s, { allow: PAY_ALLOW });
    return `${consumerMonthly.length} prices = server; "${PAY_OFF('en').slice(0, 40)}…"; no subscription row`;
  });

  // ── G2 ──────────────────────────────────────────────────────────────────
  await journey('G2 Home: plans card = cheapest real plan; firm-trial tile for attorneys only', async () => {
    const s = await open(browser, { account: consumer });
    await go(s.page, '/');
    await byTid(s.page, 'home-plans-card').waitFor({ timeout: 15000 });
    const card = await byTid(s.page, 'home-plans-card').innerText();
    const want = tx('en', 'home_plans_from', { price: consumerMonthly[0].display_price });
    if (!card.includes(want)) throw new Error(`card "${card}" lacks "${want}"`);
    if (/Intel|analytics/i.test(card)) throw new Error('old analytics copy');
    if (await byTid(s.page, 'tile-FirmAcq').count()) throw new Error('firm tile shown to a consumer');
    await byTid(s.page, 'home-plans-card').scrollIntoViewIfNeeded();
    await shot(s.page, 'G2-home-plans-card');
    await done(s);
    const a = await open(browser, { account: atty });
    await go(a.page, '/');
    await byTid(a.page, 'tile-FirmAcq').waitFor({ timeout: 15000 });
    await done(a);
    return `"${want}"; firm tile: consumer no, attorney yes`;
  });

  // ── G3 ──────────────────────────────────────────────────────────────────
  await journey('G3 Pro plans: server prices, payments off → friendly message; Billing shows no plan; refund refused', async () => {
    const s = await open(browser, { account: atty });
    await go(s.page, '/subscribe');
    await byTid(s.page, `plan-price-${attorneyMonthly[0].key}`).waitFor({ timeout: 15000 });
    for (const x of attorneyMonthly) {
      const shown = (await byTid(s.page, `plan-price-${x.key}`).innerText()).trim();
      if (shown !== x.display_price) throw new Error(`${x.key}: "${shown}" vs ${x.display_price}`);
    }
    if (await byTid(s.page, `plan-price-${consumerMonthly[0].key}`).count()) throw new Error('consumer plan on the pro screen');
    await byTid(s.page, `subscribe-${attorneyMonthly[0].key}`).click();
    await byTid(s.page, 'subscription-notice').waitFor({ timeout: 10000 });
    if (!(await byTid(s.page, 'subscription-notice').innerText()).includes(PAY_OFF('en'))) throw new Error('no friendly message (attorney)');
    await shot(s.page, 'G3-pro-plans-attorney');
    await go(s.page, '/payments');
    await byTid(s.page, 'billing-no-plan').waitFor({ timeout: 15000 });
    await shot(s.page, 'G3-billing-attorney');
    await done(s, { allow: PAY_ALLOW });

    const b = await open(browser, { account: agent });
    await go(b.page, '/subscribe');
    await byTid(b.page, `plan-price-${bondTiers[0].key}`).waitFor({ timeout: 15000 });
    for (const x of bondTiers) {
      const shown = (await byTid(b.page, `plan-price-${x.key}`).innerText()).trim();
      if (shown !== x.display) throw new Error(`${x.key}: "${shown}" vs ${x.display}`);
    }
    await byTid(b.page, `subscribe-${bondTiers[0].key}`).click();
    await byTid(b.page, 'subscription-notice').waitFor({ timeout: 10000 });
    if (!(await byTid(b.page, 'subscription-notice').innerText()).includes(PAY_OFF('en'))) throw new Error('no friendly message (agent)');
    await shot(b.page, 'G3-pro-plans-agent');
    await done(b, { allow: PAY_ALLOW });
    const refund = await apiCall('POST', '/billing/refund', { token: atty.token, body: { reason: 'accidental' } });
    // payments off: every billing POST is 503 payments_unavailable (with keys: 409 nothing to refund — pro_billing_g G7)
    if (refund.status !== 503 || refund.body?.error !== 'payments_unavailable') throw new Error(`refund → ${refund.status}`);
    const sub = await apiCall('GET', '/billing/bondsman/subscription', { token: agent.token });
    if (sub.body?.active || sub.body?.subscription?.paid) throw new Error('bondsman plan active without payment');
    return `${attorneyMonthly.length} attorney + ${bondTiers.length} agent prices = server; friendly message ×2; refund ${refund.status}`;
  });

  // ── G4 ──────────────────────────────────────────────────────────────────
  const BAR = `AL${Math.floor(100000 + Math.random() * 899999)}`;
  await journey('G4 Bar verification: attorney submits → admin approves in Admin review → verified, audited', async () => {
    const s = await open(browser, { account: atty });
    await go(s.page, '/attorney-dashboard');
    await byTid(s.page, 'ad-tab-profile').click();
    await byTid(s.page, 'ad-bar-number').waitFor({ timeout: 15000 });
    await byTid(s.page, 'ad-bar-number').fill(BAR);
    await byTid(s.page, 'ad-bar-state').click();
    await byTid(s.page, 'ad-bar-state-AL').click();
    await byTid(s.page, 'ad-bar-submit').click();
    await byTid(s.page, 'ad-bar-msg').waitFor({ timeout: 10000 });
    await byTid(s.page, 'ad-tab-overview').click();
    await until(async () => (await byTid(s.page, 'ad-bar-status').innerText()).includes(BAR), 10000, 'pending status');
    await shot(s.page, 'G4-bar-submitted');
    await done(s);

    const a = await open(browser, { account: admin });
    await go(a.page, '/admin-review');
    await byTid(a.page, 'adm-bar').first().waitFor({ timeout: 15000 });
    const card = a.page.locator('[data-testid="adm-bar"]', { hasText: BAR });
    await card.waitFor({ timeout: 10000 });
    await shot(a.page, 'G4-admin-bar-queue');
    await card.locator('[data-testid="adm-bar-approve"]').click();
    await byTid(a.page, 'adm-notice').waitFor({ timeout: 10000 });
    await done(a);

    const s2 = await open(browser, { account: atty });
    await go(s2.page, '/attorney-dashboard');
    await until(async () => (await byTid(s2.page, 'ad-bar-status').innerText()).includes('✓'), 10000, 'verified');
    await shot(s2.page, 'G4-bar-verified');
    await done(s2);
    const n = DB_URL ? sql(`SELECT COUNT(*) FROM audit_log WHERE action = 'admin.bar_approved' AND entity_id = '${Number(atty.user.id)}'`) : 'n/a';
    if (DB_URL && Number(n) < 1) throw new Error('no audit entry for the approval');
    return `submitted ${BAR} → admin approved → verified; audit rows ${n}`;
  });

  // ── G5 ──────────────────────────────────────────────────────────────────
  await journey('G5 Leads with payments off: case lead + bail lead → friendly message, no contact shown', async () => {
    const lead = await apiCall('POST', '/billing/pi-lead/submit', { token: consumer.token, body: {
      case_type: 'employment', state: 'AL', city: 'Birmingham', severity: 'moderate',
      description: 'I was fired the week after reporting unpaid overtime to HR. Phone me at 615-555-0199.' } });
    if (lead.status !== 201 && lead.status !== 200) throw new Error(`submit lead ${lead.status} ${JSON.stringify(lead.body)}`);
    const s = await open(browser, { account: atty });
    await go(s.page, '/attorney-dashboard');
    await byTid(s.page, 'ad-tab-leads').click();
    // Alabama sells client requests as prepaid credits (services/leadRules.js), so the card shows
    // "answer with credits", never the per-lead card purchase the server would refuse there.
    const leadId = lead.body.lead?.id ?? lead.body.lead_id;
    const answerBtn = byTid(s.page, `ad-answer-lead-${leadId}`);
    await answerBtn.waitFor({ timeout: 15000 });
    if (await byTid(s.page, `ad-buy-lead-${leadId}`).count()) throw new Error('card purchase offered in a credit-pack state');
    const card = await s.page.locator('[data-testid="ad-open-lead"]', { has: answerBtn }).innerText();
    if (/615-555-0199|Maria/.test(card)) throw new Error('contact shown before purchase');
    const bal = (await apiCall('GET', '/billing/pi-lead/credits', { token: atty.token })).body;
    await answerBtn.click();
    await byTid(s.page, 'ad-leads-notice').waitFor({ timeout: 10000 });
    const note = await byTid(s.page, 'ad-leads-notice').innerText();
    // no credits bought (payments are off): the server's "buy a credit pack first" message
    if (Number(bal.balance) === 0 && !/credit/i.test(note)) throw new Error(`no honest message (case lead): "${note}"`);
    await shot(s.page, 'G5-case-lead-payments-off');
    await done(s, { allow: [...PAY_ALLOW, '402 POST /billing/pi-lead/claim/'] });   // 402 not_enough_credits is the expected answer
    const after = await apiCall('GET', '/billing/pi-leads/mine', { token: atty.token });
    const mine = Array.isArray(after.body) ? after.body : (after.body?.leads || []);
    if (mine.length) throw new Error('lead recorded as bought without payment');

    const b = await open(browser, { account: agent });
    await go(b.page, '/bondsman-dashboard');
    await byTid(b.page, 'bd-tab-profile').click();
    await byTid(b.page, 'bd-company').waitFor({ timeout: 15000 });
    await byTid(b.page, 'bd-company').fill('Bo Bonds LLC');
    await byTid(b.page, 'bd-counties').fill('Davidson');
    await byTid(b.page, 'bd-profile-save').click();
    await byTid(b.page, 'bd-notice').waitFor({ timeout: 10000 });
    await byTid(b.page, 'bd-tab-leads').click();
    await b.page.waitForTimeout(1500);
    let detail = 'no arrests in the feed window';
    if (await byTid(b.page, 'lead-card').count()) {
      const names = await byTid(b.page, 'lead-defendant-name').allInnerTexts();
      if (names.some(n => /[a-z]{3,}\s+[a-z]{3,}/i.test(n) && !/\./.test(n))) throw new Error(`full name before purchase: ${names[0]}`);
      const first = b.page.locator('[data-testid^="buy-lead-"]').first();
      await first.click();
      await byTid(b.page, 'bd-notice').waitFor({ timeout: 10000 });
      if (!(await byTid(b.page, 'bd-notice').innerText()).includes(PAY_OFF('en'))) throw new Error('no friendly message (bail lead)');
      detail = `${names.length} leads with initials only; buy → friendly message`;
    } else {
      await byTid(b.page, 'bd-no-leads').waitFor({ timeout: 5000 });
    }
    await shot(b.page, 'G5-bail-leads');
    await done(b, { allow: PAY_ALLOW });
    return `case lead $100 (employment), no contact, friendly message; bail: ${detail}`;
  });

  // ── G6 ──────────────────────────────────────────────────────────────────
  await journey('G6 Direct messages: claimed listing → consumer writes → attorney inbox shows it → reply read', async () => {
    const free = sql(`SELECT l.id FROM lawyers l WHERE l.user_id IS NULL AND NOT EXISTS (SELECT 1 FROM attorney_profiles ap WHERE ap.lawyer_id = l.id)
                      AND NOT EXISTS (SELECT 1 FROM listing_claims c WHERE c.table_name = 'lawyers' AND c.record_id = l.id) ORDER BY l.id LIMIT 1`);
    if (!free) throw new Error('no unclaimed lawyer listing to use');
    const claim = await apiCall('POST', '/help/claims', { token: atty.token, body: { provider_type: 'lawyer', provider_id: Number(free), license_number: BAR, license_state: 'AL' } });
    if (claim.status >= 300) throw new Error(`claim ${claim.status}`);
    const a = await open(browser, { account: admin });
    await go(a.page, '/admin-review');
    await byTid(a.page, 'adm-tab-claims').click();
    const c = a.page.locator('[data-testid="adm-claim"]', { hasText: atty.email });
    await c.waitFor({ timeout: 15000 });
    await shot(a.page, 'G6-admin-claims');
    await c.getByText(tx('en', 'adm_approve'), { exact: true }).click();
    await byTid(a.page, 'adm-notice').waitFor({ timeout: 10000 });
    await done(a);

    const MSG = `Hello, I need help with a hearing next week ${uniq()}`;
    const sent = await apiCall('POST', '/messages/bulk', { token: consumer.token, body: { lawyer_ids: [Number(free)], message: MSG } });
    if (sent.status >= 300) throw new Error(`bulk ${sent.status} ${JSON.stringify(sent.body)}`);
    const s = await open(browser, { account: atty });
    await go(s.page, '/attorney-inbox');
    const row = s.page.locator('[data-testid="inbox-direct"]', { hasText: MSG.slice(0, 30) });
    await row.waitFor({ timeout: 15000 });
    await shot(s.page, 'G6-inbox-direct');
    await row.click();
    await byTid(s.page, 'direct-conversation').waitFor({ timeout: 10000 });
    const REPLY = `Yes, call my office tomorrow ${uniq()}`;
    await byTid(s.page, 'direct-reply').fill(REPLY);
    await byTid(s.page, 'direct-send').click();
    await s.page.getByText(REPLY).first().waitFor({ timeout: 10000 });
    await shot(s.page, 'G6-attorney-reply');
    await done(s);

    const cpage = await open(browser, { account: consumer });
    await go(cpage.page, `/messages?directWith=${Number(atty.user.id)}`);
    await cpage.page.getByText(REPLY).first().waitFor({ timeout: 15000 });
    await shot(cpage.page, 'G6-consumer-reads-reply');
    await done(cpage);
    return 'claim approved → bulk message shown in the inbox → reply → consumer reads it';
  });

  // ── G7 ──────────────────────────────────────────────────────────────────
  await journey('G7 Firm trial + conflict check: start trial, invite, normalized name match', async () => {
    const s = await open(browser, { account: atty });
    await go(s.page, '/firm-trial');
    await byTid(s.page, 'fa-start').waitFor({ timeout: 15000 });
    const st = await apiCall('GET', '/firm-acquisition/status', { token: atty.token });
    const terms = tx('en', 'fa_trial_terms', { days: st.body.trial_days, seats: st.body.trial_seats });
    if (!(await bodyText(s.page)).includes(terms)) throw new Error(`trial terms "${terms}" not shown`);
    await byTid(s.page, 'fa-firm-name').fill('Counsel & Partners');
    await byTid(s.page, 'fa-vertical-criminal_defense').click();
    await byTid(s.page, 'fa-start-trial').click();
    await byTid(s.page, 'fa-trial').waitFor({ timeout: 15000 });
    await byTid(s.page, 'fa-invite-email').fill(`colleague-${uniq()}@journeys.test`);
    await byTid(s.page, 'fa-invite-send').click();
    await until(async () => (await byTid(s.page, 'fa-notice').count()) > 0, 10000, 'invite notice');
    await shot(s.page, 'G7-firm-trial');
    await go(s.page, '/conflict-check');
    await byTid(s.page, 'cc-add-names').waitFor({ timeout: 15000 });
    await byTid(s.page, 'cc-role-adverse').click();
    await byTid(s.page, 'cc-add-names').fill('José Ramírez\nAcme Holdings, Inc.');
    await byTid(s.page, 'cc-add').click();
    await byTid(s.page, 'cc-add-msg').waitFor({ timeout: 10000 });
    await byTid(s.page, 'cc-names').fill('JOSE RAMIREZ\nJose Ramirez Jr\nUnrelated Person');
    await byTid(s.page, 'cc-run').click();
    await byTid(s.page, 'cc-result').waitFor({ timeout: 10000 });
    const res = await byTid(s.page, 'cc-result').innerText();
    // accents / case ignored → exact; an extra "Jr" may be another person → possible match (for review)
    if (!res.includes(tx('en', 'cc_found_other', { n: 2 }))) throw new Error(`result "${res.slice(0, 160)}"`);
    const exact = await s.page.locator('[data-testid="cc-conflict"]', { hasText: 'JOSE RAMIREZ' }).first().innerText();
    if (!exact.includes('José Ramírez') || !exact.includes(tx('en', 'cc_exact'))) throw new Error(`no exact match: ${exact}`);
    const jr = await s.page.locator('[data-testid="cc-conflict"]', { hasText: 'Jose Ramirez Jr' }).innerText();
    if (!jr.includes(tx('en', 'cc_possible'))) throw new Error(`Jr not a possible match: ${jr}`);
    if ((await bodyText(s.page)).includes('Unrelated Person') && (await s.page.locator('[data-testid="cc-conflict"]', { hasText: 'Unrelated Person' }).count())) throw new Error('unrelated name matched');
    await shot(s.page, 'G7-conflict-check');
    await done(s);
    const es = await apiCall('POST', '/firm-acquisition/invite', { token: atty.token, lang: 'es', body: { email: 'not-an-email' } });
    if (!/correo electrónico/.test(String(es.body?.error))) throw new Error(`server message not in Spanish: ${es.body?.error}`);
    return `trial "${terms}"; invite sent; JOSE RAMIREZ → José Ramírez exact, "Jr" → possible; es error "${es.body.error}"`;
  });

  // ── G8 ──────────────────────────────────────────────────────────────────
  await journey('G8 Admin review: non-admins refused (screen + every queue route 403); admin sees the queues', async () => {
    const routes = [['GET', '/admin/queue/summary'], ['GET', '/admin/queue/bar'], ['POST', '/admin/queue/bar/1'], ['GET', '/admin/queue/claims'],
      ['POST', '/admin/queue/claims/1'], ['GET', '/admin/queue/reports'], ['POST', '/admin/queue/reports/1'], ['GET', '/admin/queue/reviews'], ['POST', '/admin/queue/reviews/1']];
    for (const who of [consumer, atty, agent]) {
      for (const [m, p] of routes) {
        const r = await apiCall(m, p, { token: who.token, body: m === 'POST' ? { approved: true, decision: 'approve', status: 'resolved', action: 'hide' } : undefined });
        if (r.status !== 403) throw new Error(`${who.user.accountType || who.user.role} ${m} ${p} → ${r.status}`);
      }
      const s = await open(browser, { account: who });
      await go(s.page, '/admin-review');
      await byTid(s.page, 'admin-not-allowed').waitFor({ timeout: 15000 });
      if (s.failed.some(f => f.includes('/admin/'))) throw new Error('screen called the admin API for a non-admin');
      await done(s);
    }
    for (const [m, p] of routes) { const r = await apiCall(m, p); if (r.status !== 401) throw new Error(`no token ${m} ${p} → ${r.status}`); }
    const a = await open(browser, { account: admin });
    await go(a.page, '/admin-review');
    for (const q of ['bar', 'claims', 'reports', 'reviews']) {
      await byTid(a.page, `adm-tab-${q}`).click();
      await a.page.waitForTimeout(600);
      await shot(a.page, `G8-admin-${q}`);
    }
    await done(a);
    return `${routes.length} routes × 3 non-admin roles → 403, no token → 401; admin: 4 queues`;
  });

  // ── G9 / G10 ────────────────────────────────────────────────────────────
  const PAGES = [
    ['/plans', consumer, 'consumer-subscription-screen'], ['/payments', consumer, 'payments-screen'],
    ['/subscribe', atty, 'subscription-screen'], ['/attorney-dashboard', atty, 'attorney-dashboard-screen'],
    ['/attorney-inbox', atty, 'attorney-inbox-screen'], ['/conflict-check', atty, 'conflict-check-screen'],
    ['/firm-trial', atty, 'firm-acquisition-screen'], ['/bondsman-dashboard', agent, 'bondsman-dashboard-screen'],
    ['/admin-review', admin, 'admin-verification-screen'],
  ];
  await journey('G9 es / pt / vi at 390 px: nine screens, no raw keys, no English, no overflow', async () => {
    const out = [];
    for (const lang of ['es', 'pt', 'vi']) {
      for (const [p, who, tid] of PAGES) {
        const s = await open(browser, { lang, account: who });
        await go(s.page, p);
        await byTid(s.page, tid).first().waitFor({ timeout: 15000 });
        await s.page.waitForTimeout(600);
        const txt = await bodyText(s.page);
        const raw = (txt.match(RAW_KEY) || []).filter(k => L.en[k] !== undefined || G_PREFIX.test(k));
        if (raw.length) throw new Error(`${lang} ${p}: raw keys ${raw.slice(0, 3)}`);
        const en = EN_G.filter(e => txt.includes(e));
        if (en.length) throw new Error(`${lang} ${p}: English "${en[0]}"`);
        if (await overflowX(s.page) > 1) throw new Error(`${lang} ${p}: horizontal overflow`);
        await shot(s.page, `G9-${lang}${p.replace(/\//g, '_')}`);
        out.push(`${lang}${p}`);
        await done(s);
      }
    }
    return `${out.length} pages clean`;
  });

  await journey('G10 Desktop 1280 px: nine screens render, no overflow', async () => {
    for (const [p, who, tid] of PAGES) {
      const s = await open(browser, { account: who, viewport: { width: 1280, height: 860 } });
      await go(s.page, p);
      await byTid(s.page, tid).first().waitFor({ timeout: 15000 });
      if (await overflowX(s.page) > 1) throw new Error(`${p}: horizontal overflow`);
      await shot(s.page, `G10-1280${p.replace(/\//g, '_')}`);
      await done(s);
    }
    return `${PAGES.length} screens`;
  });

  await journey('G11 Signed out: the nine screens ask to sign in, no failing request', async () => {
    const out = [];
    for (const lang of ['en', 'es']) {
      for (const [p] of PAGES) {
        const s = await open(browser, { lang });
        await go(s.page, p);
        if (p === '/plans' || p === '/subscribe') {   // public price lists; Subscribe asks to sign in
          await byTid(s.page, p === '/plans' ? 'consumer-subscription-screen' : 'subscription-screen').waitFor({ timeout: 15000 });
        } else {
          await byTid(s.page, 'sign-in-needed').waitFor({ timeout: 15000 });
        }
        const txt = await bodyText(s.page);
        if (/Authentication required|Autenticación requerida/.test(txt)) throw new Error(`${lang} ${p}: raw auth error`);
        if (s.failed.length) throw new Error(`${lang} ${p}: ${s.failed[0]}`);
        await shot(s.page, `G11-${lang}${p.replace(/\//g, '_')}`);
        out.push(`${lang}${p}`);
        await done(s);
      }
    }
    return `${out.length} pages`;
  });

  if (allErrors.length) fail('page errors', allErrors.slice(0, 5).join(' | ')); else pass('page errors', 'none');
  if (allFailed.length) fail('failed requests', [...new Set(allFailed)].slice(0, 8).join(' | ')); else pass('failed requests', 'none');
  await browser.close(); server.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
