/**
 * helpers/pdfText.js — a small PDF text extractor for tests (no poppler on CI): for every page
 * it walks the content stream and the form XObjects it draws (flattened form fields), decodes
 * each Tj / TJ string through the font's ToUnicode CMap, and returns the text in drawing
 * order. Drawing order is visual order: an Arabic run reads right to left, so its characters
 * come out reversed (and as presentation forms — compare after NFKC).
 *
 * → { pages: [string], shows: [{ text, cids, font }] } — `shows` lists every text-showing
 *   operator, with the glyph ids it drew (0 is .notdef, an empty box).
 */
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

/** What a glyph with no ToUnicode entry comes out as. */
export const UNMAPPED = '\u{FFFD}';

const bytesOf = (doc, obj) => {
  const s = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (s instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(s).decode());
  return Buffer.from(s.getContents());
};

const utf16 = (hex) => {
  const b = Buffer.from(hex, 'hex');
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i));
  return s;
};

function parseCMap(text) {
  const map = new Map();
  for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const m of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        items.forEach((h, i) => map.set(lo + i, utf16(h)));
      } else {
        const start = Buffer.from(m[3].slice(1, -1), 'hex');
        for (let c = lo; c <= hi; c++) {
          const b = Buffer.from(start);
          b.writeUInt16BE(b.readUInt16BE(b.length - 2) + (c - lo), b.length - 2);
          map.set(c, utf16(b.toString('hex')));
        }
      }
    }
  }
  return map;
}

export async function extractPdfText(buf) {
  const doc = await PDFDocument.load(buf);
  const shows = [];
  const cmapCache = new Map();

  const fontMap = (resources, name) => {
    const fonts = resources?.lookup(PDFName.of('Font'));
    const ref = fonts?.get(PDFName.of(name));
    const font = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!font) return { map: new Map(), name, simple: true };
    const key = ref instanceof PDFRef ? ref.toString() : name;
    if (!cmapCache.has(key)) {
      const tu = font.get(PDFName.of('ToUnicode'));
      cmapCache.set(key, tu ? parseCMap(bytesOf(doc, tu).toString('latin1')) : new Map());
    }
    const simple = font.get(PDFName.of('Subtype'))?.toString() !== '/Type0';   // one byte per character
    return { map: cmapCache.get(key), name: font.get(PDFName.of('BaseFont'))?.toString() || name, simple };
  };

  const walk = (content, resources, out) => {
    const tokens = content.match(/\/[^\s/[\]<>()]+|<[0-9a-fA-F\s]*>|\[|\]|-?\d*\.?\d+|[A-Za-z'"*]+/g) || [];
    let font = { map: new Map(), name: '', simple: true };
    let block = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === 'Tf') font = fontMap(resources, tokens[i - 2].slice(1));
      else if (t === 'ET') { out.push(block); block = ''; }
      else if (t === 'Tj' || t === 'TJ') {
        let hexes = [];
        if (t === 'Tj') hexes = [tokens[i - 1]];
        else {
          let j = i - 1;
          while (j >= 0 && tokens[j] !== '[') j--;
          hexes = tokens.slice(j + 1, i - 1).filter((x) => x.startsWith('<'));
        }
        const cids = [];
        for (const h of hexes) {
          const hex = h.slice(1, -1).replace(/\s+/g, '');
          const step = font.simple ? 2 : 4;
          for (let k = 0; k + step - 1 < hex.length; k += step) cids.push(parseInt(hex.slice(k, k + step), 16));
        }
        const text = cids.map((c) => font.map.get(c) ?? (font.simple ? String.fromCharCode(c) : UNMAPPED)).join('');
        shows.push({ text, cids, font: font.name });
        block += text;
      } else if (t === 'Do') {
        const xobjects = resources?.lookup(PDFName.of('XObject'));
        const ref = xobjects?.get(PDFName.of(tokens[i - 1].slice(1)));
        const xo = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
        if (xo && xo.dict.get(PDFName.of('Subtype'))?.toString() === '/Form') {
          const inner = [];
          walk(bytesOf(doc, xo).toString('latin1'), xo.dict.lookup(PDFName.of('Resources')) || resources, inner);
          block += inner.join('\n');
        }
      }
    }
    if (block) out.push(block);
  };

  const pages = doc.getPages().map((page) => {
    const contents = page.node.get(PDFName.of('Contents'));
    const list = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const content = list.map((c) => bytesOf(doc, c).toString('latin1')).join('\n');
    const out = [];
    walk(content, page.node.Resources(), out);
    // form-field widgets that are not flattened: their normal appearance streams
    for (const annot of page.node.Annots()?.asArray() || []) {
      const a = doc.context.lookup(annot);
      const ap = a?.lookup?.(PDFName.of('AP'))?.lookup?.(PDFName.of('N'));
      if (ap instanceof PDFRawStream) walk(bytesOf(doc, ap).toString('latin1'), ap.dict.lookup(PDFName.of('Resources')), out);
    }
    return out.join('\n');
  });
  return { pages, shows };
}

/** Text drawn right to left, read back in logical order and NFKC-normalised (presentation forms → letters). */
export const rtlLogical = (visual) => [...visual].reverse().join('').normalize('NFKC');
