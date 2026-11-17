"""Builds the Sounding typeface (OTF with CFF outlines, and WOFF2) from Barlow Semi Condensed (OFL 1.1).

What changes from the base, so this is its own face and not a renamed copy:
- tabular lining figures are the default digits (readouts must not jiggle as values update), and the zero carries
  a slash so it never reads as the letter O (EEG labels mix them: O1, O2, Oz next to channel numbers);
- display tracking: every advance widened by a fixed amount, split evenly into both sidebearings;
- the Sloped style is the upright skewed by 11 degrees (a sloped roman, the way nautical charts letter water
  names), not the base family's cursive italic;
- a drawn chart sounding mark at U+E000 (ring with a centre dot) for the wordmark and map markers;
- subset to the characters the interface shows; renamed throughout; kerning kept; OFL 1.1 kept.
Usage: python build_fonts.py <barlow-dir> <otf-out-dir> <woff2-out-dir>
"""
import math, os, sys
from fontTools import subset
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

SRC, OTF_DIR, WOFF_DIR = sys.argv[1:4]
CHARS = ''.join(chr(c) for c in range(0x20, 0x7F)) + ''.join(chr(c) for c in range(0xA0, 0x100)) + 'µΩ×−·°…‘’“”•'
TRACK = 14
STYLES = [('BarlowSemiCondensed-Medium.ttf', 'Regular', 500, 0), ('BarlowSemiCondensed-SemiBold.ttf', 'SemiBold', 600, 0),
          ('BarlowSemiCondensed-Medium.ttf', 'Sloped', 500, 11)]


def sounding_mark(pen, xh, skew):
    tp = TransformPen(pen, (1, 0, skew, 1, -skew * xh * 0.5, 0))
    cx, cy = xh * 0.5 + TRACK, xh * 0.5
    def circle(r, ccw):
        k = 0.5523 * r
        if ccw:
            seq = [((cx + r, cy + k), (cx + k, cy + r), (cx, cy + r)), ((cx - k, cy + r), (cx - r, cy + k), (cx - r, cy)),
                   ((cx - r, cy - k), (cx - k, cy - r), (cx, cy - r)), ((cx + k, cy - r), (cx + r, cy - k), (cx + r, cy))]
        else:
            seq = [((cx + r, cy - k), (cx + k, cy - r), (cx, cy - r)), ((cx - k, cy - r), (cx - r, cy - k), (cx - r, cy)),
                   ((cx - r, cy + k), (cx - k, cy + r), (cx, cy + r)), ((cx + k, cy + r), (cx + r, cy + k), (cx + r, cy))]
        tp.moveTo((cx + r, cy))
        for a, b, c in seq:
            tp.curveTo(a, b, c)
        tp.closePath()
    # TrueType outer contours run clockwise; the ring's hole runs the other way.
    circle(xh * 0.36, False)
    circle(xh * 0.25, True)
    circle(xh * 0.09, False)
    return int(xh + 2 * TRACK)


