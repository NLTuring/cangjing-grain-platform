# -*- coding: utf-8 -*-
"""Verify the two BP DOCX/PDF deliverables: fonts, overflow, orphans, callouts."""
import json, os, re, zipfile
import pymupdf

ROOT = r'D:\挑战杯项目\储粮安全物联网监控平台'
PDF_DIR = os.path.join(ROOT, '_build', 'pdf')
TEXT_PARTS_EXTRA = re.compile(r'word/(header|footer)\d*\.xml$')

DOCS = [
    ('商业计划书设计纲要', os.path.join(ROOT, '_build', '_toc_储粮安全物联网监控平台-商业计划书设计纲要.json')),
    ('商业计划书简略样板', os.path.join(ROOT, '_build', '_toc_储粮安全物联网监控平台-商业计划书简略样板.json')),
]
PREFIX = '储粮安全物联网监控平台-'


def check(docx, pdf, toc_json):
    print('=' * 74)
    print('DOC:', os.path.basename(docx))
    z = zipfile.ZipFile(docx)
    parts = ['word/document.xml', 'word/styles.xml', 'word/stylesWithEffects.xml',
             'word/theme/theme1.xml']
    parts += [n for n in z.namelist() if TEXT_PARTS_EXTRA.match(n)]
    bad = {}
    inert = {}
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
        if fonts:
            (bad if item in parts else inert)[item] = sorted(fonts)
    print('1) FONT: %s' % ('OK — text-bearing parts are 宋体 only' if not bad else bad))
    if inert:
        print('   (inert, non-text-bearing) %s' % inert)
    th = z.read('word/theme/theme1.xml').decode('utf-8')
    print('   theme typefaces:', sorted(set(re.findall(r'typeface="([^"]*)"', th))))

    d = pymupdf.open(pdf)
    PW = d[0].rect.width
    ML = 2.8 * 28.3465
    MR = PW - ML
    HOME = 1.5 * 28.3465
    over = []
    for i in range(d.page_count):
        page = d[i]
        for blk in page.get_text('blocks'):
            x0, y0, x1, y1, txt = blk[0], blk[1], blk[2], blk[3], blk[4]
            if not txt.strip():
                continue
            if x1 > MR + 3.0 or x0 < ML - 3.0:
                over.append((i + 1, round(x1, 1), txt.strip()[:34]))
    print('2) OVERFLOW: %d block(s) beyond text band (x=[%.1f,%.1f])'
          % (len(over), ML, MR))
    for o in over[:8]:
        print('     p%-3d x1=%s  %s' % o)

    issues = []
    for i in range(d.page_count):
        dd = d[i].get_text('dict')
        items = []
        for blk in dd['blocks']:
            for ln in blk.get('lines', []):
                sp = [s for s in ln['spans'] if s['text'].strip()]
                if not sp:
                    continue
                items.append((min(s['bbox'][1] for s in sp),
                              max(s['size'] for s in sp),
                              ''.join(s['text'] for s in sp).strip()))
        items.sort()
        if not items:
            continue
        y, sz, txt = items[-1]
        if sz >= 13.6:
            issues.append((i + 1, 'heading ends the page: %s' % txt[:36]))
        if txt.startswith('表 ') and sz < 11:
            issues.append((i + 1, 'caption at page bottom: %s' % txt[:36]))
    print('3) ORPHAN/WIDOW: %s'
          % ('OK' if not issues else '%d issue(s)' % len(issues)))
    for it in issues:
        print('     p%-3d %s' % it)

    rows = json.load(open(toc_json, encoding='utf-8'))
    print('4) TOC: %d entries; first=%s p%s; last=%s p%s; pages=%d'
          % (len(rows), rows[0]['text'], rows[0]['page'],
             rows[-1]['text'], rows[-1]['page'], d.page_count))


for label, tj in DOCS:
    docx = os.path.join(ROOT, PREFIX + label + '.docx')
    pdf = os.path.join(PDF_DIR, PREFIX + label + '.pdf')
    if not (os.path.exists(docx) and os.path.exists(pdf)):
        print('MISSING for', label, os.path.exists(docx), os.path.exists(pdf))
        continue
    check(docx, pdf, tj)
