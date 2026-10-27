// Saving an export inside the iOS app goes through the share sheet, and on
// the website it is still a download.
//
//   npm run build && node e2e/native-share.mjs
//
// A WKWebView drops `<a download>`, so in the shell every export button
// used to do nothing. The shell is faked here the way apple-native.mjs
// fakes it -- a `window.Capacitor` that answers like the native bridge --
// with OpenSubsShare's two methods recorded. What is measured:
//
//   - in the shell, each subtitle format and the burned video are written
//     to the plugin and then shared, and no download starts;
//   - the bytes the plugin receives, reassembled from their base64 chunks,
//     are exactly the bytes the website downloads -- for the burned video
//     that is more than one chunk, so the chunk boundaries are tested too;
//   - in a browser, every button is still a download, as before.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DIST = resolve(fileURLToPath(new URL(".", import.meta.url)), "../dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".srt": "text/plain",
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const target = join(DIST, path === "/" ? "/index.html" : path);
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

/** The built app on the bundled sample, at the Export tab. */
async function open(browser, { shell }) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage({ viewport: { width: 420, height: 900 } });
  const calls = [];
  await page.route("**/script.js", (r) => r.abort());
  await page.route("**/api/send", (r) => r.abort());
  await page.route("https://auth.opensubs.app/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }),
  );
  if (shell) {
    await page.exposeFunction("__native", async (plugin, method, options) => {
      calls.push({ plugin, method, options });
      // The real sheet answers when it closes; a moment later, here.
      if (method === "share") {
        await new Promise((ok) => setTimeout(ok, 1500));
        return { completed: true, activity: "com.apple.DocumentManagerUICore.SaveToFiles" };
      }
      return undefined;
    });
    await page.addInitScript(() => {
      window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
      window.Capacitor = {
        PluginHeaders: [
          {
            name: "OpenSubsShare",
            methods: [
              { name: "write", rtype: "promise" },
              { name: "share", rtype: "promise" },
            ],
          },
        ],
        nativePromise: (plugin, method, options) => window.__native(plugin, method, options),
        nativeCallback: () => "cb",
      };
    });
  }
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: "Try a sample" }).click();
  await page.waitForSelector(".cue", { timeout: 30000 });
  await page.getByRole("tab", { name: "Export" }).or(page.getByRole("button", { name: "Export", exact: true })).first().click();
  await page.waitForTimeout(500);
  return { context, page, calls, downloads: () => downloads };
}

/** What the plugin was handed for one export: the name, the reassembled bytes, the chunk count. */
function received(calls) {
  const writes = calls.filter((c) => c.method === "write");
  const shares = calls.filter((c) => c.method === "share");
  const bytes = Buffer.concat(writes.map((w) => Buffer.from(w.options.data, "base64")));
  return {
    name: writes[0]?.options.name,
    bytes,
    chunks: writes.length,
    appendsOk: writes.every((w, i) => w.options.append === i > 0),
    shared: shares.map((s) => s.options.name),
  };
}

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failed++;
};

const FORMATS = [".ass", ".srt", ".vtt", ".txt"];
const browser = await chromium.launch();

// --- the website: downloads, as before ------------------------------------------
const web = {};
{
  const { context, page } = await open(browser, { shell: false });
  for (const ext of FORMATS) {
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: ext, exact: true }).click()]);
    web[ext] = { name: d.suggestedFilename(), bytes: await readFile(await d.path()) };
    check(d.suggestedFilename().endsWith(ext), `website: ${ext} downloads ${d.suggestedFilename()} (${web[ext].bytes.length} bytes)`);
  }
  await page.getByRole("button", { name: "Burn subtitles into the video" }).click();
  await page.waitForSelector(".burn-done", { timeout: 300000 });
  const [d] = await Promise.all([page.waitForEvent("download"), page.locator('.burn-done a:has-text("Save")').click()]);
  web.video = { name: d.suggestedFilename(), bytes: await readFile(await d.path()) };
  check(web.video.bytes.length > 0, `website: Save downloads ${web.video.name} (${web.video.bytes.length} bytes)`);
  await context.close();
}

// --- the iOS shell: the share sheet ------------------------------------------------
{
  const { context, page, calls, downloads } = await open(browser, { shell: true });
  for (const ext of FORMATS) {
    calls.length = 0;
    await page.getByRole("button", { name: ext, exact: true }).click();
    for (let i = 0; i < 20 && !calls.some((c) => c.method === "share"); i++) await page.waitForTimeout(200);
    await page.waitForTimeout(1600);
    const r = received(calls);
    check(r.shared.length === 1 && r.shared[0] === r.name, `shell: ${ext} is written and shared once as ${r.name}`);
    check(r.name === web[ext].name, `shell: ${ext} keeps the website's file name (${r.name})`);
    check(sha(r.bytes) === sha(web[ext].bytes), `shell: ${ext} bytes match the website's download (${r.bytes.length} bytes, ${r.chunks} chunk)`);
  }

  calls.length = 0;
  await page.getByRole("button", { name: "Burn subtitles into the video" }).click();
  await page.waitForSelector(".burn-done", { timeout: 300000 });
  const href = await page.locator('.burn-done a:has-text("Save")').getAttribute("href");
  const linked = Buffer.from(
    await page.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), href),
  );
  await page.locator('.burn-done a:has-text("Save")').click();
  await page.waitForFunction(() => true);
  for (let i = 0; i < 40 && !calls.some((c) => c.method === "share"); i++) await page.waitForTimeout(250);
  const r = received(calls);
  check(r.shared.length === 1 && r.name?.endsWith(".mp4"), `shell: Save shares the burned video once as ${r.name}`);
  check(r.chunks > 1 && r.appendsOk, `shell: the video crosses in ${r.chunks} chunks, the first replacing and the rest appending`);
  check(sha(r.bytes) === sha(linked), `shell: the reassembled video is byte-identical to the burned file (${r.bytes.length} bytes)`);
  check(r.bytes.subarray(4, 8).toString() === "ftyp", "shell: and it is an MP4 (ftyp)");
  check(downloads() === 0, "shell: nothing tried to download");

  // Two quick taps: the second is ignored while the first is still copying.
  // (After the first sheet has closed: while it is open, every tap is.)
  await page.waitForTimeout(2000);
  calls.length = 0;
  await page.locator(".burn-done a").first().evaluate((a) => {
    a.click();
    a.click();
  });
  for (let i = 0; i < 40 && !calls.some((c) => c.method === "share"); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(2000);
  check(calls.filter((c) => c.method === "share").length === 1, `shell: a double tap shares once (${calls.map((c) => c.method + (c.options.append ? "+" : "")).join(" ")})`);
  await context.close();
}

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
