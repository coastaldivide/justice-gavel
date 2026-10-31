#!/usr/bin/env node
/**
 * web-journeys-cases.cjs — section D (cases & court) journeys against a REAL
 * backend in production mode (no Stripe / e-mail / SMS keys).
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4300/api npx expo export --platform web --output-dir dist
 *   node scripts/web-journeys-cases.cjs dist out --api http://localhost:4300/api [--port 8300]
 *
 *   D1  Case editor at 390 px: every field inside the screen; create with a quick
 *       date + state + notes → card shows the court day; edit keeps notes and
 *       state; "Voice note" closes the editor first; delete removes the case
 *   D2  Tabs: Messages lists the case thread (not the case list); Tools shows the
 *       tools only
 *   D3  Court date added from a phone in Asia/Tokyo: the same calendar day in the
 *       list and the detail; "Change date or time" moves it and the reminders
 *       follow; the .ics download is a valid calendar file
 *   D4  Family follower: invite code → follower sees the court date, never the
 *       notes; "Stop following" removes it
 *   D5  Check-ins: bail agent enrolls in the manager (included-in-plan note; e-mail
 *       alone refused, phone required; link to send); the defendant, whose account
 *       verified that phone, opens Check-in with no link, finds it,
 *       checks in; the agent's list shows "checked in today" and the history
 *   D6  Messages + documents: no attorney yet is said; a "<script>" message shows
 *       as text; an attorney invited by account accepts and replies → unread
 *       badge; a PDF added on the web Documents screen is listed in the case and
 *       downloads; a stranger cannot open it
 *   D7  Family emergency connection (free since Oct 26, no Stripe needed): nobody listed near → honest message, nothing charged
 *   D8  Offline: a new case with a court date saved while offline is sent with its
 *       date when the connection is back
 *   D9  es / pt / vi at 390 px: cases, check-in, manager, documents — no raw
 *       keys, no English text, no horizontal overflow
 *   D10 Signed out (en, es): Cases, a case timeline, a court date and Documents
 *       show a Sign in prompt that opens the sign-in sheet; no case data, no
 *       "Authentication required.", no failing request
 *   D11 Another account opens someone's timeline / thread link: "This case is not
 *       available", no composer, no Add event, the title never shown (en, vi)
 * Exit 1 on any failure.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const JOURNEY_DB = process.env.DATABASE_URL || '';
const psql = (q) => execFileSync('psql', [JOURNEY_DB, '-Atqc', q], { encoding: 'utf8' }).trim();

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-cases-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4300/api')).replace(/\/$/, '');
const PORT = Number(arg('--port', 8300));
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
const freshIp = () => `10.69.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
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
async function newUser(tag, { accountType } = {}) {
  const email = `d-${tag}-${uniq()}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { body: { identifier: email, password: PASSWORD, displayName: `Dana ${tag}`, ...(accountType ? { accountType } : {}) } });
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

async function open(browser, { lang = 'en', viewport = { width: 390, height: 844 }, account = null, tz = 'America/Chicago' } = {}) {
  const ctx = await browser.newContext({ viewport, locale: LOCALES[lang], timezoneId: tz, serviceWorkers: 'block', acceptDownloads: true,
    extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  const page = await ctx.newPage();
  lastPage = page;
  const errors = []; const failed = []; const dialogs = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(API)) failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(API.length)}`); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
  await page.addInitScript(() => {
    window.__shared = [];
    // the share sheet: record what would be shared
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared.push(d); } });
  });
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
  return { ctx, page, errors, failed, dialogs, shared: () => page.evaluate(() => window.__shared.slice()) };
}
async function go(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(700); }
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
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Elements with this testID that stick out of the viewport horizontally. */
const outside = (page, ids) => page.evaluate((list) => list.flatMap(id => [...document.querySelectorAll(`[data-testid="${id}"]`)]
  .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > window.innerWidth + 1); }).map(() => id)), ids);
