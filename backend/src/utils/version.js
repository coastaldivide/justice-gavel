/**
 * version.js — the ONE place the backend learns its own version and build.
 *
 * Reads backend/package.json once at startup so /health, /metrics, the
 * X-API-Version header, structured logs, Sentry releases and alert emails
 * all report the real installed version. No hard-coded fallback strings —
 * those go stale (the old '8.7.50' fallback survived nine releases).
 *
 * process.env.npm_package_version only exists when the process is started
 * through npm, so it cannot be relied on under `node src/server.js` or in a
 * container. Reading package.json works everywhere.
 *
 * Build / host info comes from the platform when it provides it:
 *   - Render sets RENDER=true, RENDER_GIT_COMMIT (the deployed commit) and
 *     RENDER_INSTANCE_ID (one value per running instance);
 *   - anywhere else, GIT_COMMIT can be set by hand or by a build script.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The backend's version string, e.g. "8.7.60" (from backend/package.json). */
export const APP_VERSION = require('../../package.json').version;

/** Full commit SHA of the running build, or '' when the host does not say. */
export const GIT_COMMIT = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').trim();

/** Short (12-char) commit for logs and /health, or null. */
export const GIT_COMMIT_SHORT = GIT_COMMIT ? GIT_COMMIT.slice(0, 12) : null;

/** Hosting platform label: 'render' on Render, otherwise null. */
export const HOST_PLATFORM = process.env.RENDER === 'true' ? 'render' : null;

/** Instance id on multi-instance hosts (Render), otherwise null. */
export const INSTANCE_ID = process.env.RENDER_INSTANCE_ID || null;

/**
 * Default Sentry release: "justice-gavel@<version>" plus the commit as semver
 * build metadata when known ("justice-gavel@8.7.60+0123456789ab"), so every
 * deploy is its own release. SENTRY_RELEASE overrides it (instrument.js).
 */
export function defaultRelease(version = APP_VERSION, commit = GIT_COMMIT) {
  const c = String(commit || '').trim();
  return c ? `justice-gavel@${version}+${c.slice(0, 12)}` : `justice-gavel@${version}`;
}

export default APP_VERSION;
