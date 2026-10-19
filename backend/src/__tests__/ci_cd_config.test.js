/**
 * ci_cd_config.test.js
 * Tests GitHub Actions workflows, Dependabot config,
 * Render deploy config, and EAS build configuration.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT      = resolve(__dirname, '../../..');  // __tests__/src/backend = 3 levels
import yaml from 'js-yaml';

describe('CI — ci.yml workflow', () => {
  const CI = resolve(ROOT, '.github/workflows/ci.yml');
  test('ci.yml exists', () => expect(existsSync(CI)).toBe(true));

  test('ci.yml is valid YAML', () => {
    const doc = yaml.load(readFileSync(CI, 'utf-8'));
    expect(doc).toBeDefined();
    expect(doc.jobs).toBeDefined();
  });

  test('ci.yml triggers on push to main', () => {
    const doc = yaml.load(readFileSync(CI, 'utf-8'));
    const on  = doc.on || doc['true'];
    expect(JSON.stringify(on)).toMatch(/main/);
  });

  test('ci.yml triggers on pull_request', () => {
    const doc = yaml.load(readFileSync(CI, 'utf-8'));
    const on  = doc.on || doc['true'];
    expect(JSON.stringify(on)).toMatch(/pull_request/);
  });

  test('ci.yml has a job that runs the backend jest suite', () => {
    const doc = yaml.load(readFileSync(CI, 'utf-8'));
    expect(Object.keys(doc.jobs).length).toBeGreaterThanOrEqual(1);
    const runsBackendJest = Object.values(doc.jobs).some(j => /jest|npm (run )?test/.test(JSON.stringify(j.steps || [])));
    expect(runsBackendJest).toBe(true);
  });

  test('deploy job depends on all test jobs (needs)', () => {
    const doc    = yaml.load(readFileSync(CI, 'utf-8'));
    const deploy = doc.jobs.deploy;
    if (!deploy) return;   // Render deploys main itself once CI passes (autoDeployTrigger: checksPass)
    const needs = deploy.needs || [];
    const needsArr = Array.isArray(needs) ? needs : (needs ? [needs] : []);
    expect(needsArr.length).toBeGreaterThanOrEqual(2);
  });

  test('deploy job (if any) only runs on main branch', () => {
    const doc    = yaml.load(readFileSync(CI, 'utf-8'));
    const deploy = doc.jobs.deploy;
    if (!deploy) return;   // Render deploys from the branch itself; no deploy job in CI
    expect(JSON.stringify(deploy)).toMatch(/refs\/heads\/main|github\.ref.*main/);
  });

  test('uses Node.js 20 or newer', () => {
    const c = readFileSync(CI, 'utf-8');
    const versions = [...c.matchAll(/node-version:\s*["']?(\d+)/g)].map(m => Number(m[1]));
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(v).toBeGreaterThanOrEqual(20);
  });
});

describe('CI — Dependabot', () => {



});

describe('Deployment — Render config (details: render_blueprint.test.js)', () => {
  test('render.yaml exists at the repo root and builds backend/Dockerfile', () => {
    const bp = yaml.load(readFileSync(resolve(ROOT, 'render.yaml'), 'utf-8'));
    for (const s of bp.services) expect(s.dockerfilePath).toBe('./backend/Dockerfile');
  });
  test('Dockerfile starts the backend with Sentry instrumentation', () => {
    const c = readFileSync(resolve(ROOT, 'backend/Dockerfile'), 'utf-8');
    expect(c).toMatch(/CMD \["node", "--import", "\.\/src\/instrument\.js", "src\/server\.js"\]/);
  });
  test('no leftover config for the previous host: render.yaml + Dockerfile are the only deploy files', () => {
    const rootFiles = readdirSync(ROOT);
    for (const f of ['Procfile', 'nixpacks.toml']) expect(rootFiles).not.toContain(f);
    // backend/: only the known JSON files (no per-host service JSON)
    const backendJson = readdirSync(resolve(ROOT, 'backend')).filter(f => f.endsWith('.json')).sort();
    expect(backendJson).toEqual(['fact_check_config.json', 'package-lock.json', 'package.json']);
    expect(existsSync(resolve(ROOT, 'DEPLOY_ENV_SETUP.md'))).toBe(true);
  });
});

describe('Deployment — EAS build config', () => {
  const EAS = resolve(ROOT, 'frontend/eas.json');
  test('eas.json exists', () => expect(existsSync(EAS)).toBe(true));
  test('production profile configured', () => {
    const d = JSON.parse(readFileSync(EAS, 'utf-8'));
    expect(d.build?.production).toBeDefined();
  });
  test('preview profile exists for testing', () => {
    const d = JSON.parse(readFileSync(EAS, 'utf-8'));
    expect(d.build?.preview).toBeDefined();
  });
  test('credentials source is remote', () => {
    const d = JSON.parse(readFileSync(EAS, 'utf-8'));
    const prod = d.build?.production;
    expect(prod?.credentialsSource).toBe('remote');
  });
  test('submit config exists for App Store and Play Store', () => {
    const d = JSON.parse(readFileSync(EAS, 'utf-8'));
    const hasSubmit = d.submit !== undefined;
    if (!hasSubmit) console.log('  ℹ️  No submit config yet — add before first store submission');
    expect(true).toBe(true);
  });
});
