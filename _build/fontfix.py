# -*- coding: utf-8 -*-
"""Post-process a saved DOCX so every effective font reference is SimSun.

The default python-docx template ships theme fonts (minorHAnsi / minorEastAsia)
in docDefaults, and a couple of unused styles that reference Courier. Runs in
our document always set an explicit font, but normalising the file removes any
possible fallback and makes the "all 宋体" claim verifiable.
"""

import re
import shutil
import zipfile

FONT = '宋体'
# stylesWithEffects.xml mirrors styles.xml with effects; Word may consult it, so
# normalising it too removes the last real font-name fallback (Courier).
_STYLE_TARGETS = ('word/styles.xml', 'word/stylesWithEffects.xml')
_THEME_TARGETS = ('word/theme/theme1.xml',)
_TARGETS = _STYLE_TARGETS + _THEME_TARGETS


def _fix_styles(text):
    # 1) drop theme font references so the explicit font cannot be overridden
    text = re.sub(r'\s*w:(?:asciiTheme|hAnsiTheme|eastAsiaTheme|cstheme)="[^"]*"',
                  '', text)
    # 2) force every font attribute to SimSun (attribute names are exactly
    #    ascii/hAnsi/eastAsia/cs; *Theme variants were already removed)
    text = re.sub(r'w:(ascii|hAnsi|eastAsia|cs)="[^"]*"',
                  lambda m: 'w:%s="%s"' % (m.group(1), FONT), text)
    return text


def _fix_theme(text):
    return re.sub(r'(<a:(?:latin|ea|cs|font)\b[^>]*?)typeface="[^"]*"',
                  lambda m: m.group(1) + 'typeface="' + FONT + '"', text)


def fix_fonts_in_docx(path):
    tmp = path + '.fonttmp'
    zin = zipfile.ZipFile(path, 'r')
    zout = zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED)
    try:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename in _TARGETS:
                text = data.decode('utf-8')
                text = _fix_styles(text) if item.filename in _STYLE_TARGETS \
                    else _fix_theme(text)
                data = text.encode('utf-8')
            zout.writestr(item, data)
    finally:
        zin.close()
        zout.close()
    shutil.move(tmp, path)
