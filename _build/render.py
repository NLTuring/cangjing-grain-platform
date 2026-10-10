# -*- coding: utf-8 -*-
"""Render every PDF page to PNG for the visual acceptance pass."""
import os
import pymupdf

ROOT = r'D:\挑战杯项目\储粮安全物联网监控平台'
NAME = '储粮安全物联网监控平台-项目简介与BP-PPT编制指南'
PDF = os.path.join(ROOT, '_build', 'pdf', NAME + '.pdf')
OUT = os.path.join(ROOT, '_build', 'png')
os.makedirs(OUT, exist_ok=True)

d = pymupdf.open(PDF)
zoom = 110 / 72.0
mat = pymupdf.Matrix(zoom, zoom)
paths = []
for i in range(d.page_count):
    p = d[i]
    pix = p.get_pixmap(matrix=mat, alpha=False)
    fp = os.path.join(OUT, 'page_%02d.png' % (i + 1))
    pix.save(fp)
    paths.append(fp)
print('rendered %d pages -> %s' % (len(paths), OUT))
for fp in paths[:3] + paths[-2:]:
    print('  ', fp, os.path.getsize(fp))
