// The three videos the defect report came from.
//
// The synthetic suite in `languages.mjs` answers "does the logic hold on
// video it was not tuned for". It cannot answer "is the reported bug
// gone", because it has no music beds, no room tone and no real speakers.
// This runs the actual files.
//
// It reports rather than asserts, mostly. There is no ground truth for a
// real recording -- nobody has typed out what is said in these three
// videos -- so what can be counted honestly is the *shape* of the four
// reported defects:
//
//   1. text after the speech ends
//   2. Traditional and Simplified alternating inside one file
//   3. a line that is the line before it
//   4. a line in a script the language does not use
//
// Each is measured the same way before and after a change, so the numbers
// are comparable even though none of them is an absolute score.
//
//   npm run build
//   node e2e/videos.mjs --label after ~/Downloads/zh.mp4 ...
//   node e2e/videos.mjs --label before ...   (with the change reverted)
//
// Output lands in e2e/video-results/<label>/, so two runs can be diffed.

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isSignOff, stutterOf, scriptsIn, bare } from "../src/lib/cleanup.ts";
import { TS_PAIRS } from "../src/lib/hanzi.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "../dist");
const REPO = resolve(HERE, "../../..");
const PLAYWRIGHT = "playwright";

const args = process.argv.slice(2);
const labelAt = args.indexOf("--label");
const label = labelAt >= 0 ? args[labelAt + 1] : "run";
const videos = args.filter((a, i) => !a.startsWith("--") && i !== labelAt + 1 && i !== args.indexOf("--model") + 1);
if (videos.length === 0) {
  console.error("usage: node e2e/videos.mjs [--label name] video.mp4 ...");
  process.exit(2);
}
// APP-32: the same clip through a different model, to answer "would Small
// fix this" with the clip that raised the question rather than a fixture.
const modelAt = args.indexOf("--model");
const MODEL = modelAt >= 0 ? args[modelAt + 1] : "";

const outDir = join(HERE, "video-results", label);
await mkdir(outDir, { recursive: true });

// --- what counts as Traditional -----------------------------------------

const TRADITIONAL = new Set();
const SIMPLIFIED = new Set();
for (let i = 0; i + 1 < TS_PAIRS.length; i += 2) {
  const [t, s] = [TS_PAIRS[i], TS_PAIRS[i + 1]];
  if (t !== s) {
    TRADITIONAL.add(t);
    SIMPLIFIED.add(s);
  }
}
// A handful of characters are on both sides of the table; they settle
// nothing, so they are counted as neither.
for (const ch of [...TRADITIONAL].filter((c) => SIMPLIFIED.has(c))) {
  TRADITIONAL.delete(ch);
  SIMPLIFIED.delete(ch);
}

/** Which Chinese script a line is written in, or null if it does not say. */
function chineseScript(text) {
  let t = 0;
  let s = 0;
  for (const ch of text) {
    if (TRADITIONAL.has(ch)) t += 1;
    else if (SIMPLIFIED.has(ch)) s += 1;
  }
  if (t === 0 && s === 0) return null;
  return t > s ? "T" : s > t ? "S" : null;
}

// --- where the speech stops ---------------------------------------------

/**
 * The last moment anything is above the noise floor.
 *
 * This finds the end of *sound*, not the end of speech: a music bed under
 * the credits counts. That is deliberate -- it is the conservative edge,
 * so a cue past it is unambiguously text over nothing.
 */
function soundEnds(path, duration) {
  const out = spawnSync("ffmpeg", [
    "-v", "info", "-i", path, "-af", "silencedetect=noise=-40dB:d=1.5", "-f", "null", "-",
  ]);
  const log = out.stderr.toString();
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  if (starts.length === 0) return duration;
  const last = starts[starts.length - 1];
  // A silence that never ends runs to the end of the file.
  return ends.length < starts.length ? last : duration;
}

function duration(path) {
  const out = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path,
  ]);
  return Number(out.stdout.toString().trim());
}

// --- the app -------------------------------------------------------------

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2",
  ".otf": "font/otf", ".webm": "video/webm", ".mp4": "video/mp4",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path === "/" ? "/index.html" : path;
    try {
      const body = await readFile(join(root, file));
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, () => ok(server)));
}

