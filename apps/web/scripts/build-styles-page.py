# -*- coding: utf-8 -*-
"""Generate /styles from the engine's own preset values.

Every colour, size, outline width and margin below is read from
`opensubs styles --export <name>` rather than typed in, so a preset
change is one regeneration away from being right on the page. That is
the whole reason the page renders live instead of shipping screenshots.
"""
import io, json, subprocess, re

import os, shutil

# The engine binary. Built by `cargo build --release -p opensubs`; the
# target directory moves on a machine with a .cargo/config.toml, so this
# looks in both places and says which it wants rather than failing with a
# file-not-found on a path nobody chose.
def find_binary():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for c in (os.path.join(here, "..", "..", "target", "release", "opensubs"),
              "/tmp/opensubs-target/release/opensubs",
              shutil.which("opensubs")):
        if c and os.path.isfile(c):
            return c
    raise SystemExit(
        "cannot find the `opensubs` binary.\n"
        "  build it first:  cargo build --release -p opensubs")

BIN = find_binary()

# Scenario name, tags and a line of sample copy per preset. The scenario
# name is the headline because that is what somebody searches for; the
# real preset name is shown underneath because that is what they have to
# pick in the app, and a gallery that renames things without saying so
# sends people looking for a style that is not in the list.
SCENES = {
  "Clean":    ("Interview Clean White", ["interview", "documentary", "talking head", "white subtitles"],
               "so we started in a garage"),
  "Bold":     ("Fitness Bold White", ["fitness", "gym", "workout", "bold subtitles"],
               "10 REPS · 3 SETS · NO REST"),
  "Boxed":    ("Corporate Clean Box", ["corporate", "explainer", "training", "boxed subtitles"],
               "Q3 revenue grew 18%"),
  "Shorts":   ("Shorts Safe Area", ["youtube shorts", "tiktok", "reels", "vertical video"],
               "wait for the last one"),
  "Caption":  ("Broadcast Caption Yellow", ["broadcast", "news", "accessibility", "yellow subtitles"],
               "BREAKING: markets open higher"),
  "CJK":      ("CJK Clean 中日韓", ["chinese subtitles", "japanese subtitles", "korean subtitles", "cjk"],
               "字幕は自動で作れます"),
  "Neon":     ("Gaming Neon Cyan", ["gaming", "streaming", "twitch", "neon subtitles"],
               "GG that was insane"),
  "Podcast":  ("Podcast Top Bar", ["podcast", "interview", "top captions", "clips"],
               "…and that's when it clicked"),
  "Cinema":   ("Cinema Letterbox Cream", ["cinema", "film", "trailer", "documentary"],
               "Paris, 1968"),
  "Punch":    ("Punch Centre Impact", ["meme", "viral", "hook", "centre captions"],
               "NOBODY TELLS YOU THIS"),
  "Minimal":  ("Minimal Dark on Light", ["minimal", "tutorial", "screencast", "light background"],
               "step 3 — add the garlic"),
  "Reel Box": ("Reel Box Bottom", ["instagram reels", "vertical video", "social", "boxed captions"],
               "save this for later"),
}
ORDER = list(SCENES)

def export(name):
    out = subprocess.run([BIN, "styles", "--export", name], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"could not export {name!r}: {out.stderr.strip()}")
    return json.loads(out.stdout)

def rgba(c, alpha=None):
    a = c["a"] / 255 if alpha is None else alpha
    return f"rgba({c['r']},{c['g']},{c['b']},{round(a, 3)})"

def outline_ring(colour, width):
    """Approximate libass's outline with a ring of shadows.

    ASS draws a true stroke; CSS has -webkit-text-stroke, which draws
    *inside* the glyph and thins the letterform. Eight offsets at the
    outline's radius read the same at this size and keep the weight."""
    if width <= 0:
        return "none"
    r = round(width * 0.34, 2)          # ASS outline units are generous
    offs = [(r, 0), (-r, 0), (0, r), (0, -r),
            (r * 0.7, r * 0.7), (-r * 0.7, r * 0.7),
            (r * 0.7, -r * 0.7), (-r * 0.7, -r * 0.7)]
    return ", ".join(f"{x}px {y}px 0 {colour}" for x, y in offs)

ALIGN = {2: "bottom", 8: "top", 5: "middle"}

