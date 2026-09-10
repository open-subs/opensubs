"""Shared machinery for translating the static pages.

The site is not the app. The app is Svelte and translates itself at
runtime from `src/lib/i18n/`; these pages are the HTML that comes off the
wire, and their whole job (APP-48) is to put the copy in front of a
crawler without anything having to run. Swapping their text with
JavaScript would undo exactly that -- and would leave one URL claiming to
be eight languages, which is not something a search engine can serve.

So the pages are translated at build time into `/<locale>/`: one real
document per language, each with its own <html lang>, title and
description, and an hreflang ring pointing at all the others.

The unit of translation is a *block of copy*, not a text node. A
paragraph with a link inside it is one sentence to whoever translates it,
so the key is the block's inner HTML with whitespace collapsed -- inline
tags and all. Splitting at <a> would hand a translator three fragments
and no way to reorder them, which several of these languages need to.
"""

import json
import re
from html.parser import HTMLParser

# Tags that live *inside* a sentence. An element whose descendants are
# only text and these is one unit of copy; anything else is a container
# to descend into.
INLINE = {
    "a", "abbr", "b", "br", "code", "em", "i", "kbd", "small",
    "span", "strong", "sub", "sup", "u", "wbr",
}

# Never translated, never descended into. <svg> is markup that reads as
# text to a naive walker (an icon's own <title>); script and style are
# code -- the JSON-LD blocks inside <script> are handled separately,
# because there the strings are values in a document, not copy in a page.
OPAQUE = {"script", "style", "svg", "template"}

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}

# Attributes that hold copy. `content` only on the meta names listed in
# META_COPY -- most <meta content> is a URL, a size or a robots directive.
COPY_ATTRS = ("alt", "aria-label", "placeholder", "title")

META_COPY = {
    "description",
    "og:title", "og:description",
    "twitter:title", "twitter:description",
    "apple-mobile-web-app-title",
}

HAS_LETTER = re.compile(r"[A-Za-zÀ-ɏ]")

# Elements carrying a *value* rather than copy: a number, an identifier,
# a line of sample footage. They are lifted out of the key as {0}, {1},
# ... and put back verbatim afterwards.
#
# Without this, "Preset <code>Neon</code> - 5.5% height, 3.5px outline"
# is twelve different keys that differ only in their numbers, and a
# translator is asked to retype 5.5 correctly twelve times.
PLACEHOLDER = "data-v"


class Node:
    __slots__ = ("tag", "attrs", "children", "parent", "tag_start", "inner_start", "inner_end")

    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []
        self.parent = parent
        self.tag_start = None
        self.inner_start = None
        self.inner_end = None

    def walk(self):
        yield self
        for child in self.children:
            yield from child.walk()


class Tree(HTMLParser):
    """A DOM thin enough to give back source offsets.

    Offsets are the point. Every rewrite this module makes is a splice
    into the original string, so anything it does not understand -- a
    comment, an odd attribute, the exact whitespace inside <pre> --
    survives byte for byte. Reserialising a parsed tree would quietly
    reformat the whole document instead.
    """

    def __init__(self, raw):
        super().__init__(convert_charrefs=False)
        self.raw = raw
        self.line_start = [0]
        for line in raw.splitlines(keepends=True):
            self.line_start.append(self.line_start[-1] + len(line))
        self.root = Node("#document", [], None)
        self.node = self.root
        self.feed(raw)
        self.close()

    def _at(self):
        line, col = self.getpos()
        return self.line_start[line - 1] + col

    def handle_starttag(self, tag, attrs):
        start = self._at()
        node = Node(tag, attrs, self.node)
        node.tag_start = start
        node.inner_start = start + len(self.get_starttag_text() or "")
        self.node.children.append(node)
        if tag not in VOID:
            self.node = node

    def handle_startendtag(self, tag, attrs):
        start = self._at()
        node = Node(tag, attrs, self.node)
        node.tag_start = start
        node.inner_start = node.inner_end = start + len(self.get_starttag_text() or "")
        self.node.children.append(node)

    def handle_endtag(self, tag):
        # Walk up to the matching open tag. Unbalanced markup in pages
        # this hand-written would be a bug, but it must not take a build
        # down: an unmatched close tag is simply dropped.
        node = self.node
        while node is not self.root and node.tag != tag:
            node = node.parent
        if node is self.root:
            return
        node.inner_end = self._at()
        self.node = node.parent


def collapse(text):
    """One space between words, none at the ends.

    The key has to survive reflowing the source. These paragraphs are
    hard-wrapped at eighty columns and get rewrapped whenever a sentence
    is edited; a key that carried the line breaks would be orphaned by a
    change that did not alter a single word.
    """
    return re.sub(r"\s+", " ", text).strip()


def _inner(tree, node):
    if node.inner_start is None or node.inner_end is None:
        return ""
    return tree.raw[node.inner_start:node.inner_end]


def keyed(tree, node):
    """The node's copy as (key, values).

    `key` is the inner HTML with whitespace collapsed and every `data-v`
    element replaced by `{n}`; `values` are those elements' source text,
    in order, ready to be put back.
    """
    values = []
    pieces = []
    cursor = node.inner_start

    def scan(parent):
        nonlocal cursor
        for child in parent.children:
            if PLACEHOLDER in child.attrs:
                end = child.inner_end if child.inner_end is not None else child.inner_start
                # Past the close tag, so the placeholder swallows the
                # whole element rather than only what is inside it.
                close = tree.raw.find(">", end) + 1 if child.inner_end is not None else end
                pieces.append(tree.raw[cursor:child.tag_start])
                pieces.append("{%d}" % len(values))
                values.append(tree.raw[child.tag_start:close])
                cursor = close
            else:
                scan(child)

    scan(node)
    pieces.append(tree.raw[cursor:node.inner_end])
    return collapse("".join(pieces)), values


