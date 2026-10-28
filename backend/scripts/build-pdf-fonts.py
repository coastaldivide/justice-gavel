#!/usr/bin/env python3
"""
build-pdf-fonts.py — builds the Chinese and Arabic fonts that Bond Desk PDFs use
(backend/services/bondDesk/pdf.js) from fonts packaged on Debian/Ubuntu:

  fonts-noto-cjk   /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc  (face "Noto Sans CJK SC")
  fonts-dejavu-core /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf, DejaVuSans-Bold.ttf

Output (backend/assets/fonts):
  NotoSansSC-PdfSubset.ttf      Simplified Chinese face, TrueType outlines, these characters:
                                 * all of GB2312 (6,763 hanzi + 682 symbols, punctuation, full-width forms)
                                 * every character of the CJK Unified Ideographs block (U+4E00–9FFF, 20,976 hanzi)
                                   that the face has: GB2312 alone misses characters that turn up in personal
                                   names and all Traditional-only characters (names written Taiwan/Hong Kong
                                   style). The CJK Extension blocks (U+3400–4DBF, U+20000…) are not included;
                                   such characters still print as [U+XXXX] codes.
                                 * CJK Symbols and Punctuation (U+3000–303F), Half/Full-width Forms (U+FF00–FFEF)
  DejaVuSansArabic-PdfSubset.ttf, DejaVuSansArabic-PdfSubset-Bold.ttf
                                 Arabic (U+0600–06FF), Arabic Presentation Forms-A/B (U+FB50–FDFF, U+FE70–FEFF)
  arabic-forms.json              Presentation-form table for the shaping step in pdfText.js, generated from
                                 Python's Unicode database and limited to glyphs the Arabic font has
  LICENSE-NotoSansSC.txt, LICENSE-DejaVu.txt

Why these transformations:
  * The CJK face is converted from CFF to TrueType (quadratic) outlines and every font is written by
    fontTools, which pads each glyph record to an even length. @pdf-lib/fontkit's subsetter (used by
    pdf-lib with `subset: true`) rewrites `loca` in the short format whenever the subset's glyph data is
    under 64 KB and halves every offset; a font with odd-length glyph records (Inter has 550) comes out
    garbled. Even-length TrueType glyphs subset correctly in both pdf-lib and pdfkit.
  * GSUB/GPOS/GDEF are dropped: with no layout tables fontkit maps characters straight to glyphs, so it
    neither re-shapes nor reverses the Arabic text that pdfText.js has already shaped and put in visual
    order.
  * Hinting is dropped (PDF viewers do not need it); file size matters.

Run from the repository root:  python3 backend/scripts/build-pdf-fonts.py
Requires: fontTools (pip install fonttools).
"""
import json
import os
import sys
import unicodedata

from fontTools import subset
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTCollection, TTFont, newTable

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'fonts')
CJK_TTC = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
CJK_FACE = 'Noto Sans CJK SC'
DEJAVU = {'': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
          '-Bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'}
OFL_SOURCE = '/usr/share/doc/fonts-noto-cjk/copyright'

ARABIC_RANGES = [(0x0600, 0x06FF), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)]
DROP = ['GSUB', 'GPOS', 'GDEF', 'BASE', 'JSTF', 'MATH', 'kern', 'VORG', 'vhea', 'vmtx', 'DSIG', 'FFTM', 'gasp', 'STAT']


def gb2312_chars():
    """Every character GB2312 encodes: decode each valid two-byte code (rows 0xA1-0xF7, cells 0xA1-0xFE)."""
    out = set()
    for hi in range(0xA1, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return out


def subset_font(font, unicodes, family, ps_name):
    opts = subset.Options()
    opts.layout_features = []
    opts.drop_tables += DROP
    opts.hinting = False
    opts.glyph_names = False
    opts.notdef_outline = True
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.name_languages = [0x409]
    s = subset.Subsetter(opts)
    s.populate(unicodes=unicodes)
    s.subset(font)
    rename(font, family, ps_name)
    return font


def rename(font, family, ps_name):
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17):
            name.removeNames(nameID=rec.nameID)
    style = 'Bold' if ps_name.endswith('-Bold') else 'Regular'
    name.setName(family, 1, 3, 1, 0x409)
    name.setName(style, 2, 3, 1, 0x409)
    name.setName(f'{ps_name};pdf-subset', 3, 3, 1, 0x409)
    name.setName(f'{family} {style}'.replace(' Regular', ''), 4, 3, 1, 0x409)
    name.setName(ps_name, 6, 3, 1, 0x409)


