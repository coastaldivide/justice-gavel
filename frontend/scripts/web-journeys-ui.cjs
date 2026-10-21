#!/usr/bin/env node
/**
 * web-journeys-ui.cjs — layout checks for the UI pass (calm hierarchy, no
 * covered content, results first), measured with element bounding boxes in
 * headless Chromium against a REAL backend:
 *
 *   U1 SOS never covers content: on every screen that renders the SOS control
 *      (Home tab, Resources-tab Home) at 390×844 and 1280×900, signed in with a
 *      court date (the fullest Home), at the top / middle / bottom scroll
 *      position: no visible text, button, link or input (clipped by its scroll
 *      container, as on screen) intersects the SOS button. Reports the counts.
 *   U2 Home: one clear first move — "Just arrested?" is on the first screen,
 *      there is no header "Help Now" button, 911 / 988 are one tap (in the SOS
 *      lane), no horizontal overflow at 390 px in en / es / pt / vi.
 *   U3 Help Now at 390×844 (en, vi): the first listing's name and Call button
 *      are fully visible without scrolling; "How results are sorted" opens the
 *      server's ranking note in that language.
 *   U4 Rights card: "Say these words" sits directly under the state picker; the
 *      "not yet reviewed" notice is a footnote below it (en, vi).
 *   U7 Home quick-access tiles and the tab bar follow the theme in dark and
 *      light mode: theme surfaces, labels ≥ 4.5:1 on their own background,
 *      tiles and tabs ≥ 44 pt, secondary tiles compact (≤ 80 px) (en, vi).
 *   U8 the SOS control reads "SOS" (no "hold"), its accessible name says what it
 *      does, and a tap still opens the confirm step (en / es / pt / vi).
 *
 *   node scripts/web-journeys-ui.cjs dist out --api http://localhost:4300/api [--port 8300] [--shots dir]
 *
 * --shots also saves the after screenshots: Home, Help Now, Rights card and
 * Just arrested in en and vi at 390 and 1280. Exit 1 on any failure.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'web-journeys-ui-out'));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = String(arg('--api', 'http://localhost:4300/api')).replace(/\/$/, '');
const PORT = Number(arg('--port', 8300));
const SHOTS = arg('--shots', null);
fs.mkdirSync(OUT, { recursive: true });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const I18N = path.join(ROOT, 'src', 'i18n');
const L = Object.fromEntries(['en', 'es', 'pt', 'vi'].map(l => [l, JSON.parse(fs.readFileSync(path.join(I18N, `${l}.json`), 'utf8'))]));
const LOCALES = { en: 'en-US', es: 'es-US', pt: 'pt-BR', vi: 'vi-VN' };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

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
async function apiCall(method, p, { token, body } = {}) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': freshIp(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j };
}
async function newUser(tag) {
  const email = `u-${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@journeys.test`;
  const reg = await apiCall('POST', '/auth/register', { body: { identifier: email, password: 'CorrectHorse9!', displayName: `Maria ${tag}` } });
  const token = reg.body && reg.body.token;
  if (!token) throw new Error(`register ${reg.status}`);
  await apiCall('POST', '/auth/accept-tos', { token, body: { checkbox_tos: true, checkbox_no_advice: true, scroll_completed: true, platform: 'web' } });
  await apiCall('POST', '/auth/disclaimer/accept', { token });
  return { token, user: reg.body.user };
}

const base = `http://localhost:${PORT}`;
const byTid = (page, id) => page.locator(`[data-testid="${id}"]`);
let lastPage = null;

async function open(browser, { lang = 'en', viewport = PHONE, account = null, state = null, theme = null } = {}) {
  const ctx = await browser.newContext({ viewport, locale: LOCALES[lang], timezoneId: 'America/Chicago', serviceWorkers: 'block',
    extraHTTPHeaders: { 'X-Forwarded-For': freshIp() } });
  const page = await ctx.newPage();
  lastPage = page;
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(base + '/age-check', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([acc, st, lg, th]) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('age_verified', '1');
    localStorage.setItem('has_browsed', 'true');
    localStorage.setItem('lang', lg);
    if (th) localStorage.setItem('jg_theme_mode', th);
    if (st) localStorage.setItem('jg_user_state', st);
    if (acc) { sessionStorage.setItem('jg_token', acc.token); sessionStorage.setItem('jg_user', JSON.stringify(acc.user)); }
  }, [account, state, lang, theme]);
  return { ctx, page, errors };
}
async function go(page, p) { await page.goto(base + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(900); }
async function journey(id, fn) {
  try { pass(id, (await fn()) || 'ok'); }
  catch (e) {
    fail(id, e.message);
    if (lastPage) await lastPage.screenshot({ path: path.join(OUT, `FAIL-${id.split(' ')[0]}.png`) }).catch(() => {});
  }
}
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
};

/**
 * In the page: every visible text / control box, clipped by its overflow
 * ancestors (what is really on screen), outside `excludeTid`; and the boxes that
 * intersect `targetTid`.
 */
