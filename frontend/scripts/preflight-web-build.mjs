#!/usr/bin/env node
/**
 * preflight-web-build.mjs
 *
 * Runs before `expo export --platform web`. Refuses to build if the bundle
 * would ship pointing somewhere useless.
 *
 * Why this exists
 * ───────────────
 * EXPO_PUBLIC_* variables are inlined into the bundle at BUILD time, not read
 * at runtime. Expo loads them from `frontend/.env`, which is gitignored — so
 * whatever happens to be on the build machine gets compiled in permanently.
 *
 * This repo shipped with a local `.env` containing
 * EXPO_PUBLIC_API_BASE=http://127.0.0.1:4500/api. A web build made from it
 * produced a bundle with the loopback address baked into every request path.
 * The app installed fine and failed every call.
 *
 * Note that EAS native builds are NOT affected — eas.json sets the value
 * explicitly for the preview and production profiles. This guard covers the
 * web export path, which does not read eas.json.
 *
 * Bypass for a deliberate local build:  ALLOW_LOCAL_API_BASE=1 npm run build:web
 */

const RED   = '\x1b[31m';
const YEL   = '\x1b[33m';
const GRN   = '\x1b[32m';
const RESET = '\x1b[0m';

const fail = (msg, hint) => {
  console.error(`\n${RED}✗ web build blocked${RESET}  ${msg}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
};

const base = process.env.EXPO_PUBLIC_API_BASE;

if (!base) {
  fail(
    'EXPO_PUBLIC_API_BASE is not set.',
    `  Set it to the deployed API before building — it is compiled into the
  bundle and cannot be changed afterward:

    EXPO_PUBLIC_API_BASE=https://your-api.onrender.com/api npm run build:web

  Or put it in frontend/.env (gitignored, per-machine).`,
  );
}

let url;
try {
  url = new URL(base);
} catch {
  fail(`EXPO_PUBLIC_API_BASE is not a valid URL: ${base}`);
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
const isLocal =
  LOCAL_HOSTS.includes(url.hostname) ||
  url.hostname.endsWith('.local') ||
  /^10\./.test(url.hostname) ||
  /^192\.168\./.test(url.hostname);

if (isLocal && process.env.ALLOW_LOCAL_API_BASE !== '1') {
  fail(
    `EXPO_PUBLIC_API_BASE points at a local address: ${base}`,
    `  This address is baked into the bundle. Shipped to users, every request
  fails — the app looks broken with no error to diagnose.

  Building for a device on your LAN on purpose?
    ALLOW_LOCAL_API_BASE=1 npm run build:web`,
  );
}

if (url.protocol !== 'https:' && !isLocal) {
  fail(
    `EXPO_PUBLIC_API_BASE must use https in a web build: ${base}`,
    '  Browsers block plaintext requests from an https-hosted page.',
  );
}

// Stripe: a test publishable key in a production build takes real card details
// and silently routes them to test mode. No charge is created and no error is
// raised, so it surfaces as "we have signups but no revenue".
const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
if (stripeKey?.startsWith('pk_test_') && process.env.ALLOW_TEST_STRIPE_KEY !== '1') {
  fail(
    'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is a test key (pk_test_…).',
    `  Use the pk_live_ key for a build that will take real payments.

  Building a staging bundle on purpose?
    ALLOW_TEST_STRIPE_KEY=1 npm run build:web`,
  );
}

if (!stripeKey) {
  console.warn(`${YEL}⚠ EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set — payment screens will not load.${RESET}`);
}

console.log(`${GRN}✓ preflight passed${RESET}  API base: ${base}`);

// EXPO_PUBLIC_* values are inlined by Metro at TRANSFORM time and the result is
// cached in os.tmpdir()/metro-cache — keyed on file content, not on the env that
// produced it. Change the API base without clearing that cache and Metro happily
// reuses modules carrying the OLD value, so the build "succeeds" and ships the
// previous address. Observed here: after switching to a production base, one
// analytics beacon still pointed at http://127.0.0.1:4500 through two clean
// rebuilds. Clearing `dist`, `.expo` and `node_modules/.cache` does NOT clear it.
//
// Verify after any build that changes the API base:
//   grep -r '127.0.0.1\|localhost' dist/_expo/static/js/web/*.js
console.log(`  If you changed the API base since the last build, clear the Metro cache first:
    rm -rf "\${TMPDIR:-/tmp}"/metro-cache "\${TMPDIR:-/tmp}"/metro-file-map-*
  Metro caches transformed modules with the old value baked in.`);

