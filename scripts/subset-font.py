#!/usr/bin/env python3
"""Build the approved v3.200 round UI font without changing its outlines."""
from pathlib import Path
import argparse
import hashlib
import json
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA256 = '7ccfc2cd0e971edeac7f65516df8db379f0f84d0d8ff79ee4dfe377956418d3b'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path, help='Original ChillRoundF-v3.200.ttf from the approved release')
args = parser.parse_args()
assert hashlib.sha256(args.source.read_bytes()).hexdigest() == SOURCE_SHA256, 'Unexpected font version'
font = TTFont(args.source, recalcTimestamp=False)
cmap = font.getBestCmap()
app_files = sorted(p for p in (ROOT/'dist').rglob('*') if p.suffix in ('.js', '.html', '.css'))
text = ''.join(p.read_text() for p in app_files)
requested = set(map(ord, text))
# Keep previously shipped glyphs when help text is retired. Adding campaign
# labels must not remove any existing glyph available to the unchanged UI.
previous_metadata = ROOT/'docs/font-subset.json'
if previous_metadata.exists():
    requested.update(json.loads(previous_metadata.read_text()).get('codepoints', []))
for lo, hi in [(0x20, 0x100), (0x2000, 0x2070), (0x3000, 0x3040), (0xff00, 0xfff0)]:
    requested.update(range(lo, hi))
requested.update(map(ord, '×÷∞→←↑↓−△□'))
missing_chinese = sorted(cp for cp in requested if 0x3400 <= cp <= 0x9fff and cp not in cmap)
assert not missing_chinese, 'Missing CJK glyphs: ' + ''.join(map(chr, missing_chinese))
keep = sorted(requested & set(cmap))
options = subset.Options()
options.flavor = 'woff2'
options.layout_features = ['*']
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=keep)
subsetter.subset(font)
# Subsetting makes a derivative under OFL; retain copyright/license but avoid
# upstream Reserved Font Names in the derivative's family/PostScript names.
names = {1:'Qiuqiule UI', 2:'Regular', 3:'QiuqiuleUI-Regular-3.200',
         4:'Qiuqiule UI Regular', 6:'QiuqiuleUI-Regular',
         16:'Qiuqiule UI', 17:'Regular', 18:'Qiuqiule UI Regular',
         21:'Qiuqiule UI', 22:'Regular'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.flavor = 'woff2'
output = ROOT/'dist/fonts/qiuqiule-ui.woff2'
font.save(output)
verified = TTFont(output)
assert set(keep).issubset(verified.getBestCmap()), 'Subset lost requested glyphs'
metadata = {'family':'Qiuqiule UI', 'css_family':'GameSans',
            'upstream':'寒蝉全圆体 ChillRoundF v3.200 Regular',
            'source_sha256':SOURCE_SHA256,
            'asset_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
            'size_bytes':output.stat().st_size,'codepoints':keep,
            'upstream_url':'https://github.com/Warren2060/ChillRound/releases/tag/v3.200',
            'license':'SIL OFL 1.1; see dist/fonts/OFL-Qiuqiule-UI.txt'}
(ROOT/'docs/font-subset.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'file':str(output),'bytes':output.stat().st_size,'glyphs':len(verified.getGlyphOrder()),'codepoints':len(keep)}))
