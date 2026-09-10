// Build the web app into the shape the app shell wants.
//
// The site and the app are one bundle on the desktop -- the tool sits in
// the hero of opensubs.app and the marketing runs below it. In an app
// shell the marketing is dead weight and the "open the app" links point at
// the page they are already on, so the staging step keeps the tool and
// drops the page around it.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const dist = join(root, "..", "web", "dist");
const www = join(root, "www");

if (!existsSync(dist)) {
  console.error(`stage: ${dist} is missing -- run npm run build:web first`);
  process.exit(1);
}

rmSync(www, { recursive: true, force: true });
cpSync(dist, www, { recursive: true });

// The site's other pages are reachable only from the marketing nav, which
// the shell does not show. Shipping them would put a privacy page and a
// how-to article inside the app binary for no one to open.
// privacy.html stays. The footer links to it, both stores require a
// reachable privacy policy, and deleting it left that link 404ing inside
// the app -- which is exactly the sort of thing a reviewer clicks.
for (const page of ["burn-subtitles-into-video.html", "styles.html", "sitemap.xml", "robots.txt", "llms.txt", "og-image.png"]) {
  rmSync(join(www, page), { force: true });
}

const index = join(www, "index.html");
let html = readFileSync(index, "utf8");

// A phone has no room for a marketing page under the tool, and the app
// shell has no address bar to explain where you are. The sections are
// named, so they are removed by name rather than by a shape-matching
// regex that silently matches nothing when the markup moves.
// "downloads" is not only marketing here. It links to GitHub releases for
// the desktop app and the extension, and a store app that points users at
// installers outside the store is a rejection on both platforms.
const MARKETING = ["how", "downloads", "privacy", "pricing", "faq"];
let dropped = 0;
for (const id of MARKETING) {
  const open = html.indexOf(`<section id="${id}"`);
  if (open === -1) continue;
  // Sections here do not nest, so the next </section> closes this one.
  const close = html.indexOf("</section>", open);
  if (close === -1) continue;
  html = html.slice(0, open) + html.slice(close + "</section>".length);
  dropped += 1;
}
if (dropped !== MARKETING.length) {
  // Loud, because the failure mode is a marketing page shipped inside an
  // app binary and nobody noticing until review.
  console.error(`stage: expected ${MARKETING.length} marketing sections, removed ${dropped}.`);
  console.error("stage: the site's markup changed -- update MARKETING in this script.");
  process.exit(1);
}

// The nav links that pointed at them, and the "open the app" call to
// action, which in the app is a link to the screen you are looking at.
for (const id of [...MARKETING, "app"]) {
  html = html.replace(new RegExp(`<a\\b[^>]*href="#${id}"[^>]*>[\\s\\S]*?</a>`, "g"), "");
}

// The site's own copy says "in your browser", which is true of the site
// and false of the thing the reader is holding. Rewritten rather than
// rewritten-around: an app store listing whose first screenshot says
// "browser" reads as a web page someone wrapped, which is exactly the
// impression to avoid.
//
// Each replacement asserts, so a copy change upstream fails the build
// instead of silently shipping the wrong words to three stores.
const COPY = [
  [
    "<title>Free AI Subtitle Generator &mdash; In Your Browser | OpenSubs</title>",
    "<title>OpenSubs &mdash; subtitle any video, on your device</title>",
  ],
  [
    "Free AI subtitle generator that runs in your browser",
    "Subtitles for any video, made on your device",
  ],
  [
    "all inside your browser. The video file never\n      leaves your machine, because there is nowhere for it to go.",
    "all on your device. The video file never\n      leaves it, because there is nowhere for it to go.",
  ],
  [
    // The static skeleton, which is what shows before Svelte mounts. The
    // mounted app decides this at runtime from the pointer type.
    "Drop a video here, or choose one",
    "Choose a video",
  ],
  [
    "entirely in your browser. The video never leaves your machine.",
    "entirely on your device. The video never leaves it.",
  ],
];
COPY.push([
  "Whisper runs here, in your browser, and writes",
  "Whisper runs here, on your device, and writes",
]);
// og:title and twitter:title, which are share-card metadata for a web
// page. Harmless in an app and wrong, so they say the same as <title>.
COPY.push([
  "Free AI Subtitle Generator \u2014 In Your Browser | OpenSubs",
  "OpenSubs \u2014 subtitle any video, on your device",
]);

const missed = [];
for (const [from, to] of COPY) {
  if (!html.includes(from)) { missed.push(from); continue; }
  html = html.split(from).join(to);
}
if (missed.length) {
  console.error("stage: the site's copy changed -- these strings were not found:");
  for (const m of missed) console.error(`  ${JSON.stringify(m)}`);
  console.error("stage: update COPY in this script so the app does not ship the site's wording.");
  process.exit(1);
}

// The footer's link to GitHub *releases* goes too, for the same reason as
// the downloads section: it offers installers from outside the store. The
// link to the source stays -- the AGPL wants the source offered, and an
// open-source app linking its repository is ordinary.
// The nav and footer links to /styles, which the app payload does not
// carry -- the dead-link check below would catch the footer one, and the
// nav one it would not, because it points at an extensionless path.
html = html.replace(/<a[^>]*href="\/styles"[^>]*>[\s\S]*?<\/a>\s*/g, "");

const releasesLink = /<a href="https:\/\/github\.com\/[^"]*\/releases"[^>]*>[\s\S]*?<\/a>\s*/g;
if (!releasesLink.test(html)) {
  console.error("stage: no releases link found in the footer -- has it moved?");
  process.exit(1);
}
releasesLink.lastIndex = 0;
html = html.replace(releasesLink, "");

// Structured data is search-engine markup for a web page. Inside an app
// binary it is dead weight that also describes the wrong product -- it
// names an operating system of "Any browser with WebAssembly".
const ld = /<script type="application\/ld\+json">[\s\S]*?<\/script>/g;
const before = html.length;
html = html.replace(ld, "");
if (html.length === before) {
  console.error("stage: no JSON-LD block found -- the site's <head> changed.");
  process.exit(1);
}

// Nothing visible or machine-readable in the shipped app should claim the
// product runs in a browser. Checked rather than hoped for.
const stray = html.match(/.{0,50}(browser|your machine|Drop a video).{0,50}/gi) ?? [];
if (stray.length) {
  console.error(`stage: ${stray.length} phrase(s) that do not belong in an app survive:`);
  for (const m of stray.slice(0, 6)) console.error(`  ...${m.replace(/\s+/g, " ")}...`);
  process.exit(1);
}

// Every same-origin page this links to has to still be in the payload.
const linked = [...html.matchAll(/href="\/([A-Za-z0-9._-]+\.html)"/g)].map((m) => m[1]);
const gone = linked.filter((f) => !existsSync(join(www, f)));
if (gone.length) {
  console.error(`stage: the page links to files this build removed: ${gone.join(", ")}`);
  process.exit(1);
}

writeFileSync(index, html);
console.log(`stage: www/ ready (${html.length} bytes of index.html)`);
