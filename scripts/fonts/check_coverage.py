"""Fails if any character the interface can show is missing from the Sounding fonts.

Collects the visible text of index.html and every string and template literal in src/app/*.ts (plus the unit
and time characters the code builds), then checks each style's cmap. File labels from users' recordings are
not knowable ahead of time; Latin-1 is covered and anything else falls back to the next font in the stack.
Usage: python check_coverage.py   (from the repo root)
"""
import glob, html, re, sys
from fontTools.ttLib import TTFont

text = open('index.html', encoding='utf-8').read()
text = re.sub(r'<(script|style|svg)[\s\S]*?</\1>', ' ', text)
text = html.unescape(re.sub(r'<[^>]+>', ' ', text))
for f in glob.glob('src/app/*.ts'):
    src = open(f, encoding='utf-8').read()
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`", src):
        s = m.group(1) if m.group(1) is not None else m.group(2)
        s = re.sub(r'\$\{[^}]*\}', '', s)
        s = s.encode('utf-8').decode('unicode_escape').encode('latin-1', 'ignore').decode('utf-8', 'ignore') if '\\u' in s else s
        text += ' ' + s
text += '0123456789:.,+−±µ°×Hz sV'
chars = sorted({c for c in text if not c.isspace()})
bad = 0
for style in ('Regular', 'SemiBold', 'Sloped'):
    cmap = TTFont(f'fonts/Sounding-{style}.otf').getBestCmap()
    missing = [c for c in chars if ord(c) not in cmap]
    print(f'Sounding-{style}: {len(chars)} characters checked, missing: {"".join(missing) or "none"}')
    bad += len(missing)
sys.exit(1 if bad else 0)
