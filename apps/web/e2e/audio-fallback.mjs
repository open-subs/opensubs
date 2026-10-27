// Can a clip's audio be read where WebCodecs has no AudioDecoder?
//
// That is iOS 18's WebKit -- WebCodecs for video only -- and Firefox for
// Android. There the app falls back to Web Audio's `decodeAudioData`,
// and WebKit's refuses QuickTime outright: every `.mov`, which is every
// video an iPhone records, came back "No audio could be decoded from that
// clip" while the same AAC in an `.mp4` decoded. So a video could be
// picked, opened and played, and then never transcribed.
//
// Each browser runs twice: once as it is, and once with the WebCodecs
// audio classes deleted before the page loads, which is the browser iOS 18
// gives the app. Both must read the same seconds of audio, whole and
// trimmed, from every clip.
//
//   node e2e/audio-fallback.mjs                 (WebKit, Chromium, Firefox)
//   BROWSERS=webkit node e2e/audio-fallback.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import * as playwright from "playwright";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function ff(args) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

/** The audio's length; WebM keeps it on the container, not the stream. */
function audioSeconds(path) {
  for (const entry of ["stream=duration", "format=duration"]) {
    const r = spawnSync("ffprobe", [
      "-v", "error", "-select_streams", "a:0", "-show_entries", entry, "-of", "csv=p=0", path,
    ]);
    const seconds = Number(String(r.stdout).trim());
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return NaN;
}

function fixtures() {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return null;
  const dir = mkdtempSync(join(tmpdir(), "opensubs-audio-"));
  // Real speech where `say` exists, a tone elsewhere: what is measured is
  // how many seconds come back and that they are not silent.
  const speech = join(dir, "speech.aiff");
  const said = spawnSync("say", ["-v", "Samantha", "-o", speech,
    "Subtitles from the audio of a video recorded on a phone. " +
    "The second sentence is here so the clip runs past ten seconds."]).status === 0;
  const audio = said ? ["-i", speech] : ["-f", "lavfi", "-i", "sine=frequency=440:duration=10"];
  const picture = ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30"];
  const hevc = spawnSync("ffmpeg", ["-hide_banner", "-encoders"]).stdout.toString().includes("hevc_videotoolbox")
    ? ["-c:v", "hevc_videotoolbox", "-tag:v", "hvc1"]
    : ["-c:v", "libx265", "-tag:v", "hvc1"];
  const out = {
    // What an iPhone records: HEVC and AAC in a QuickTime file.
    "clip-hevc.mov": [...picture, ...audio, "-shortest", ...hevc, "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mov"],
    // What iOS hands a web page from the photo library: H.264, still QuickTime.
    "clip-h264.mov": [...picture, ...audio, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mov"],
    // The control, which always worked.
    "clip.mp4": [...picture, ...audio, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"],
    // One click at exactly 3 s and silence elsewhere, to say whether the
    // audio comes back where it belongs. A decoder that drops AAC priming
    // the copy does not account for moves every subtitle early.
    "click.mov": ["-f", "lavfi", "-i", "aevalsrc='if(between(t,3,3.01),sin(2*PI*1000*t),0)':s=44100:d=8",
      ...picture, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mov"],
    // For a Chromium without proprietary codecs, which cannot decode AAC.
    "clip-opus.webm": [...picture, ...audio, "-shortest", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus"],
  };
  const made = {};
  for (const [name, args] of Object.entries(out)) {
    const path = join(dir, name);
    ff([...args, path]);
    made[name] = { path, seconds: audioSeconds(path) };
  }
  return made;
}

const clips = fixtures();
if (!clips) {
  console.error("cannot run: ffmpeg is missing");
  process.exit(1);
}

// Which clips each engine can decode at all. Playwright's Chromium has no
// AAC, so it gets the Opus clip; the point of the suite is WebKit.
const CLIPS_FOR = {
  webkit: ["clip-hevc.mov", "clip-h264.mov", "clip.mp4", "click.mov"],
  firefox: ["clip-hevc.mov", "clip-h264.mov", "clip.mp4", "click.mov", "clip-opus.webm"],
  chromium: ["clip-opus.webm"],
};

const server = await createServer({
  root: ROOT,
  logLevel: "error",
  server: { port: 0, host: "127.0.0.1" },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const HARNESS = new URL("e2e/audioharness/index.html", base).href;

// Delete what iOS 18 does not have. Run before any page script.
const IOS18 = `for (const k of ["AudioDecoder", "AudioEncoder", "AudioData", "EncodedAudioChunk"]) {
  try { delete globalThis[k]; } catch {}
}`;

const TOLERANCE = 0.06; // seconds; an AAC frame is 23 ms, and the copy starts on one
const CLICK_AT = 3;
const CLICK_TOLERANCE = 0.02; // the WebCodecs path itself lands within 5 ms
let pass = 0;
const fails = [];
const wanted = (process.env.BROWSERS ?? "webkit,chromium,firefox").split(",");

try {
  for (const name of wanted) {
    const browser = await playwright[name].launch();
    try {
      for (const ios18 of [false, true]) {
        const context = await browser.newContext();
        if (ios18) await context.addInitScript(IOS18);
        const page = await context.newPage();
        await page.route("**/fixture/*", (route) => {
          const file = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
          const clip = clips[file];
          if (!clip) return route.fulfill({ status: 404 });
          return route.fulfill({ status: 200, body: readFileSync(clip.path), contentType: "application/octet-stream" });
        });
        await page.goto(HARNESS);
        await page.waitForFunction(() => document.getElementById("out")?.textContent === "ready", null, { timeout: 60_000 });
        const decoder = await page.evaluate(() => document.body.dataset.audioDecoder);
        const label = `${name}${ios18 ? " without AudioDecoder" : ""} (AudioDecoder: ${decoder})`;
        if (ios18 && decoder !== "undefined") {
          fails.push(`${label}: the AudioDecoder deletion did not take`);
          continue;
        }
        for (const file of CLIPS_FOR[name]) {
          const clip = clips[file];
          for (const [start, end] of [[0, null], [2, 6]]) {
            const expected = end == null ? clip.seconds : end - start;
            const got = await page.evaluate(
              ([url, s, e]) => window.extract(url, s, e),
              [new URL(`fixture/${file}`, base).href, start, end],
            );
            const click = file === "click.mov" ? CLICK_AT - start : null;
            const ok = got.ok && Math.abs(got.seconds - expected) <= TOLERANCE &&
              (click == null ? got.rms > 0.005 : Math.abs(got.peak - click) <= CLICK_TOLERANCE);
            const what = `${file} ${end == null ? "whole" : `${start}-${end}s`}`;
            const detail = got.ok
              ? `${got.seconds.toFixed(3)}s of ${expected.toFixed(3)}, ` +
                (click == null ? `rms ${got.rms.toFixed(3)}` : `click at ${got.peak.toFixed(4)}s, wanted ${click}`)
              : got.error;
            console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(48)} ${what.padEnd(24)} ${detail}`);
            if (ok) pass += 1;
            else fails.push(`${label} ${what}: ${detail}`);
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
