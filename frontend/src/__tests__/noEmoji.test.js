/**
 * noEmoji.test.js — no emoji in UI text. Meanings are shown with Ionicons from
 * components/AppIcon.tsx (ICONS), next to plain translated words.
 *
 * Checks
 *   - every value in src/i18n/{en,es,pt,vi}.json
 *   - every string literal, template literal and JSX text in src/**\/*.ts(x) and App.tsx
 *     (TypeScript AST, so comments are not counted; tests are excluded)
 *
 * "Emoji" = Unicode Extended_Pictographic (minus © ® ™, which are ordinary
 * typography), regional-indicator flags, the emoji variation selector U+FE0F
 * and the keycap U+20E3. Arrows (→), check marks (✓) and bullets (•) are text.
 * Allowlist: none — the language picker shows endonyms, not flags.
 * Scope: the whole app (every source file and every i18n value, no exceptions).
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const LANGS = ['en', 'es', 'pt', 'vi'];

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

function i18nFindings() {
  const out = [];
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(dicts[l])) {
      const found = emojiIn(v);
      if (found.length) out.push(`${l}.json ${k}: ${found.join('')}  ${String(v).slice(0, 60)}`);
    }
  }
  return out;
}

const allFiles = [...walk(SRC), path.join(ROOT, 'App.tsx')];

describe('no emoji in UI text', () => {
  it('scans the whole app', () => {
    expect(allFiles.length).toBeGreaterThan(100);
    expect(allFiles.some(f => f.endsWith(path.join('screens', 'HomeScreen.tsx')))).toBe(true);
  });

  it('no emoji in any string literal / template / JSX text in src', () => {
    expect(allFiles.flatMap(codeFindings)).toEqual([]);
  });

  it('no emoji in any i18n value (en, es, pt, vi)', () => {
    expect(i18nFindings()).toEqual([]);
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
