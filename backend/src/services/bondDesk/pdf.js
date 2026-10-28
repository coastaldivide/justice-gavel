/**
 * services/bondDesk/pdf.js — the agent's PDF forms: read their fields, fill them, sign them,
 * and the pages Bond Desk writes itself (signature certificate, receipts).
 *
 * Fonts (backend/assets/fonts, built by backend/scripts/build-pdf-fonts.py):
 *   Inter (SIL OFL)                    Latin, Vietnamese, Greek, Cyrillic — names in Spanish,
 *                                      Portuguese, Vietnamese, Haitian Creole, Tagalog
 *   Noto Sans SC subset (SIL OFL)      Chinese: GB2312 + the CJK Unified Ideographs block
 *   DejaVu Sans Arabic subset          Arabic, regular and bold (Bitstream Vera license)
 * Each character is drawn with the first of those fonts that has it (Inter first), so a mixed
 * string is set run by run. Arabic is shaped and put in right-to-left order by pdfText.js;
 * a line that is only Arabic is right-aligned. Text with no Arabic or Chinese is drawn exactly
 * as before (one pdfkit text call, Inter only).
 *
 * Size: pdfkit subsets every font it embeds. pdf-lib (form fields) embeds Inter whole
 * (`subset: false`): @pdf-lib/fontkit's subsetter writes `loca` in the short format when the
 * subset is small and halves every offset, which garbles Inter (550 odd-length glyph
 * records). The Chinese and Arabic fonts are written by fontTools with 4-byte glyph padding,
 * so pdf-lib subsets them (`subset: true`) and a Chinese name adds a few kilobytes.
 *
 * A character none of the fonts has (emoji, Hebrew, Devanagari, rare CJK Extension
 * characters …) would come out as an empty box that looks like text, so every string goes
 * through pdfSafeText() first: each run of such characters is written as its Unicode code
 * points, e.g. "👍" → "[U+1F44D]", and the page says so (UNICODE_NOTE). The exact text
 * (typed name, answers) stays unchanged in the bond record; the certificate itself is always
 * in English.
 *
 * Prepared copy (what the signer reviews): mapped fields filled, every field read-only, the
 * signature fields (signature.name / signature.date) left empty. Signed copy: those filled
 * with "/s/ Full Name" and the date, every field flattened, then the certificate pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  PDFDocument, PDFTextField, PDFCheckBox, PDFName, TextAlignment,
  beginMarkedContent, endMarkedContent, pushGraphicsState, popGraphicsState, rectangle, clip, endPath,
  beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingGrayscaleColor, setFillingRgbColor,
  componentsToColor, drawRectangle, rotateInPlace, adjustDimsForRotation, degrees,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import PDFKit from 'pdfkit';
import { layoutParagraph } from './pdfText.js';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');
const FONT_REGULAR = fs.readFileSync(path.join(FONT_DIR, 'Inter_400Regular.ttf'));
const FONT_BOLD = fs.readFileSync(path.join(FONT_DIR, 'Inter_700Bold.ttf'));
const GLYPHS = [fontkit.create(FONT_REGULAR), fontkit.create(FONT_BOLD)];

/** The Chinese and Arabic fonts are read on first use (the Chinese one is ~7 MB). */
const lazyFont = (file) => {
  let cache;
  return () => {
    if (!cache) {
      const buf = fs.readFileSync(path.join(FONT_DIR, file));
      cache = { buf, glyphs: fontkit.create(buf) };
    }
    return cache;
  };
};
const CJK = lazyFont('NotoSansSC-PdfSubset.ttf');
const ARABIC = lazyFont('DejaVuSansArabic-PdfSubset.ttf');
const ARABIC_BOLD = lazyFont('DejaVuSansArabic-PdfSubset-Bold.ttf');

const interHas = (cp) => GLYPHS.every((f) => f.hasGlyphForCodePoint(cp));
const ARABIC_BLOCKS = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const arabicHas = (ch) => ARABIC_BLOCKS.test(ch)
  && ARABIC().glyphs.hasGlyphForCodePoint(ch.codePointAt(0)) && ARABIC_BOLD().glyphs.hasGlyphForCodePoint(ch.codePointAt(0));
