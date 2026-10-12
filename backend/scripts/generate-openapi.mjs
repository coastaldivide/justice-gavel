#!/usr/bin/env node
/**
 * generate-openapi.mjs — regenerate /openapi.json from the routes the app
 * actually mounts.
 *
 * Usage (from backend/):   node scripts/generate-openapi.mjs
 * Or from the repo root:   node scripts/generate-openapi.mjs   (thin wrapper)
 *
 * Boots src/app.js in test mode (no server listens, no DB required), walks
 * the mounted Express router tree (scripts/lib/route-walker.mjs) and emits
 * an OpenAPI 3.0.3 document:
 *   - every mounted method+path, with path params
 *   - security: bearerAuth on JWT-guarded routes, adminKey (X-Admin-Key) on
 *     admin-key routes, [] on public ones
 *   - x-staff-only on routes that also require a staff/admin account
 *   - 451 + x-requires-ai / 503 on routes guarded by requireDisclaimer / requireAi
 *   - x-payments-gated + 503 on operations that return payments_unavailable
 *     until Stripe keys are set
 *
 * src/__tests__/openapi_drift.test.js fails whenever the spec on disk and
 * the mounted routes drift apart — rerun this script after changing routes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { collectRoutes, toOpenApiPath } from './lib/route-walker.mjs';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const require   = createRequire(import.meta.url);
const VERSION   = require('../package.json').version;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT       = path.resolve(__dirname, '../../openapi.json');

const TAG_NAMES = (p) => {
  const seg = p.replace(/^\/api\//, '/').split('/').filter(Boolean)[0] || 'ops';
  return [seg.replace(/\{.*/, '') || 'ops'];
};

// Mirrors the payments gates in routes/billing/index.js, routes/pay.js and
// routes/consultations.js (POST /book): which operations answer
// 503 payments_unavailable while no Stripe key is configured.
const BILLING_NO_STRIPE = [/^\/bondsman\/profile\/?$/, /^\/pi-lead\/submit\/?$/, /^\/webhook\/?$/];
function isPaymentsGated(method, p) {
  if (method === 'GET') return false;
  if (p.startsWith('/api/billing/')) {
    return !BILLING_NO_STRIPE.some(re => re.test(p.slice('/api/billing'.length)));
  }
  if (p.startsWith('/api/pay/')) return method === 'POST';
  return method === 'POST' && p === '/api/consultations/book';
}

const routes = await collectRoutes();

const paths = {};
for (const r of routes) {
  const oaPath = toOpenApiPath(r.path);
  paths[oaPath] = paths[oaPath] || {};
  const params = [...oaPath.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => ({
    name: m[1], in: 'path', required: true, schema: { type: 'string' },
  }));
  const adminKeyOnly = !r.auth && r.middleware.includes('requireAdmin');
  const security = r.auth ? [{ bearerAuth: [] }]
    : adminKeyOnly ? [{ adminKey: [] }]
    : [];
  const op = {
    operationId: `${r.method.toLowerCase()}_${oaPath.replace(/[/{}]+/g, '_').replace(/^_+|_+$/g, '') || 'root'}`,
    summary: `${r.method} ${oaPath}`,
    tags: TAG_NAMES(oaPath),
    security,
    'x-auth': r.auth ? 'bearer' : adminKeyOnly ? 'admin-key' : 'public',
    responses: {
      200: { $ref: '#/components/responses/Success' },
      400: { $ref: '#/components/responses/BadRequest' },
      ...(security.length ? { 401: { $ref: '#/components/responses/Unauthorized' } } : {}),
      429: { $ref: '#/components/responses/RateLimited' },
      500: { $ref: '#/components/responses/ServerError' },
    },
  };
  if (r.staff) op['x-staff-only'] = true;
  const needsDisclaimer = r.middleware.includes('requireDisclaimer');
  const needsAi = r.middleware.includes('requireAi');
  const paymentsGated = isPaymentsGated(r.method, r.path);
  if (needsDisclaimer) op.responses[451] = { $ref: '#/components/responses/DisclaimerRequired' };
  if (needsAi || paymentsGated) op.responses[503] = { $ref: '#/components/responses/Unavailable' };
  if (needsAi) op['x-requires-ai'] = true;
  if (paymentsGated) op['x-payments-gated'] = true;
  if (params.length) op.parameters = params;
  if (['POST', 'PUT', 'PATCH'].includes(r.method)) {
    op.requestBody = { $ref: '#/components/requestBodies/Json' };
  }
  paths[oaPath][r.method.toLowerCase()] = op;
}

const sortedPaths = Object.fromEntries(
  Object.keys(paths).sort().map(k => [
    k,
    Object.fromEntries(Object.entries(paths[k]).sort(([a], [b]) => a.localeCompare(b))),
  ]),
);

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Justice Gavel API',
    version: VERSION,
    description:
      'Generated from the mounted Express routes by backend/scripts/generate-openapi.mjs. '
      + 'Do not edit by hand — rerun the generator after route changes '
      + '(src/__tests__/openapi_drift.test.js fails on drift). '
      + 'Auth: most routes need `Authorization: Bearer <JWT>` from POST /api/auth/login; '
      + 'routes marked x-auth=admin-key need the X-Admin-Key header; x-auth=public routes need neither. '
      + 'Billing endpoints return 503 payments_unavailable until Stripe keys are configured; '
      + 'AI endpoints return 503 ai_unavailable without ANTHROPIC_API_KEY. '
      + 'See API_REFERENCE.md for the human-readable overview.',
  },
  servers: [
    { url: 'https://api.justicegavel.app', description: 'Production' },
    { url: 'http://localhost:4000', description: 'Local development' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      adminKey:   { type: 'apiKey', in: 'header', name: 'X-Admin-Key' },
    },
    responses: {
      Success:      { description: 'Success' },
      BadRequest:   { description: 'Bad request / validation error ({ error, errors?: [{ field, message, code }] })' },
      DisclaimerRequired: { description: 'Legal disclaimer not accepted ({ error, code: "disclaimer_required", version, text }) — accept via POST /api/auth/disclaimer/accept' },
      Unavailable:  { description: 'Feature not configured: { error: "payments_unavailable" } (no Stripe key) or { error: "ai_unavailable" } (no Anthropic key)' },
      Unauthorized: { description: 'Missing or invalid credentials' },
      RateLimited:  { description: 'Rate limited (Retry-After header set)' },
      ServerError:  { description: 'Internal server error ({ error })' },
    },
    requestBodies: {
      Json: {
        description: 'JSON body — validated in the route; a 400 lists the offending fields in `errors`.',
        required: false,
        content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
      },
    },
  },
  paths: sortedPaths,
};

fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');

const opCount = routes.length;
const pathCount = Object.keys(sortedPaths).length;
const authCount = routes.filter(r => r.auth).length;
console.log(`openapi.json written: ${pathCount} paths, ${opCount} operations `
  + `(${authCount} bearer-auth, ${routes.filter(r => !r.auth).length} public/admin-key), `
  + `info.version ${VERSION}`);
process.exit(0);
