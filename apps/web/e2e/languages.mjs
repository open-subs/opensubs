// Does language detection work on video that is not the one video it was
// fixed for?
//
// Every constant in `languageRuns` was chosen against a single bilingual
// news clip: how short a stretch of one language can be and still be
// found, how far a boundary may be from where the grid put it, how much
// quieter a frame has to be to count as the pause between speakers. Fixed
// that way, they describe that clip. Whether they describe *video* is a
// different question and this is what asks it.
//
// The fixtures are synthesised, and the point of synthesising them is that
// the answer is known exactly: each stretch is spoken by a named voice and
// its true length is measured after the fact, so "what fraction of this
// video is captioned in a language nobody is speaking" is arithmetic
// rather than judgement. A truth map read out of Whisper -- which is how
// the news clip was scored -- cannot catch an error Whisper makes
// consistently.
//
// What this cannot tell you: synthesised speech is clean, evenly paced and
// has no music under it. It exercises the *logic* -- where a change is
// found, whether a stretch is lost, whether a language leaks into its
// neighbour -- and not robustness to real noise. Both matter; only one of
// them fits in a test.
//
// Run: node e2e/languages.mjs          (after `npm run build`)
//      node e2e/languages.mjs --keep   to leave the fixtures on disk

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "../dist");
const REPO = resolve(HERE, "../../..");
const PLAYWRIGHT = "playwright";

const VOICES = {
  en: "Samantha",
  zh: "Tingting",
  ja: "Kyoko",
};

/** Roughly fifteen seconds of speech each, so a span can be cut to length. */
const LINES = {
  en: "The rocket launch site sits on the southern coast of the island. Engineers say the location is efficient because it is close to the equator. Local businesses have started to build hotels for the visitors who come to watch.",
  zh: "这个发射基地位于海岛的南部海岸。工程师说这个位置很有效率，因为它靠近赤道。当地的商家已经开始建造酒店，接待前来观看发射的游客。",
  ja: "ロケットの発射場は島の南の海岸にあります。赤道に近いため効率が良いと技術者は話しています。地元の企業は見学に来る人のためにホテルを建て始めました。",
};

const FIXTURES = [
  // The common case, which none of this machinery should disturb.
  { name: "english only", spans: [["en", 40]] },
  { name: "chinese only", spans: [["zh", 40]] },
  // Two long halves: the shape the original fix was measured on.
  { name: "one change", spans: [["en", 25], ["zh", 25]] },
  // Short inserts, which is what a news package actually looks like and
  // what ten-second cells could not see at all.
  { name: "short inserts", spans: [["en", 20], ["zh", 9], ["en", 8], ["zh", 14], ["en", 10]] },
  // Not Chinese: the same logic, a script with no relationship to either.
  { name: "english and japanese", spans: [["en", 18], ["ja", 12], ["en", 12]] },
  // Nothing to hear, and so nothing to write. Whisper is generative: over
  // silence it emits the boilerplate its training subtitles ended with --
  // "you you you", "Thanks for watching!", a Korean news sign-off in a
  // Chinese clip. Twelve seconds of digital silence is the one part of
  // this that a synthesised fixture can test honestly, because silence
  // synthesises exactly.
  { name: "silent tail", spans: [["en", 25]], silence: 12 },
];

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "opensubs-lang-"));

/** Seconds of audio in a file, from ffprobe. */
function duration(path) {
  const out = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path,
  ]);
  return Number(out.stdout.toString().trim());
}

/**
 * Speak one stretch, trimmed to at most `seconds`, and report how long it
 * actually came out. Intent is not truth: `say` decides the pace.
 */
