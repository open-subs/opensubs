// Does "Automatic" language stay in the language the video is spoken in?
//
//   node e2e/autolang.mjs <video> --expect ko [--engine chromium|firefox]
//        [--model auto] [--window 20] [--from 97] [--stall 100:17,130:6]
//        [--mode capture|live|file|probe] [--stutter 10:2] [--json out.json]
//
// --mode capture (the default) cuts the video into the windows the recorder
// makes -- a short first one, then `--window` seconds each starting
// OVERLAP_S before the last ended -- as WebM/Opus, and replays them through
// the extension's engine with the language left on "auto". `--from` starts
// the capture that far in, as pressing Start mid-film does. `--stall
// at:seconds` freezes playback at a media time for that many seconds: the
// recorder runs on the wall clock, so a stall is silence in the middle of a
// window, which is what a buffering video hands the engine. Same input,
// same windows, every run.
//
// --mode live plays the video in the page and records it in real time, as
// the extension does; `--stutter every:hold` pauses playback for `hold`
// seconds every `every` seconds. --mode file transcribes the whole video in
// one call, as the web app does an upload. --mode probe prints Whisper's
// reading of every four-second cell: language, how sure, and how likely it
// thinks it is that nobody is speaking.
//
// The check is on the writing system, because that is what a viewer sees:
// with `--expect ko`, every line must carry Hangul, and a line written in
// Latin letters or kana is a line in a language nobody in the video spoke.
//
// Measured on a six-minute Korean drama clip with Whisper Tiny: started at
// 1:37 with a 17-second stall three seconds in, the engine that let one
// window decide wrote 100 of 101 lines in English; this one writes none.
// The video is not part of the repository; use any recording in one
// language that you have the right to use.
import { createServer as createViteServer } from "vite";
import { chromium, firefox } from "playwright";
import { copyFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const FLAGS = ["--stutter", "--from", "--mode", "--engine", "--model", "--window", "--stall", "--json", "--expect", "--port"];
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const flagValues = new Set(FLAGS.filter((f) => args.includes(f)).map((f) => args[args.indexOf(f) + 1]));
const videoArg = args.find((a) => !a.startsWith("--") && !flagValues.has(a));
if (!videoArg) {
  console.error("usage: node e2e/autolang.mjs <video> --expect <language> [--stall at:seconds,...]");
  process.exit(2);
}
const video = resolve(videoArg);
if (!existsSync(video)) {
  console.error(`no such video: ${video}`);
  process.exit(2);
}
const engineName = flag("--engine", "chromium");
const model = flag("--model", "auto");
const windowS = Number(flag("--window", "20"));
const expect = flag("--expect", "");
const port = Number(flag("--port", "8797"));
// "capture" replays recorder windows through the extension's engine; "file"
// transcribes the whole video in one call, as the web app does an upload.
const mode = flag("--mode", "capture");
// Start the capture this far into the video, as pressing Start mid-film does.
const from = Number(flag("--from", "0"));
const stalls = (flag("--stall", "") || "")
  .split(",")
  .filter(Boolean)
  .map((s) => s.split(":").map(Number))
  .map(([at, seconds]) => ({ at: at - from, seconds }))
  .filter(({ at }) => at >= 0)
  .sort((a, b) => a.at - b.at);

// Matches capture.ts. Imported values would pull the browser module in.
const FIRST_WINDOW_S = 6;
const OVERLAP_S = 3;
const RATE = 48000;

// The whole soundtrack, as 48 kHz stereo float, the way the recorder hears it.
const decoded = spawnSync("ffmpeg", ["-v", "error", "-ss", String(from), "-i", video, "-vn", "-ac", "2", "-ar", String(RATE), "-f", "f32le", "-"], {
  maxBuffer: 1 << 30,
});
if (decoded.status !== 0) {
  console.error(decoded.stderr.toString());
  process.exit(2);
}
const media = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.byteLength / 4);
const mediaSeconds = media.length / 2 / RATE;

