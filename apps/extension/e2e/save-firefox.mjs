// Save .srt on Firefox, where the popup does not survive the save dialog.
//
//   node e2e/save-firefox.mjs --package dist-firefox --geckodriver /tmp/gecko/geckodriver
//                             [--firefox-binary /path/to/firefox] [--headed]
//
// # What broke
//
// The popup made a blob URL and handed it to downloads.download. Firefox
// closes the popup when the save dialog opens, the URL dies with the page
// that made it, and the download lands in the panel with a retry arrow and
// no file (APP-152). Chromium keeps it, so the fault was invisible there.
//
// # What this checks, and why it is not simply "did a file appear"
//
// A save dialog cannot be clicked from automation, so the run sets Firefox's
// prefs to save straight to a directory instead of asking. That covers the
// download itself, but not the thing that actually broke -- so the popup is
// closed *before* the download is asked for, and the URL is then read back
// from the background page. Both halves have to hold:
//
//   1. pressing Save in the popup is answered by the background, not by the
//      popup making a URL of its own (`{ok:true}`);
//   2. with the popup gone, the URL the background made still resolves, and
//      the file that lands holds the subtitles.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const headed = args.includes("--headed");

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); return; }
  fails.push(name);
  console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
};

const work = mkdtempSync(join(tmpdir(), "opensubs-save-"));
const unpacked = join(work, "extension");
const downloads = join(work, "downloads");
mkdirSync(downloads);
const zip = flag("--zip", null);
if (zip) execFileSync("unzip", ["-q", resolve(zip), "-d", unpacked]);
else cpSync(resolve(flag("--package", "dist-firefox")), unpacked, { recursive: true });