def unkey(key, values):
    """Put the `data-v` elements back into a translated string."""
    out = key
    for i, value in enumerate(values):
        out = out.replace("{%d}" % i, value)
    return out


def copy_blocks(tree):
    """Every element that is one unit of copy, innermost-relevant first.

    An element qualifies when it holds at least one letter and every
    element inside it is inline. `<p>Read the <a>guide</a>.</p>` is one
    unit; the `<a>` inside it is not offered separately, or the same
    sentence would be translated twice and could disagree with itself.
    """
    out = []

    def all_inline(node):
        """True when nothing below `node` breaks the sentence.

        Checked over the whole subtree, not the direct children: the
        wordmark is two <span>s, which are inline, wrapping an <svg>,
        which is not. Looking one level down would have called that link
        a sentence and offered the logo up for translation.
        """
        return all(
            PLACEHOLDER in c.attrs
            or (c.tag in INLINE and c.tag not in OPAQUE and all_inline(c))
            for c in node.children
        )

    def visit(node):
        if node.tag in OPAQUE or node.attrs.get("translate") == "no":
            return
        text = _inner(tree, node)
        if node is not tree.root and all_inline(node) and HAS_LETTER.search(text):
            out.append(node)
            return
        for child in node.children:
            visit(child)

    visit(tree.root)
    return out


def copy_attrs(tree):
    """(node, attribute) pairs whose value is copy rather than data."""
    out = []
    for node in tree.root.walk():
        if node.tag in OPAQUE:
            continue
        for name in COPY_ATTRS:
            value = node.attrs.get(name)
            if value and HAS_LETTER.search(value):
                out.append((node, name))
        if node.tag == "meta":
            which = node.attrs.get("name") or node.attrs.get("property")
            if which in META_COPY and node.attrs.get("content"):
                out.append((node, "content"))
    return out


# --- JSON-LD -----------------------------------------------------------
#
# The structured data repeats the page's own copy in a machine-readable
# shape, so it has to be translated with it: a German page whose FAQPage
# answers are in English is offering a search engine the English answer
# to show beside a German result.
#
# Only these keys hold prose. `name` is deliberately absent at the top
# level -- "OpenSubs" is a wordmark, and the offer names ("Free",
# "Advanced pack") are product names that the app itself does translate,
# so they are picked up by key like everything else.
LD_PROSE = ("description", "text", "name", "headline", "operatingSystem",
            "browserRequirements", "abstract")


def ld_strings(data, into):
    if isinstance(data, dict):
        for key, value in data.items():
            if key in LD_PROSE and isinstance(value, str) and HAS_LETTER.search(value):
                into.append(value)
            elif key == "@type":
                continue
            else:
                ld_strings(value, into)
    elif isinstance(data, list):
        for item in data:
            ld_strings(item, into)
    # FAQPage questions arrive as `name` on a Question, which LD_PROSE
    # already covers.


def ld_translate(data, translate):
    if isinstance(data, dict):
        return {
            k: (translate(v) if k in LD_PROSE and isinstance(v, str) else ld_translate(v, translate))
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [ld_translate(v, translate) for v in data]
    return data


def ld_blocks(tree):
    """Every application/ld+json script, with its inner span."""
    out = []
    for node in tree.root.walk():
        if node.tag == "script" and node.attrs.get("type") == "application/ld+json":
            body = _inner(tree, node)
            try:
                out.append((node, json.loads(body)))
            except json.JSONDecodeError:
                # A malformed block is a bug worth failing on -- it is
                # also invisible to every other check we run.
                raise SystemExit(f"invalid JSON-LD in the page: {body[:120]}")
    return out


def splice(raw, edits):
    """Apply (start, end, replacement) edits to `raw`.

    Applied last-first so an earlier edit cannot move a later one's
    offsets, and overlapping edits are refused rather than silently
    producing torn output.
    """
    edits = sorted(edits, key=lambda e: e[0])
    for (a1, b1, _), (a2, _, _) in zip(edits, edits[1:]):
        if b1 > a2:
            raise SystemExit(f"overlapping rewrites at {a1}..{b1} and {a2}")
    out = raw
    for start, end, text in reversed(edits):
        out = out[:start] + text + out[end:]
    return out


def attr_span(tree, node, name):
    """Where a named attribute's *value* sits in the source.

    Found by scanning the start tag rather than trusting a reconstructed
    one: quoting style varies across these files and re-emitting the tag
    would normalise it.
    """
    tag_src_end = node.inner_start
    tag_src = tree.raw[node.tag_start:tag_src_end]
    m = re.search(
        r"""(?<![\w-])""" + re.escape(name) + r"""\s*=\s*("([^"]*)"|'([^']*)')""",
        tag_src,
    )
    if not m:
        return None
    quoted = m.start(1) + 1
    value = m.group(2) if m.group(2) is not None else m.group(3)
    return (node.tag_start + quoted, node.tag_start + quoted + len(value), value)
