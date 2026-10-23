// What the desktop window says when a file or a model will not do, end to
// end in a browser: the built front end, with Tauri's IPC answered by a
// stand-in that returns what the Rust side returns (the failures are the
// `UserError` objects commands.rs sends; the unreadable one is what the real
// ffprobe produced on a truncated MP4, with the home directory taken out).
//
// What it pins:
//   - a video with no sound says so as soon as it is chosen, and cannot be
//     burned;
//   - a file that cannot be read gets a sentence, with the tool's text behind
//     a closed "Details" toggle that does not name the user;
//   - silence or music gets "No speech found", not a raw error;
//   - an English-only model is labelled, and when the speech is not English
//     the person can switch to the multilingual model or burn anyway;
//   - the model list says which models are English only, offers multilingual
//     ones, and lists the model the app came with;
//   - the Chinese script follows the system language, and reaches the export;
//   - the success card names the numbered file an export wrote.
//
// Run with: npm run build && node e2e/errors-and-models.spec.mjs
// Writes screenshots to $SCREENSHOT_DIR when it is set.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(HERE, "..", "dist");
const SHOTS = process.env.SCREENSHOT_DIR;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const file = join(DIST, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const BUNDLED = "C:\\Program Files\\OpenSubs\\models\\ggml-base.bin";
const TINY_EN = "C:\\Users\\…\\.cache\\opensubs-models\\ggml-tiny.en.bin";

const MEDIA = {
  filename: "a.mp4", displayWidth: 1280, displayHeight: 720,
  duration: 21.4, fps: 30, hasAudio: true, isHdr: false,
};

// Six entries, as `model_list` builds them: the bundled one first, then the
// downloads with their real sizes (from models.rs).
const MODELS = [
  { name: "base", filename: "ggml-base.bin", url: "", sizeBytes: 147951465, description: "comes with the app; a good default for any language", alreadyDownloaded: true, localPath: BUNDLED, englishOnly: false, bundled: true },
  { name: "tiny", filename: "ggml-tiny.bin", url: "x", sizeBytes: 77691713, description: "fastest, roughest", alreadyDownloaded: false, localPath: null, englishOnly: false, bundled: false },
  { name: "small", filename: "ggml-small.bin", url: "x", sizeBytes: 487601967, description: "more accurate than Base, about three times slower", alreadyDownloaded: false, localPath: null, englishOnly: false, bundled: false },
  { name: "large-v3-turbo", filename: "ggml-large-v3-turbo.bin", url: "x", sizeBytes: 1624555275, description: "best quality, slowest", alreadyDownloaded: false, localPath: null, englishOnly: false, bundled: false },
  { name: "tiny.en", filename: "ggml-tiny.en.bin", url: "x", sizeBytes: 77704715, description: "fastest, for English speech", alreadyDownloaded: true, localPath: TINY_EN, englishOnly: true, bundled: false },
  { name: "base.en", filename: "ggml-base.en.bin", url: "x", sizeBytes: 147964211, description: "a little better than Base on English speech", alreadyDownloaded: false, localPath: null, englishOnly: true, bundled: false },
];

const UNREADABLE = {
  kind: "unreadable",
  message: "OpenSubs can't read this file. It may be damaged, not fully downloaded, or not a video.",
  details:
    "probe of ~\\Videos\\a.mp4: C:\\Program Files\\OpenSubs\\vendor\\ffprobe.exe exited with exit code: 1: [mov,mp4,m4a,3gp,3g2,mj2 @ 0000020c] moov atom not found\n~\\Videos\\a.mp4: Invalid data found when processing input",
  language: null,
};
const NO_SPEECH = {
  kind: "noSpeech",
  message: "No speech was found in this video -- only silence, music or other sounds -- so no subtitles were made and nothing was saved.",
  details: null,
  language: null,
};
const ENGLISH_ONLY = {
  kind: "englishOnlyModel",
  message: "This video sounds like Chinese, but the model ggml-tiny.en.bin only understands English. Its subtitles would be English words, not Chinese.",
  details: null,
  language: "zh",
};

function tauriMock(state) {
  const callbacks = new Map();
  let next = 1;
  let burns = 0;
  window.__calls = [];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb) {
      const id = next++;
      callbacks.set(id, cb);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc: (p) => p,
    async invoke(cmd, args) {
      window.__calls.push({ cmd, args });
      if (cmd.startsWith("plugin:event|")) return next++;
      if (cmd === "probe") {
        if (state.probeError) throw state.probeError;
        return state.media;
      }
      if (cmd === "burn") {
        burns += 1;
        const failure = state.burnErrors?.[burns - 1];
        if (failure) throw failure;
        return state.burnResult;
      }
      if (cmd === "describe_model") {
        return { englishOnly: /\.en\.bin$/.test(args.path), bundledPath: state.bundled };
      }
      const answers = {
        list_styles: [
          { name: "Clean", font: "Inter", sizePct: 4.5, alignment: 2, primaryHex: "#ffffff", backHex: "#000000", borderStyle: "outline", pack: "Core" },
          { name: "Shorts", font: "Inter", sizePct: 6.5, alignment: 2, primaryHex: "#ffffff", backHex: "#000000", borderStyle: "outline", pack: "Core" },
        ],
        list_features: [],
        list_languages: [
          { code: "zh-Hans", name: "Chinese (Simplified)", endonym: "简体中文" },
          { code: "zh-Hant", name: "Chinese (Traditional)", endonym: "繁體中文" },
          { code: "ja", name: "Japanese", endonym: "日本語" },
        ],
        translation_ready: true,
        get_model_path: state.model,
        set_model_path: null,
        check_ffmpeg: { found: true, missing: [], install: null },
        list_downloadable_models: state.models,
        "plugin:dialog|open": "C:\\Users\\…\\Videos\\a.mp4",
      };
      return cmd in answers ? answers[cmd] : null;
    },
  };
}

