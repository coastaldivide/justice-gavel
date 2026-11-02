/**
 * ai/media.js — images and PDFs for Claude (AI step 4, docs/AI_PLATFORM.md §11).
 *
 * What a file must be before it is sent, and the content blocks that carry it. The type is
 * sniffed from the bytes (the client-declared type and the file name are never trusted).
 *
 * Vision — https://platform.claude.com/docs/en/build-with-claude/vision (read 2026-11-02):
 *   { type: 'image', source: { type: 'base64', media_type, data } }
 *   { type: 'image', source: { type: 'file', file_id } }            (Files API)
 *   media types image/jpeg, image/png, image/gif, image/webp; larger than 8000 × 8000 px is
 *   rejected (2000 × 2000 when a request has more than 20 images); a long edge over 1568 px is
 *   scaled down by the API (no quality gain, more latency) — the app resizes photos first; under
 *   200 px reads badly; ≈ width × height / 750 tokens; put the image BEFORE the text.
 * PDF support — https://platform.claude.com/docs/en/build-with-claude/pdf-support (read 2026-11-02):
 *   { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
 *   { type: 'document', source: { type: 'file', file_id } }         (Files API)
 *   each page is sent as an image plus its extracted text (≈ 1,500–3,000 tokens a page + the
 *   image cost); max 100 pages per request when the context window is under 1M tokens (600
 *   otherwise); request ≤ 32 MB on the Messages API (the PDF page says 128 MB first-party; we keep
 *   the stricter vision figure); no passwords / encryption; no beta header.
 * Files API — https://platform.claude.com/docs/en/build-with-claude/files (read 2026-11-02): see
 *   services/aiFiles.js.
 */
import { PDFDocument } from 'pdf-lib';

export const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
export const PDF_TYPE = 'application/pdf';
export const MAX_IMAGE_PX = 8000;
export const MIN_IMAGE_PX = 200;
export const API_MAX_PDF_PAGES = 100;

export class MediaError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

/** The real type of the bytes, or null. HEIC is recognised so the person can be told to convert it. */
export function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const head6 = buf.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return PDF_TYPE;
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(buf.subarray(8, 12).toString('latin1'))) return 'image/heic';
  return null;
}

/** { width, height } of a JPEG / PNG / GIF / WebP from its header, or null when unreadable. */
export function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/webp') {
      const kind = buf.subarray(12, 16).toString('latin1');
      if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      return null;
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
      return null;
    }
  } catch { /* truncated header */ }
  return null;
}

/** Page count of a PDF (pdf-lib). Throws MediaError encrypted_pdf / bad_pdf. */
export async function pdfPageCount(buf) {
  let doc;
  try {
    doc = await PDFDocument.load(buf, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e?.message))) throw new MediaError('encrypted_pdf');
    throw new MediaError('bad_pdf');
  }
  let n = 0;
  try { n = doc.getPageCount(); } catch { throw new MediaError('bad_pdf'); }
  if (n < 1) throw new MediaError('bad_pdf');
  return n;
}

/**
 * Check a file before it goes to Claude. → { mime, pages, width?, height? }
 * Throws MediaError: empty | too_large { maxMb } | unsupported_type | heic | image_too_big |
 * image_too_small | encrypted_pdf | bad_pdf | too_many_pages { maxPages }.
 */
export async function inspectUpload(buf, { maxBytes, maxPages, allow = [...IMAGE_TYPES, PDF_TYPE] } = {}) {
  if (!buf?.length) throw new MediaError('empty');
  if (maxBytes && buf.length > maxBytes) throw new MediaError('too_large', { maxMb: Math.round(maxBytes / 1024 / 1024) });
  const mime = sniffMime(buf);
  if (mime === 'image/heic') throw new MediaError('heic');
  if (!mime || !allow.includes(mime)) throw new MediaError('unsupported_type');
  if (mime === PDF_TYPE) {
    const pages = await pdfPageCount(buf);
    const cap = Math.min(maxPages || API_MAX_PDF_PAGES, API_MAX_PDF_PAGES);
    if (pages > cap) throw new MediaError('too_many_pages', { maxPages: cap });
    return { mime, pages };
  }
  const size = imageSize(buf, mime);
  if (!size || !size.width || !size.height) throw new MediaError('unsupported_type');
  if (size.width > MAX_IMAGE_PX || size.height > MAX_IMAGE_PX) throw new MediaError('image_too_big');
  if (size.width < MIN_IMAGE_PX && size.height < MIN_IMAGE_PX) throw new MediaError('image_too_small');
  return { mime, pages: 1, ...size };
}

/**
 * The content block for a file: `{ fileId }` → a Files API reference, else inline base64.
 * Images use an `image` block, PDFs a `document` block (vision / pdf-support pages above).
 */
export function mediaBlock(mime, { fileId = null, buffer = null } = {}) {
  const source = fileId
    ? { type: 'file', file_id: fileId }
    : { type: 'base64', media_type: mime, data: Buffer.from(buffer).toString('base64') };
  if (mime === PDF_TYPE) return { type: 'document', source };
  if (IMAGE_TYPES.includes(mime)) return { type: 'image', source };
  throw new MediaError('unsupported_type');
}

/** Does a request's messages reference a Files API file? (adds the files beta header — aiClient.js) */
export function hasFileSources(messages) {
  for (const m of Array.isArray(messages) ? messages : []) {
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if ((b?.type === 'image' || b?.type === 'document') && b.source?.type === 'file') return true;
    }
  }
  return false;
}
