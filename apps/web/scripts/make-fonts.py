#!/usr/bin/env python3
"""Build the subtitle fallback fonts that ship with the web app.

libass in the browser has no system fonts to fall back on: whatever it is
handed is all it has. JASSUB bundles Liberation Sans, which covers Latin,
Greek, Cyrillic and Hebrew -- so a Chinese, Japanese, Korean, Arabic, Hindi
or Thai subtitle renders as a row of tofu boxes with no error anywhere.

This takes the relevant Noto subsets from their @fontsource packages and
rewrites each one's family name to something stable that we choose.

    python3 scripts/make-fonts.py

WHY THE RENAME IS NECESSARY, and not just tidiness:

@fontsource's name tables are mangled. Every weight of Noto Sans SC calls
itself some variation of "Noto Sans SC Thin" -- the 400 file's family is
literally "Noto Sans SC Thin" with subfamily "Regular". libass matches
fonts by the family name in the font's own name table, so registering the
file under the obvious key "noto sans sc" silently never matches: libass
reports `fontselect: failed to find any fallback`, emits nothing for those
glyphs, and the export contains tofu. Renaming the family to a name we
control makes the lookup deterministic and independent of upstream's
packaging.

Only the regular weight of each script is shipped. libass emboldens
synthetically, which is fine at subtitle sizes and halves what a user
downloads.
"""

from __future__ import annotations

import glob
import sys
import tempfile
from pathlib import Path

try:
    from fontTools import subset
    from fontTools.merge import Merger
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("fonttools is required:  pip3 install fonttools brotli")

HERE = Path(__file__).resolve().parent
WEB = HERE.parent
MODULES = WEB / "node_modules" / "@fontsource"
OUT_DIR = WEB / "src" / "assets" / "fonts"

# (output stem, family name we register, source file under node_modules)
#
# The CJK font is not in this list: it is assembled from three upstream fonts
# by build_cjk(), below.
FONTS = [
    (
        "opensubs-hangul",
        "OpenSubs Hangul",
        "noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2",
    ),
    (
        "opensubs-arabic",
        "OpenSubs Arabic",
        "noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff2",
    ),
    (
        "opensubs-devanagari",
        "OpenSubs Devanagari",
        "noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2",
    ),
    (
        "opensubs-thai",
        "OpenSubs Thai",
        "noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2",
    ),
]

# Name table records that carry a family or full name. Leaving any of them
# pointing at the old family gives libass a second, conflicting answer.
FAMILY_IDS = {1, 16}
FULL_NAME_ID = 4
POSTSCRIPT_ID = 6
UNIQUE_ID = 3
TYPOGRAPHIC_SUBFAMILY_ID = 17


def rebuild(stem: str, family: str, source: Path, out: Path) -> None:
    save_renamed(TTFont(source), stem, family, out)


def save_renamed(font: TTFont, stem: str, family: str, out: Path) -> None:
    name = font["name"]

    for record in list(name.names):
        if record.nameID in FAMILY_IDS:
            record.string = family
        elif record.nameID == FULL_NAME_ID:
            record.string = f"{family} Regular"
        elif record.nameID == POSTSCRIPT_ID:
            record.string = family.replace(" ", "") + "-Regular"
        elif record.nameID == UNIQUE_ID:
            record.string = f"{family} Regular; OpenSubs"
        elif record.nameID == TYPOGRAPHIC_SUBFAMILY_ID:
            record.string = "Regular"

    font.flavor = "woff2"
    font.save(out)

    check = TTFont(out)
    got = check["name"].getDebugName(1)
    if got != family:
        raise SystemExit(f"{stem}: family came out as {got!r}, expected {family!r}")
    size_mb = out.stat().st_size / 1048576
    print(f"  {out.name:34s} {got:22s} {len(check.getGlyphOrder()):6d} glyphs  {size_mb:.2f} MB")


