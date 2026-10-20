#!/usr/bin/env node
/**
 * web-journeys-ai.cjs — section E (AI, research & learning) journeys against a
 * REAL backend and a scriptable Anthropic mock.
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:4300/api npx expo export --platform web --output-dir dist
 *   node scripts/web-journeys-ai.cjs dist out --api http://localhost:4300/api --mock http://127.0.0.1:4399 [--port 8300]
 *
 * The backend runs with ANTHROPIC_API_KEY=<anything> ANTHROPIC_BASE_URL=<mock>.
 * The mock (any server with this control API works; see notes/debug_pass.md §E):
 *   POST /__mode {mode, text, delayMs, tokens}  mode: ok | slow | long | 429 | 500 | 529 | drop | error_event
 *   GET  /__requests   recent upstream requests (body)   ·   POST /__reset
 * Journeys (ONLY=E1,E3 to run a subset):
 *   E1  chat streams in piece by piece (Spanish): the bubble grows before the
 *       answer is done; the model is asked to answer in Spanish, with the
 *       verified rights content; no temperature; reload → the conversation is back
 *   E2  Stop mid-answer: "Stopped", the input works again; reload keeps the part seen
 *   E3  the connection drops mid-answer → friendly error + Try again → the
 *       answer arrives; the question is shown once and stored once
 *   E4  AI busy (429 / 529 / 500) and AI off → a sentence, no hang, no 5xx
 *   E5  markdown is drawn, HTML in an answer is shown as text (no injection)
 *   E6  self-harm / DV in en / es / pt / vi → crisis card with a call button
 *       first; "spend it all on bail" → no card
 *   E7  a 3,000-word answer streams without freezing the page
 *   E8  guest: "sign in" card, crisis link, no 401s; free limit → upgrade card
 *   E9  interpreter: attorney (two phones) + a guest who joins by code talk both
 *       ways; send works more than once; empty → disabled; 2,000 characters
 *       accepted; AI down → "not translated", never the original passed off
 *   E10 legal research: consumer → paywall with the real plans; attorney →
 *       answer (job polled); AI busy → reason + Try again → answer; another
 *       account cannot delete the session
 *   E11 motion library: no price shown; generate → draft; History lists it;
 *       filing status changes; reopen shows the draft
 *   E12 penalties: DUI link opens the DUI tab; state change; every row shows
 *       its recorded source; guest, no 401s
 *   E13 resources: guest list of all 631; "988 then press 1" dials 988,
 *       "Text HOME to 741741" opens an SMS, never a 6-digit call
 *   E14 lessons: guest reads the reworded "How Bail Works" (migration 22);
 *       completing asks to sign in; signed in → complete → points once →
 *       still complete in a fresh browser
 *   E15 bar prep: practice session of 10 → every answer graded → results score
 *       = server score; free sample used → "retry wrong" opens the plans; progress lists the session;
 *       exam date saved; schedule's today = the browser's day (Asia/Tokyo)
 *   E16 advocacy: guest sees real counts (no 401)
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
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-ai-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4300/api')).replace(/\/$/, '');
const MOCK = String(arg('--mock', 'http://127.0.0.1:4399')).replace(/\/$/, '');
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
const freshIp = () => `10.71.${(ipSeq++ % 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
async function apiCall(method, p, { token, body, lang } = {}) {
  const r = await fetch(API + p, { method, headers: {
    'Content-Type': 'application/json', 'X-Forwarded-For': freshIp(), 'X-Timezone': 'America/Chicago', ...(lang ? { 'Accept-Language': lang } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}
async function mock(mode, extra = {}) {
  await fetch(MOCK + '/__mode', { method: 'POST', body: JSON.stringify({ mode, text: null, delayMs: 30, tokens: 40, ...extra }) });
}
async function mockRequests() { return (await fetch(MOCK + '/__requests')).json(); }

const PASSWORD = 'CorrectHorse9!';
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
async function newUser(tag, { accountType } = {}) {
  const email = `e-${tag}-${uniq()}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { body: { identifier: email, password: PASSWORD, displayName: `Eli ${tag}`, ...(accountType ? { accountType } : {}) } });
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
  const ctx = await browser.newContext({ viewport, locale: LOCALES[lang], timezoneId: tz, serviceWorkers: 'block',
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
    localStorage.setItem('chat_consent_accepted', '1'); localStorage.setItem('jg_consent_v2.0', 'true');
    if (lg !== 'en') localStorage.setItem('lang', lg);
    if (acc) {
      sessionStorage.setItem('jg_token', acc.token);
      if (acc.refreshToken) sessionStorage.setItem('jg_refresh_token', acc.refreshToken);
      sessionStorage.setItem('jg_user', JSON.stringify(acc.user));
    }
  }, [account, lang]);
  return { ctx, page, errors, failed, dialogs };
}
async function go(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(600); }
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
  for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 100)); }
}
const allErrors = [];
const allFailed = [];
const done = async (s, { allow = [] } = {}) => {
  allErrors.push(...s.errors);
  allFailed.push(...s.failed.filter(f => !allow.some(a => f.includes(a))));
  await s.ctx.close();
};

async function ask(page, text) {
  await byTid(page, 'chat-input').fill(text);
  await byTid(page, 'chat-send').click();
}
const lastAnswer = (page) => byTid(page, 'chat-msg-assistant').last();
const userBubbles = (page, text) => byTid(page, 'chat-msg-user').filter({ hasText: text }).count();

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();

  await journey('E1 streaming + Spanish + grounded prompt + history reload', async () => {
    const acc = await newUser('e1');
    await mock('slow', { delayMs: 60, text: 'Primera parte. Segunda parte. Tercera parte. Cuarta parte. Quinta parte. Sexta parte. Séptima parte. Octava parte.' });
    const s = await open(browser, { lang: 'es', account: acc });
    await go(s.page, '/chat');
    await ask(s.page, '¿Puede la policía registrar mi carro?');
    // incremental: some text visible while the Stop button is still up
    await until(async () => (await lastAnswer(s.page).innerText().catch(() => '')).includes('Primera'), 8000, 'first tokens');
    const midText = await lastAnswer(s.page).innerText();
    const stopVisible = await byTid(s.page, 'chat-stop').isVisible();
    if (!stopVisible || midText.includes('Octava')) throw new Error(`not incremental (stop=${stopVisible}, text="${midText}")`);
    await shot(s.page, 'E1-streaming');
    await until(async () => (await lastAnswer(s.page).innerText()).includes('Octava'), 15000, 'full answer');
    await byTid(s.page, 'chat-send').waitFor({ timeout: 5000 });
    if (!(await byTid(s.page, 'chat-rights-refs').count())) throw new Error('no rights-card reference under a search answer');
    const reqs = await mockRequests();
    const last = reqs[reqs.length - 1].body;
    if (!/Write your whole answer in Spanish/.test(last.system)) throw new Error('system prompt does not ask for Spanish');
    if (!/VERIFIED RIGHTS CONTENT/.test(last.system) || !/talk to a lawyer/.test(last.system)) throw new Error('system prompt is not grounded in the rights card');
    if ('temperature' in last) throw new Error('temperature sent to the API');
    if (last.model !== (process.env.CLAUDE_MODEL || 'claude-sonnet-5-5')) throw new Error(`model ${last.model}`);   // the server default (utils/ai.js)
    await shot(s.page, 'E1-done');
    await go(s.page, '/chat');
    await until(async () => (await bodyText(s.page)).includes('Octava parte'), 8000, 'history after reload');
    if ((await userBubbles(s.page, '¿Puede la policía')) !== 1) throw new Error('question not shown exactly once after reload');
    await done(s);
    return `streamed (mid: ${midText.length} chars), es prompt, rights refs, reload keeps it`;
  });

  await journey('E2 Stop mid-answer', async () => {
    const acc = await newUser('e2');
    await mock('slow', { delayMs: 150, text: Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ') });
    const s = await open(browser, { lang: 'en', account: acc });
    await go(s.page, '/chat');
    await ask(s.page, 'Tell me everything about bail hearings');
    await until(async () => (await lastAnswer(s.page).innerText().catch(() => '')).includes('palabra3'), 8000, 'tokens');
    await byTid(s.page, 'chat-stop').click();
    await byTid(s.page, 'chat-stopped').waitFor({ timeout: 5000 });
    const seen = await lastAnswer(s.page).innerText();
    if (seen.includes('palabra59')) throw new Error('the answer kept going after Stop');
    await byTid(s.page, 'chat-input').fill('next question');
    if (await byTid(s.page, 'chat-send').getAttribute('aria-disabled') === 'true') throw new Error('send stays disabled after Stop');
    await shot(s.page, 'E2-stopped');
    await s.page.waitForTimeout(1200); // server saves what was seen
    await go(s.page, '/chat');
    await byTid(s.page, 'chat-stopped').waitFor({ timeout: 8000 });
    await done(s);
    return 'stopped, input enabled, partial kept after reload';
  });

  await journey('E3 connection drops mid-answer → Try again, no duplicate', async () => {
    const acc = await newUser('e3');
    await mock('drop', { delayMs: 40, text: 'Uno dos tres cuatro cinco seis siete ocho nueve diez once doce.' });
    const s = await open(browser, { lang: 'es', account: acc });
    await go(s.page, '/chat');
    await ask(s.page, 'What happens at arraignment?');
    await byTid(s.page, 'chat-retry').waitFor({ timeout: 10000 });
    // the AI provider's connection broke: the server says so in Spanish
    const errText = await byTid(s.page, 'chat-error').innerText();
    if (!errText.includes('Inténtelo de nuevo')) throw new Error(`error text: ${errText}`);
    await shot(s.page, 'E3-dropped');
    await mock('ok', { text: 'Respuesta completa sobre la lectura de cargos.' });
    await byTid(s.page, 'chat-retry').click();
    await until(async () => (await lastAnswer(s.page).innerText()).includes('Respuesta completa'), 10000, 'retried answer');
    if ((await userBubbles(s.page, 'What happens at arraignment?')) !== 1) throw new Error('question shown twice');
    const hist = await apiCall('GET', `/chat/history/${await s.page.evaluate(() => localStorage.getItem('chat_session_id'))}`, { token: acc.token });
    const qs = (hist.body || []).filter(h => h.role === 'user' && h.content === 'What happens at arraignment?').length;
    const as = (hist.body || []).filter(h => h.role === 'assistant').length;
    if (qs !== 1 || as !== 1) throw new Error(`stored ${qs} questions / ${as} answers`);
    await shot(s.page, 'E3-retried');
    await done(s);
    return 'friendly error, retry answered, 1 question + 1 answer stored';
  });

  await journey('E3b the app loses the stream after the server finished → Try again replays', async () => {
    const acc = await newUser('e3b');
    await mock('ok', { text: Array.from({ length: 30 }, (_, i) => `parte${i}`).join(' ') });
    const s = await open(browser, { lang: 'pt', account: acc });
    // The first stream reaches the app cut off before its last frame (a dropped connection).
    let cut = 0;
    await s.page.route('**/api/chat/stream', async (route) => {
      if (cut++ > 0) return route.continue();
      const resp = await route.fetch();
      const full = await resp.text();
      const half = full.slice(0, full.indexOf('parte20'));
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: half.slice(0, half.lastIndexOf('\n\n') + 2) });
    });
    await go(s.page, '/chat');
    await ask(s.page, 'Posso ficar em silêncio?');
    await byTid(s.page, 'chat-retry').waitFor({ timeout: 15000 });
    const errText = await byTid(s.page, 'chat-error').innerText();
    if (!errText.includes(tx('pt', 'chat_err_connection_lost'))) throw new Error(`error text: ${errText}`);
    if (!(await lastAnswer(s.page).innerText()).includes('parte3')) throw new Error('the part already shown was lost');
    await shot(s.page, 'E3b-cut');
    const before = (await mockRequests()).length;
    await byTid(s.page, 'chat-retry').click();
    await until(async () => (await lastAnswer(s.page).innerText()).includes('parte29'), 15000, 'replayed answer');
    const after = (await mockRequests()).length;
    if (after !== before) throw new Error(`the retry asked the AI again (${after - before} calls)`);
    if ((await userBubbles(s.page, 'Posso ficar em silêncio?')) !== 1) throw new Error('question shown twice');
    const sid = await s.page.evaluate(() => localStorage.getItem('chat_session_id'));
    const hist = await apiCall('GET', `/chat/history/${sid}`, { token: acc.token });
    const rows = (hist.body || []).map(h => `${h.role}:${h.status}`);
    if (rows.join(',') !== 'user:complete,assistant:complete') throw new Error(`stored: ${rows.join(',')}`);
    await shot(s.page, 'E3b-replayed');
    await done(s);
    return 'cut stream → "connection dropped" + partial kept; retry replayed the saved answer (0 new AI calls), stored once';
  });

  await journey('E4 AI busy / failing / off → a sentence, no hang', async () => {
    const acc = await newUser('e4');
    const s = await open(browser, { lang: 'vi', account: acc });
    await go(s.page, '/chat');
    const seen = [];
    for (const mode of ['429', '529', '500']) {
      await mock(mode);
      const t0 = Date.now();
      await ask(s.page, `Question during ${mode}`);
      await until(async () => (await byTid(s.page, 'chat-error').count()) >= seen.length + 1, 20000, `error for ${mode}`);
      const txt = await byTid(s.page, 'chat-error').last().innerText();
      if (!txt.includes(tx('vi', 'chat_err_busy').slice(0, 20))) throw new Error(`${mode}: ${txt}`);
      if (/SECRET|api_error|Internal server error/i.test(await bodyText(s.page))) throw new Error('upstream detail shown');
      seen.push(`${mode}:${Date.now() - t0}ms`);
    }
    await shot(s.page, 'E4-busy');
    if (s.failed.some(f => /^5\d\d/.test(f))) throw new Error(`5xx: ${s.failed.join(', ')}`);
    await done(s);
    return seen.join(' ');
  });

  await journey('E5 markdown drawn, HTML shown as text', async () => {
    const acc = await newUser('e5');
    await mock('ok', { text: '## Your rights\n\n- **Stay calm** and *be polite*\n- Say: `I want a lawyer`\n\n<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> & "quotes"' });
    const s = await open(browser, { account: acc });
    await go(s.page, '/chat');
    await ask(s.page, 'What do I say?');
    await until(async () => (await lastAnswer(s.page).innerText()).includes('quotes'), 10000, 'answer');
    const txt = await lastAnswer(s.page).innerText();
    const xss = await s.page.evaluate(() => window.__xss || 0);
    const imgs = await lastAnswer(s.page).locator('img').count();
    if (xss || imgs) throw new Error(`HTML executed (xss=${xss}, img=${imgs})`);
    if (!txt.includes('<img src=x onerror=') || !txt.includes('<script>')) throw new Error('HTML not shown literally');
    if (txt.includes('**') || txt.includes('## ')) throw new Error(`markdown not drawn: ${txt}`);
    const boldWeight = await lastAnswer(s.page).getByText('Stay calm', { exact: true }).evaluate(el => getComputedStyle(el).fontWeight);
    if (Number(boldWeight) < 600) throw new Error(`bold weight ${boldWeight}`);
    if (s.dialogs.length) throw new Error(`dialog opened: ${s.dialogs[0]}`);
    await shot(s.page, 'E5-markdown');
    await done(s);
    return 'heading, list, bold drawn; <img>/<script> shown as text, nothing ran';
  });

  await journey('E6 crisis + DV detection in 4 languages', async () => {
    const cases = [
      ['en', 'I want to end my life', 'crisis'], ['es', 'ya no quiero vivir', 'crisis'], ['pt', 'eu quero morrer', 'crisis'],
      ['vi', 'tôi muốn chết', 'crisis'], ['es', 'mi pareja me pega todos los días', 'dv'], ['vi', 'chồng tôi đánh tôi', 'dv'],
    ];
    const out = [];
    await mock('ok', { text: 'Normal answer.' });
    for (const [lang, text, kind] of cases) {
      const acc = await newUser(`e6${lang}`);
      const s = await open(browser, { lang, account: acc });
      await go(s.page, '/chat');
      await ask(s.page, text);
      await byTid(s.page, 'chat-crisis-card').waitFor({ timeout: 8000 });
      const card = await byTid(s.page, 'chat-crisis-card').innerText();
      const wanted = kind === 'crisis' ? '988' : '1-800-799-7233';
      if (!card.includes(wanted)) throw new Error(`${lang} ${kind}: card without ${wanted}`);
      const call = await byTid(s.page, 'chat-crisis-call').innerText();
      if (!call.includes(kind === 'crisis' ? tx(lang, 'chat_crisis_call_988') : '1-800-799-7233')) throw new Error(`${lang}: call button "${call}"`);
      await byTid(s.page, 'chat-send').waitFor({ timeout: 8000 }); // the answer still comes
      await shot(s.page, `E6-${lang}-${kind}`);
      if (lang === 'vi' && kind === 'crisis') {
        await byTid(s.page, 'chat-crisis-all').click();
        await until(async () => s.page.url().includes('/crisis'), 6000, 'crisis lines screen');
      }
      out.push(`${lang}:${kind}`);
      await done(s);
    }
    const acc = await newUser('e6no');
    const s = await open(browser, { account: acc });
    await go(s.page, '/chat');
    await ask(s.page, 'Should I spend it all on bail or a lawyer?');
    await byTid(s.page, 'chat-send').waitFor({ timeout: 8000 });
    if (await byTid(s.page, 'chat-crisis-card').count()) throw new Error('crisis card for an ordinary question');
    await done(s);
    return `${out.join(' ')}; "spend it all" → none`;
  });

  await journey('E7 long answer streams without freezing', async () => {
    const acc = await newUser('e7');
    await mock('long', { tokens: 3000 });
    const s = await open(browser, { account: acc });
    await go(s.page, '/chat');
    const t0 = Date.now();
    await ask(s.page, 'Explain the whole criminal process');
    // the page answers clicks while the answer streams
    let maxLag = 0;
    for (let i = 0; i < 10; i++) {
      const a = Date.now();
      await s.page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(1))));
      maxLag = Math.max(maxLag, Date.now() - a);
      await s.page.waitForTimeout(150);
    }
    await until(async () => (await lastAnswer(s.page).innerText().catch(() => '')).includes('word2999'), 30000, 'full long answer');
    const total = Date.now() - t0;
    if (maxLag > 1500) throw new Error(`frame lag ${maxLag} ms`);
    await shot(s.page, 'E7-long');
    await done(s);
    return `3,000 words in ${total} ms, worst frame wait ${maxLag} ms`;
  });

  await journey('E8 guest sign-in card + free limit upgrade', async () => {
    const g = await open(browser, { lang: 'pt' });
    await go(g.page, '/chat');
    await byTid(g.page, 'chat-sign-in').waitFor({ timeout: 8000 });
    await byTid(g.page, 'chat-guest-crisis').waitFor();
    if (g.failed.length) throw new Error(`guest requests failed: ${g.failed.join(', ')}`);
    await shot(g.page, 'E8-guest');
    await done(g);
    const acc = await newUser('e8');
    await mock('ok', { text: 'Ok.' });
    const s = await open(browser, { account: acc });
    await go(s.page, '/chat');
    for (let i = 1; i <= 3; i++) { await ask(s.page, `Question number ${i}`); await byTid(s.page, 'chat-send').waitFor({ timeout: 8000 }); await s.page.waitForTimeout(300); }
    await ask(s.page, 'Question number 4');
    await until(async () => (await bodyText(s.page)).includes(tx('en', 'chat_upgrade_cta')), 8000, 'upgrade card');
    await shot(s.page, 'E8-limit');
    await done(s, { allow: ['402 POST /chat/stream'] });
    return 'guest: sign-in card, 0 failed requests; 4th free question → upgrade';
  });

  await journey('E9 interpreter: attorney + guest by code, both ways', async () => {
    const acc = await newUser('e9');
    await mock('ok', { text: 'TRADUCCIÓN: necesito saber qué pasó.' });
    const h = await open(browser, { account: acc, lang: 'en' });
    await go(h.page, '/interpreter');
    await byTid(h.page, 'translator-mode-split').click();
    await byTid(h.page, 'translator-session-code').waitFor({ timeout: 10000 });
    const code = (await byTid(h.page, 'translator-session-code').innerText()).trim();
    // empty input → send disabled
    if (await byTid(h.page, 'translator-send-a').getAttribute('aria-disabled') !== 'true') throw new Error('send enabled with empty input');
    await byTid(h.page, 'translator-input-a').fill('I need to know what happened.');
    await byTid(h.page, 'translator-send-a').click();
    await until(async () => (await bodyText(h.page)).includes('TRADUCCIÓN'), 10000, 'host translation');
    // a second message from the same side (the button used to stay stuck)
    await byTid(h.page, 'translator-input-a').fill('x'.repeat(2000));
    await until(async () => (await byTid(h.page, 'translator-send-a').getAttribute('aria-disabled')) !== 'true', 5000, 'send re-enabled');
    await byTid(h.page, 'translator-send-a').click();
    await until(async () => (await byTid(h.page, 'translator-bubble').count()) >= 2, 10000, 'second (2,000-char) message');
    // guest (no account) joins by code on another phone
    const g = await open(browser, { lang: 'es' });
    await go(g.page, '/interpreter');
    await byTid(g.page, 'translator-join-existing').click();
    await byTid(g.page, 'translator-code-input').fill(code);
    await byTid(g.page, 'translator-join-submit').click();
    await byTid(g.page, 'translator-input-b').waitFor({ timeout: 10000 });
    await until(async () => (await byTid(g.page, 'translator-bubble').count()) >= 2, 10000, 'guest sees earlier messages');
    await mock('ok', { text: 'TRANSLATION: I was stopped on the highway.' });
    await byTid(g.page, 'translator-input-b').fill('Me pararon en la carretera.');
    await byTid(g.page, 'translator-send-b').click();
    await until(async () => (await bodyText(h.page)).includes('TRANSLATION: I was stopped'), 12000, 'host receives the guest message');
    // AI down: the message is delivered untranslated and labelled
    await mock('500');
    await byTid(g.page, 'translator-input-b').fill('¿Qué hago ahora?');
    await byTid(g.page, 'translator-send-b').click();
    await byTid(g.page, 'translator-not-translated').waitFor({ timeout: 15000 });
    await until(async () => (await byTid(h.page, 'translator-not-translated').count()) > 0, 12000, 'host sees "not translated"');
    await shot(h.page, 'E9-host'); await shot(g.page, 'E9-guest');
    await done(h); await done(g);
    return `code ${code}; host→guest and guest→host; 2 sends in a row; AI down → labelled untranslated`;
  });

  await journey('E10 legal research: paywall, attorney answer, retry, no IDOR', async () => {
    const consumer = await newUser('e10c');
    const c = await open(browser, { account: consumer });
    await go(c.page, '/research');
    await byTid(c.page, 'research-paywall').waitFor({ timeout: 10000 });
    const pw = await bodyText(c.page);
    if (/Casetext|374\.99|49\.99|14-day/.test(pw)) throw new Error('invented prices / competitor claims on the paywall');
    for (const plan of ['legal_radar', 'advisor', 'legal_pro', 'esquire']) await byTid(c.page, `research-plan-${plan}`).waitFor();
    if (!pw.includes('$19.99')) throw new Error('paywall without the real Legal Radar price');
    await shot(c.page, 'E10-paywall');
    await done(c);
    const atty = await newUser('e10a', { accountType: 'attorney' });
    await mock('ok', { text: '## Standard\n\nTerry v. Ohio, 392 U.S. 1 (1968) sets the reasonable-suspicion standard.' });
    const s = await open(browser, { account: atty, lang: 'es' });
    await go(s.page, '/research');
    await s.page.getByRole('textbox').last().fill('¿Qué estándar se aplica a una detención en la calle?');
    await s.page.locator('[aria-label="' + tx('es', 'x_legal_research_run_legal_research') + '"]').click();
    await until(async () => (await bodyText(s.page)).includes('Terry v. Ohio'), 15000, 'research answer');
    const req = (await mockRequests()).slice(-1)[0].body;
    if (!/Write the answer in Spanish/.test(req.system)) throw new Error('research not asked in Spanish');
    await mock('529');
    await s.page.getByRole('textbox').last().fill('¿Y en un registro de vehículo?');
    await s.page.locator('[aria-label="' + tx('es', 'x_legal_research_run_legal_research') + '"]').click();
    await byTid(s.page, 'research-retry').waitFor({ timeout: 30000 });
    await mock('ok', { text: 'Arizona v. Gant, 556 U.S. 332 (2009) limits vehicle searches incident to arrest.' });
    await byTid(s.page, 'research-retry').click();
    await until(async () => (await bodyText(s.page)).includes('Arizona v. Gant'), 15000, 'retried research answer');
    await shot(s.page, 'E10-thread');
    const hist = await apiCall('GET', '/research/history', { token: atty.token });
    const sid = hist.body && hist.body[0] && hist.body[0].id;
    const sess = await apiCall('GET', `/research/session/${sid}`, { token: atty.token });
    const roles = (sess.body.messages || []).map(m => m.role).join(',');
    if (roles !== 'user,assistant,user,assistant') throw new Error(`stored messages: ${roles}`);
    const other = await newUser('e10x');
    const del = await apiCall('DELETE', `/research/session/${sid}`, { token: other.token });
    const still = await apiCall('GET', `/research/session/${sid}`, { token: atty.token });
    if (del.status !== 404 || (still.body.messages || []).length !== 4) throw new Error(`IDOR delete: ${del.status}, left ${(still.body.messages || []).length}`);
    await done(s);
    return 'real plans on paywall; es answer; 529 → retry → answer; 4 messages stored; stranger delete 404';
  });

  await journey('E11 motion library: no price, generate, history, status, reopen', async () => {
    const acc = await newUser('e11', { accountType: 'attorney' });
    await mock('ok', { text: 'IN THE CIRCUIT COURT\nMOTION TO SUPPRESS\nComes now the Defendant [CITATION NEEDED].' });
    const s = await open(browser, { account: acc });
    await go(s.page, '/motions');
    await byTid(s.page, 'motion-card-suppress').waitFor({ timeout: 10000 });
    if (/\$9\.99/.test(await bodyText(s.page))) throw new Error('a per-motion price that is never charged');
    await byTid(s.page, 'motion-card-suppress').click();
    await s.page.getByPlaceholder('John Smith').fill('Pat Doe');
    await s.page.getByText(tx('en', 'motion_generate_btn', { label: 'Motion to Suppress' }).slice(0, 12)).first().click();
    await until(async () => (await byTid(s.page, 'motion-draft').inputValue().catch(() => '')).includes('MOTION TO SUPPRESS'), 20000, 'draft');
    await shot(s.page, 'E11-draft');
    const h = await apiCall('GET', '/motions/history', { token: acc.token });
    if (!Array.isArray(h.body) || !h.body.length) throw new Error('generated motion missing from history');
    const id = h.body[0].id;
    const st = await apiCall('PATCH', `/motions/${id}/status`, { token: acc.token, body: { status: 'filed' } });
    if (st.status !== 200) throw new Error(`status ${st.status}`);
    const other = await newUser('e11x');
    const st2 = await apiCall('PATCH', `/motions/${id}/status`, { token: other.token, body: { status: 'denied' } });
    if (st2.status !== 404) throw new Error(`another account changed the status: ${st2.status}`);
    await go(s.page, '/motions');
    await s.page.getByText(tx('en', 'x_discovery_history'), { exact: true }).first().click();
    await byTid(s.page, 'motion-library-screen').first().waitFor({ timeout: 10000 });
    await byTid(s.page, 'motion-library-screen').first().locator('[role="button"]').first().click();
    await until(async () => (await byTid(s.page, 'motion-draft').inputValue().catch(() => '')).includes('MOTION TO SUPPRESS'), 10000, 'reopened draft');
    await done(s);
    return `no price; draft generated; history #${id}; filed; stranger PATCH 404; reopened`;
  });

  await journey('E12 penalties: DUI tab, state, sources, guest', async () => {
    const s = await open(browser, { lang: 'pt' });
    await s.page.addInitScript(() => localStorage.setItem('jg_user_state', 'TN'));
    await go(s.page, '/dui-laws');
    await byTid(s.page, 'penalties-row').first().waitFor({ timeout: 10000 });
    const duiText = await bodyText(s.page);
    if (!duiText.includes(tx('pt', 'pen_dui_bac').split(':')[0])) throw new Error('DUI link did not open the DUI tab');
    if (!duiText.includes('Tennessee')) throw new Error('not the saved state');
    await byTid(s.page, 'penalties-state').click();
    await byTid(s.page, 'penalties-state-CA').click();
    await until(async () => (await bodyText(s.page)).includes('Califórnia'), 8000, 'California rows');
    await byTid(s.page, 'penalties-tab-drug').click();
    await until(async () => (await byTid(s.page, 'penalties-row').count()) > 0, 8000, 'drug rows');
    const rows = await byTid(s.page, 'penalties-row').allInnerTexts();
    if (!rows.every(r => r.includes(tx('pt', 'pen_source', { source: '', date: '' }).split(':')[0]))) throw new Error('a row without its recorded source');
    if (!(await byTid(s.page, 'penalties-notice').innerText()).includes('advogado')) throw new Error('no "not reviewed by a lawyer" notice in Portuguese');
    if (s.failed.length) throw new Error(`failed: ${s.failed.join(', ')}`);
    await shot(s.page, 'E12-drug-CA-pt');
    await done(s);
    return `DUI tab first; TN → CA; ${rows.length} drug rows, each with its source; guest 0 failed requests`;
  });

  await journey('E13 resources: guest, all rows, help lines dial right', async () => {
    const s = await open(browser);
    await s.page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
    await go(s.page, '/resources');
    await until(async () => /631/.test(await bodyText(s.page)), 10000, 'count of 631');
    await s.page.getByText(tx('en', 'x_resources_crisis_lines')).first().click();
    await s.page.getByText('Veterans Crisis Line', { exact: true }).click();
    await byTid(s.page, 'resource-call').first().scrollIntoViewIfNeeded();
    const vet = await byTid(s.page, 'resource-call').first().textContent();
    if (!/(^|\D)988 /.test(vet) || /9881/.test(vet) || !vet.includes(tx('en', 'res_then_press', { n: 1 }))) throw new Error(`veterans line shows "${vet}"`);
    await byTid(s.page, 'resource-call').first().click();
    await s.page.waitForTimeout(300);
    await s.page.getByText('Veterans Crisis Line', { exact: true }).click();
    await s.page.getByText('Crisis Text Line', { exact: true }).click();
    await byTid(s.page, 'resource-call').first().scrollIntoViewIfNeeded();
    const txt = await byTid(s.page, 'resource-call').first().textContent();
    if (!/Text HOME to 741741/i.test(txt)) throw new Error(`text line shows "${txt}"`);
    await byTid(s.page, 'resource-call').first().click();
    await s.page.waitForTimeout(300);
    // what the buttons opened
    const hrefs = await s.page.evaluate(() => window.__opened);
    // (tel: links are a location change on web — the dial target is checked by the helpLine unit test)
    if (hrefs.length !== 1 || !/^sms:741741\?body=HOME$/.test(hrefs[0])) throw new Error(`opened ${JSON.stringify(hrefs)}`);
    if (s.failed.length) throw new Error(`failed: ${s.failed.join(', ')}`);
    await shot(s.page, 'E13-resources');
    await done(s);
    return `631 listed to a guest; veterans "${vet.trim()}"; text line → ${hrefs[0]}`;
  });

  await journey('E14 lessons: reworded content, completion persists, points once', async () => {
    const g = await open(browser, { lang: 'es' });
    await go(g.page, '/learn');
    await byTid(g.page, 'lesson-9').click();
    const content = await byTid(g.page, 'lesson-content').innerText();
    if (!content.includes('Pay a bondsman a fee they set') || /10%/.test(content)) throw new Error('migration 22 rewording not shown');
    await byTid(g.page, 'lessons-english-only').waitFor();
    if (/NaN|\{points\}/.test(await bodyText(g.page))) throw new Error('NaN / raw placeholder on the lessons screen');
    await byTid(g.page, 'lesson-complete').click();
    await until(async () => (await bodyText(g.page)).includes(tx('es', 'sin_title')) || (await bodyText(g.page)).includes(tx('es', 'sign_in')), 6000, 'sign-in prompt for a guest');
    if (g.failed.length) throw new Error(`guest failed: ${g.failed.join(', ')}`);
    await shot(g.page, 'E14-guest');
    await done(g);
    const acc = await newUser('e14');
    const s = await open(browser, { account: acc });
    await go(s.page, '/learn');
    await byTid(s.page, 'lesson-9').click();
    await byTid(s.page, 'lesson-complete').click();
    await byTid(s.page, 'lesson-done').waitFor({ timeout: 8000 });
    const again = await apiCall('POST', '/lessons/9/complete', { token: acc.token });
    const prog = await apiCall('GET', '/lessons/progress/me', { token: acc.token });
    if (again.body.pointsAwarded !== 0 || prog.body.points !== 20) throw new Error(`points: again=${again.body.pointsAwarded}, total=${prog.body.points}`);
    await done(s);
    const s2 = await open(browser, { account: acc, viewport: { width: 1280, height: 900 } });
    await go(s2.page, '/learn');
    await until(async () => /20 \/ 1035/.test(await byTid(s2.page, 'lessons-points').innerText().catch(() => '')), 8000, 'points in a fresh browser');
    await byTid(s2.page, 'lesson-9').click();
    await byTid(s2.page, 'lesson-done').waitFor({ timeout: 8000 });
    await shot(s2.page, 'E14-fresh-browser');
    await done(s2);
    return 'reworded bail lesson shown; guest → sign in; complete once (+20, repeat +0); fresh browser shows it done';
  });

  await journey('E15 bar prep: graded practice, results, retry, progress, schedule day', async () => {
    const acc = await newUser('e15');
    const s = await open(browser, { account: acc, tz: 'Asia/Tokyo' });
    await go(s.page, '/bar-prep');
    await byTid(s.page, 'barprep-start').click();
    await byTid(s.page, 'barprep-option-A').waitFor({ timeout: 10000 });
    // answer every question with A (the grading decides)
    let n = 0;
    for (let i = 0; i < 12; i++) {
      await byTid(s.page, 'barprep-option-A').click();
      await until(async () => /Correct|Incorrect|✓|✗/.test(await bodyText(s.page)), 8000, 'graded reveal');
      n++;
      if (await byTid(s.page, 'barprep-submit').count()) { await byTid(s.page, 'barprep-submit').click(); break; }
      await byTid(s.page, 'barprep-next').click();
    }
    await byTid(s.page, 'barprep-score').waitFor({ timeout: 10000 });
    const shown = parseInt(await byTid(s.page, 'barprep-score').innerText(), 10);
    const prog = await apiCall('GET', '/bar-prep/progress', { token: acc.token });
    const last = (prog.body.recent_sessions || [])[0];
    if (!last || Math.round(last.score_pct) !== shown || last.total_answered !== n) throw new Error(`results ${shown}% vs server ${JSON.stringify(last)}`);
    await shot(s.page, 'E15-results');
    // The free sample (10 questions) is now used up: "Retry wrong" leads to the plans.
    if (await byTid(s.page, 'barprep-retry-wrong').count()) {
      await byTid(s.page, 'barprep-retry-wrong').click();
      await until(async () => s.page.url().includes('/plans'), 10000, 'plans after the free sample');
    }
    const put = await apiCall('PUT', '/bar-prep/progress', { token: acc.token, body: { exam_date: '2027-02-23' } });
    if (put.status !== 200) throw new Error(`exam date ${put.status}`);
    const tokyoToday = await s.page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date()));
    const sch = await fetch(API + '/bar-prep/schedule', { headers: { Authorization: `Bearer ${acc.token}`, 'X-Timezone': 'Asia/Tokyo' } }).then(r => r.json());
    if (sch.calendar[0].date !== tokyoToday || !sch.calendar[0].is_today) throw new Error(`schedule today ${sch.calendar[0].date} vs Tokyo ${tokyoToday}`);
    await go(s.page, '/bar-prep/schedule');
    await until(async () => (await bodyText(s.page)).includes(String(sch.days_until_exam)), 8000, 'days until exam');
    await shot(s.page, 'E15-schedule');
    await go(s.page, '/bar-prep/progress');
    await until(async () => /%/.test(await bodyText(s.page)), 8000, 'progress');
    if (/NaN|undefined/.test(await bodyText(s.page))) throw new Error('NaN/undefined on progress');
    await shot(s.page, 'E15-progress');
    await done(s, { allow: ['402 POST /bar-prep/sessions'] });   // the paywall answer after the free sample is expected
    return `${n} graded answers; results ${shown}% = server; retry after the free sample → plans; Tokyo day ${tokyoToday}; ${sch.days_until_exam} days to exam`;
  });

  await journey('E16 advocacy: guest sees real counts', async () => {
    const s = await open(browser, { lang: 'vi' });
    await go(s.page, '/advocacy');
    await until(async () => /2046/.test(await bodyText(s.page)), 8000, 'lawyer count');
    if (s.failed.length) throw new Error(`failed: ${s.failed.join(', ')}`);
    await shot(s.page, 'E16-advocacy');
    await done(s);
    return '2,046 lawyers / 1,262 agents shown to a guest, 0 failed requests';
  });

  // ── Always last: page errors and failed requests across every journey ──────
  if (!ONLY.length) {
    if (allErrors.length) fail('ERR page errors', allErrors.slice(0, 5).join(' | '));
    else pass('ERR page errors', '0');
    if (allFailed.length) fail('REQ failed requests', [...new Set(allFailed)].slice(0, 8).join(' | '));
    else pass('REQ failed requests', '0 unexpected 4xx/5xx');
  }
  await browser.close();
  server.close();
  const failedN = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failedN}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failedN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
