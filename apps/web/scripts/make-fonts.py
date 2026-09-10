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

import sys
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("fonttools is required:  pip3 install fonttools brotli")

HERE = Path(__file__).resolve().parent
WEB = HERE.parent
MODULES = WEB / "node_modules" / "@fontsource"
OUT_DIR = WEB / "src" / "assets" / "fonts"

# (output stem, family name we register, source file under node_modules)
FONTS = [
    (
        "opensubs-cjk",
        "OpenSubs CJK",
        "noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2",
    ),
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
    font = TTFont(source)
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
    missing = []
    built: list[tuple[str, Path]] = []
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
