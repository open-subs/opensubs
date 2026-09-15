// Smoke test for the browser app: does the wasm engine actually load, does
// a real .srt come back as cues, does libass draw a preview over a real
// video, and does the export produce the same ASS the desktop would.
//
// Playwright is borrowed from a sibling product rather than added as a
// dependency here -- the same arrangement the openvidsub website plan used.
// Run: node e2e/smoke.mjs   (after `npm run build`)

import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "../dist");
const REPO = resolve(HERE, "../../..");

/**
 * A VP9/WebM clip with a completely static picture, generated rather than
 * committed.
 *
 * Two deliberate choices:
 *
 * - **WebM**, because the repo's own fixture is H.264 and Playwright's
 *   bundled Chromium ships without proprietary codecs. It would report
 *   videoWidth 0 forever and look exactly like a bug in the app.
 * - **A flat colour**, because the checks below measure whether subtitles
 *   were painted by diffing two frames. Against an animating source like
 *   `testsrc2` that diff is dominated by the animation, so it passes
 *   whether or not libass drew anything -- which is precisely how a build
 *   that rendered no subtitles at all once went green. On a static picture
 *   every changed pixel is a subtitle.
 * - **Opus speech, not silence**, when OPENSUBS_TEST_ASR=1. A silent clip
 *   makes the transcription check unfalsifiable: it fails on "no audio
 *   track" rather than on anything about the recogniser. The speech comes
 *   from macOS `say`; without it the ASR check is skipped and says so.
 *
 * (`scripts/make-sample.sh`, for hand-testing, uses a busy background on
 * purpose: a human is judging legibility, not diffing frames.)
 */
const WANT_ASR = process.env.OPENSUBS_TEST_ASR === "1";

function makeFixture() {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return null;
  const dir = mkdtempSync(join(tmpdir(), "opensubs-e2e-"));
  const out = join(dir, "clip.webm");

  // Only bother synthesising speech when the transcription check will
  // actually run; it costs a couple of seconds and needs macOS.
  let speech = null;
  if (WANT_ASR && spawnSync("say", ["-v", "?"]).status === 0) {
    const aiff = join(dir, "speech.aiff");
    spawnSync("say", [
      "-v", "Samantha", "-o", aiff,
      "The words, burned into the picture. A second line here.",
    ]);
    if (existsSync(aiff)) speech = aiff;
  }

  const args = [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x203040:size=1280x720:rate=30:duration=8",
    ...(speech ? ["-i", speech] : []),
    "-c:v", "libvpx-vp9", "-b:v", "300k", "-cpu-used", "8", "-deadline", "realtime",
    // Opus, because a stock headless Chromium has no proprietary codecs
    // and could not decode AAC to transcribe it.
    ...(speech ? ["-c:a", "libopus", "-b:a", "64k", "-shortest"] : []),
    out,
  ];
  const result = spawnSync("ffmpeg", args);
  if (result.status !== 0 || !existsSync(out)) return null;
  return { path: out, hasSpeech: Boolean(speech) };
}

const fixtureInfo = makeFixture();

const FIXTURE = fixtureInfo?.path ?? null;

// Playwright is pinned to 1.62.1 in package.json, and the pin is load
// bearing. 1.63 ships Chrome 153, on which the renderer *crashes* during
// the reload check below -- "Target page, context or browser has been
// closed", reproducibly, after a video handle and a subtitle file are both
// in play. 1.62.1 (Chrome 152) runs all 109 checks green.
//
// That is an open question about the app, not only about the test: a page
// that kills its own renderer on reload is a real defect if a user can
// reach it. It has not been reproduced by hand yet. Unpin and re-run
// before assuming a later Playwright is safe.
const PLAYWRIGHT = "playwright";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);

    // A stand-in for a bring-your-own-key translator. Reachable at
    // `<base>/fake` as an OpenAI-compatible endpoint, it "translates" by
    // prefixing, which is enough to prove a line came from the translated
    // side rather than the original. Latin output on purpose: a CJK
    // translation would pull a script font and disturb the font checks
    // that follow.
    if (path === "/fake/chat/completions") {
      const body = await new Promise((ok) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => ok(raw));
      });
      let lines = [];
      try {
        const prompt = JSON.parse(body).messages.at(-1).content;
        lines = JSON.parse(prompt.slice(prompt.indexOf("{"))).lines;
      } catch {
        lines = [];
      }
      // Chinese when Chinese is asked for, so the re-wrapping rules
            // for a space-less script can be tested; otherwise Latin, which
            // shares no words with the input so that "is the original still
            // being drawn?" stays answerable.
            // The prompt carries the language *code* the app sends, not a name.
            const wantsChinese = /zh-|Chinese/.test(body);
            const translated = lines.map((_, i) =>
              wantsChinese
                ? "你好，世界。这是第二行、完毕。"
                : `Ligne ${i + 1} en francais`,
            );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ translations: translated }) } }],
        }),
      );
      return;
    }
    const file = path === "/" ? "/index.html" : path;
    // The sample video is served from outside dist/ so the page can load a
    // real file without copying a fixture into the build output.
    const target = file === "/clip.webm" ? FIXTURE : join(root, file);
    try {
      const body = await readFile(target);
      res.writeHead(200, {
        "content-type": TYPES[extname(target)] ?? "application/octet-stream",
        // The *production* CSP, verbatim from the nginx config.
        //
        // This is not decoration. Transcription shipped broken because
        // onnxruntime-web fetches its wasm backend from cdn.jsdelivr.net at
        // runtime, the deployed CSP blocked it, and every local test passed
        // -- because a dev server sends no CSP at all. The feature worked
        // everywhere except the one place it mattered.
        //
        // Keep this in step with nginx/snippets/opensubs-security.conf. If
        // a change needs a wider policy, that is a decision to make
        // deliberately, not something to discover from a user.
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; " +
          "worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob:; media-src 'self' blob:; " +
          // connect-src is open to https on purpose: "Your own API key"
          // points the app at a server only the user knows. Enumerating
          // hosts here would pass the tests and break that feature in
          // production, which is exactly what it once did.
          "font-src 'self' data:; " +
          "connect-src 'self' blob: data: https: " +
          "http://localhost:* http://127.0.0.1:*; " +
          "frame-ancestors 'none'; base-uri 'self'",
        // Sent here, but **not required in production** -- measured: with
        // no COOP/COEP at all the preview still paints (1891 opaque
        // pixels), `crossOriginIsolated` is false and `SharedArrayBuffer`
        // is absent, and libass renders anyway. Setting
        // `Cross-Origin-Embedder-Policy: require-corp` on the real deploy
        // would be actively harmful: it blocks cross-origin subresources
        // that do not opt in, and the speech model is fetched from
        // huggingface.co.
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "require-corp",
        "cross-origin-resource-policy": "cross-origin",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, () => ok(server)));
}

const SRT = `1
00:00:00,500 --> 00:00:03,000
The words, burned into the picture.

2
00:00:03,500 --> 00:00:06,000
A second cue, on two
lines this time.
`;

