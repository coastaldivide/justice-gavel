/**
 * version_alignment.test.js — one version number everywhere.
 *
 * root / backend / frontend package.json, frontend/app.json, the iOS
 * buildNumber / Android versionCode (scheme: "8.7.60" → 8760), the web
 * service-worker cache name, the README and the backend's runtime version
 * (utils/version.js → /health, X-API-Version) must all agree.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { APP_VERSION } from '../utils/version.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(__dirname, '../../..');
const json = (p) => JSON.parse(readFileSync(resolve(REPO, p), 'utf8'));
const text = (p) => readFileSync(resolve(REPO, p), 'utf8');

const VERSION = json('backend/package.json').version;

describe('version alignment', () => {
  test('backend version is a plain semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('runtime version (/health, X-API-Version) comes from backend/package.json', () => {
    expect(APP_VERSION).toBe(VERSION);
    const code = text('backend/src/utils/version.js')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/['"]\d+\.\d+\.\d+['"]/);   // no hard-coded fallback
  });

  test('root and frontend package.json + app.json match', () => {
    expect(json('package.json').version).toBe(VERSION);
    expect(json('frontend/package.json').version).toBe(VERSION);
    expect(json('frontend/app.json').expo.version).toBe(VERSION);
  });

  test('iOS buildNumber and Android versionCode follow the version scheme', () => {
    const build = Number(VERSION.split('.').join(''));
    const { expo } = json('frontend/app.json');
    expect(String(expo.ios.buildNumber)).toBe(String(build));
    expect(expo.android.versionCode).toBe(build);
  });

  test('web service-worker cache name and README carry the same version', () => {
    expect(text('frontend/public/sw.js')).toContain(`justice-gavel-v${VERSION}`);
    const readme = text('README.md');
    expect(readme).toContain(VERSION);
    const others = [...readme.matchAll(/\bv?(\d+\.\d+\.\d+)\b/g)].map(m => m[1])
      .filter(v => /^8\./.test(v) && v !== VERSION);
    expect(others).toEqual([]);
  });
});
