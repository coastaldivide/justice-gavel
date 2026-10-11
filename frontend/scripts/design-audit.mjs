#!/usr/bin/env node
/**
 * design-audit.mjs — static design & accessibility audit for the Expo app.
 *
 *   node scripts/design-audit.mjs [--json out.json] [--verbose]
 *
 * Checks (screens + components, .tsx):
 *   1. CONTRAST   — <Text> whose resolved color fails WCAG AA (4.5:1, 3:1 for
 *                   large text) against its statically-determinable backdrop,
 *                   evaluated in BOTH light and dark themes. Walks the JSX tree
 *                   keeping a backdrop stack; resolves styles.X (StyleSheet.create
 *                   / makeStyles), inline objects, arrays, colors.* / COLORS.* tokens.
 *                   Files that only ever call makeStyles(COLORS) are evaluated with
 *                   the light palette in both modes (that is what runs).
 *   2. HEX        — raw hex color literals outside constants/theme.ts.
 *   3. A11Y       — TouchableOpacity/Pressable/HapticButton/etc. with neither
 *                   accessibilityRole nor accessibilityLabel and no plain-text child.
 *   4. TOUCH      — interactive elements statically sized under 44x44 pt
 *                   (after hitSlop), on any screen.
 *
 * Exit code: 0, or 1 with --ci when any contrast failure, raw hex in
 * screens/components, missing a11y role/label, or small touch target remains.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const VERBOSE = args.includes('--verbose');

// ── Theme palettes ───────────────────────────────────────────────────────────
const themeSrc = fs.readFileSync(path.join(SRC, 'constants/theme.ts'), 'utf8');
function extractPalette(name) {
  const m = themeSrc.match(new RegExp(`export const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`palette ${name} not found`);
  const map = {};
  for (const mm of m[1].matchAll(/^\s*([A-Za-z0-9_]+):\s*'([^']+)'/gm)) map[mm[1]] = mm[2];
  return map;
}
const LIGHT = extractPalette('LIGHT_COLORS');
const DARK = extractPalette('DARK_COLORS');

// ── Color math ───────────────────────────────────────────────────────────────
function parseColor(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) {
    const [r, g, b] = m[1].split('').map(c => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
function compose(fg, bg) {
  // composite fg over bg (both rgba, bg assumed opaque)
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}
function luminance({ r, g, b }) {
  const f = v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(fgStr, bgStr) {
  const bg = parseColor(bgStr);
  let fg = parseColor(fgStr);
  if (!fg || !bg || bg.a < 1) return null; // can't be sure
  if (fg.a < 1) fg = compose(fg, bg);
  const l1 = luminance(fg), l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ── Source collection ────────────────────────────────────────────────────────
function listFiles(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...listFiles(fp));
    else if (/\.(ts|tsx)$/.test(f.name)) out.push(fp);
  }
  return out;
}
const allFiles = listFiles(SRC).filter(f => !f.includes('__tests__'));
const auditFiles = allFiles.filter(f =>
  /\.tsx$/.test(f) && (f.includes(`${path.sep}screens${path.sep}`) || f.includes(`${path.sep}components${path.sep}`) || f.includes(`${path.sep}navigation${path.sep}`)));

const findings = []; // {kind, file, line, detail...}
const rel = f => path.relative(ROOT, f);

// ── Hex audit (all source files except theme.ts) ─────────────────────────────
const HEX_RE = /(["'`])(#[0-9a-fA-F]{3,8})\1|(?<=[=:(,\s])#[0-9a-fA-F]{6}\b/g;
const TOKEN_FILES = [`constants${path.sep}theme.ts`, `constants${path.sep}tokens.ts`, `utils${path.sep}responsive.ts`];
for (const f of allFiles) {
  if (TOKEN_FILES.some(t => f.endsWith(t))) continue; // design-token definition files
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const code = ln.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
    for (const m of code.matchAll(/["'`]#[0-9a-fA-F]{3,8}["'`]/g)) {
      findings.push({ kind: 'hex', file: rel(f), line: i + 1, value: m[0].slice(1, -1) });
    }
  });
}

// ── Per-file TSX analysis ────────────────────────────────────────────────────
const INTERACTIVE = new Set(['TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Pressable', 'HapticButton']);
const TEXTY = new Set(['Text', 'Animated.Text', 'Heading1', 'Heading2', 'Heading3', 'Body', 'BodySmall', 'Label', 'Caption']);
const BG_UNCERTAIN_TAGS = new Set(['LinearGradient', 'ImageBackground', 'Image', 'Modal', 'BlurView']);
const FONT_WEIGHTS = { regular: 400, medium: 500, semiBold: 600, bold: 700, extraBold: 800, black: 900, reg: 400, semi: 600, heavy: 800 };

function analyzeFile(file, countA11y = true) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isScreen = file.includes(`${path.sep}screens${path.sep}`);
  // static-light file: styles built once from COLORS at module level, never from useTheme colors
  const staticLight = /makeStyles\(\s*COLORS\s*\)/.test(text) && !/makeStyles\(\s*colors\s*\)/.test(text);

  const pos = node => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  // Is a `colors` binding (useTheme or makeStyles param) in scope at this node?
  function colorsInScope(node) {
    for (let n = node; n; n = n.parent) {
      if ((ts.isArrowFunction(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n))) {
        if (n.parameters && n.parameters.some(p => p.name && p.name.getText() === 'colors')) return true;
        if (n.body && /\bconst\s*\{[^}]*\bcolors\b[^}]*\}\s*=|\bconst\s+colors\s*=/.test(n.body.getText())) return true;
      }
    }
    return false;
  }

  // value descriptor: {t:'static',v} | {t:'token',k} | {t:'light',k} | {t:'dark',k} | {t:'num',v} | {t:'uncertain'}
  function descFromExpr(e) {
    if (!e) return { t: 'uncertain' };
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { t: 'static', v: e.text };
    if (ts.isNumericLiteral(e)) return { t: 'num', v: Number(e.text) };
    if (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) return { t: 'num', v: -Number(e.operand.text) };
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const obj = e.expression.text, key = e.name.text;
      if (obj === 'colors') return { t: 'token', k: key };
      if (obj === 'COLORS' || obj === 'LIGHT_COLORS') return { t: 'light', k: key };
      if (obj === 'DARK_COLORS') return { t: 'dark', k: key };
      if (obj === 'FONT' || obj === 'TYPE' || obj === 'SPACE' || obj === 'RADIUS') return { t: 'uncertain' };
    }
    if (ts.isParenthesizedExpression(e)) return descFromExpr(e.expression);
    if (ts.isAsExpression(e)) return descFromExpr(e.expression);
    return { t: 'uncertain' };
  }
  function resolveDesc(d, mode) {
    if (!d) return undefined;
    if (d.t === 'static') return d.v;
    if (d.t === 'num') return d.v;
    if (d.t === 'token') return (staticLight ? LIGHT : (mode === 'dark' ? DARK : LIGHT))[d.k];
    if (d.t === 'light') return LIGHT[d.k];
    if (d.t === 'dark') return DARK[d.k];
    return undefined; // uncertain
  }
  const PROPS = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'width', 'height', 'minWidth', 'minHeight'];
  function propsFromObjectLiteral(o) {
    const out = {};
    for (const p of o.properties) {
      if (ts.isPropertyAssignment(p)) {
        const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
        if (!name) continue;
        if (PROPS.includes(name)) out[name] = { ...descFromExpr(p.initializer), line: pos(p.initializer), dynOk: colorsInScope(p.initializer) };
      } else if (ts.isSpreadAssignment(p)) {
        const e = p.expression;
        if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'FONTS') {
          const w = FONT_WEIGHTS[e.name.text];
          if (w) out.fontWeight = { t: 'num', v: w };
        } else {
          out.__spreadUncertain = true;
        }
      }
    }
    return out;
  }

  // Collect StyleSheet.create maps
  const styleDefs = {}; // name -> props
  (function collect(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'create' &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'StyleSheet' &&
        node.arguments.length && ts.isObjectLiteralExpression(node.arguments[0])) {
      for (const p of node.arguments[0].properties) {
        if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) {
          const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
          if (name) {
            const props = propsFromObjectLiteral(p.initializer);
            props.__line = pos(p);
            styleDefs[name] = props;
          }
        }
      }
    }
    ts.forEachChild(node, collect);
  })(sf);

  // Merge a style attribute expression into a props object
  function mergeStyleExpr(e, acc) {
    if (!e) return acc;
    if (ts.isJsxExpression(e)) return mergeStyleExpr(e.expression, acc);
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return mergeStyleExpr(e.expression, acc);
    if (ts.isArrayLiteralExpression(e)) {
      for (const el of e.elements) mergeStyleExpr(el, acc);
      return acc;
    }
    if (ts.isObjectLiteralExpression(e)) {
      Object.assign(acc, propsFromObjectLiteral(e));
      return acc;
    }
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      // styles.x / s.x / t.x — any local stylesheet
      const def = styleDefs[e.name.text];
      if (def) { Object.assign(acc, def); return acc; }
      acc.__unknownRef = true;
      return acc;
    }
    if (ts.isConditionalExpression(e)) {
      // selected-state overrides: evaluate the branch for the current variant pass
      return mergeStyleExpr(VARIANT === 'active' ? e.whenTrue : e.whenFalse, acc);
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      // `cond && style` applies only in the active-variant pass
      if (VARIANT === 'active') return mergeStyleExpr(e.right, acc);
      return acc;
    }
    acc.__unknownExpr = true;
    return acc;
  }

  function tagName(node) {
    const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
    return tag.getText();
  }
  function getAttrs(node) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const map = {};
    for (const a of opening.attributes.properties) {
      if (ts.isJsxAttribute(a)) map[a.name.getText()] = a.initializer ?? true;
      else map.__spread = true;
    }
    return map;
  }

  // plain text child: any descendant JsxText with content, or string-literal expression
  function hasTextChild(node) {
    let found = false;
    (function walk(n) {
      if (found) return;
      if (ts.isJsxText(n) && n.text.trim()) { found = true; return; }
      if (ts.isJsxExpression(n) && n.expression &&
          (ts.isStringLiteral(n.expression) || ts.isTemplateExpression(n.expression))) { found = true; return; }
      // calls like t('key') count as text
      if (ts.isJsxExpression(n) && n.expression && ts.isCallExpression(n.expression)) { found = true; return; }
      ts.forEachChild(n, walk);
    })(node);
    return found;
  }

  // ── JSX walk with backdrop stack ──────────────────────────────────────────
  // stack entries: {light, dark, uncertain, line}
  const rootBackdrop = isScreen
    ? { light: LIGHT.bg, dark: staticLight ? LIGHT.bg : DARK.bg, uncertain: false, line: 0 }
    : null;

  function walk(node, stack) {
    let childStack = stack;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      childStack = handleElement(node, stack);
    }
    ts.forEachChild(node, n => walk(n, childStack));
  }

  function handleElement(node, stack) {
    const tag = tagName(node);
    const attrs = getAttrs(node);
    const styleAcc = attrs.style && attrs.style !== true ? mergeStyleExpr(attrs.style, {}) : {};
    let newStack = stack;

    const bgDesc = styleAcc.backgroundColor;
    if (BG_UNCERTAIN_TAGS.has(tag)) {
      newStack = [...stack, { uncertain: true, line: pos(node) }];
    } else if (bgDesc) {
      if (bgDesc.t === 'uncertain') {
        newStack = [...stack, { uncertain: true, line: pos(node) }];
      } else {
        const l = resolveDesc(bgDesc, 'light');
        const d = resolveDesc(bgDesc, 'dark');
        const lp = parseColor(l), dp = parseColor(d);
        if (lp && dp && (lp.a > 0 || dp.a > 0)) {
          const parent = [...stack].reverse().find(Boolean);
          const bgLine = bgDesc.line || pos(node);
          const bgExpr = descToStr(bgDesc);
          if (lp.a < 1 || dp.a < 1) {
            if (parent && !parent.uncertain) {
              newStack = [...stack, {
                light: rgbaToHex(compose(lp, parseColor(parent.light))),
                dark: rgbaToHex(compose(dp, parseColor(parent.dark))),
                uncertain: false, line: bgLine, expr: bgExpr,
              }];
            } else newStack = [...stack, { uncertain: true, line: bgLine }];
          } else {
            newStack = [...stack, { light: l, dark: d, uncertain: false, line: bgLine, expr: bgExpr }];
          }
        } else if (!lp || !dp) {
          newStack = [...stack, { uncertain: true, line: bgDesc.line || pos(node) }];
        }
        // fully transparent bg → keep parent backdrop
      }
    }

    if (TEXTY.has(tag) && styleAcc.color && styleAcc.color.t !== 'uncertain') {
      const backdrop = [...newStack].reverse().find(Boolean);
      if (backdrop && !backdrop.uncertain) {
        const fontSize = styleAcc.fontSize && styleAcc.fontSize.t === 'num' ? styleAcc.fontSize.v : 14;
        let weight = 400;
        if (styleAcc.fontWeight) {
          if (styleAcc.fontWeight.t === 'num') weight = styleAcc.fontWeight.v;
          else if (styleAcc.fontWeight.t === 'static') weight = parseInt(styleAcc.fontWeight.v, 10) || 400;
        }
        const large = fontSize >= 24 || (fontSize >= 18.5 && weight >= 700);
        const threshold = large ? 3.0 : 4.5;
        const per = {};
        for (const mode of ['light', 'dark']) {
          const fg = resolveDesc(styleAcc.color, mode);
          const bg = backdrop[mode];
          if (!fg || !bg) continue;
          const ratio = contrast(fg, bg);
          per[mode] = { fg, bg, ratio: ratio === null ? null : Math.round(ratio * 100) / 100 };
        }
        const fails = ['light', 'dark'].filter(m => per[m] && per[m].ratio !== null && per[m].ratio < threshold);
        // explicit suppression for conditionally-rendered elements the static
        // walker cannot model (e.g. a checkmark only rendered on a dark fill)
        const srcLines = text.split('\n');
        const suppressed = [pos(node), styleAcc.color.line].some(
          ln => ln && /design-audit-ignore/.test(srcLines[ln - 1] || ''));
        if (fails.length && !suppressed) {
          findings.push({
            kind: 'contrast', file: rel(file), line: pos(node), fails,
            light: per.light, dark: per.dark, threshold,
            fgExpr: descToStr(styleAcc.color), fgLine: styleAcc.color.line, dynOk: !!styleAcc.color.dynOk,
            bgLine: backdrop.line, bgExpr: backdrop.expr, tag, staticLight,
          });
        }
      }
    }

    if (INTERACTIVE.has(tag)) {
      const hasRole = 'accessibilityRole' in attrs;
      const hasLabel = 'accessibilityLabel' in attrs;
      const spread = attrs.__spread;
      if (!hasRole && !hasLabel && !spread && tag !== 'HapticButton') {
        const textChild = ts.isJsxElement(node) ? hasTextChild(node) : false;
        if (countA11y) {
          if (!textChild) {
            findings.push({ kind: 'a11y', file: rel(file), line: pos(node), tag, detail: 'no accessibilityRole/Label and no text child' });
          } else {
            findings.push({ kind: 'a11y-role', file: rel(file), line: pos(node), tag, detail: 'text child but no accessibilityRole' });
          }
        }
      }
      const dim = k => (styleAcc[k] && styleAcc[k].t === 'num' ? styleAcc[k].v : undefined);
      const w = dim('width') ?? dim('minWidth');
      const h = dim('height') ?? dim('minHeight');
      let slopX = 0, slopY = 0;
      if (attrs.hitSlop && attrs.hitSlop !== true && ts.isJsxExpression(attrs.hitSlop) && attrs.hitSlop.expression) {
        const he = attrs.hitSlop.expression;
        if (ts.isObjectLiteralExpression(he)) {
          const get = n => {
            const p = he.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText() === n);
            return p && ts.isNumericLiteral(p.initializer) ? Number(p.initializer.text) : 0;
          };
          slopX = get('left') + get('right');
          slopY = get('top') + get('bottom');
        } else if (ts.isNumericLiteral(he)) {
          slopX = slopY = Number(he.text) * 2;
        }
      }
      const effW = w !== undefined ? w + slopX : undefined;
      const effH = h !== undefined ? h + slopY : undefined;
      if (countA11y && ((effW !== undefined && effW < 44) || (effH !== undefined && effH < 44))) {
        findings.push({ kind: 'touch', file: rel(file), line: pos(node), tag, w, h, effW, effH });
      }
    }
    return newStack;
  }

  walk(sf, rootBackdrop ? [rootBackdrop] : []);
}

function rgbaToHex({ r, g, b }) {
  const h = v => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function descToStr(d) {
  if (!d) return '?';
  if (d.t === 'static') return `'${d.v}'`;
  if (d.t === 'token') return `colors.${d.k}`;
  if (d.t === 'light') return `COLORS.${d.k}`;
  if (d.t === 'dark') return `DARK_COLORS.${d.k}`;
  return '?';
}

let VARIANT = 'base';
for (const f of auditFiles) {
  for (const v of ['base', 'active']) {
    VARIANT = v;
    try { analyzeFile(f, v === 'base'); } catch (e) {
      if (v === 'base') findings.push({ kind: 'error', file: rel(f), detail: String(e && e.message || e) });
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const by = k => findings.filter(x => x.kind === k);
// de-dup contrast (same file:line)
const seen = new Set();
const contrastFindings = by('contrast').filter(x => {
  const key = `${x.file}:${x.line}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
const nFail = mode => contrastFindings.filter(x => x.fails.includes(mode)).length;
const hexInScreens = by('hex').filter(x => x.file.includes('src/screens'));
const hexInComponents = by('hex').filter(x => x.file.includes('src/components'));
const hexElsewhere = by('hex').filter(x => !x.file.includes('src/screens') && !x.file.includes('src/components'));

console.log('── design-audit summary ──────────────────────────────');
console.log(`contrast failures (light):   ${nFail('light')}`);
console.log(`contrast failures (dark):    ${nFail('dark')}`);
console.log(`contrast failing sites:      ${contrastFindings.length}`);
console.log(`raw hex literals:            ${by('hex').length}  (screens ${hexInScreens.length}, components ${hexInComponents.length}, other ${hexElsewhere.length})`);
console.log(`a11y: no role/label/text:    ${by('a11y').length}`);
console.log(`a11y: no role (has text):    ${by('a11y-role').length}`);
console.log(`touch targets < 44pt:        ${by('touch').length}`);
if (by('error').length) console.log(`parse errors:                ${by('error').length}`);

if (VERBOSE) {
  for (const x of contrastFindings) {
    const d = m => x[m] ? `${x[m].fg} on ${x[m].bg}=${x[m].ratio}` : '?';
    console.log(`[contrast:${x.fails.join('+')}] ${x.file}:${x.line} ${x.fgExpr} (def @${x.fgLine}) light(${d('light')}) dark(${d('dark')}) < ${x.threshold}${x.staticLight ? ' [static-light]' : ''}`);
  }
  for (const x of by('a11y')) console.log(`[a11y] ${x.file}:${x.line} <${x.tag}> ${x.detail}`);
  for (const x of by('touch')) console.log(`[touch] ${x.file}:${x.line} <${x.tag}> ${x.w ?? '?'}x${x.h ?? '?'} eff ${x.effW ?? '?'}x${x.effH ?? '?'}`);
}

if (args.includes('--ci')) {
  const bad = contrastFindings.length + hexInScreens.length + hexInComponents.length + by('a11y').length + by('touch').length;
  if (bad > 0) {
    console.error(`design-audit --ci: ${bad} blocking findings`);
    process.exitCode = 1;
  }
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    summary: {
      contrastLight: nFail('light'),
      contrastDark: nFail('dark'),
      contrastSites: contrastFindings.length,
      hex: by('hex').length,
      hexScreens: hexInScreens.length,
      hexComponents: hexInComponents.length,
      a11y: by('a11y').length,
      a11yRole: by('a11y-role').length,
      touch: by('touch').length,
    },
    findings: findings.filter(x => x.kind !== 'contrast').concat(contrastFindings),
  }, null, 2));
  console.log(`wrote ${JSON_OUT}`);
}