function speak(lang, seconds, index) {
  const aiff = join(dir, `${lang}-${index}.aiff`);
  // Repeated so there is always more speech than the span asks for; the
  // span is then cut to length and its *actual* duration measured.
  spawnSync("say", ["-v", VOICES[lang], "-o", aiff, LINES[lang].repeat(4)]);
  if (!existsSync(aiff)) return null;
  const wav = join(dir, `${lang}-${index}.wav`);
  // A short gap after each stretch: speakers do not change mid-breath, and
  // a cut wants somewhere to land.
  spawnSync("ffmpeg", [
    "-v", "error", "-y", "-i", aiff, "-t", String(seconds),
    "-af", "apad=pad_dur=0.4", "-ar", "16000", "-ac", "1", wav,
  ]);
  return existsSync(wav) ? { path: wav, seconds: duration(wav) } : null;
}

function buildFixture(fixture) {
  const parts = [];
  const truth = [];
  let at = 0;
  for (const [i, [lang, seconds]] of fixture.spans.entries()) {
    const part = speak(lang, seconds, i);
    if (!part) return null;
    parts.push(part.path);
    truth.push({ from: at, to: at + part.seconds, lang });
    at += part.seconds;
  }
  const speech = at;
  if (fixture.silence) {
    const quiet = join(dir, `${fixture.name.replace(/\W+/g, "-")}-silence.wav`);
    spawnSync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
      "-t", String(fixture.silence), quiet,
    ]);
    if (!existsSync(quiet)) return null;
    parts.push(quiet);
    at += fixture.silence;
  }
  const list = join(dir, `${fixture.name.replace(/\W+/g, "-")}.txt`);
  spawnSync("bash", ["-c", `printf "file '%s'\\n" ${parts.map((p) => `'${p}'`).join(" ")} > '${list}'`]);
  const audio = join(dir, `${fixture.name.replace(/\W+/g, "-")}.wav`);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", audio]);
  const clip = join(dir, `${fixture.name.replace(/\W+/g, "-")}.webm`);
  spawnSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0x203040:size=320x180:rate=5:duration=${Math.ceil(at) + 1}`,
    "-i", audio,
    "-c:v", "libvpx-vp9", "-b:v", "60k", "-cpu-used", "8", "-deadline", "realtime",
    "-c:a", "libopus", "-b:a", "48k", "-shortest", clip,
  ]);
  // `seconds` is speech, not runtime: coverage is judged against what was
  // said, and any silence appended after it is not something to caption.
  return existsSync(clip) ? { clip, truth, seconds: speech } : null;
}

/** Which script a cue is written in, which is what a viewer sees. */
function scriptOf(text) {
  let han = 0;
  let kana = 0;
  let latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) kana += 1;
    else if (cp >= 0x4e00 && cp <= 0x9fff) han += 1;
    else if (/[a-z]/i.test(ch)) latin += 1;
  }
  if (kana > 0) return "ja";
  if (han > latin) return "zh";
  return latin > 0 ? "en" : null;
}

/**
 * Two quite different failures, counted separately.
 *
 * A cue that spans a language change carries a few words of both, and
 * some of it is always in the "wrong" language however well the change is
 * placed -- that is the cost of a cue being a unit of time. A stretch in
 * the middle of one speaker's turn coming out in another language is not
 * that; it is the failure this whole mechanism exists to prevent. Counting
 * them together hides the second behind the first.
 */
function scoreAgainst(truth, cues) {
  const languageAt = (t) => truth.find((span) => t >= span.from && t < span.to)?.lang ?? null;
  const changes = truth.slice(1).map((span) => span.from);
  const nearChange = (t) => changes.some((at) => Math.abs(t - at) <= SEAM_S);
  let seam = 0;
  let stranded = 0;
  let judged = 0;
  for (const [from, to, text] of cues) {
    const wrote = scriptOf(text);
    if (!wrote) continue;
    const steps = Math.max(1, Math.round((to - from) / 0.25));
    const each = (to - from) / steps;
    for (let i = 0; i < steps; i += 1) {
      const at = from + (i + 0.5) * each;
      const spoken = languageAt(at);
      if (!spoken) continue;
      judged += each;
      // Japanese written in Han characters only is Chinese to this test
      // and to a reader, so it counts as wrong; kana settles it either way.
      if (spoken !== wrote) {
        if (nearChange(at)) seam += each;
        else stranded += each;
      }
    }
  }
  return { seam, stranded, judged };
}

/** How close to a language change still counts as the seam. */
const SEAM_S = 3;

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2",
  ".otf": "font/otf", ".webm": "video/webm",
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

if (spawnSync("say", ["-v", "?"]).status !== 0) {
  console.log("SKIPPED: this needs macOS `say` for the voices");
  process.exit(0);
}
if (!existsSync(DIST)) {
  console.error("cannot run: build dist first, and and `npm install` in apps/web");
  process.exit(1);
}

const server = await serve(DIST);
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(PLAYWRIGHT);
const browser = await chromium.launch();

/** How much of a fixture may be captioned in the wrong language. */
const ALLOWED_WRONG = 0.12;

for (const fixture of FIXTURES) {
  console.log(`\n${fixture.name}`);
  const built = buildFixture(fixture);
  if (!built) {
    check(`${fixture.name}: fixture built`, false, "ffmpeg or say failed");
    continue;
  }

  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(base);
  await page.waitForSelector('input[accept="video/*"]', { state: "attached", timeout: 30000 });
  await page.setInputFiles('input[accept="video/*"]', built.clip);
  await page.waitForFunction(
    () => document.querySelector(".file-meta")?.textContent?.includes("×"),
    { timeout: 60000 },
  );
  // Left on "Detect it", because that is what someone with a new video has.
  await page.locator('button:has-text("Generate from the audio")').click();
  const outcome = await Promise.race([
    page.waitForSelector(".cue", { timeout: 1800000 }).then(() => "cues"),
    page.waitForSelector('.card:has-text("Subtitles") .field-error', { timeout: 1800000 }).then(() => "error"),
  ]).catch(() => "timeout");

  if (outcome !== "cues") {
    const message = outcome === "error"
      ? (await page.textContent('.card:has-text("Subtitles") .field-error')).trim()
      : "timed out";
    check(`${fixture.name}: produced subtitles`, false, message);
    await context.close();
    continue;
  }

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('button:has-text(".srt")').click(),
  ]);
  const srt = join(dir, `${fixture.name.replace(/\W+/g, "-")}.srt`);
  await download.saveAs(srt);
  const cues = parseSrt(await readFile(srt, "utf8"));
  const { seam, stranded, judged } = scoreAgainst(built.truth, cues);
  const share = judged > 0 ? stranded / judged : 1;
  const covered = cues.reduce((n, [a, b]) => n + (b - a), 0);

  console.log(
    `  ${cues.length} cues, ${covered.toFixed(0)}s of ${built.seconds.toFixed(0)}s covered, ` +
      `${stranded.toFixed(1)}s stranded in the wrong language (${(share * 100).toFixed(0)}%), ` +
      `${seam.toFixed(1)}s at the seams`,
  );
  check(
    `${fixture.name}: at most ${ALLOWED_WRONG * 100}% of speech stranded in the wrong language`,
    share <= ALLOWED_WRONG,
    `${(share * 100).toFixed(0)}%`,
  );
  if (fixture.silence) {
    const late = cues.filter(([from]) => from > built.seconds + 1);
    check(
      `${fixture.name}: nothing is captioned over the silence`,
      late.length === 0,
      late.map(([from, , text]) => `${from.toFixed(1)}s "${text}"`).join(", "),
    );
  }
  check(
    `${fixture.name}: most of the speech got a subtitle`,
    covered > built.seconds * 0.6,
    `${covered.toFixed(0)}s of ${built.seconds.toFixed(0)}s`,
  );
  await context.close();
}

await browser.close();
server.close();
if (!process.argv.includes("--keep")) rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 1 && 0 : 1);
