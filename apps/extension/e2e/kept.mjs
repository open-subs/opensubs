// What happens to the subtitles around Stop (APP-146).
//
//   node e2e/kept.mjs [--package dist | --zip opensubs-chrome-1.0.2.zip] --video lecture.mp4
//
// # Why this is not part of installed.mjs
//
// installed.mjs transcribes: it needs a model, a machine that can run it, and
// four minutes. What this asks is narrower and has nothing to do with speech
// -- when the recording stops, is what was made still there, can it still be
// saved, and does pressing Start again carry it on or start a second file.
// So the lines are handed to the background as the engine hands them over,
// and everything else is the installed package doing its own work: the
// content script in the page, the background's router, the popup's own two
// messages, and a real navigation to end the page.
//
// It also runs where installed.mjs cannot. A capture needs audio, and audio
// needs the browser to play the video; on a machine whose audio output is
// unavailable Chromium keeps `currentTime` at zero for any media that has a
// sound track, and every window comes back empty. This test does not care.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const video = resolve(flag("--video", ""));
if (!existsSync(video)) {
  console.error(`--video is required and must exist (got "${video}")`);
  process.exit(2);
}

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
  console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
};

// --- the package, as Chrome loads it -------------------------------------

const work = mkdtempSync(join(tmpdir(), "opensubs-kept-"));
const unpacked = join(work, "extension");
const zip = flag("--zip", null);
if (zip) execFileSync("unzip", ["-q", resolve(zip), "-d", unpacked]);
else cpSync(resolve(flag("--package", "dist")), unpacked, { recursive: true });
const manifestPath = join(unpacked, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// The same one concession installed.mjs makes: a person grants the page by
// clicking the toolbar icon, which automation cannot click.
manifest.host_permissions = [...(manifest.host_permissions ?? []), "http://127.0.0.1/*"];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// --- two pages with a video ----------------------------------------------

const videoName = basename(video);
const body = readFileSync(video);
const server = createServer((req, res) => {
  if (req.url === `/${videoName}`) {
    res.writeHead(200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": body.length });
    res.end(body);
    return;
  }
  // Two addresses, the same video: one is where the subtitles are made, the
  // other is the page the viewer goes to next.
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${req.url === "/next" ? "next" : "lecture"}</title>
    <video id="v" src="/${videoName}" width="640" height="360" preload="metadata" playsinline></video>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  channel: "chromium",
  headless: !args.includes("--headed"),
  args: [`--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`],
});

let exitCode = 0;
try {
  let worker = null;
  const until = Date.now() + 30000;
  while (!worker && Date.now() < until) {
    worker = context.serviceWorkers().at(-1) ?? null;
    if (!worker) await context.waitForEvent("serviceworker", { timeout: 5000 }).catch(() => null);
  }
  if (!worker) throw new Error("the extension's background never started");
  const extensionBase = `chrome-extension://${new URL(worker.url()).host}`;

  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => document.querySelector("video").readyState >= 1);

  // The popup's own page: the same `chrome.*` the popup has, and the same two
  // messages it sends -- `state` for the count Save .srt is enabled from, and
  // `cues` for what Save .srt writes.
  const control = await context.newPage();
  await control.goto(`${extensionBase}/popup.html`);
  const tabId = await control.evaluate(
    async (o) => (await chrome.tabs.query({})).find((t) => (t.url ?? "").startsWith(`${o}/`))?.id,
    origin,
  );
  if (typeof tabId !== "number") throw new Error(`no tab found for ${origin}`);

  const send = (m) => control.evaluate((message) => chrome.runtime.sendMessage(message), m);
  const state = () => send({ kind: "state", tabId });
  const saved = () => send({ kind: "cues", tabId });
  const settings = { model: "onnx-community/whisper-tiny.en", language: "en", window: 20, overlay: true, fontScale: 0.8, backend: "cpu" };

  // Lines as the engine hands them over. The take is the one the page reports
  // for the first video of a session; a batch from any other take is a
  // different video's and is meant to be dropped (APP-133).
  const hand = (cues, take = 1) => send({ kind: "segments", cues, offset: cues[0].start, take });

  // What the background broadcasts, in order: the popup reads its status from
  // these, and the first one after Start is the one under test below.
  await control.evaluate(() => {
    window.__notes = [];
    chrome.runtime.onMessage.addListener((m) => { if (m?.kind === "status") window.__notes.push(m.status.note); });
  });
  await send({ kind: "start", tabId, settings });
  await new Promise((r) => setTimeout(r, 2500));
  const firstNote = (await control.evaluate(() => window.__notes)).find((n) => /Listening/.test(n ?? ""));
  await hand([
    { start: 0, end: 3, text: "It's the height of the Gold Rush," },
    { start: 3, end: 6, text: "1850s, California." },
    { start: 6, end: 9, text: "A young tailor named Jacob Davis notices" },
  ]);
  const made = await state();
  ok("the lines made during a capture are counted", made.count === 3, `count ${made.count}`);

  // Half of APP-148 is what the popup says while the first window records:
  // "Listening" alone reads as idle, and on a second Start that is the whole
  // of what the user sees for as long as the first pass lasts.
  const beganWith = firstNote ?? "";
  ok("Start says what it is doing, not just \"Listening\"", /recording the first \d+ seconds/.test(beganWith), JSON.stringify(beganWith));

  // --- Stop ---------------------------------------------------------------
  await send({ kind: "stop", tabId });
  const afterStop = await state();
  const file = await saved();
  ok("Stop leaves the lines where they are", afterStop.count === 3, `count ${afterStop.count}`);
  ok("Save .srt is offered after Stop", afterStop.count > 0);
  ok("and it writes the lines that were made", /Gold Rush/.test(file.srt) && file.count === 3, `${file.count} lines, ${file.srt.length} bytes`);
  ok("the capture really did stop", afterStop.running === false);
  ok("and the popup says what it is holding", /kept/.test(afterStop.status.note ?? ""), JSON.stringify(afterStop.status.note));

  // --- Start again, same page --------------------------------------------
  await send({ kind: "start", tabId, settings });
  await new Promise((r) => setTimeout(r, 2500));
  const second = await state();
  ok("pressing Start again carries the lines on", second.count === 3, `count ${second.count}`);
  await hand([{ start: 30, end: 33, text: "that his gold mining customers are wearing through pants" }]);
  const both = await saved();
  ok("what follows joins the same file", both.count === 4, `count ${both.count}`);
  ok("in one timeline, in order", /Gold Rush[\s\S]*gold mining customers/.test(both.srt));

  // --- the page goes ------------------------------------------------------
  await send({ kind: "stop", tabId });
  await page.goto(`${origin}/next`);
  await page.waitForFunction(() => document.querySelector("video").readyState >= 1);
  await new Promise((r) => setTimeout(r, 1000));
  const afterLeaving = await state();
  const nothing = await saved();
  ok("leaving the page takes its subtitles with it", afterLeaving.count === 0, `count ${afterLeaving.count}`);
  ok("and Save .srt has nothing to write", nothing.count === 0 && nothing.srt.trim() === "");
} finally {
  await context.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) exitCode = 1;
process.exit(exitCode);