const cjkHas = (ch) => ch.codePointAt(0) >= 0x2E80 && CJK().glyphs.hasGlyphForCodePoint(ch.codePointAt(0));

/** Which bundled font draws the character: 'latin' (Inter), 'arabic', 'cjk', or null (none). */
export function fontFor(ch) {
  const cp = ch.codePointAt(0);
  if (interHas(cp)) return 'latin';
  if (arabicHas(ch)) return 'arabic';
  if (cjkHas(ch)) return 'cjk';
  return null;
}
/** True when one of the bundled fonts can draw the character. */
export const canDraw = (ch) => fontFor(ch) !== null;
/** True when the text needs the Chinese or Arabic font (or right-to-left order). */
const needsLayout = (text) => [...text].some((ch) => !KEEP.test(ch) && fontFor(ch) !== 'latin');

const KEEP = /[\n\r\t ]/;
const INVISIBLE = /\p{Cf}/u;   // direction marks, zero-width joiners: nothing to draw
const codePoints = (run) => `[${[...run].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}]`;

/**
 * Text the bundled fonts can draw: → { text, replaced }. Arabic and Chinese are kept (they
 * have fonts); each run of characters no bundled font has (emoji, Hebrew, Devanagari …)
 * becomes "[U+XXXX U+YYYY …]" — never an empty box passed off as text. Spaces between two
 * such characters stay inside the run.
 */
export function pdfSafeText(value) {
  const s = String(value ?? '').normalize('NFC');
  let out = '';
  let run = '';
  let pendingSpace = '';
  let replaced = false;
  const flush = () => { if (run) { out += codePoints(run.trimEnd()); replaced = true; run = ''; } };
  for (const ch of s) {
    if (INVISIBLE.test(ch)) continue;
    if (KEEP.test(ch) || canDraw(ch)) {
      if (run && ch === ' ') { pendingSpace += ch; continue; }
      flush();
      out += pendingSpace + ch; pendingSpace = '';
      continue;
    }
    run += pendingSpace; pendingSpace = '';
    run += ch;
  }
  flush();
  out += pendingSpace;
  return { text: out, replaced };
}
/** The note printed under text that pdfSafeText() changed. */
export const UNICODE_NOTE = 'Text in [U+...] brackets is written in characters the fonts of this PDF cannot display (for example emoji, Hebrew or Devanagari). Each code is one Unicode character of the exact text, which is kept unchanged in the bond record.';
/** What a form field shows when the code-point form does not fit its maximum length. */
export const FIELD_NOT_SHOWN = '[see bond record]';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export class PdfError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail || null; }
}

async function load(buf) {
  if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) throw new PdfError('bad_pdf');
  if (buf.length > MAX_PDF_BYTES) throw new PdfError('too_large');
  if (Buffer.from(buf.subarray(0, 5)).toString('latin1') !== '%PDF-') throw new PdfError('bad_pdf');
  try {
    return await PDFDocument.load(buf, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e?.message))) throw new PdfError('encrypted_pdf');
    throw new PdfError('bad_pdf');
  }
}

const fieldType = (f) => (f instanceof PDFTextField ? 'text' : f instanceof PDFCheckBox ? 'checkbox' : 'other');

/** → { page_count, fields: [{ name, type }] } (names unique, in the form's order). */
export async function inspectPdf(buf) {
  const doc = await load(buf);
  const seen = new Set();
  const fields = [];
  for (const f of doc.getForm().getFields()) {
    const name = f.getName();
    if (seen.has(name)) continue;
    seen.add(name);
    fields.push({ name, type: fieldType(f) });
  }
  if (doc.getPageCount() < 1) throw new PdfError('bad_pdf');
  return { page_count: doc.getPageCount(), fields };
}