# ---------------------------------------------------------------------------
# The CJK font
#
# It used to be @fontsource's `chinese-simplified` slice of Noto Sans SC and
# nothing else. That slice is cut for Simplified Chinese, so it lacked 378
# of the 2,965 JIS level-1 kanji and 1,176 of Big5's 5,401 common
# characters -- 択 in 選択, 労 in 労働, 閘 in 閘門. Japanese and Traditional
# subtitles burned in with empty rectangles, and the warning told people to
# delete words their language cannot do without (APP-84).
#
# Adding more of Noto Sans SC does not fix it: all 102 of its slices
# together still miss 52 JIS level-1 and 308 Big5 common characters, because
# Google's SC slicing never carried the Japanese- and Traditional-only
# glyphs. They have to come from Noto Sans JP and Noto Sans TC.
#
# All three are the same design (Source Han Sans) with identical metrics --
# glyf outlines, 1000 units per em, the same ascent and descent -- so glyphs
# from them sit on one baseline at one size. They are merged into a single
# font rather than shipped as three, because the renderer is constructed
# with exactly one fallback family: a bilingual Japanese-over-Chinese cue
# has to be drawable from that one file.

CJK_STEM, CJK_FAMILY = "opensubs-cjk", "OpenSubs CJK"
CJK_BASE = "noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2"
CJK_SLICES = {
    "sc": "noto-sans-sc/files/noto-sans-sc-*-400-normal.woff2",
    "jp": "noto-sans-jp/files/noto-sans-jp-*-400-normal.woff2",
    "tc": "noto-sans-tc/files/noto-sans-tc-*-400-normal.woff2",
}


def double_byte(codec: str, lead: range, trail: list[int]) -> set[int]:
    """Every single character a legacy double-byte charset can encode.

    The national character sets come straight out of Python's codecs, so
    there is no table to vendor and keep in sync.
    """
    out = set()
    for a in lead:
        for b in trail:
            try:
                c = bytes([a, b]).decode(codec)
            except UnicodeDecodeError:
                continue
            if len(c) == 1:
                out.add(ord(c))
    return out


EUC_TRAIL = list(range(0xA1, 0xFF))


def big5_block(first: int, last: int) -> set[int]:
    """Big5 characters whose codes fall in [first, last].

    Big5's frequency tiers are ranges of the code space rather than rows, so
    this walks codes, not a lead-by-trail grid.
    """
    out = set()
    for code in range(first, last + 1):
        trail = code & 0xFF
        if not (0x40 <= trail <= 0x7E or 0xA1 <= trail <= 0xFE):
            continue
        try:
            c = bytes([code >> 8, trail]).decode("big5")
        except UnicodeDecodeError:
            continue
        if len(c) == 1:
            out.add(ord(c))
    return out


GB2312_LEVEL1 = double_byte("gb2312", range(0xB0, 0xD8), EUC_TRAIL)
GB2312 = double_byte("gb2312", range(0xA1, 0xF8), EUC_TRAIL)
JIS_LEVEL1 = double_byte("euc_jp", range(0xB0, 0xD0), EUC_TRAIL)
JIS_X_0208 = double_byte("euc_jp", range(0xA1, 0xF5), EUC_TRAIL)
BIG5_COMMON = big5_block(0xA440, 0xC67E)  # 常用字
BIG5 = big5_block(0xA140, 0xF9D5)          # symbols, common and less-common

# (what it is for, the codepoints, which upstream to draw them from first)
#
# Order matters only for a codepoint two of the sets share and the base does
# not already draw. Simplified goes first because that is the form the font
# has always drawn shared characters in, so no existing Chinese subtitle
# changes; Japanese- and Traditional-only characters then come from the
# font designed for them.
CJK_WANTED = [
    ("GB2312", GB2312, ["sc", "tc", "jp"]),
    ("JIS X 0208", JIS_X_0208, ["jp", "tc", "sc"]),
    ("Big5", BIG5, ["tc", "jp", "sc"]),
]

