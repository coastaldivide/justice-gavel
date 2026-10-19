#!/usr/bin/env node
/**
 * i18n-scan.mjs — finds user-facing English that is hard-coded instead of
 * going through t() (src/i18n), and t() calls that run at import time (frozen
 * in the start-up language). Runs in `npm test` (src/__tests__/i18nScan.test.js)
 * so a new hard-coded string fails CI.
 *
 *   node scripts/i18n-scan.mjs            report, exit 0
 *   node scripts/i18n-scan.mjs --ci       exit 1 when anything is found
 *   node scripts/i18n-scan.mjs --json f   write findings as JSON
 *
 * What counts as user-facing (TypeScript AST over src/**\/*.ts(x); tests and
 * src/i18n excluded):
 *   jsx    JSX text, and string literals rendered as JSX children
 *   prop   string literals in user-facing props (title, placeholder,
 *          accessibilityLabel/Hint, label, message, subtitle, …)
 *   call   arguments of Alert.alert, showToast / toast, confirm, explain,
 *          Share.share, setError / setMessage-style setters
 *   key    object properties with user-facing names (title, label, message,
 *          body, description, text, placeholder, hint, …)
 *   list   arrays of two or more capitalised words / phrases (chips, options)
 *   text   any other sentence-like literal (2+ words, a capital or ending
 *          punctuation) outside code-only places (console, Error, testID,
 *          style, imports, comparisons, t() keys)
 *   word   a single capitalised word in any other place ("Today", "⏳ Thinking…")
 *   sibling a plain string in a label table whose other entries use t()
 *   eager  t() called at module scope (runs once, in the start-up language)
 *
 * Not flagged: t() keys, identifiers / keys / routes / URLs / e-mails / colors
 * / format strings, strings without letters, and the true non-translatables in
 * scripts/i18n-allowlist.json (brand and organisation names, units, codes —
 * each with a reason). A line can opt out with `// i18n-exempt: <reason>` on
 * it or on the line before — only for text that must stay English (e.g. a
 * court-filing template, a wire code).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
export const ts = require('typescript');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'src');
const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/i18n-allowlist.json'), 'utf8'));
const ALLOW_STRINGS = new Set(Object.keys(allow.strings || {}));
export const ALLOW_FILES = allow.files || {};

const USER_PROPS = new Set([
  'title', 'subtitle', 'placeholder', 'value', 'accessibilityLabel', 'accessibilityHint', 'label', 'message',
  'description', 'text', 'heading', 'hint', 'body', 'emptyText', 'emptyTitle', 'emptyMessage', 'buttonText',
  'confirmText', 'cancelText', 'confirmLabel', 'cancelLabel', 'actionLabel', 'cta', 'ctaLabel', 'caption',
  'headerTitle', 'tabBarLabel', 'tabBarAccessibilityLabel', 'helperText', 'errorText', 'error', 'note',
  'retryLabel', 'badge', 'tagline', 'summary', 'question', 'answer', 'tip', 'detail', 'details', 'sub',
  'desc', 'prompt', 'header', 'footer', 'warning', 'info', 'reason', 'explain', 'why', 'step', 'steps',
  'action', 'blurb', 'lead', 'headline', 'kicker', 'eyebrow', 'chip', 'tag', 'short', 'long', 'help',
  'notice', 'disclaimer', 'content', 'example', 'examples', 'tips', 'bullets', 'items', 'what', 'how',
  'when', 'where', 'who', 'cost', 'time', 'timeline', 'outcome', 'requirements', 'eligibility', 'category',
  'subtext', 'subLabel', 'sublabel', 'okText', 'doneText', 'buttonLabel', 'linkText', 'emptyLabel',
]);
// Properties whose strings are code, data matching, or must stay English.
const CODE_KEYS = new Set([
  'testID', 'nativeID', 'key', 'style', 'source', 'icon', 'iconName', 'route', 'screen', 'type', 'mode',
  'variant', 'keyboardType', 'autoCapitalize', 'autoComplete', 'textContentType', 'returnKeyType',
  'accessibilityRole', 'importantForAccessibility', 'pointerEvents', 'resizeMode', 'color', 'size', 'id',
  'href', 'url', 'uri', 'contentType', 'mimeType', 'format', 'kind', 'value', 'status', 'name', 'q',
  'keywords', 'match', 'pattern', 'regex', 'slug', 'event', 'intent', 'template', 'code', 'emoji',
  'number', 'phone', 'sms', 'email', 'website', 'web', 'link', 'verified', 'state', 'abbr', 'statute',
  'citation', 'cite', 'tier', 'plan', 'role', 'field', 'param', 'path', 'method', 'fontFamily',
  // proper names (official bodies, places) — shown as recorded; state names go through stateName()
  'aocName', 'stateName', 'city', 'county', 'orgName', 'agency',
  'displayName', 'initialRouteName', 'court_type', 'caseType', 'case_type', 'practice_area', 'category_key',
]);
const CALL_ALL_ARGS = new Set(['alert', 'showToast', 'toast', 'explain', 'confirm', 'ask', 'notify', 'announceForAccessibility', 'prompt']);
const SETTER = /^set[A-Z]\w*(Error|Err|Msg|Message|Status|Notice|Hint|Warning|Info|Banner|Toast|Title|Label|Text|Result|Feedback|Copy|Note|Subtitle|Description|Reason|Explain|Summary|Prompt|Placeholder)$/;
const SKIP_CALLS = /^(t|require|import|navigate|push|replace|reset|getItem|setItem|removeItem|multiRemove|multiGet|get|post|put|patch|delete|del|fetch|request|apiGet|apiPost|idempotentPost|addEventListener|removeEventListener|includes|startsWith|endsWith|indexOf|lastIndexOf|split|join|replaceAll|match|matchAll|test|search|toLocaleDateString|toLocaleTimeString|toLocaleString|format|padStart|padEnd|querySelector|querySelectorAll|getElementById|createElement|setAttribute|getAttribute|emit|on|off|once|openURL|canOpenURL|encodeURIComponent|decodeURIComponent|localeCompare|getParam|setParams|useState|useRef|has|add|Symbol|parse|stringify|parseInt|parseFloat|Number|RegExp|track|trackEvent|logEvent|captureException|captureMessage|addBreadcrumb|setTag|setContext|haptic|impact|notification|selection|vibrate|cacheGet|cacheSet|getCached|setCached|cache|invalidate|getJSON|setJSON|warn|error|log|info|debug|assert|define|isEqual|append|set|delete|getOrDefault|readAsStringAsync|writeAsStringAsync|downloadAsync|uploadAsync|create|StyleSheet|hexToRgba|withAlpha|alpha|rgba|dial|call|openSms|tel|mailto|keyOf|storageKey|cacheKey|useFocusEffect|useCallback|useMemo|useEffect|unwrapList|getDateLocale|setOptions)$/;

const PHRASE_LIST_ITEM = /^[A-Z][A-Za-z'’&/\-]*( [A-Za-z'’&/\-]+)*$/;

export function looksTranslatable(raw) {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (ALLOW_STRINGS.has(s)) return false;
  const words = s.match(/[A-Za-z]{2,}/g) || [];
  if (!words.length) return false;
  if (/^(https?:|mailto:|tel:|sms:|data:|file:|blob:|www\.)/i.test(s)) return false;
  if (/^[A-Z][a-z]+(?: [A-Z][a-z]+)*, [A-Z]{2}$/.test(s)) return false;       // place names ("Nashville, TN")
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s)) return false;
  if (/^(\.[a-z]{2,4}|[\w-]+(\.[\w-]+)*\.(org|gov|com|net|us|app|io)(\/[\w\-/.]*)?)$/i.test(s)) return false; // domains (lawhelp.org, .gov)
  if (/^[#.]?[a-z0-9_\-./:]+$/.test(s)) return false;            // identifier / key / path / css-ish
  if (/^[a-z][a-zA-Z0-9]*$/.test(s)) return false;              // camelCase identifier
  if (/^[A-Z][a-zA-Z0-9]*[a-z][A-Z][a-zA-Z0-9]*$/.test(s)) return false; // PascalCase route (CaseScreen)
  if (/^[A-Z0-9_]+$/.test(s)) return false;                     // CONSTANT / code
  if (/^[A-Z]{2,5}(\s*[·,/|-]\s*[A-Z]{2,5})*$/.test(s)) return false; // AM / PM / USD / PDF · PNG
  if (/^(yyyy|YYYY|MM|MMM|MMMM|dd|d|HH|hh|h|mm|ss|a|EEE|EEEE|[.\-/:,\s])+$/.test(s)) return false; // date formats
  if (/^\$?\{?[\w.]+\}?$/.test(s) && !/^[A-Z][a-z]/.test(s)) return false;
  if (/^(rgba?|hsla?)\(/.test(s)) return false;
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)) return false;         // kebab-case icon / ids
  if (/^[a-z_]+(\.[a-z_]+)+$/.test(s)) return false;            // dotted keys
  if (/^\/[\w\-/:.]*$/.test(s)) return false;                   // api paths
  if (/^[\w-]+\.(png|jpe?g|pdf|svg|json|ics|txt|csv|html|mp3|m4a|wav|webm|mp4)$/i.test(s)) return false; // file names
  if (/^(application|text|image|audio|video)\/[\w.+-]+$/.test(s)) return false; // mime types
  if (/^[a-z]+:[a-z_]+/.test(s)) return false;                  // namespaced codes
  if (/^(Bearer|Basic|Token) \S/.test(s)) return false;                // HTTP auth scheme
  if (/^(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE (TABLE|INDEX)|DROP|ALTER TABLE|PRAGMA)\b/.test(s)) return false; // SQL (on-device SQLite)
  return true;
}
function sentenceLike(raw) {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!looksTranslatable(s)) return false;
  const words = s.match(/[A-Za-z]{2,}/g) || [];
  if (words.length < 2 || !/\s/.test(s)) return false;
  return /^[A-Z¿¡"“'(]/.test(s) || /[.!?…:]$/.test(s) || /\b(the|you|your|a|an|to|of|and|or|is|are|for|not|with|this|in|on)\b/i.test(s);
}

export function listFiles(dir = SRC) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, f.name);
    if (f.isDirectory()) { if (!['__tests__', 'i18n'].includes(f.name)) out.push(...listFiles(fp)); }
    else if (/\.(ts|tsx)$/.test(f.name) && !/\.d\.ts$/.test(f.name)) out.push(fp);
  }
  return out.sort();
}
export const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

function propName(n) {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}
function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}
export function inFunction(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) return true;
  }
  return false;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–', middot: '·', hellip: '…', rarr: '→', larr: '←', copy: '©', reg: '®', trade: '™', bull: '•' };
const decodeEntities = s => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m));
/** JSX text as React renders it (JSX whitespace rules, HTML entities decoded). */
export function jsxTextValue(raw) {
  raw = decodeEntities(raw);
  if (!/\n/.test(raw)) return raw;
  const lines = raw.split(/\r?\n/);
  const out = [];
  lines.forEach((ln, i) => {
    let s = ln.replace(/\t/g, ' ');
    if (i > 0) s = s.replace(/^\s+/, '');
    if (i < lines.length - 1) s = s.replace(/\s+$/, '');
    if (s) out.push(s);
  });
  return out.join(' ');
}

