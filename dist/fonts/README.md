Qiuqiule UI — a glyph subset of the user-approved 寒蝉全圆体 / ChillRoundF v3.200 Regular.

Upstream: https://github.com/Warren2060/ChillRound/releases/tag/v3.200
License: SIL Open Font License 1.1, reproduced in OFL-Qiuqiule-UI.txt.
The derivative family is named Qiuqiule UI to respect upstream Reserved Font Names.
Glyph outlines and metrics are unchanged. All game text uses this one face via GameSans; the original SVG logo remains unchanged.

Rebuild after adding UI characters:
python scripts/subset-font.py /path/to/ChillRoundF-v3.200.ttf

The script verifies the pinned original SHA-256, keeps all application CJK characters plus Latin/digits/punctuation, and emits WOFF2 and docs/font-subset.json. The font is preloaded and included in core offline resources.

Build dependency: Python `fonttools[woff]` (includes Brotli for WOFF2).