# Presets drawn for a light picture. Detected from the preset itself
# rather than listed by name: text darker than its own outline means the
# style expects a bright background behind it.
def wants_light(d):
    lum = lambda c: 0.2126 * c["r"] + 0.7152 * c["g"] + 0.0722 * c["b"]
    return lum(d["primary"]) < lum(d["outline_color"])

cards = []
for name in ORDER:
    d = export(name)
    scene, tags, sample = SCENES[name]
    boxed = d["border_style"] == "OpaqueBox"
    ring = outline_ring(rgba(d["outline_color"]), d["outline"])
    if d["shadow"] > 0:
        drop = round(d["shadow"] * 0.5, 2)
        ring = (ring + ", " if ring != "none" else "") + f"{drop}px {drop}px {drop*1.6}px rgba(0,0,0,0.65)"
    style = [
        f"--size:{d['size_pct']}",
        f"--fg:{rgba(d['primary'])}",
        f"--mv:{d['margin_v_pct']}",
        f"--ring:{ring}",
    ]
    if boxed:
        style.append(f"--box:{rgba(d['back_color'])}")
    cls = "cap " + ALIGN.get(d["alignment"], "bottom") + (" boxed" if boxed else "")
    weight = "700" if d["bold"] else "400"
    italic = "font-style:italic;" if d["italic"] else ""
    tag_html = "".join(f"<li>{t}</li>" for t in tags)
    frame_cls = "frame light" if wants_light(d) else "frame"
    cards.append(f"""      <article class="style-card">
        <div class="{frame_cls}">
          <div class="{cls}" style="{';'.join(style)};font-weight:{weight};{italic}"><span>{sample}</span></div>
        </div>
        <div class="style-meta">
          <h3 class="style-name">{scene}</h3>
          <p class="style-preset">Preset <code data-v>{name}</code> — <span data-v>{d['size_pct']}</span>% height{', boxed' if boxed else f", <span data-v>{d['outline']}</span>px outline"}</p>
          <ul class="tags">{tag_html}</ul>
        </div>
      </article>""")

CARDS = "\n".join(cards)


# --- the page -----------------------------------------------------------

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = io.open(os.path.join(HERE, "burn-subtitles-into-video.html"), encoding="utf-8").read()
chrome_css = re.search(r"<style>([\s\S]*?)</style>", src).group(1)
header = src[src.index('<div class="site-chrome">'):src.index("</header>") + 9]
footer = src[src.index("<footer"):src.index("</footer>") + 9]

# This page has no app on it, so every in-page anchor the navbar carries
# belongs to the home page.
header = (header.replace('href="#how"', 'href="/#how"')
                .replace('href="#app"', 'href="/#app"')
                .replace('href="#top"', 'href="/"'))

# The language picker, written into the markup rather than mounted.
#
# Every other page mounts src/lib/LanguagePicker.svelte, which arrives
# with main.ts. This page loads design tokens and nothing else -- pulling
# main.ts in for one <select> would drag eight hundred kilobytes of tool
# onto the one page whose job is to load fast and be crawled.
#
# The behaviour lives in src/styles-page.ts, which this page already
# loads. Not in an inline <script>: the site's CSP is `script-src 'self'`,
# so an inline one is dropped without a word.
LOCALES = [("en", "English"), ("zh-Hans", "简体中文"),
           ("zh-Hant", "繁體中文"), ("ja", "日本語"),
           ("ko", "한국어"), ("de", "Deutsch"), ("es", "Español"),
           ("pt", "Português")]
# `translate="no"` on each option: an endonym is the same word in every
# locale -- 日本語 is 日本語 on the German page -- and a picker that lists
# "Japanese" in English is no use to the one person who needs it.
options = "".join(
    f'<option value="{code}" lang="{code}" translate="no">{name}</option>'
    for code, name in LOCALES)
PICKER = f"""<label class="lang">
        <span class="lang-hidden">Language</span>
        <select aria-label="Language">{options}</select>
      </label>"""
assert '<div id="language"></div>' in header, "the burn page lost its picker slot"
header = header.replace('<div id="language"></div>', PICKER)

TITLE = "Subtitle Styles \u2014 12 Free Caption Presets, Rendered Live | OpenSubs"
DESC = ("Twelve subtitle styles you can burn into a video free: bold fitness captions, "
        "neon gaming text, broadcast yellow, CJK, cinema, podcast bars and more. "
        "Every one rendered live, not a screenshot.")

