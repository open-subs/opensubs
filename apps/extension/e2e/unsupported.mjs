// Pages the extension cannot read, and a video that is not the one wanted.
//
// APP-133: on each of these the popup said "Listening" for as long as anyone
// waited, with nothing on the video and no error. Reproduced here on local
// pages rather than the reported sites, whose players, ads and regions
// change from day to day. Two servers on two ports are two origins, which is
// what each case needs:
//
//   frame   the only video is in an iframe from the other origin (Dailymotion)
//   cross   the video is served from the other origin without CORS, so
//           captureStream() throws a SecurityError (Wikimedia Commons)
//   ad      a spoken 8-second "ad" plays first; when it ends the page hides
//           it and plays the lecture in another element (TED's pre-roll)
//
//   node e2e/unsupported.mjs --package dist --video lecture.mp4 --ad ad.mp4 [--profile dir]
//   node e2e/unsupported.mjs --zip opensubs-chrome-1.0.2.zip ...      # a release, unmodified
//
// Chromium only: the cases are about what the page and the background say
// to each other, which is the same code in both browsers.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { cpSync, createReadStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const video = resolve(flag("--video", ""));
const ad = resolve(flag("--ad", ""));
const profileDir = flag("--profile", null);
const only = flag("--only", null);

const work = mkdtempSync(join(tmpdir(), "opensubs-unsupported-"));
const unpacked = profileDir ? `${resolve(profileDir)}-extension` : join(work, "extension");
rmSync(unpacked, { recursive: true, force: true });
if (args.includes("--zip")) execFileSync("unzip", ["-q", resolve(flag("--zip")), "-d", unpacked]);
else cpSync(resolve(flag("--package", "dist")), unpacked, { recursive: true });
const manifestPath = join(unpacked, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// Both ports: Chrome's host patterns match any port.
manifest.host_permissions = [...(manifest.host_permissions ?? []), "http://127.0.0.1/*"];
manifest.version = `${manifest.version.split(".").slice(0, 3).join(".")}.${Math.floor(Date.now() / 1000) % 65535}`;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

function sendFile(res, path, type) {
  const size = statSync(path).size;
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
  createReadStream(path).pipe(res);
}
const serve = (routes) => new Promise((r) => {
  const s = createServer((req, res) => {
    const h = routes[req.url.split("?")[0]];
    if (!h) { res.writeHead(404).end(); return; }
    h(res);
  });
  s.listen(0, "127.0.0.1", () => r(s));
});
const html = (body) => (res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0">${body}`); };

// The other site: a player page and a video with no CORS headers.
const other = await serve({
  "/player": html(`<video src="/lecture.mp4" autoplay style="width:640px;height:360px"></video>`),
  "/lecture.mp4": (res) => sendFile(res, video, "video/mp4"),
});
const otherOrigin = `http://127.0.0.1:${other.address().port}`;
const site = await serve({
  "/frame": html(`<h1>A page with an embedded player</h1><iframe src="${otherOrigin}/player" width="660" height="380" allow="autoplay"></iframe>`),
  "/cross": html(`<video src="${otherOrigin}/lecture.mp4" autoplay style="width:640px;height:360px"></video>`),
  "/ad": html(`<video id="ad" src="/ad.mp4" autoplay style="width:640px;height:360px"></video>
    <video id="film" src="/lecture.mp4" preload="auto" style="width:640px;height:360px;display:none"></video>
    <script>
      document.getElementById("ad").addEventListener("ended", () => {
        document.getElementById("ad").style.display = "none";
        const film = document.getElementById("film");
        setTimeout(() => { film.style.display = ""; film.play(); }, 1500);
      });
    </script>`),
  "/ad.mp4": (res) => sendFile(res, ad, "video/mp4"),
  "/lecture.mp4": (res) => sendFile(res, video, "video/mp4"),
});
const origin = `http://127.0.0.1:${site.address().port}`;

const context = await chromium.launchPersistentContext(profileDir ? resolve(profileDir) : join(work, "profile"), {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${unpacked}`,
    `--load-extension=${unpacked}`,
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-webgpu",
  ],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 20000 }));
const base = `chrome-extension://${new URL(worker.url()).host}`;
// A reused profile can go on running the last run's service worker; the
// copy's version is unique per run, so ask the worker which one it is.
const runningVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
if (runningVersion !== manifest.version) {
  throw new Error(`the worker is running ${runningVersion}, not this package (${manifest.version})`);
}
const control = await context.newPage();
await control.goto(`${base}/popup.html`);
// Every status the background broadcasts, since a short-lived one ("moved to
// the video now playing") is overwritten by the next within a second.
await control.evaluate(() => {
  window.__notes = [];
  chrome.runtime.onMessage.addListener((m) => { if (m?.kind === "status") window.__notes.push({ t: Date.now(), note: m.status.note }); });
});

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => { if (cond) pass += 1; else fails.push(`${name}${detail ? ` -- ${detail}` : ""}`); };
const state = () => control.evaluate(() => chrome.runtime.sendMessage({ kind: "state" }));

async function startOn(path) {
  const page = await context.newPage();
  await page.goto(`${origin}${path}`);
  await page.waitForTimeout(2500); // playing, as a person would have it
  const tabId = await control.evaluate(async (o) =>
    (await chrome.tabs.query({})).find((t) => (t.url ?? "").startsWith(o))?.id, `${origin}${path}`);
  const t0 = Date.now();
  await control.evaluate((m) => chrome.runtime.sendMessage(m), {
    kind: "start", tabId, settings: { model: "onnx-community/whisper-base", language: "auto", window: 20, overlay: true, fontScale: 1 },
  });
  return { page, tabId, t0 };
}

/** What the popup would show, a few seconds after Start. */
async function settle(ms) {
  await new Promise((r) => setTimeout(r, ms));
  return state();
}

async function stopAll(page, tabId) {
  await control.evaluate((id) => chrome.runtime.sendMessage({ kind: "stop", tabId: id }), tabId).catch(() => {});
  await page.close();
}

// --- 1. the player is in another site's frame ------------------------------
if (!only || only === "frame") {
  const { page, tabId } = await startOn("/frame");
  const s = await settle(5000);
  console.log(`frame  -> ${s.status.stage}: ${s.status.note}`);
  ok("frame: an error within five seconds, not Listening", s.status.stage === "error", `${s.status.stage}: ${s.status.note}`);
  ok("frame: it says the player is embedded from another site", /embedded from another site/.test(s.status.note), s.status.note);
  ok("frame: the popup is not left running", !s.running, JSON.stringify({ running: s.running }));
  await stopAll(page, tabId);
}

// --- 2. the video is served cross-origin, without CORS ---------------------
if (!only || only === "cross") {
  const { page, tabId } = await startOn("/cross");
  const threw = await page.evaluate(() => { try { document.querySelector("video").captureStream(); return "no"; } catch (e) { return `${e.name}: ${e.message}`; } });
  console.log(`cross  -> captureStream in the page: ${threw}`);
  const s = await settle(5000);
  console.log(`cross  -> ${s.status.stage}: ${s.status.note}`);
  ok("cross: the page's video really is unreadable (SecurityError)", /SecurityError/.test(threw), threw);
  ok("cross: an error within five seconds, not Listening", s.status.stage === "error", `${s.status.stage}: ${s.status.note}`);
  ok("cross: it says the site does not allow it", /does not let other pages read/.test(s.status.note), s.status.note);
  ok("cross: the popup is not left running", !s.running);
  await stopAll(page, tabId);
}

// --- 3. Start pressed during an ad -----------------------------------------
if (!only || only === "ad") {
  const { page, tabId, t0 } = await startOn("/ad");
  let moved = null;
  let s;
  for (let i = 0; i < 240; i += 1) {
    s = await state();
    const seen = await control.evaluate(() => window.__notes.find((n) => /moved to the video now playing/.test(n.note)));
    if (moved === null && seen) {
      moved = (seen.t - t0) / 1000;
      console.log(`ad     -> ${moved.toFixed(1)}s after Start: ${seen.note}`);
    }
    if (s.count >= 6) break;
    if (s.status.stage === "error") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { srt } = await control.evaluate(() => chrome.runtime.sendMessage({ kind: "cues" }));
  console.log(`ad     -> ${s.count} lines after ${((Date.now() - t0) / 1000).toFixed(0)}s; status ${s.status.stage}: ${s.status.note}`);
  console.log(String(srt).split("\n").slice(0, 12).map((l) => `         ${l}`).join("\n"));
  ok("ad: it moves to the film when the ad ends", moved !== null, `${s.status.stage}: ${s.status.note}`);
  ok("ad: the film is subtitled", /Gold Rush|California|Jacob Davis/i.test(srt), String(srt).slice(0, 200));
  ok("ad: none of the ad's lines are in the film's subtitles", !/fellow Americans|your country/i.test(srt), String(srt).slice(0, 300));
  await stopAll(page, tabId);
}

await context.close();
site.close();
other.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
