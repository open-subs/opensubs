// A subtitle file opened while the engine is still loading.
//
//   npm run build && node e2e/engine-race.mjs [--base https://opensubs.app]
//
// The file inputs are on screen from the first frame, but the engine is a
// wasm module that arrives a moment later -- much later on a slow line. A
// file picked in that gap used to reach the parser first and fail with
// "Cannot read properties of undefined (reading '__wbindgen_...')". Here the
// engine's download is held back on purpose, the file is opened while the
// page says "Loading the engine", and the subtitles must still open once it
// arrives, in Chromium and in Firefox.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
let base = args.includes("--base") ? args[args.indexOf("--base") + 1] : null;
let server = null;
if (!base) {
  const DIST = resolve(process.env.DIST ?? resolve(HERE, "../dist"));
  const TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  };
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const target = join(DIST, path === "/" ? "/index.html" : path);
    if ((await stat(target).catch(() => null))?.isFile()) {
      res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
      return res.end(await readFile(target));
    }
    res.writeHead(404).end("not found");
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}`;
}

const SRT = "1\n00:00:00,000 --> 00:00:02,500\nThis is a sample video.\n\n2\n00:00:03,000 --> 00:00:05,500\nNothing was uploaded to make these captions.\n";
let passed = 0;
let failed = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${!ok && detail ? ` -- ${detail}` : ""}`);
  if (ok) passed += 1; else failed += 1;
};

for (const [name, type] of [["chromium", chromium], ["firefox", firefox]]) {
  const browser = await type.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => { delete window.showOpenFilePicker; });
  await context.route(/\/script\.js$/, (r) => r.abort());
  // Hold the engine back for three seconds.
  let held = 0;
  await context.route(/subs_engine_bg[^/]*\.wasm/, async (route) => {
    held += 1;
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  // The app has mounted (the banner is the app's, not the static page's)
  // and the engine has not arrived.
  await page.getByText("Loading the engine").waitFor({ timeout: 60000 });
  await page.locator('input[type=file][accept*=".srt"]').first().setInputFiles({
    name: "early.srt", mimeType: "text/plain", buffer: Buffer.from(SRT),
  });
  const stillLoading = await page.getByText("Loading the engine").isVisible();
  check(held > 0 && stillLoading, `${name}: the file was opened while the engine was still loading`, `held ${held}, banner ${stillLoading}`);
  await page.waitForFunction(() => document.querySelectorAll("textarea.cue-text").length > 0 || /wbindgen|Cannot read properties/.test(document.querySelector("#app")?.innerText ?? ""), null, { timeout: 30000 }).catch(() => {});
  const text = await page.locator("#app").innerText();
  const cues = await page.locator("textarea.cue-text").evaluateAll((els) => els.map((e) => e.value));
  check(!/wbindgen|Cannot read properties/.test(text), `${name}: no engine error is shown`, text.match(/.*(wbindgen|Cannot read).*/)?.[0] ?? "");
  check(cues.length === 2 && cues[1].includes("Nothing was uploaded"), `${name}: the subtitles open once the engine arrives`, JSON.stringify(cues));
  if (shots) await page.screenshot({ path: join(shots, `engine-race-${name}.png`) });
  check(errors.length === 0, `${name}: no page errors`, errors.join(" | "));
  await browser.close();
}
server?.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
