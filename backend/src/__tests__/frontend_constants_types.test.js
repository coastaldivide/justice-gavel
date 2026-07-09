/**
 * frontend_constants_types.test.js
 * Tests all constants files, type definitions, theme config,
 * and crisis resources for completeness and correctness.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname   = fileURLToPath(new URL('.', import.meta.url));
const FE_SRC      = resolve(__dirname, '../../../frontend/src');
const CONST_DIR   = join(FE_SRC, 'constants');
const TYPES_DIR   = join(FE_SRC, 'types');

describe('Constants — theme.ts', () => {
  const THEME = join(CONST_DIR, 'theme.ts');
  test('theme.ts exists', () => expect(existsSync(THEME)).toBe(true));
  test('defines light and dark color schemes', () => {
    const c = readFileSync(THEME, 'utf-8');
    expect(c).toMatch(/light|Light/);
    expect(c).toMatch(/dark|Dark/);
  });
  test('defines primary brand color (navy)', () => {
    const c = readFileSync(THEME, 'utf-8');
    expect(c).toMatch(/#042C53|navy|primary/i);
  });
  test('defines accent color (gold)', () => {
    const c = readFileSync(THEME, 'utf-8');
    expect(c).toMatch(/#C4902A|gold|accent/i);
  });
  test('exports a theme object or function', () => {
    const c = readFileSync(THEME, 'utf-8');
    expect(c).toMatch(/export/);
  });
});

describe('Constants — crisisResources.ts', () => {
  const CR = join(CONST_DIR, 'crisisResources.ts');
  test('crisisResources.ts exists', () => expect(existsSync(CR)).toBe(true));
  test('contains 988 (mental health crisis line)', () => {
    const c = readFileSync(CR, 'utf-8');
    expect(c).toMatch(/988/);
  });
  test('contains domestic violence hotline (1-800-799-7233)', () => {
    const c = readFileSync(CR, 'utf-8');
    expect(c).toMatch(/1.800.799.7233|1-800-799-SAFE|NDVH|domestic/i);
  });
  test('contains legal aid or public defender reference', () => {
    const c = readFileSync(CR, 'utf-8');
    expect(c).toMatch(/legal.aid|public.defender|attorney/i);
  });
  test('no broken phone numbers (all 10+ digits)', () => {
    const c  = readFileSync(CR, 'utf-8');
    const phones = c.match(/\b\d[\d\-.()\s]{8,}\d\b/g) || [];
    for (const phone of phones) {
      const digits = phone.replace(/\D/g,'');
      expect(digits.length).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('Constants — disclaimerVersion.ts', () => {
  const DV = join(CONST_DIR, 'disclaimerVersion.ts');
  test('disclaimerVersion.ts exists', () => expect(existsSync(DV)).toBe(true));
  test('defines a version number for the UPL disclaimer', () => {
    const c = readFileSync(DV, 'utf-8');
    expect(c).toMatch(/version|\d+\.\d+|\bv\d/i);
  });
  test('disclaimer version is a string or number', () => {
    const c = readFileSync(DV, 'utf-8');
    expect(c).toMatch(/:\s*['"`]?\d|=\s*['"`]?\d/);
  });
});

describe('Types — TypeScript type definitions', () => {
  test('types directory exists', () => expect(existsSync(TYPES_DIR)).toBe(true));
  test('at least one type file exists', () => {
    const typeFiles = readdirSync(TYPES_DIR).filter(f => f.endsWith('.ts'));
    expect(typeFiles.length).toBeGreaterThan(0);
  });
  test('type files have exports', () => {
    for (const fname of readdirSync(TYPES_DIR).filter(f => f.endsWith('.ts'))) {
      const c = readFileSync(join(TYPES_DIR, fname), 'utf-8');
      expect(c).toMatch(/export\s+(?:type|interface|const|enum)/);
    }
  });
  test('navigation types are defined', () => {
    const typeFiles = readdirSync(TYPES_DIR);
    const navTypes  = typeFiles.find(f => f.includes('nav') || f.includes('Nav'));
    if (!navTypes) {
      // May be inline in AppNavigator.tsx — check there
      const nav = readFileSync(join(FE_SRC, 'navigation/AppNavigator.tsx'), 'utf-8');
      expect(nav).toMatch(/RootStackParamList|ParamList|NavigatorParams/i);
    } else {
      const c = readFileSync(join(TYPES_DIR, navTypes), 'utf-8');
      expect(c).toMatch(/ParamList|Screen|Navigator/i);
    }
  });
});