/** A frame as raw 8-bit greyscale, for comparing two screenshots. */
const gray = (file) =>
  spawnSync("ffmpeg", ["-v", "error", "-i", file, "-pix_fmt", "gray", "-f", "rawvideo", "-"], {
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

if (!existsSync(DIST)) {
  console.error(`cannot run: ${DIST} is missing -- run \`npm run build\` first`);
  process.exit(1);
}

console.log("backend domain masking");
{
  // The accounts server and the gateway are shared infrastructure, and a
  // user of this app must never see whose. Every request leaves for an
  // `opensubs.app` host (see src/lib/account.ts); one hardcoded URL in one
  // call site, added in a hurry, undoes the whole arrangement and nothing
  // else would notice.
  //
  // The host to look for is not written down here. This file is public, so
  // hardcoding the name would publish the very string the check exists to
  // keep out of public view -- the test would become the leak. It comes
  // from the environment instead, and the deploy script (which is not in
  // this repository) sets it and refuses to ship on a hit.
  //
  //   OPENSUBS_MASKED_HOSTS=example.internal,other.internal npm test
  const masked = (process.env.OPENSUBS_MASKED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const bundles = (await readdir(join(DIST, "assets"))).filter((f) => f.endsWith(".js"));
  if (masked.length === 0) {
    console.log("  --   backend domain masking not checked (OPENSUBS_MASKED_HOSTS unset)");
  } else {
    const leaked = [];
    for (const file of bundles) {
      const text = await readFile(join(DIST, "assets", file), "utf8");
      for (const host of masked) if (text.includes(host)) leaked.push(`${file} (${host})`);
    }
    check(
      "the built bundle never names a masked backend host",
      leaked.length === 0,
      leaked.join(", "),
    );
  }

  const all = (
    await Promise.all(bundles.map((f) => readFile(join(DIST, "assets", f), "utf8")))
  ).join("");
  // Our own copy only. The shared SDK exports a class called `OpenApps` and
  // throws developer-facing errors that name it, and those survive
  // minification -- so checking the whole bundle matches identifiers rather
  // than anything a user reads. What matters is that nothing *we* write puts
  // the parent brand in front of someone using opensubs.app.
  const ourCopy = await readFile(new URL("../src/App.svelte", import.meta.url), "utf8");
  check(
    "our own copy never names the parent brand",
    !ourCopy.includes("OpenApps"),
    "\"OpenApps\" appears in App.svelte -- opensubs.app stands on its own name",
  );
  check(
    "the bundle talks to our own hostnames instead",
    all.includes("auth.opensubs.app") && all.includes("gateway.opensubs.app"),
    "neither masked hostname is in the bundle -- is account.ts still imported?",
  );
}

/** Click something that downloads, and return the file's text. */
async function downloadText(page, selector) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click(selector),
  ]);
  const to = join(tmpdir(), `opensubs-${Date.now()}-${await download.suggestedFilename()}`);
  await download.saveAs(to);
  return await readFile(to, "utf8");
}

const { chromium } = await import(PLAYWRIGHT);
const server = await serve(DIST);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors = [];
/**
 * One console error a test is deliberately provoking, excused by exact
 * substring while it is set. Anything else still fails the run.
 */
let expectedConsoleError = null;
// libass reports a missing glyph as a plain log line, not an error, and
// then draws a tofu box. Pixel checks cannot catch that -- a tofu box is
// as many pixels as a glyph -- so the log line itself is the signal.
const fontMisses = [];
const scriptFontsFetched = new Set();
/**
 * Reaching the real accounts server is not something this test can do, and
 * not something it should try.
 *
 * The sign-in and buy elements fetch `/v1/auth/methods` and
 * `/v1/payments/packages` the moment they mount. Those go to
 * `auth.opensubs.app`, which from a laptop running a local dist/ resolves
 * to nothing usable -- so the browser logs a network failure that is a
 * property of the environment, not of the build. Filtered narrowly, by
 * hostname, so a genuine error from our own code still fails the run.
 */
const reachesTheBackend = (text) =>
  text.includes("auth.opensubs.app") || text.includes("gateway.opensubs.app");

page.on("console", (m) => {
  const text = m.text();
  // A failed fetch logs "Failed to load resource: ..." with the URL only in
  // the message's *location*, not its text -- so both have to be checked or
  // the filter silently matches nothing.
  const from = m.location()?.url ?? "";
  if (text.includes("Content Security Policy")) cspViolations.push(text.slice(0, 160));
  if (m.type() === "error" && !reachesTheBackend(text) && !reachesTheBackend(from)) {
    if (!(expectedConsoleError && text.includes(expectedConsoleError))) {
      consoleErrors.push(`${text} ${from}`.trim());
    }
  }
  if (text.includes("failed to find any fallback")) fontMisses.push(text);
});
/**
 * CSP violations, collected separately from console errors.
 *
 * A blocked resource is reported as a console message rather than an
 * exception, so it slides past an error check while breaking the feature
 * that needed it -- which is exactly how the ORT backend fetch reached
 * production.
 */
const cspViolations = [];

/**
 * Third-party hosts the page contacted.
 *
 * The product's claim is that nothing leaves the machine but what the user
 * chooses to send, and the privacy page enumerates exactly who is
 * contacted. A new runtime dependency on someone else's CDN would break
 * both quietly.
 */
const externalHosts = new Set();

page.on("request", (r) => {
  const url = r.url();
  if (url.startsWith("http") && !url.startsWith(base)) {
    externalHosts.add(new URL(url).host);
  }
});

page.on("pageerror", (e) => {
  if (!reachesTheBackend(String(e))) consoleErrors.push(String(e));
});
page.on("response", (r) => {
  const name = r.url().split("/").pop() ?? "";
  // Only real font fetches. Vite hashes asset filenames in a build
  // (opensubs-cjk-A1b2C3.woff2) and its dev `?url` shims carry a query
  // string, so match the stem and exclude anything with a query.
  // The script names are a known set, which avoids guessing where the
  // stem ends and Vite's hash begins (a hash may contain hyphens too).
  const font = name.match(/^opensubs-(cjk|hangul|arabic|devanagari|thai)\b/);
  if (font && !r.url().includes("?")) scriptFontsFetched.add(font[1]);
});

// The Traditional -> Simplified table is 13 KB gzipped and only matters
// once someone transcribes Chinese and asks for Simplified. It must not be
// in the bundle everybody downloads.
{
  // Read the script the page actually loads rather than matching a
  // filename: the entry chunk was called `index-*.js` until the site
  // became multi-page, and is `main-*.js` now. A test that knows the name
  // fails on a rename and passes on the wrong file, which is worse.
  const pages = ["index.html", "burn-subtitles-into-video.html"];
  const entries = new Set();
  for (const page of pages) {
    const html = await readFile(join(DIST, page), "utf8");
    for (const m of html.matchAll(/<script[^>]+src="\/?(assets\/[^"]+\.js)"/g)) {
      entries.add(m[1]);
    }
  }
  const entry = entries.size > 0 ? [...entries] : null;
  const text = entry
    ? (await Promise.all(entry.map((f) => readFile(join(DIST, f), "utf8")))).join("\n")
    : "";
  // A rare pair, so the guard literals in script.ts do not match.
  check(
    "the Chinese conversion table is loaded only when it is needed",
    entry !== null && !text.includes("\u9F8D\u9F99"),
    entry ? `the whole table is in ${entry.join(", ")}` : "no entry bundle found",
  );
}

console.log("engine");
await page.goto(base, { waitUntil: "networkidle" });
// The feature catalogue comes from the wasm module, so its presence is
// proof the engine compiled and ran -- not just that the page rendered.
await page.waitForSelector(".features-card", { timeout: 15000 });

const footer = await page.textContent(".web-footer");
check("engine version reported by the wasm module", /\d+\.\d+\.\d+/.test(footer), footer);

await page.click(".features-toggle");
await page.waitForSelector(".feature-row");
const badges = await page.$$eval(".feature-row .cost-badge", (els) =>
  els.map((e) => e.textContent.trim()),
);
check("feature catalogue crosses the wasm boundary", badges.length >= 10, `got ${badges.length}`);
// Every capability states what it costs the user, in the one vocabulary
// shared with `subs_tier::Cost` — so "free" reads identically everywhere.
check("every row carries a cost badge", badges.length > 0 && badges.every(Boolean), badges.join(", "));
check(
  "almost everything is free to run",
  badges.filter((b) => b === "Free").length >= 8,
  badges.join(", "),
);
check(
  "the one thing that can cost money says so",
  badges.some((b) => b.includes("your key")),
  badges.join(", "),
);
check("nothing is gated in this build", !(await page.textContent("body")).includes("Locked"));

