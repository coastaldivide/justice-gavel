#!/usr/bin/env node
/**
 * web-journeys-core-safety.cjs — section A (core path & safety) journeys
 * against a REAL backend, beyond the happy path of web-journeys.cjs:
 * every Home link, the SOS / emergency share / crisis lines, the recorder and
 * voice note, arrest monitor, Quick Connect, offline, 4 languages, 390 px.
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4300/api npx expo export --platform web --output-dir dist
 *   node scripts/web-journeys-core-safety.cjs dist out --api http://localhost:4300/api \
 *        --db-url postgres://postgres:postgres@localhost:5432/jg_dbg [--port 8300]
 *
 * The backend runs in production mode with NO SMS / e-mail / Whisper / Stripe
 * keys (the owner's current setup), CORS allowing http://localhost:<port>.
 *
 *   A1  Home: every tile opens a real screen (none leaves you on Home); "Cases"
 *       opens the case list; the attorney tile is hidden for a consumer; the
 *       header (Help Now) fits at 390 px in es / pt / vi
 *   A2  Home court countdown counts calendar days and opens that hearing
 *   A3  SOS from Home: the server says nothing was sent (no SMS provider) → the
 *       app says so and opens the messages app for ALL contacts with the alert
 *   A4  Emergency screen: contacts added on the Contacts screen enable the
 *       alert on return; the name typed there is used; result is honest
 *   A5  Emergency share (es): the preview message is Spanish, Send opens the
 *       messages app for every phone contact
 *   A6  Crisis lines: Veterans → tel:988, Crisis Text Line → sms:741741 HOME
 *   A7  Just arrested (guest): "Missed a court date?" lands on the guidance;
 *       "Alert family" on the web copies the message (toast)
 *   A8  Encounter recorder (es, California): all-party-consent law shown and
 *       confirmed before recording; with transcription unavailable the
 *       recording is kept: retry + save (download .webm); guest → sign in
 *   A9  Voice note: transcription unavailable → type instead → structured →
 *       "Save to case" APPENDS to the case notes (existing notes kept)
 *   A10 Arrest monitor: a Legal Pro subscriber gets the list (add / remove);
 *       a free user sees the server's price in their language
 *   A11 Quick Connect: $20.00 everywhere, pay → "payments not available"
 *   A12 Offline (es): one translated banner; offline list opens court dates
 *   A13 Help Now (pt, vi) at 390 px: the city Search button is on screen
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
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-core-safety-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4300/api')).replace(/\/$/, '');
const PORT = Number(arg('--port', 8300));
const DB_URL = arg('--db-url', process.env.DATABASE_URL || null);
fs.mkdirSync(OUT, { recursive: true });

const I18N = path.join(ROOT, 'src', 'i18n');
const L = Object.fromEntries(['en', 'es', 'pt', 'vi'].map(l => [l, JSON.parse(fs.readFileSync(path.join(I18N, `${l}.json`), 'utf8'))]));
const LOCALES = { en: 'en-US', es: 'es-US', pt: 'pt-BR', vi: 'vi-VN' };
const fill = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m));
const tx = (lang, key, p) => fill(L[lang][key], p);

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
const freshIp = () => `10.66.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
async function apiCall(method, p, { token, body, lang } = {}) {
  const r = await fetch(API + p, { method, headers: {
    'Content-Type': 'application/json', 'X-Forwarded-For': freshIp(), ...(lang ? { 'Accept-Language': lang } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}
/** A signed-in account with Terms + AI disclaimer accepted (as the app's gate would). */
async function newUser(tag) {
  const email = `a-${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { body: { identifier: email, password: 'CorrectHorse9!', displayName: `Casey ${tag}` } });
  const token = reg.body && reg.body.token;
  if (!token) throw new Error(`register ${reg.status}`);
  await apiCall('POST', '/auth/accept-tos', { token, body: { checkbox_tos: true, checkbox_no_advice: true, scroll_completed: true, platform: 'web' } });
  await apiCall('POST', '/auth/disclaimer/accept', { token });
  return { token, user: reg.body.user, email };
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

/**
 * A browser context in `lang` at `viewport`, signed in as `account` (or a guest
 * who already browsed), with window.open / dialogs recorded and
 * clipboard access granted. `state` sets the saved US state.
 */
async function open(browser, { lang = 'en', viewport = { width: 390, height: 844 }, account = null, state = null, offline = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: LOCALES[lang], timezoneId: 'America/Chicago', serviceWorkers: 'block',
    acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write', 'microphone'], extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  const page = await ctx.newPage();
  lastPage = page;
  const errors = [];
  const dialogs = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
    // react-native-web opens tel: links with window.location — record those too
    if (window.navigation) window.navigation.addEventListener('navigate', (e) => {
      const u = e.destination.url;
      if (/^(tel|sms|mailto):/.test(u)) { window.__opened.push(u); e.preventDefault(); }
    });
  });
  await page.goto(base + '/age-check', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([acc, st]) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('age_verified', '1');
    localStorage.setItem('has_browsed', 'true');
    if (st) localStorage.setItem('jg_user_state', st);
    if (acc) { sessionStorage.setItem('jg_token', acc.token); sessionStorage.setItem('jg_user', JSON.stringify(acc.user)); }
  }, [account, state]);
  if (offline) await ctx.setOffline(true);
  return { ctx, page, errors, dialogs, opened: () => page.evaluate(() => window.__opened.slice()) };
}
async function go(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); }

const ONLY = String(process.env.ONLY || '').split(',').filter(Boolean);   // e.g. ONLY=A9,A12
let lastPage = null;
async function journey(id, fn) {
  if (ONLY.length && !ONLY.includes(id.split(' ')[0])) return;
  try { const d = await fn(); pass(id, d || 'ok'); }
  catch (e) {
    fail(id, e.message);
    if (lastPage) await lastPage.screenshot({ path: path.join(OUT, `FAIL-${id.split(' ')[0]}.png`) }).catch(() => {});
  }
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
const dayPlus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const allErrors = [];

  // ── A1 Home links ────────────────────────────────────────────────────────
  await journey('A1 Home: every tile opens a real screen; Cases → case list; no attorney tile for a consumer', async () => {
    const acc = await newUser('a1');
    const s = await open(browser, { account: acc });
    await go(s.page, '/');
    const ids = await s.page.$$eval('[data-testid^="tile-"]', els => els.map(e => e.getAttribute('data-testid')));
    if (ids.includes('tile-AttyDash')) throw new Error('attorney dashboard tile shown to a consumer');
    const dead = [];
    for (const tid of ids) {
      await go(s.page, '/');
      await byTid(s.page, tid).first().click({ timeout: 8000 });
      await s.page.waitForTimeout(900);
      const url = s.page.url().replace(base, '');
      if (url === '/' || url === '/home') dead.push(tid);
      if (/Something went wrong/i.test(await bodyText(s.page))) dead.push(`${tid}(boundary)`);
      if (tid === 'tile-Cases' && url !== '/cases') dead.push(`tile-Cases→${url}`);
    }
    if (dead.length) throw new Error(`tiles that do not open a screen: ${dead.join(', ')}`);
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `${ids.length} tiles, each opens its screen; Cases → /cases; attorney tile hidden`;
  });

  await journey('A1b Home header fits at 390 px (es / pt / vi): Help Now and Settings on screen', async () => {
    const out = [];
    for (const lang of ['es', 'pt', 'vi']) {
      const s = await open(browser, { lang });
      await go(s.page, '/');
      const btn = await s.page.getByLabel(tx(lang, 'get_help_now')).first().boundingBox();
      const gear = await s.page.getByLabel(tx(lang, 'home_settings_a11y')).first().boundingBox();
      if (!btn || btn.x + btn.width > 390 || !gear || gear.x + gear.width > 391) throw new Error(`${lang}: header buttons off screen ${JSON.stringify({ btn, gear })}`);
      await shot(s.page, `A1b-home-${lang}`);
      out.push(`${lang} Help Now right edge ${Math.round(btn.x + btn.width)}px`);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    return out.join(', ');
  });

  // ── A2 court countdown ───────────────────────────────────────────────────
  await journey('A2 Home court countdown: calendar days, opens the hearing', async () => {
    const acc = await newUser('a2');
    const cd = await apiCall('POST', '/court-dates', { token: acc.token, body: { title: 'Countdown case', court_date: dayPlus(4), court_time: '09:00', hearing_type: 'arraignment' } });
    if (cd.status >= 300) throw new Error(`create court date ${cd.status} ${JSON.stringify(cd.body)}`);
    const id = cd.body.id || cd.body.court_date?.id;
    const s = await open(browser, { account: acc });
    await go(s.page, '/');
    const card = byTid(s.page, 'home-court-countdown');
    await card.waitFor({ timeout: 15000 });
    const label = await card.getAttribute('aria-label');
    const list = await apiCall('GET', '/court-dates', { token: acc.token });
    const today = list.body.today;
    const want = Math.round((Date.parse(`${dayPlus(4)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (!label || !label.includes(String(want))) throw new Error(`label "${label}" (want ${want} days from ${today})`);
    await card.click();
    await byTid(s.page, 'court-date-detail-screen').waitFor({ timeout: 15000 });
    if (!s.page.url().includes(`/court-dates/${id}`)) throw new Error(`opened ${s.page.url()}`);
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `"${label}" → /court-dates/${id}`;
  });

  // ── A3 SOS from Home ─────────────────────────────────────────────────────
  await journey('A3 SOS (Home): not sent by the server → said so, messages app opened for all 3 contacts', async () => {
    const acc = await newUser('a3');
    const s = await open(browser, { account: acc });
    await go(s.page, '/');
    await s.page.evaluate(() => localStorage.setItem('contacts', JSON.stringify(['6155550101', '(615) 555-0102', 'mom@example.test'])));
    await go(s.page, '/');
    const resp = s.page.waitForResponse(r => r.url().endsWith('/api/alerts') && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
    // force: the SOS button pulses forever, so it is never "stable" for Playwright
    await s.page.getByLabel(tx('en', 'x_floating_sosbutton_emergency_call_help')).first().click({ force: true });
    const r = await resp;
    if (!r) throw new Error(`no POST /alerts (dialogs: ${s.dialogs.join(' | ')})`);
    const j = await r.json();
    await s.page.waitForTimeout(1500);
    if (j.sent !== 0 || j.total !== 3) throw new Error(`server sent=${j.sent} total=${j.total}`);
    const said = s.dialogs.join(' | ');
    if (!said.includes(tx('en', 'sos_sent_none', { n: 3 }))) throw new Error(`dialogs: ${said}`);
    const opened = await s.opened();
    const sms = opened.find(u => u.startsWith('sms:'));
    if (!sms || !sms.startsWith('sms:6155550101,6155550102?body=') || !decodeURIComponent(sms).includes('EMERGENCY')) throw new Error(`opened ${JSON.stringify(opened)}`);
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `server: 0/3 sent (no SMS/e-mail provider) → "${tx('en', 'sos_sent_none', { n: 3 })}" → ${sms.slice(0, 40)}…`;
  });

  // ── A4 Emergency screen ──────────────────────────────────────────────────
  await journey('A4 Emergency: contacts + name saved on Contacts enable the alert on return; honest result', async () => {
    const s = await open(browser, {});
    await go(s.page, '/emergency');
    const sendLabel = tx('en', 'x_emergency_send_emergency_alert_contacts');
    if ((await s.page.getByLabel(sendLabel).first().getAttribute('aria-disabled')) !== 'true') throw new Error('alert enabled with no contacts');
    await s.page.getByLabel(tx('en', 'x_emergency_manage_emergency_contacts')).first().click();
    await byTid(s.page, 'contacts-screen').waitFor({ timeout: 10000 });
    await s.page.getByPlaceholder(tx('en', 'x_contacts_e_g_jamie_smith')).fill('Jordan Guest');
    await s.page.getByPlaceholder(tx('en', 'x_contacts_contact_phone_email', { value: 1 })).fill('6155550199');
    await s.page.getByLabel(tx('en', 'x_contacts_save_contacts')).first().click();
    await s.page.waitForTimeout(600);
    await s.page.goBack();
    await s.page.waitForTimeout(1200);
    const btn = s.page.getByLabel(sendLabel).first();
    if ((await btn.getAttribute('aria-disabled')) === 'true') throw new Error('alert still disabled after adding a contact');
    if (await s.page.evaluate(() => localStorage.getItem('userName')) !== 'Jordan Guest') throw new Error('typed name not saved');
    await shot(s.page, 'A4-emergency-ready');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'disabled → contact + name saved → enabled on return';
  });

  // ── A5 Emergency share in Spanish ────────────────────────────────────────
  await journey('A5 Emergency share (es): Spanish message, messages app for every phone contact', async () => {
    const s = await open(browser, { lang: 'es' });
    await go(s.page, '/');
    await s.page.evaluate(() => localStorage.setItem('contacts', JSON.stringify(['6155550101', '6155550102', 'x@y.test'])));
    await go(s.page, '/emergency-share');
    await byTid(s.page, 'arrest-who').fill('Luis Pérez');
    await byTid(s.page, 'arrest-where').fill('Cárcel del condado');
    await byTid(s.page, 'arrest-charges').fill('DUI');
    await byTid(s.page, 'emergency-share-go').click();
    const preview = await byTid(s.page, 'emergency-share-preview').innerText({ timeout: 20000 });
    for (const k of ['es_msg_arrested', 'es_msg_held_at', 'es_msg_charges']) {
      const label = tx('es', k, { value: '' }).trim();
      if (!preview.includes(label)) throw new Error(`preview lacks "${label}": ${preview}`);
    }
    if (/Arrested:|Held at:|Charges:|Sent via/.test(preview)) throw new Error(`English in the message: ${preview}`);
    await byTid(s.page, 'emergency-share-send').click();
    await s.page.waitForTimeout(1200);
    const sms = (await s.opened()).find(u => u.startsWith('sms:'));
    if (!sms || !sms.startsWith('sms:6155550101,6155550102?body=')) throw new Error(`opened ${sms}`);
    const txt = await bodyText(s.page);
    if (!txt.includes(tx('es', 'es_done_sms', { n: 2 }))) throw new Error('done text missing');
    await shot(s.page, 'A5-share-done-es');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `message in Spanish; ${sms.slice(0, 36)}…; "${tx('es', 'es_done_sms', { n: 2 }).slice(0, 40)}…"`;
  });

  // ── A6 Crisis lines ──────────────────────────────────────────────────────
  await journey('A6 Crisis: Veterans → tel:988; Crisis Text Line → sms:741741 HOME; names translated', async () => {
    const s = await open(browser, { lang: 'es' });
    await go(s.page, '/crisis');
    await byTid(s.page, 'crisis-line-veterans').click();
    await byTid(s.page, 'crisis-line-text').click();
    await s.page.waitForTimeout(500);
    const opened = await s.opened();
    if (!opened.includes('tel:988')) throw new Error(`veterans opened ${opened}`);
    if (!opened.includes('sms:741741?body=HOME')) throw new Error(`text line opened ${opened}`);
    const txt = await bodyText(s.page);
    for (const k of ['crisis_line_veterans', 'crisis_text_home', 'crisis_line_trafficking']) if (!txt.includes(tx('es', k))) throw new Error(`${k} not shown in Spanish`);
    if (/Human Trafficking|Social Services|then 1/.test(txt)) throw new Error('English line names');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `opened ${opened.join(', ')}`;
  });

  // ── A7 Just arrested (guest) ─────────────────────────────────────────────
  await journey('A7 Just arrested (guest): missed-court guidance opens; Alert family copies on the web', async () => {
    const s = await open(browser, {});
    await go(s.page, '/just-arrested');
    await byTid(s.page, 'core-step-3').click();
    await byTid(s.page, 'core-missed').click();
    await byTid(s.page, 'missed-guidance').waitFor({ timeout: 15000 });
    await go(s.page, '/just-arrested');
    await s.page.getByLabel(tx('en', 'ja_alert_family_a11y')).first().click();
    await s.page.getByText(tx('en', 'es_copied')).first().waitFor({ timeout: 8000 });
    const clip = await s.page.evaluate(() => navigator.clipboard.readText());
    if (!clip.includes('justicegavel.app/just-arrested')) throw new Error(`clipboard "${clip}"`);
    if ((await s.opened()).some(u => u.startsWith('whatsapp:'))) throw new Error('tried to open the WhatsApp app scheme in a browser');
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'guidance shown; family message copied with the link';
  });

  // ── A8 Encounter recorder ────────────────────────────────────────────────
  await journey('A8 Recorder (es, CA): all-party law + confirm; transcription unavailable → recording kept, retry + save', async () => {
    const acc = await newUser('a8');
    const s = await open(browser, { lang: 'es', account: acc, state: 'CA' });
    await go(s.page, '/encounter-recorder');
    const law = await byTid(s.page, 'recorder-law').innerText({ timeout: 15000 });
    if (!law.includes(tx('es', 'x_interrogation_recorder_all_party_consent_state')) || !law.includes('California exige')) throw new Error(`law box: ${law}`);
    await byTid(s.page, 'recorder-officer').fill('Ofc. Ruiz #4411');
    await byTid(s.page, 'recorder-toggle').click();
    await byTid(s.page, 'recorder-timer').waitFor({ timeout: 10000 });
    if (!s.dialogs.some(d => d.includes(tx('es', 'x_interrogation_recorder_two_party_consent_warning')))) throw new Error('no consent warning before recording');
    await s.page.waitForTimeout(2200);
    const up = s.page.waitForResponse(r => r.url().includes('/interrogation/transcribe'), { timeout: 20000 }).catch(() => null);
    await byTid(s.page, 'recorder-toggle').click();
    const r = await up;
    if (!r) throw new Error('no upload after stop');
    await byTid(s.page, 'recorder-error').waitFor({ timeout: 15000 });
    if (r.status() !== 503) throw new Error(`transcribe ${r.status()}`);
    if (!(await bodyText(s.page)).includes(tx('es', 'ir_transcription_unavailable'))) throw new Error('unavailable message missing');
    const [dl] = await Promise.all([s.page.waitForEvent('download', { timeout: 10000 }), byTid(s.page, 'recorder-save-audio').click()]);
    const file = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(file);
    const size = fs.statSync(file).size;
    if (!/\.webm$/.test(file) || size < 500) throw new Error(`download ${file} ${size} bytes`);
    const retry = s.page.waitForResponse(rr => rr.url().includes('/interrogation/transcribe'), { timeout: 20000 }).catch(() => null);
    await byTid(s.page, 'recorder-retry').click();
    if (!(await retry)) throw new Error('retry did not upload the kept recording');
    await shot(s.page, 'A8-recorder-es');
    allErrors.push(...s.errors);
    await s.ctx.close();
    // guest: sign-in prompt, recording still kept
    const g = await open(browser, { state: 'TN' });
    await go(g.page, '/encounter-recorder');
    await byTid(g.page, 'recorder-toggle').click();
    await g.page.waitForTimeout(1500);
    await byTid(g.page, 'recorder-toggle').click();
    await byTid(g.page, 'recorder-sign-in').waitFor({ timeout: 20000 });
    await byTid(g.page, 'recorder-save-audio').waitFor({ timeout: 5000 });
    if (g.dialogs.length) throw new Error(`one-party state asked: ${g.dialogs}`);
    allErrors.push(...g.errors);
    await g.ctx.close();
    return `CA law in Spanish, warning confirmed; 503 → kept: ${path.basename(file)} (${size} B), retry re-uploads; guest → sign in + save`;
  });

  // ── A9 Voice note ────────────────────────────────────────────────────────
  await journey('A9 Voice note: no transcription → type → structured → appended to the case notes', async () => {
    const acc = await newUser('a9');
    // A closed case's card has "Voice note", which opens the screen WITHOUT the
    // current notes — the path that used to overwrite them.
    const c = await apiCall('POST', '/cases', { token: acc.token, body: { title: 'Notes case', notes: 'EXISTING NOTE — keep me', status: 'Closed' } });
    if (c.status >= 300) throw new Error(`create case ${c.status}`);
    const s = await open(browser, { account: acc });
    await go(s.page, '/cases');
    await s.page.getByText('Notes case').first().waitFor({ timeout: 15000 });
    await s.page.getByLabel(tx('en', 'x_cs_record_voice_note_this')).first().click({ timeout: 10000 });
    await byTid(s.page, 'voice-note-toggle').waitFor({ timeout: 10000 });
    await byTid(s.page, 'voice-note-toggle').click();
    await s.page.waitForTimeout(1500);
    const tr = s.page.waitForResponse(r => r.url().includes('/transcribe/note'), { timeout: 20000 }).catch(() => null);
    await byTid(s.page, 'voice-note-toggle').click();
    const trr = await tr;
    if (!trr || trr.status() !== 503) throw new Error(`expected transcription unavailable, got ${trr && trr.status()}`);
    await byTid(s.page, 'voice-note-text').fill('I need to call my lawyer tomorrow. Court date is next Tuesday.');
    await byTid(s.page, 'voice-note-structure').click();
    await byTid(s.page, 'voice-note-result').waitFor({ timeout: 15000 });
    await byTid(s.page, 'voice-note-save').click();
    await s.page.getByText(tx('en', 'vn_saved_to_case')).first().waitFor({ timeout: 10000 });
    const list = await apiCall('GET', '/cases', { token: acc.token });
    const notes = (Array.isArray(list.body) ? list.body : list.body.cases).find(x => x.id === c.body.id).notes;
    if (!notes.startsWith('EXISTING NOTE — keep me') || !notes.includes('call my lawyer')) throw new Error(`notes: ${notes}`);
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'existing note kept, new note appended';
  });

  // ── A10 Arrest monitor ───────────────────────────────────────────────────
  await journey('A10 Arrest monitor: Legal Pro subscriber → list, add, remove; free user → server price (es)', async () => {
    const pro = await newUser('a10');
    await sql("INSERT INTO subscriptions (user_id, status, tier) VALUES ($1, 'active', 'legal_pro')", [pro.user.id]);
    const s = await open(browser, { account: pro });
    await go(s.page, '/arrest-monitor');
    await byTid(s.page, 'arrest-monitor-list').waitFor({ timeout: 15000 });
    await s.page.getByLabel(tx('en', 'x_arrest_monitor_add_name_monitor')).first().click();
    await s.page.getByPlaceholder(tx('en', 'x_arrest_monitor_full_name_e_g')).fill('Jordan Sample');
    await s.page.getByText(tx('en', 'x_arrest_monitor_start_monitoring')).first().click();
    await s.page.getByText('Jordan Sample').first().waitFor({ timeout: 10000 });
    const m = await apiCall('GET', '/arrests/monitors', { token: pro.token });
    if (m.body.count !== 1) throw new Error(`monitors ${m.body.count}`);
    await s.page.getByText('✕').first().click();
    await s.page.waitForTimeout(1200);
    const m2 = await apiCall('GET', '/arrests/monitors', { token: pro.token });
    if (m2.body.count !== 0) throw new Error(`after remove ${m2.body.count}`);
    allErrors.push(...s.errors);
    await s.ctx.close();
    const free = await newUser('a10f');
    const f = await open(browser, { lang: 'es', account: free });
    await go(f.page, '/arrest-monitor');
    const btn = await byTid(f.page, 'arrest-monitor-upgrade').innerText({ timeout: 15000 });
    if (!btn.includes('34,99') && !btn.includes('34.99')) throw new Error(`upgrade button "${btn}"`);
    if (!btn.includes('/mes')) throw new Error(`price not in Spanish: "${btn}"`);
    allErrors.push(...f.errors);
    await f.ctx.close();
    return `subscriber: add + remove (API agrees); free (es): "${btn}"`;
  });

  // ── A11 Quick Connect ────────────────────────────────────────────────────
  await journey('A11 Quick Connect: $20.00 total; pay → "payments not available", no charge', async () => {
    const acc = await newUser('a11');
    const s = await open(browser, { account: acc, state: 'TN' });
    await go(s.page, '/quick-connect');
    const total = await byTid(s.page, 'qc-total').innerText({ timeout: 15000 });
    if (total.trim() !== '$20.00') throw new Error(`total "${total}"`);
    const btn = byTid(s.page, 'pay-button');
    await s.page.waitForFunction(() => document.querySelector('[data-testid="pay-button"]')?.getAttribute('aria-disabled') !== 'true', null, { timeout: 15000 });
    if (!(await btn.innerText()).includes('$20.00')) throw new Error(`pay button "${await btn.innerText()}"`);
    await btn.click();
    await s.page.getByText(tx('en', 'x_common_payments_aren_t_available')).first().waitFor({ timeout: 15000 });
    allErrors.push(...s.errors);
    await s.ctx.close();
    return `total ${total}; pay → payments unavailable`;
  });

  // ── A12 Offline ──────────────────────────────────────────────────────────
  await journey('A12 Offline (es): one translated banner; the offline list opens court dates', async () => {
    const acc = await newUser('a12');
    await apiCall('POST', '/court-dates', { token: acc.token, lang: 'es', body: { case_title: 'Caso sin red', court_date: dayPlus(9), court_time: '10:00' } });
    const s = await open(browser, { lang: 'es', account: acc });
    await go(s.page, '/court-dates');
    await byTid(s.page, 'court-date-row').first().waitFor({ timeout: 15000 });
    await go(s.page, '/');
    await s.ctx.setOffline(true);
    await s.page.waitForTimeout(2500);
    const txt = await bodyText(s.page);
    const n = txt.split(tx('es', 'no_internet')).length - 1;
    if (n !== 1) throw new Error(`${n} "${tx('es', 'no_internet')}" banners`);
    if (/No internet connection|See what works/.test(txt)) throw new Error('English offline banner');
    await byTid(s.page, 'offline-banner').click();
    await byTid(s.page, 'offline-open-CourtDates').click({ timeout: 10000 });
    await byTid(s.page, 'court-dates-offline').waitFor({ timeout: 15000 });
    if (!(await bodyText(s.page)).includes('Caso sin red')) throw new Error('saved court date not shown offline');
    await shot(s.page, 'A12-offline-court-dates-es');
    await s.ctx.setOffline(false);
    allErrors.push(...s.errors);
    await s.ctx.close();
    return 'one Spanish banner → offline list → saved court date';
  });

  // ── A13 Help Now layout ──────────────────────────────────────────────────
  await journey('A13 Help Now (pt, vi) at 390 px: city Search button fully on screen', async () => {
    const out = [];
    for (const lang of ['pt', 'vi']) {
      const s = await open(browser, { lang });
      await go(s.page, '/help');
      const b = await byTid(s.page, 'help-city-search').boundingBox();
      if (!b || b.x + b.width > 390) throw new Error(`${lang}: search button at ${b && Math.round(b.x + b.width)}px`);
      out.push(`${lang} ${Math.round(b.x + b.width)}px`);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    return out.join(', ');
  });

  if (allErrors.length) fail('A* no uncaught page errors', allErrors.slice(0, 5).join(' | ')); else pass('A* no uncaught page errors', 'all section A sessions');
  await browser.close();
  server.close();
  if (pool) await pool.end();
  fs.writeFileSync(path.join(OUT, 'web-journeys-core-safety-report.json'), JSON.stringify(results, null, 2));
  const bad = results.filter(r => !r.ok);
  console.log(`\nSECTION A JOURNEYS: ${results.length}  FAILED: ${bad.length}`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
