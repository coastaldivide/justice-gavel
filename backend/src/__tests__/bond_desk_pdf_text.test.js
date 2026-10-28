/**
 * bond_desk_pdf_text.test.js — pdfText.js: Arabic shaping (presentation forms, lam-alef),
 * bidi order (Arabic right to left, digits and Latin inside it left to right, mirrored
 * brackets), line breaking (spaces, between Chinese characters, long words) and font runs.
 */
import { shapeArabic, bidiClass, resolveLevels, paragraphLevel, visualOrder, layoutParagraph } from '../services/bondDesk/pdfText.js';

const cp = (...xs) => String.fromCodePoint(...xs);
const outs = (s) => shapeArabic(s).map((u) => u.out).join('');
const fontFor = (ch) => (/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(ch) ? 'arabic' : /[\u3000-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 'cjk' : 'latin');
const measure = (font, s) => [...s].length * (font === 'cjk' ? 10 : 5);
const visual = (s, opts = {}) => layoutParagraph(s, { fontFor, measure, ...opts });
const lineText = (line) => line.runs.map((r) => r.text).join('');

describe('Arabic shaping', () => {
  test('initial, medial and final forms join a word', () => {
    // meem initial, hah medial, meem medial, dal final
    expect(outs('محمد')).toBe(cp(0xFEE3, 0xFEA4, 0xFEE4, 0xFEAA));
    // ain initial, lam medial, yeh final
    expect(outs('علي')).toBe(cp(0xFECB, 0xFEE0, 0xFEF2));
  });
  test('right-joining letters do not join the next letter', () => {
    // dal, alef, reh: each stands alone (dal and alef join nothing on their left)
    expect(outs('دار')).toBe(cp(0xFEA9, 0xFE8D, 0xFEAD));
    // beh initial + alef final, then beh isolated
    expect(outs('باب')).toBe(cp(0xFE91, 0xFE8E, 0xFE8F));
  });
  test('lam + alef become one ligature, isolated or final', () => {
    expect(outs('لا')).toBe(cp(0xFEFB));
    expect(outs('سلام')).toBe(cp(0xFEB3, 0xFEFC, 0xFEE1));
    expect(outs('لأ')).toBe(cp(0xFEF7));
    const u = shapeArabic('سلام');
    expect(u[1].src).toBe('لا');   // the original letters are kept with the ligature
  });
  test('marks are transparent for joining', () => {
    // beh initial, kasra, beh final
    expect(outs('بِب')).toBe(cp(0xFE91, 0x0650, 0xFE90));
  });
  test('Persian letters use Presentation Forms-A', () => {
    expect(outs('پی')).toBe(cp(0xFB58, 0xFBFD));
  });
  test('NFKC of the shaped text is the original text', () => {
    for (const s of ['محمد علي', 'سلام عليكم', 'الكفالة', 'پرویز']) expect(outs(s).normalize('NFKC')).toBe(s.normalize('NFKC'));
  });
});

describe('bidi', () => {
  test('classes', () => {
    expect(['a', 'م', '1', '١', ' ', ',', '+', '$', '王', cp(0x064E)].map(bidiClass)).toEqual(['L', 'AL', 'EN', 'AN', 'WS', 'CS', 'ES', 'ET', 'L', 'NSM']);
  });
  test('the first strong character sets the paragraph direction', () => {
    expect(paragraphLevel(['WS', 'AL', 'L'])).toBe(1);
    expect(paragraphLevel(['EN', 'L', 'AL'])).toBe(0);
    expect(paragraphLevel(['EN'])).toBe(0);
  });
  test('numbers inside Arabic get an even level (drawn left to right)', () => {
    const cls = [...'رقم 12'].map(bidiClass);
    expect(resolveLevels(cls, 1)).toEqual([1, 1, 1, 1, 2, 2]);
  });
  test('visual order reverses odd runs, keeps even runs inside them', () => {
    expect(visualOrder([1, 1, 1, 1, 2, 2])).toEqual([4, 5, 3, 2, 1, 0]);
    expect(visualOrder([0, 0, 1, 1, 0])).toEqual([0, 1, 3, 2, 4]);
  });
});

describe('layoutParagraph', () => {
  test('an Arabic name: right to left, right-aligned', () => {
    const lay = visual('محمد علي');
    expect(lay.rtl).toBe(true);
    expect(lay.arabicOnly).toBe(true);
    expect(lineText(lay.lines[0])).toBe([...outs('محمد علي')].reverse().join(''));
  });
  test('a signature line: "/s/" first, then the Arabic name in right-to-left order', () => {
    const lay = visual('/s/ محمد علي');
    expect(lay.rtl).toBe(false);
    expect(lay.arabicOnly).toBe(false);
    expect(lineText(lay.lines[0])).toBe(`/s/ ${[...outs('محمد علي')].reverse().join('')}`);
    expect(lay.lines[0].runs.map((r) => r.font)).toEqual(['latin', 'arabic', 'latin', 'arabic']);
  });
  test('digits and Latin inside Arabic stay left to right', () => {
    const line = lineText(visual('دفعة 12 من 2026').lines[0]);
    expect(line.startsWith('2026 ')).toBe(true);
    expect(line).toContain(' 12 ');
    const mixed = lineText(visual('Bond رقم 12 للمتهم').lines[0]);
    expect(mixed.startsWith('Bond ')).toBe(true);
    expect(mixed).toBe(`Bond ${[...outs('للمتهم')].reverse().join('')} 12 ${[...outs('رقم')].reverse().join('')}`);
  });
  test('brackets are mirrored in right-to-left text', () => {
    const line = lineText(visual('علي (أ)').lines[0]);
    expect(line.startsWith(`(${outs('أ')})`)).toBe(true);
  });
  test("direction: 'ltr' keeps an English line left to right", () => {
    const lay = visual('محمد علي (indemnitor)', { direction: 'ltr' });
    expect(lay.rtl).toBe(false);
    expect(lineText(lay.lines[0]).endsWith(' (indemnitor)')).toBe(true);
    expect(visual('محمد علي (indemnitor)').arabicOnly).toBe(false);
  });
  test('Chinese wraps between characters; Latin at spaces; a long word by character', () => {
    expect(visual('王小明王小明王', { width: 30 }).lines.map(lineText)).toEqual(['王小明', '王小明', '王']);
    expect(visual('Ana Li Bo', { width: 30 }).lines.map(lineText)).toEqual(['Ana Li', 'Bo']);
    expect(visual('abcdefghij', { width: 20 }).lines.map(lineText)).toEqual(['abcd', 'efgh', 'ij']);
  });
  test('wrapped Arabic keeps logical line order (first words on the first line)', () => {
    const lay = visual('محمد علي حسن', { width: 40 });
    expect(lay.lines.length).toBe(2);
    const logical = (line) => [...lineText(line)].reverse().join('').normalize('NFKC');
    expect(logical(lay.lines[0])).toBe('محمد علي');
    expect(logical(lay.lines[1])).toBe('حسن');
  });
  test('runs are split by font and measured', () => {
    const { lines } = visual('Ana 王 Li');
    expect(lines[0].runs.map((r) => [r.font, r.text])).toEqual([['latin', 'Ana '], ['cjk', '王'], ['latin', ' Li']]);
    expect(lines[0].width).toBe(4 * 5 + 10 + 3 * 5);
  });
});