async function setFields(doc, values) {
  doc.registerFontkit(fontkit);
  // calt off: with it, @pdf-lib/fontkit's Inter contextual alternates leave gaps ("[  U+ 1F44D]", "A-  B")
  const font = await doc.embedFont(FONT_REGULAR, { subset: false, features: { calt: false } });
  const form = doc.getForm();
  const laidOut = [];
  for (const [name, value] of Object.entries(values)) {
    let field;
    try { field = form.getTextField(name); } catch { throw new PdfError('field_missing', name); }
    const raw = String(value ?? '');
    const max = field.getMaxLength();
    if (max !== undefined && raw.length > max) throw new PdfError('field_too_long', name);
    let { text } = pdfSafeText(raw);
    if (max !== undefined && text.length > max) text = FIELD_NOT_SHOWN.slice(0, max);
    // the field's own font size and color (pdf-lib rewrites /DA when it builds its appearance)
    const das = [field.acroField.getDefaultAppearance() ?? '', ...field.acroField.getWidgets().map((w) => w.getDefaultAppearance() ?? '')];
    field.setText(text);
    if (needsLayout(text)) laidOut.push([field, text, das]);
  }
  form.updateFieldAppearances(font);
  // Inter cannot draw Arabic or Chinese: those fields get an appearance set run by run.
  const fonts = { latin: font };
  for (const [field, text, das] of laidOut) await setLaidOutAppearance(doc, field, text, das, fonts);
  return form;
}

/** pdf-lib fonts for the scripts in `text`, embedded once per document (subset). */
async function fieldFonts(doc, text, fonts) {
  for (const ch of text) {
    const key = fontFor(ch);
    if (key === 'arabic' && !fonts.arabic) fonts.arabic = await doc.embedFont(ARABIC().buf, { subset: true });
    if (key === 'cjk' && !fonts.cjk) fonts.cjk = await doc.embedFont(CJK().buf, { subset: true });
  }
}

const daFontSize = (da) => { const m = /(\d*\.?\d+)\s+Tf/.exec(da || ''); return m ? Number(m[1]) : undefined; };
/** The text color from a default appearance string ("0 g", "0 0 1 rg"); undefined when it names none. */
function daColor(da) {
  const rgb = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+rg\b/.exec(da || '');
  if (rgb) return setFillingRgbColor(+rgb[1], +rgb[2], +rgb[3]);
  const g = /(-?[\d.]+)\s+g\b/.exec(da || '');
  return g ? setFillingGrayscaleColor(+g[1]) : undefined;
}

/**
 * Normal appearance for a text field whose value needs the Arabic or Chinese font, built like
 * pdf-lib's own (background and border from /MK, widget rotation, /DA font size or auto size,
 * the field's alignment) but with the value laid out by pdfText.js — shaped, right to left
 * where needed — and drawn run by run, each run in the font that has its characters. An
 * Arabic-only line in a left-aligned field is right-aligned. The field keeps the exact text
 * as its value.
 */