/** Context of a string literal: { skip } | { user: kind } | { generic: true } */
function context(node) {
  let child = node;
  let p = node.parent;
  let viaProp = false; // inside an object property with a non-UI name: data unless a UI call/prop says otherwise
  const user = kind => (viaProp ? { generic: true } : { user: kind });
  while (p) {
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const name = ts.isCallExpression(p) ? calleeName(p) : (ts.isIdentifier(p.expression) ? p.expression.text : null);
      const full = p.expression.getText();
      if (p.expression === child) return { skip: true };
      if (/^console\./.test(full) || /^(logger|log|Sentry|Analytics|analytics|AsyncStorage|SecureStore|Haptics|storage|Storage)\b/.test(full)) return { skip: true };
      if (/Error$/.test(name || '') && ts.isNewExpression(p)) return { skip: true, error: true };
      if (SKIP_CALLS.test(name || '')) return { skip: true };
      if (CALL_ALL_ARGS.has(name) || SETTER.test(name || '') || /\bShare\.share$|RNShare\.share$/.test(full)) return user('call');
      if (/^haptic/.test(name || '')) return { skip: true };
      return { generic: true, inCall: true };
    }
    if (ts.isJsxAttribute(p)) {
      const n = p.name.getText();
      if (USER_PROPS.has(n)) return user('prop');
      if (CODE_KEYS.has(n)) return { skip: true };
      return { generic: true };
    }
    if (ts.isJsxExpression(p) && p.parent && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent))) return user('jsx');
    if (ts.isPropertyAssignment(p)) {
      if (p.name === child) return { skip: true };
      const n = propName(p.name);
      if (n && USER_PROPS.has(n)) return { user: 'key' };
      if (n && CODE_KEYS.has(n)) return { skip: true };
      viaProp = true;
    }
    if (ts.isBinaryExpression(p)) {
      const op = p.operatorToken.kind;
      if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword, ts.SyntaxKind.InstanceOfKeyword].includes(op)) return { skip: true };
    }
    if (ts.isCaseClause(p) && p.expression === child) return { skip: true };
    if (ts.isElementAccessExpression(p) && p.argumentExpression === child) return { skip: true };
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isTypeNode(p) || ts.isExternalModuleReference(p)) return { skip: true };
    if (ts.isThrowStatement(p)) return { skip: true, error: true };
    // (style: 'Light' | 'Medium' = 'Medium') — a default for a literal-union parameter is a code
    if (ts.isParameter(p) && p.initializer === child && p.type && ts.isUnionTypeNode(p.type) && p.type.types.every(x => ts.isLiteralTypeNode(x))) return { skip: true };
    if (ts.isEnumMember(p)) return { skip: true };
    if (ts.isArrayLiteralExpression(p) && !viaProp) {
      // ['Open', 'Active'].includes(status) — values compared, not shown
      if (p.parent && ts.isPropertyAccessExpression(p.parent) && p.parent.expression === p && /^(includes|indexOf|lastIndexOf|findIndex|some|every)$/.test(p.parent.name.text)) return { skip: true };
      return { list: p };
    }
    if (ts.isVariableDeclaration(p) || ts.isReturnStatement(p) || ts.isArrowFunction(p) || ts.isFunctionDeclaration(p) || ts.isBlock(p) || ts.isSourceFile(p)) return { generic: true };
    child = p;
    p = p.parent;
  }
  return { generic: true };
}