async function open(browser, overrides = {}, locale = "en-US") {
  const context = await browser.newContext({ locale, viewport: { width: 900, height: 1300 } });
  const page = await context.newPage();
  const state = {
    media: MEDIA,
    model: BUNDLED,
    bundled: BUNDLED,
    models: MODELS,
    burnResult: "C:\\Users\\…\\Videos\\a.subbed (1).mp4",
    ...overrides,
  };
  await page.addInitScript(([s, mock]) => (0, eval)(`(${mock})`)(s), [state, tauriMock.toString()]);
  await page.goto(base);
  return { page, context };
}

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
  if (!ok) failures += 1;
}
async function shot(page, name, locator) {
  if (!SHOTS) return;
  await (locator ? page.locator(locator).first() : page).screenshot({ path: join(SHOTS, `${name}.png`) });
}
async function choose(page) {
  await page.click(".drop-zone");
  await page.waitForSelector(".file-summary");
  await page.waitForFunction(() => !document.querySelector(".file-summary")?.textContent?.includes("Probing"));
}
const calls = (page, cmd) => page.evaluate((c) => window.__calls.filter((x) => x.cmd === c).map((x) => x.args), cmd);

const browser = await chromium.launch();

console.log("a video with no sound");
{
  const { page, context } = await open(browser, { media: { ...MEDIA, hasAudio: false } });
  await choose(page);
  const card = await page.textContent(".file-summary");
  check("says so as soon as it is chosen", card.includes("This video has no sound, so there is nothing to subtitle."), card);
  check("cannot be burned", await page.locator(".burn-row .btn-primary").isDisabled());
  check("and says why beside the button", (await page.textContent(".burn-row")).includes("no sound"));
  await shot(page, "no-audio", ".screen");
  await context.close();
}

console.log("a file that cannot be read");
{
  const { page, context } = await open(browser, { probeError: UNREADABLE });
  await choose(page);
  const card = await page.textContent(".file-summary");
  check("a plain sentence", card.includes("can't read this file"), card);
  check("no raw ffprobe text on show", !(await page.locator(".file-summary pre").isVisible()));
  check("the details are one click away", (await page.locator(".file-summary details summary").textContent()) === "Details");
  await page.click(".file-summary details summary");
  const details = await page.textContent(".file-summary details pre");
  check("details keep what the tool said", details.includes("moov atom not found"));
  check("details do not name the user", details.includes("~\\Videos") && !/Users\\[^…]/.test(details), details);
  check("burn stays off", await page.locator(".burn-row .btn-primary").isDisabled());
  await shot(page, "unreadable-with-details", ".screen");
  await context.close();
}

