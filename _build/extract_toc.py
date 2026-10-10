# -*- coding: utf-8 -*-
"""Extract (level, text, printed_page) for all H1/H2 headings from the rendered PDF.

Body sections restart page numbering at 1, so the printed footer number is the
number that must appear in the table of contents. Pages without a footer number
(cover, TOC) are skipped.
"""

import json
import re
import sys

import pymupdf

PDF = sys.argv[1]
OUT = sys.argv[2]

doc = pymupdf.open(PDF)
HEADING_MIN_SIZE = 13.6


def printed_number(page):
    h = page.rect.height
    clip = pymupdf.Rect(0, h - 72, page.rect.width, h)
    txt = page.get_text('text', clip=clip).strip()
    nums = re.findall(r'\d+', txt)
    return int(nums[-1]) if nums else None


rows = []
for pno in range(doc.page_count):
    page = doc[pno]
    printed = printed_number(page)
    if printed is None:
        continue
    line_items = []
    d = page.get_text('dict')
    for block in d['blocks']:
        for line in block.get('lines', []):
            spans = [s for s in line['spans'] if s['text'].strip()]
            if not spans:
                continue
            size = max(s['size'] for s in spans)
            if size >= HEADING_MIN_SIZE:
                text = ''.join(s['text'] for s in spans).strip()
                text = re.sub(r'\s+', ' ', text)
                y = min(s['bbox'][1] for s in spans)
                line_items.append((y, round(size, 1), text))
    line_items.sort()
    for y, size, text in line_items:
        level = 1 if size >= 15.0 else 2
        rows.append({'level': level, 'size': size, 'text': text, 'page': printed})

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)

print('extracted %d headings -> %s' % (len(rows), OUT))
for r in rows[:10]:
    print('  L%d p%-3s %s' % (r['level'], r['page'], r['text']))
print('  ...')
for r in rows[-6:]:
    print('  L%d p%-3s %s' % (r['level'], r['page'], r['text']))
