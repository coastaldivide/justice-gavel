/**
 * bond_desk_pdf_scripts.test.js — Bond Desk PDFs with names and answers in any of the app's
 * eight languages. Inter draws the Latin-script languages; the bundled Noto Sans SC subset
 * draws Chinese and the DejaVu Sans Arabic subset draws Arabic (shaped, right to left). The
 * text is read back from the PDF itself (helpers/pdfText.js: content streams + ToUnicode),
 * so these tests see what a reader sees: the right characters, no .notdef boxes, no
 * "[U+…]" codes for Chinese or Arabic, and fonts subset so files stay small. Only text no
 * bundled font has (emoji, Hebrew, Devanagari …) is written as Unicode code points, with a
 * note. The certificate stays in English.
 */
import { jest } from '@jest/globals';
import { PDFDocument } from 'pdf-lib';
import PDFKit from 'pdfkit';
import {
  pdfSafeText, canDraw, fontFor, certificatePdf, receiptPdf, preparePdf, signPdf, kit, UNICODE_NOTE, FIELD_NOT_SHOWN,
} from '../services/bondDesk/pdf.js';
import { extractPdfText, rtlLogical, UNMAPPED } from './helpers/pdfText.js';

const CERT = {
  document_name: 'Indemnity agreement', prepared_sha256: 'ab'.repeat(32), role: 'indemnitor', sent_to: '•••-•••-0199',
  events: [{ at: '2026-10-27 15:00', label: 'Signed' }], ip: '203.0.113.9', user_agent: 'Test', consent_lines: ['I agree.'],
  agency: 'Alpha Bail', bond_label: 'Bond #12',
};
const AR_NAME = 'محمد علي';
const ZH_NAME = '王小明';
// The Arabic name as drawn left to right: "علي" then "محمد", each letter in its joined form.
const AR_VISUAL = String.fromCodePoint(0xFEF2, 0xFEE0, 0xFECB, 0x20, 0xFEAA, 0xFEE4, 0xFEA4, 0xFEE3);
const KB = 1024;