def build(src_name, style, weight, slant):
    path = os.path.join(SRC, src_name)
    font = TTFont(path)
    # Remap digits to the base's tabular glyphs before subsetting.
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    remap = {}
    for d in '0123456789':
        for cand in (cmap[ord(d)] + '.tf', cmap[ord(d)] + '.tnum'):
            if cand in gs:
                remap[ord(d)] = cand
                break
    for t in font['cmap'].tables:
        if t.isUnicode():
            for u, g in remap.items():
                if u in t.cmap:
                    t.cmap[u] = g
    opts = subset.Options()
    opts.layout_features = ['kern', 'mark', 'mkmk', 'ccmp', 'locl']
    opts.name_IDs = []
    opts.notdef_outline = True
    opts.glyph_names = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[ord(c) for c in CHARS])
    sub.subset(font)
    missing = [c for c in CHARS if ord(c) not in font.getBestCmap()]

    skew = math.tan(math.radians(slant))
    glyf, hmtx = font['glyf'], font['hmtx']
    gs = font.getGlyphSet()
    order = font.getGlyphOrder()
    new = {}
    zero = font.getBestCmap()[ord('0')]
    for g in order:
        rec = DecomposingRecordingPen(gs)
        gs[g].draw(rec)
        pen = TTGlyphPen(None)
        tp = TransformPen(pen, (1, 0, skew, 1, TRACK / 2 - skew * 250, 0))
        rec.replay(tp)
        if g == zero:
            bp = BoundsPen(gs)
            gs[g].draw(bp)
            x0, y0, x1, y1 = bp.bounds
            w, h = x1 - x0, y1 - y0
            t = w * 0.15
            ax, ay = x0 + w * 0.27, y0 + h * 0.2
            cx, cy = x1 - w * 0.27, y1 - h * 0.2
            # Clockwise parallelogram (TrueType outer contour), bottom-left to top-right.
            tp.moveTo((ax, ay))
            tp.lineTo((cx - t, cy))
            tp.lineTo((cx, cy))
            tp.lineTo((ax + t, ay))
            tp.closePath()
        new[g] = pen.glyph()
    for g in order:
        glyf[g] = new[g]
        adv, lsb = hmtx[g]
        hmtx[g] = (adv + TRACK, lsb + TRACK // 2)
    # The sounding mark.
    xh = font['OS/2'].sxHeight or 500
    pen = TTGlyphPen(None)
    width = sounding_mark(Cu2QuPen(pen, 1.0, reverse_direction=False), xh, skew)
    font.setGlyphOrder(order + ['uniE000'])
    glyf.glyphOrder = font.getGlyphOrder()
    glyf['uniE000'] = pen.glyph()
    hmtx['uniE000'] = (width, TRACK)
    for t in font['cmap'].tables:
        if t.isUnicode():
            t.cmap[0xE000] = 'uniE000'
    for g in font.getGlyphOrder():
        glyf[g].recalcBounds(glyf)

    # Names.
    ps = f'Sounding-{style}'
    family = 'Sounding' if style != 'SemiBold' else 'Sounding SemiBold'
    sub_family = 'Italic' if slant else 'Regular'
    name = font['name']
    name.names = []
    for nid, val in {0: 'Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow). Sounding is a Modified Version made for Leadline, 2026.',
                     1: family, 2: sub_family, 3: f'{ps};1.000;2026', 4: f'Sounding {style}', 5: 'Version 1.000', 6: ps,
                     13: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.', 14: 'https://openfontlicense.org'}.items():
        name.setName(val, nid, 3, 1, 0x409)
    os2 = font['OS/2']
    os2.usWeightClass = weight
    os2.fsSelection = (os2.fsSelection & ~0x61) | (0x01 if slant else 0x40)
    font['head'].macStyle = 0x02 if slant else 0
    font['post'].italicAngle = -slant
    font['OS/2'].achVendID = 'NONE'

    os.makedirs(OTF_DIR, exist_ok=True)
    os.makedirs(WOFF_DIR, exist_ok=True)
    # WOFF2 straight from the TrueType outlines. The base's hinting programs no longer match the reshaped
    # outlines, so they are dropped.
    for tag in ('fpgm', 'prep', 'cvt '):
        if tag in font:
            del font[tag]
    font['maxp'].maxSizeOfInstructions = 0
    font.flavor = 'woff2'
    font.save(os.path.join(WOFF_DIR, ps + '.woff2'))
    font.flavor = None
    # OTF: the same glyphs as CFF (cubic) outlines, layout tables kept.
    gs = font.getGlyphSet()
    charstrings = {}
    for g in font.getGlyphOrder():
        pen = T2CharStringPen(hmtx[g][0], gs)
        gs[g].draw(pen)
        charstrings[g] = pen.getCharString()
    fb = FontBuilder(font=font)
    fb.isTTF = False
    for tag in ('glyf', 'loca', 'fpgm', 'prep', 'cvt ', 'gasp', 'hdmx', 'LTSH', 'VDMX'):
        if tag in font:
            del font[tag]
    fb.setupCFF(ps, {'FullName': f'Sounding {style}'}, charstrings, {})
    from fontTools.ttLib.tables._m_a_x_p import table__m_a_x_p
    maxp = table__m_a_x_p()
    maxp.tableVersion = 0x00005000
    maxp.numGlyphs = len(font.getGlyphOrder())
    font['maxp'] = maxp
    font['post'].formatType = 3.0
    font.save(os.path.join(OTF_DIR, ps + '.otf'))
    print(ps, len(font.getGlyphOrder()), 'glyphs; missing from base:', ''.join(missing) or 'none', '; tabular digits:', len(remap))


for s in STYLES:
    build(*s)