FAQ = [
  ("Can I change the subtitle font and colour?",
   "Yes. Every preset here is a starting point: font, size, colour, outline, shadow, "
   "box and position are all editable in the app, and a style can be exported as JSON "
   "and loaded back."),
  ("Which subtitle style should I use for TikTok or Reels?",
   "Shorts Safe Area and Reel Box sit high enough to clear the interface a vertical "
   "platform draws over the bottom of the frame. Both use a large size so the text "
   "survives being watched on a phone."),
  ("Are these styles free?",
   "The six in the core pack are free. The advanced pack is free too at the moment \u2014 "
   "the badge in the app says what a thing costs you today."),
]

def ld(o):
    return json.dumps(o, ensure_ascii=False, indent=2)

breadcrumb = {
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "OpenSubs", "item": "https://opensubs.app/"},
    {"@type": "ListItem", "position": 2, "name": "Subtitle styles", "item": "https://opensubs.app/styles"},
  ],
}
faq_json = {
  "@context": "https://schema.org", "@type": "FAQPage",
  "mainEntity": [{"@type": "Question", "name": q,
                  "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ],
}
faq_html = "".join(
  f"\n        <details>\n          <summary>{q}</summary>\n          <p>{a}</p>\n        </details>"
  for q, a in FAQ)

html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{TITLE}</title>
  <meta name="description" content="{DESC}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta name="theme-color" content="#f2f2f2" />
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
  <link rel="apple-touch-icon" href="/icon-180.png" />
  <link rel="canonical" href="https://opensubs.app/styles" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="OpenSubs" />
  <meta property="og:title" content="{TITLE}" />
  <meta property="og:description" content="{DESC}" />
  <meta property="og:url" content="https://opensubs.app/styles" />
  <meta property="og:image" content="https://opensubs.app/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{TITLE}" />
  <meta name="twitter:description" content="{DESC}" />
  <meta name="twitter:image" content="https://opensubs.app/og-image.png" />
  <script type="application/ld+json">
{ld(breadcrumb)}
  </script>
  <script type="application/ld+json">
{ld(faq_json)}
  </script>
  <style>
{chrome_css}
  </style>
</head>
<body>
<!--
  GENERATED by scripts/build-styles-page.py -- edit that, not this.

  Every caption on this page is drawn from `opensubs styles --export`,
  so a preset change is one regeneration away from being right here. The
  category has nobody shipping screenshots for this, and rightly: the
  product is a renderer, so its own output is both more convincing and
  free to keep current.
-->
{header}

<main>
  <section class="hero" id="top">
    <div class="wrap">
      <h1>Twelve subtitle styles, rendered here rather than screenshotted</h1>
      <p class="subhead">
        Every caption below is drawn by the browser from the same style file the
        app burns with &mdash; the sizes, colours and outlines are the preset&rsquo;s own.
      </p>
      <p class="lede">
        Pick one in the app and it looks like this. Change the font, colour,
        outline or position and it stops looking like this, which is rather the
        point: a preset is a starting point, not a fixed set.
      </p>
      <div class="cta">
        <a class="site-btn site-btn-primary btn-lg" href="/#app">Open the app</a>
        <a class="site-btn site-btn-secondary btn-lg" href="/burn-subtitles-into-video">Burn them into a video</a>
      </div>
      <p class="reassure">Free. No account, no watermark, nothing uploaded.</p>
    </div>
  </section>

  <section id="gallery">
    <div class="wrap">
      <div class="section-head">
        <h2>The twelve</h2>
        <p>
          Six in the core pack, six in the advanced pack. The name under each one
          is what to pick in the app. Captions are scaled up for legibility; the
          sizes relative to one another are the engine&rsquo;s.
        </p>
      </div>
      <div class="style-grid">
{CARDS}
      </div>
    </div>
  </section>

  <section id="faq">
    <div class="wrap">
      <div class="section-head">
        <h2>Questions</h2>
      </div>
      <div class="faq">{faq_html}
      </div>
    </div>
  </section>
</main>

{footer}
</div>
<script type="module" src="/src/styles-page.ts"></script>
</body>
</html>
"""

out = os.path.join(HERE, "styles.html")
io.open(out, "w", encoding="utf-8").write(html)
print(f"{len(cards)} cards, {sum(len(SCENES[n][1]) for n in ORDER)} tags -> {out} ({len(html)} bytes)")