// The video comes first, as it does for a user: it is what makes
// "generate subtitles from the audio" possible at all.
if (FIXTURE) {
  console.log("video");
  await page.setInputFiles('input[accept="video/*"]', FIXTURE);
  await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return v && v.videoWidth > 0;
    },
    { timeout: 20000 },
  );
  const dims = await page.textContent(".file-meta");
  check("video dimensions read from the file", dims.includes("1280×720"), dims);

  console.log("subtitle generation is offered");
  const generate = page.locator('button:has-text("Generate from the audio")');
  check("subtitles can be generated from the audio", (await generate.count()) > 0);
  check("generating is enabled once a video is loaded", await generate.isEnabled());

  // "Auto" used to mean English, silently: transformers.js does not
  // implement Whisper's language detection and substitutes `en`, so a
  // Chinese interview came back as confident, invented English. The
  // control has to exist, has to default to detecting, and has to offer
  // naming the language for when it guesses wrong.
  const subtitlesCard = page.locator('.card:has(> h2:text-is("Subtitles"))');
  const spoken = subtitlesCard.locator('label:has(.field-label:text-is("Spoken language")) select');
  check("the spoken language can be set", (await spoken.count()) > 0);
  check(
    "it detects the language by default",
    (await spoken.inputValue()) === "auto",
    await spoken.inputValue(),
  );
  const spokenOptions = await spoken.locator("option").allTextContents();
  check(
    "and a language can be named instead",
    spokenOptions.length > 5 && spokenOptions.some((o) => /Chinese/.test(o)),
    `${spokenOptions.length} options`,
  );

  // Naming both languages of a bilingual video narrows detection to a
  // choice between two. Left open, an English/Chinese clip reported Korean
  // as well -- a third language nobody speaks in it.
  const second = subtitlesCard.locator('label:has(.field-label:text-is("Second language")) select');
  check(
    "no second language is offered while the first is being detected",
    (await second.count()) === 0,
    "a second language beside \"detect it\" would mean nothing",
  );
  const english = (await spoken.locator("option").all()).map((o) => o);
  const englishValue = await (async () => {
    for (const option of english) {
      const [value, label] = await Promise.all([
        option.getAttribute("value"),
        option.textContent(),
      ]);
      if (/English/.test(label ?? "") && value && value !== "auto") return value;
    }
    return null;
  })();
  check("English is one of the offered languages", Boolean(englishValue), "none matched");
  await spoken.selectOption(englishValue ?? "auto");
  await page.waitForTimeout(300);
  check("naming one language offers a second", (await second.count()) > 0);
  check(
    "the second defaults to none, so one named language stays one",
    (await second.inputValue()) === "none",
    await second.inputValue(),
  );
  const secondOptions = await second.locator("option").allTextContents();
  check(
    "and the language already chosen is not offered twice",
    !secondOptions.some((o) => /·\s*English$/.test(o.trim())),
    secondOptions.filter((o) => /English/.test(o)).join(" | "),
  );
  await spoken.selectOption("auto");
  await page.waitForTimeout(200);

  // The same controls have to come back once there are subtitles on the
  // page: the reason to run it again is almost always that one of them was
  // wrong, and reaching them by discarding the subtitles first is a
  // strange way to offer a second attempt.
  const regenerate = subtitlesCard.locator('button:has-text("Re-generate")');
  check(
    "no re-generate button before anything has been generated",
    (await regenerate.count()) === 0,
  );

  if (WANT_ASR && !fixtureInfo?.hasSpeech) {
    console.log("  SKIPPED transcription -- could not synthesise speech (macOS `say` needed)");
  } else if (WANT_ASR) {
    console.log("  running real speech recognition (OPENSUBS_TEST_ASR=1)");
    await page.selectOption('.card:has-text("Subtitles") select', { index: 0 });

    // Record every distinct progress label, rather than polling for one.
    // Polling races the end of the job: the interesting label is the last
    // one before the bar disappears, and an interval can easily step over
    // it. A MutationObserver sees each render.
    await page.evaluate(() => {
      window.__progress = [];
      const record = () => {
        for (const el of document.querySelectorAll(".progress-label")) {
          const text = el.textContent.trim();
          if (text && window.__progress.at(-1) !== text) window.__progress.push(text);
        }
      };
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      record();
    });
    await generate.click();

    // Race the two possible outcomes rather than waiting only for success.
    // Waiting on `.cue` alone cannot tell a slow transcription from a
    // broken one: a failed session shows an error in the UI within
    // seconds, and the test then sits there for the full timeout and
    // reports "timed out" instead of the actual message. That is exactly
    // how a real dtype incompatibility hid behind a five-minute wait.
    const outcome = await Promise.race([
      page.waitForSelector(".cue", { timeout: 300000 }).then(() => "cues"),
      page
        .waitForSelector('.card:has-text("Subtitles") .field-error', { timeout: 300000 })
        .then(() => "error"),
    ]).catch(() => "timeout");

    if (outcome === "cues") {
      const generated = await page.$$eval(".cue", (e) => e.length);
      check("speech recognition produced cues", generated > 0, `${generated} cues`);

      // The whole transcription used to report `fraction: null`, so the
      // bar animated for the length of the job without ever advancing --
      // indistinguishable from a hang, and the reason someone waiting on a
      // long video cannot tell whether to keep waiting.
      const labels = await page.evaluate(() => window.__progress ?? []);
      const listening = labels.filter((l) => l.startsWith("Listening to the audio"));
      check(
        "transcription reports a real percentage, not an indeterminate bar",
        listening.some((l) => /\d+%/.test(l)),
        JSON.stringify(labels),
      );
      // One window of audio finishing is the streamer firing; without it
      // the number would sit at 0 for the entire run.
      check(
        "the bar reaches the end of the audio it was given",
        listening.some((l) => l.includes("100%")),
        JSON.stringify(labels),
      );

      // Loudness is measured from the same audio, so the emphasis control
      // only appears for subtitles this app transcribed.
      check(
        "audio emphasis is offered after transcribing",
        (await page
          .locator('label:has-text("Size every word by how loud it was") input:not([disabled])')
          .count()) > 0,
      );

      // The writer drops emphasis for a line whose words no longer match
      // the measured audio -- correct, but silent, and a ticked box over an
      // unchanged preview is exactly what a broken feature looks like.
      const emphasisBox = page.locator(
        'label:has-text("Size every word by how loud it was") input[type=radio]',
      );
      await emphasisBox.check();
      await page.waitForTimeout(400);
      const warning = '.card:has-text("Subtitles") .field-error';
      check(
        "emphasis on freshly transcribed words warns about nothing",
        (await page.locator(warning).count()) === 0,
        "warned even though the words still match the audio",
      );

      const cueText = page.locator(".cue textarea").first();
      await cueText.fill((await cueText.inputValue()) + " loudly");
      await cueText.blur();
      await page.waitForTimeout(500);
      check(
        "emphasis says so when an edit stops it applying",
        (await page.locator(warning).count()) > 0,
        "the box stayed ticked while emphasis silently stopped applying",
      );
      await page.locator('label:has-text("None") input[type=radio]').check();
    } else if (outcome === "error") {
      const message = await page.textContent('.card:has-text("Subtitles") .field-error');
      check("speech recognition produced cues", false, message.trim());
    } else {
      check("speech recognition produced cues", false, "timed out with no cues and no error");
    }
  } else {
    console.log("  SKIPPED the real transcription (set OPENSUBS_TEST_ASR=1 to run it)");
  }
}

console.log("subtitles");
await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
  name: "clip.srt",
  mimeType: "text/plain",
  buffer: Buffer.from(SRT),
});
// Wait for the file's *two* cues, not merely for a cue to exist. With
// OPENSUBS_TEST_ASR=1 the previous section leaves 60-odd transcribed cues
// on the page, so `.cue` is already satisfied and the count is read while
// the .srt is still being parsed -- which failed here as "got 1".
await page
  .waitForFunction(() => document.querySelectorAll(".cue").length === 2, { timeout: 5000 })
  .catch(() => {});
const cueCount = await page.$$eval(".cue", (els) => els.length);
check("both cues parsed", cueCount === 2, `got ${cueCount}`);

const secondCue = await page.$$eval(".cue-text", (els) => els[1].value);
check("multi-line cue keeps its break", secondCue.includes("\n"), JSON.stringify(secondCue));

{
  const card = page.locator('.card:has(> h2:text-is("Subtitles"))');
  check(
    "re-generating is offered once there are subtitles",
    (await card.locator('button:has-text("Re-generate")').count()) > 0,
  );
  check(
    "and the settings it would re-run with are there too",
    (await card.locator('label:has(.field-label:text-is("Spoken language")) select').count()) > 0 &&
      (await card.locator('label:has(.field-label:text-is("Model")) select').count()) > 0,
  );
  const said = (await card.textContent()).replace(/\s+/g, " ");
  check(
    "it says that re-generating replaces what is on screen",
    said.includes("replaces the subtitles above"),
    said.slice(said.indexOf("Generate again"), said.indexOf("Generate again") + 160),
  );
}

console.log("styles");
await page.waitForSelector(".style-tile", { timeout: 5000 });
const styleNames = await page.$$eval(".style-name", (els) => els.map((e) => e.textContent.trim()));
check("both style packs reach the page", styleNames.length === 12, `got ${styleNames.length}`);
check("core preset present", styleNames.includes("Clean"));
check("advanced preset present", styleNames.includes("Neon"));

