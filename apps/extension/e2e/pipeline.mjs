// Run the extension's capture-and-transcribe pipeline against a real video.
//
//   node e2e/pipeline.mjs [video] [--engine chromium|firefox]
//
// A vite dev server serves the harness so the modules are the same ones the
// extension bundles, imported the same way. The video is served from the
// same origin, because a cross-origin one without CORS taints the element
// and `captureStream` throws -- which is a real limitation of the product
// and is reported to the user, but is not what this test is measuring.
import { createServer as createViteServer } from "vite";
import { chromium, firefox } from "playwright";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { basename, resolve, join } from "node:path";

const args = process.argv.slice(2);
// `indexOf` returns -1 for a flag that was not passed, and args[-1 + 1] is
// args[0] -- which is the video path. Guard on presence, or every run
// without flags quietly transcribes the default file instead.
const FLAGS = ["--engine", "--model", "--language", "--window"];
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const engineName = flag("--engine", "chromium");
const model = flag("--model", "onnx-community/whisper-tiny.en");
const language = flag("--language", "en");
const flagValues = new Set(FLAGS.filter((f) => args.includes(f)).map((f) => args[args.indexOf(f) + 1]));
const video = resolve(args.find((a) => !a.startsWith("--") && !flagValues.has(a)) ?? "../../testdata/fixtures/web-sample.mp4");
if (!existsSync(video)) {
  console.error(`no such video: ${video}`);
  process.exit(1);
}

// vite serves `public/` at the root, and the harness page needs the video
// on its own origin.
mkdirSync("public/testmedia", { recursive: true });
const served = join("public/testmedia", basename(video));
copyFileSync(video, served);

const vite = await createViteServer({
  root: ".",
  // vite.config.ts turns publicDir off, because copy-static.mjs owns the
  // package's static files. The harness needs it back on: the video has to
  // come from the harness's own origin or captureStream taints on it.
  publicDir: "public",
  server: { port: 8794, host: "127.0.0.1" },
  // The harness imports the same modules the extension does, including the
  // ORT rewrite, so the dev server has to run the same plugin set.
  configFile: "vite.config.ts",
});
await vite.listen();

const engines = { chromium, firefox };
const engine = engines[engineName];
if (!engine) { console.error(`unknown engine: ${engineName}`); process.exit(1); }

const fails = [];
let browser;
try {
  browser = await engine.launch(
    engineName === "chromium"
      ? { args: ["--autoplay-policy=no-user-gesture-required"] }
      : { firefoxUserPrefs: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 } },
  );
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log(`  console error: ${m.text().slice(0, 200)}`); });
  await page.goto("http://127.0.0.1:8794/e2e/harness/index.html");
  await page.evaluate((src) => {
    const v = document.querySelector("video");
    v.src = src;
  }, `/testmedia/${basename(video)}`);
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, { timeout: 30_000 });

  console.log(`${engineName}: ${model} (${language}) on ${basename(video)}`);
  const result = await page.evaluate(
    (settings) => window.runPipeline(settings, 2),
    { model, language, window: Number(flag("--window", "10")), overlay: false, fontScale: 1 },
  );

  console.log(`  windows sent: ${result.windowsSent}, transcribed: ${result.windowsDone}, cues: ${result.cues}`);
  console.log(`  decode probe: ${JSON.stringify(result.probe)}`);
  console.log(`  peak captured level: ${result.peak?.toFixed?.(4)}, played to ${result.playedTo?.toFixed?.(1)}s`);
  if (result.peak !== undefined && result.peak < 0.01) {
    fails.push(`the captured audio is silent (peak ${result.peak}) -- the transcript below is a hallucination, not a reading`);
  }
  if (result.failure) fails.push(`engine reported: ${result.failure}`);
  if (!result.windowsSent) fails.push("no audio windows were recorded");
  if (!result.windowsDone) fails.push("no window came back from the engine");
  if (!result.cues) fails.push("no cues were produced");
  if (result.text) {
    console.log(`  transcript: ${JSON.stringify(result.text.slice(0, 220))}`);
    // Japanese, Chinese and Thai are written without spaces, so counting
    // whitespace-separated words says "2" about a full sentence. Count
    // characters for those and words for the rest.
    const spaced = !/^[^\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}]*$/u.test(result.text)
      ? result.text.replace(/\s+/gu, "").length >= 20
      : result.text.trim().split(/\s+/).filter(Boolean).length >= 8;
    if (!spaced) fails.push(`too little text came back: ${JSON.stringify(result.text)}`);
    // The clean-up rules from APP-51 should keep audio-event annotations
    // out -- bracketed or bare. A window that is nothing but a music bed
    // is ordinary in live capture, and its transcript must be empty
    // rather than the word "Music" across ten seconds.
    if (/\[\s*(music|♪)/i.test(result.text)) fails.push("a bracketed annotation survived clean-up");
    if (/^\s*(music|applause|laughter|outro|intro)\b/i.test(result.text)) {
      fails.push(`the transcript opens with an annotation: ${JSON.stringify(result.text.slice(0, 40))}`);
    }
    // And the silence sign-off, which is what Whisper says over a lead-in.
    if (/^\s*(thank you|thanks for watching)\b/i.test(result.text)) {
      fails.push("a sign-off hallucination survived at the window boundary");
    }
  }
  if (result.srt) {
    console.log(result.srt.trim().split("\n").map((l) => `    ${l}`).join("\n"));
    if (!/\d\d:\d\d:\d\d,\d\d\d --> /.test(result.srt)) fails.push("the srt has no timings");
  }
} catch (e) {
  fails.push(e.message.split("\n")[0]);
} finally {
  if (browser) await browser.close();
  await vite.close();
}

console.log(fails.length ? `\n${fails.length} failed` : "\nall checks passed");
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
