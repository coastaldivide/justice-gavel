/**
 * render_blueprint.test.js — render.yaml (the Render Blueprint) is valid and
 * matches what the code and the image actually do.
 *
 * Render's own validator is not available offline, so the field names are
 * checked against the Blueprint spec fields this repo uses (an allow-list —
 * a typo such as `healthcheckPath` fails here instead of being silently
 * ignored by Render), and every value is cross-checked against the code:
 * the health route, the shutdown drain, the pre-deploy script being in the
 * image, the env vars the code reads, and secrets never being committed.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const bp = yaml.load(read('render.yaml'));
const services = bp.services || [];
const prod = services.find(s => s.name === 'justice-gavel-api');
const staging = services.find(s => s.name === 'justice-gavel-api-staging');
const envOf = (svc) => Object.fromEntries((svc.envVars || []).map(e => [e.key, e]));

// Blueprint spec fields (Render docs, verified Oct 2026) used by a Docker web service.
const SERVICE_FIELDS = new Set([
  'type', 'name', 'runtime', 'repo', 'branch', 'region', 'plan', 'rootDir',
  'dockerfilePath', 'dockerContext', 'dockerCommand', 'healthCheckPath',
  'autoDeployTrigger', 'preDeployCommand', 'numInstances', 'scaling',
  'maxShutdownDelaySeconds', 'envVars', 'disk', 'buildFilter', 'domains',
]);
const ENV_FIELDS = new Set(['key', 'value', 'sync', 'generateValue', 'fromService', 'fromDatabase', 'fromGroup']);
const REGIONS = new Set(['oregon', 'ohio', 'virginia', 'frankfurt', 'singapore']);
const TRIGGERS = new Set(['commit', 'checksPass', 'off']);
const SECRETS = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'ADMIN_KEY',
  'ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_KEY', 'RESEND_API_KEY', 'EXPO_ACCESS_TOKEN', 'GOOGLE_PLACES_KEY',
  'ALERT_WEBHOOK_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'MIGRATIONS_DATABASE_URL', 'STRIPE_CONNECT_WEBHOOK_SECRET'];

describe('render.yaml — Blueprint shape', () => {
  test('parses and declares exactly the production and staging web services', () => {
    expect(Object.keys(bp)).toEqual(['services']);
    expect(services.map(s => s.name).sort()).toEqual(['justice-gavel-api', 'justice-gavel-api-staging']);
  });

  test('only known Blueprint fields (catches typos Render would ignore)', () => {
    for (const s of services) {
      expect({ svc: s.name, unknown: Object.keys(s).filter(k => !SERVICE_FIELDS.has(k)) }).toEqual({ svc: s.name, unknown: [] });
      for (const e of s.envVars) {
        expect({ key: e.key, unknown: Object.keys(e).filter(k => !ENV_FIELDS.has(k)) }).toEqual({ key: e.key, unknown: [] });
      }
      if (s.buildFilter) expect(Object.keys(s.buildFilter).every(k => ['paths', 'ignoredPaths'].includes(k))).toBe(true);
    }
  });

  test.each(['justice-gavel-api', 'justice-gavel-api-staging'])('%s: Docker web service settings', (name) => {
    const s = services.find(x => x.name === name);
    expect(s.type).toBe('web');
    expect(s.runtime).toBe('docker');
    expect(REGIONS.has(s.region)).toBe(true);
    expect(typeof s.plan).toBe('string');
    expect(s.plan).not.toBe('free');                       // pre-deploy commands need a paid instance
    expect(TRIGGERS.has(s.autoDeployTrigger)).toBe(true);
    expect(s.autoDeployTrigger).toBe('checksPass');        // CI must pass before a deploy
    expect(Number.isInteger(s.numInstances) && s.numInstances >= 1).toBe(true);
    expect(s.maxShutdownDelaySeconds).toBeGreaterThanOrEqual(1);
    expect(s.maxShutdownDelaySeconds).toBeLessThanOrEqual(300);
    expect(s.dockerContext).toBe('.');
    expect(existsSync(resolve(ROOT, s.dockerfilePath))).toBe(true);
    expect(s.healthCheckPath).toBe('/health');
    if (s.disk) expect(s.numInstances).toBe(1);            // a disk pins the service to one instance
  });

  test('envVars: each has one source; no duplicates', () => {
    for (const s of services) {
      const keys = s.envVars.map(e => e.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const e of s.envVars) {
        const sources = ['value', 'sync', 'generateValue', 'fromService', 'fromDatabase', 'fromGroup'].filter(k => k in e);
        expect({ key: e.key, sources: sources.length }).toEqual({ key: e.key, sources: 1 });
        if ('sync' in e) expect(e.sync).toBe(false);
        if ('generateValue' in e) expect(e.generateValue).toBe(true);
        if ('value' in e) expect(typeof e.value).toBe('string');   // quoted: "1", "false", not YAML numbers/bools
      }
    }
  });
});

describe('render.yaml — matches the code and the image', () => {
  test('health check path is a real route', () => {
    expect(read('backend/src/app.js')).toMatch(/app\.get\(\['\/health', '\/api\/health'\]/);
  });

  test('maxShutdownDelaySeconds covers the server\'s forced-exit timer', () => {
    const m = read('backend/src/server.js').match(/process\.exit\(exitCode \|\| 1\);\s*\},\s*([\d_]+)\);/);
    expect(m).not.toBeNull();
    const forceMs = Number(m[1].replace(/_/g, ''));
    for (const s of services) expect(s.maxShutdownDelaySeconds * 1000).toBeGreaterThan(forceMs);
  });

  test('pre-deploy runs the migration runner, which the image contains with psql and the migrations', () => {
    for (const s of services) expect(s.preDeployCommand).toBe('sh /app/scripts/migrate.sh');
    expect(existsSync(resolve(ROOT, 'backend/scripts/migrate.sh'))).toBe(true);
    const docker = read('backend/Dockerfile');
    expect(docker).toMatch(/apk add --no-cache postgresql-client/);
    expect(docker).toMatch(/COPY --chown=nodejs:nodejs backend\/ \.\//);
    expect(docker).toMatch(/COPY --chown=nodejs:nodejs supabase\/migrations\/ \/supabase\/migrations\//);
    expect(docker).toMatch(/WORKDIR \/app/);
    const ignore = read('.dockerignore').split('\n').map(l => l.trim());
    const at = (line) => ignore.indexOf(line);
    expect(at('*')).toBeGreaterThanOrEqual(0);
    expect(at('!backend/')).toBeGreaterThan(at('*'));
    expect(at('!supabase/migrations/')).toBeGreaterThan(at('*'));
    // scripts/ is excluded, the runner re-included AFTER that exclusion (last match wins)
    expect(at('!backend/scripts/migrate.sh')).toBeGreaterThan(at('backend/scripts/'));
    for (const secret of ['backend/.env', 'backend/.env.*', 'backend/node_modules']) expect(ignore).toContain(secret);
  });

  test('the image listens where Render expects: $PORT (default 10000) on 0.0.0.0', () => {
    expect(read('backend/Dockerfile')).toMatch(/PORT=10000/);
    expect(read('backend/src/server.js')).toMatch(/app\.listen\(PORT, '0\.0\.0\.0'\)/);
  });

  test('every declared variable is one the code reads; the required ones are all there', async () => {
    const { ALL_ENV_VARS, REQUIRED_IN_PROD } = await import('../config.js');
    for (const s of services) {
      const env = envOf(s);
      expect({ svc: s.name, unknown: Object.keys(env).filter(k => !(k in ALL_ENV_VARS)) }).toEqual({ svc: s.name, unknown: [] });
      for (const k of REQUIRED_IN_PROD) expect({ svc: s.name, k, declared: k in env }).toEqual({ svc: s.name, k, declared: true });
    }
  });

  test('the Oct 27 features\' settings are declared, so a Blueprint deploy prompts for them (debug scan Oct 30, issue 10)', () => {
    for (const s of services) {
      const env = envOf(s);
      expect({ svc: s.name, connect: env.STRIPE_CONNECT_WEBHOOK_SECRET }).toEqual({ svc: s.name, connect: { key: 'STRIPE_CONNECT_WEBHOOK_SECRET', sync: false } });
      expect({ svc: s.name, voice: env.TELNYX_VOICE_NUMBER }).toEqual({ svc: s.name, voice: { key: 'TELNYX_VOICE_NUMBER', sync: false } });
      expect({ svc: s.name, voiceOn: env.TELNYX_VOICE_ENABLED?.value }).toEqual({ svc: s.name, voiceOn: 'false' });
    }
  });

  test('secrets are never committed: sync:false (or generated on staging only)', () => {
    for (const s of services) {
      for (const [k, e] of Object.entries(envOf(s))) {
        if (SECRETS.includes(k)) expect({ svc: s.name, k, committed: 'value' in e }).toEqual({ svc: s.name, k, committed: false });
      }
    }
    const p = envOf(prod);
    for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'ADMIN_KEY', 'DATABASE_URL']) {
      expect(p[k]).toEqual({ key: k, sync: false });   // production: existing values, never regenerated
    }
    const st = envOf(staging);
    expect(st.DATABASE_URL).toEqual({ key: 'DATABASE_URL', sync: false });
    for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY']) expect(st[k].generateValue).toBe(true);
  });

  test('plain values boot cleanly in production and staging', async () => {
    const { checkAppEnv } = await import('../config.js');
    const plain = (s) => Object.fromEntries(s.envVars.filter(e => 'value' in e).map(e => [e.key, e.value]));
    expect(checkAppEnv({ ...plain(prod), DATABASE_URL: 'postgres://prod' })).toMatchObject({ appEnv: 'production', errors: [] });
    expect(checkAppEnv({ ...plain(staging), DATABASE_URL: 'postgres://staging' })).toMatchObject({ appEnv: 'staging', errors: [] });
    expect(plain(prod).ATTACHMENTS_STORAGE).toBe('supabase');   // container disk is ephemeral
    expect(plain(prod).LIVE_REFRESH).toMatch(/^(true|false)$/);
  });

  test('TRUST_PROXY is a measured hop count / CIDR list, never "trust everything"', async () => {
    const { trustProxySetting } = await import('../app.js');
    for (const s of services) {
      const v = envOf(s).TRUST_PROXY?.value;
      expect(v).toBeDefined();
      expect(trustProxySetting(v)).not.toBe(true);
    }
  });

  test('Sentry DSN is configuration (render.yaml), not code', () => {
    const dsn = envOf(prod).SENTRY_DSN.value;
    expect(dsn).toMatch(/^https:\/\/[0-9a-f]+@o\d+\.ingest\.us\.sentry\.io\/\d+$/);
    expect(envOf(staging).SENTRY_DSN.value).toBe(dsn);
    for (const f of ['backend/src/instrument.js', 'backend/src/config.js', 'backend/src/app.js', 'backend/src/server.js']) {
      expect(read(f)).not.toContain(dsn);
    }
  });
});