const ymd = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const longDay = (s, lang = 'en') => new Date(`${s}T12:00:00Z`).toLocaleDateString(LOCALES[lang], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).replace(/[  ]/g, ' ');
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

  // ── D1 ──────────────────────────────────────────────────────────────────
  await journey('D1 Case editor at 390 px: create, edit (notes kept), voice note closes the editor, delete', async () => {
    const me = await newUser('d1');
    const s = await open(browser, { account: me });
    await go(s.page, '/cases');
    await byTid(s.page, 'case-empty-state').waitFor({ timeout: 15000 });
    await byTid(s.page, 'case-add-button').click();
    await byTid(s.page, 'case-editor').waitFor();
    const off = await outside(s.page, ['case-save', 'case-editor-close', 'case-title-input', 'case-court-date', 'case-state-input', 'case-notes-input', 'case-status-Dismissed']);
    if (off.length) throw new Error(`off-screen in the editor: ${off.join(', ')}`);
    await byTid(s.page, 'case-save').click();
    await byTid(s.page, 'case-editor-error').waitFor();
    await byTid(s.page, 'case-title-input').fill('DUI — Davidson County');
    await byTid(s.page, 'case-court-date').first().click();                    // +7 days (local)
    const date = await byTid(s.page, 'case-court-date-input').inputValue();
    await byTid(s.page, 'case-state-input').fill('tn');
    await byTid(s.page, 'case-notes-input').fill('Attorney: J. Smith, 615-555-0101');
    await byTid(s.page, 'case-save').click();
    await byTid(s.page, 'case-card').waitFor({ timeout: 10000 });
    const card = await byTid(s.page, 'case-card').innerText();
    if (!card.includes(longDay(date))) throw new Error(`card does not show ${longDay(date)}: ${card.slice(0, 200)}`);
    const api = (await apiCall('GET', '/cases', { token: me.token })).body[0];
    if (api.state !== 'TN' || api.next_court_date.slice(0, 10) !== date) throw new Error(`saved ${api.state} ${api.next_court_date}`);
    await shot(s.page, 'D1-card');
    // edit: change the title only — notes and state stay
    await byTid(s.page, 'case-edit').click();
    await byTid(s.page, 'case-title-input').fill('DUI — Davidson (edited)');
    await byTid(s.page, 'case-save').click();
    await until(async () => (await bodyText(s.page)).includes('(edited)'), 10000, 'edited title');
    const after = (await apiCall('GET', '/cases', { token: me.token })).body[0];
    if (!after.notes.includes('J. Smith') || after.state !== 'TN') throw new Error('edit lost notes / state');
    // voice note: the editor closes first
    await byTid(s.page, 'case-edit').click();
    await byTid(s.page, 'case-voice-note').click();
    await byTid(s.page, 'voice-note-screen').waitFor({ timeout: 10000 });
    if (await byTid(s.page, 'case-editor').isVisible().catch(() => false)) throw new Error('editor still open over the voice note');
    await shot(s.page, 'D1-voice-note');
    await go(s.page, '/cases');
    await byTid(s.page, 'case-edit').click();
    await byTid(s.page, 'case-delete').click();
    await byTid(s.page, 'case-empty-state').waitFor({ timeout: 10000 });
    if ((await apiCall('GET', '/cases', { token: me.token })).body.length) throw new Error('case still on the server');
    if (await overflowX(s.page) > 1) throw new Error('horizontal overflow');
    await done(s);
    return `created ${date} TN, edited (notes kept), voice note on top, deleted`;
  });

  // ── D2 ──────────────────────────────────────────────────────────────────
  await journey('D2 Tabs: Messages = threads, Tools = tools only', async () => {
    const me = await newUser('d2');
    await apiCall('POST', '/cases', { token: me.token, body: { title: 'Tab case', next_court_date: inDays(20) } });
    const s = await open(browser, { account: me });
    await go(s.page, '/cases');
    await byTid(s.page, 'case-card').waitFor({ timeout: 15000 });
    await byTid(s.page, 'case-tab-messages').click();
    await byTid(s.page, 'case-thread-row').waitFor();
    if (await byTid(s.page, 'case-card').count()) throw new Error('case cards shown on the Messages tab');
    await byTid(s.page, 'case-tab-tools').click();
    await byTid(s.page, 'case-tool-deadlines').waitFor();
    if (await byTid(s.page, 'case-card').count()) throw new Error('case cards shown on the Tools tab');
    await byTid(s.page, 'case-tab-messages').click();
    await byTid(s.page, 'case-thread-row').click();
    await byTid(s.page, 'messages-screen').waitFor();
    await done(s);
    return 'threads tab → thread opens; tools tab without case cards';
  });

  // ── D3 ──────────────────────────────────────────────────────────────────
  await journey('D3 Court date from Asia/Tokyo: same calendar day, reschedule, .ics', async () => {
    const me = await newUser('d3');
    const c = await apiCall('POST', '/cases', { token: me.token, body: { title: 'Tokyo case', state: 'TN' } });
    const s = await open(browser, { account: me, tz: 'Asia/Tokyo' });
    await go(s.page, '/court-dates');
    await byTid(s.page, 'court-date-add').click();
    await byTid(s.page, 'court-form-date').waitFor();
    const day = inDays(30);
    // the only case is preselected
    await byTid(s.page, 'court-form-date').fill(day);
    await byTid(s.page, 'court-form-time').fill('09:30');
    await byTid(s.page, 'court-form-save').click();
    await byTid(s.page, 'court-date-detail-screen').waitFor({ timeout: 15000 });
    await until(async () => (await byTid(s.page, 'court-date-when').innerText().catch(() => '')).includes(longDay(day)), 8000, 'detail day');
    const rows = await byTid(s.page, 'court-reminder-row').count();
    if (rows !== 4) throw new Error(`${rows} reminders listed`);
    // reschedule (a continuance)
    const moved = inDays(37);
    await byTid(s.page, 'court-date-edit').click();
    await byTid(s.page, 'court-edit-date').waitFor();
    await s.page.waitForTimeout(700);                                         // the sheet's slide-in
    await byTid(s.page, 'court-edit-date').fill(moved);
    await byTid(s.page, 'court-edit-save').click();
    await until(async () => (await byTid(s.page, 'court-date-when').innerText().catch(() => '')).includes(longDay(moved)), 8000, 'moved day');
    const list = (await apiCall('GET', `/court-dates?case_id=${c.body.id}`, { token: me.token })).body;
    if (list.upcoming.length !== 1 || list.upcoming[0].court_date !== moved) throw new Error(`server has ${JSON.stringify(list.upcoming.map(x => x.court_date))}`);
    const rem = (await apiCall('GET', `/court-dates/${list.upcoming[0].id}/reminders`, { token: me.token })).body.reminders;
    if (!rem.every(r => r.court_date === moved)) throw new Error('reminders did not follow the new date');
    // .ics
    const [dl] = await Promise.all([s.page.waitForEvent('download', { timeout: 10000 }), byTid(s.page, 'court-date-ics').click()]);
    const file = path.join(OUT, 'D3.ics'); await dl.saveAs(file);
    const ics = fs.readFileSync(file, 'utf8');
    if (!/^BEGIN:VCALENDAR\r\n/.test(ics) || !ics.includes(`DTSTART;TZID=America/Chicago:${moved.replace(/-/g, '')}T093000`)) throw new Error('ics not valid / wrong zone');
    await go(s.page, '/court-dates');
    const listText = await bodyText(s.page);
    if (!listText.includes(longDay(moved))) throw new Error('list shows another day');
    await shot(s.page, 'D3-list-tokyo');
    await done(s);
    return `${longDay(day)} → ${longDay(moved)} in Tokyo; 4 reminders; ics TZID=America/Chicago`;
  });

  // ── D4 ──────────────────────────────────────────────────────────────────
  await journey('D4 Family follower sees court dates only; can stop following', async () => {
    const owner = await newUser('d4o'); const fam = await newUser('d4f');
    const day = inDays(12);
    const c = await apiCall('POST', '/cases', { token: owner.token, body: { title: 'Shared case', next_court_date: day, notes: 'PRIVATE-NOTE-XYZ' } });
    const inv = await apiCall('POST', `/cases/${c.body.id}/followers`, { token: owner.token, body: { consent: true } });
    const s = await open(browser, { account: fam });
    await go(s.page, '/court-dates');
    await byTid(s.page, 'follow-code-input').fill(inv.body.invite_code);
    await byTid(s.page, 'follow-code-submit').click();
    await byTid(s.page, 'following-court-date').waitFor({ timeout: 10000 });
    const txt = await bodyText(s.page);
    if (!txt.includes(longDay(day))) throw new Error('follower does not see the date');
    if (txt.includes('PRIVATE-NOTE-XYZ')) throw new Error('follower sees the notes');
    await go(s.page, '/cases');
    if ((await bodyText(s.page)).includes('PRIVATE-NOTE-XYZ')) throw new Error('notes visible on the follower cases screen');
    await go(s.page, '/court-dates');
    await byTid(s.page, 'following-stop').click();
    await until(async () => !(await byTid(s.page, 'following-court-date').count()), 8000, 'follow removed');
    if ((await apiCall('GET', '/following', { token: fam.token })).body.following.length) throw new Error('still following on the server');
    await done(s);
    return 'date shown, notes never; stopped following';
  });

  // ── D5 ──────────────────────────────────────────────────────────────────
  await journey('D5 Check-ins: agent enrolls by phone (e-mail alone refused), defendant with that verified phone finds it and checks in, agent sees it', async () => {
    const agent = await newUser('d5a', { accountType: 'bail_agent' }); const def = await newUser('d5d');
    const a = await open(browser, { account: agent });
    await go(a.page, '/checkin/manage');
    await byTid(a.page, 'checkin-manager-billing').waitFor({ timeout: 15000 });
    // Oct 26 2026: check-ins are included in every bail-agent plan (routes/checkins.js FEE_PER_DEFENDANT_CENTS = 0)
    const billNote = await byTid(a.page, 'checkin-manager-billing').innerText();
    if (!billNote.includes(tx('en', 'ckm_included'))) throw new Error(`billing note not honest: ${billNote}`);
    await byTid(a.page, 'checkin-manager-enroll').click();
    await byTid(a.page, 'checkin-enroll-name').fill('Dana Defendant');
    await byTid(a.page, 'checkin-enroll-save').click();
    await byTid(a.page, 'checkin-enroll-error').waitFor();
    // e-mail alone is refused (since Oct 27 accounts are matched only by a VERIFIED phone number)
    await byTid(a.page, 'checkin-enroll-email').fill(def.email);
    await byTid(a.page, 'checkin-enroll-save').click();
    await a.page.waitForTimeout(400);
    if (!(await byTid(a.page, 'checkin-enroll-error').innerText()).includes(tx('en', 'ckm_need_contact'))) throw new Error('e-mail-only enrollment not refused');
    const phone10 = `615555${String(Date.now()).slice(-4)}`;
    await byTid(a.page, 'checkin-enroll-phone').fill(`(${phone10.slice(0, 3)}) ${phone10.slice(3, 6)}-${phone10.slice(6)}`);
    await byTid(a.page, 'checkin-enroll-save').click();
    await byTid(a.page, 'checkin-manager-row').waitFor({ timeout: 10000 });
    const shared = await a.shared();
    if (!shared.length || !/\/checkin\?enrollmentId=\d+/.test(shared[0].text || '')) throw new Error(`no link shared: ${JSON.stringify(shared)}`);
    if (!(await byTid(a.page, 'checkin-manager-row').innerText()).includes(tx('en', 'ckm_waiting_sign_in'))) throw new Error('not "waiting for sign in"');
    // the defendant, no link: their account verified that number (a texted code; set directly here)
    if (!JOURNEY_DB) throw new Error('DATABASE_URL is needed to mark the phone verified');
    psql(`UPDATE users SET phone = '+1${phone10}', phone_verified_at = NOW(), phone_verified_phone = '+1${phone10}' WHERE id = ${Number(def.user.id)}`);
    const d = await open(browser, { account: def, tz: 'America/Los_Angeles' });
    await go(d.page, '/checkin');
    await byTid(d.page, 'checkin-submit-button').waitFor({ timeout: 15000 });
    if (!(await bodyText(d.page)).includes(tx('en', 'ck2_for_agent', { agent: 'Dana d5a' }))) throw new Error('agent name not shown');
    await byTid(d.page, 'checkin-notes-input').fill('At home');
    await byTid(d.page, 'checkin-submit-button').click();
    await byTid(d.page, 'checkin-success-screen').waitFor({ timeout: 10000 });
    const doneTxt = await byTid(d.page, 'checkin-success-screen').innerText();
    if (!doneTxt.includes(tx('en', 'ck2_agent_will_see'))) throw new Error('claims the agent was notified without a device');
    await shot(d.page, 'D5-defendant-done');
    await go(a.page, '/checkin/manage');
    await until(async () => (await byTid(a.page, 'checkin-manager-row').innerText()).includes(tx('en', 'x_check_in_manager_checked_today')), 8000, 'checked today');
    await byTid(a.page, 'checkin-manager-history').click();
    await byTid(a.page, 'checkin-history').waitFor();
    await until(async () => (await byTid(a.page, 'checkin-history').innerText()).includes('At home'), 8000, 'history note');
    await shot(a.page, 'D5-agent-history');
    // a consumer account sees what the tool is for, no enroll button
    const c = await open(browser, { account: def });
    await go(c.page, '/checkin/manage');
    await byTid(c.page, 'checkin-manager-agents-only').waitFor({ timeout: 10000 });
    await done(a); await done(d); await done(c);
    return 'e-mail alone refused, enrolled by phone, link shared, defendant (verified phone) checked in (LA zone), agent list + history';
  });

  // ── D6 ──────────────────────────────────────────────────────────────────
  await journey('D6 Messages + documents: counsel invite/accept, escaping, unread, PDF upload/download, no IDOR', async () => {
    const me = await newUser('d6'); const atty = await newUser('d6a', { accountType: 'attorney' }); const other = await newUser('d6x');
    const c = await apiCall('POST', '/cases', { token: me.token, body: { title: 'Thread case' } });
    const s = await open(browser, { account: me });
    await go(s.page, `/messages/${c.body.id}`);
    await byTid(s.page, 'messages-counsel').waitFor({ timeout: 15000 });
    if (!(await byTid(s.page, 'messages-counsel').innerText()).includes(tx('en', 'msg2_no_counsel'))) throw new Error('no-attorney note missing');
    await s.page.getByLabel(tx('en', 'x_messages_message_input')).fill('<script>alert(1)</script> hello');
    await s.page.getByLabel(tx('en', 'msg_send')).click();
    await until(async () => (await bodyText(s.page)).includes('<script>alert(1)</script> hello'), 8000, 'message shown as text');
    // counsel by account (the attorney has no directory listing here), accept, reply
    const inv = await apiCall('POST', `/cases/${c.body.id}/counsel`, { token: me.token, body: { attorney_user_id: atty.user.id } });
    await apiCall('POST', `/attorney/inbox/accept/${inv.body.assignment_id}`, { token: atty.token });
    await apiCall('POST', `/messages/${c.body.id}`, { token: atty.token, body: { body: 'Reply from counsel' } });
    await go(s.page, '/cases');
    await byTid(s.page, 'case-tab-messages').click();
    await until(async () => (await byTid(s.page, 'case-thread-row').innerText().catch(() => '')).includes('1'), 8000, 'unread badge');
    await byTid(s.page, 'case-thread-row').click();
    await until(async () => (await bodyText(s.page)).includes('Reply from counsel'), 8000, 'reply');
    if (!(await byTid(s.page, 'messages-counsel').innerText()).includes(tx('en', 'msg2_counsel_active'))) throw new Error('counsel not shown as active');
    // documents on the web
    await go(s.page, `/scan`);
    await byTid(s.page, 'doc-case-option').first().click();
    const pdf = path.join(OUT, 'bail-slip.pdf'); fs.writeFileSync(pdf, '%PDF-1.4\n% section D test\n');
    await s.page.setInputFiles('[data-testid="doc-upload-input"]', pdf);
    await byTid(s.page, 'doc-upload-done').waitFor({ timeout: 15000 });
    await byTid(s.page, 'doc-item').waitFor({ timeout: 10000 });
    const [dl] = await Promise.all([s.page.waitForEvent('download', { timeout: 10000 }), byTid(s.page, 'doc-item').first().click()]);
    const got = path.join(OUT, 'D6-download.pdf'); await dl.saveAs(got);
    if (!fs.readFileSync(got, 'utf8').startsWith('%PDF-1.4')) throw new Error('download is not the file');
    const big = path.join(OUT, 'big.pdf'); fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024, 0x20));
    await s.page.setInputFiles('[data-testid="doc-upload-input"]', big);
    await byTid(s.page, 'doc-upload-error').waitFor();
    await shot(s.page, 'D6-documents');
    const thread = (await apiCall('GET', `/messages/${c.body.id}`, { token: me.token })).body.messages;
    const att = thread.find(m => m.attachment_id);
    const r = await fetch(`${API}/messages/attachment/${att.attachment_id}`, { headers: { Authorization: `Bearer ${other.token}`, 'X-Forwarded-For': freshIp() } });
    if (r.status !== 404) throw new Error(`stranger got ${r.status}`);
    const r2 = await fetch(`${API}/messages/attachment/${att.attachment_id}`, { headers: { Authorization: `Bearer ${atty.token}`, 'X-Forwarded-For': freshIp() } });
    if (r2.status !== 200) throw new Error(`counsel got ${r2.status}`);
    await done(s, { allow: ['413'] });
    return 'no-counsel note, <script> as text, unread 1 → read, PDF uploaded + downloaded, 11 MB refused, stranger 404, counsel 200';
  });

  // ── D7 ──────────────────────────────────────────────────────────────────
  await journey('D7 Family emergency connection (free): nobody listed near → honest message, nothing charged', async () => {
    const me = await newUser('d7');
    const s = await open(browser, { account: me });
    await go(s.page, '/family');
    await byTid(s.page, 'family-connect-price').waitFor({ timeout: 15000 });
    // the price comes from the server (free since Oct 26 2026: billing/connections.js)
    const quote = (await apiCall('GET', '/billing/family/quote')).body;
    const shown = (await byTid(s.page, 'family-connect-price').innerText()).trim();
    const want = quote.price_cents > 0 ? `$${(quote.price_cents / 100).toFixed(2)}` : tx('en', 'fc2_price_free');
    if (!shown.includes(want)) throw new Error(`price not from the server: "${shown}" (server ${quote.price_cents})`);
    await s.page.getByText(tx('en', 'x_family_connect_skip_search_continue')).click();
    await s.page.getByPlaceholder(tx('en', 'x_family_connect_jane_smith')).fill('Ana Family');
    await s.page.getByPlaceholder(tx('en', 'x_auth_gate_phone_number')).fill('615 555 0100');
    await byTid(s.page, 'family-connect-pay').click();
    await byTid(s.page, 'family-connect-error').waitFor({ timeout: 15000 });
    const msg = await byTid(s.page, 'family-connect-error').innerText();
    // free: no payment step even with payments off; this test database lists nobody near, so the
    // server answers 404 none_found ("…Nothing was charged.")
    if (quote.price_cents > 0) {
      if (!msg.includes(tx('en', 'x_common_payments_aren_t_available'))) throw new Error(`message: ${msg}`);
    } else if (!/Nothing was charged/.test(msg)) throw new Error(`message: ${msg}`);
    const txt = await bodyText(s.page);
    if (/verified|Demo mode/i.test(txt)) throw new Error('false claims on the page');
    await shot(s.page, 'D7-family-connect');
    await done(s, { allow: ['503 POST /billing/family/connect', '404 POST /billing/family/connect'] });
    return `server price (${quote.price_cents ? quote.price_cents + '¢' : 'free'}), honest message, no contacts invented, no "verified"/"demo" claims`;
  });

  // ── D8 ──────────────────────────────────────────────────────────────────
  await journey('D8 Offline: a new case keeps its court date and state when it syncs', async () => {
    const me = await newUser('d8');
    const s = await open(browser, { account: me });
    await go(s.page, '/cases');
    await byTid(s.page, 'case-empty-state').waitFor({ timeout: 15000 });
    await s.ctx.route(`${API}/cases`, r => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()));
    await byTid(s.page, 'case-add-button').click();
    await byTid(s.page, 'case-title-input').fill('Offline case');
    const day = inDays(15);
    await byTid(s.page, 'case-court-date-input').fill(day);
    await byTid(s.page, 'case-state-input').fill('GA');
    await byTid(s.page, 'case-save').click();
    await byTid(s.page, 'case-offline-message').waitFor({ timeout: 10000 });
    await byTid(s.page, 'case-card-offline').waitFor();
    await s.ctx.unroute(`${API}/cases`);
    // back on the case list with a working connection: the queued case is sent
    await go(s.page, '/court-dates');
    await s.page.goBack().catch(() => {});
    await s.page.waitForTimeout(500);
    await go(s.page, '/cases');
    await until(async () => (await apiCall('GET', '/cases', { token: me.token })).body.length === 1, 20000, 'synced');
    const saved = (await apiCall('GET', '/cases', { token: me.token })).body[0];
    if (saved.next_court_date.slice(0, 10) !== day || saved.state !== 'GA') throw new Error(`synced without date/state: ${JSON.stringify(saved)}`);
    await done(s, { allow: ['POST /cases'] });
    return `synced with ${day} GA`;
  });

  // ── D9 ──────────────────────────────────────────────────────────────────
  await journey('D9 es / pt / vi at 390 px: no raw keys, no English, no overflow', async () => {
    const owner = await newUser('d9'); const agent = await newUser('d9a', { accountType: 'bail_agent' });
    await apiCall('POST', '/cases', { token: owner.token, body: { title: 'Caso 9', next_court_date: inDays(9), state: 'TX' } });
    await apiCall('POST', '/checkins/enroll', { token: agent.token, body: { defendant_name: 'Dana Nueve', defendant_email: owner.email } });
    const EN = ['Edit case', 'Court dates & reminders', 'Messages', 'Documents', 'Check-in due', 'Daily Check-In', 'Billing is not active', 'Waiting for them', 'Case documents', 'Which case'];
    const out = [];
    for (const lang of ['es', 'pt', 'vi']) {
      for (const [who, p] of [[owner, '/cases'], [owner, '/checkin'], [agent, '/checkin/manage'], [owner, '/scan'], [owner, '/messages']]) {
        const s = await open(browser, { lang, account: who });
        await go(s.page, p);
        await s.page.waitForTimeout(800);
        const txt = await bodyText(s.page);
        const raw = (txt.match(/\b(?:x_|cs2_|ck2_|ckm_|msg2_|doc2_|cd_|cdd_)[a-z0-9_]{3,}\b/g) || []);
        if (raw.length) throw new Error(`${lang} ${p}: raw keys ${raw.slice(0, 3)}`);
        const en = EN.filter(e => txt.includes(e));
        if (en.length) throw new Error(`${lang} ${p}: English "${en[0]}"`);
        if (await overflowX(s.page) > 1) throw new Error(`${lang} ${p}: overflow`);
        await shot(s.page, `D9-${lang}${p.replace(/\//g, '_')}`);
        out.push(`${lang}${p}`);
        await done(s);
      }
    }
    return `${out.length} pages clean`;
  });

  await journey('D10 Signed out: every case screen offers Sign in, sends no request that fails', async () => {
    const owner = await newUser('d10');
    const c = await apiCall('POST', '/cases', { token: owner.token, body: { title: 'Private case', next_court_date: inDays(12) } });
    const cd = await apiCall('POST', '/court-dates', { token: owner.token, body: { case_id: c.body.id, court_date: inDays(12), court_time: '09:00' } });
    const out = [];
    for (const lang of ['en', 'es']) {
      for (const [p, tid] of [['/cases', 'case-sign-in'], [`/case/${c.body.id}/timeline`, 'timeline-sign-in'], [`/court-dates/${cd.body.id}`, 'court-date-sign-in'], ['/scan', 'doc-sign-in']]) {
        const s = await open(browser, { lang });
        const bad = [];
        s.page.on('response', r => { if (r.url().startsWith(API) && r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(API.length)}`); });
        await go(s.page, p);
        await byTid(s.page, tid).waitFor({ timeout: 15000 });
        const txt = await bodyText(s.page);
        if (/Authentication required|Autenticación requerida/.test(txt)) throw new Error(`${lang} ${p}: raw auth error`);
        if (txt.includes('Private case')) throw new Error(`${lang} ${p}: case shown signed out`);
        if (bad.length) throw new Error(`${lang} ${p}: ${bad[0]}`);
        await byTid(s.page, `${tid}-button`).click();
        await s.page.getByText(tx(lang, 'x_auth_gate_create_free_account')).first().waitFor({ timeout: 5000 });   // the sign-in / create-account sheet
        await shot(s.page, `D10-${lang}${p.replace(/\//g, '_')}`);
        out.push(`${lang}${p}`);
        await done(s);
      }
    }
    return `${out.length} pages: sign-in prompt, no failing request`;
  });

  await journey('D11 Someone else\'s case: timeline and messages say it is not available, no composer', async () => {
    const owner = await newUser('d11'); const other = await newUser('d11o');
    const c = await apiCall('POST', '/cases', { token: owner.token, body: { title: 'Owner only' } });
    const out = [];
    for (const lang of ['en', 'vi']) {
      for (const [p, tid] of [[`/case/${c.body.id}/timeline`, 'timeline-unavailable'], [`/messages/${c.body.id}`, 'messages-unavailable']]) {
        const s = await open(browser, { lang, account: other });
        await go(s.page, p);
        await byTid(s.page, tid).waitFor({ timeout: 15000 });
        const txt = await bodyText(s.page);
        if (!txt.includes(tx(lang, 'case_unavailable_title'))) throw new Error(`${lang} ${p}: no unavailable text`);
        if (txt.includes('Owner only')) throw new Error(`${lang} ${p}: title leaked`);
        if (await s.page.locator('textarea, input[type="text"]').count()) throw new Error(`${lang} ${p}: composer shown`);
        if (txt.includes(tx(lang, 'x_case_timeline_add_event'))) throw new Error(`${lang} ${p}: Add event shown`);
        await shot(s.page, `D11-${lang}${p.replace(/\//g, '_')}`);
        out.push(`${lang}${p}`);
        await done(s, { allow: [`/messages/${c.body.id}`, `/cases/${c.body.id}/events`, `/cases/${c.body.id}/counsel`] });
      }
    }
    return `${out.length} pages: "not available", no composer, no title`;
  });

  if (allErrors.length) fail('page errors', allErrors.slice(0, 5).join(' | ')); else pass('page errors', 'none');
  if (allFailed.length) fail('failed requests', [...new Set(allFailed)].slice(0, 8).join(' | ')); else pass('failed requests', 'none');
  await browser.close(); server.close();
  const bad = results.filter(r => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