# The build fails unless these are covered, except for exactly the listed
# characters -- which no slice of any of the three fonts contains. A new
# miss is a regression; a listed one disappearing is an upstream improvement
# and should be removed from here.
CJK_REQUIRED = [
    ("JIS X 0208 level 1", JIS_LEVEL1, ""),
    ("Big5 common", BIG5_COMMON, "姅杗歜穋觼詨跦鑤"),
    ("GB2312 level 1", GB2312_LEVEL1, ""),
    # Every character that burned in empty in the APP-84 reporter's own
    # Japanese, Traditional and Simplified subtitle files.
    ("APP-84 subtitles", {ord(c) for c in "麺択拡釈虜労懐峠枠閘瞞掙撿繳矚犧綻濺凈詭癥絹"}, ""),
]


def build_cjk(out: Path) -> None:
    base_path = MODULES / CJK_BASE
    base_cmap = set(TTFont(base_path).getBestCmap())
    slices = {
        key: [(Path(f), set(TTFont(f).getBestCmap())) for f in sorted(glob.glob(str(MODULES / pattern)))]
        for key, pattern in CJK_SLICES.items()
    }

    # Assign each wanted codepoint to exactly one slice, so the merge never
    # sees two glyphs for one character.
    taken = set(base_cmap)
    plan: dict[Path, set[int]] = {}
    for _, wanted, order in CJK_WANTED:
        for cp in sorted(wanted - taken):
            for key in order:
                source = next((f for f, cmap in slices[key] if cp in cmap), None)
                if source is not None:
                    plan.setdefault(source, set()).add(cp)
                    taken.add(cp)
                    break

    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        base = TTFont(base_path)
        base.flavor = None
        base_ttf = Path(tmp) / "base.ttf"
        base.save(base_ttf)
        for i, (source, codepoints) in enumerate(sorted(plan.items())):
            font = TTFont(source)
            options = subset.Options()
            options.layout_features = ["*"]
            options.name_IDs = ["*"]
            options.notdef_outline = True
            subsetter = subset.Subsetter(options)
            subsetter.populate(unicodes=codepoints)
            subsetter.subset(font)
            font.flavor = None
            part = Path(tmp) / f"part-{i}.ttf"
            font.save(part)
            parts.append(part)
        merged = Merger().merge([str(base_ttf)] + [str(p) for p in parts])

        # The merger drops the base's format 14 cmap subtable -- the Unicode
        # variation sequences. Put it back, or every Chinese subtitle that
        # uses one silently loses its variant glyph.
        order = set(merged.getGlyphOrder())
        for table in (t for t in TTFont(base_ttf)["cmap"].tables if t.format == 14):
            names = {g for pairs in table.uvsDict.values() for _, g in pairs if g}
            if not names <= order:
                raise SystemExit(f"{CJK_STEM}: the merge renamed {len(names - order)} variation-sequence glyphs")
            merged["cmap"].tables.append(table)

    merged.flavor = "woff2"
    save_renamed(merged, CJK_STEM, CJK_FAMILY, out)

    got = set(TTFont(out).getBestCmap())
    lost = base_cmap - got
    if lost:
        raise SystemExit(f"{CJK_STEM}: lost {len(lost)} characters the Simplified slice drew")
    failed = False
    for label, required, known in CJK_REQUIRED:
        missing = required - got
        unexpected = missing - {ord(c) for c in known}
        status = "ok" if not unexpected else "MISSING " + "".join(chr(c) for c in sorted(unexpected))
        print(f"    {label:22s} {len(required) - len(missing):5d}/{len(required):<5d} {status}")
        failed |= bool(unexpected)
    if failed:
        raise SystemExit(f"{CJK_STEM}: required characters are not covered")


# JASSUB's bundled default. Everything it covers needs no extra font, and
# everything it does not is either handled by a script font above or drawn
# as a tofu box.
DEFAULT_FONT = WEB / "node_modules" / "jassub" / "dist" / "default.woff2"