// The wall clock: the media, with silence wherever playback stalled.
const pieces = [];
let cursor = 0;
for (const { at, seconds } of stalls) {
  const cut = Math.round(Math.min(at, mediaSeconds) * RATE) * 2;
  pieces.push(media.subarray(cursor, cut), new Float32Array(Math.round(seconds * RATE) * 2));
  cursor = cut;
}
pieces.push(media.subarray(cursor));
const wallLength = pieces.reduce((n, p) => n + p.length, 0);
const wall = new Float32Array(wallLength);
{
  let at = 0;
  for (const p of pieces) {
    wall.set(p, at);
    at += p.length;
  }
}
const wallSeconds = wall.length / 2 / RATE;

/** Media time at a wall-clock time: what `media.currentTime` read when a window opened. */
function mediaAt(t) {
  let shift = 0;
  for (const { at, seconds } of stalls) {
    if (t <= at + shift) break;
    if (t < at + shift + seconds) return at;
    shift += seconds;
  }
  return t - shift;
}

// The recorder's schedule (capture.ts recordWindows).
const schedule = [{ start: 0, length: Math.min(FIRST_WINDOW_S, windowS) }];
for (let start = 0; start < wallSeconds - 1; start += Math.max(1, windowS - OVERLAP_S)) {
  schedule.push({ start, length: Math.min(windowS, wallSeconds - start) });
}

