/**
 * services/draftDocs/docx.js — a draft model (model.js) → a Word document (.docx, OOXML /
 * ECMA-376 WordprocessingML), written by hand: the repo has no docx library and no package is
 * added. The package holds only the required parts: [Content_Types].xml, _rels/.rels,
 * word/document.xml (+ its rels), word/styles.xml, word/header1.xml, word/footer1.xml. Zipped
 * with zip.js (deflate). Tests unzip it with unzipper and parse every part as XML.
 *
 * Scripts: Word draws the text with the reader's fonts — the style names Calibri (Latin), SimSun /
 * Microsoft YaHei (Chinese: w:eastAsia) and Arial (Arabic: w:cs); a paragraph with Arabic letters
 * is a right-to-left paragraph (w:bidi) and its runs are marked w:rtl, so Word orders and shapes
 * it itself (unlike PDF, nothing has to be pre-shaped here).
 * The notice is the header AND the footer of every page; the footer adds "Page X of Y" (PAGE /
 * NUMPAGES fields).
 */
import { writeZip } from './zip.js';
import { msg } from '../../i18n/index.js';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** XML text: escaped, characters XML 1.0 forbids removed. */
export function xmlText(s) {
  return String(s ?? '')
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const runProps = ({ bold = false, size = null, color = null, rtl = false } = {}) => {
  const p = [];
  if (bold) p.push('<w:b/><w:bCs/>');
  if (color) p.push(`<w:color w:val="${color}"/>`);
  if (size) p.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
  if (rtl) p.push('<w:rtl/>');
  return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : '';
};

/** One run of text; "\n" becomes a line break inside the paragraph. */
function runs(text, opts = {}) {
  const rtl = ARABIC.test(String(text));
  const rp = runProps({ ...opts, rtl });
  return String(text ?? '').split('\n')
    .map((line, i) => `${i ? `<w:r>${rp}<w:br/></w:r>` : ''}<w:r>${rp}<w:t xml:space="preserve">${xmlText(line)}</w:t></w:r>`)
    .join('');
}

function para(text, { bold = false, size = null, color = null, align = null, spaceAfter = 160, keepNext = false } = {}) {
  const rtl = ARABIC.test(String(text));
  const pp = [];
  if (keepNext) pp.push('<w:keepNext/>');
  if (rtl) pp.push('<w:bidi/>');
  pp.push(`<w:spacing w:after="${spaceAfter}"/>`);
  if (align) pp.push(`<w:jc w:val="${align}"/>`);
  return `<w:p><w:pPr>${pp.join('')}</w:pPr>${runs(text, { bold, size, color })}</w:p>`;
}

function blockXml(b) {
  switch (b.type) {
    case 'title': return para(b.text, { bold: true, size: 32, align: 'center', spaceAfter: 240 });
    case 'heading': return para(b.text, { bold: true, size: 24, keepNext: true, spaceAfter: 120 });
    case 'para': return para(b.text);
    case 'withheld': return para(b.text, { color: '7A4B00' });
    case 'field': return `<w:p><w:pPr>${ARABIC.test(b.value) ? '<w:bidi/>' : ''}<w:spacing w:after="80"/></w:pPr>${runs(`${b.label}: `, { bold: true })}${runs(b.value)}</w:p>`;
    case 'source': return para([b.citation, b.url, b.checked].filter(Boolean).join(' — '), { size: 20 });
    case 'signature': return [
      para(' ', { spaceAfter: 360 }),
      para(`${b.signature}: ______________________________`, { spaceAfter: 360 }),
      para(`${b.date}: ____________________`, { spaceAfter: 240 }),
      para(`${b.nameLabel}: ${b.name || '______________________________'}`),
    ].join('');
    default: return '';
  }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

function headerXml(notice) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${para(notice, { size: 16, color: '444444', spaceAfter: 0 })}</w:hdr>`;
}

function footerXml(notice, lang) {
  // "Page {n} of {total}" in the person's language, with Word's PAGE / NUMPAGES fields in place of the numbers
  const tpl = msg(lang, 'docs.page', { n: '\u0001', total: '\u0002' });
  const field = (instr) => `<w:fldSimple w:instr=" ${instr} "><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>`;
  // eslint-disable-next-line no-control-regex -- \u0001 / \u0002 are our own page-number placeholders
  const pageRuns = tpl.split(/(\u0001|\u0002)/).map((part) => (part === '\u0001' ? field('PAGE') : part === '\u0002' ? field('NUMPAGES') : part ? runs(part, { size: 16, color: '444444' }) : '')).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${para(notice, { size: 16, color: '444444', spaceAfter: 60 })}<w:p><w:pPr>${ARABIC.test(tpl) ? '<w:bidi/>' : ''}<w:jc w:val="center"/></w:pPr>${pageRuns}</w:p></w:ftr>`;
}

/** model → Buffer (.docx) */
export function docxFromModel(model) {
  const body = model.blocks.map(blockXml).join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return writeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/header1.xml', data: headerXml(model.notice) },
    { name: 'word/footer1.xml', data: footerXml(model.notice, model.lang) },
  ]);
}