COVERAGE_TS = WEB / "src" / "lib" / "fontcoverage.ts"


def ranges_of(path: Path) -> list[tuple[int, int]]:
    """The codepoints a font can actually draw, as sorted [start, end] pairs."""
    points = sorted(TTFont(path).getBestCmap())
    out: list[tuple[int, int]] = []
    for cp in points:
        if out and cp == out[-1][1] + 1:
            out[-1] = (out[-1][0], cp)
        else:
            out.append((cp, cp))
    return out


def encode(pairs: list[tuple[int, int]]) -> str:
    """Pack ranges as base-36 gap/length deltas.

    The CJK font alone has ~4000 runs, and written out as plain integers
    the tables cost about 18 kB gzipped -- paid by every visitor, including
    the ones subtitling in English. Deltas between consecutive runs are
    almost always single digits, so each run becomes two or three
    characters. Decoded once at startup by `fonts.ts`.
    """
    out = []
    previous_end = -1
    for start, end in pairs:
        out.append(f"{start - previous_end - 1:x}.{end - start:x}")
        previous_end = end
    return ",".join(out)


def write_coverage(built: list[tuple[str, Path]]) -> None:
    """Record what each shipped font really covers.

    This exists because the coverage test used to be hand-written Unicode
    ranges, and they drifted from the fonts. The CJK range began at U+3040,
    which excludes U+3001 and U+3002 -- the ideographic comma and full stop
    -- so every Chinese subtitle ending in a full stop warned that it could
    not be drawn and would "burn in as empty rectangles". The font draws
    both perfectly well. A false alarm on the most ordinary text in the
    language is worse than no warning at all, and no amount of care with a
    hand-written range list prevents the next one: only reading the fonts
    does.
    """
    lines = [
        "// GENERATED by scripts/make-fonts.py -- do not edit by hand.",
        "//",
        "// Each value packs the font's own cmap as comma-separated",
        "// `<gap>.<length>` pairs in hex: gap is the distance from the end of",
        "// the previous run, length is the run's own extent. Unpacked by",
        "// fonts.ts. Regenerate after changing any font in FONTS.",
        "",
        f'export const DEFAULT_PACKED = "{encode(ranges_of(DEFAULT_FONT))}";',
        "",
        "export const SCRIPT_PACKED: Readonly<Record<string, string>> = {",
    ]
    for stem, path in built:
        key = stem.replace("opensubs-", "")
        lines.append(f'  "{key}": "{encode(ranges_of(path))}",')
    lines.append("};")
    COVERAGE_TS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    size_kb = COVERAGE_TS.stat().st_size / 1024
    print(f"  {COVERAGE_TS.name:34s} {'coverage tables':22s} {size_kb:9.1f} KB")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"writing to {OUT_DIR.relative_to(WEB)}")
    missing = [
        str((MODULES / pattern).parent.relative_to(WEB))
        for pattern in [CJK_BASE, *CJK_SLICES.values()]
        if not glob.glob(str(MODULES / pattern))
    ]
    built: list[tuple[str, Path]] = []
    if not missing:
        cjk = OUT_DIR / f"{CJK_STEM}.woff2"
        build_cjk(cjk)
        built.append((CJK_STEM, cjk))
    for stem, family, relative in FONTS:
        source = MODULES / relative
        if not source.is_file():
            missing.append(str(source.relative_to(WEB)))
            continue
        out = OUT_DIR / f"{stem}.woff2"
        rebuild(stem, family, source, out)
        built.append((stem, out))
    if missing:
        sys.exit(
            "missing sources (run `npm install` first):\n  " + "\n  ".join(missing)
        )
    if not DEFAULT_FONT.is_file():
        sys.exit(f"missing {DEFAULT_FONT.relative_to(WEB)} (run `npm install` first)")
    write_coverage(built)


if __name__ == "__main__":
    main()
