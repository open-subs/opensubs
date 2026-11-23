// Audio files as the source: an mp3, wav or m4a goes in through
// the picker or a drop, its speech becomes subtitles, and the export offers
// the subtitle files without a burn-in that waits for a picture for ever.
//
// The speech is synthesised by ffmpeg's flite filter, so this runs on Linux
// without macOS `say`. Generation uses the real on-device recogniser, which
// downloads the speech model on the first run.
//
//   node e2e/audio-input.mjs          (after `npm run build`)
//   SKIP_GENERATE=1 node e2e/audio-input.mjs   (picker/drop/export only)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "../dist");
const GENERATE = process.env.SKIP_GENERATE !== "1";

let pass = 0;
const fails = [];
function check(cond, name, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fails.push(name);
    console.log(`FAIL  ${name}${detail ? ` -- ${String(detail).slice(0, 300)}` : ""}`);
  }
}

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/ is missing -- run `npm run build` first.");
  process.exit(2);
}
if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  console.error("ffmpeg is needed to make the audio fixtures.");
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "opensubs-audio-"));
const ff = (...args) => spawnSync("ffmpeg", ["-v", "error", "-y", ...args]).status === 0;
const wav = join(dir, "speech.wav");
const mp3 = join(dir, "speech.mp3");
const m4a = join(dir, "speech.m4a");
const webm = join(dir, "clip.webm");
const said = "Hello there. This is a short test of audio subtitles. Thank you for listening.";
ff("-f", "lavfi", "-i", `flite=text='${said}':voice=slt`, "-af", "apad=pad_dur=1", "-ar", "16000", "-ac", "1", wav);
ff("-i", wav, "-c:a", "libmp3lame", "-b:a", "64k", mp3);
ff("-i", wav, "-c:a", "aac", "-b:a", "64k", m4a);
ff("-f", "lavfi", "-i", "color=c=0x203040:size=320x180:rate=10:duration=3",
  "-c:v", "libvpx-vp9", "-b:v", "60k", "-cpu-used", "8", "-deadline", "realtime", webm);
for (const f of [wav, mp3, m4a, webm]) {
  if (!existsSync(f)) {
    console.error(`fixture failed: ${f}`);
    process.exit(2);
  }
}

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".woff2": "font/woff2", ".otf": "font/otf", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".srt": "text/plain", ".onnx": "application/octet-stream",
};
const server = createServer(async (req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = u === "/" ? "/index.html" : u;
  try {
    const b = await readFile(join(DIST, f));
    res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
    res.end(b);
  } catch {
    res.writeHead(404).end("nf");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const PICKER = 'input[type=file][aria-label="Choose a file"]';

async function fresh() {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 } });
  // The File System Access picker would take the click; the plain input is
  // what setInputFiles drives, and it carries the accept list under test.
  await ctx.addInitScript(() => { delete window.showOpenFilePicker; });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector(PICKER, { state: "attached", timeout: 30000 });
  return { ctx, page, errors };
}

