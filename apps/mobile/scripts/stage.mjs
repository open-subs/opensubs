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
for (const page of ["burn-subtitles-into-video.html", "privacy.html", "sitemap.xml", "robots.txt", "llms.txt", "og-image.png"]) {
  rmSync(join(www, page), { force: true });
}

const index = join(www, "index.html");
let html = readFileSync(index, "utf8");

// A phone has no room for a marketing page under the tool, and the app
// shell has no address bar to explain where you are. The sections are
// named, so they are removed by name rather than by a shape-matching
// regex that silently matches nothing when the markup moves.
const MARKETING = ["how", "privacy", "pricing", "faq"];
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

writeFileSync(index, html);
console.log(`stage: www/ ready (${html.length} bytes of index.html)`);