/**
 * Findings for one file: [{ node, kind, text, line, exempt }]. `node` is the
 * JsxText / StringLiteral / NoSubstitutionTemplateLiteral / TemplateExpression
 * (or the t() CallExpression for kind 'eager').
 */
export function scanSource(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split('\n');
  const isExempt = line => /i18n-exempt/.test(lines[line] || '') || /i18n-exempt/.test(lines[line - 1] || '');
  const out = [];
  const add = (node, kind, value) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    out.push({ node, kind, text: value.replace(/\s+/g, ' ').trim(), line: line + 1, exempt: isExempt(line) });
  };
  const listSeen = new Map();
  const reported = new Set();
  const isTCall = e => e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 't';
  const isStr = e => e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e));
  // A label table where most entries already use t(): the plain-string rest are labels too.
  function siblings(node) {
    let vals = [];
    if (ts.isObjectLiteralExpression(node)) vals = node.properties.filter(p => ts.isPropertyAssignment(p) && !(propName(p.name) && CODE_KEYS.has(propName(p.name)))).map(p => p.initializer);
    else if (ts.isArrayLiteralExpression(node)) vals = [...node.elements];
    const tn = vals.filter(isTCall).length;
    const strs = vals.filter(e => isStr(e) && /[A-Za-z]{3,}/.test(e.text) && looksTranslatable(e.text.replace(/^[^A-Za-z0-9]+/, '').length ? e.text : ''));
    if (tn >= 2 && tn * 2 >= strs.length) for (const e of strs) pending.push(e);
  }
  const pending = [];
  function visit(node) {
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) siblings(node);
    if (ts.isJsxText(node)) {
      const v = jsxTextValue(node.text);
      // any JSX text with a word is shown as is (no identifier exemptions)
      const vt = v.replace(/\s+/g, ' ').trim();
      if (/[A-Za-z]{2,}/.test(v) && !ALLOW_STRINGS.has(vt) && !/^(\.[a-z]{2,4}|[\w-]+(\.[\w-]+)*\.(org|gov|com|net|us|app|io)(\/[\w\-/.]*)?)$/i.test(vt)) add(node, 'jsx', v);
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && !inFunction(node)) {
      add(node, 'eager', node.getText(sf));
    }
    let value = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text;
    else if (ts.isTemplateExpression(node)) value = [node.head.text, ...node.templateSpans.map(s => s.literal.text)].join('{x}');
    if (value !== null) {
      const c = context(node);
      const probe = value.replace(/\{x\}/g, '0').replace(/\s+/g, ' ').trim();
      const htmlText = () => { let x = value.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\{x\}/g, ' ').replace(/&\w+;/g, ' '); for (const a of ALLOW_STRINGS) x = x.split(a).join(' '); return x; };
      if (!c.skip && /<\/?(html|head|body|div|span|h[1-6]|p|br|table|tr|td|ul|li|strong|b|style|meta)\b[^>]*>/i.test(value) && /[A-Za-z]{2,}[ ,]+[A-Za-z]{2,}/.test(htmlText())) {
        add(node, 'html', value.slice(0, 120));
      } else if (c.user) {
        if (looksTranslatable(probe) && (/\s/.test(probe) || /^[A-Z]/.test(probe) || c.user === 'jsx' || c.user === 'call')) add(node, c.user, value);
      } else if (c.list) {
        const arr = c.list;
        if (!listSeen.has(arr)) {
          const items = arr.elements.filter(e => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e));
          const phrases = items.filter(e => looksTranslatable(e.text) && PHRASE_LIST_ITEM.test(e.text.trim().replace(/^[^A-Za-z]+/, '')));
          listSeen.set(arr, phrases.length >= 2 && phrases.length >= items.length * 0.6);
        }
        // ['code', '⚖️ Label'] tuples: a non-code string next to a code is a label
        const tuple = arr.elements.length === 2 && arr.elements.every(e => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isCallExpression(e)) && arr.elements[0] !== node && /^[a-z_]+$/.test(arr.elements[0].text || '');
        if ((listSeen.get(arr) || tuple) && looksTranslatable(probe) && (PHRASE_LIST_ITEM.test(probe.replace(/^[^A-Za-z]+/, '')) || sentenceLike(probe))) add(node, 'list', value);
        else if (sentenceLike(probe)) add(node, 'text', value);
      } else if (c.generic && sentenceLike(probe)) add(node, 'text', value);
      else if (c.generic && ts.isTemplateExpression(node) && /\s/.test(probe) && /(^|\s)[A-Za-z][a-z]{2,}(\s|$|[.!?,:])/.test(value.replace(/\{x\}/g, ' ')) && looksTranslatable(probe) && !/[<>{};=]|\/\//.test(value.replace(/\{x\}/g, ""))) add(node, "text", value);
      else if (c.generic && ts.isTemplateExpression(node) && /\$\{x\}\/(yr|mo|hr|wk|day|year|month|hour)\b/.test(value)) add(node, "text", value);
      else if (c.generic && !c.inCall && /^[A-Z]{3,}[!.]?$/.test(probe) && !/^(GET|POST|PUT|PATCH|DELETE|HEAD|USD|PDF|JSON|HTML|CSV|DUI|DWI|ICE|SMS|GPS|API|URL|ID|AM|PM|EST|PST|UTC|TN|DV|PI|LLC|INC|AOC|MBE|UCC)$/.test(probe.replace(/[!.]$/, '')) && (ts.isReturnStatement(node.parent) || ts.isConditionalExpression(node.parent))) add(node, 'word', value);
      else if (c.generic && !c.inCall && looksTranslatable(probe) && /^[^A-Za-z]*[A-Z][a-z]{2,}[^A-Za-z]*$/.test(probe) && /[^\x00-\x7F]|[A-Z][a-z]+[.!?…:]?$/.test(probe)) add(node, 'word', value);
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach(s => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  const seen = new Set(out.map(f => f.node));
  for (const e of pending) if (!seen.has(e) && !/^[a-z0-9_]+$/.test(e.text)) { const c = context(e); if (!c.skip) add(e, 'sibling', e.text); }
  return { sf, findings: out };
}

export function scanAll() {
  const findings = [];
  const exempted = [];
  for (const file of listFiles()) {
    const r = rel(file);
    if (ALLOW_FILES[r]) continue;
    const { findings: f } = scanSource(file, fs.readFileSync(file, 'utf8'));
    for (const x of f) (x.exempt ? exempted : findings).push({ file: r, line: x.line, kind: x.kind, text: x.text });
  }
  return { findings, exempted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const CI = args.includes('--ci');
  const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const QUIET = args.includes('--quiet');
  const { findings, exempted } = scanAll();
  const byFile = {};
  for (const f of findings) byFile[f.file] = (byFile[f.file] || 0) + 1;
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ findings, exempted }, null, 2));
  if (!QUIET) {
    for (const f of findings) console.log(`${f.file}:${f.line}  [${f.kind}]  ${f.text.slice(0, 140)}`);
    if (findings.length) {
      console.log('\nBy file:');
      for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${f}`);
    }
  }
  console.log(`i18n-scan: ${findings.length} hard-coded user-facing string(s) in ${Object.keys(byFile).length} file(s); ${exempted.length} line-exempt; ${Object.keys(ALLOW_FILES).length} file(s) and ${ALLOW_STRINGS.size} string(s) allowlisted.`);
  if (CI && findings.length) process.exit(1);
}
