// When the first subtitle appears, and how many lines a Shorts subtitle
// takes on a vertical video -- measured on real recordings through the
// built app, the way a person would get them: transcribe in the page, pick
// the look, download the .srt and .ass, and draw the .ass onto the video's
// own frames with ffmpeg's libass.
//
// What it pins:
//   1. A clip that opens on ten seconds of silence: the first subtitle
//      starts within 0.5 s of the voice, and nothing is on screen during
//      the silence. (The page used to time the first sentence from 0.0 s.)
//   2. Tears of Steel, 0-90 s: nothing over the music before the first
//      line of dialogue (the page wrote "TNR TNR 3rd Street NJ 413" there),
//      and that line within 0.5 s of its voice. (The launch countdown
//      before the music is speech too; see the note where it is checked.)
//   3. The Shorts look on a 1080x1920 clip: no subtitle drawn on more than
//      two lines. (It drew one on six.)
//
// The media are not in the repository. Tears of Steel is CC-BY, from
// https://download.blender.org/demo/movies/ToS/; any recording of speech
// will do for the other two (the vertical clip needs continuous speech).
//
//   npm run build
//   node e2e/onset-and-frame.mjs --speech speech.wav --tos tos-0-90.mp4 --vertical vertical-1080x1920.mp4
//
// Runs on the GPU through Chromium's new headless mode; CPU-only takes
// tens of minutes for the film clip.

import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(HERE, "..", "dist");
const args = process.argv.slice(2);
const arg = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};
const speech = arg("speech");
const tos = arg("tos");
const vertical = arg("vertical");
if (!speech && !tos && !vertical) {
  console.error("usage: node e2e/onset-and-frame.mjs [--speech file] [--tos file] [--vertical file]");
  process.exit(2);
}

const work = await mkdtemp(join(tmpdir(), "opensubs-onset-"));
const ff = (...a) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...a]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r;
};

/** The first moment, in seconds, a 20 ms frame of `file` is louder than -35 dBFS. */
function onset(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 1);
  const n = 320;
  for (let i = 0; i + n <= pcm.length; i += n) {
    let sum = 0;
    for (let k = i; k < i + n; k += 1) sum += (pcm[k] / 32768) ** 2;
    if (20 * Math.log10(Math.sqrt(sum / n) + 1e-9) > -35) return i / 16000;
  }
  return null;
}

/**
 * Text lines libass draws on `video` at `t` with `ass`: bands of pixels that
 * turn white only when the subtitles are drawn. The same frame is grabbed
 * without them, so a bright sky or a white shirt is never counted as text.
 */
function linesDrawn(video, ass, t) {
  const grab = (filter) =>
    spawnSync(
      "ffmpeg",
      ["-v", "error", "-ss", String(t), "-copyts", "-i", video, "-vf", `${filter}setpts=PTS-STARTPTS,scale=540:-2`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
      { maxBuffer: 1 << 26 },
    ).stdout;
  const drawn = grab(`ass=${ass},`);
  const plain = grab("");
  const w = 540;
  const h = drawn.length / w;
  let bands = 0;
  let run = 0;
  for (let y = 0; y < h; y += 1) {
    let text = 0;
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (drawn[i] > 235 && drawn[i] - plain[i] > 40) text += 1;
    }
    if (text > 6) run += 1;
    else {
      if (run > h * 0.02) bands += 1;
      run = 0;
    }
  }
  return bands;
}

function parseSrt(text) {
  return text
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const m = /(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)/.exec(block);
      if (!m) return null;
      const t = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
      return { start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: block.split(/\r?\n/).slice(2).join(" ") };
    })
    .filter(Boolean);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2", ".otf": "font/otf", ".json": "application/json", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path === "/" ? "/index.html" : path;
  try {
    const body = await readFile(join(DIST, file));
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: "chromium" });

