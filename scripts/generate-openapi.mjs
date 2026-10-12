#!/usr/bin/env node
/**
 * scripts/generate-openapi.mjs — regenerate /openapi.json from the real app.
 *
 * Thin wrapper: the actual generator lives in backend/scripts/generate-openapi.mjs
 * (it must run with backend/ as cwd so `express` and src/app.js resolve against
 * backend/node_modules). Run either:
 *
 *   node scripts/generate-openapi.mjs            # from the repo root
 *   cd backend && node scripts/generate-openapi.mjs
 *
 * backend/src/__tests__/openapi_drift.test.js fails whenever openapi.json and
 * the mounted routes drift — rerun this script after changing routes.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = spawnSync(
  process.execPath,
  [path.join(root, 'backend', 'scripts', 'generate-openapi.mjs')],
  { cwd: path.join(root, 'backend'), stdio: 'inherit' },
);
process.exit(res.status ?? 1);