async function setLaidOutAppearance(doc, field, text, das, fonts) {
  await fieldFonts(doc, text, fonts);
  const acro = field.acroField;
  const multiline = field.isMultiline();
  const alignment = field.getAlignment();
  const fontKey = (ch) => fontFor(ch) || 'latin';
  const paras = multiline ? text.split(/\r\n|\r|\n/) : [text.replace(/[\r\n]+/g, ' ')];
  acro.getWidgets().forEach((widget, wi) => {
    const rect = widget.getRectangle();
    const ap = widget.getAppearanceCharacteristics();
    const rotation = (((ap?.getRotation() ?? 0) % 360) + 360) % 360;
    const { width: w, height: h } = adjustDimsForRotation(rect, rotation);
    const bw = widget.getBorderStyle()?.getWidth() ?? 0;
    const pad = bw + 2;
    const avail = Math.max(1, w - 2 * pad);
    const availH = Math.max(1, h - 2 * pad);
    const layAt = (size, width) => {
      const lines = [];
      for (const p of paras) {
        const lay = layoutParagraph(p, { fontFor: fontKey, measure: (k, str) => fonts[k].widthOfTextAtSize(str, size), width });
        for (const l of lay.lines) lines.push({ ...l, arabicOnly: lay.arabicOnly });
      }
      return lines;
    };
    let size = daFontSize(das[wi + 1]) || daFontSize(das[0]) || 0;
    if (!size) {   // auto size, as pdf-lib does: as large as fits (single line: the height; multiline: all lines)
      if (multiline) {
        size = 12;
        while (size > 4 && layAt(size, avail).length * size * 1.2 > availH) size -= 0.5;
      } else {
        size = Math.max(4, Math.min(availH / 1.2, 40));
        const one = layAt(size, Infinity)[0];
        if (one.width > avail) size = Math.max(4, size * (avail / one.width));
      }
    }
    const lines = layAt(size, multiline ? avail : Infinity);
    const lineHeight = size * 1.2;
    let baseline = multiline ? h - pad - size : (h - size * 0.73) / 2;
    const ops = [...rotateInPlace({ ...rect, rotation })];
    const borderColor = componentsToColor(ap?.getBorderColor());
    const background = componentsToColor(ap?.getBackgroundColor());
    if (borderColor || background) {
      ops.push(...drawRectangle({ x: bw / 2, y: bw / 2, width: w - bw, height: h - bw, borderWidth: bw, borderColor, color: background, rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0) }));
    }
    ops.push(beginMarkedContent('Tx'), pushGraphicsState(), rectangle(bw, bw, w - 2 * bw, h - 2 * bw), clip(), endPath(),
      daColor(das[wi + 1]) || daColor(das[0]) || setFillingGrayscaleColor(0), beginText());
    const used = new Set();
    for (const line of lines) {
      const align = alignment === TextAlignment.Center ? 'center'
        : alignment === TextAlignment.Right || line.arabicOnly ? 'right' : 'left';
      let x = align === 'right' ? w - pad - line.width : align === 'center' ? (w - line.width) / 2 : pad;
      for (const run of line.runs) {
        const f = fonts[run.font];
        used.add(run.font);
        ops.push(setFontAndSize(f.name, size), setTextMatrix(1, 0, 0, 1, x, baseline), showText(f.encodeText(run.text)));
        x += run.width;
      }
      baseline -= lineHeight;
    }
    ops.push(endText(), popGraphicsState(), endMarkedContent());
    const Font = {};
    for (const k of used) Font[fonts[k].name] = fonts[k].ref;
    const stream = doc.context.formXObject(ops, { BBox: doc.context.obj([0, 0, rect.width, rect.height]), Resources: { Font } });
    widget.setNormalAppearance(doc.context.register(stream));
  });
}

/** The copy a signer reviews: `values` set (text fields), all fields read-only. → Buffer */
export async function preparePdf(buf, values) {
  const doc = await load(buf);
  const form = await setFields(doc, values);
  for (const f of form.getFields()) f.enableReadOnly();
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** The signed copy: signature fields set, everything flattened, certificate pages appended. */
export async function signPdf(preparedBuf, signatureValues, certificateBuf) {
  const doc = await load(preparedBuf);
  const form = await setFields(doc, signatureValues);
  form.flatten();
  dropDeadAnnots(doc);
  await doc.flush();   // write the embedded font now: copyPages below must not copy a font that is still pending
  // flatten() deletes the field objects and leaves holes in pdf-lib's cross-reference table
  // that some readers (poppler / Chrome's viewer) report as damage. Copying the pages into a
  // fresh document renumbers every object, so the signed copy is a clean file.
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
  const cert = await PDFDocument.load(certificateBuf);
  for (const p of await out.copyPages(cert, cert.getPageIndices())) out.addPage(p);
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

/**
 * pdf-lib's flatten() deletes each field widget but can leave its reference in the page's
 * /Annots array; a dangling reference makes readers report the file as damaged. Keep only
 * annotations that still exist and are not form widgets.
 */
function dropDeadAnnots(doc) {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const keep = [];
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const obj = doc.context.lookup(ref);
      const subtype = obj?.get?.(PDFName.of('Subtype'));
      if (obj && !(subtype && subtype.toString() === '/Widget')) keep.push(ref);
    }
    if (keep.length) page.node.set(PDFName.of('Annots'), doc.context.obj(keep));
    else page.node.delete(PDFName.of('Annots'));
  }
}

/** Several PDFs as one (the packet's signed copies). */
export async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const b of buffers) {
    const d = await PDFDocument.load(b);
    for (const p of await out.copyPages(d, d.getPageIndices())) out.addPage(p);
  }
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

