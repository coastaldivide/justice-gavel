/**
 * middleware_order.test.js
 * Verifies the Express middleware is registered in the correct order.
 * Security headers → CORS → body parsing → rate limiting → routes.
 * Wrong order = security holes that pass all other tests.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const APP = readFileSync(resolve(__dirname, '../app.js'), 'utf-8');

function posOf(pattern) {
  const m = APP.search(pattern);
  return m === -1 ? Infinity : m;
}

describe('Middleware order — security', () => {
  test('Helmet (security headers) is registered before routes', () => {
    const helmet = posOf(/app\.use\s*\(\s*helmet/);
    const routes = posOf(/app\.use\s*\(['"]\/api/);
    expect(helmet).toBeLessThan(routes);
  });

  test('CORS is registered before routes', () => {
    const cors   = posOf(/app\.use\s*\(\s*cors/);
    const routes = posOf(/app\.use\s*\(['"]\/api/);
    expect(cors).toBeLessThan(routes);
  });

  test('compression is registered before routes', () => {
    const comp   = posOf(/app\.use\s*\(\s*compression/);
    const routes = posOf(/app\.use\s*\(['"]\/api/);
    expect(comp).toBeLessThan(routes);
  });

  test('JSON body parser is registered before routes', () => {
    const parser = posOf(/express\.json/);
    const routes = posOf(/app\.use\s*\(['"]\/api/);
    expect(parser).toBeLessThan(routes);
  });

  test('Helmet is registered before body parser (headers before body read)', () => {
    const helmet = posOf(/app\.use\s*\(\s*helmet/);
    const parser = posOf(/express\.json/);
    expect(helmet).toBeLessThan(parser);
  });

  test('error handler is registered AFTER routes (4-arg middleware)', () => {
    const routes  = posOf(/app\.use\s*\(['"]\/api/);
    const errHdlr = posOf(/app\.use\s*\(\s*\([^)]*err[^)]*,\s*req/);
    if (errHdlr !== Infinity) expect(errHdlr).toBeGreaterThan(routes);
  });

  test('Sentry error handler is after routes', () => {
    const routes  = posOf(/app\.use\s*\(['"]\/api/);
    const sentry  = posOf(/Sentry\.Handlers\.errorHandler|setupSentry/);
    if (sentry !== Infinity) expect(sentry).toBeGreaterThan(routes);
  });

  test('HPP protection is before routes', () => {
    const hpp    = posOf(/app\.use\s*\(\s*hpp/);
    const routes = posOf(/app\.use\s*\(['"]\/api/);
    if (hpp !== Infinity) expect(hpp).toBeLessThan(routes);
  });
});

describe('Middleware — required presence', () => {
  test('helmet is present', () => { expect(APP).toMatch(/helmet/); });
  test('cors is present',   () => { expect(APP).toMatch(/cors/i);   });
  test('express.json is present', () => { expect(APP).toMatch(/express\.json/); });
  test('compression is present',  () => { expect(APP).toMatch(/compression/);   });
  test('hpp is present',          () => { expect(APP).toMatch(/hpp/i);           });
  test('morgan or logger is present', () => {
    expect(APP).toMatch(/morgan|logger\.http|logger\.info/i);
  });
});