console.log("nobody speaking");
{
  const { page, context } = await open(browser, { burnErrors: [NO_SPEECH] });
  await choose(page);
  await page.click(".burn-row .btn-primary");
  await page.waitForSelector(".banner-info");
  const banner = await page.textContent(".banner-info");
  check("says no speech was found", banner.includes("No speech found") && banner.includes("nothing was saved"), banner);
  check("is not shown as an error object", !banner.includes("[object"));
  check("no success card", (await page.locator(".success-card").count()) === 0);
  await shot(page, "no-speech", ".screen");
  await context.close();
}

console.log("an English-only model on speech that is not English");
{
  const { page, context } = await open(browser, { model: TINY_EN, burnErrors: [ENGLISH_ONLY, ENGLISH_ONLY] });
  await choose(page);
  await page.waitForSelector(".model-row .tag-warning");
  check("the model is labelled English only", (await page.textContent(".model-row")).includes("English only"));
  check("and the card says what that means", (await page.textContent(".model-warning")).includes("only understands English"));
  await page.click(".burn-row .btn-primary");
  await page.waitForSelector(".banner-warning");
  const banner = await page.textContent(".banner-warning");
  check("the burn stops and says why", banner.includes("sounds like Chinese") && banner.includes("only understands English"), banner);
  await shot(page, "english-only-warning", ".screen");
  await page.click("text=Burn anyway");
  await page.waitForSelector(".banner-warning");
  const burns = await calls(page, "burn");
  check("burn anyway asks again, saying the person chose to", burns.length === 2 && burns[1].options.allowEnglishOnly === true, JSON.stringify(burns.map((b) => b.options)));
  await page.click("text=Use Base (multilingual) and burn");
  await page.waitForSelector(".success-card");
  const set = await calls(page, "set_model_path");
  const third = (await calls(page, "burn"))[2];
  check("switching uses the model the app came with", set.at(-1)?.path === BUNDLED && third.model === BUNDLED, JSON.stringify({ set, third }));
  await context.close();
}

console.log("the model list");
{
  const { page, context } = await open(browser);
  await page.click("text=Download a model…");
  await page.waitForSelector(".model-download-row");
  const rows = await page.$$eval(".model-download-row", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  check("six models", rows.length === 6, rows.join(" | "));
  check("the one that came with the app is listed, and selected", rows[0].includes("base") && rows[0].includes("Included") && rows[0].includes("Selected"), rows[0]);
  check(".en models say English only", rows.filter((r) => /\.en/.test(r)).every((r) => r.includes("English only")));
  check("multilingual base and small are offered", rows.some((r) => r.startsWith("base") && r.includes("Multilingual")) && rows.some((r) => r.startsWith("small") && r.includes("Multilingual")));
  check("no English-only model is called the default", rows.filter((r) => r.includes("English only")).every((r) => !r.includes("default")));
  await shot(page, "model-list", ".model-download-list");
  await context.close();
}

console.log("which Chinese script");
for (const [locale, want] of [["zh-CN", "simplified"], ["zh-TW", "traditional"], ["en-US", "simplified"]]) {
  const { page, context } = await open(browser, {}, locale);
  await choose(page);
  const value = await page.locator("select").nth(2).inputValue();
  check(`${locale} starts on ${want}`, value === want, value);
  if (locale === "zh-CN") await shot(page, "chinese-script-option", ".screen");
  await page.click(".burn-row .btn-primary");
  await page.waitForSelector(".success-card");
  const burn = (await calls(page, "burn"))[0];
  check(`${locale}: the export is told`, burn.options.chineseScript === want, JSON.stringify(burn.options));
  await context.close();
}
{
  const { page, context } = await open(browser);
  await choose(page);
  await page.selectOption("select >> nth=1", "zh-Hant");
  check("a Chinese translation target hides the setting it overrides", (await page.locator("text=Chinese subtitles").count()) === 0);
  await context.close();
}

console.log("a second export of the same video");
{
  const { page, context } = await open(browser);
  await choose(page);
  await page.click(".burn-row .btn-primary");
  await page.waitForSelector(".success-card");
  check("the card names the numbered file", (await page.textContent(".success-card")).includes("Wrote a.subbed (1).mp4"));
  await shot(page, "numbered-output", ".success-card");
  await context.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? "\nall green" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
