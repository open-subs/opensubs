#!/usr/bin/env python3
"""Write one real page per language into dist/<locale>/.

Run after `vite build`, over `dist/`. Reads the four static pages the
site is made of, translates their copy from `scripts/site-i18n/`, and
writes a full document per locale with its own <html lang>, <title>,
description, structured data and canonical, plus an hreflang ring so a
search engine knows the eight are the same page.

## Why not translate in the browser

Because the static HTML exists precisely so the copy is readable without
running anything (APP-48), and swapping it with JavaScript hands a
crawler the English page and a reader the German one. It would also
leave one URL claiming to be eight languages, which is not something
hreflang can express and not something a search engine can serve: the
German result has to have a German URL to send people to.

## What is deliberately not translated

- **The wordmark.** `translate="no"` in the markup.
- **Preset identifiers** -- `<code data-v>Neon</code>`. That string is
  what you pick in the app; renaming it on the page sends a reader
  looking for a style that is not in the list.
- **Numbers, and anything else marked `data-v`.**
- **Proper nouns inside a sentence** -- Whisper, libass, ffmpeg, AGPL-3.0
  -- which stay English because the translations keep them.

Anything with no entry in a catalogue falls back to English, so a gap is
survivable; `--check` is what makes it loud.
"""

import glob
import datetime
import html
import unicodedata
import io
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import site_i18n as S  # noqa: E402

WEB = os.path.dirname(HERE)
# Where the pages to translate are, and where the 32 locale pages go.
#
# `SITE_ROOT` points this at the composed site — the product page from the
# private site repo with the app inside it — instead of the app's own `dist/`.
# After the website moved out, `dist/index.html` is a bare shell, and this
# script would faithfully generate thirty-two translated copies of it.
DIST = os.environ.get("SITE_ROOT") or os.path.join(WEB, "dist")
CATALOGUES = os.path.join(HERE, "site-i18n")

ORIGIN = "https://opensubs.app"

# The eight, and the path each page answers on. `en` lives at the root:
# it is the canonical site, and moving it to /en/ would break every link
# anyone has already saved.
LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "es", "pt"]

# path, and the sitemap hints that used to live in public/sitemap.xml --
# which this script now writes, because a hand-kept sitemap and thirty-two
# generated pages cannot stay in agreement.
PAGES = {
    "index.html": ("", "2026-09-10", "weekly", "1.0"),
    "burn-subtitles-into-video.html": ("burn-subtitles-into-video", "2026-09-09", "monthly", "0.8"),
    "styles.html": ("styles", "2026-09-10", "monthly", "0.8"),
    "privacy.html": ("privacy.html", "2026-08-29", "yearly", "0.3"),
}

# Which languages a page exists in, where that is not all of them.
#
# A ring may only name pages that exist: Google's requirement is that every
# version declared is real, not that every language is present. The
# Portuguese guide is the first page written in one language and not the
# other six, and a ring auto-filled to eight would have declared six
# addresses that 404 -- worse than having no ring at all (APP-180).
#
# The footer row still offers all eight: a language with no copy of *this*
# page links to that language's home, which exists, and the reader gets
# where they were going.
PAGE_LOCALES = {}


def locales_for(page):
    return PAGE_LOCALES.get(page, LOCALES)

# og:locale wants a POSIX-ish tag, not BCP 47.
OG_LOCALE = {
    "en": "en_US", "zh-Hans": "zh_CN", "zh-Hant": "zh_TW", "ja": "ja_JP",
    "ko": "ko_KR", "de": "de_DE", "es": "es_ES", "pt": "pt_BR",
}


def url_for(locale, page):
    path = PAGES[page][0]
    if locale == "en":
        return f"{ORIGIN}/{path}"
    if not path:
        # The locale's home page is /ja, not /ja/ -- and it is written to
        # ja.html rather than ja/index.html. Production resolves a clean
        # URL with `try_files $uri $uri.html $uri/` and separately 301s any
        # trailing slash away, so /ja/ would bounce to /ja and /ja would
        # then have to be found through the directory index. One file the
        # `$uri.html` rule finds directly is the same page with none of
        # that, and it matches how /styles already works.
        return f"{ORIGIN}/{locale}"
    return f"{ORIGIN}/{locale}/{path}"


def load_catalogue(locale):
    if locale == "en":
        return {}
    path = os.path.join(CATALOGUES, f"{locale}.json")
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


# --- rewriting one page -------------------------------------------------