// ── Pages Bond Desk writes (pdfkit) ───────────────────────────────────────────

export function kit(title) {
  const doc = new PDFKit({ size: 'LETTER', margin: 54, info: { Title: title, Producer: 'Justice Gavel Bond Desk' } });
  doc.registerFont('R', FONT_REGULAR);
  doc.registerFont('B', FONT_BOLD);
  // Pages choose 'R' or 'B'; text in Arabic or Chinese is drawn with the matching font for its script.
  const setFont = doc.font.bind(doc);
  doc.font = (name, ...rest) => {
    if (name === 'R' || name === 'B') doc._jgWeight = name;
    return setFont(name, ...rest);
  };
  doc.font('R');
  // Every string goes through pdfSafeText(); doc.unicodeReplaced tells the page to add UNICODE_NOTE.
  doc.unicodeReplaced = false;
  const text = doc.text.bind(doc);
  doc.text = (value, ...rest) => {
    if (typeof value !== 'string' && typeof value !== 'number') return text(value, ...rest);
    const safe = pdfSafeText(value);
    if (safe.replaced) doc.unicodeReplaced = true;
    if (!needsLayout(safe.text)) return text(safe.text, ...rest);
    return laidOutText(doc, safe.text, rest, text, setFont);
  };
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  return { doc, done };
}

const KIT_FONTS = { R: { latin: 'R', arabic: 'AR', cjk: 'C' }, B: { latin: 'B', arabic: 'AB', cjk: 'C' } };

/**
 * doc.text() for text with Arabic or Chinese: laid out by pdfText.js (shaped, bidi order,
 * wrapped to the width), each line drawn run by run on a common baseline, then doc.x / doc.y
 * left where pdfkit would leave them (options used by these pages: width, align, lineGap,
 * paragraphGap; plus direction: 'ltr' for a line that is English with a name in it). An
 * Arabic-only paragraph is right-aligned.
 */
function laidOutText(doc, str, rest, draw, setFont) {
  let x = doc.x;
  let y = doc.y;
  let opts = {};
  if (typeof rest[0] === 'number') { x = rest[0]; y = rest[1] ?? doc.y; opts = rest[2] || {}; } else opts = rest[0] || {};
  if (!doc._jgFonts) {   // registered on first use: a page without Arabic or Chinese never loads those fonts
    doc.registerFont('C', CJK().buf);
    doc.registerFont('AR', ARABIC().buf);
    doc.registerFont('AB', ARABIC_BOLD().buf);
    doc._jgFonts = true;
  }
  const weight = doc._jgWeight || 'R';
  const names = KIT_FONTS[weight];
  const size = doc._fontSize;
  const measure = (k, s) => { setFont(names[k]); return doc.widthOfString(s); };
  setFont(names.latin);
  const lineHeight = doc.currentLineHeight(true);
  const ascent = (doc._font.ascender / 1000) * size;
  const lineGap = opts.lineGap ?? doc._lineGap ?? 0;
  const width = opts.width ?? (doc.page.width - x - doc.page.margins.right);
  const fontKey = (ch) => fontFor(ch) || 'latin';
  doc.x = x;
  doc.y = y;
  for (const para of str.split(/\r\n|\r|\n/)) {
    const lay = layoutParagraph(para, { fontFor: fontKey, measure, width, direction: opts.direction });
    const align = opts.align || (lay.arabicOnly ? 'right' : 'left');
    for (const line of lay.lines) {
      const extra = line.runs.some((r) => r.font === 'arabic') ? 0.15 * size : 0;   // Arabic reaches lower than Latin
      if (doc.y + lineHeight + extra > doc.page.maxY() && doc.y > doc.page.margins.top) doc.addPage();
      const top = doc.y;
      let cx = align === 'right' ? x + width - line.width : align === 'center' ? x + (width - line.width) / 2 : x;
      for (const run of line.runs) {
        setFont(names[run.font]);
        draw(run.text, cx, top + ascent, { lineBreak: false, baseline: 'alphabetic' });
        cx += run.width;
      }
      doc.y = top + lineHeight + extra + lineGap;
    }
  }
  if (opts.paragraphGap) doc.y += opts.paragraphGap;
  doc.x = x;
  setFont(names.latin);
  return doc;
}