def otf_to_ttf(font, max_err=1.0):
    """CFF → TrueType quadratic outlines (the fontTools otf2ttf recipe)."""
    order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    font['loca'] = newTable('loca')
    font['glyf'] = glyf = newTable('glyf')
    glyf.glyphOrder = order
    glyf.glyphs = {}
    for gname in order:
        pen = TTGlyphPen(None)
        glyph_set[gname].draw(Cu2QuPen(pen, max_err, reverse_direction=True))
        glyf.glyphs[gname] = pen.glyph()
    del font['CFF ']
    glyf.padding = 4
    glyf.compile(font)
    hmtx = font['hmtx']
    for gname, g in glyf.glyphs.items():
        if hasattr(g, 'xMin'):
            hmtx[gname] = (hmtx[gname][0], g.xMin)
    font['maxp'] = maxp = newTable('maxp')
    maxp.tableVersion = 0x00010000
    for k in ('maxZones',):
        setattr(maxp, k, 1)
    for k in ('maxTwilightPoints', 'maxStorage', 'maxFunctionDefs', 'maxInstructionDefs',
              'maxStackElements', 'maxSizeOfInstructions', 'maxComponentElements'):
        setattr(maxp, k, 0)
    maxp.compile(font)
    post = font['post']
    post.formatType = 3.0
    post.extraNames = []
    post.mapping = {}
    font['head'].glyphDataFormat = 0
    font.sfntVersion = '\000\001\000\000'


def check_even(path):
    """Every glyph record must have an even length (see the module docstring)."""
    t = TTFont(path)
    offs = list(t['loca'])
    odd = sum(1 for a, b in zip(offs, offs[1:]) if (b - a) % 2)
    if odd:
        sys.exit(f'{path}: {odd} odd-length glyph records')
    return t


def ofl_text():
    lines = open(OFL_SOURCE, encoding='utf-8').read().splitlines()
    starts = [i for i, l in enumerate(lines) if l.strip() == 'License: SIL-1.1']
    out = []
    for l in lines[starts[-1] + 1:]:
        if not l.startswith(' '):
            break
        l = l[1:]
        out.append('' if l == '.' else l)
    return '\n'.join(out).strip() + '\n'


def build_cjk():
    coll = TTCollection(CJK_TTC)
    face = next(f for f in coll.fonts if f['name'].getDebugName(1) == CJK_FACE)
    chars = gb2312_chars() | {chr(c) for c in range(0x4E00, 0xA000)}
    chars |= {chr(c) for c in range(0x3000, 0x3040)} | {chr(c) for c in range(0xFF00, 0xFFF0)}
    cmap = face.getBestCmap()
    unicodes = sorted(ord(c) for c in chars if ord(c) in cmap)
    copyright_line = face['name'].getDebugName(0)
    subset_font(face, unicodes, 'Noto Sans SC PDF Subset', 'NotoSansSC-PdfSubset')
    otf_to_ttf(face)
    path = os.path.join(OUT, 'NotoSansSC-PdfSubset.ttf')
    face['glyf'].padding = 4
    face.recalcTimestamp = False   # reproducible output: keep the source font's head.modified
    face.save(path)
    t = check_even(path)
    han = sum(1 for u in t.getBestCmap() if unicodedata.name(chr(u), '').startswith('CJK UNIFIED'))
    print(f'NotoSansSC-PdfSubset.ttf: {os.path.getsize(path)} bytes, {len(t.getBestCmap())} characters ({han} hanzi)')
    with open(os.path.join(OUT, 'LICENSE-NotoSansSC.txt'), 'w', encoding='utf-8') as f:
        f.write(f'NotoSansSC-PdfSubset.ttf is a subset of "{CJK_FACE}" (Noto Sans CJK, {face["name"].getDebugName(5) or ""}),\n'
                'converted to TrueType outlines by backend/scripts/build-pdf-fonts.py and renamed.\n'
                f'{copyright_line}\nNoto is a trademark of Google Inc.\n\n{ofl_text()}')


