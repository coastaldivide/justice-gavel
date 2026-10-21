/**
 * noEmoji.test.js — no emoji in UI text. Meanings are shown with Ionicons from
 * components/AppIcon.tsx (ICONS), next to plain translated words.
 *
 * Checks
 *   - every value in src/i18n/{en,es,pt,vi}.json
 *   - every string literal, template literal and JSX text in src/**\/*.ts(x)
 *     (TypeScript AST, so comments are not counted; tests are excluded)
 *
 * "Emoji" = Unicode Extended_Pictographic (minus © ® ™, which are ordinary
 * typography), regional-indicator flags, the emoji variation selector U+FE0F
 * and the keycap U+20E3. Arrows (→), check marks (✓) and bullets (•) are text.
 * Allowlist: none — the language picker shows endonyms, not flags.
 *
 * PASS 1 SCOPE (temporary): the UI pass is done in two passes. Pass 1 fixed the
 * core path (PASS1_SCOPE below: those files, plus every i18n key they use).
 * Pass 2 converts the rest of the app and DELETES PASS1_SCOPE, after which this
 * test checks every file and every i18n value. The first test always reports
 * the app-wide count so progress is visible.
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const LANGS = ['en', 'es', 'pt', 'vi'];

// Remove in pass 2 (then the whole app is checked).
const PASS1_SCOPE = [
  'screens/HomeScreen.tsx', 'screens/JustArrestedScreen.tsx', 'screens/RightsCardScreen.tsx',
  'screens/HelpNowScreen.tsx', 'screens/EmergencyScreen.tsx', 'screens/EmergencyShareScreen.tsx',
  'screens/CrisisResourcesScreen.tsx', 'screens/CourtDatesScreen.tsx', 'screens/CourtDateDetailScreen.tsx',
  'navigation/AppNavigator.tsx',
  'components/AppIcon.tsx', 'components/EmergencyStrip.tsx', 'components/FloatingSOSButton.tsx',
  'components/ContactActions.tsx', 'components/LegalSource.tsx', 'components/SignInNeeded.tsx',
  'components/ToastProvider.tsx', 'components/Toast.tsx', 'components/OfflineBanner.tsx',
  'components/ErrorBoundary.tsx', 'services/sos.ts', 'services/corePath.ts',
];

const EMOJI = /(?![©®™])[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️⃣]/gu;
const emojiIn = (s) => [...new Set(String(s).match(EMOJI) || [])];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return /\.(tsx?)$/.test(e.name) ? [p] : [];
  });
}

/** Emoji in the file's string literals / template parts / JSX text (comments excluded). */
function codeFindings(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const K = ts.SyntaxKind;
  const kinds = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail, K.JsxText]);
  (function visit(node) {
    if (kinds.has(node.kind)) {
      const raw = node.kind === K.JsxText ? node.getText(sf) : node.text;
      const found = emojiIn(raw);
      if (found.length) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        out.push(`${path.relative(ROOT, file)}:${line + 1} ${found.join('')}  ${raw.trim().slice(0, 60)}`);
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

const dicts = Object.fromEntries(LANGS.map(l => [l, JSON.parse(fs.readFileSync(path.join(SRC, 'i18n', `${l}.json`), 'utf8'))]));

/** i18n keys a source file uses: literal 'key' strings that exist, and t(`prefix_${…}`) families. */
function keysUsedBy(file) {
  const src = fs.readFileSync(file, 'utf8');
  const en = dicts.en;
  const keys = new Set();
  for (const m of src.matchAll(/'([a-z][a-zA-Z0-9]*_[A-Za-z0-9_]+)'/g)) if (m[1] in en) keys.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*`([a-z][a-zA-Z0-9]*_[A-Za-z0-9_]*)\$\{/g)) {
    for (const k of Object.keys(en)) if (k.startsWith(m[1])) keys.add(k);
  }
  return keys;
}

function i18nFindings(onlyKeys) {
  const out = [];
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(dicts[l])) {
      if (onlyKeys && !onlyKeys.has(k)) continue;
      const found = emojiIn(v);
      if (found.length) out.push(`${l}.json ${k}: ${found.join('')}  ${String(v).slice(0, 60)}`);
    }
  }
  return out;
}

const allFiles = walk(SRC);
const scopeFiles = typeof PASS1_SCOPE === 'undefined' ? allFiles : PASS1_SCOPE.map(f => path.join(SRC, f));

describe('no emoji in UI text', () => {
  it('reports the app-wide count (pass 1 scope still active until pass 2)', () => {
    const code = allFiles.flatMap(codeFindings);
    const i18n = i18nFindings(null);
    console.log(`[noEmoji] app-wide: ${code.length} code literals with emoji in ${new Set(code.map(c => c.split(':')[0])).size} files, `
      + `${i18n.length} i18n values with emoji (${i18n.length / LANGS.length} keys × ${LANGS.length} languages); `
      + `checked scope: ${scopeFiles.length} files`);
    expect(code.length).toBeGreaterThanOrEqual(0);
  });

  it('the scoped files exist', () => {
    expect(scopeFiles.filter(f => !fs.existsSync(f))).toEqual([]);
  });

  it('no emoji in string literals / JSX text of the checked files', () => {
    expect(scopeFiles.flatMap(codeFindings)).toEqual([]);
  });

  it('no emoji in the i18n values those files use (all 4 languages)', () => {
    const keys = typeof PASS1_SCOPE === 'undefined' ? null : new Set(scopeFiles.flatMap(f => [...keysUsedBy(f)]));
    expect(i18nFindings(keys)).toEqual([]);
  });

  it('the scanner catches a planted emoji and ignores comments (self-test)', () => {
    const tmp = path.join(require('os').tmpdir(), `planted-${process.pid}.tsx`);
    fs.writeFileSync(tmp, "// 🚨 a comment is fine\nconst a = <Text>📞 {t('x')}</Text>;\nconst b = `⚖️ ${a}`;\nconst c = 'Call → ✓ © 2026';\n");
    const found = codeFindings(tmp);
    fs.unlinkSync(tmp);
    expect(found.length).toBe(2);
    expect(found.join('\n')).toMatch(/📞/);
    expect(found.join('\n')).toMatch(/⚖/);
  });
});
