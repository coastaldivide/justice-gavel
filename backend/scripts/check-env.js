#!/usr/bin/env node
/**
 * scripts/check-env.js — check a deployment's environment before (or after) a deploy.
 *
 *   node scripts/check-env.js            required keys + which features are on; fails on
 *                                        missing/insecure required keys, half-configured
 *                                        features, a live Stripe key on staging, malformed keys,
 *                                        STAGING_TEST_KEY in production; on staging prints the
 *                                        outbound allow-list sizes (docs/STAGING.md)
 *   node scripts/check-env.js --launch   also fails when a feature the public launch needs is off
 *
 * Never prints a secret value. Logic: scripts/lib/envReport.mjs (tested).
 */
import { envReport } from './lib/envReport.mjs';

const launch = process.argv.includes('--launch');
const r = envReport(process.env, { launch });
console.log(`Environment: ${r.appEnv}${launch ? ' (launch check)' : ''}\n`);
for (const f of r.features) console.log(`${f.on ? '✅' : '⬜'} ${f.label}${f.on ? '' : ` — off (needs ${f.missing.join(', ')})`}`);
if (r.staging) {
  console.log(`\nStaging guard: texts only to ${r.staging.allowedPhones} allowed number(s), e-mail only to ${r.staging.allowedEmails} allowed address(es)/domain(s); test-client key ${r.staging.testKey ? 'set' : 'not set'}`);
}
if (r.warnings.length) { console.log(''); for (const w of r.warnings) console.log(`⚠️  ${w}`); }
if (r.errors.length) {
  console.error('');
  for (const e of r.errors) console.error(`❌ ${e}`);
  console.error(`\n${r.errors.length} problem(s). Fix before deploying.`);
  process.exit(1);
}
console.log('\n✅ Environment OK.');
