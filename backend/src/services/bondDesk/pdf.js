/**
 * services/bondDesk/pdf.js — the agent's PDF forms: read their fields, fill them, sign them,
 * and the pages Bond Desk writes itself (signature certificate, receipts).
 *
 * Text is set with the bundled Inter font (backend/assets/fonts, SIL Open Font License), so
 * names in Spanish, Portuguese, Vietnamese, Haitian Creole or Tagalog print correctly — the 14
 * standard PDF fonts cannot encode "Nguyễn".
 *
 * Inter has no Arabic or Chinese letters (and no font with them ships in node_modules). A
 * character the font cannot draw would come out as an empty box that looks like text, so
 * every string goes through pdfSafeText() first: each run of such characters is written as its
 * Unicode code points, e.g. "王小明" → "[U+738B U+5C0F U+660E]", and the certificate says so.
 * The exact text (typed name, answers) stays unchanged in the bond record; the certificate
 * itself is always in English.
 *
 * Prepared copy (what the signer reviews): mapped fields filled, every field read-only, the
 * signature fields (signature.name / signature.date) left empty. Signed copy: those filled
 * with "/s/ Full Name" and the date, every field flattened, then the certificate pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import PDFKit from 'pdfkit';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');
const FONT_REGULAR = fs.readFileSync(path.join(FONT_DIR, 'Inter_400Regular.ttf'));
const FONT_BOLD = fs.readFileSync(path.join(FONT_DIR, 'Inter_700Bold.ttf'));
const GLYPHS = [fontkit.create(FONT_REGULAR), fontkit.create(FONT_BOLD)];

/** True when both bundled fonts can draw the character. */
export const canDraw = (ch) => GLYPHS.every((f) => f.hasGlyphForCodePoint(ch.codePointAt(0)));
const KEEP = /[\n\r\t ]/;
const INVISIBLE = /\p{Cf}/u;   // direction marks, zero-width joiners: nothing to draw
const codePoints = (run) => `[${[...run].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}]`;

/**
 * Text the bundled font can draw: → { text, replaced }. Each run of characters it cannot draw
 * (Arabic, Chinese, emoji …) becomes "[U+XXXX U+YYYY …]" — never an empty box passed off as
 * text. Spaces between two such characters stay inside the run.
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
export const UNICODE_NOTE = 'Text in [U+...] brackets is written in a script this PDF font cannot display (for example Arabic or Chinese). Each code is one Unicode character of the exact text, which is kept unchanged in the bond record.';
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
  const font = await doc.embedFont(FONT_REGULAR, { subset: false });
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    let field;
    try { field = form.getTextField(name); } catch { throw new PdfError('field_missing', name); }
    const raw = String(value ?? '');
    const max = field.getMaxLength();
    if (max !== undefined && raw.length > max) throw new PdfError('field_too_long', name);
    let { text } = pdfSafeText(raw);
    if (max !== undefined && text.length > max) text = FIELD_NOT_SHOWN.slice(0, max);
    field.setText(text);
  }
  form.updateFieldAppearances(font);
  return form;
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
  doc.font('R');
  // Every string goes through pdfSafeText(); doc.unicodeReplaced tells the page to add UNICODE_NOTE.
  doc.unicodeReplaced = false;
  const text = doc.text.bind(doc);
  doc.text = (value, ...rest) => {
    if (typeof value !== 'string' && typeof value !== 'number') return text(value, ...rest);
    const safe = pdfSafeText(value);
    if (safe.replaced) doc.unicodeReplaced = true;
    return text(safe.text, ...rest);
  };
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  return { doc, done };
}

export const row = (doc, label, value) => {
  doc.font('B').fontSize(9).fillColor('#444').text(label, { continued: false });
  doc.font('R').fontSize(10).fillColor('#000').text(value == null || value === '' ? '—' : String(value), { paragraphGap: 6 });
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
  row(doc, 'Signer', `${info.signer_name} (${info.role})`);
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
