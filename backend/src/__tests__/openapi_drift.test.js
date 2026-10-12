/**
 * openapi_drift.test.js — fails whenever /openapi.json and the routes the app
 * actually mounts drift apart.
 *
 * The spec is generated from the mounted router tree by
 * backend/scripts/generate-openapi.mjs (or `node scripts/generate-openapi.mjs`
 * from the repo root). This test re-walks the live app the same way and
 * compares:
 *   1. operation count,
 *   2. the exact METHOD+path set (missing / extra operations are printed),
 *   3. auth marking (a route the app guards with JWT must carry bearerAuth
 *      security in the spec, and vice versa),
 *   4. info.version matches backend/package.json.
 *
 * If this fails after a route change, rerun the generator and commit the
 * refreshed openapi.json.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { collectRoutes, toOpenApiPath } from '../../scripts/lib/route-walker.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SPEC_PATH = resolve(__dirname, '../../../openapi.json');
const PKG_PATH  = resolve(__dirname, '../../package.json');

let routes;   // [{ method, path, auth, staff, middleware }]
let spec;

beforeAll(async () => {
  routes = await collectRoutes();
  spec   = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
});

function specOps() {
  const ops = new Map();   // "METHOD /path" → op object
  for (const [p, methods] of Object.entries(spec.paths)) {
    for (const [m, op] of Object.entries(methods)) {
      if (typeof op === 'object' && op !== null && m !== 'parameters') {
        ops.set(`${m.toUpperCase()} ${p}`, op);
      }
    }
  }
  return ops;
}

describe('openapi.json matches the mounted routes', () => {
  test('operation count matches', () => {
    const ops = specOps();
    expect(routes.length).toBeGreaterThan(400);   // sanity: the walker saw the real app
    expect(ops.size).toBe(routes.length);
  });

  test('method+path sets are identical (regenerate the spec after route changes)', () => {
    const ops = specOps();
    const mounted = new Set(routes.map(r => `${r.method} ${toOpenApiPath(r.path)}`));
    const missingFromSpec = [...mounted].filter(k => !ops.has(k));
    const extraInSpec     = [...ops.keys()].filter(k => !mounted.has(k));
    if (missingFromSpec.length || extraInSpec.length) {
      console.error('Routes mounted but missing from openapi.json:', missingFromSpec);
      console.error('Operations in openapi.json but not mounted:', extraInSpec);
      console.error('Fix: node scripts/generate-openapi.mjs (from the repo root) and commit openapi.json');
    }
    expect(missingFromSpec).toEqual([]);
    expect(extraInSpec).toEqual([]);
  });

  test('JWT-guarded routes carry bearerAuth security in the spec (and public ones do not)', () => {
    const ops = specOps();
    const wrong = [];
    for (const r of routes) {
      const op = ops.get(`${r.method} ${toOpenApiPath(r.path)}`);
      if (!op) continue;   // caught by the set test above
      const specAuth = Array.isArray(op.security)
        && op.security.some(s => s && Object.prototype.hasOwnProperty.call(s, 'bearerAuth'));
      if (specAuth !== r.auth) wrong.push(`${r.method} ${r.path} (app auth=${r.auth}, spec bearerAuth=${specAuth})`);
    }
    if (wrong.length) console.error('Auth marking drift:', wrong.slice(0, 20));
    expect(wrong).toEqual([]);
  });

  test('spec version matches backend/package.json', () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
    expect(spec.info.version).toBe(pkg.version);
  });
});
