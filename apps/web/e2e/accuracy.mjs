// How accurate is the recogniser, in a number somebody can check.
//
// APP-34 asks for a comparison against BurnSub. A comparison needs both
// sides measured the same way, and until this existed neither side was
// measured at all — the product page said "accurate" and the llms.txt draft
// carried figures nobody could point at a run for.
//
// # Why synthesised speech, and what that costs
//
// Word error rate needs a reference transcript, and nobody has typed one
// out for a real video. Speech from `say` comes with its reference for
// free: the text that went in *is* the truth, exactly, with no annotator
// deciding whether a filler word counts.
//
// The price is that this audio is clean, evenly paced and free of the
// things that actually hurt a recogniser — accents, overlap, room noise,
// music underneath. **These numbers are a floor, not a field measurement.**
// Real footage will be worse. What they are good for is comparing two
// recognisers on identical audio, and comparing this build against the
// next one.
//
//   node e2e/accuracy.mjs            (after `npm run build`)
//   node e2e/accuracy.mjs --model small

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "../dist");
const REPO = resolve(HERE, "../../..");
const PLAYWRIGHT = "playwright";

const args = process.argv.slice(2);
const at = args.indexOf("--model");
const MODEL = at >= 0 ? args[at + 1] : "base";

const VOICES = { en: "Samantha", zh: "Tingting", ja: "Kyoko" };

// The reference. Spoken by `say`, so this is exactly what is in the audio.
const TRUTH = {
  en: "The rocket launch site sits on the southern coast of the island. Engineers say the location is efficient because it is close to the equator. Local businesses have started to build hotels for the visitors who come to watch.",
  zh: "这个发射基地位于海岛的南部海岸。工程师说这个位置很有效率，因为它靠近赤道。当地的商家已经开始建造酒店，接待前来观看发射的游客。",
  ja: "ロケットの発射場は島の南の海岸にあります。赤道に近いため効率が良いと技術者は話しています。地元の企業は見学に来る人のためにホテルを建て始めました。",
};

/** Punctuation and case are not what a recogniser is being judged on. */
function normalise(text, lang) {
  const stripped = text
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, lang === "en" ? " " : "")
    .trim();
  return lang === "en" ? stripped.toLowerCase() : stripped;
}

/** Levenshtein over an array of tokens: words for English, characters else. */
function distance(a, b) {
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j];
  }
  return prev[b.length];
}

const tokens = (text, lang) =>
  lang === "en" ? normalise(text, lang).split(" ").filter(Boolean) : [...normalise(text, lang)];

const dir = mkdtempSync(join(tmpdir(), "opensubs-acc-"));

function clip(lang) {
  const aiff = join(dir, `${lang}.aiff`);
  spawnSync("say", ["-v", VOICES[lang], "-o", aiff, TRUTH[lang]]);
  if (!existsSync(aiff)) return null;
  const wav = join(dir, `${lang}.wav`);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", aiff, "-af", "apad=pad_dur=0.6",
                       "-ar", "16000", "-ac", "1", wav]);
  const out = join(dir, `${lang}.webm`);
  spawnSync("ffmpeg", ["-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x203040:size=320x180:rate=5:duration=60",
    "-i", wav, "-c:v", "libvpx-vp9", "-b:v", "60k", "-cpu-used", "8",
    "-deadline", "realtime", "-c:a", "libopus", "-b:a", "48k", "-shortest", out]);
  return existsSync(out) ? out : null;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".woff2": "font/woff2",
  ".otf": "font/otf", ".webm": "video/webm", ".png": "image/png", ".svg": "image/svg+xml",
  ".txt": "text/plain", ".xml": "application/xml", ".ico": "image/x-icon" };

function serve(root) {
  const s = createServer(async (req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = u === "/" ? "/index.html" : u;
    try {
      const b = await readFile(join(root, f));
      res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
      res.end(b);
    } catch { res.writeHead(404).end("nf"); }
  });
  return new Promise((ok) => s.listen(0, () => ok(s)));
}

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/ is missing — run `npm run build` first.");
  process.exit(2);
}

const server = await serve(DIST);
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(PLAYWRIGHT);
const browser = await chromium.launch();

console.log(`model: ${MODEL}\n`);
console.log("lang  unit  ref  errors  rate    seconds");
const rows = [];
for (const lang of ["en", "zh", "ja"]) {
  const video = clip(lang);
  if (!video) { console.log(`${lang}: fixture failed`); continue; }

  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(base);
  await page.waitForSelector('input[accept="video/*"]', { state: "attached", timeout: 30000 });
  await page.setInputFiles('input[accept="video/*"]', video);
  await page.waitForFunction(
    () => document.querySelector(".file-meta")?.textContent?.includes("×"), { timeout: 60000 });
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
  const began = Date.now();
  await page.locator('button:has-text("Generate from the audio")').click();
  const ok = await page.waitForSelector(".cue", { timeout: 1_800_000 }).then(() => true).catch(() => false);
  const took = (Date.now() - began) / 1000;
  if (!ok) { console.log(`${lang}: no subtitles`); await ctx.close(); continue; }

  // `.cue-text` is a <textarea>, so its text is its `value` and never its
  // text content -- `allTextContents()` returns a row of empty strings and
  // every word scores as an error. The first run of this harness reported
  // 100% WER for a transcript that was on screen and correct.
  const said = (
    await page.locator(".cue-text").evaluateAll((els) =>
      els.map((el) => (el instanceof HTMLTextAreaElement ? el.value : el.textContent ?? "")),
    )
  ).join(" ");
  await ctx.close();

  const ref = tokens(TRUTH[lang], lang);
  const got = tokens(said, lang);
  const errors = distance(ref, got);
  const rate = errors / ref.length;
  rows.push({ lang, unit: lang === "en" ? "WER" : "CER", ref: ref.length, errors, rate, took });
  console.log(`${lang}    ${lang === "en" ? "WER" : "CER"}   ${String(ref.length).padStart(3)}  ${String(errors).padStart(6)}  ${(rate * 100).toFixed(1).padStart(5)}%  ${took.toFixed(0).padStart(6)}`);
}

await browser.close();
server.close();
if (!args.includes("--keep")) rmSync(dir, { recursive: true, force: true });
console.log(`\n${JSON.stringify({ model: MODEL, rows }, null, 2)}`);