function measureOverlap([targetTid, excludeTid]) {
  const target = document.querySelector(`[data-testid="${targetTid}"]`);
  if (!target) return { error: `no ${targetTid}` };
  const t = target.getBoundingClientRect();
  const exclude = document.querySelector(`[data-testid="${excludeTid}"]`);
  const vw = window.innerWidth, vh = window.innerHeight;
  const clip = (el) => {
    let r = el.getBoundingClientRect();
    let box = { l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(vw, r.right), b: Math.min(vh, r.bottom) };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        box = { l: Math.max(box.l, ar.left), t: Math.max(box.t, ar.top), r: Math.min(box.r, ar.right), b: Math.min(box.b, ar.bottom) };
      }
    }
    return box.r - box.l > 1 && box.b - box.t > 1 ? box : null;
  };
  const isControl = (el) => el.matches('button, a, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="radio"], [tabindex="0"]');
  const hasText = (el) => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const visible = (el) => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const boxes = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (exclude && exclude.contains(el)) continue;
    if (!(isControl(el) || hasText(el)) || !visible(el)) continue;
    const b = clip(el);
    if (b) boxes.push({ b, label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 50) });
  }
  const hits = boxes.filter(({ b }) => b.l < t.right && b.r > t.left && b.t < t.bottom && b.b > t.top).map(x => x.label);
  return { checked: boxes.length, hits, sos: { x: Math.round(t.left), y: Math.round(t.top), w: Math.round(t.width), h: Math.round(t.height) } };
}

/** The Home ScrollView (the scrollable element inside home-screen). */
async function scrollHome(page, where) {
  return page.evaluate((w) => {
    const root = document.querySelector('[data-testid="home-screen"]');
    const sc = [...root.querySelectorAll('div')].find(d => { const cs = getComputedStyle(d); return /(auto|scroll)/.test(cs.overflowY) && d.scrollHeight > d.clientHeight + 4; });
    if (!sc) return { max: 0 };
    const max = sc.scrollHeight - sc.clientHeight;
    sc.scrollTop = w === 'top' ? 0 : w === 'middle' ? Math.round(max / 2) : max;
    return { max, at: sc.scrollTop };
  }, where);
}