def arabic_unicodes():
    return [c for lo, hi in ARABIC_RANGES for c in range(lo, hi + 1)]


def build_arabic():
    cmap = None
    for suffix, src in DEJAVU.items():
        font = TTFont(src)
        if not suffix:
            license_text = font['name'].getDebugName(13)
            copyright_line = font['name'].getDebugName(0)
        subset_font(font, arabic_unicodes(), 'DejaVu Sans Arabic PDF Subset', f'DejaVuSansArabic-PdfSubset{suffix}')
        path = os.path.join(OUT, f'DejaVuSansArabic-PdfSubset{suffix}.ttf')
        font['glyf'].padding = 4
        font.recalcTimestamp = False
        font.save(path)
        t = check_even(path)
        c = set(t.getBestCmap())
        cmap = c if cmap is None else cmap & c
        print(f'{os.path.basename(path)}: {os.path.getsize(path)} bytes, {len(c)} characters')
    with open(os.path.join(OUT, 'LICENSE-DejaVu.txt'), 'w', encoding='utf-8') as f:
        f.write('DejaVuSansArabic-PdfSubset.ttf and DejaVuSansArabic-PdfSubset-Bold.ttf are subsets of DejaVu Sans and\n'
                'DejaVu Sans Bold (version 2.37) made by backend/scripts/build-pdf-fonts.py and renamed (the names\n'
                'contain neither "Bitstream" nor "Vera", as the license requires for modified fonts).\n\n'
                f'{copyright_line}\n{license_text}\n')
    return cmap


def build_forms(cmap):
    """{ forms: { base: [isolated, final, initial, medial] }, lamAlef: { alef: [isolated, final] } }
    from the <isolated>/<final>/<initial>/<medial> decompositions of the presentation forms."""
    slot = {'<isolated>': 0, '<final>': 1, '<initial>': 2, '<medial>': 3}
    forms, lam_alef = {}, {}
    for lo, hi in [(0xFB50, 0xFDFF), (0xFE70, 0xFEFF)]:
        for cp in range(lo, hi + 1):
            d = unicodedata.decomposition(chr(cp)).split()
            if not d or d[0] not in slot or cp not in cmap:
                continue
            bases = [int(x, 16) for x in d[1:]]
            if len(bases) == 1 and unicodedata.category(chr(bases[0])) == 'Lo':
                entry = forms.setdefault(f'{bases[0]:04X}', [None] * 4)
                if entry[slot[d[0]]] is None:
                    entry[slot[d[0]]] = f'{cp:04X}'
            elif bases[:1] == [0x0644] and len(bases) == 2 and d[0] in ('<isolated>', '<final>'):
                entry = lam_alef.setdefault(f'{bases[1]:04X}', [None] * 2)
                entry[slot[d[0]]] = f'{cp:04X}'
    data = {'source': 'Unicode presentation-form decompositions (Python unicodedata '
                      f'{unicodedata.unidata_version}), limited to glyphs in DejaVuSansArabic-PdfSubset',
            'forms': forms, 'lamAlef': lam_alef}
    with open(os.path.join(OUT, 'arabic-forms.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, sort_keys=True)
        f.write('\n')
    print(f'arabic-forms.json: {len(forms)} letters, {len(lam_alef)} lam-alef ligatures')


if __name__ == '__main__':
    build_cjk()
    build_forms(build_arabic())
