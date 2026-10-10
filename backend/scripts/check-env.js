#!/usr/bin/env node
/**
 * scripts/check-env.js — Validates the production environment before a deploy
 * Run before every production deploy: node scripts/check-env.js
 *
 * Required = what the server itself refuses to start without in production
 * (config.js REQUIRED_IN_PROD) plus NODE_ENV. Everything else is optional: a
 * missing optional variable only disables one feature (e.g. no Stripe key →
 * billing answers 503 payments_unavailable), so it is reported, not failed.
 */

const REQUIRED = ['NODE_ENV', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL'];

const OPTIONAL = [
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'SENTRY_DSN',
  'SUPABASE_URL',
];

// Each check returns an error string, or null when the value is acceptable.
// (JWT_SECRET used to be listed twice in this object, so the length check was
// silently overwritten by the second entry and never ran.)
const SECURITY_CHECKS = {
  JWT_SECRET: (v) => {
    if (v === 'dev_secret_change_me') return 'JWT_SECRET is still the development default — CRITICAL';
    return v.length >= 32 ? null : 'JWT_SECRET must be ≥32 characters';
  },
  JWT_REFRESH_SECRET: (v) => (v.length >= 32 ? null : 'JWT_REFRESH_SECRET must be ≥32 characters'),
  ENCRYPTION_KEY:     (v) => (/^[0-9a-fA-F]{64}$/.test(v) ? null : 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  NODE_ENV:           (v) => (v === 'production' ? null : `NODE_ENV is '${v}' — set to 'production' for live deploy`),
};

let failed = 0;

for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌ MISSING: ${key}`);
    failed++;
  } else {
    const check = SECURITY_CHECKS[key];
    const err = check ? check(process.env[key]) : null;
    if (err) { console.error(`⚠️  ${key}: ${err}`); failed++; }
    else { console.log(`✅ ${key}`); }
  }
}

for (const key of OPTIONAL) {
  const present = key === 'STRIPE_SECRET_KEY' ? !!(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET) : !!process.env[key];
  console.log(present ? `✅ ${key}` : `ℹ️  ${key} not set — that feature is disabled`);
}

if (failed > 0) {
  console.error(`\n${failed} env var(s) missing or insecure. Fix before deploying.`);
  process.exit(1);
} else {
  console.log('\n✅ All required environment variables are set and secure.');
}