// The one concession the other Firefox test makes too: a person grants the
// page by clicking the toolbar icon, which automation cannot click.
const manifestPath = join(unpacked, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.host_permissions = [...(manifest.host_permissions ?? []), "http://127.0.0.1/*"];
const geckoId = manifest.browser_specific_settings?.gecko?.id;
if (!geckoId) throw new Error("the Firefox package has no gecko id");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const uuid = "11111111-2222-3333-4444-555555555555";

const video = resolve(flag("--video", ""));
if (!existsSync(video)) {
  console.error(`--video is required and must exist (got "${video}")`);
  process.exit(2);
}
const body = readFileSync(video);
const server = createServer((req, res) => {
  if (req.url === "/v.mp4") {
    res.writeHead(200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": body.length });
    res.end(body);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end('<!doctype html><title>lecture</title><video id="v" src="/v.mp4" width="640" height="360" preload="metadata"></video>');
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = join(work, "profile");
mkdirSync(profile);
const port = 4444 + Math.floor(Math.random() * 500);
const driver = spawn(flag("--geckodriver", "geckodriver"), ["--port", String(port), "--allow-system-access"], { stdio: "ignore" });
const base = `http://127.0.0.1:${port}`;
const call = async (method, path, payload) => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${base}${path}`, {
        method, headers: { "content-type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const j = await r.json();
      if (j.value?.error) throw new Error(`${j.value.error}: ${j.value.message}`);
      return j.value;
    } catch (e) {
      if (String(e).includes("ECONNREFUSED") || String(e).includes("fetch failed")) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw e;
    }
  }
  throw new Error("geckodriver did not answer");
};

let sessionId = null;
try {
  const session = await call("POST", "/session", { capabilities: { alwaysMatch: {
    browserName: "firefox",
    pageLoadStrategy: "eager",
    "moz:firefoxOptions": {
      binary: flag("--firefox-binary", "/Applications/Firefox.app/Contents/MacOS/firefox"),
      args: [...(headed ? [] : ["-headless"]), "-profile", profile],
      prefs: {
        "extensions.webextensions.uuids": JSON.stringify({ [geckoId]: uuid }),
        "extensions.webextOptionalPermissionPrompts": false,
        // No save dialog: automation cannot click one. What broke is checked
        // separately, by closing the popup before the download is asked for.
        "browser.download.folderList": 2,
        "browser.download.dir": downloads,
        "browser.download.useDownloadDir": true,
        "browser.download.always_ask_before_handling_new_types": false,
        "browser.helperApps.neverAsk.saveToDisk": "text/plain,application/x-subrip",
      },
    },
  } } });
  sessionId = session.sessionId;
  const installed = await call("POST", `/session/${sessionId}/moz/addon/install`, { path: unpacked, temporary: true });
  if (installed !== geckoId) throw new Error(`installed ${installed}, expected ${geckoId}`);

  const handles = async () => call("GET", `/session/${sessionId}/window/handles`);
  const focus = (h) => call("POST", `/session/${sessionId}/window`, { handle: h });
  const script = (body_, argv = []) =>
    call("POST", `/session/${sessionId}/execute/async`, { script: body_, args: argv });

  // The page with the video.
  await call("POST", `/session/${sessionId}/url`, { url: `${origin}/` });
  const pageHandle = await call("GET", `/session/${sessionId}/window`);

  // The popup, as its own tab: the same chrome.* the toolbar popup has.
  const before = new Set(await handles());
  await call("POST", `/session/${sessionId}/moz/context`, { context: "chrome" });
  // From the browser's own context, with the system principal: WebDriver
  // refuses to navigate a content tab to moz-extension://.
  await call("POST", `/session/${sessionId}/execute/sync`, {
    script: `const url = arguments[0];
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      win.gBrowser.selectedTab = win.gBrowser.addTab(url, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });`,
    args: [`moz-extension://${uuid}/popup.html`],
  });
  await call("POST", `/session/${sessionId}/moz/context`, { context: "content" });
  let popupHandle = null;
  for (let i = 0; i < 40 && !popupHandle; i += 1) {
    popupHandle = (await handles()).find((h) => !before.has(h)) ?? null;
    if (!popupHandle) await new Promise((r) => setTimeout(r, 250));
  }
  if (!popupHandle) throw new Error("the popup never opened");
  await focus(popupHandle);

  const send = (message) => script(
    "const done = arguments[arguments.length - 1];" +
    "browser.runtime.sendMessage(arguments[0]).then(done, (e) => done({ error: String(e) }));",
    [message]);

  const tabId = await script(
    "const done = arguments[arguments.length - 1];" +
    "browser.tabs.query({}).then((ts) => done((ts.find((t) => (t.url || '').startsWith(arguments[0])) || {}).id ?? null));",
    [origin]);
  if (typeof tabId !== "number") throw new Error(`no tab for ${origin}`);

  const settings = { model: "onnx-community/whisper-tiny.en", language: "en", window: 20, overlay: true, fontScale: 0.8, backend: "cpu" };
  await send({ kind: "start", tabId, settings });
  await new Promise((r) => setTimeout(r, 2500));
  // Lines as the engine hands them over, so this test needs no model.
  await send({ kind: "segments", take: 1, offset: 0, cues: [
    { start: 0, end: 3, text: "It's the height of the Gold Rush," },
    { start: 3, end: 6, text: "1850s, California." },
  ] });
  const state = await send({ kind: "state", tabId });
  ok("the lines are there to save", state.count === 2, `count ${state.count}`);

  // Press Save the way the popup does, and then take the popup away before
  // the download is asked for -- which is what Firefox does when the save
  // dialog opens, and what killed the URL the popup used to make.
  const answered = await send({ kind: "save", tabId });
  ok("the background answers Save, rather than the popup doing it", answered?.ok === true, JSON.stringify(answered));

  await call("DELETE", `/session/${sessionId}/window`);          // the popup closes
  await focus(pageHandle);
  await new Promise((r) => setTimeout(r, 2500));

  // What the browser thinks of the download, asked from a page opened after
  // the popup died: with the old code the item was there and interrupted --
  // the retry arrow in the panel -- because the URL went with the popup.
  const probe = await (async () => {
    const seen = new Set(await handles());
    await call("POST", `/session/${sessionId}/moz/context`, { context: "chrome" });
    await call("POST", `/session/${sessionId}/execute/sync`, {
      script: `const url = arguments[0];
        const win = Services.wm.getMostRecentWindow("navigator:browser");
        win.gBrowser.selectedTab = win.gBrowser.addTab(url, {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });`,
      args: [`moz-extension://${uuid}/popup.html`],
    });
    await call("POST", `/session/${sessionId}/moz/context`, { context: "content" });
    let fresh = null;
    for (let i = 0; i < 40 && !fresh; i += 1) {
      fresh = (await handles()).find((h) => !seen.has(h)) ?? null;
      if (!fresh) await new Promise((r) => setTimeout(r, 250));
    }
    await focus(fresh);
    return script(
      "const done = arguments[arguments.length - 1];" +
      "browser.downloads.search({ limit: 5 }).then((items) => done(items.map((i) => " +
      "({ state: i.state, error: i.error, url: (i.url || '').slice(0, 24), filename: (i.filename || '').split('/').pop() }))), " +
      "(e) => done({ error: String(e) }));");
  })();
  console.log("  downloads:", JSON.stringify(probe));
  const item = Array.isArray(probe) ? probe.find((i) => (i.filename || "").endsWith(".srt")) : null;
  ok("the browser has a download for it, not an interrupted one",
    item ? item.state !== "interrupted" : false, JSON.stringify(probe));

  const files = readdirSync(downloads).filter((f) => f.endsWith(".srt"));
  ok("a .srt lands on disk with the popup gone", files.length === 1, JSON.stringify(readdirSync(downloads)));
  if (files.length) {
    const text = readFileSync(join(downloads, files[0]), "utf8");
    ok("and it holds the subtitles", /Gold Rush/.test(text) && /00:00:03,000 --> 00:00:06,000/.test(text),
      JSON.stringify(text.slice(0, 80)));
  }
} finally {
  if (sessionId) await call("DELETE", `/session/${sessionId}`).catch(() => {});
  driver.kill();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
