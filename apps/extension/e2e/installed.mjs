// The extension, installed, doing what a person does with it.
//
//   node e2e/installed.mjs --video lecture.mp4 [--package dist | --zip opensubs-chrome-1.0.1.zip]
//                          [--model onnx-community/whisper-base] [--language auto] [--window 20]
//                          [--headed] [--max-skipped 0] [--min-coverage 0.85]
//                          [--profile DIR]   reuse a browser profile, so the model is cached
//                          [--warm]          just load the model into the profile and stop
//                          [--speech-until S] nothing after S seconds is speech (an outro)
//                          [--browser firefox] the Firefox package (dist-firefox), as a temporary add-on
//
// # Why this exists beside e2e/pipeline.mjs
//
// pipeline.mjs imports the capture and engine modules straight into one dev
// server page. That is a good test of the modules and no test at all of the
// extension, and 1.0.1 shipped three faults it was structurally unable to see
// (APP-109, APP-110):
//
//   - it never injects content.js with `scripting.executeScript`, so it could
//     not notice that the built file is an ES module a classic injection
//     rejects -- the whole feature was dead in the package;
//   - it never sends audio through `runtime.sendMessage`, so it could not
//     notice that Chromium serialises messages as JSON and an ArrayBuffer
//     arrives as `{}`;
//   - it defaults to whisper-tiny.en in English, the one setting where
//     per-window language detection never runs, so it could not notice that
//     on the *default* settings every window paid for detection and the
//     transcription fell a window behind for good.
//
// This loads the built package the way Chrome does, drives Start through the
// background's own router, and reads the result back the way the popup does.
//
// # The one thing it does not do the way a person does
//
// A person grants the page to the extension by clicking its toolbar icon
// (activeTab) or accepting the optional-permission prompt. Neither can be
// clicked from automation, so the *test copy* of the manifest gains
// `http://127.0.0.1/*` in host_permissions. That changes how access is
// granted and nothing else; it is not part of either fault, and the package
// on disk is not touched.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const video = resolve(flag("--video", ""));
const model = flag("--model", "onnx-community/whisper-base");
const language = flag("--language", "auto");
const windowS = Number(flag("--window", "20"));
const maxSkipped = Number(flag("--max-skipped", "0"));
const minCoverage = Number(flag("--min-coverage", "0.95"));
const headed = args.includes("--headed");
const browserName = flag("--browser", "chromium");
// A fresh profile downloads the model on every run -- 80 MB for Base -- and
// on a slow line that is the whole run spent before a window can be heard.
// That is a real first-run cost and worth measuring once; it is not what
// "keeping up" means, so the steady state is measured on a profile that has
// the model already, the way a user's second video is.
const profileDir = flag("--profile", null);
// Screenshots of lines on the video, taken after the run -- evidence for a
// person, not an assertion.
const shotsDir = args.includes("--shots") ? resolve(flag("--shots", ".")) : null;
const warmOnly = args.includes("--warm");
const speechUntil = args.includes("--speech-until") ? Number(flag("--speech-until", "0")) : null;

if (!existsSync(video)) {
  console.error(`--video is required and must exist (got "${video}")`);
  process.exit(2);
}

// --- the package, as Chrome would load it --------------------------------

