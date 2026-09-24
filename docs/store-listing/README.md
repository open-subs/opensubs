# The store listings

What each store shows about the extension, in eighteen languages, as
delivered on 24 September 2026.

- `<locale>.txt` — the listing page for that language: Edge's search terms,
  the Chrome overview, and the Edge/Firefox overview, in that order.
- The extension package's own name and description are not here. They are
  `apps/extension/public/_locales/` for Chrome and Edge, and
  `_locales.firefox/` for Firefox, which carries shorter names.

## What the copy promises, and why the wording is narrow

Earlier drafts said "any video". The extension cannot read three kinds of
page — a player embedded from another site (Dailymotion), a video file
served from another domain without CORS (Wikimedia Commons), and
DRM-protected streams — so the listings say *the video playing in your
tab*, which is what it does. A title promising more is a one-star review
from someone whose usual site does not work.

## Three things to know before uploading

- **The interface is eight languages; the listings are eighteen.** A reader
  in Turkish sees a Turkish store page and an English interface. Nothing in
  the copy promises otherwise, and recognition itself covers far more
  languages than either number.
- **Arabic.** The name uses ترجمة, which reads as either "subtitles" or
  "translation", and this extension does not translate. Worth a native
  reader's eye before that listing goes up, or leave Arabic out for now.
- **Edge caps the name at 45 characters** where Chrome allows 75 and AMO 50.
  Several names here are longer than 45 (English is 52), so the Edge listing
  needs its own shorter set or those languages will be refused.

Listings are uploaded by hand and left unpublished. Nothing here submits
anything.
