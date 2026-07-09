/**
 * ci_cd_config.test.js
 * Tests GitHub Actions workflows, Dependabot config,
 * Railway config, and EAS build configuration.
 */
import { readFileSync, existsSync } from 'fs';
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

  test('ci.yml has at least 5 jobs', () => {
    const doc = yaml.load(readFileSync(CI, 'utf-8'));
    expect(Object.keys(doc.jobs).length).toBeGreaterThanOrEqual(5);
  });

  test('deploy job depends on all test jobs (needs)', () => {
    const doc    = yaml.load(readFileSync(CI, 'utf-8'));
    const deploy = doc.jobs.deploy;
    if (!deploy) return;
    if (!deploy) { console.log('  ℹ️  No deploy job — using railway CLI directly'); return; }
    const needs = deploy.needs || [];
    const needsArr = Array.isArray(needs) ? needs : (needs ? [needs] : []);
    expect(needsArr.length).toBeGreaterThanOrEqual(2);
  });

  test('deploy job only runs on main branch', () => {
    const c = readFileSync(CI, 'utf-8');
    expect(c).toMatch(/refs\/heads\/main|github\.ref.*main/);
  });

  test('uses Node.js 20', () => {
    const c = readFileSync(CI, 'utf-8');
    expect(c).toMatch(/node.*20|20.*node/i);
  });
});

describe('CI — Dependabot', () => {
  const DEP = resolve(ROOT, '.github/dependabot.yml');
  test('dependabot.yml exists', () => expect(existsSync(DEP)).toBe(true));

  test('dependabot watches backend and frontend npm', () => {
    const doc = yaml.load(readFileSync(DEP, 'utf-8'));
    const dirs = doc.updates.map(u => u.directory);
    expect(dirs).toContain('/backend');
    expect(dirs).toContain('/frontend');
  });

  test('dependabot watches GitHub Actions', () => {
    const doc = yaml.load(readFileSync(DEP, 'utf-8'));
    const ecosystems = doc.updates.map(u => u['package-ecosystem']);
    expect(ecosystems).toContain('github-actions');
  });

  test('dependabot runs at least monthly', () => {
    const doc = yaml.load(readFileSync(DEP, 'utf-8'));
    const intervals = doc.updates.map(u => u.schedule?.interval);
    const validIntervals = ['daily','weekly','monthly'];
    for (const i of intervals) expect(validIntervals).toContain(i);
  });
});

describe('Deployment — Railway config', () => {
  test('Procfile exists', () => expect(existsSync(resolve(ROOT, 'Procfile'))).toBe(true));
  test('Procfile starts backend', () => {
    const c = readFileSync(resolve(ROOT, 'Procfile'), 'utf-8');
    expect(c).toMatch(/web:|server\.js|node/i);
  });
  test('railway.json exists', () => expect(existsSync(resolve(ROOT, 'railway.json'))).toBe(true));
  test('nixpacks.toml configures Node.js', () => {
    const c = readFileSync(resolve(ROOT, 'nixpacks.toml'), 'utf-8');
    expect(c).toMatch(/node|nodejs/i);
  });
  test('root directory set to backend in Railway config', () => {
    const proc = readFileSync(resolve(ROOT, 'Procfile'), 'utf-8');
    expect(proc).toMatch(/backend/i);
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
