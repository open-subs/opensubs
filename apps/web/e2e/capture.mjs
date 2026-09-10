// Screenshots for the test guide, taken from the app itself.
//
// The pictures in a guide have to be evidence, so these are the same
// build, the same videos and the same subtitle files the measurements in
// e2e/videos.mjs came from -- the before/after SRTs are opened back into
// the app rather than re-generated, so what is photographed is exactly
// what was scored.
//
// # The marker
//
// A capture script pointed at a directory of real files will eventually
// photograph a real file that must not be published. So this refuses to
// run unless the fixture directory holds a PUBLISHABLE file, and a
// directory of someone's own documents will never have one by accident.
// Write it with scripts/make-public-fixtures.sh, never by hand.
//
//   node e2e/capture.mjs                       (after `npm run build`)
//   node e2e/capture.mjs --fixtures /some/dir

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "../dist");
const REPO = resolve(HERE, "../../..");
const PLAYWRIGHT = "playwright";

const args = process.argv.slice(2);
const at = args.indexOf("--fixtures");
const FIXTURES = at >= 0 ? args[at + 1] : "/tmp/opensubs-public";
const SHOTS = join(HERE, "shots");

if (!existsSync(join(FIXTURES, "PUBLISHABLE"))) {
  console.error(
    `${FIXTURES} has no PUBLISHABLE marker.\n` +
      "That file says the contents are cleared for screenshots. Without it this\n" +
      "script will not photograph the directory. Run scripts/make-public-fixtures.sh.",
  );
  process.exit(2);
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/ is missing -- run `npm run build` first.");
  process.exit(2);
}
await mkdir(SHOTS, { recursive: true });

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2",
  ".otf": "font/otf", ".webm": "video/webm", ".mp4": "video/mp4",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path === "/" ? "/index.html" : path;
    try {
      const body = await readFile(join(root, file));
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, () => ok(server)));
}

const server = await serve(DIST);
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(PLAYWRIGHT);
const browser = await chromium.launch();

/** Load one video with one subtitle file and photograph the cue list. */
async function shoot(video, srt, name, { toEnd = true } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1180, height: 1000 } });
  await page.goto(base);
  await page.waitForSelector('input[accept="video/*"]', { state: "attached", timeout: 30000 });
  await page.setInputFiles('input[accept="video/*"]', video);
  await page.waitForFunction(
    () => document.querySelector(".file-meta")?.textContent?.includes("×"),
    { timeout: 120000 },
  );
  await page.locator('input[accept=".srt,.vtt,text/vtt"]').first().setInputFiles(srt);
  await page.waitForSelector(".cue", { timeout: 30000 });
  // The tail is where the hallucinations are, so that is what is shown.
  if (toEnd) {
    await page.evaluate(() => {
      const list = document.querySelector(".cue-list");
      if (list) list.scrollTop = list.scrollHeight;
    });
  }
  await page.waitForTimeout(400);
  // The cue list alone. It has its own scroll, so an element shot of it
  // is the tail -- which is where the hallucinations are -- and not the
  // controls underneath, which are identical in all six pictures.
  const file = join(SHOTS, `${name}.jpg`);
  await page.locator(".cue-list").first().screenshot({ path: file, type: "jpeg", quality: 85 });
  await context.close();
  return file;
}

const made = [];
for (const name of ["zh", "ja", "en"]) {
  const video = join(FIXTURES, `${name}.mp4`);
  for (const state of ["before", "after"]) {
    const srt = join(HERE, "video-results", state, `${name}.srt`);
    if (!existsSync(srt)) {
      console.error(`missing ${srt} -- run e2e/videos.mjs --label ${state} first`);
      continue;
    }
    made.push(await shoot(video, srt, `${name}-${state}`));
    console.log(`  ${name} ${state}`);
  }
}

await browser.close();
server.close();
await writeFile(join(SHOTS, "index.json"), `${JSON.stringify(made, null, 2)}\n`);
console.log(`\n${made.length} shots in ${SHOTS}`);