/** Drop a file on the page the way a file manager does, type and all. */
async function drop(page, path, name, type) {
  const bytes = [...(await readFile(path))];
  await page.evaluate(({ bytes, name, type }) => {
    const file = new File([new Uint8Array(bytes)], name, { type });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { bytes, name, type });
}

const fileMeta = (page) => page.locator(".file-meta").first().textContent();

try {
  // 1. The picker offers audio.
  {
    const { ctx, page } = await fresh();
    const accept = await page.locator(PICKER).getAttribute("accept");
    for (const want of ["video/*", "audio/*", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]) {
      check(accept?.split(",").includes(want), `the picker accepts ${want}`, accept);
    }
    const all = await page.locator('input[type=file]:not([accept*=".srt"])').evaluateAll((els) => els.map((e) => e.accept));
    check(all.every((a) => a.includes("audio/*")), "every media input accepts audio", all.join(" | "));
    await ctx.close();
  }

  // 2. Choosing an mp3, generating, and exporting.
  {
    const { ctx, page, errors } = await fresh();
    await page.setInputFiles(PICKER, mp3);
    await page.waitForSelector("[data-audio-only]", { timeout: 15000 });
    check(true, "an mp3 chosen in the picker opens, with the audio placeholder");
    await page.waitForFunction(() => /\d:\d\d/.test(document.querySelector(".file-meta")?.textContent ?? ""), null, { timeout: 15000 });
    const meta = await fileMeta(page);
    check(/speech\.mp3/.test(meta) && /audio/.test(meta) && !/reading/.test(meta), "the file row names it as audio with a duration", meta);
    const box = await page.locator(".stage video").boundingBox();
    check(box && box.height < 100, "no black 16:9 box for the audio player", JSON.stringify(box));
    check(await page.locator("button:has-text('Generate from the audio')").isEnabled(), "Generate is offered for the mp3");

    if (GENERATE) {
      await page.locator("button:has-text('Generate from the audio')").click();
      const ok = await page.waitForSelector(".cue", { timeout: 900_000 }).then(() => true).catch(() => false);
      check(ok, "generating from the mp3 produces subtitles");
    } else {
      // Subtitles from a file stand in for generated ones: the export
      // step is what is under test here.
      await page.locator('input[type=file][accept*=".srt"]').first().setInputFiles({
        name: "speech.srt", mimeType: "text/plain",
        buffer: Buffer.from("1\n00:00:00,500 --> 00:00:03,000\nHello there.\n"),
      });
      await page.waitForSelector(".cue", { timeout: 15000 });
    }

    if (await page.locator(".cue").count()) {
      await page.locator("#tab-export").click();
      const exportCard = page.locator("#panel-export");
      await exportCard.locator("[data-burn-needs-video]").waitFor({ timeout: 5000 });
      const text = await exportCard.textContent();
      check(/Burning in needs a video file/.test(text), "export says burning in needs a video", text);
      check(!/reading…/.test(text), "export does not sit on 'reading…'");
      check((await exportCard.locator("button:has-text('Burn subtitles into the video'), button:has-text('Sign in free to burn')").count()) === 0,
        "there is no burn button for audio");
      for (const ext of ["srt", "vtt", "ass", "txt"]) {
        const [dl] = await Promise.all([
          page.waitForEvent("download", { timeout: 10000 }),
          exportCard.locator(`button:has-text(".${ext}")`).first().click(),
        ]);
        check(dl.suggestedFilename() === `speech.${ext}`, `.${ext} downloads as speech.${ext}`, dl.suggestedFilename());
        if (ext === "srt") {
          const body = await readFile(await dl.path(), "utf8");
          check(/-->/.test(body) && /hello|test|audio|listen/i.test(body), "the .srt holds timed words from the audio", body);
        }
      }
    }
    check(errors.length === 0, "no page errors with an mp3 open", errors.join(" | "));
    await ctx.close();
  }

  // 3. Dropping audio: an mp3 with an empty type (as some file managers
  //    send it), a wav, and an m4a.
  for (const [path, name, type] of [
    [mp3, "dropped.mp3", ""],
    [wav, "dropped.wav", "audio/wav"],
    [m4a, "dropped.m4a", "audio/x-m4a"],
  ]) {
    const { ctx, page } = await fresh();
    await drop(page, path, name, type);
    const ok = await page.waitForSelector("[data-audio-only]", { timeout: 15000 }).then(() => true).catch(() => false);
    const meta = ok ? await fileMeta(page) : "";
    check(ok && meta.includes(name), `dropping ${name} (type "${type}") opens it as audio`, meta);
    await ctx.close();
  }

  // 4. A video still opens as a video, by picker and by drop.
  {
    const { ctx, page } = await fresh();
    await page.setInputFiles(PICKER, webm);
    await page.waitForFunction(() => document.querySelector(".file-meta")?.textContent?.includes("×"), null, { timeout: 15000 });
    check((await page.locator("[data-audio-only]").count()) === 0, "a video is not treated as audio");
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh();
    await drop(page, webm, "dropped.webm", "video/webm");
    const ok = await page.waitForFunction(() => document.querySelector(".file-meta")?.textContent?.includes("×"), null, { timeout: 15000 }).then(() => true).catch(() => false);
    check(ok && (await page.locator("[data-audio-only]").count()) === 0, "a dropped video still opens as a video");
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