const work = mkdtempSync(join(tmpdir(), "opensubs-ext-"));
// Chrome derives an unpacked extension's id from the folder it loads from,
// and the model cache belongs to that id. With a reused profile the package
// has to unpack to the same folder every time, or each run is a new
// extension with an empty cache in an old profile.
const unpacked = profileDir ? `${resolve(profileDir)}-extension` : join(work, "extension");
rmSync(unpacked, { recursive: true, force: true });
const zip = flag("--zip", null);
if (zip) {
  execFileSync("unzip", ["-q", resolve(zip), "-d", unpacked]);
} else {
  cpSync(resolve(flag("--package", browserName === "firefox" ? "dist-firefox" : "dist")), unpacked, { recursive: true });
}
const manifestPath = join(unpacked, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.host_permissions = [...(manifest.host_permissions ?? []), "http://127.0.0.1/*"];
// A fourth version component, unique per run, so Chrome treats a reused
// profile's copy as an update and installs this run's service worker.
manifest.version = `${manifest.version.split(".").slice(0, 3).join(".")}.${Math.floor(Date.now() / 1000) % 65535}`;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// --- a page with a video, on its own origin ------------------------------

const videoName = basename(video);
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>lecture</title>
      <video id="v" src="/${videoName}" width="640" height="360" controls playsinline></video>`);
    return;
  }
  if (req.url === `/${videoName}`) {
    // Range support, because a <video> asks for ranges and a server that
    // ignores them makes Chrome treat the file as unseekable.
    const body = readFileSync(video);
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const from = Number(range[1]);
      const to = range[2] ? Number(range[2]) : body.length - 1;
      res.writeHead(206, {
        "content-type": "video/mp4",
        "content-range": `bytes ${from}-${to}/${body.length}`,
        "accept-ranges": "bytes",
        "content-length": to - from + 1,
      });
      res.end(body.subarray(from, to + 1));
      return;
    }
    res.writeHead(200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": body.length });
    res.end(body);
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

// --- run -------------------------------------------------------------------

const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
/**
 * Firefox, driven over WebDriver.
 *
 * Playwright's Firefox is a patched build that cannot open a moz-extension://
 * page at all -- a navigation there never commits -- so the popup, which is
 * where Start comes from, is out of its reach. geckodriver drives the real
 * Firefox, installs the package as a temporary add-on, and opens extension
 * pages like any other. The add-on's internal UUID, and so its address, is
 * pinned through a profile preference.
 *
 * What comes back is an object with the handful of Playwright calls the flow
 * below uses -- newPage, goto, evaluate, waitForFunction, close -- so both
 * browsers go through exactly the same steps and the same checks.
 */
async function firefoxContext({ geckodriver, profile, geckoId, uuid, unpackedPath }) {
  const { spawn } = await import("node:child_process");
  const port = 4444 + Math.floor(Math.random() * 500);
  // --allow-system-access lets the test open a tab from the browser's own
  // context, which is the only way to reach a moz-extension:// page:
  // WebDriver refuses to navigate a content tab there.
  const driver = spawn(geckodriver, ["--port", String(port), "--allow-system-access"], { stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, path, body) => {
    for (let i = 0; i < 50; i += 1) {
      try {
        const r = await fetch(`${base}${path}`, {
          method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
        });
        const j = await r.json();
        if (j.value?.error) throw new Error(`${j.value.error}: ${j.value.message}`);
        return j.value;
      } catch (e) {
        if (String(e).includes("ECONNREFUSED") || String(e).includes("fetch failed")) { await new Promise((r) => setTimeout(r, 200)); continue; }
        throw e;
      }
    }
    throw new Error("geckodriver did not answer");
  };
  const session = await call("POST", "/session", { capabilities: { alwaysMatch: {
    browserName: "firefox",
    "moz:firefoxOptions": {
      binary: "/Applications/Firefox.app/Contents/MacOS/firefox",
      args: [...(headed ? [] : ["-headless"]), "-profile", profile],
      prefs: {
        "extensions.webextensions.uuids": JSON.stringify({ [geckoId]: uuid }),
        "media.autoplay.default": 0,
        "media.autoplay.blocking_policy": 0,
        // The popup asks for the site with permissions.request(), and Firefox
        // answers that with a prompt a person clicks "Allow" on. This answers
        // yes without the prompt; the request itself still has to come from
        // a real click, below.
        "extensions.webextOptionalPermissionPrompts": false,
      },
    },
  } } });
  const id = session.sessionId;
  const installed = await call("POST", `/session/${id}/moz/addon/install`, { path: unpackedPath, temporary: true });
  if (installed !== geckoId) throw new Error(`installed ${installed}, expected ${geckoId}`);


  let current = await call("GET", `/session/${id}/window`);
  const handles = [current];
  const focus = async (h) => { if (h !== current) { await call("POST", `/session/${id}/window`, { handle: h }); current = h; } };
  const page = (initial) => { let handle = initial; return {
    async goto(url) {
      if (!url.startsWith("moz-extension:")) {
        await focus(handle);
        await call("POST", `/session/${id}/url`, { url });
        return;
      }
      // Open it from the browser's own context, then find the tab it became.
      const before = new Set(await call("GET", `/session/${id}/window/handles`));
      await call("POST", `/session/${id}/moz/context`, { context: "chrome" });
      await call("POST", `/session/${id}/execute/sync`, {
        script: `const url = arguments[0];
          const win = Services.wm.getMostRecentWindow("navigator:browser");
          win.gBrowser.selectedTab = win.gBrowser.addTab(url, {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });`,
        args: [url],
      });
      await call("POST", `/session/${id}/moz/context`, { context: "content" });
      for (let i = 0; i < 50; i += 1) {
        const now = await call("GET", `/session/${id}/window/handles`);
        const fresh = now.find((h) => !before.has(h));
        if (fresh) { handle = fresh; handles.push(fresh); current = null; await focus(fresh); break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 1500));
    },
    async evaluate(fn, arg) {
      await focus(handle);
      // `chrome` is the extension namespace the flow is written against.
      // Firefox has it too, but its promise-returning twin is `browser`, so
      // each function runs with `chrome` bound to that.
      const script = `const done = arguments[arguments.length - 1];
        const chrome = globalThis.browser ?? globalThis.chrome;
        Promise.resolve((${fn.toString()})(arguments[0]))
          .then((v) => done({ ok: v === undefined ? null : v }), (e) => done({ error: String(e && e.message || e) }));`;
      const r = await call("POST", `/session/${id}/execute/async`, { script, args: [arg ?? null] });
      if (r && r.error) throw new Error(r.error);
      return r ? r.ok : r;
    },
    /** A real click, which is what permissions.request() insists on. */
    async click(selector) {
      await focus(handle);
      const el = await call("POST", `/session/${id}/element`, { using: "css selector", value: selector });
      const ref = el[Object.keys(el)[0]];
      await call("POST", `/session/${id}/element/${ref}/click`, {});
    },
    /** Only the visible viewport, which is what Playwright's default shows too. */
    async screenshot({ path }) {
      await focus(handle);
      const png = await call("GET", `/session/${id}/screenshot`);
      writeFileSync(path, Buffer.from(png, "base64"));
    },
    async waitForFunction(fn) {
      for (let i = 0; i < 300; i += 1) {
        if (await this.evaluate(fn)) return;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("waitForFunction timed out");
    },
  }; };
  let first = true;
  return {
    async newPage() {
      if (first) { first = false; return page(handles[0]); }
      const made = await call("POST", `/session/${id}/window/new`, { type: "tab" });
      handles.push(made.handle);
      return page(made.handle);
    },
    serviceWorkers() { return []; },
    async close() {
      await call("DELETE", `/session/${id}`).catch(() => {});
      driver.kill();
    },
  };
}

let context;
let extensionBase;
if (browserName === "firefox") {
  const geckoId = manifest.browser_specific_settings?.gecko?.id;
  if (!geckoId) throw new Error("the Firefox manifest names no gecko id");
  const uuid = "6f0b5f2e-4a1c-4d6e-9b8a-0c1d2e3f4a5b";
  const profile = profileDir ? resolve(profileDir) : join(work, "profile");
  mkdirSync(profile, { recursive: true });
  context = await firefoxContext({
    geckodriver: flag("--geckodriver", "geckodriver"), profile, geckoId, uuid, unpackedPath: unpacked,
  });
  extensionBase = `moz-extension://${uuid}`;
} else {
  context = await chromium.launchPersistentContext(profileDir ? resolve(profileDir) : join(work, "profile"), {
    // Full Chromium, not Playwright's default headless shell: the shell cannot
    // load extensions at all, and the symptom is a wait for a service worker
    // that never starts -- a hang, not an error.
    channel: "chromium",
    headless: !headed,
    args: [
      `--disable-extensions-except=${unpacked}`,
      `--load-extension=${unpacked}`,
      "--autoplay-policy=no-user-gesture-required",
      "--enable-unsafe-webgpu",
    ],
  });
}

