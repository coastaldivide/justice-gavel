#!/usr/bin/env node
/**
 * check-nav-targets.mjs — verify every navigate/push/replace/reset target
 * names a screen that is actually registered in the navigator tree.
 *
 * Usage:  node scripts/check-nav-targets.mjs [--verbose]
 * Exit code 1 when an unregistered target is found.
 *
 * Registered screens are read from:
 *   - App.tsx                       (RootStack: MainTabs / GuestNav)
 *   - src/navigation/AppNavigator.tsx (Tab / MoreStack / GuestStack)
 *
 * Targets are collected from string literals in:
 *   navigation.navigate('X'), .push('X'), .replace('X'), .jumpTo('X'),
 *   navigate('Parent', { screen: 'X', params: { screen: 'Y' } }),
 *   reset({ routes: [{ name: 'X' }] }), CommonActions.navigate({ name: 'X' })
 *   and `screen: 'X'` properties in menu/config arrays that are later passed
 *   to navigate() dynamically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

function parseFile(file) {
  const code = fs.readFileSync(file, 'utf8');
  return parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true });
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

// ── 1. Registered screens per navigator ──────────────────────────────────────
const navigators = {}; // navigatorVar -> Set(names)
function collectRegistered(file) {
  const ast = parseFile(file);
  traverse(ast, {
    JSXOpeningElement(p) {
      const n = p.node.name;
      if (n.type !== 'JSXMemberExpression' || n.property.name !== 'Screen') return;
      const nav = n.object.name;
      const nameAttr = p.node.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'name');
      if (!nameAttr) return;
      const v = nameAttr.value;
      const name = v.type === 'StringLiteral' ? v.value
        : v.expression?.type === 'StringLiteral' ? v.expression.value : null;
      if (!name) return;
      (navigators[nav] ||= new Set()).add(name);
    },
  });
}
collectRegistered(path.join(ROOT, 'App.tsx'));
collectRegistered(path.join(ROOT, 'src/navigation/AppNavigator.tsx'));

const ROOT_NAMES  = navigators.RootStack  || new Set();
const TAB_NAMES   = navigators.Tab        || new Set();
const MORE_NAMES  = navigators.MoreStack  || new Set();
const GUEST_NAMES = navigators.GuestStack || new Set();
const MAIN_TREE = new Set([...ROOT_NAMES, ...TAB_NAMES, ...MORE_NAMES]);
const CHILDREN = { MainTabs: TAB_NAMES, MoreTab: MORE_NAMES, GuestNav: GUEST_NAMES };

// Screens mounted in the guest stack may legitimately navigate within it;
// screens mounted ONLY there cannot reach the main tabs.
const guestScreenFiles = new Set();
const mainScreenFiles = new Set();
{
  const navFile = path.join(ROOT, 'src/navigation/AppNavigator.tsx');
  const code = fs.readFileSync(navFile, 'utf8');
  const ast = parseFile(navFile);
  const importMap = {};
  const lazyMap = {};
  traverse(ast, {
    ImportDeclaration(p) {
      for (const s of p.node.specifiers) importMap[s.local.name] = p.node.source.value;
    },
    VariableDeclarator(p) {
      const m = /import\((['"])([^'"]+)\1\)/.exec(code.slice(p.node.start, p.node.end));
      if (m && p.node.id.type === 'Identifier') lazyMap[p.node.id.name] = m[2];
    },
  });
  traverse(ast, {
    JSXOpeningElement(p) {
      const n = p.node.name;
      if (n.type !== 'JSXMemberExpression' || n.property.name !== 'Screen') return;
      const comp = p.node.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'component');
      const id = comp?.value?.expression?.name;
      // lazy screens: const X = withSuspense(React.lazy(() => import('../screens/X')))
      const src = (id && (importMap[id] || lazyMap[id])) || null;
      if (!src) return;
      (n.object.name === 'GuestStack' ? guestScreenFiles : mainScreenFiles).add(path.basename(src));
    },
  });
}

// ── 2. Collect navigation targets ────────────────────────────────────────────
const NAV_METHODS = new Set(['navigate', 'push', 'replace', 'jumpTo']);
const problems = [];
const seen = [];

function strVal(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === 'TSAsExpression') return strVal(node.expression);
  return null;
}
function prop(obj, key) {
  if (obj?.type !== 'ObjectExpression') return null;
  return obj.properties.find(p => p.type === 'ObjectProperty' &&
    ((p.key.type === 'Identifier' && p.key.name === key) || strVal(p.key) === key))?.value ?? null;
}

function srcOf(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression') return srcOf(node.object) + '.' + (node.property.name || '');
  if (node.type === 'CallExpression') return srcOf(node.callee) + '()';
  if (node.type === 'OptionalMemberExpression') return srcOf(node.object) + '.' + (node.property.name || '');
  if (node.type === 'OptionalCallExpression') return srcOf(node.callee) + '()';
  if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression' || node.type === 'ParenthesizedExpression') return srcOf(node.expression);
  return '';
}

function check(file, line, name, parent, kind) {
  const rel = path.relative(ROOT, file);
  seen.push({ rel, line, name, parent, kind });
  const base = path.basename(file).replace(/\.(tsx?|jsx?)$/, '');
  const isGuestFile = guestScreenFiles.has(base);
  const guestOnly = isGuestFile && !mainScreenFiles.has(base);
  let ok;
  if (guestOnly) ok = parent ? false : GUEST_NAMES.has(name);
  else if (parent && CHILDREN[parent]) ok = CHILDREN[parent].has(name);
  else ok = MAIN_TREE.has(name) || (isGuestFile && GUEST_NAMES.has(name)) || ROOT_NAMES.has(name);
  if (!ok) problems.push(`${rel}:${line}  ${kind} -> ${parent ? parent + ' > ' : ''}${name}`);
}

function checkNested(file, line, parentName, paramsNode, kind) {
  const child = strVal(prop(paramsNode, 'screen'));
  if (!child) return;
  if (!CHILDREN[parentName]) {
    problems.push(`${path.relative(ROOT, file)}:${line}  ${kind} -> ${parentName} is not a navigator (nested screen '${child}' ignored)`);
    return;
  }
  check(file, line, child, CHILDREN[parentName] ? parentName : null, kind);
  const inner = prop(paramsNode, 'params');
  if (inner) checkNested(file, line, child, inner, kind);
}

for (const file of [path.join(ROOT, 'App.tsx'), ...walk(path.join(ROOT, 'src'))]) {
  const ast = parseFile(file);
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      const line = p.node.loc?.start.line;
      const method = callee.type === 'MemberExpression' ? callee.property.name
        : callee.type === 'Identifier' ? callee.name : null;
      // push/replace/reset also exist on arrays/strings: require a navigation-ish receiver
      const recv = callee.type === 'MemberExpression' ? srcOf(callee.object) : '';
      const navLike = /nav|router/i.test(recv);
      if (NAV_METHODS.has(method) && (method === 'navigate' || navLike)) {
        const [a0, a1] = p.node.arguments;
        const name = strVal(a0);
        if (name) {
          check(file, line, name, null, method);
          if (a1) checkNested(file, line, name, a1, method);
        } else if (a0?.type === 'ObjectExpression') {
          const n = strVal(prop(a0, 'name'));
          if (n) check(file, line, n, null, method);
        }
      }
      if (method === 'reset' && navLike) {
        const routes = prop(p.node.arguments[0], 'routes');
        for (const r of routes?.elements || []) {
          const n = strVal(prop(r, 'name'));
          if (n) check(file, line, n, null, 'reset');
        }
      }
    },
    // Menu/config arrays: { ..., screen: 'X' } outside navigate() calls
    ObjectProperty(p) {
      const key = p.node.key.type === 'Identifier' ? p.node.key.name : strVal(p.node.key);
      if (key !== 'screen') return;
      const v = strVal(p.node.value);
      if (!v) return;
      const inNavCall = p.findParent(pp => pp.isCallExpression() &&
        (NAV_METHODS.has(pp.node.callee?.property?.name) || NAV_METHODS.has(pp.node.callee?.name)));
      if (inNavCall) return;
      check(file, p.node.loc?.start.line, v, null, 'screen-prop');
    },
  });
}

if (verbose) {
  console.log('Registered:', JSON.stringify(Object.fromEntries(Object.entries(navigators).map(([k, v]) => [k, [...v]])), null, 1));
  console.log(`Targets checked: ${seen.length}`);
}
const uniqueTargets = new Set(seen.map(s => s.name));
console.log(`nav-targets: ${seen.length} references, ${uniqueTargets.size} distinct targets, ${problems.length} problem(s)`);
for (const pr of problems) console.log('  UNREGISTERED ' + pr);
process.exit(problems.length ? 1 : 0);
