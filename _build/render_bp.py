# -*- coding: utf-8 -*-
"""Render both BP PDFs to PNG for the visual acceptance pass."""
import os
import pymupdf

ROOT = r'D:\挑战杯项目\储粮安全物联网监控平台'
PDF_DIR = os.path.join(ROOT, '_build', 'pdf')
PNG_ROOT = os.path.join(ROOT, '_build', 'png')

JOBS = [
    ('储粮安全物联网监控平台-商业计划书设计纲要', 'bp_outline'),
    ('储粮安全物联网监控平台-商业计划书简略样板', 'bp_sample'),
]

for name, tag in JOBS:
    pdf = os.path.join(PDF_DIR, name + '.pdf')
    out = os.path.join(PNG_ROOT, tag)
    os.makedirs(out, exist_ok=True)
    d = pymupdf.open(pdf)
    zoom = 110 / 72.0
    mat = pymupdf.Matrix(zoom, zoom)
    paths = []
    for i in range(d.page_count):
        pix = d[i].get_pixmap(matrix=mat, alpha=False)
        fp = os.path.join(out, 'page_%02d.png' % (i + 1))
        pix.save(fp)
        paths.append(fp)
    print('%s: %d pages -> %s' % (tag, len(paths), out))
    print('   first:', paths[0])
    print('   last :', paths[-1])
