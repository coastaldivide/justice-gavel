/**
 * app_env.test.js — checklist item 46: configuration supports a staging
 * deployment cleanly (NODE_ENV=production + APP_ENV=staging) and refuses the
 * dangerous mixes. Before: the only staging config (railway.staging.json) set
 * NODE_ENV=staging — which silently turned OFF production hardening (secrets
 * not required, dev CORS, stack traces in errors) — and a 15-minute JWT the
 * mobile app cannot refresh.
 */
import fs from 'fs';
import { checkAppEnv, APP_ENVS } from '../config.js';

const REPO = decodeURIComponent(new URL('../../../', import.meta.url).pathname);

describe('APP_ENV', () => {
  test('defaults follow NODE_ENV', () => {
    expect(checkAppEnv({ NODE_ENV: 'production' }).appEnv).toBe('production');
    expect(checkAppEnv({ NODE_ENV: 'test' }).appEnv).toBe('test');
    expect(checkAppEnv({}).appEnv).toBe('development');
    expect(APP_ENVS).toContain('staging');
  });

  test('staging = production hardening + its own label; clean config has no errors', () => {
    const r = checkAppEnv({ NODE_ENV: 'production', APP_ENV: 'staging', STRIPE_SECRET_KEY: 'sk_test_abc123' });
    expect(r).toMatchObject({ appEnv: 'staging', errors: [], warnings: [] });
  });

  test('refuses NODE_ENV=staging, live Stripe keys on staging, the production DB on staging, unknown APP_ENV', () => {
    expect(checkAppEnv({ NODE_ENV: 'staging' }).errors.join()).toMatch(/NODE_ENV=staging is not supported/);
    expect(checkAppEnv({ NODE_ENV: 'production', APP_ENV: 'staging', STRIPE_SECRET_KEY: 'sk_live_xyz123' }).errors.join()).toMatch(/LIVE Stripe key/);
    expect(checkAppEnv({ NODE_ENV: 'production', APP_ENV: 'staging', DATABASE_URL: 'postgres://p', PRODUCTION_DATABASE_URL: 'postgres://p' }).errors.join())
      .toMatch(/never use the production database/);
    expect(checkAppEnv({ NODE_ENV: 'production', APP_ENV: 'qa' }).errors.join()).toMatch(/not one of/);
    expect(checkAppEnv({ NODE_ENV: 'development', APP_ENV: 'production' }).errors.join()).toMatch(/requires NODE_ENV=production/);
  });

  test('live keys are fine in production (payments stay off until they are set)', () => {
    expect(checkAppEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_xyz123' }).errors).toEqual([]);
  });

  test('railway.staging.json no longer sets NODE_ENV=staging or a short JWT lifetime', () => {
    const cfg = fs.readFileSync(`${REPO}/backend/railway.staging.json`, 'utf8');
    expect(cfg).not.toMatch(/"NODE_ENV"\s*:\s*"staging"/);
    expect(cfg).not.toMatch(/JWT_EXPIRES_IN/);
    expect(JSON.parse(cfg).deploy.healthcheckPath).toBe('/health');
  });
});
