/**
 * app_env.test.js — checklist item 46: configuration supports a staging
 * deployment cleanly (NODE_ENV=production + APP_ENV=staging) and refuses the
 * dangerous mixes. Before: the only staging config (the old host's staging
 * service file) set NODE_ENV=staging — which silently turned OFF production hardening (secrets
 * not required, dev CORS, stack traces in errors) — and a 15-minute JWT the
 * mobile app cannot refresh.
 */
import fs from 'fs';
import yaml from 'js-yaml';
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

  test('render.yaml staging: NODE_ENV=production + APP_ENV=staging, own DB, no short JWT lifetime', () => {
    const bp = yaml.load(fs.readFileSync(`${REPO}/render.yaml`, 'utf8'));
    const staging = bp.services.find(s => s.name.endsWith('-staging'));
    const env = Object.fromEntries(staging.envVars.map(e => [e.key, e]));
    expect(env.NODE_ENV.value).toBe('production');
    expect(env.APP_ENV.value).toBe('staging');
    expect(env.DATABASE_URL).toEqual({ key: 'DATABASE_URL', sync: false });
    expect(env.JWT_EXPIRES_IN).toBeUndefined();
    expect(staging.healthCheckPath).toBe('/health');
    // and the env it declares passes the boot check
    const plain = Object.fromEntries(staging.envVars.filter(e => 'value' in e).map(e => [e.key, e.value]));
    expect(checkAppEnv({ ...plain, DATABASE_URL: 'postgres://staging' }).errors).toEqual([]);
  });
});