export const row = (doc, label, value, opts = {}) => {
  doc.font('B').fontSize(9).fillColor('#444').text(label, { continued: false });
  doc.font('R').fontSize(10).fillColor('#000').text(value == null || value === '' ? '—' : String(value), { paragraphGap: 6, ...opts });
};

/**
 * Signature certificate (English — the language of the court record).
 * info: { document_name, prepared_sha256, signer_name, typed_name, role, sent_to, events: [{ label, at }],
 *         ip, user_agent, consent_lines: [string], agency, bond_label }
 */
export async function certificatePdf(info) {
  const { doc, done } = kit('Electronic signature certificate');
  doc.font('B').fontSize(16).text('Electronic Signature Certificate');
  doc.font('R').fontSize(9).fillColor('#444')
    .text('Signed electronically under the U.S. Electronic Signatures in Global and National Commerce Act (15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions Act as adopted by the state.', { paragraphGap: 10 });
  doc.fillColor('#000');
  row(doc, 'Document', info.document_name);
  row(doc, 'Bond', info.bond_label);
  row(doc, 'Agency', info.agency);
  row(doc, 'SHA-256 of the copy the signer reviewed', info.prepared_sha256);
  row(doc, 'Signer', `${info.signer_name} (${info.role})`, { direction: 'ltr' });   // the name, then the English role
  row(doc, 'Signature (typed by the signer)', `/s/ ${info.typed_name}`);
  row(doc, 'Signing link sent to', info.sent_to);
  doc.font('B').fontSize(9).fillColor('#444').text('Timeline (UTC)');
  doc.font('R').fontSize(10).fillColor('#000');
  for (const e of info.events) doc.text(`${e.at}   ${e.label}`);
  doc.moveDown(0.6);
  row(doc, 'IP address at signing', info.ip);
  row(doc, 'Browser at signing', info.user_agent);
  doc.font('B').fontSize(9).fillColor('#444').text(`The signer agreed to the following before signing${info.consent_lang && info.consent_lang !== 'English' ? ` (shown to the signer in ${info.consent_lang}; English text below)` : ''}`);
  doc.font('R').fontSize(9).fillColor('#000');
  for (const l of info.consent_lines) doc.text(`• ${l}`, { paragraphGap: 3 });
  doc.moveDown(0.6);
  if (doc.unicodeReplaced) doc.font('R').fontSize(8).fillColor('#444').text(UNICODE_NOTE, { paragraphGap: 4 });
  doc.fontSize(8).fillColor('#444').text('The SHA-256 fingerprint identifies the exact reviewed copy: any change to that file changes the fingerprint. The reviewed copy is kept with the bond record.');
  doc.end();
  return await done;
}

/**
 * Receipt (payment or collateral). r: { title, receipt_no, agency, license, agency_phone, date, lines: [[label, value]], footer }
 */
export async function receiptPdf(r) {
  const { doc, done } = kit(r.title);
  doc.font('B').fontSize(14).text(r.agency || 'Bail agency');
  doc.font('R').fontSize(9).fillColor('#444').text([r.license ? `License ${r.license}` : null, r.agency_phone].filter(Boolean).join(' · '));
  doc.moveDown(1);
  doc.fillColor('#000').font('B').fontSize(16).text(r.title);
  doc.font('R').fontSize(11).text(`No. ${r.receipt_no}`);
  doc.text(`Date: ${r.date}`);
  doc.moveDown(0.8);
  for (const [label, value] of r.lines) row(doc, label, value);
  if (r.void_note) { doc.moveDown(0.5); doc.font('B').fontSize(12).fillColor('#b00020').text(r.void_note); doc.fillColor('#000'); }
  doc.moveDown(1.5);
  doc.font('R').fontSize(9).fillColor('#444').text(r.footer || '');
  if (doc.unicodeReplaced) doc.moveDown(0.5).fontSize(8).text(UNICODE_NOTE);
  doc.end();
  return await done;
}
