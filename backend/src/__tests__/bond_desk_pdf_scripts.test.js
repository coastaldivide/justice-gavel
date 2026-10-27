/**
 * bond_desk_pdf_scripts.test.js — Bond Desk PDFs with names and answers in any of the app's
 * eight languages. The bundled Inter fonts draw Latin, Vietnamese, Haitian Creole and Tagalog
 * text; they have no Arabic or Chinese letters, and no font with them ships in node_modules.
 * Such text must never come out as empty boxes that look like text: each run is written as
 * its Unicode code points ("[U+738B U+5C0F U+660E]") and the page says what that means. The
 * certificate stays in English.
 */
import { jest } from '@jest/globals';
import { PDFDocument } from 'pdf-lib';
import PDFKit from 'pdfkit';
import {
  pdfSafeText, canDraw, certificatePdf, receiptPdf, preparePdf, signPdf, kit, UNICODE_NOTE, FIELD_NOT_SHOWN,
} from '../services/bondDesk/pdf.js';

const CERT = {
  document_name: 'Indemnity agreement', prepared_sha256: 'ab'.repeat(32), role: 'indemnitor', sent_to: '•••-•••-0199',
  events: [{ at: '2026-10-27 15:00', label: 'Signed' }], ip: '203.0.113.9', user_agent: 'Test', consent_lines: ['I agree.'],
  agency: 'Alpha Bail', bond_label: 'Bond #12',
};

/** Every string pdfkit was asked to draw while `fn` ran. */
async function drawn(fn) {
  const spy = jest.spyOn(PDFKit.prototype, 'text');
  try {
    const buf = await fn();
    return { buf, texts: spy.mock.calls.map((c) => c[0]).filter((v) => typeof v === 'string') };
  } finally { spy.mockRestore(); }
}
const drawable = (s) => [...s].every((ch) => /[\n\r\t ]/.test(ch) || canDraw(ch));

async function formPdf(fields) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  let y = 700;
  for (const [name, max] of fields) {
    const f = form.createTextField(name);
    if (max) f.setMaxLength(max);
    f.addToPage(page, { x: 50, y, width: 400, height: 20 });
    y -= 40;
  }
  return Buffer.from(await doc.save());
}

describe('pdfSafeText', () => {
  test('Latin-script languages print as they are', () => {
    for (const s of ['Nguyễn Văn An', 'Jean-Baptiste Pierre-Louis, Pòtoprens', 'Juan dela Cruz — Quezon', 'María José Peña']) {
      expect(pdfSafeText(s)).toEqual({ text: s, replaced: false });
    }
  });
  test('Chinese and Arabic runs become Unicode code points, never boxes', () => {
    expect(pdfSafeText('王小明')).toEqual({ text: '[U+738B U+5C0F U+660E]', replaced: true });
    expect(pdfSafeText('محمد علي')).toEqual({ text: '[U+0645 U+062D U+0645 U+062F U+0020 U+0639 U+0644 U+064A]', replaced: true });
    expect(pdfSafeText('Ana 王 Li').text).toBe('Ana [U+738B] Li');
    expect(pdfSafeText('Juan 👍').text).toBe('Juan [U+1F44D]');
  });
  test('direction marks and zero-width characters are dropped (nothing to draw)', () => {
    expect(pdfSafeText('‏Ana‎').text).toBe('Ana');
  });
  test('the result is always drawable and decodes back to the exact text', () => {
    for (const s of ['王小明', 'محمد علي', 'Ana 王 Li', 'لي 李']) {
      const { text } = pdfSafeText(s);
      expect(drawable(text)).toBe(true);
      const back = text.replace(/\[((?:U\+[0-9A-F]{4,6} ?)+)\]/g, (m, cps) => cps.trim().split(' ').map((c) => String.fromCodePoint(parseInt(c.slice(2), 16))).join(''));
      expect(back).toBe(s);
    }
  });
});

describe('certificate, receipt and report pages', () => {
  test('an Arabic signer: valid PDF, English certificate, only drawable text, the note explains the codes', async () => {
    const { buf, texts } = await drawn(() => certificatePdf({ ...CERT, signer_name: 'محمد علي', typed_name: 'محمد علي', consent_lang: 'Arabic' }));
    expect(Buffer.from(buf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect((await PDFDocument.load(buf)).getPageCount()).toBeGreaterThan(0);
    expect(texts.every(drawable)).toBe(true);
    expect(texts).toContain('Electronic Signature Certificate');
    expect(texts).toContain('/s/ [U+0645 U+062D U+0645 U+062F U+0020 U+0639 U+0644 U+064A]');
    expect(texts.some((t) => t.includes('shown to the signer in Arabic; English text below'))).toBe(true);
    expect(texts).toContain(UNICODE_NOTE);
  });
  test('a Chinese payer on a receipt', async () => {
    const { texts } = await drawn(() => receiptPdf({ title: 'Payment receipt', receipt_no: 'R-1', agency: 'Alpha Bail', date: '10/27/2026',
      lines: [['Paid by', '王小明'], ['Amount', '$125.00']], footer: 'Thank you.' }));
    expect(texts.every(drawable)).toBe(true);
    expect(texts).toContain('[U+738B U+5C0F U+660E]');
    expect(texts).toContain(UNICODE_NOTE);
  });
  test('Latin-only pages carry no note', async () => {
    const { texts } = await drawn(() => certificatePdf({ ...CERT, signer_name: 'Nguyễn Văn An', typed_name: 'Nguyễn Văn An', consent_lang: 'Vietnamese' }));
    expect(texts).toContain('/s/ Nguyễn Văn An');
    expect(texts).not.toContain(UNICODE_NOTE);
  });
  test('kit(): every page Bond Desk writes goes through the same filter', async () => {
    const { doc, done } = kit('t');
    doc.text('Defendant: 李');
    expect(doc.unicodeReplaced).toBe(true);
    doc.end();
    await done;
  });
});

describe('form fields on the agent\'s PDF', () => {
  test('a Chinese answer is filled as code points; a field too short for them says where the text is', async () => {
    const src = await formPdf([['defendant.name', null], ['short', 12], ['signature.name', null]]);
    const prepared = await preparePdf(src, { 'defendant.name': '王小明', short: '王小明' });
    const form = (await PDFDocument.load(prepared)).getForm();
    expect(form.getTextField('defendant.name').getText()).toBe('[U+738B U+5C0F U+660E]');
    expect(form.getTextField('short').getText()).toBe(FIELD_NOT_SHOWN.slice(0, 12));
    const cert = await certificatePdf({ ...CERT, signer_name: '王小明', typed_name: '王小明', consent_lang: 'Simplified Chinese' });
    const signed = await signPdf(prepared, { 'signature.name': '/s/ 王小明' }, cert);
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(2);
  });
  test('the length limit still applies to what the person typed', async () => {
    const src = await formPdf([['short', 3]]);
    await expect(preparePdf(src, { short: 'Nguyễn' })).rejects.toMatchObject({ code: 'field_too_long' });
  });
});
