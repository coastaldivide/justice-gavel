/**
 * version.js — the ONE place the backend learns its own version.
 *
 * Reads backend/package.json once at startup so /health, /metrics, the
 * X-API-Version header, structured logs, Sentry releases and alert emails
 * all report the real installed version. No hard-coded fallback strings —
 * those go stale (the old '8.7.50' fallback survived nine releases).
 *
 * process.env.npm_package_version only exists when the process is started
 * through npm, so it cannot be relied on under `node src/server.js`,
 * Docker or Railway. Reading package.json works everywhere.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The backend's version string, e.g. "8.7.60" (from backend/package.json). */
export const APP_VERSION = require('../../package.json').version;

export default APP_VERSION;