let exitCode = 0;
try {
  if (browserName !== "firefox") {
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 20000 }));
    extensionBase = `chrome-extension://${new URL(worker.url()).host}`;
    // The worker must be running *this* package. A reused profile keeps the
    // extension's service worker between launches, and with an unchanged
    // manifest Chrome can go on running the previous run's background.js
    // though the files on disk are new -- the content script and engine page
    // load fresh each time, so this test once ran stale seam logic for three
    // rounds while everything else was current. The test copy's version is
    // unique per run, and the worker is asked which version it is.
    const running = await worker.evaluate(() => chrome.runtime.getManifest().version);
    if (running !== manifest.version) {
      throw new Error(`the extension's worker is running ${running}, not this package (${manifest.version})`);
    }
  }

  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => document.querySelector("video").readyState >= 2);
  const duration = await page.evaluate(() => document.querySelector("video").duration);

  // The popup's own page, opened as a tab: it has the same `chrome.*` the
  // popup does, and it is where status broadcasts land.
  const control = await context.newPage();
  await control.goto(`${extensionBase}/popup.html`);
  await control.evaluate(() => {
    window.__statuses = [];
    window.__windows = [];
    window.__segments = [];
    // Every extension page hears runtime broadcasts, including traffic that
    // is not addressed to it -- which is what lets this see each window the
    // page sends and each batch of lines the engine returns, without any
    // hook in the product.
    chrome.runtime.onMessage.addListener((m) => {
      if (!m) return;
      if (m.kind === "status") window.__statuses.push({ t: Date.now(), note: m.status.note, stage: m.status.stage, device: m.status.device });
      if (m.kind === "window") window.__windows.push({ t: Date.now(), offset: m.offset, bytes: typeof m.audio === "string" ? Math.round(m.audio.length * 0.75) : JSON.stringify(m.audio).length, mime: m.mime });
      if (m.kind === "segments") window.__segments.push({ t: Date.now(), offset: m.offset, cues: m.cues });
    });
  });
  // Access to the page, asked for the way the popup asks, and asked for
  // first: without it Firefox cannot match the tab lookup below by URL, the
  // lookup comes back empty, and Start goes out with no tab -- whereupon the
  // background falls back to the tab that sent it, which is the popup page
  // itself, and reports "Missing host permission" for a page it was never
  // meant to touch. That cost this test three runs to see.
  //
  // permissions.request
  // for this origin, from a click. Chrome granted the test copy's
  // host_permissions at install, so only Firefox needs it -- and without it
  // the fixed package correctly refuses the page ("Missing host permission
  // for the tab"), which reads exactly like the bug under test.
  if (browserName === "firefox") {
    await control.evaluate((o) => {
      const b = document.createElement("button");
      b.id = "__allow";
      b.textContent = "allow";
      b.addEventListener("click", () => {
        chrome.permissions.request({ origins: [`${o}/*`] })
          .then((ok) => { document.body.dataset.allowed = String(ok); },
                (e) => { document.body.dataset.allowed = `error: ${e.message}`; });
      });
      document.body.append(b);
    }, origin);
    await control.click("#__allow");
    await control.waitForFunction(() => document.body.dataset.allowed !== undefined);
    const allowed = await control.evaluate(() => document.body.dataset.allowed);
    console.log(`${at()}  site access, asked for as the popup asks: ${allowed}`);
    if (allowed !== "true") throw new Error(`Firefox did not grant the page: ${allowed}`);
  }

  // Found by comparing URLs, not by a match pattern: Firefox's match patterns
  // take no port, so `http://127.0.0.1:52485/*` matches nothing there while
  // Chrome accepts it -- and this page, like any local server, has a port.
  const tabId = await control.evaluate(
    async (o) => (await chrome.tabs.query({})).find((t) => (t.url ?? "").startsWith(`${o}/`))?.id,
    origin,
  );
  if (typeof tabId !== "number") {
    const all = await control.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active })));
    console.log(`${at()}  tabs the extension can see: ${JSON.stringify(all)}`);
    throw new Error(`no tab found for ${origin} -- Start would go to the wrong page`);
  }

  // What a person does: the video is playing, then they press Start.
  await page.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 0; return v.play(); });
  const startedAt = Date.now();
  const started = await control.evaluate(
    (m) => chrome.runtime.sendMessage(m),
    { kind: "start", tabId, settings: { model, language, window: windowS, overlay: true, fontScale: 1 } },
  );
  console.log(`${at()}  start -> ${JSON.stringify(started)}   (${model}, ${language}, ${windowS}s windows, ${duration.toFixed(1)}s video)`);

  // Is there anything in the page listening? This is fault one of APP-109
  // asked directly, rather than inferred from subtitles never arriving:
  // Chrome answers "Receiving end does not exist" when injection failed.
  await new Promise((r) => setTimeout(r, 1500));
  const receiver = await control.evaluate(async (id) => {
    try {
      await chrome.tabs.sendMessage(id, { kind: "status", status: { stage: "listening", fraction: null, note: "probe" } });
      return "present";
    } catch (e) {
      return String(e.message ?? e);
    }
  }, tabId);
  // The same question asked of the page itself: once the content script has
  // run and taken "begin", its subtitle overlay is in the document. This one
  // works the same in both browsers -- Firefox's WebDriver sandbox makes the
  // probe above fail on its own terms ("Incorrect argument types") whatever
  // the extension is doing -- and it is closer to what a viewer sees.
  const overlay = await page.evaluate(() => !!document.getElementById("opensubs-overlay-host"));
  console.log(`${at()}  content script in the page: ${receiver}; subtitle overlay in the page: ${overlay ? "yes" : "no"}`);
  const present = receiver === "present" || overlay;

  // Watch until the video ends, then give the last window time to land.
  let firstCueAt = null;
  let lastNote = "";
  let seen = 0;
  const deadline = startedAt + (warmOnly ? 1200 : duration + windowS * 3 + 60) * 1000;
  for (;;) {
    const state = await control.evaluate(() => chrome.runtime.sendMessage({ kind: "state" }));
    if (state.count > 0 && firstCueAt === null) {
      firstCueAt = (Date.now() - startedAt) / 1000;
      console.log(`${at()}  first subtitle, ${firstCueAt.toFixed(1)}s after Start`);
    }
    if (warmOnly && state.count > 0) break;
    const ended = await page.evaluate(() => document.querySelector("video").ended);
    // Broadcasts as well as the session's state: when Start fails the
    // background says why and then drops the session, so by the next poll
    // the state is blank and only the broadcast still knows what happened.
    const heard = await control.evaluate((n) => window.__statuses.slice(n), seen);
    for (const h of heard) {
      if (h.stage === "error") console.log(`${at()}  [error, broadcast] ${h.note}`);
    }
    seen += heard.length;
    if (heard.some((h) => h.stage === "error") && !state.running) break;
    if (state.status.stage === "error") break;
    if (ended && warmOnly) {
      // Keep the video going until the model has loaded and heard something.
      await page.evaluate(() => { const v = document.querySelector("video"); v.currentTime = 0; return v.play(); });
    } else if (ended && Date.now() > startedAt + (duration + windowS * 2) * 1000) break;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const { srt, count } = await control.evaluate(() => chrome.runtime.sendMessage({ kind: "cues" }));
  const statuses = await control.evaluate(() => window.__statuses);
  const windows = await control.evaluate(() => window.__windows);
  const batches = await control.evaluate(() => window.__segments);
  // Lines arrive a window or two after they are spoken, so a screenshot taken
  // during the first playback mostly catches the gap between them. Seek back
  // to a few lines instead, pause, and photograph each one on the video.
  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    // From the SRT rather than the broadcasts, which Firefox does not deliver
    // to the control page.
    const secs = (x) => { const [h, m, r] = x.split(":"); return +h * 3600 + +m * 60 + +r.replace(",", "."); };
    const at = [...String(srt).matchAll(/(\d\d:\d\d:\d\d,\d+) --> (\d\d:\d\d:\d\d,\d+)/g)]
      .map((m) => ({ start: secs(m[1]), end: secs(m[2]) })).filter((c) => c.end - c.start > 1.5);
    const picks = [at[1], at[Math.floor(at.length / 2)], at.at(-2)].filter(Boolean);
    for (const [i, c] of picks.entries()) {
      await page.evaluate((t) => { const v = document.querySelector("video"); v.pause(); v.currentTime = t; }, (c.start + c.end) / 2);
      await new Promise((r) => setTimeout(r, 1200));
      await page.screenshot({ path: join(shotsDir, `${browserName}-line${i + 1}.png`) })
        .catch((e) => console.log(`screenshot ${i + 1}: ${e.message}`));
    }
  }
  const videoAt = (t) => ((t - startedAt) / 1000).toFixed(1);
  console.log("\nwindows the page sent:");
  for (const w of windows) console.log(`  at +${videoAt(w.t)}s  offset ${w.offset.toFixed(1)}s  ${w.bytes} bytes  ${w.mime}`);
  console.log("what the engine returned:");
  for (const b of batches) {
    const span = b.cues.length ? `${b.cues[0].start.toFixed(1)}-${b.cues[b.cues.length - 1].end.toFixed(1)}s` : "nothing";
    console.log(`  at +${videoAt(b.t)}s  offset ${b.offset.toFixed(1)}s  ${b.cues.length} lines  ${span}`);
    for (const c of b.cues) console.log(`      ${c.start.toFixed(1)}-${c.end.toFixed(1)}  ${c.text.slice(0, 70)}`);
  }

  // Coverage is measured against *speech*, not against the video's length.
  // A clip that ends in thirteen seconds of silence has thirteen seconds
  // that should carry no subtitle, and counting them as missed made an
  // earlier run of this test report a 25-second hole that was mostly quiet.
  // ffmpeg finds the silences; everything else is speech.
  const silences = [];
  // ffmpeg reports on stderr, which execFileSync does not return -- an
  // earlier cut of this read stdout, found no silences, and counted a quiet
  // ending as missed speech.
  const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", video, "-af", "silencedetect=noise=-35dB:d=1.5", "-f", "null", "-"],
    { encoding: "utf8" });
  for (const m of String(probe.stderr ?? "").matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) {
    silences.push([+m[1], +m[2]]);
  }
  // Silence detection cannot tell music from speech. A clip whose last
  // seconds are an outro says so with --speech-until, taken from a
  // full-file transcription of the same clip.
  if (speechUntil !== null) silences.push([speechUntil, duration + 1]);
  const silent = (s) => silences.some(([a, b]) => s >= a && s + 1 <= b + 0.5);
  const cues = [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/g)].map((m) => ({
    start: +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000,
    end: +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000,
  }));
  const covered = new Set();
  for (const c of cues) for (let s = Math.floor(c.start); s < Math.ceil(c.end); s += 1) covered.add(s);
  const speechSeconds = [...Array(Math.ceil(duration)).keys()].filter((s) => !silent(s));
  const coverage = speechSeconds.filter((s) => covered.has(s)).length / Math.max(1, speechSeconds.length);
  const gaps = [];
  for (let i = 0, from = null; i <= speechSeconds.length; i += 1) {
    const s = speechSeconds[i];
    if (s !== undefined && !covered.has(s) && (from === null || s === speechSeconds[i - 1] + 1)) { from ??= s; continue; }
    if (from !== null && speechSeconds[i - 1] - from + 1 >= 5) gaps.push(`${from}-${speechSeconds[i - 1] + 1}s`);
    from = s !== undefined && !covered.has(s) ? s : null;
  }
  // A line that begins well before the one before it ends is a line on the
  // wrong clock. That was every window seam in 1.0.1: each window was stamped
  // three seconds before its own audio.
  const early = cues.filter((c, i) => i > 0 && c.start < cues[i - 1].end - 0.5).length;
  // The same fault in its other shape: a line squeezed into order so that it
  // no longer overlaps, and is on screen too briefly to read. In 1.0.1's
  // logic a sentence's continuation came out 0.15 s long, *before* the
  // sentence it continued.
  const text = srt.split(/\n\n+/).map((b) => b.split("\n").slice(2).join(" "));
  const flashes = cues.filter((c, i) => c.end - c.start < 0.5 && (text[i] ?? "").trim().split(/\s+/).length >= 3).length;
  const skipped = Math.max(0, ...statuses.map((s) => Number(/\((\d+) windows? skipped/.exec(s.note)?.[1] ?? 0)));
  const detections = statuses.filter((s) => s.note === "Listening for the language").length;
  const device = statuses.find((s) => s.device)?.device ?? "?";

  console.log(`\n${count} subtitle lines, covering ${(coverage * 100).toFixed(0)}% of the ${speechSeconds.length}s with speech in them  (device ${device})`);
  console.log(`silences: ${silences.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}s`).join(", ") || "none"}   lines starting before the previous ended: ${early}   unreadably brief lines: ${flashes}`);
  console.log(`language detection passes: ${detections}   windows skipped: ${skipped}`);
  console.log(`gaps of 5s or more: ${gaps.length ? gaps.join(", ") : "none"}`);
  console.log(`first subtitle: ${firstCueAt === null ? "never" : firstCueAt.toFixed(1) + "s after Start"}`);
  writeFileSync(join(work, "out.srt"), srt);
  writeFileSync(join(work, "batches.json"), JSON.stringify(batches, null, 1));
  console.log(`srt: ${join(work, "out.srt")}`);

  const fails = [];
  if (!present) fails.push(`no content script in the page (${receiver}; no overlay either)`);
  if (firstCueAt === null) fails.push("no subtitle ever arrived");
  else if (firstCueAt > 60) fails.push(`first subtitle took ${firstCueAt.toFixed(0)}s, over the 60s the task allows`);
  if (skipped > maxSkipped) fails.push(`${skipped} window(s) skipped to keep up`);
  if (coverage < minCoverage) fails.push(`coverage ${(coverage * 100).toFixed(0)}% of speech, under ${(minCoverage * 100).toFixed(0)}%`);
  if (early > 0) fails.push(`${early} line(s) start before the previous one ends -- a window on the wrong clock`);
  if (flashes > 0) fails.push(`${flashes} line(s) of several words on screen for under half a second`);
  if (fails.length) {
    exitCode = 1;
    console.log(`\nFAIL\n  ${fails.join("\n  ")}`);
  } else {
    console.log("\nPASS");
  }
} finally {
  await context.close();
  server.close();
  if (!args.includes("--keep") && !profileDir) rmSync(join(work, "profile"), { recursive: true, force: true });
}
process.exit(exitCode);