const servedDir = join("public/testmedia/autolang", `${basename(video).replace(/\W+/g, "-")}-${port}`);
rmSync(servedDir, { recursive: true, force: true });
mkdirSync(servedDir, { recursive: true });
const windows = schedule.map(({ start, length }, i) => {
  const first = Math.round(start * RATE) * 2;
  const last = Math.min(wall.length, Math.round((start + length) * RATE) * 2);
  const slice = wall.slice(first, last);
  const file = join(servedDir, `w${String(i).padStart(3, "0")}.webm`);
  const enc = spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", "-", "-c:a", "libopus", "-b:a", "128k", file],
    { input: Buffer.from(slice.buffer) },
  );
  if (enc.status !== 0) throw new Error(enc.stderr.toString());
  return { url: "/" + file.replace(/^public\//, ""), offset: from + mediaAt(start), mime: "audio/webm;codecs=opus" };
});

// Whole-file modes are served the file itself, written before the server
// starts: with its watcher off, vite only serves public files it saw then.
if (mode === "probe") {
  // The wall clock, stalls included, so a probe sees what a capture sees.
  spawnSync(
    "ffmpeg",
    ["-v", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", "-", "-ac", "1", "-ar", "16000", join(servedDir, "whole.wav")],
    { input: Buffer.from(wall.buffer) },
  );
}
if (mode === "file" || mode === "live") copyFileSync(video, join(servedDir, `whole${extname(video)}`));
// The web app serves its voice detector at ./vad/; a whole file is read the
// way the web app reads it only with that in place. Copied for the run and
// removed after, because the extension does not ship it.
const vadDir = "public/vad";
const ownVad = mode === "file" && !existsSync(vadDir);
if (ownVad) {
  mkdirSync(vadDir, { recursive: true });
  copyFileSync("../web/public/vad/silero_vad.onnx", join(vadDir, "silero_vad.onnx"));
}

const vite = await createViteServer({
  root: ".",
  publicDir: "public",
  // No watcher and no reload: a run takes as long as the model does, and an
  // edit anywhere in the tree meanwhile would reload the page under it.
  server: { port, host: "127.0.0.1", strictPort: true, hmr: false, watch: null },
  configFile: "vite.config.ts",
});
await vite.listen();

const engines = { chromium, firefox };
const engine = engines[engineName];
const fails = [];
let browser;
let result;
try {
  browser = await engine.launch(
    engineName === "chromium"
      ? { args: ["--autoplay-policy=no-user-gesture-required"] }
      : { firefoxUserPrefs: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 } },
  );
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  console error: ${m.text().slice(0, 200)}`);
  });
  await page.goto(`http://127.0.0.1:${port}/e2e/autolang/index.html`);
  await page.waitForFunction(() => document.getElementById("log")?.textContent === "ready", null, { timeout: 180_000 });
  console.log(
    mode === "file" ? `${engineName}: whole file, model ${model}, language auto` :
    `${engineName}: model ${model}, language auto, ${windows.length} windows of ${windowS}s over ${mediaSeconds.toFixed(0)}s` +
      (stalls.length ? `, stalls ${stalls.map((s) => `${s.at}s+${s.seconds}s`).join(" ")}` : ""),
  );
  if (mode === "probe") {
    const served = join(servedDir, "whole.wav");
    const probe = await page.evaluate(
      ({ url, model }) => window.probeCells(url, model),
      { url: "/" + served.replace(/^public\//, ""), model: model === "auto" ? "onnx-community/whisper-tiny" : model },
    );
    const out = flag("--json", "");
    if (out) writeFileSync(out, JSON.stringify(probe, null, 2));
    for (const c of probe.cells) {
      console.log(`  ${String(c.at).padStart(5)}s  ${c.language}  p=${c.p.toFixed(2)}  nospeech=${c.noSpeech === null ? "-" : c.noSpeech.toFixed(2)}`);
    }
    await browser.close();
    await vite.close();
    process.exit(0);
  }
  if (mode === "live") {
    // "--stutter 12:2": hold playback two seconds in every twelve.
    const [every, hold] = (flag("--stutter", "") || "0:0").split(":").map(Number);
    const served = join(servedDir, `whole${extname(video)}`);
    result = await page.evaluate(
      ({ url, settings, stutter }) => window.live(url, settings, stutter),
      {
        url: "/" + served.replace(/^public\//, ""),
        settings: { model, language: "auto", window: windowS, overlay: false, fontScale: 1, backend: "auto" },
        stutter: every > 0 ? { every, hold } : null,
      },
    );
    windows.length = result.sent ?? windows.length;
  } else if (mode === "file") {
    const served = join(servedDir, `whole${extname(video)}`);
    result = await page.evaluate(
      ({ url, model }) => window.transcribeFile(url, model),
      { url: "/" + served.replace(/^public\//, ""), model: model === "auto" ? "onnx-community/whisper-tiny" : model },
    );
    windows.length = 1;
  } else result = await page.evaluate(
    ({ windows, settings }) => window.replay(windows, settings),
    {
      windows,
      settings: { model, language: "auto", window: windowS, overlay: false, fontScale: 1, backend: "auto" },
    },
  );
} catch (e) {
  fails.push(e.message.split("\n")[0]);
} finally {
  if (browser) await browser.close();
  await vite.close();
  rmSync(servedDir, { recursive: true, force: true });
  if (ownVad) rmSync(vadDir, { recursive: true, force: true });
}

if (result) {
  console.log(`  notes: ${result.notes.join(" / ")}`);
  if (result.failure) fails.push(`engine reported: ${result.failure}`);
  if (result.finished < windows.length) fails.push(`${windows.length - result.finished} windows never came back`);
  const SCRIPTS = {
    ko: /\p{sc=Hangul}/u,
    ja: /[\p{sc=Hiragana}\p{sc=Katakana}]/u,
    zh: /\p{sc=Han}/u,
  };
  const foreign = [];
  if (expect && SCRIPTS[expect]) {
    for (const c of result.cues) {
      if (!SCRIPTS[expect].test(c.text)) foreign.push(c);
    }
  } else if (expect === "en") {
    for (const c of result.cues) {
      if (/[^\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}]/u.test(c.text)) foreign.push(c);
    }
  }
  console.log(`  lines: ${result.cues.length}, not in the expected language: ${foreign.length}`);
  for (const c of foreign) console.log(`    ${c.start.toFixed(1)}s  ${JSON.stringify(c.text)}`);
  if (expect && foreign.length) fails.push(`${foreign.length} of ${result.cues.length} lines are not in ${expect}`);
  if (!result.cues.length) fails.push("no lines came back");
  const out = flag("--json", "");
  if (out) writeFileSync(out, JSON.stringify({ video: basename(video), engine: engineName, model, stalls, windows: windows.length, ...result, foreign }, null, 2));
}

console.log(fails.length ? `\n${fails.length} failed` : "\nall checks passed");
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