if (FIXTURE) {
  console.log("libass preview");
  await page.waitForSelector(".stage canvas", { timeout: 25000 });
  const canvasSize = await page.$eval(".stage canvas", (c) => [c.width, c.height]);
  check(
    "libass canvas is attached and sized",
    canvasSize[0] > 0 && canvasSize[1] > 0,
    String(canvasSize),
  );

  // ...and, crucially, that libass actually PAINTED something.
  //
  // The canvas existing proves nothing: a misconfigured font list makes
  // libass emit zero bitmaps while the worker starts, the canvas attaches
  // and no error is thrown anywhere. That exact bug shipped once and this
  // check is what catches it. The canvas has been transferred to a worker
  // so its pixels cannot be read from the page -- screenshot the composited
  // result instead and compare a frame inside a cue against one in a gap.
  const shotAt = async (t, file) => {
    await page.evaluate((time) => {
      const v = document.querySelector("video");
      // Hide the native controls first. They carry a moving playhead and a
      // changing time readout, so a screenshot diff between two moments
      // registers those as "changed pixels" and the check passes whether
      // or not libass drew a single glyph -- which is exactly how it
      // passed against a build that rendered no subtitles at all.
      v.controls = false;
      v.pause();
      v.currentTime = time;
    }, t);
    await page.waitForTimeout(2000);
    await page.locator(".stage").screenshot({ path: file });
    return file;
  };

  // 1.0s is inside the first cue (0.5-3.0); 3.25s is the gap before the
  // second (3.5-6.0). Both must come from THIS file's SRT above -- picking
  // a "gap" that is really inside a cue makes the two screenshots
  // identical and the check fails for the wrong reason.
  const cueShot = await shotAt(1.0, join(tmpdir(), "opensubs-cue.png"));
  const gapShot = await shotAt(3.25, join(tmpdir(), "opensubs-gap.png"));
  const a = gray(cueShot);
  const b = gray(gapShot);
  let differing = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (Math.abs(a[i] - b[i]) > 40) differing += 1;
  }
  check(
    "libass actually paints subtitle pixels",
    differing > 300,
    `only ${differing} pixels differ between a cue and a gap -- libass rendered nothing`,
  );

  console.log("clip");
  await page.fill('.field input[placeholder="0"]', "1");
  await page.waitForFunction(() => document.body.textContent.includes("Exporting"), {
    timeout: 5000,
  });
  check("trim reports the clip length", (await page.textContent("body")).includes("Exporting"));

  console.log("export");
  const cli = await page.textContent(".command code");
  check("cli command is emitted", cli.startsWith("opensubs burn "), cli);
  check("cli command carries the trim", cli.includes("--start 1.000"), cli);

  console.log("burn");
  // The whole point of the web app: finish the job in the page. This burns
  // a short clip and checks the file that comes out is real video with the
  // subtitles actually in the pixels.
  await page.fill('.field input[placeholder="0"]', "0");
  const burnButton = page.locator('button:has-text("Burn subtitles into the video")');
  const unsupported = await page.locator(".banner-danger").count();
  if (unsupported === 0 && (await burnButton.count()) > 0) {
    await burnButton.click();
    const save = page.locator('a:has-text("Save")');
    await save.waitFor({ timeout: 180000 });
    check("burn produced a file", true);

    const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
    const burned = join(tmpdir(), await download.suggestedFilename());
    await download.saveAs(burned);

    const probe = spawnSync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,width,height",
      "-of", "csv=p=0", burned,
    ]);
    const streams = String(probe.stdout).trim();
    check("burned file has a video stream at the output size", streams.includes("video,1280,720"), streams);

    // Subtitles in the pixels, not merely alongside them: a frame inside a
    // cue must differ from the same frame in the source, in the lower third
    // where the subtitle sits.
    const lowerThird = (file, t) =>
      spawnSync("ffmpeg", [
        "-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
        "-vf", "crop=iw:ih/3:0:ih*2/3", "-pix_fmt", "gray", "-f", "rawvideo", "-",
      ], { maxBuffer: 64 * 1024 * 1024 }).stdout;

    const burnedCue = lowerThird(burned, 1.0);
    const sourceCue = lowerThird(FIXTURE, 1.0);
    // An empty frame buffer would make the comparison below report "0
    // pixels changed", which reads as "no subtitles" when it actually
    // means "no frame". Distinguish the two.
    check(
      "frames could be read from both files",
      burnedCue.length > 0 && sourceCue.length > 0,
      `burned=${burnedCue.length} bytes, source=${sourceCue.length} bytes (${burned})`,
    );
    let changed = 0;
    for (let i = 0; i < Math.min(burnedCue.length, sourceCue.length); i += 1) {
      if (Math.abs(burnedCue[i] - sourceCue[i]) > 50) changed += 1;
    }
    check("subtitles are burned into the pixels", changed > 500, `${changed} pixels changed`);
  } else {
    console.log("  SKIPPED -- this browser cannot encode video");
  }

  console.log("translation routes");
  // The three routes are columns, not a dropdown: the choice is between
  // three unlike bargains, and a menu made them look like three flavours
  // of one thing while hiding the price behind an interaction.
  const routeLabels = await page.$$eval(
    '.card:has-text("Translate") .route .route-label',
    (els) => els.map((e) => e.textContent.trim()),
  );
  check(
    "the free on-device route is offered first",
    routeLabels[0] === "On this device",
    routeLabels.join(", "),
  );
  check(
    "a bring-your-own-key route is offered",
    routeLabels.some((r) => r.includes("your own API key") || r.includes("Your own API key")),
    routeLabels.join(", "),
  );

  // The vendors live inside the key route rather than beside the free one.
  await page.click('.card:has-text("Translate") .route:has-text("Your own API key")');
  await page.waitForTimeout(200);
  const vendors = await page.$$eval(
    '.card:has-text("Translate") .route-detail select option',
    (els) => els.map((e) => e.textContent.trim()),
  );
  check(
    "the key route offers several vendors",
    vendors.some((v) => v.includes("Claude")) && vendors.some((v) => v.includes("OpenAI")),
    vendors.join(", "),
  );
  await page.click('.card:has-text("Translate") .route:has-text("On this device")');

  console.log("both languages at once");
  {
    // Burning the translation *over* the original was impossible while
    // translating overwrote the cues. This drives the real control and
    // then reads the ASS that would be burned, so it fails if the second
    // language only reaches the editor.
    check(
      "the bilingual option is hidden until there is a translation",
      !(await page.locator('label:has-text("Keep the original on screen too")').count()),
      "offered with nothing to compare against",
    );

    // Translate for real, against the stand-in provider on this server.
    const card = page.locator('.card:has-text("Translate")');
    await card.locator('.route:has-text("Your own API key")').click();
    await card.locator(".route-detail select").selectOption("openai");
    await card.locator('label:has(.field-label:text-is("Into")) select').selectOption("fr");
    await card.locator('label:has(.field-label:text-is("API key")) input').fill("test-key");
    await card.locator('label:has(.field-label:text-is("Server")) input').fill(`${base}/fake`);
    await card.locator('button:has-text("Translate")').click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".cue textarea")].some((t) =>
          t.value.startsWith("Ligne "),
        ),
      { timeout: 30000 },
    );
    check("the translation replaces the visible cues", true);

    const both = page.locator('label:has-text("Keep the original on screen too")');
    check("the bilingual option appears once a translation exists", (await both.count()) > 0);

    if (await both.count()) {
      await both.locator("input").check();
      await page.waitForTimeout(800);

      const ass = await downloadText(page, 'button:has-text(".ass")');
      const dialogue = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
      check(
        "both languages are in the same burned event",
        dialogue.some(
          (l) => l.includes("The words, burned into the picture.") && l.includes("Ligne 1"),
        ),
        dialogue.join(" | ").slice(0, 300),
      );
      // A cue that arrived wrapped onto two lines must not become a
      // three-line cue the moment a translation goes under it. Reported
      // from production as "two English and one Chinese subtitles" --
      // nothing was duplicated, the English was simply pre-wrapped.
      const second = dialogue.find((l) => l.includes("A second cue"));
      check(
        "a pre-wrapped original is put back on one line",
        second !== undefined &&
          second.includes("A second cue, on two lines this time.") &&
          second.slice(second.indexOf(",,0,0,0,,") + 9).split("\\N").length === 2,
        second ?? "no event carried the two-line cue",
      );

      check(
        "the original leads when that is the chosen order",
        dialogue.some((l) => {
          const text = l.slice(l.indexOf(",,0,0,0,,") + 9);
          return text.indexOf("The words") < text.indexOf("Ligne 1");
        }),
        dialogue.join(" | ").slice(0, 300),
      );

      // The order control must actually reorder what is drawn.
      await page.locator('.bilingual label:has(.field-label:text-is("Order")) select').selectOption("translation-first");
      await page.waitForTimeout(800);
      const flipped = await downloadText(page, 'button:has-text(".ass")');
      check(
        "choosing translation-first puts it above the original",
        flipped.split("\n").filter((l) => l.startsWith("Dialogue:")).some((l) => {
          const text = l.slice(l.indexOf(",,0,0,0,,") + 9);
          return text.indexOf("Ligne 1") < text.indexOf("The words");
        }),
      );

      // Each language at its own size. The merge used to happen in JS,
      // which could only ever produce one size: cue text is escaped on the
      // way into a Dialogue line, so an override written into the text
      // arrives as a literal brace. The two sizes are proof the engine is
      // doing the joining now.
      const order = page.locator('.bilingual label:has(.field-label:text-is("Order")) select');
      const size = page.locator('.bilingual label:has(.field-label:text-is("Original size")) select');
      await order.selectOption("original-first");
      await size.selectOption("0.65");
      await page.waitForTimeout(800);
      const sized = await downloadText(page, 'button:has-text(".ass")');
      const event = sized.split("\n").find((l) => l.startsWith("Dialogue:")) ?? "";
      const sizes = [...event.matchAll(/\\fs(\d+)/g)].map((m) => Number(m[1]));
      check(
        "each language is set at its own size",
        sizes.length === 2 && sizes[0] < sizes[1],
        `${JSON.stringify(sizes)} in ${event}`,
      );
      check(
        "the outline is scaled with the type, not left at full weight",
        (() => {
          const b = [...event.matchAll(/\\bord([\d.]+)/g)].map((m) => Number(m[1]));
          return b.length === 2 && b[0] < b[1];
        })(),
        event,
      );
      // Word effects used to switch themselves off the moment both
      // languages were shown -- the right observation (a translation's
      // words cannot be matched to the audio) taken to the wrong
      // conclusion, because the language that *was* spoken is still on
      // screen. It is the one that lights up.
      await page
        .locator('label:has-text("Highlight each word as it is spoken") input')
        .check();
      await page.waitForTimeout(900);
      const lit = await downloadText(page, 'button:has-text(".ass")');
      const beats = lit.split("\n").filter((l) => l.startsWith("Dialogue:"));
      check(
        "word effects run with both languages on screen",
        beats.length > dialogue.length,
        `${beats.length} events for ${dialogue.length} cues`,
      );
      const ACCENT = "\\3c&H0000D4FF"; // the default #FFD400, as ASS writes it
      check(
        "the translation is on screen for every beat, and never lit",
        beats.length > 0 &&
          beats.every((l) => {
            const body = l.slice(l.indexOf(",,0,0,0,,") + 9);
            const at = body.indexOf("Ligne");
            if (at < 0) return false;
            // Exactly one word is highlighted, and it is in the original.
            if (body.split(ACCENT).length - 1 !== 1) return false;
            if (body.indexOf(ACCENT) > at) return false;
            // The translation is one plain run: nothing styles it further.
            return !body.slice(at).includes("\\fs") && !body.slice(at).includes("\\blur");
          }),
        beats[0] ?? "no events",
      );
      await page.locator('label:has-text("None") input[type=radio]').check();
      await page.waitForTimeout(600);

      await size.selectOption("1");
      await page.waitForTimeout(600);

      // Text exports must agree with the picture, or the .srt says one
      // thing and the burned file another.
      const srt = await downloadText(page, 'button:has-text(".srt")');
      check(
        "the .srt carries both languages too",
        srt.includes("The words, burned into the picture.") && srt.includes("Ligne 1"),
        srt.slice(0, 200),
      );
      // The text export and the picture have to agree about the reflow, or
      // the .srt says three lines and the burned video says two.
      check(
        "the .srt is reflowed the same way the picture is",
        srt.includes("A second cue, on two lines this time."),
        srt.slice(0, 400),
      );

      await both.locator("input").uncheck();
      await page.waitForTimeout(600);
      const single = await downloadText(page, 'button:has-text(".ass")');
      check(
        "unticking it goes back to one language",
        !single.split("\n").some((l) => l.startsWith("Dialogue:") && l.includes("The words")),
        "the original is still being drawn with the box unticked",
      );
    }

    // Put the subtitles and the route back for the checks that follow.
    await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
      name: "clip.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(SRT),
    });
    await page.waitForTimeout(600);
    await card.locator('.route:has-text("On this device")').click();
    await page.waitForTimeout(300);
  }

  console.log("non-Latin scripts");
  // Chinese subtitles used to render as rows of tofu boxes: libass in the
  // browser has no system fonts, and the bundled Liberation Sans has no
  // CJK glyphs. The `.srt` export looked perfect throughout, because that
  // is plain text and never touches a font.
  check(
    "a Latin-only track downloads no script font",
    scriptFontsFetched.size === 0,
    [...scriptFontsFetched].join(", "),
  );

  const beforeMisses = fontMisses.length;
  await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
    name: "zh.srt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "1\n00:00:00,500 --> 00:00:04,000\n简体中文字幕测试\n\n" +
        "2\n00:00:04,500 --> 00:00:07,000\n第二行字幕\n",
    ),
  });
  await page.waitForSelector(".cue");
  await page.waitForTimeout(4000);

  check(
    "the Chinese font is fetched when the subtitles need it",
    scriptFontsFetched.has("cjk"),
    [...scriptFontsFetched].join(", ") || "no script font was fetched",
  );
  // A second, weaker signal. libass logs a fontselect miss before drawing
  // a tofu box, so its absence is corroboration -- but deleting the CJK
  // font entirely did NOT reliably produce the line within this window,
  // so do not treat this one as the check that would catch a regression.
  // The fetch assertion above is the load-bearing one: it does fail.
  check(
    "libass reports no missing glyph for the Chinese text",
    fontMisses.length === beforeMisses,
    fontMisses.slice(beforeMisses, beforeMisses + 2).join(" | "),
  );

  console.log("font coverage warning");
  // Characters no bundled font covers burn in as empty rectangles with no
  // error anywhere, so the app has to say so before the export.
  await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
    name: "emoji.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("1\n00:00:00,500 --> 00:00:04,000\nNice one \u{1F389} really\n"),
  });
  await page.waitForSelector(".cue");
  await page.waitForTimeout(800);
  const warned = (await page.textContent("body")).includes("empty rectangles");
  check("unsupported characters are called out before burning", warned);

  console.log("Japanese and Traditional glyphs");
  {
    // APP-84. The CJK font was Noto Sans SC's Simplified slice and nothing
    // else, so 択 in 選択, 労 in 労働 and 閘 in 閘門 burned in as empty
    // rectangles -- 7.3% of real Japanese subtitle lines -- and the warning
    // told people to delete words their language cannot do without.
    //
    // First the reporter's own repro line, then the whole of the two tables
    // she asked for regression against, decoded from their legacy encodings
    // so there is no character list to keep in sync with anything.
    const importSrt = async (name, lines) => {
      const body = lines
        .map((text, i) => `${i + 1}\n00:00:${String(i).padStart(2, "0")},000 --> 00:00:${String(i).padStart(2, "0")},900\n${text}\n`)
        .join("\n");
      await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
        name,
        mimeType: "text/plain",
        buffer: Buffer.from(body),
      });
      await page.waitForSelector(".cue");
      await page.waitForTimeout(1500);
      const banners = await page.locator(".banner-danger").allTextContents();
      const banner = banners.find((t) => t.includes("No bundled font can draw"));
      const listed = banner
        ? (await page.locator(".banner-danger .oa-mono").first().textContent()).split(/\s+/).filter(Boolean)
        : [];
      return listed;
    };

    const repro = await importSrt("app-84.srt", ["選択 峠 枠 労働 麺 拡大 閘門 犧牲"]);
    check(
      "Japanese and Traditional characters in everyday words are drawable",
      repro.length === 0,
      `still reported: ${repro.join(" ")}`,
    );

    const decode = (encoding, codes) => {
      const decoder = new TextDecoder(encoding);
      let out = "";
      for (const [lead, trail] of codes) {
        const c = decoder.decode(Uint8Array.of(lead, trail));
        if ([...c].length === 1 && c !== "�") out += c;
      }
      return out;
    };
    const jisLevel1 = [];
    for (let lead = 0xb0; lead <= 0xcf; lead++) {
      for (let trail = 0xa1; trail <= 0xfe; trail++) jisLevel1.push([lead, trail]);
    }
    const big5Common = [];
    for (let code = 0xa440; code <= 0xc67e; code++) {
      const trail = code & 0xff;
      if ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0xa1 && trail <= 0xfe)) big5Common.push([code >> 8, trail]);
    }
    const chars = decode("euc-jp", jisLevel1) + decode("big5", big5Common);
    const lines = [];
    for (let i = 0; i < chars.length; i += 400) lines.push([...chars].slice(i, i + 400).join(""));
    // Eight Big5 common characters are in no slice of Noto Sans SC, JP or TC,
    // and scripts/make-fonts.py lists the same eight. Anything else here is a
    // regression in the font.
    const unavailable = new Set([..."姅杗歜穋觼詨跦鑤"]);
    const listed = await importSrt("jis-big5.srt", lines);
    check(
      "all of JIS level 1 and Big5 common is drawable, bar the eight no source has",
      listed.every((c) => unavailable.has(c)),
      `${[...chars].length} characters; unexpectedly reported: ${listed.filter((c) => !unavailable.has(c)).join(" ")}`,
    );
  }

  console.log("Chinese subtitle files");
  {
    // Two separate ways Chinese subtitles were broken, both of which
    // looked like the product simply could not do Chinese.
    //
    // 1. `File.text()` decodes as UTF-8 unconditionally, and Chinese .srt
    //    files are routinely GB18030. The cues arrived as mojibake.
    // 2. The glyph-coverage warning was written as hand-maintained
    //    Unicode ranges that had drifted from the fonts: the CJK range
    //    started at U+3040, so U+3001 and U+3002 -- the comma and full
    //    stop of every Chinese sentence -- were reported as undrawable.
    //    The font draws both. Users were told their subtitles would "burn
    //    in as empty rectangles" for writing an ordinary full stop.
    const zh = "这就是斯巴达！\n你好，世界。测试字幕、第二行。";
    const srt =
      "1\n00:00:00,500 --> 00:00:03,000\n这就是斯巴达！\n\n" +
      "2\n00:00:03,500 --> 00:00:06,000\n你好，世界。测试字幕、第二行。\n";

    // GB18030 bytes, the way a real Chinese subtitle file arrives.
    const gb = spawnSync("iconv", ["-f", "UTF-8", "-t", "GB18030"], { input: srt });
    if (gb.status !== 0) {
      console.log("  SKIPPED -- no iconv to build a GB18030 fixture");
    } else {
      await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
        name: "chinese-gb18030.srt",
        mimeType: "text/plain",
        buffer: gb.stdout,
      });
      await page.waitForTimeout(1200);
      const texts = await page.$$eval(".cue textarea", (e) => e.map((n) => n.value));
      check(
        "a GB18030 Chinese subtitle file reads as Chinese, not mojibake",
        texts[0] === "这就是斯巴达！",
        JSON.stringify(texts),
      );
      check(
        "the guessed encoding is shown so a wrong guess can be fixed",
        (await page.locator(".encoding-row").count()) > 0,
        "a wrong guess would be silent and unfixable",
      );

      // The warning must not fire on ordinary Chinese punctuation.
      const warning = await page.locator(".banner-danger, .banner-warn").allTextContents();
      check(
        "ordinary Chinese punctuation is not reported as undrawable",
        !warning.some((t) => t.includes("No bundled font can draw")),
        warning.join(" | "),
      );
    }

    // Translating *into* Chinese, and the spacing of what comes back.
    //
    // A translation is re-wrapped by the engine, which joins its tokens
    // with a space unless both sides of the boundary are CJK. "Both sides
    // are CJK" was decided by a range starting at U+3040, so a token
    // ending in `，` (U+FF0C) or `。` (U+3002) did not qualify and picked
    // up a space. `你好，世界。` came back as `你好， 世界。` and burned in
    // that way. Seventy-one Rust tests passed throughout; none of them
    // joined a token that ended in Chinese punctuation.
    {
      const card = page.locator('.card:has-text("Translate")');
      await card.locator('.route:has-text("Your own API key")').click();
      await card.locator(".route-detail select").selectOption("openai");
      await card.locator('label:has(.field-label:text-is("Into")) select').selectOption("zh-Hans");
      await card.locator('label:has(.field-label:text-is("API key")) input').fill("test-key");
      await card.locator('label:has(.field-label:text-is("Server")) input').fill(`${base}/fake`);
      await card.locator('button:has-text("Translate")').click();
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll(".cue textarea")].every((t) =>
              t.value.includes("这是第二行"),
            ),
          { timeout: 30000 },
        )
        .catch(() => {});
      const got = (await page.$$eval(".cue textarea", (e) => e.map((n) => n.value)))[0] ?? "";
      check(
        "Chinese punctuation takes no space after it once re-wrapped",
        got.includes("这是第二行") && !/[，。、！？：；]\s/.test(got),
        JSON.stringify(got),
      );
      await card.locator('.route:has-text("On this device")').click();
      await page.waitForTimeout(300);
    }

    // UTF-8 with a BOM: the BOM used to survive into the parser, where it
    // sits exactly where the first cue number should be.
    await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
      name: "chinese-bom.srt",
      mimeType: "text/plain",
      buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(srt, "utf8")]),
    });
    await page.waitForTimeout(1000);
    check(
      "a UTF-8 BOM does not eat the first cue",
      (await page.$$eval(".cue textarea", (e) => e.map((n) => n.value)))[0] === "这就是斯巴达！",
      "the BOM reached the parser",
    );

  }

  console.log("style thumbnails");
  // Each tile is a real libass render over a frame of the video, not a CSS
  // approximation -- so the check is that images actually arrive.
  await page
    .waitForFunction(() => document.querySelectorAll("img.style-shot").length >= 12, {
      timeout: 90000,
    })
    .catch(() => {});
  const shots = await page.$$eval("img.style-shot", (els) =>
    els.map((e) => (e.getAttribute("src") ?? "").length),
  );
  check("every preset gets a rendered thumbnail", shots.length >= 12, `${shots.length} tiles`);
  check(
    "thumbnails carry actual image data",
    shots.every((len) => len > 1500),
    `smallest was ${Math.min(...shots)} bytes of data URL`,
  );

  console.log("style change re-renders the preview");
  // Assert the *pixels* change, not that the canvas still exists.
  //
  // JASSUB renders on `requestVideoFrameCallback`, so a paused video
  // presents no frames and `setTrack` updates the worker's copy of the
  // subtitles while nothing on screen moves. Changing style or toggling
  // emphasis appeared to do nothing until you pressed play. The old
  // version of this check — "the canvas is still there" — passed happily
  // throughout.
  // Park past the last cue first. A user who has played the clip through
  // sits here, and with no subtitle on screen a style change looks like it
  // did nothing -- so selecting a style moves the playhead onto a cue.
  const lastCueEnd = 7.5;
  const beforeStyle = await shotAt(lastCueEnd, join(tmpdir(), "opensubs-style-before.png"));
  await page.click('.style-tile:has(.style-name:text-is("Podcast"))');
  await page.waitForTimeout(2500);
  await page.locator(".stage").screenshot({ path: join(tmpdir(), "opensubs-style-after.png") });
  const afterStyle = join(tmpdir(), "opensubs-style-after.png");

  const beforePixels = gray(beforeStyle);
  const afterPixels = gray(afterStyle);
  let moved = 0;
  for (let i = 0; i < Math.min(beforePixels.length, afterPixels.length); i += 1) {
    if (Math.abs(beforePixels[i] - afterPixels[i]) > 40) moved += 1;
  }
  check(
    "a style change shows itself even when parked past the last cue",
    moved > 200,
    `${moved} pixels changed -- the preview did not repaint, or did not seek to a cue`,
  );

  console.log("work survives a navigation");
  {
    // Signing in is a full-page redirect, so the tab is destroyed and
    // rebuilt. Pressing "sign in" to pay for a translation used to throw
    // away the transcription the user was about to translate -- and threw
    // it away even if they abandoned the sign-in. A reload is that same
    // destruction, so it is what this tests.
    const before = await page.$$eval(".cue textarea", (e) => e.map((n) => n.value));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const offered = await page.locator(".restore-card").count();
    check(
      "subtitles are offered back after a full page load",
      offered > 0,
      "no restore card -- a sign-in would have cost the transcription",
    );
    if (offered > 0) {
      await page.click('button:has-text("Restore subtitles")');
      await page.waitForTimeout(1200);
      const after = await page.$$eval(".cue textarea", (e) => e.map((n) => n.value));
      check(
        "the restored subtitles are the same ones",
        after.length === before.length && after.every((t, i) => t === before[i]),
        `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
      );
    }
    // Put the page back. The reload destroyed the video element's source --
    // which is the point of the test -- and every later check needs it, so
    // this test must restore the world it disturbed rather than leaving the
    // rest of the suite to fail on a null <video>.
    await page.setInputFiles('input[accept="video/*"]', FIXTURE);
    await page.waitForFunction(
      () => {
        const v = document.querySelector("video");
        return v && v.videoWidth > 0;
      },
      { timeout: 30000 },
    );
    await page.waitForTimeout(1500);
    await page.evaluate(() => localStorage.removeItem("opensubs.work"));
  }

  console.log("the video survives a navigation too");
  {
    // The subtitles surviving was only half of it. The burn section is
    // gated on the video's dimensions, so a sign-in that kept the cues and
    // dropped the video left the export looking as though it had been
    // taken away -- reported as "video is gone, Export does not have a
    // button for burn".
    //
    // The fix stores a `FileSystemFileHandle`, never the footage. This
    // test drives it with a *real* handle rather than a stub: Playwright
    // cannot answer Chromium's file dialog, but OPFS hands out genuine
    // handles with no dialog at all, so everything after the picker --
    // the IndexedDB round trip, the permission check, `getFile()` -- is
    // the real code path on a real object. Only Chrome's own dialog is
    // out of frame.
    const supported = await page.evaluate(() => "showOpenFilePicker" in window);
    if (!supported) {
      console.log("  SKIPPED -- this browser has no File System Access API");
    } else {
      // Stub only the dialog: it returns a handle to a copy of the
      // fixture living in the origin's private filesystem.
      // Start from the empty state, and click the video input itself:
      // `.dropzone` also matches the subtitle one, and the input is what
      // both the label and the keyboard end up dispatching to anyway.
      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForSelector(".features-card", { timeout: 15000 });
      await page.evaluate(async (url) => {
        const bytes = await (await fetch(url)).arrayBuffer();
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle("clip.webm", { create: true });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        window.showOpenFilePicker = async () => [handle];
      }, `${base}/clip.webm`);
      await page.$eval('input[accept="video/*"]', (el) => el.click());
      const picked = await page
        .waitForFunction(() => {
          const v = document.querySelector("video");
          return v && v.videoWidth > 0;
        }, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      check("the handle-aware picker loads a video", picked);

      await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
        name: "sample.srt",
        mimeType: "text/plain",
        buffer: Buffer.from(SRT),
      });
      await page.waitForSelector(".cue", { timeout: 5000 });
      await page.waitForTimeout(1500);

      // The sign-in redirect, again.
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      const offered = await page.locator(".resume-video").count();
      check(
        "the video is offered back after a full page load",
        offered > 0,
        "no offer -- the handle did not survive, so the burn section stays gone",
      );

      if (offered > 0) {
        check(
          "the offer names the file",
          (await page.textContent(".resume-video-text")).includes("clip.webm"),
        );
        await page.click(".resume-video button");
        const back = await page
          .waitForFunction(() => {
            const v = document.querySelector("video");
            return v && v.videoWidth > 0;
          }, { timeout: 20000 })
          .then(() => true)
          .catch(() => false);
        check("the video comes back without being re-picked", back);

        await page.click('button:has-text("Restore subtitles")').catch(() => {});
        await page.waitForTimeout(1500);
        // The whole point: the export is whole again.
        check(
          "the burn button is there after signing in",
          (await page.locator('button:has-text("Burn subtitles into the video")').count()) > 0,
          "the video came back but the export did not",
        );
      }

      // A picker that fails must fall back to the ordinary dialog, not
      // leave a dead dropzone. That failure mode is worse than the bug
      // this whole section fixes, so it gets its own check: stub the API
      // to throw, click, and assert the native file chooser opens.
      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForSelector(".features-card", { timeout: 15000 });
      await page.evaluate(() => {
        window.showOpenFilePicker = async () => {
          throw new Error("simulated picker failure");
        };
      });
      let nativeDialogOpened = false;
      const onChooser = (fc) => {
        nativeDialogOpened = true;
        fc.setFiles(FIXTURE).catch(() => {});
      };
      page.on("filechooser", onChooser);
      // The next click logs, on purpose. Only this exact message is
      // excused, and only here, so the suite keeps failing on every other
      // console error.
      expectedConsoleError = "simulated picker failure";
      // Real clicks, not synthetic ones: opening a file dialog needs
      // transient user activation, which `element.click()` does not carry.
      // `.dropzone` alone would also match the subtitle one.
      //
      // The first click is the one that discovers the breakage, and it
      // cannot be rescued in flight -- the gesture is spent by the time
      // the rejection arrives. What must hold is that the app says so and
      // the *next* click opens the ordinary dialog.
      await page.click(".dropzone:not(.dropzone-sm)");
      await page.waitForTimeout(800);
      check(
        "a failing picker says so rather than doing nothing",
        (await page.locator(".field-error").count()) > 0,
        "a silent dead dropzone is the failure this whole section is about",
      );
      await page.click(".dropzone:not(.dropzone-sm)");
      await page.waitForTimeout(1500);
      page.off("filechooser", onChooser);
      expectedConsoleError = null;
      check(
        "the click after a picker failure opens the ordinary file dialog",
        nativeDialogOpened,
        "the dropzone stays dead, which is worse than the bug being fixed",
      );

      // Leave nothing behind for the checks that follow.
      await page.evaluate(async () => {
        localStorage.removeItem("opensubs.work");
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry("clip.webm");
        } catch {}
        indexedDB.deleteDatabase("opensubs");
      });
      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForSelector(".features-card", { timeout: 15000 });
      await page.setInputFiles('input[accept="video/*"]', FIXTURE);
      await page.waitForFunction(
        () => {
          const v = document.querySelector("video");
          return v && v.videoWidth > 0;
        },
        { timeout: 30000 },
      );
      await page.setInputFiles('input[accept=".srt,.vtt,text/vtt"]', {
        name: "sample.srt",
        mimeType: "text/plain",
        buffer: Buffer.from(SRT),
      });
      await page.waitForSelector(".cue", { timeout: 5000 });
      await page.waitForTimeout(1500);
    }
  }

  console.log("word highlight moves with the audio");
  // The check that separates the two word effects. Sizing by loudness is
  // static: the line arrives fully formed and two moments inside one cue
  // look identical. The highlight is a *time* effect, so the same two
  // moments must differ. A build where "karaoke" silently fell back to the
  // plain writer would pass any check that only compared effect-on against
  // effect-off.
  await page.locator('label:has-text("Highlight each word as it is spoken") input').check();
  await page.waitForTimeout(1200);
  const early = gray(await shotAt(1.0, join(tmpdir(), "opensubs-karaoke-early.png")));
  const late = gray(await shotAt(3.5, join(tmpdir(), "opensubs-karaoke-late.png")));
  let travelled = 0;
  for (let i = 0; i < Math.min(early.length, late.length); i += 1) {
    if (Math.abs(early[i] - late[i]) > 40) travelled += 1;
  }
  check(
    "the highlight is on a different word at two moments in one cue",
    travelled > 200,
    `${travelled} pixels changed -- the highlight did not move, so this is not a time effect`,
  );
  await page.locator('label:has-text("None") input[type=radio]').check();
  console.log("credits");
  // The hosted provider is only offered when its endpoint is configured,
  // so this build has to opt in the same way a developer would.
  {
    await page.selectOption('label:has(.field-label:text-is("Into")) select', { index: 1 });
    await page.click('.card:has-text("Translate") .route:has-text("OpenSubs")');
    await page.waitForTimeout(400);

    // Three routes, side by side, so the trade-off is the layout rather
    // than something a dropdown hides.
    const routes = await page.$$eval('.card:has-text("Translate") .route .route-label', (e) =>
      e.map((n) => n.textContent.trim()),
    );
    check(
      "translation offers all three routes at once",
      routes.length === 3,
      `saw ${JSON.stringify(routes)}`,
    );
    await page.waitForTimeout(300);
    // Signed out, which is how every visitor arrives. The price must still
    // be on screen: someone deciding whether this is worth an account has
    // to be able to see what it costs before making one.
    const bar = (await page.textContent(".credit-bar")) ?? "";
    check(
      "the price is visible before signing in",
      /\d+\s+credits?\s*·\s*\$\d/.test(bar),
      `credit bar read ${JSON.stringify(bar.replace(/\s+/g, " ").trim())}`,
    );
    check(
      "signed out, the bar says what to do about it",
      /sign in/i.test(bar),
      `credit bar read ${JSON.stringify(bar.replace(/\s+/g, " ").trim())}`,
    );
    check(
      "a sign-in control is offered",
      (await page.locator("openapps-login").count()) > 0,
      "no <openapps-login> element rendered",
    );
    check(
      "the pack price is stated in dollars",
      /1000\s+credits\s+cost\s+\$5\.00/.test(
        (await page.textContent('.card:has-text("Translate")')) ?? "",
      ),
      "the page does not say what a pack costs",
    );

    const button = await page.textContent('button:has-text("Translate for")');
    check(
      "the button names the price it will charge",
      /Translate for \d+ credits?$/.test((button ?? "").trim()),
      `button read ${JSON.stringify(button)}`,
    );
  }

} else {
  console.log("video + libass preview");
  console.log("  SKIPPED -- ffmpeg is not available to generate a WebM fixture");
}

check(
  "the production CSP blocks nothing the app needs",
  cspViolations.length === 0,
  cspViolations.join(" | "),
);

// Hugging Face serves the speech model, and its CDN redirects to a
// per-region host. Everything else would be new, and worth knowing about.
const ALLOWED_HOSTS = /(^|\.)huggingface\.co$|(^|\.)hf\.co$|(^|\.)opensubs\.app$/;
const unexpected = [...externalHosts].filter((h) => !ALLOWED_HOSTS.test(h));
check(
  "the page contacts no third party it should not",
  unexpected.length === 0,
  `contacted ${unexpected.join(", ")}`,
);

// The marketing page and the app are one document now, so their two
// stylesheets are on the page together. Six class names were defined by
// both -- `brand`, `btn`, `btn-primary`, `btn-secondary`, `card`, `tag` --
// and the marketing ones carry a `site-` prefix because of it.
//
// A collision does not throw and does not look broken in review: a button
// quietly takes the other sheet's padding. So the overlap is measured
// rather than remembered.
{
  const classesIn = (css) => {
    const found = new Set();
    for (const m of css.matchAll(/[.]([a-zA-Z][\w-]*)/g)) found.add(m[1]);
    return found;
  };
  const inline = await page.evaluate(() =>
    [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n"),
  );
  const linked = await page.evaluate(async () => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
    const bodies = await Promise.all(links.map((l) => fetch(l.href).then((r) => r.text())));
    return bodies.join("\n");
  });
  const shared = [...classesIn(inline)].filter((c) => classesIn(linked).has(c));
  check(
    "the page's two stylesheets share no class name",
    shared.length === 0,
    shared.join(", "),
  );
}

// The point of moving the app onto the indexed hostname. If the copy ever
// starts being rendered by script, this fails before anyone deploys it.
{
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  const source = await (await fetch(base)).text();
  check(
    "the headline is in the served HTML, not just the rendered DOM",
    source.includes("Subtitle any video, without uploading it anywhere"),
  );
  check(
    "the marketing sections are in the served HTML too",
    source.includes("Four steps, none of them on a server"),
  );
  check("the app mounts into that same page", html.includes('id="app"'));
}

// What the tracker asked for, checked against the built files rather than
// against the running app: every one of these is a property of the HTML a
// crawler is handed, and the crawler does not run our JavaScript.
{
  const home = await readFile(join(DIST, "index.html"), "utf8");
  const landing = await readFile(join(DIST, "burn-subtitles-into-video.html"), "utf8");
  const sitemap = await readFile(join(DIST, "sitemap.xml"), "utf8");
  const robots = await readFile(join(DIST, "robots.txt"), "utf8");

  // APP-45: all three titles used "subtitle" as a verb, so the page never
  // contained the noun phrase anybody searches for.
  check(
    "the homepage title names a subtitle generator",
    /subtitle generator/i.test(home.match(/<title>([^<]*)<\/title>/)?.[1] ?? ""),
  );
  check(
    "so does the h1",
    /subtitle generator/i.test(home.match(/<h1>([^<]*)<\/h1>/)?.[1] ?? ""),
  );
  check(
    "and og:title matches the title",
    /subtitle generator/i.test(home.match(/og:title" content="([^"]*)"/)?.[1] ?? ""),
  );
  // ...and the sentence it replaced is still on the page, one level down.
  check(
    "the old headline survives as the subhead",
    home.includes("Subtitle any video, without uploading it anywhere."),
  );

  // APP-48: the tool is client-rendered, so the served HTML had no trace of
  // it. A file input is the smallest proof that it does now.
  check("the served HTML contains the tool's file input", /type="file"/.test(home));
  check("the landing page carries it too", /type="file"/.test(landing));
  check("and the site links to #app", /href="#app"/.test(home));

  // APP-49: a second indexable URL, with its own title and its own canonical.
  check(
    "the landing page has its own title",
    /burn subtitles into video/i.test(landing.match(/<title>([^<]*)<\/title>/)?.[1] ?? ""),
  );
  check(
    "and its own canonical",
    landing.includes('href="https://opensubs.app/burn-subtitles-into-video"'),
  );
  // One FAQPage per site. Two copies of the same eight questions on two
  // URLs is duplicate structured data, not twice as much of it.
  check("only the homepage carries the FAQ schema", !landing.includes('"FAQPage"'));

  // APP-48.3: a sitemap that does not list a page is a page nobody crawls.
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const pages = ["https://opensubs.app/", "https://opensubs.app/privacy.html",
                 "https://opensubs.app/burn-subtitles-into-video"];
  check(
    "every page that exists is in the sitemap",
    pages.every((u) => listed.includes(u)),
    `sitemap has ${listed.join(", ")}`,
  );

  // APP-47: some crawlers read only their own User-agent block.
  for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
    check(`robots.txt names ${bot}`, robots.includes(bot));
  }
}

// APP-32: which model the page starts on, and why it depends on WebGPU.
{
  const modelSelect = '.card:has-text("Subtitles") select';
  const chosen = async (pg) => {
    const sels = pg.locator(modelSelect);
    for (let i = 0; i < (await sels.count()); i += 1) {
      const options = await sels.nth(i).locator("option").allTextContents();
      if (options.some((o) => /MB/.test(o))) {
        return options[await sels.nth(i).evaluate((el) => el.selectedIndex)];
      }
    }
    return "";
  };

  // This harness has no WebGPU at all -- checked, not assumed -- so the
  // page must start on Base. Small on the WASM backend cannot load the
  // quantised weights and would pull about a gigabyte of fp32 instead.
  check(
    "without WebGPU the page starts on Base",
    /Base/.test(await chosen(page)),
    await chosen(page),
  );

  // And with it, on Small. Stubbed rather than skipped: the branch that
  // only runs on other people's machines is the one worth a test.
  const gpuCtx = await browser.newContext();
  await gpuCtx.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ name: "stub" }) },
    });
  });
  const gpuPage = await gpuCtx.newPage();
  await gpuPage.goto(base, { waitUntil: "networkidle" });
  await gpuPage.waitForTimeout(1200);
  check(
    "with WebGPU it starts on Small",
    /Small/.test(await chosen(gpuPage)),
    await chosen(gpuPage),
  );

  // ...and a choice the user has made is never overwritten.
  const sels = gpuPage.locator(modelSelect);
  for (let i = 0; i < (await sels.count()); i += 1) {
    const options = await sels.nth(i).locator("option").allTextContents();
    if (options.some((o) => /MB/.test(o))) {
      const base = options.find((o) => /Base/.test(o));
      if (base) await sels.nth(i).selectOption({ label: base });
      break;
    }
  }
  await gpuPage.waitForTimeout(600);
  check("a model the user picked is left alone", /Base/.test(await chosen(gpuPage)), await chosen(gpuPage));
  await gpuCtx.close();
}

check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

await browser.close();
server.close();

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
