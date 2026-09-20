// Stage apps/web's build as the shell's www/.
//
// This used to do a great deal more. When the site and the app were one
// document, dist/ held the marketing page, thirty-two translated copies of
// it and a privacy page, and staging meant carving the app out of all
// that. The site moved to its own repository (open-subs/opensubs-website),
// so dist/ is now the app and two SEO pages -- and most of the carving had
// nothing left to carve. It stayed behind anyway and failed the build on a
// privacy page that no longer exists, which is why no mobile build has run
// since the split.
//
// What is left is the part that was never about the site: copying the
// build in, dropping the two pages that are not the app, and refusing to
// stage a directory that is missing the pieces the shell needs.
//
// The copy that says "browser" is no longer rewritten here. It lives in
// the app's own components now rather than in a page this script could
// edit, so the app decides it at runtime from Capacitor -- see
// inNativeShell() in apps/web/src/lib/native.ts. A build-time rewrite of a
// minified bundle would be a string search through machine output.
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "..", "web", "dist");
const www = join(root, "www");

if (!existsSync(dist)) {
  console.error(`stage: ${dist} is missing -- run npm run build:web first`);
  process.exit(1);
}

rmSync(www, { recursive: true, force: true });
cpSync(dist, www, { recursive: true });

// The two SEO pages are Vite entry points, so they are built rather than
// copied and land here with everything else. They are marketing, they are
// reachable from nothing inside the shell, and a store app that ships a
// page pointing at GitHub releases is a rejection on both platforms.
for (const page of ["burn-subtitles-into-video.html", "styles.html", "sitemap.xsl", "robots.txt", "llms.txt", "og-image.png"]) {
  rmSync(join(www, page), { force: true });
}

// Test clips, served for the e2e suite to fetch. Nineteen megabytes of
// sample video inside an app binary, reachable from nothing.
rmSync(join(www, "testmedia"), { recursive: true, force: true });

// A locale build may have been run against this dist. Its output belongs
// to the site rather than the app -- the app translates itself at runtime
// from the same catalogues -- and the alternates ring inside those pages
// is what a language picker reads to decide that changing language means
// *navigating*, which inside a shell means leaving the app with no address
// bar to come back from.
const LOCALES = ["zh-Hans", "zh-Hant", "ja", "ko", "de", "es", "pt"];
for (const locale of LOCALES) {
  rmSync(join(www, locale), { recursive: true, force: true });
  rmSync(join(www, `${locale}.html`), { force: true });
}

// What the shell actually needs, checked rather than assumed. The failure
// this prevents is quiet: Capacitor serves whatever is in www/, so a
// missing bundle is a white screen on a device and nothing at all here.
const must = [
  ["index.html", "the page Capacitor loads"],
  ["assets", "the app bundle"],
  ["ort", "the ONNX Runtime files the recogniser fetches"],
  ["vad", "the voice-detection model"],
];
const missing = must.filter(([name]) => !existsSync(join(www, name)));
if (missing.length > 0) {
  console.error("stage: the staged directory is missing:");
  for (const [name, why] of missing) console.error(`  ${name} -- ${why}`);
  process.exit(1);
}

const bundles = readdirSync(join(www, "assets")).filter((f) => /^main-.*\.js$/.test(f));
if (bundles.length !== 1) {
  console.error(`stage: expected exactly one main bundle in assets/, found ${bundles.length}`);
  process.exit(1);
}

const size = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const path = join(dir, entry.name);
    return total + (entry.isDirectory() ? size(path) : statSync(path).size);
  }, 0);

console.log(
  `stage: www/ ready -- ${bundles[0]}, ${(size(www) / 1024 / 1024).toFixed(1)} MB`,
);