/** Transcribe `clip` in the page; optionally pick a preset; return the .srt and .ass. */
async function run(clip, style) {
  const context = await browser.newContext({ locale: "en-US", acceptDownloads: true, viewport: { width: 1200, height: 1000 } });
  // Never count a test as a visitor.
  await context.route(/umami|\/api\/send/, (r) => r.abort());
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector('input[accept="video/*"]', { state: "attached", timeout: 60000 });
  await page.setInputFiles('input[accept="video/*"]', clip);
  await page.waitForFunction(() => document.querySelector(".file-meta")?.textContent?.includes("×"), { timeout: 120000 });
  await page.locator('button:has-text("Generate from the audio")').click();
  const outcome = await Promise.race([
    page.waitForSelector(".cue", { timeout: 1800000 }).then(() => "cues"),
    page.waitForSelector(".no-speech", { timeout: 1800000 }).then(() => "no speech found"),
    page.waitForSelector('.card:has-text("Subtitles") .field-error', { timeout: 1800000 }).then(async (e) => (await e.textContent()).trim()),
  ]);
  if (outcome !== "cues") throw new Error(`no subtitles for ${clip}: ${outcome}`);
  if (style) {
    await page.locator('[role="tab"]:has-text("Style")').click();
    await page.locator('label:has-text("Preset") select').selectOption(style);
    await page.waitForTimeout(300);
  }
  await page.locator('[role="tab"]:has-text("Export")').click();
  const out = {};
  for (const ext of ["srt", "ass"]) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(`button:text-is(".${ext}")`).first().click()]);
    out[ext] = join(work, `${Date.now()}.${ext}`);
    await dl.saveAs(out[ext]);
  }
  await context.close();
  return out;
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

if (speech) {
  console.log("ten seconds of silence, then speech");
  const clip = join(work, "silence-then-speech.mp4");
  ff("-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-i", speech, "-f", "lavfi", "-i", "color=c=0x1e2836:s=640x360:r=30",
    "-filter_complex", "[0:a]atrim=0:10[s];[s][1:a]concat=n=2:v=0:a=1[a]", "-map", "2:v", "-map", "[a]", "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", clip);
  const voice = onset(clip);
  const cues = parseSrt(await readFile((await run(clip)).srt, "utf8"));
  const first = cues[0]?.start ?? NaN;
  check("the voice starts after the silence", voice > 9.9, `${voice?.toFixed(2)} s`);
  check("the first subtitle starts within 0.5 s of the voice", Math.abs(first - voice) <= 0.5, `first ${first.toFixed(2)} s, voice ${voice.toFixed(2)} s`);
  check("nothing on screen during the silence", cues.every((c) => c.start >= voice - 0.5));
}

if (tos) {
  console.log("Tears of Steel, 0-90 s");
  const cues = parseSrt(await readFile((await run(tos)).srt, "utf8"));
  const jerk = cues.find((c) => /jerk/i.test(c.text));
  // The intro's launch countdown (a real voice, about 4.7-10 s) is not
  // checked for its start: the browser's voice detector scores the logo
  // sound before it as speech, and the page shows the countdown from about
  // 1.4 s. The desktop, which can align words, puts it at 4.8 s.
  check("nothing over the music from 11 to 22 s", cues.every((c) => c.start < 11 || c.start >= 22.5), cues.filter((c) => c.start >= 11 && c.start < 22.5).map((c) => c.text).join(" | "));
  // The voice starts at 23.3 s by whisper.cpp's word alignment; the film's
  // own subtitle file puts the line at 23.0 s.
  check("the first line of dialogue within 0.5 s of its voice (23.3 s)", !!jerk && Math.abs(jerk.start - 23.3) <= 0.5, jerk ? `${jerk.start.toFixed(2)} s` : "not found");
}

if (vertical) {
  console.log("Shorts on a 1080x1920 clip");
  const { ass } = await run(vertical, "Shorts");
  // Every subtitle the .ass draws, at the middle of its time on screen.
  const events = [...(await readFile(ass, "utf8")).matchAll(/^Dialogue: \d+,(\d+):(\d+):([\d.]+),(\d+):(\d+):([\d.]+),/gm)].map(
    (m) => [+m[1] * 3600 + +m[2] * 60 + +m[3], +m[4] * 3600 + +m[5] * 60 + +m[6]],
  );
  let worst = 0;
  for (const [a, b] of events) worst = Math.max(worst, linesDrawn(vertical, ass, (a + b) / 2));
  check("no subtitle is drawn on more than two lines", events.length > 0 && worst <= 2, `most lines drawn: ${worst}, over ${events.length} subtitles`);
}

await browser.close();
server.close();
await rm(work, { recursive: true, force: true });
console.log(failures === 0 ? "\nall green" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