# Values that are legitimately the same string as their English source:
# proper nouns, licence identifiers, and loanwords several of these
# languages have taken whole. Listed rather than allowed by a looser
# check, so a genuine copy-paste still stands out.
IDENTICAL = {
    "OpenSubs", "AGPL-3.0", "CJK", "Paris, 1968", "Instagram Reels",
    "YouTube Shorts", "Twitch", "twitch", "TikTok", "tiktok", "Podcast",
    "podcast", "Reels", "reels", "Gaming", "gaming", "Fitness", "fitness",
    "Interview", "Meme", "meme", "Trailer", "Tutorial", "tutorial",
    "Streaming", "streaming", "Screencast", "screencast", "Hook", "hook",
    "Broadcast", "Gym", "viral", "minimal", "Downloads", "Video",
    "Talking Head", "Business", "Credits", "Clips", "clips", "Film",
    "Gaming Neon Cyan", "cinema", "trailer",
    "<span>Paris, 1968</span>", "<span>\u5b57\u5e55\u306f\u81ea\u52d5\u3067\u4f5c\u308c\u307e\u3059</span>",
}

ASSET_HREF = re.compile(r"\.(png|ico|svg|txt|xml|json|wasm|webmanifest|jpg|webp)$")


def localise_link(href, locale):
    """Point an in-site link at this locale's copy of the same page.

    Only `<a href>` goes through here. A stylesheet or an icon has one
    copy at the root and must keep pointing at it -- prefixing those
    would give every locale its own 404 for the favicon.
    """
    if locale == "en" or not href.startswith("/") or href.startswith("//"):
        return href
    path, sep, fragment = href.partition("#")
    if ASSET_HREF.search(path.split("?")[0]):
        # ...except privacy.html, which is a page that happens to end in
        # .html rather than an asset.
        if not path.endswith(".html"):
            return href
    if path == "/":
        path = ""
    return f"/{locale}{path}{sep}{fragment}"


def hreflang_ring(page):
    """The alternates block: every locale, plus x-default.

    x-default is English, because that is what a reader whose language
    we do not ship should land on -- not whichever locale happens to
    sort first.
    """
    lines = [
        f'<link rel="alternate" hreflang="{code}" href="{url_for(code, page)}" />'
        for code in locales_for(page)
    ]
    lines.append(f'<link rel="alternate" hreflang="x-default" href="{url_for("en", page)}" />')
    return "\n".join(lines)


def refuse_inline_scripts(tree, page):
    """The site's CSP is `script-src 'self'`.

    An inline <script> is therefore dropped by the browser without an
    error anyone will see -- the page renders, the control does nothing.
    That shipped once, on /styles' language picker. Checked here because
    this is the one pass that parses every page on every build.
    """
    for node in tree.root.walk():
        if node.tag != "script":
            continue
        if node.attrs.get("src") or node.attrs.get("type") == "application/ld+json":
            continue
        raise SystemExit(
            f"{page}: an inline <script> would be dropped by the CSP "
            f"(script-src 'self'). Put it in a module the page already loads.")


