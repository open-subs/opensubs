// The two checks a file cannot make: that a translation reaches the
// screen, and that the choice survives a reload.
//
// A string can exist in a catalogue and never be rendered -- a wrapper
// that missed a call site, a picker wired to nothing, a locale that is in
// the list but has no catalogue. None of that is visible in the files.
//
//   node e2e/i18n-live.mjs      (needs `npm run build` first)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const DIST = "dist";
if (!existsSync(DIST)) {
  console.error("cannot run: dist/ is missing -- run `npm run build` first");
  process.exit(1);
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".woff2": "font/woff2", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const file = join(DIST, normalize(path === "/" ? "/index.html" : path));
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      // The app wants cross-origin isolation for threads; the production
      // site sends these, so the test serves them too.
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-resource-policy": "cross-origin",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(8798, "127.0.0.1", r));

/**
 * A string that differs in every locale we ship.
 *
 * Not "Export" and not a model name: "Abrir PDF…" does not distinguish
 * Spanish from Portuguese, and a near-collision makes the test pass on a
 * locale that never loaded. The dropzone line is different in all eight.
 */
const PROBE = {
  en: "Drop a video here, or choose one",
  "zh-Hans": "把视频拖到这里，或选择一个",
  "zh-Hant": "把影片拖到這裡，或選擇一個",
  ja: "ここに動画をドロップ、または選択",
  ko: "여기에 비디오를 놓거나 선택하세요",
  de: "Video hier ablegen oder auswählen",
  es: "Suelta un vídeo aquí, o elige uno",
  pt: "Solte um vídeo aqui, ou escolha um",
};

const fails = [];
let pass = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("console", (m) => {
    const text = m.text();
    // Requests to the accounts host are blocked by CORS from a local
    // origin. That is this test's own doing and says nothing about
    // whether a translation reached the screen.
    if (m.type() !== "error") return;
    if (/auth\.opensubs\.app|gateway\.opensubs\.app|ERR_FAILED/.test(text)) return;
    fails.push(`console: ${text.slice(0, 140)}`);
  });
  await page.goto("http://127.0.0.1:8798/", { waitUntil: "networkidle" });
  await page.waitForSelector("#language select", { timeout: 15_000 });

  ok("the picker offers every locale",
    (await page.locator("#language select option").count()) === Object.keys(PROBE).length,
    `${await page.locator("#language select option").count()} options`);

  for (const [code, text] of Object.entries(PROBE)) {
    await page.selectOption("#language select", code);
    await page.waitForTimeout(120);
    const body = await page.locator("body").innerText();
    ok(`${code} renders`, body.includes(text), `looked for ${JSON.stringify(text)}`);
    ok(`${code} sets <html lang>`, (await page.getAttribute("html", "lang")) === code,
      `lang=${await page.getAttribute("html", "lang")}`);
  }

  // The choice has to survive a reload, or it is not a choice.
  await page.selectOption("#language select", "ja");
  await page.waitForTimeout(120);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#language select", { timeout: 15_000 });
  ok("the choice survives a reload",
    (await page.locator("body").innerText()).includes(PROBE.ja));
  ok("and <html lang> comes back with it",
    (await page.getAttribute("html", "lang")) === "ja");
  ok("and the picker shows it",
    (await page.inputValue("#language select")) === "ja");
} catch (e) {
  fails.push(e.message.split("\n")[0]);
} finally {
  await browser.close();
  server.close();
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
