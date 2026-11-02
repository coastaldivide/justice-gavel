/**
 * services/draftDocs/pdf.js — a draft model (model.js) → PDF, with the bundled subset fonts the
 * Bond Desk PDFs use (services/bondDesk/pdf.js kit(): Inter for Latin / Vietnamese, Noto Sans SC
 * subset for Chinese, DejaVu Sans Arabic subset; Arabic shaped and put in right-to-left order by
 * bondDesk/pdfText.js; characters no bundled font has are written as [U+XXXX] with a note — never
 * an empty box passed off as text).
 * The notice is drawn at the top and the bottom of every page (pages are buffered, then each is
 * revisited), with "Page X of Y" under the bottom one.
 */
import { kit, UNICODE_NOTE } from '../bondDesk/pdf.js';
import { msg } from '../../i18n/index.js';

const M = { top: 78, bottom: 84, left: 60, right: 60 };

/** model → Buffer (.pdf) */
export async function pdfFromModel(model) {
  const { doc, done } = kit(model.title, { bufferPages: true, margins: M, producer: 'Justice Gavel' });
  const rtl = model.lang === 'ar';
  const align = rtl ? 'right' : 'left';
  const width = doc.page.width - M.left - M.right;
  for (const b of model.blocks) {
    switch (b.type) {
      case 'title': doc.font('B').fontSize(15).fillColor('#000').text(b.text, { width, align: 'center', paragraphGap: 12 }); break;
      case 'heading': doc.moveDown(0.4); doc.font('B').fontSize(11.5).fillColor('#000').text(b.text, { width, align, paragraphGap: 6 }); break;
      case 'para': doc.font('R').fontSize(11).fillColor('#000').text(b.text, { width, lineGap: 2, paragraphGap: 9 }); break;
      case 'withheld': doc.font('R').fontSize(10.5).fillColor('#7A4B00').text(b.text, { width, align, paragraphGap: 9 }); break;
      case 'field':
        doc.font('B').fontSize(9.5).fillColor('#444').text(b.label, { width, align });
        doc.font('R').fontSize(11).fillColor('#000').text(b.value, { width, paragraphGap: 6 });
        break;
      case 'source':
        doc.font('R').fontSize(9.5).fillColor('#000').text([b.citation, b.url, b.checked].filter(Boolean).join(' — '), { width, paragraphGap: 5 });
        break;
      case 'signature':
        doc.moveDown(1.5);
        doc.font('R').fontSize(11).fillColor('#000').text(`${b.signature}: ______________________________`, { width, align, paragraphGap: 18 });
        doc.text(`${b.date}: ____________________`, { width, align, paragraphGap: 14 });
        doc.text(`${b.nameLabel}: ${b.name || '______________________________'}`, { width, align });
        break;
      default: break;
    }
  }
  if (doc.unicodeReplaced) { doc.moveDown(0.6); doc.font('R').fontSize(8).fillColor('#444').text(UNICODE_NOTE, { width }); }

  // Header + footer on every page (drawn into the margins, so the bottom margin is lifted while drawing).
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('R').fontSize(7.5).fillColor('#444');
    doc.text(model.notice, M.left, 26, { width, align: rtl ? 'right' : 'center' });
    doc.text(model.notice, M.left, doc.page.height - 74, { width, align: rtl ? 'right' : 'center' });
    doc.text(msg(model.lang, 'docs.page', { n: i - range.start + 1, total: range.count }), M.left, doc.page.height - 30, { width, align: 'center' });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return await done;
}