def translate_page(raw, page, locale, catalogue, stats):
    tree = S.Tree(raw)
    refuse_inline_scripts(tree, page)
    edits = []

    def look_up(text):
        key = S.collapse(text)
        hit = catalogue.get(key)
        stats["seen"].add(key)
        if hit is None:
            stats["missing"].setdefault(locale, set()).add(key)
            return None
        return hit

    # 1. Blocks of copy.
    for node in S.copy_blocks(tree):
        key, values = S.keyed(tree, node)
        hit = look_up(key)
        if hit is not None:
            edits.append((node.inner_start, node.inner_end, S.unkey(hit, values)))

    # 2. Attributes that hold copy, and the meta tags that carry the
    #    page's own title and description into a search result.
    for node, name in S.copy_attrs(tree):
        span = S.attr_span(tree, node, name)
        if span is None:
            continue
        start, end, value = span
        hit = look_up(value)
        if hit is not None:
            edits.append((start, end, escape_attr(hit)))

    # 3. Structured data. A German page whose FAQPage answers are in
    #    English offers a search engine the English answer to show
    #    beside a German result.
    for node, data in S.ld_blocks(tree):
        strings = []
        S.ld_strings(data, strings)
        for value in strings:
            look_up(value)
        translated = S.ld_translate(data, lambda v: catalogue.get(S.collapse(v), v))
        translated = retarget_ld(translated, page, locale)
        body = json.dumps(translated, ensure_ascii=False, indent=2)
        edits.append((node.inner_start, node.inner_end, "\n" + body + "\n"))

    # 5. The document's own identity: lang, canonical, og:url, og:locale.
    html = next(n for n in tree.root.walk() if n.tag == "html")
    span = S.attr_span(tree, html, "lang")
    if span:
        edits.append((span[0], span[1], locale))

    for node in tree.root.walk():
        if node.tag == "link" and node.attrs.get("rel") == "canonical":
            span = S.attr_span(tree, node, "href")
            edits.append((span[0], span[1], url_for(locale, page)))
            # The ring goes in right after the canonical, where a reader
            # of the source expects to find it.
            close = raw.find(">", node.tag_start) + 1
            edits.append((close, close, "\n" + hreflang_ring(page)))
        if node.tag == "meta" and node.attrs.get("property") == "og:url":
            span = S.attr_span(tree, node, "content")
            edits.append((span[0], span[1], url_for(locale, page)))
        if node.tag == "meta" and node.attrs.get("property") == "og:locale":
            span = S.attr_span(tree, node, "content")
            edits.append((span[0], span[1], OG_LOCALE[locale]))

    # 6. The switcher says which language you are reading. In the source
    #    that is English, because the source is the English page; on every
    #    other copy the mark has to move, or all eight pages claim to be
    #    the English one -- to a screen reader, which reads aria-current,
    #    and to anyone using the highlight to see where they are.
    for node in tree.root.walk():
        if node.tag != "a" or "hreflang" not in node.attrs:
            continue
        is_here = node.attrs.get("hreflang") == locale
        span = S.attr_span(tree, node, "aria-current")
        if span and not is_here:
            # Take the whole attribute out, spaces and all.
            start = raw.rindex(" aria-current", node.tag_start, span[0])
            edits.append((start, raw.index('"', span[1]) + 1, ""))
        elif is_here and not span:
            close = raw.index(">", node.tag_start)
            edits.append((close, close, ' aria-current="page"'))

    # In-site links are moved *after* the splice rather than as more
    # edits. A translated block carries its own <a href> along with it --
    # the footer is one block containing four links -- so rewriting them
    # in the source would collide with the rewrite of the block they sit
    # inside. The translations keep every href verbatim, so one pass over
    # the finished document reaches both.
    return ANCHOR.sub(
        lambda m: m.group(0) if SPEAKS_FOR_ITSELF.search(m.group(0)) else
        m.group(1) + localise_link(m.group(2), locale) + m.group(3),
        S.splice(raw, edits),
    )


# The whole opening tag, so the rule below can see the attributes on either
# side of `href`.
ANCHOR = re.compile(r"""(<a\b[^>]*?\shref=")([^"]*)("[^>]*>)""")
# A link that says which language it points at is already pointing where it
# means to: the switcher's own links name all eight, and moving them into
# this locale would leave every page offering only itself (APP-151).
SPEAKS_FOR_ITSELF = re.compile(r"\shreflang=")


def escape_attr(text):
    return text.replace("&", "&amp;").replace('"', "&quot;").replace("&amp;#", "&#") \
               .replace("&amp;amp;", "&amp;")


def retarget_ld(data, page, locale):
    """Point the structured data at this locale's URL, and say so."""
    if isinstance(data, dict):
        out = {}
        for key, value in data.items():
            if key == "url" and isinstance(value, str) and value.rstrip("/") in (
                ORIGIN, url_for("en", page).rstrip("/")
            ):
                out[key] = url_for(locale, page)
            else:
                out[key] = retarget_ld(value, page, locale)
        if out.get("@type") in ("SoftwareApplication", "FAQPage", "WebPage", "Article"):
            out["inLanguage"] = locale
        return out
    if isinstance(data, list):
        return [retarget_ld(v, page, locale) for v in data]
    return data


# --- sitemap ------------------------------------------------------------

def last_changed(path, fallback):
    """When this page last changed, as its repository records it.

    A date typed into the table above is right on the day it is typed and
    wrong from then on: the home page said 2026-09-10 while the copy on it
    had been rewritten twice since (APP-180). `git log` knows, and it knows
    per file, so a page that has not changed keeps its old date -- which is
    the point of the field. Falls back to the table where git cannot answer,
    as in a tarball with no history.
    """
    try:
        out = subprocess.run(
            ["git", "-C", os.path.dirname(path) or ".", "log", "-1", "--format=%cs", "--", os.path.basename(path)],
            capture_output=True, text=True, timeout=10)
        stamp = out.stdout.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", stamp):
            return stamp
    except Exception:
        pass
    return fallback


