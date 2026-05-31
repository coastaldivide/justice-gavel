#!/usr/bin/env node
/**
 * scripts/check-env.js — Validates all required env vars are set
 * Run before every production deploy: node scripts/check-env.js
 */

const REQUIRED = [
  'NODE_ENV', 'JWT_SECRET', 'JWT_REFRESH_SECRET',
  'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'SENDGRID_API_KEY',
  'SENTRY_DSN',
];

const SECURITY_CHECKS = {
  JWT_SECRET: (v) => v.length >= 32 ? null : 'JWT_SECRET must be ≥32 characters',
  JWT_SECRET: (v) => v !== 'dev_secret_change_me' ? null : '⚠️  JWT_SECRET is still the development default — CRITICAL',
  NODE_ENV:   (v) => v === 'production' ? null : `NODE_ENV is '${v}' — set to 'production' for live deploy`,
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

if (failed > 0) {
  console.error(`\n${failed} env var(s) missing or insecure. Fix before deploying.`);
  process.exit(1);
} else {
  console.log('\n✅ All required environment variables are set and secure.');
}