function parseSrt(text) {
  const cues = [];
  for (const block of text.trim().split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const times = /(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/.exec(lines[1] ?? "");
    if (!times) continue;
    const at = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    cues.push([
      at(times[1], times[2], times[3], times[4]),
      at(times[5], times[6], times[7], times[8]),
      lines.slice(2).join(" "),
    ]);
  }
  return cues;
}

const clock = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}`;

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/ is missing -- run `npm run build` first.");
  process.exit(2);
}

const server = await serve(DIST);
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(PLAYWRIGHT);
const browser = await chromium.launch();

const report = {};

for (const video of videos) {
  const name = basename(video, extname(video));
  console.log(`\n=== ${name}`);
  const total = duration(video);
  const sound = soundEnds(video, total);
  console.log(`  ${total.toFixed(0)}s of video, sound ends at ${clock(sound)}`);

  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(base);
  await page.waitForSelector('input[accept="video/*"]', { state: "attached", timeout: 30000 });
  await page.setInputFiles('input[accept="video/*"]', video);
  await page.waitForFunction(
    () => document.querySelector(".file-meta")?.textContent?.includes("×"),
    { timeout: 120000 },
  );
  if (MODEL) {
    // The Subtitles card holds more than one <select>; pick the one whose
    // options name model sizes rather than languages.
    const selects = page.locator('.card:has-text("Subtitles") select');
    for (let i = 0; i < (await selects.count()); i += 1) {
      const options = await selects.nth(i).locator("option").allTextContents();
      if (options.some((o) => /MB/.test(o))) {
        const wanted = options.find((o) => new RegExp(MODEL, "i").test(o));
        if (wanted) await selects.nth(i).selectOption({ label: wanted });
        break;
      }
    }
  }
  const began = Date.now();
  await page.locator('button:has-text("Generate from the audio")').click();
  const outcome = await Promise.race([
    page.waitForSelector(".cue", { timeout: 3600000 }).then(() => "cues"),
    page
      .waitForSelector('.card:has-text("Subtitles") .field-error', { timeout: 3600000 })
      .then(() => "error"),
  ]).catch(() => "timeout");
  if (outcome !== "cues") {
    const message = outcome === "error"
      ? (await page.textContent('.card:has-text("Subtitles") .field-error')).trim()
      : "timed out";
    console.log(`  FAILED: ${message}`);
    await context.close();
    continue;
  }
  const took = (Date.now() - began) / 1000;

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('button:has-text(".srt")').click(),
  ]);
  const srt = join(outDir, `${name}.srt`);
  await download.saveAs(srt);
  await context.close();

  const cues = parseSrt(await readFile(srt, "utf8"));
  const covered = cues.reduce((n, [a, b]) => n + (b - a), 0);

  // 1. text after the sound stops
  const past = cues.filter(([from]) => from > sound + 0.5);

  // 2. the model's own boilerplate and loops, anywhere in the file
  const signOffs = cues.filter(([, , text]) => isSignOff(text));
  const stutters = cues.filter(([, , text]) => stutterOf(text));

  // 3. a line that is the line before it
  const repeats = [];
  for (let i = 1; i < cues.length; i += 1) {
    if (bare(cues[i][2]) && bare(cues[i][2]) === bare(cues[i - 1][2])) repeats.push(cues[i]);
  }

  // 4. scripts that turned up, and Chinese script consistency
  const scripts = new Map();
  for (const [, , text] of cues) {
    for (const script of scriptsIn(text)) scripts.set(script, (scripts.get(script) ?? 0) + 1);
  }
  let traditional = 0;
  for (const [, , text] of cues) for (const ch of text) if (TRADITIONAL.has(ch)) traditional += 1;
  const written = cues.map(([, , text]) => chineseScript(text)).filter(Boolean);
  let switches = 0;
  for (let i = 1; i < written.length; i += 1) if (written[i] !== written[i - 1]) switches += 1;

  const found = {
    cues: cues.length,
    seconds: total,
    soundEnds: sound,
    covered,
    took,
    past: past.map(([f, , t]) => `${clock(f)} ${t}`),
    signOffs: signOffs.map(([f, , t]) => `${clock(f)} ${t}`),
    stutters: stutters.map(([f, , t]) => `${clock(f)} ${t}`),
    repeats: repeats.map(([f, , t]) => `${clock(f)} ${t}`),
    scripts: Object.fromEntries(scripts),
    traditional,
    switches,
  };
  report[name] = found;

  console.log(`  ${cues.length} cues, ${covered.toFixed(0)}s captioned, ${took.toFixed(0)}s to generate`);
  console.log(`  scripts: ${[...scripts].map(([s, n]) => `${s} ${n}`).join(", ") || "none"}`);
  console.log(`  Traditional characters: ${traditional}, script changes between cues: ${switches}`);
  const show = (title, list) => {
    console.log(`  ${title}: ${list.length}`);
    for (const line of list.slice(0, 8)) console.log(`      ${line}`);
    if (list.length > 8) console.log(`      ... and ${list.length - 8} more`);
  };
  show("cues starting after the sound ends", found.past);
  show("stock sign-offs", found.signOffs);
  show("repeated-word loops", found.stutters);
  show("lines repeating the line before", found.repeats);
  console.log("  last three cues:");
  for (const [f, , t] of cues.slice(-3)) console.log(`      ${clock(f)} ${t}`);
}

await browser.close();
server.close();
await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nwritten to ${outDir}`);
