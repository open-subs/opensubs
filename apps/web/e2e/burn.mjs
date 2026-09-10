// Burn the corrected subtitles into the three clips, through the app.
//
// The .srt files are the ones e2e/videos.mjs exported and scored, opened
// back into the app, so what comes out is the same subtitles the report
// measured -- with WebCodecs doing the encode and libass drawing the
// text, which is the path a user takes rather than an ffmpeg command that
// happens to produce something similar.
//
//   node e2e/burn.mjs [--out ~/Downloads]

import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "../dist");
const REPO = resolve(HERE, "../../..");
const PLAYWRIGHT = "playwright";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const OUT = at >= 0 ? args[at + 1] : join(homedir(), "Downloads", "opensubs-burned");
const FIXTURES = "/tmp/opensubs-public";

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/ is missing -- run `npm run build` first.");
  process.exit(2);
}
await mkdir(OUT, { recursive: true });

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
// WebCodecs needs a real GPU-backed context; headless Chromium has one,
// but the encoder is only offered when the page is not throttled.
const browser = await chromium.launch({
  args: ["--enable-features=SharedArrayBuffer", "--autoplay-policy=no-user-gesture-required"],
});

let failed = 0;
for (const name of ["zh", "ja", "en"]) {
  const video = join(FIXTURES, `${name}.mp4`);
  const srt = join(HERE, "video-results", "after", `${name}.srt`);
  process.stdout.write(`${name}: `);

  const context = await browser.newContext({ acceptDownloads: true });
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

  const burn = page.locator('button:has-text("Burn subtitles into the video")');
  if ((await burn.count()) === 0 || (await burn.isDisabled())) {
    console.log("burning is not offered in this browser");
    failed += 1;
    await context.close();
    continue;
  }
  const began = Date.now();
  await burn.click();

  const done = await Promise.race([
    page.waitForSelector(".burn-done", { timeout: 1_800_000 }).then(() => "done"),
    page.waitForSelector(".card .field-error", { timeout: 1_800_000 }).then(() => "error"),
  ]).catch(() => "timeout");
  if (done !== "done") {
    const why = done === "error"
      ? (await page.textContent(".card .field-error")).trim()
      : "timed out";
    console.log(`FAILED -- ${why}`);
    failed += 1;
    await context.close();
    continue;
  }

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.burn-done a:has-text("Save")').click(),
  ]);
  const file = join(OUT, `${name}-subtitled.mp4`);
  await download.saveAs(file);
  const note = (await page.textContent(".burn-done .oa-caption").catch(() => "")) ?? "";
  console.log(`${((Date.now() - began) / 1000).toFixed(0)}s  ${file}${note ? `  (${note.trim()})` : ""}`);
  await context.close();
}

await browser.close();
server.close();
console.log(failed === 0 ? `\nall three burned into ${OUT}` : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