/** Page texts joined, plus checks every PDF here must pass: no empty boxes, every glyph maps back to text. */
async function read(buf) {
  expect(Buffer.from(buf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  const { pages, shows } = await extractPdfText(buf);
  expect(shows.filter((s) => s.cids.includes(0) && !s.font.includes('Helvetica'))).toEqual([]);   // glyph 0 = .notdef box
  expect(shows.filter((s) => s.text.includes(UNMAPPED))).toEqual([]);
  const all = pages.join('\n');
  return { pages, shows, all, flat: all.replace(/\n/g, ''), squashed: all.replace(/\s+/g, '') };
}
const squash = (s) => s.replace(/\s+/g, '');

async function formPdf(fields) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  let y = 700;
  for (const [name, max, multiline] of fields) {
    const f = form.createTextField(name);
    if (max) f.setMaxLength(max);
    if (multiline) f.enableMultiline();
    f.addToPage(page, { x: 50, y, width: 400, height: multiline ? 60 : 20 });
    if (multiline) f.setFontSize(10);
    y -= 80;
  }
  return Buffer.from(await doc.save());
}

describe('pdfSafeText and fontFor', () => {
  test('Latin-script languages, Chinese and Arabic print as they are', () => {
    for (const s of ['Nguyễn Văn An', 'Jean-Baptiste Pierre-Louis, Pòtoprens', 'Juan dela Cruz — Quezon', 'María José Peña',
      ZH_NAME, AR_NAME, 'Ana 王 Li', 'لي 李', '張偉', 'پرویز', '北京市朝阳区，电话：555-0100。']) {
      expect(pdfSafeText(s)).toEqual({ text: s, replaced: false });
    }
  });
  test('scripts no bundled font has become Unicode code points, never boxes', () => {
    expect(pdfSafeText('Juan 👍').text).toBe('Juan [U+1F44D]');
    expect(pdfSafeText('שלום').text).toBe('[U+05E9 U+05DC U+05D5 U+05DD]');
    expect(pdfSafeText('राम').text).toBe('[U+0930 U+093E U+092E]');
    expect(pdfSafeText(`王${String.fromCodePoint(0x3400)}`)).toEqual({ text: '王[U+3400]', replaced: true });   // CJK Extension A
    expect(pdfSafeText('محمد 👍 王').text).toBe('محمد [U+1F44D] 王');
  });
  test('direction marks and zero-width characters are dropped (nothing to draw)', () => {
    expect(pdfSafeText(`${String.fromCodePoint(0x200F)}Ana${String.fromCodePoint(0x200E)}`).text).toBe('Ana');
  });
  test('each character goes to the font that has it, Inter first', () => {
    expect(['A', 'ễ', '1', '王', '，', 'م', String.fromCodePoint(0xFEE3), '١', '👍'].map(fontFor))
      .toEqual(['latin', 'latin', 'latin', 'cjk', 'cjk', 'arabic', 'arabic', 'arabic', null]);
  });
  test('the result is always drawable and decodes back to the exact text', () => {
    for (const s of ['王小明 👍', 'שלום محمد', 'Ana 🙂 Li']) {
      const { text } = pdfSafeText(s);
      expect([...text].every((ch) => /\s/.test(ch) || canDraw(ch))).toBe(true);
      const back = text.replace(/\[((?:U\+[0-9A-F]{4,6} ?)+)\]/g, (m, cps) => cps.trim().split(' ').map((c) => String.fromCodePoint(parseInt(c.slice(2), 16))).join(''));
      expect(back).toBe(s);
    }
  });
});

describe('certificate, receipt and report pages', () => {
  let latinCert;
  beforeAll(async () => { latinCert = await certificatePdf({ ...CERT, signer_name: 'Nguyễn Văn An', typed_name: 'Nguyễn Văn An', consent_lang: 'Vietnamese' }); });

  test('an Arabic signer: the name joined and right to left, English certificate, no codes, no note', async () => {
    const buf = await certificatePdf({ ...CERT, signer_name: AR_NAME, typed_name: AR_NAME, consent_lang: 'Arabic', consent_lines: ['I agree.', 'أوافق على التوقيع الإلكتروني'] });
    expect((await PDFDocument.load(buf)).getPageCount()).toBe(1);
    const { flat, all } = await read(buf);
    expect(all).toContain('Electronic Signature Certificate');
    expect(flat).toContain(`/s/ ${AR_VISUAL}`);          // signature line: "/s/", then the name read right to left
    expect(flat).toContain(`${AR_VISUAL} (indemnitor)`);  // signer row stays an English line
    expect(rtlLogical(flat)).toContain('أوافق على التوقيع الإلكتروني');
    expect(flat).toContain('shown to the signer in Arabic; English text below');
    expect(all).not.toContain('[U+');
    expect(squash(all)).not.toContain(squash(UNICODE_NOTE));
    expect(buf.length - latinCert.length).toBeLessThan(40 * KB);
  });
  test('a Chinese signer: the characters themselves, a few kilobytes more than a Latin name', async () => {
    const buf = await certificatePdf({ ...CERT, signer_name: ZH_NAME, typed_name: ZH_NAME, consent_lang: 'Simplified Chinese' });
    const { all, flat, shows } = await read(buf);
    expect(flat).toContain(`/s/ ${ZH_NAME}`);
    expect(flat).toContain(`${ZH_NAME} (indemnitor)`);
    expect(all).not.toContain('[U+');
    expect(shows.some((s) => /NotoSansSC/.test(s.font) && s.text === ZH_NAME)).toBe(true);
    expect(buf.length - latinCert.length).toBeLessThan(40 * KB);   // the CJK font is subset, not the 7 MB file
  });
  test('Latin-only pages carry no note and no Chinese or Arabic font', async () => {
    const { all, shows } = await read(latinCert);
    expect(all).toContain('/s/ Nguyễn Văn An');
    expect(squash(all)).not.toContain(squash(UNICODE_NOTE));
    expect(shows.every((s) => /Inter/.test(s.font))).toBe(true);
  });
  test('a receipt: Chinese payer, Arabic agency (bold) and memo, an emoji as a code with the note', async () => {
    const buf = await receiptPdf({ title: 'Payment receipt', receipt_no: 'R-1', agency: 'كفالات الأمل', date: '10/27/2026',
      lines: [['Paid by', ZH_NAME], ['Indemnitor', AR_NAME], ['Memo', 'دفعة رقم 3 من 10'], ['Note', 'Juan 👍'], ['Amount', '$125.00']], footer: 'Thank you. 谢谢。' });
    const { all, flat, shows } = await read(buf);
    expect(all).toContain(ZH_NAME);
    expect(flat).toContain(AR_VISUAL);
    expect(rtlLogical(flat)).toContain('كفالات الأمل');
    expect(shows.some((s) => /DejaVuSansArabic-PdfSubset-Bold/.test(s.font))).toBe(true);
    expect(flat).toContain('10 ');                        // digits inside Arabic stay left to right
    expect(rtlLogical(flat)).toContain('دفعة رقم');
    expect(all).toContain('谢谢。');
    expect(all).toContain('Juan [U+1F44D]');
    expect(squash(all)).toContain(squash(UNICODE_NOTE));
  });
  test('kit(): an Arabic-only line is right-aligned; a mixed line starts at the margin', async () => {
    const spy = jest.spyOn(PDFKit.prototype, 'text');
    try {
      const { doc, done } = kit('t');
      doc.text(AR_NAME);
      doc.text(`Defendant: ${AR_NAME}`);
      doc.end();
      await done;
      const drawnAt = spy.mock.calls.filter((c) => typeof c[1] === 'number').map((c) => [c[0], c[1]]);
      const right = drawnAt.find(([t]) => t === AR_VISUAL.split(' ')[1]);   // "محمد", drawn last on the line
      expect(right[1]).toBeGreaterThan(400);
      expect(drawnAt.find(([t]) => t === 'Defendant: ')[1]).toBe(54);
    } finally { spy.mockRestore(); }
  });
  test('kit(): only text with no bundled font sets the note flag; long Arabic text flows onto new pages', async () => {
    const { doc, done } = kit('t');
    doc.text(`Defendant: 李 ${AR_NAME}`);
    expect(doc.unicodeReplaced).toBe(false);
    for (let i = 0; i < 70; i++) doc.text(`${i} ${AR_NAME} ${ZH_NAME}`);
    doc.text('Juan 👍');
    expect(doc.unicodeReplaced).toBe(true);
    doc.end();
    const buf = await done;
    expect((await PDFDocument.load(buf)).getPageCount()).toBe(2);
    const { flat } = await read(buf);
    // "69 محمد علي 王小明" starts with Arabic (the first strong letter): a right-to-left line
    expect(flat).toContain(`${ZH_NAME} ${AR_VISUAL} 69`);
  });
});

describe('form fields on the agent\'s PDF', () => {
  let src;
  let latinPrepared;
  let latinSigned;
  beforeAll(async () => {
    src = await formPdf([['defendant.name'], ['indemnitor.name'], ['notes', null, true], ['short', 12], ['signature.name']]);
    latinPrepared = await preparePdf(src, { 'defendant.name': 'Nguyễn Văn An' });
    latinSigned = await signPdf(latinPrepared, { 'signature.name': '/s/ Nguyễn Văn An' }, await certificatePdf({ ...CERT, signer_name: 'Nguyễn Văn An', typed_name: 'Nguyễn Văn An' }));
  });

  test('Chinese and Arabic answers: the exact text as the value, drawn with real glyphs, subset fonts', async () => {
    const prepared = await preparePdf(src, {
      'defendant.name': ZH_NAME, 'indemnitor.name': AR_NAME,
      notes: 'Bond رقم 12 للمتهم. 他的电话是 555-0100。 وعنوانه في الرياض حي النخيل منذ سنة 2019',
    });
    const form = (await PDFDocument.load(prepared)).getForm();
    expect(form.getTextField('defendant.name').getText()).toBe(ZH_NAME);
    expect(form.getTextField('indemnitor.name').getText()).toBe(AR_NAME);
    const { all, flat } = await read(prepared);
    expect(all).toContain(ZH_NAME);
    expect(flat).toContain(AR_VISUAL);
    expect(flat).toContain('他的电话是 555-0100。');
    expect(rtlLogical(flat)).toContain('وعنوانه في الرياض');
    expect(all).not.toContain('[U+');
    expect(prepared.length - latinPrepared.length).toBeLessThan(60 * KB);
  });
  test('signed copy: "/s/ name" flattened in the right fonts, certificate appended, small', async () => {
    for (const [name, visual] of [[ZH_NAME, ZH_NAME], [AR_NAME, AR_VISUAL]]) {
      const prepared = await preparePdf(src, { 'defendant.name': name });
      const cert = await certificatePdf({ ...CERT, signer_name: name, typed_name: name, consent_lang: 'Arabic' });
      const signed = await signPdf(prepared, { 'signature.name': `/s/ ${name}` }, cert);
      const doc = await PDFDocument.load(signed);
      expect(doc.getPageCount()).toBe(2);
      expect(doc.getForm().getFields()).toHaveLength(0);   // flattened
      const { pages } = await read(signed);
      expect(pages[0].replace(/\n/g, '')).toContain(`/s/ ${visual}`);
      expect(pages[1].replace(/\n/g, '')).toContain(`/s/ ${visual}`);
      expect(pages.join('')).not.toContain('[U+');
      expect(signed.length - latinSigned.length).toBeLessThan(80 * KB);
    }
  });
  test('an emoji is still filled as code points; a field too short for them says where the text is', async () => {
    const prepared = await preparePdf(src, { 'defendant.name': 'Juan 👍', short: 'Ana 👍👍👍' });
    const form = (await PDFDocument.load(prepared)).getForm();
    expect(form.getTextField('defendant.name').getText()).toBe('Juan [U+1F44D]');
    expect(form.getTextField('short').getText()).toBe(FIELD_NOT_SHOWN.slice(0, 12));
    const { all } = await read(prepared);
    expect(all).toContain('Juan [U+1F44D]');
  });
  test('the length limit still applies to what the person typed', async () => {
    const short = await formPdf([['short', 3]]);
    await expect(preparePdf(short, { short: 'Nguyễn' })).rejects.toMatchObject({ code: 'field_too_long' });
    await expect(preparePdf(short, { short: '王小明' })).resolves.toBeInstanceOf(Buffer);
  });
});
