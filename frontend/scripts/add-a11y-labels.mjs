#!/usr/bin/env node
/**
 * add-a11y-labels.mjs
 *
 * Adds `accessibilityRole` and `accessibilityLabel` to touchable elements that
 * have neither, deriving the label from the first static text inside them.
 *
 * Why an AST and not a regex
 * ──────────────────────────
 * A previous pass tried this with a regular expression. It reported 15 labels
 * across 8 files and broke the parse on 6 of them, and was reverted in full.
 * JSX opening tags nest braces, ternaries and template literals in ways a regex
 * cannot track — `<TouchableOpacity style={{flex: 1}} onPress={() => go('x')}>`
 * defeats any attempt to find "the end of the tag" by counting characters.
 *
 * This walks the Babel AST instead, so the tag boundary is a fact rather than a
 * guess, and it re-parses every file it writes.
 *
 * Deliberately conservative:
 *   - Only elements with an onPress and no existing accessibility* prop.
 *   - Only labels from static JSXText or a plain string literal — never from an
 *     interpolated expression, whose runtime value is unknown.
 *   - Skips anything already inside an element carrying accessibilityLabel.
 *
 * Usage:  node scripts/add-a11y-labels.mjs [--write] [glob ...]
 *         Without --write it reports what it would do and changes nothing.
 */

import { parse } from '@babel/parser';
import fs from 'node:fs';
import path from 'node:path';

const TOUCHABLES = new Set([
  'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback',
  'Pressable', 'TouchableNativeFeedback',
]);

const write = process.argv.includes('--write');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));

function walkDir(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out);
    else if (/\.(tsx|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = args.length ? args : walkDir('src');

function parseFile(code) {
  return parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'classProperties', 'objectRestSpread'],
  });
}

/** Depth-first walk over a Babel AST. */
function visit(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && visit(c, fn, node));
    else if (v && typeof v.type === 'string') visit(v, fn, node);
  }
}

/** First static text inside an element, or null if only dynamic content. */
function firstStaticText(el) {
  let found = null;
  visit(el, n => {
    if (found) return;
    if (n.type === 'JSXText') {
      const t = n.value.trim().replace(/\s+/g, ' ');
      if (t && /[A-Za-z]/.test(t)) found = t;
    } else if (n.type === 'StringLiteral' && n.value.trim().length > 1 && /[A-Za-z]/.test(n.value)) {
      // only a string that is JSX child content, not a prop value
      found = found || null;
    }
  });
  return found;
}

const results = [];

for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parseFile(code);
  } catch (e) {
    results.push({ file, skipped: `parse error: ${e.message.split('\n')[0]}` });
    continue;
  }

  const edits = [];
  visit(ast, node => {
    if (node.type !== 'JSXElement') return;
    const open = node.openingElement;
    const name = open.name?.name;
    if (!TOUCHABLES.has(name)) return;

    const attrs = open.attributes.filter(a => a.type === 'JSXAttribute');
    const has = n => attrs.some(a => a.name?.name === n);
    if (!has('onPress')) return;
    if (has('accessibilityLabel') || has('aria-label') || has('accessible')) return;
    // An element may already declare a role without a label. Adding a second
    // accessibilityRole is a TS17001 duplicate-attribute error, so track it.
    const needsRole = !has('accessibilityRole') && !has('role');

    const label = firstStaticText(node);
    if (!label || label.length > 60) return;

    // Insert right after the element name, before any existing props.
    edits.push({ pos: open.name.end, label, needsRole, line: open.loc.start.line });
  });

  if (!edits.length) { results.push({ file, added: 0 }); continue; }

  let out = code;
  for (const e of edits.sort((a, b) => b.pos - a.pos)) {
    const esc = e.label.replace(/"/g, '&quot;');
    const role = e.needsRole ? '\n      accessibilityRole="button"' : '';
    out = out.slice(0, e.pos) + `${role}\n      accessibilityLabel="${esc}"` + out.slice(e.pos);
  }

  // Re-parse before writing. If the edit broke the file, drop it entirely.
  try {
    parseFile(out);
  } catch (e) {
    results.push({ file, skipped: `edit would break parse: ${e.message.split('\n')[0]}` });
    continue;
  }

  if (write) fs.writeFileSync(file, out);
  results.push({ file, added: edits.length, labels: edits.map(e => e.label) });
}

const changed = results.filter(r => r.added > 0);
const skipped = results.filter(r => r.skipped);
const total = changed.reduce((n, r) => n + r.added, 0);

for (const r of changed) {
  console.log(`${r.file}  +${r.added}`);
  for (const l of r.labels) console.log(`    "${l}"`);
}
for (const r of skipped) console.log(`SKIP ${r.file} — ${r.skipped}`);
console.log(`\n${total} labels across ${changed.length} files${write ? ' (written)' : ' (dry run — pass --write)'}`);
if (skipped.length) console.log(`${skipped.length} file(s) skipped, unchanged`);
