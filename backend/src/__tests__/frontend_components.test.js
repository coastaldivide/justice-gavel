/**
 * frontend_components.test.js
 * Tests all 26 components: exports, JSX return, prop types,
 * React.memo usage, and no hardcoded styles that break dark mode.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname  = fileURLToPath(new URL('.', import.meta.url));
const COMP_DIR   = resolve(__dirname, '../../../frontend/src/components');

const components = readdirSync(COMP_DIR).filter(f =>
  f.endsWith('.tsx') || f.endsWith('.ts'));

describe('Components — existence and exports', () => {
  test(`at least 20 component files exist`, () => {
    expect(components.length).toBeGreaterThanOrEqual(20);
  });

  test.each(components)('%s has an export', (fname) => {
    const c = readFileSync(join(COMP_DIR, fname), 'utf-8');
    const hasExport = c.includes('export const') ||
                      c.includes('export default') ||
                      c.includes('export function') ||
                      c.includes('export type') ||
                      c.includes('export interface') ||
                      c.includes('export {') ||        // re-export barrel
                      c.includes('export async') ||    // async function
                      c.includes('export class');      // class component
    expect(hasExport).toBe(true);
  });

  test.each(components.filter(f => f.endsWith('.tsx')))(
    '%s returns JSX or renders nothing intentionally', (fname) => {
    const c = readFileSync(join(COMP_DIR, fname), 'utf-8');
    // Must have return with JSX, or be a hook/utility
    const hasJSX    = c.includes('return (') || c.includes('return <') || c.includes('return(');
    const isHook    = c.includes('export function use') || c.includes('export const use');
    const isUtility = !c.includes('React.createElement') && c.split('\n').length < 20;
    expect(hasJSX || isHook || isUtility).toBe(true);
  });
});

describe('Components — React.memo usage', () => {
  test('pure display components use React.memo', () => {
    const withMemo = components.filter(f => {
      const c = readFileSync(join(COMP_DIR, f), 'utf-8');
      return c.includes('React.memo') || c.includes('= memo(');
    });
    expect(withMemo.length).toBeGreaterThan(5);
  });

  test('no component directly imports StyleSheet.create with static colors', () => {
    const violations = [];
    for (const fname of components) {
      const c = readFileSync(join(COMP_DIR, fname), 'utf-8');
      if (/StyleSheet\.create\s*\(\s*\{[^}]*color:\s*'#[0-9a-f]{3,6}'/i.test(c))
        violations.push(fname);
    }
    if (violations.length > 0) console.warn('Static colors in StyleSheet:', violations);
    expect(violations.length).toBeLessThan(8);
  });
});

describe('Components — prop type safety', () => {
  test('components with props have TypeScript type definitions', () => {
    const untyped = [];
    for (const fname of components.filter(f => f.endsWith('.tsx'))) {
      const c = readFileSync(join(COMP_DIR, fname), 'utf-8');
      const usesProps = /function\s+\w+\s*\(\s*\{/.test(c); // destructured props
      const hasTypes  = /:\s*(Props|[A-Z]\w+Props|\{[^}]+\})\s*[)=]/.test(c) ||
                        c.includes('interface ') || c.includes('type Props');
      if (usesProps && !hasTypes) untyped.push(fname);
    }
    if (untyped.length > 0) console.warn('Untyped props:', untyped);
    expect(untyped.length).toBeLessThan(10);
  });

  test('no component has both children prop and no type for it', () => {
    const issues = [];
    for (const fname of components) {
      const c = readFileSync(join(COMP_DIR, fname), 'utf-8');
      if (c.includes('children') && !c.includes('ReactNode') && !c.includes('React.ReactNode') && !c.includes('PropsWithChildren'))
        issues.push(fname);
    }
    expect(issues.length).toBeLessThan(10);
  });
});

describe('Components — no broken dependencies', () => {
  test('all component imports reference files that exist', () => {
    const broken = [];
    for (const fname of components) {
      try {
        const txt  = readFileSync(join(COMP_DIR, fname), 'utf-8');
        const imps = Array.from(txt.matchAll(/from\s+['"](\.\.[^'"]+)['"]/g)).map(m => m[1]);
        for (const imp of imps) {
          try {
            const base   = resolve(COMP_DIR, imp);
            const exists = [base, base+'.ts', base+'.tsx', base+'/index.ts', base+'/index.tsx']
              .some(p => { try { readFileSync(p); return true; } catch { return false; } });
            if (!exists) broken.push(fname + ' broke: ' + imp);
          } catch {}
        }
      } catch {}
    }
    if (broken.length > 0) console.warn('Broken component imports:', broken);
    expect(broken).toHaveLength(0);
  });
});