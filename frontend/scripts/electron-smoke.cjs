#!/usr/bin/env node
/**
 * electron-smoke.cjs — probe a running Electron window over CDP.
 *   npm run electron:build  (or: expo export --platform web --output-dir web-build)
 *   xvfb-run -a npx electron --no-sandbox --remote-debugging-port=9333 electron/main.js &
 *   node scripts/electron-smoke.cjs
 * Checks the app:// protocol (SPA fallback, 404, path traversal), age gate, and
 * the window.__navigateTo desktop bridge. Needs Playwright (PLAYWRIGHT_MODULE).
 */
const { chromium } = (() => { try { return require(process.env.PLAYWRIGHT_MODULE || 'playwright'); } catch { return require('/opt/npm-tools/node_modules/playwright'); } })();
(async () => {
  let b;
  for (let i = 0; i < 40; i++) { try { b = await chromium.connectOverCDP('http://127.0.0.1:9333'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!b) { console.log('NO CDP'); process.exit(1); }
  const pages = b.contexts().flatMap(c => c.pages());
  const page = pages.find(p => p.url().startsWith('app://')) || pages[0];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e)));
  await page.waitForTimeout(6000);
  console.log('URL', page.url());
  const txt = await page.locator('body').innerText();
  console.log('TEXT', txt.slice(0, 200).replace(/\s+/g, ' '));
  await page.getByLabel('Enter your birth year').fill('1990', { timeout: 3000 }).catch(e => console.log('agegate?', e.message.split('\n')[0]));
  await page.getByLabel('Continue').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2500);
  console.log('AFTER', (await page.locator('body').innerText()).slice(0, 200).replace(/\s+/g, ' '));
  // deep link via the desktop bridge used by the app menu
  await page.evaluate(() => { localStorage.setItem('has_browsed', 'true'); });
  await page.reload(); await page.waitForTimeout(4000);
  await page.evaluate(() => window.__navigateTo && window.__navigateTo('Settings'));
  await page.waitForTimeout(2500);
  console.log('SETTINGS', (await page.locator('body').innerText()).slice(0, 150).replace(/\s+/g, ' '));
  await page.screenshot({ path: process.argv[2] || 'electron-settings.png' });
  // SPA fallback + missing asset
  const r = await page.evaluate(async () => [(await fetch('/some/client/route')).status, (await fetch('/nope.js')).status, (await fetch('/../../package.json')).status]);
  console.log('FETCH statuses (spa, missing, traversal):', r);
  console.log('PAGEERRORS', errors.length, errors.slice(0, 3));
  await b.close().catch(() => {});
  process.exit(0);
})();