def handwritten():
    """The pages this script does not generate, read off the build itself.

    The blog, the two landing pages and the Portuguese guide are written by
    hand into the deploy directory; this script writes the sitemap. Listing
    only its own pages dropped eleven URLs from it -- including the whole
    blog -- every time it ran (APP-180). Rather than a second list to keep
    in step, each page is read for what it already declares: its canonical,
    its own hreflang ring, and whether it asks to be indexed at all.
    """
    out = []
    for path in sorted(glob.glob(os.path.join(DIST, "**", "*.html"), recursive=True)):
        rel = os.path.relpath(path, DIST)
        if rel in PAGES or any(rel == os.path.join(loc, p) or rel == f"{loc}.html"
                               for loc in LOCALES for p in PAGES):
            continue
        raw = io.open(path, encoding="utf-8", errors="replace").read()
        if re.search(r'<meta name="robots"[^>]*noindex', raw):
            continue
        canonical = re.search(r'<link rel="canonical" href="([^"]+)"', raw)
        if not canonical:
            continue
        ring = [(code, href) for code, href in
                re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"', raw)]
        when = last_changed(path, datetime.date.fromtimestamp(os.path.getmtime(path)).isoformat())
        out.append((canonical.group(1), when, ring))
    return out


# What a search result has room for. Google measures pixels; columns are the
# workable stand-in, and the two disagreements that matter are both handled
# below: a CJK character occupies two columns, and `&mdash;` is seven
# characters of source that a reader sees as one (APP-180).
TITLE_COLUMNS = 60
DESCRIPTION_COLUMNS = (100, 170)


def columns(text):
    """How wide `text` renders, in columns."""
    shown = html.unescape(re.sub(r"<[^>]+>", "", text))
    wide = sum(1 for c in shown if unicodedata.east_asian_width(c) in ("W", "F"))
    return len(shown) + wide


def too_long(page, locale, raw):
    """Titles and descriptions a search result would cut off."""
    faults = []
    title = re.search(r"<title>(.*?)</title>", raw, re.S)
    if title:
        width = columns(title.group(1))
        if width > TITLE_COLUMNS:
            faults.append(f"{locale}/{page}: title is {width} columns, over {TITLE_COLUMNS} -- "
                          f"Google cuts it mid-sentence")
    description = re.search(r'<meta name="description" content="([^"]*)"', raw)
    if description:
        width = columns(description.group(1))
        low, high = DESCRIPTION_COLUMNS
        if not low <= width <= high:
            faults.append(f"{locale}/{page}: description is {width} columns, outside {low}-{high}")
    return faults


def page_source(page):
    """Where this page is written, which is not always in this repository."""
    site = os.environ.get("SITE_SOURCE") or os.path.join(WEB, "..", "..", "..", "opensubs-website")
    at = {"index.html": ("template", "index.html"), "privacy.html": ("public", "privacy.html")}
    if page in at and os.path.isdir(site):
        return os.path.join(site, *at[page])
    return os.path.join(WEB, page)


def sitemap():
    """Every page in every language, each listing the whole ring.

    Google reads the alternates from the sitemap as well as from the
    page, and a set that disagrees with itself is worse than one that is
    only in one place -- so both are generated from the same table.
    """
    # The stylesheet is for people, not for crawlers, and it is not
    # optional decoration (APP-69). Once this sitemap started carrying
    # hreflang alternates it gained elements in the XHTML namespace, and
    # Chromium then declines to apply its built-in XML pretty-printer:
    # it treats the document as renderable markup and lays the text out,
    # so every URL, date and priority runs together in one paragraph.
    # The file is still valid and Bing still accepts it -- what was
    # missing was any instruction for how to display it. public/sitemap.xsl
    # supplies one, and no sitemap parser reads the instruction.
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
           'xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for page, (_, lastmod, changefreq, priority) in PAGES.items():
        lastmod = last_changed(page_source(page), lastmod)
        for locale in locales_for(page):
            out.append("  <url>")
            out.append(f"    <loc>{url_for(locale, page)}</loc>")
            out.append(f"    <lastmod>{lastmod}</lastmod>")
            out.append(f"    <changefreq>{changefreq}</changefreq>")
            out.append(f"    <priority>{priority}</priority>")
            for other in locales_for(page):
                out.append(f'    <xhtml:link rel="alternate" hreflang="{other}" '
                           f'href="{url_for(other, page)}" />')
            out.append('    <xhtml:link rel="alternate" hreflang="x-default" '
                       f'href="{url_for("en", page)}" />')
            out.append("  </url>")
    for url, lastmod, ring in handwritten():
        out.append("  <url>")
        out.append(f"    <loc>{url}</loc>")
        out.append(f"    <lastmod>{lastmod}</lastmod>")
        out.append("    <changefreq>monthly</changefreq>")
        out.append("    <priority>0.7</priority>")
        for code, href in ring:
            out.append(f'    <xhtml:link rel="alternate" hreflang="{code}" href="{href}" />')
        out.append("  </url>")
    out.append("</urlset>")
    return "\n".join(out) + "\n"


def main():
    check_only = "--check" in sys.argv
    root = DIST if os.path.isdir(DIST) and not check_only else WEB
    if check_only:
        # `--check` reads the sources rather than the build. privacy.html is
        # the site's, so since the website moved out it is no longer under
        # `public/` here; SITE_SOURCE points at the site repo's copy. Without
        # it a bare `--check` would report the page as missing, which is not
        # the same thing as untranslated and would read as a real gap.
        # `--check` reads sources rather than the build, and since the website
        # moved out two of them are no longer in this repo. `SITE_SOURCE`
        # points at the site repo: index.html is its template (the page with
        # the app cut out, which still holds every translatable string on it),
        # and privacy.html is under its public/. The two SEO pages stay here,
        # because they are bundler entry points.
        #
        # Without this a bare `--check` reads the bare app shell as index.html
        # and reports most of the catalogue as unused — which looks like the
        # translations rotting rather than the file having moved.
        site_src = os.environ.get("SITE_SOURCE")
        site_at = {"index.html": ("template", "index.html"),
                   "privacy.html": ("public", "privacy.html")}
        sources = {}
        for p in PAGES:
            if site_src and p in site_at:
                sources[p] = os.path.join(site_src, *site_at[p])
            elif p == "privacy.html":
                sources[p] = os.path.join(WEB, "public", p)
            else:
                sources[p] = os.path.join(WEB, p)
    else:
        sources = {p: os.path.join(DIST, p) for p in PAGES}

    stats = {"seen": set(), "missing": {}}
    written = 0
    overlong = []
    for page, path in sources.items():
        raw = io.open(path, encoding="utf-8").read()
        for locale in LOCALES:
            catalogue = load_catalogue(locale)
            out = translate_page(raw, page, locale, catalogue, stats)
            if check_only:
                continue
            if locale == "en":
                target = os.path.join(DIST, page)
            elif page == "index.html":
                target = os.path.join(DIST, locale + ".html")
            else:
                os.makedirs(os.path.join(DIST, locale), exist_ok=True)
                target = os.path.join(DIST, locale, page)
            io.open(target, "w", encoding="utf-8").write(out)
            written += 1
            overlong.extend(too_long(page, locale, out))

    if not check_only:
        io.open(os.path.join(DIST, "sitemap.xml"), "w", encoding="utf-8").write(sitemap())

    keys = sorted(stats["seen"])
    io.open(os.path.join(CATALOGUES, "keys.json"), "w", encoding="utf-8").write(
        json.dumps(keys, ensure_ascii=False, indent=1) + "\n")

    # `en` is the key set, so every key is "missing" from it by
    # definition -- it is the source, not a translation.
    gaps = 0
    for locale in LOCALES[1:]:
        miss = stats["missing"].get(locale, set())
        if miss:
            gaps += len(miss)
            print(f"  {locale}: {len(miss)} untranslated")
            for key in sorted(miss)[:6]:
                print(f"      {key[:88]}")

    # A value identical to its English source is usually a copy-paste that
    # never got translated -- invisible at runtime, because the fallback
    # produces exactly the same page. IDENTICAL lists the ones that are
    # genuinely the same word in that language.
    echoes = 0
    for locale in LOCALES[1:]:
        table = load_catalogue(locale)
        same = [k for k, v in table.items() if k == v and k not in IDENTICAL]
        if same:
            echoes += len(same)
            print(f"  {locale}: {len(same)} untouched")
            for key in same[:6]:
                print(f"      {key[:88]}")

    if overlong:
        print(f"  {len(overlong)} title(s) or description(s) a search result would cut:")
        for fault in overlong[:8]:
            print(f"      {fault}")

    print(f"{written} pages, {len(keys)} keys, {gaps} gaps, {echoes} untouched, "
          f"{len(overlong)} over length")
    if (gaps or echoes) and "--strict" in sys.argv:
        raise SystemExit("untranslated copy would ship; refusing")
    if overlong and "--strict" in sys.argv:
        raise SystemExit("a title or description would be cut off in the results; refusing")


if __name__ == "__main__":
    main()