(async () => {
  await new Promise((r, j) => server.once('error', j).listen(PORT, 'localhost', r));
  const browser = await chromium.launch();
  const allErrors = [];
  const dayPlus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  // ── U1 SOS never covers content ──────────────────────────────────────────
  await journey('U1 SOS never covers text or buttons (Home tab + Resources Home, 390×844 and 1280×900, top/middle/bottom)', async () => {
    const acc = await newUser('u1');
    await apiCall('POST', '/court-dates', { token: acc.token, body: { title: 'Countdown case', court_date: dayPlus(2), court_time: '09:00', hearing_type: 'arraignment' } });
    const out = []; const problems = [];
    let total = 0;
    for (const viewport of [PHONE, DESKTOP]) {
      for (const route of ['/', '/home']) {
        const s = await open(browser, { viewport, account: acc, state: 'TN' });
        await go(s.page, route);
        await byTid(s.page, 'sos-button').first().waitFor({ timeout: 15000 });
        await byTid(s.page, 'home-court-countdown').first().waitFor({ timeout: 15000 }).catch(() => {});
        for (const where of ['top', 'middle', 'bottom']) {
          const sc = await scrollHome(s.page, where);
          await s.page.waitForTimeout(250);
          const m = await s.page.evaluate(measureOverlap, ['sos-button', 'sos-dock']);
          if (m.error) throw new Error(m.error);
          total += m.checked;
          if (viewport === PHONE && route === '/') await s.page.screenshot({ path: path.join(OUT, `U1-home-390-${where}.png`) }).catch(() => {});
          if (m.hits.length) problems.push(`${viewport.width}px ${route} ${where}: ${m.hits.join(' | ')}`);
          if (where === 'top') out.push(`${viewport.width}px ${route}: SOS at (${m.sos.x},${m.sos.y}) ${m.sos.w}×${m.sos.h}, scroll range ${sc.max}px`);
        }
        allErrors.push(...s.errors);
        await s.ctx.close();
      }
    }
    if (problems.length) throw new Error(`SOS overlaps: ${problems.join(' ;; ')}`);
    return `${total} visible text/control boxes checked over 12 positions, 0 overlaps · ${out.join(' · ')}`;
  });

  // ── U2 Home first move ───────────────────────────────────────────────────
  await journey('U2 Home: "Just arrested?" first, no header Help Now, 911/988 one tap, no overflow at 390 (4 languages)', async () => {
    const out = [];
    for (const lang of ['en', 'es', 'pt', 'vi']) {
      const s = await open(browser, { lang });
      await go(s.page, '/');
      const hero = await byTid(s.page, 'home-just-arrested').first().boundingBox();
      if (!hero || hero.y + hero.height > PHONE.height - 62) throw new Error(`${lang}: Just arrested card not on the first screen ${JSON.stringify(hero)}`);
      const headerHelp = await s.page.getByText(L[lang].help_now, { exact: true }).count();
      if (headerHelp) throw new Error(`${lang}: a "${L[lang].help_now}" header button is still on Home`);
      for (const tid of ['strip-call-911', 'strip-call-988', 'sos-button']) {
        const b = await byTid(s.page, tid).first().boundingBox();
        if (!b || b.height < 44 || b.y + b.height > PHONE.height) throw new Error(`${lang}: ${tid} not a one-tap target on screen ${JSON.stringify(b)}`);
      }
      const sw = await s.page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > PHONE.width + 1) throw new Error(`${lang}: page is ${sw}px wide at 390`);
      // only the hero is a big red card on the first screen
      const reds = await s.page.evaluate(() => [...document.querySelectorAll('[data-testid="home-screen"] div')].filter(d => {
        const r = d.getBoundingClientRect(); const bg = getComputedStyle(d).backgroundColor;
        const m = /rgba?\((\d+), (\d+), (\d+)/.exec(bg); if (!m) return false;
        const [R, G, B] = m.slice(1).map(Number);
        return R > 150 && G < 60 && B < 60 && r.width > 200 && r.height > 80 && r.top < window.innerHeight;
      }).map(d => d.getAttribute('data-testid') || 'div'));
      if (reds.some(x => x !== 'home-just-arrested')) throw new Error(`${lang}: other large red blocks on the first screen: ${reds.join(', ')}`);
      if (lang === 'en' || lang === 'vi') { await shot(s.page, `home-${lang}-390`); }
      out.push(`${lang} hero bottom ${Math.round(hero.y + hero.height)}px`);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    for (const lang of ['en', 'vi']) {
      const s = await open(browser, { lang, viewport: DESKTOP });
      await go(s.page, '/');
      await byTid(s.page, 'home-just-arrested').first().waitFor({ timeout: 15000 });
      await shot(s.page, `home-${lang}-1280`);
      await s.ctx.close();
    }
    return out.join(', ');
  });

  // ── U3 Help Now results first ────────────────────────────────────────────
  await journey('U3 Help Now (390×844): first listing name + Call visible without scrolling; sort note behind the link', async () => {
    const out = [];
    for (const lang of ['en', 'vi']) {
      const s = await open(browser, { lang, state: 'TN' });
      await go(s.page, '/help');
      await byTid(s.page, 'help-lawyer-card').first().waitFor({ timeout: 20000 });
      await s.page.waitForTimeout(500);
      const full = (tid) => s.page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="help-lawyer-card"] [data-testid="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        let top = 0, bottom = window.innerHeight;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (/(auto|scroll|hidden)/.test(cs.overflowY)) { const ar = a.getBoundingClientRect(); top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom); }
        }
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), visibleTop: Math.round(top), visibleBottom: Math.round(bottom) };
      }, tid);
      const name = await full('help-card-name'); const call = await full('help-call');
      for (const [k, b] of [['name', name], ['Call', call]]) {
        if (!b || b.top < b.visibleTop || b.bottom > b.visibleBottom) throw new Error(`${lang}: first listing ${k} not fully visible ${JSON.stringify(b)}`);
      }
      if (await byTid(s.page, 'help-ranking-note').count()) throw new Error(`${lang}: ranking note shown before the link is opened`);
      const linkText = await byTid(s.page, 'help-sort-toggle').innerText();
      if (!linkText.includes(L[lang].hn_how_sorted)) throw new Error(`${lang}: sort link "${linkText}"`);
      await shot(s.page, `help-${lang}-390`);
      await byTid(s.page, 'help-sort-toggle').click();
      const note = await byTid(s.page, 'help-ranking-note').innerText();
      const srv = await apiCall('GET', `/help/nearby?state=TN&lang=${lang}`);
      if (!note.includes(srv.body.meta.ranking)) throw new Error(`${lang}: note is not the server's ${lang} ranking text: "${note}"`);
      out.push(`${lang}: name bottom ${name.bottom}px, Call bottom ${call.bottom}px of ${call.visibleBottom}px visible`);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    for (const lang of ['en', 'vi']) {
      const s = await open(browser, { lang, viewport: DESKTOP, state: 'TN' });
      await go(s.page, '/help');
      await byTid(s.page, 'help-lawyer-card').first().waitFor({ timeout: 20000 });
      await shot(s.page, `help-${lang}-1280`);
      await s.ctx.close();
    }
    return out.join(' · ');
  });

  // ── U4 Rights card words first ───────────────────────────────────────────
  await journey('U4 Rights card: "Say these words" right under the state picker; review notice is a footnote below', async () => {
    const out = [];
    for (const lang of ['en', 'vi']) {
      for (const viewport of [PHONE, DESKTOP]) {
        const s = await open(browser, { lang, viewport, state: 'TN' });
        await go(s.page, '/rights');
        await byTid(s.page, 'rights-state-notice').first().waitFor({ timeout: 15000 });
        const picker = await byTid(s.page, 'rights-state-picker').boundingBox();
        const script = await byTid(s.page, 'rights-script').boundingBox();
        const notice = await byTid(s.page, 'rights-state-notice').boundingBox();
        const gap = Math.round(script.y - (picker.y + picker.height));
        if (gap < 0 || gap > 24) throw new Error(`${lang} ${viewport.width}: script is ${gap}px below the picker`);
        if (notice.y < script.y + script.height) throw new Error(`${lang} ${viewport.width}: notice above the script`);
        const txt = await byTid(s.page, 'rights-state-notice').innerText();
        if (lang === 'en' && !/Tennessee haven't been reviewed yet/.test(txt)) throw new Error(`notice text "${txt}"`);
        await shot(s.page, `rights-${lang}-${viewport.width}`);
        if (viewport === PHONE) out.push(`${lang}: picker→script ${gap}px, notice at ${Math.round(notice.y)}px (script ends ${Math.round(script.y + script.height)}px)`);
        allErrors.push(...s.errors);
        await s.ctx.close();
      }
    }
    return out.join(' · ');
  });

  // ── Just arrested screenshots (no SOS on this screen; layout only) ───────
  await journey('U5 Just arrested renders in en / vi at 390 and 1280 (screenshots)', async () => {
    for (const lang of ['en', 'vi']) {
      for (const viewport of [PHONE, DESKTOP]) {
        const s = await open(browser, { lang, viewport, state: 'TN' });
        await go(s.page, '/just-arrested');
        await byTid(s.page, 'core-script').first().waitFor({ timeout: 15000 });
        const sw = await s.page.evaluate(() => document.documentElement.scrollWidth);
        if (sw > viewport.width + 1) throw new Error(`${lang} ${viewport.width}: page is ${sw}px wide`);
        await shot(s.page, `just-arrested-${lang}-${viewport.width}`);
        allErrors.push(...s.errors);
        await s.ctx.close();
      }
    }
    return 'en, vi × 390, 1280';
  });

  // ── U7 Home tiles + tab bar follow the theme (dark AND light) ─────────────
  // Every quick-access tile and the tab bar use the theme's surfaces: dark
  // surfaces in dark mode, light in light mode; tile and tab labels pass AA
  // (4.5:1) against their own background; every tile and tab is ≥ 44 pt tall;
  // the secondary tiles are compact rows (≤ 80 px tall), not big squares.
  await journey('U7 Home tiles + tab bar follow the theme in dark and light (AA, ≥44 pt, compact tiles; en / vi)', async () => {
    const out = [];
    for (const theme of ['dark', 'light']) {
      for (const lang of ['en', 'vi']) {
        const s = await open(browser, { lang, theme });
        await go(s.page, '/');
        await byTid(s.page, 'tile-Bail').first().waitFor({ timeout: 15000 });
        await byTid(s.page, 'tile-Search').first().scrollIntoViewIfNeeded();
        const m = await s.page.evaluate(() => {
          const rgb = c => { const x = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?/.exec(c); return x && (x[4] === undefined || +x[4] > 0.5) ? [+x[1], +x[2], +x[3]] : null; };
          const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
          const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
          const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c) return c; } return [255, 255, 255]; };
          const tiles = [...document.querySelectorAll('[data-testid^="tile-"]')].map(t => {
            const r = t.getBoundingClientRect(); const bg = bgOf(t);
            const label = [...t.querySelectorAll('div[dir="auto"], span')].find(e => (e.innerText || '').trim());
            const fg = label ? rgb(getComputedStyle(label).color) : null;
            return { id: t.getAttribute('data-testid'), h: Math.round(r.height), w: Math.round(r.width), bgLum: lum(bg), ratio: fg ? cr(fg, bg) : 0 };
          });
          const tl = document.querySelector('[role="tablist"]');
          const tabBg = tl ? bgOf(tl) : null;
          const tabs = tl ? [...tl.querySelectorAll('[role="tab"]')].map(b => {
            const r = b.getBoundingClientRect(); const lab = [...b.querySelectorAll('div[dir="auto"], span')].find(e => (e.innerText || '').trim());
            return { h: Math.round(r.height), ratio: lab ? cr(rgb(getComputedStyle(lab).color), bgOf(b)) : 0 };
          }) : [];
          return { tiles, tabBgLum: tabBg ? lum(tabBg) : null, tabs };
        });
        const where = `${theme} ${lang}`;
        if (m.tiles.length < 10) throw new Error(`${where}: only ${m.tiles.length} tiles`);
        for (const tl of m.tiles) {
          if (theme === 'dark' ? tl.bgLum > 0.08 : tl.bgLum < 0.6) throw new Error(`${where}: ${tl.id} background does not follow the ${theme} theme (luminance ${tl.bgLum.toFixed(2)})`);
          if (tl.ratio < 4.5) throw new Error(`${where}: ${tl.id} label contrast ${tl.ratio.toFixed(2)} < 4.5`);
          if (tl.h < 44) throw new Error(`${where}: ${tl.id} is ${tl.h}px tall (< 44)`);
        }
        const rows = m.tiles.filter(x => x.w >= 150 && x.w < 200);
        if (rows.some(x => x.h > 80)) throw new Error(`${where}: secondary tiles are still big squares (${rows.map(x => x.h).join(',')}px)`);
        if (m.tabBgLum === null) throw new Error(`${where}: no tab bar`);
        if (theme === 'dark' ? m.tabBgLum > 0.08 : m.tabBgLum < 0.6) throw new Error(`${where}: tab bar does not follow the ${theme} theme (luminance ${m.tabBgLum.toFixed(2)})`);
        if (m.tabs.length !== 5 || m.tabs.some(x => x.h < 44 || x.ratio < 4.5)) throw new Error(`${where}: tab targets ${JSON.stringify(m.tabs)}`);
        await shot(s.page, `home-tiles-${theme}-${lang}-390`);
        out.push(`${where}: ${m.tiles.length} tiles (min AA ${Math.min(...m.tiles.map(x => x.ratio)).toFixed(1)}, secondary ≤${Math.max(0, ...rows.map(x => x.h))}px), tabs min AA ${Math.min(...m.tabs.map(x => x.ratio)).toFixed(1)}`);
        allErrors.push(...s.errors);
        await s.ctx.close();
      }
    }
    return out.join('; ');
  });

  // ── U8 SOS label is truthful: "SOS", tap → confirm (never "hold") ─────────
  await journey('U8 SOS says "SOS" (no HOLD), accessible name says what it does; tap opens the confirm step (4 languages)', async () => {
    const out = [];
    for (const lang of ['en', 'es', 'pt', 'vi']) {
      const s = await open(browser, { lang });
      await go(s.page, '/');
      const btn = byTid(s.page, 'sos-button').first();
      await btn.waitFor({ timeout: 15000 });
      const text = (await btn.innerText()).trim();
      if (text !== 'SOS') throw new Error(`${lang}: SOS button reads "${text}"`);
      const name = await btn.getAttribute('aria-label');
      if (name !== L[lang].x_floating_sosbutton_emergency_call_help) throw new Error(`${lang}: accessible name "${name}"`);
      if (/hold|mantener|segure|giữ/i.test(name || '')) throw new Error(`${lang}: accessible name still says hold`);
      // behaviour unchanged: a tap goes to the confirm step (no contacts → "add contacts" prompt), nothing is sent
      let dialog = null;
      s.page.removeAllListeners('dialog');
      s.page.on('dialog', d => { dialog = d.message(); d.dismiss().catch(() => {}); });
      await btn.click();
      await s.page.waitForTimeout(800);
      const confirmShown = dialog !== null || await s.page.getByText(L[lang].home_sos_none_title).count() > 0 || await s.page.getByText(L[lang].home_sos_title).count() > 0;
      if (!confirmShown) throw new Error(`${lang}: tapping SOS did not open the confirm step`);
      out.push(`${lang} ok`);
      allErrors.push(...s.errors);
      await s.ctx.close();
    }
    return out.join(', ');
  });

  await journey('U6 no page errors during the UI journeys', async () => {
    const real = allErrors.filter(e => !/ResizeObserver/.test(e));
    if (real.length) throw new Error(real.slice(0, 5).join(' | '));
    return '0 page errors';
  });

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
