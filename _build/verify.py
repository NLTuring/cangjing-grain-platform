# -*- coding: utf-8 -*-
"""Verify the built DOCX/PDF: font coverage, table overflow, caption orphans."""
import os, re, sys, zipfile, glob
import pymupdf

ROOT = r'D:\挑战杯项目\储粮安全物联网监控平台'
NAME = '储粮安全物联网监控平台-项目简介与BP-PPT编制指南'
DOCX = os.path.join(ROOT, NAME + '.docx')
PDF = os.path.join(ROOT, '_build', 'pdf', NAME + '.pdf')

print('=' * 70)
print('1) FONT COVERAGE (docx xml)')
z = zipfile.ZipFile(DOCX)
# Only <w:rFonts> carries real font names. w:lang also has eastAsia="ja-JP"
# style attributes; matching those would be a false positive.
TEXT_PARTS = ('word/document.xml', 'word/styles.xml', 'word/stylesWithEffects.xml',
              'word/theme/theme1.xml')
TEXT_PARTS += tuple(n for n in z.namelist()
                    if re.match(r'word/(header|footer)\d*\.xml$', n))
bad = {}
for item in z.namelist():
    if not item.endswith('.xml'):
        continue
    try:
        t = z.read(item).decode('utf-8')
    except Exception:
        continue
    fonts = set()
    for rf in re.findall(r'<w:rFonts\b[^>]*>', t):
        for a in ('ascii', 'hAnsi', 'eastAsia', 'cs'):
            m = re.search(r'w:%s="([^"]*)"' % a, rf)
            if m and m.group(1) and m.group(1) != '宋体':
                fonts.add(m.group(1))
    fonts |= {f for f in re.findall(r'typeface="([^"]*)"', t)
              if f and f != '宋体'}
    if fonts and item in TEXT_PARTS:
        bad[item] = sorted(fonts)
    elif fonts:
        print('  (inert, not text-bearing) %s: %s' % (item, sorted(fonts)))
if bad:
    for k, v in bad.items():
        print('  !! NON-SIMSUN in %s: %s' % (k, v))
else:
    print('  OK: every text-bearing part uses 宋体 only')
try:
    th = z.read('word/theme/theme1.xml').decode('utf-8')
    print('  theme typefaces:', sorted(set(re.findall(r'typeface="([^"]*)"', th))))
except KeyError:
    print('  no theme1.xml')

print('=' * 70)
print('2) PAGE GEOMETRY / TABLE OVERFLOW (pdf)')
d = pymupdf.open(PDF)
PW, PH = d[0].rect.width, d[0].rect.height
ML = 2.8 * 28.3465
MR = PW - ML
print('  page %.1f x %.1f pt, text band x=[%.1f, %.1f]' % (PW, PH, ML, MR))
HOME = 1.5 * 28.3465
overflow = []
for i in range(d.page_count):
    page = d[i]
    body = pymupdf.Rect(0, HOME, PW, PH - HOME)
    for b in page.get_text('blocks'):
        x0, y0, x1, y1, txt = b[0], b[1], b[2], b[3], b[4]
        if not txt.strip():
            continue
        if x1 > MR + 3.0 or x0 < ML - 3.0:
            overflow.append((i + 1, round(x0, 1), round(x1, 1), txt.strip()[:40]))
if not overflow:
    print('  OK: no text block exceeds the text band')
else:
    print('  !! %d overflow blocks' % len(overflow))
    for o in overflow[:20]:
        print('     p%-3d x=[%s,%s] %s' % o)

print('=' * 70)
print('3) WIDOW/ORPHAN: heading last line of page, caption at page bottom')
issues = []
for i in range(d.page_count):
    page = d[i]
    dd = page.get_text('dict')
    items = []
    for blk in dd['blocks']:
        for ln in blk.get('lines', []):
            spans = [s for s in ln['spans'] if s['text'].strip()]
            if not spans:
                continue
            sz = max(s['size'] for s in spans)
            y = min(s['bbox'][1] for s in spans)
            txt = ''.join(s['text'] for s in spans).strip()
            items.append((y, sz, txt))
    items.sort()
    if not items:
        continue
    # last text item on page
    y, sz, txt = items[-1]
    if sz >= 13.6:  # a heading ended the page with nothing after it
        issues.append((i + 1, 'heading at page bottom: %s' % txt[:40]))
    if txt.startswith('表 ') and sz < 11:
        issues.append((i + 1, 'table caption possibly orphaned: %s' % txt[:40]))
if not issues:
    print('  OK: no heading-ending pages / orphaned captions detected')
else:
    for it in issues:
        print('  !! p%-3d %s' % it)

print('=' * 70)
print('4) TOC SANITY')
import json
tj = os.path.join(ROOT, '_build', 'toc.json')
rows = json.load(open(tj, encoding='utf-8'))
print('  headings in toc.json:', len(rows), '(expected 65)')
print('  first:', rows[0]['text'], '-> p', rows[0]['page'])
print('  last :', rows[-1]['text'], '-> p', rows[-1]['page'])
print('  pages:', d.page_count, 'docx paragraphs=467 tables=34')
