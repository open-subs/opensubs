// The desktop window's account and cloud-translation flow, end to end in a
// browser: the built front end, with Tauri's IPC answered by a stand-in and
// the account and gateway hosts answered by routes. Nothing here charges
// anyone.
//
// What it pins:
//   - the "What's included" panel shows the real catalogue (read from the
//     engine compiled to WebAssembly), and none of it is internal wording;
//   - local features say Free, and only translation mentions credits;
//   - choosing cloud translation while signed out says what to do, and
//     never starts a job;
//   - signed in, the exact price is shown before anything is charged, the
//     export runs with the paid translations, and a shortfall offers to
//     buy credits instead of failing silently.
//
// Run with: npm run build && node e2e/account.spec.mjs
// Writes screenshots to $SCREENSHOT_DIR when it is set.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(HERE, "..", "dist");
const WASM = join(HERE, "..", "..", "web", "src", "wasm-gen");
const SHOTS = process.env.SCREENSHOT_DIR;

// --- the real catalogue, from the engine ---------------------------------

const engine = await import(join(WASM, "subs_engine.js"));
engine.initSync({ module: readFileSync(join(WASM, "subs_engine_bg.wasm")) });
const features = JSON.parse(engine.features());

// --- a static server for the built front end ------------------------------

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
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

// --- the Tauri side, stood in for ----------------------------------------

const LINES = ["So this is the plan for tomorrow.", "We start at nine, sharp.", "Bring the slides."];
const MEDIA = {
  filename: "talk.mp4", displayWidth: 1920, displayHeight: 1080,
  duration: 42.5, fps: 30, hasAudio: true, isHdr: false,
};

function tauriMock(state) {
  const callbacks = new Map();
  let next = 1;
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
      const answers = {
        list_styles: [
          { name: "Clean", font: "Inter", sizePct: 5, alignment: 2, primaryHex: "#ffffff", backHex: "#000000", borderStyle: "outline", pack: "Core" },
          { name: "Neon", font: "Inter", sizePct: 5, alignment: 2, primaryHex: "#7cf", backHex: "#000", borderStyle: "outline", pack: "Advanced" },
        ],
        list_features: state.features,
        list_languages: [
          { code: "zh-Hans", name: "Chinese (Simplified)", endonym: "简体中文" },
          { code: "ja", name: "Japanese", endonym: "日本語" },
        ],
        translation_ready: true,
        get_model_path: "/models/ggml-base.bin",
        check_ffmpeg: { found: true, missing: [], install: null },
        list_downloadable_models: [],
        "plugin:dialog|open": "/videos/talk.mp4",
        probe: state.media,
        transcribe_for_cloud: { jobId: "job-1", lines: state.lines, language: "en", credits: state.price },
        burn: "/videos/talk.subbed.mp4",
      };
      if (cmd.startsWith("plugin:event|")) return next++;
      if (cmd in answers) return answers[cmd];
      return null;
    },
  };
}

async function open(browser, { signedIn, balance, price }) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  const calls = { translate: [] };
  await page.route("https://auth.opensubs.app/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/credits/balance") return route.fulfill({ json: { balance } });
    if (url.pathname === "/v1/payments/packages") {
      return route.fulfill({ json: { packages: [{ id: "starter", credits: 1000, usd_price: 500 }], rails: { stripe: true } } });
    }
    if (url.pathname === "/v1/me") return route.fulfill({ json: { id: "u1", display_name: "Test" } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route("https://gateway.opensubs.app/**", async (route) => {
    const body = route.request().postDataJSON();
    calls.translate.push(body);
    return route.fulfill({
      json: { translations: body.lines.map((l) => `译: ${l}`), charged: price, new_balance: balance - price },
    });
  });
  await page.addInitScript(
    ([state, session]) => {
      if (session) localStorage.setItem("openapps.session", JSON.stringify(session));
      (0, eval)(`(${state.mock})`)(state);
    },
    [
      { mock: tauriMock.toString(), features, media: MEDIA, lines: LINES, price },
      signedIn ? { accessToken: "test-access", refreshToken: "test-refresh" } : null,
    ],
  );
  await page.goto(base);
  return { page, calls };
}

// --- checks ---------------------------------------------------------------

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
  if (!ok) failures += 1;
}

async function shot(page, name, locator) {
  if (!SHOTS) return;
  await (locator ? page.locator(locator) : page).screenshot({ path: join(SHOTS, `${name}.png`) });
}

const browser = await chromium.launch();

console.log("the included-features panel");
{
  const { page } = await open(browser, { signedIn: false, balance: 0, price: 5 });
  await page.click(".features-toggle");
  await page.waitForSelector(".feature-row");
  const panel = await page.textContent(".features-card");
  const internal = ["competitor", "study", "spec", "§", "conversion", "tier", "Premium", "Submagic", "Opus Clip", "Captions is"];
  const found = internal.filter((w) => panel.toLowerCase().includes(w.toLowerCase()));
  check("no internal vocabulary", found.length === 0, found.join(", "));
  check("no Chinese in the English panel", !/[⺀-鿿]/.test(panel));
  const rows = await page.$$eval(".feature-row", (els) =>
    els.map((e) => ({ title: e.querySelector(".feature-title").textContent, tag: e.querySelector(".tag").textContent.trim() })),
  );
  check("one row per catalogue entry", rows.length === features.length, `${rows.length} vs ${features.length}`);
  const paid = rows.filter((r) => r.tag !== "Free");
  check("only translation mentions credits", paid.length === 1 && paid[0].tag === "Free, or credits", JSON.stringify(paid));
  check("the header says what is true", panel.includes("No account, no watermark, no export limit."));
  await shot(page, "features-panel", ".features-card");
  await page.close();
}

async function loadVideo(page) {
  await page.click(".drop-zone");
  await page.waitForSelector("text=talk.mp4");
  await page.selectOption("select >> nth=1", "zh-Hans");
}

console.log("cloud translation, signed out");
{
  const { page } = await open(browser, { signedIn: false, balance: 0, price: 5 });
  await loadVideo(page);
  await page.check('input[value="cloud"]');
  const button = page.locator(".burn-row .btn-primary");
  check("the export button names the next step", (await button.textContent()).includes("See the price"));
  check("it cannot start while signed out", await button.isDisabled());
  check("it says what to do", (await page.textContent(".burn-row")).includes("needs an account"));
  const calls = await page.evaluate(() => window.__calls.map((c) => c.cmd));
  check("nothing was transcribed or exported", !calls.includes("transcribe_for_cloud") && !calls.includes("burn"));
  await shot(page, "cloud-signed-out", ".screen");
  await page.close();
}

console.log("cloud translation, signed in with enough credits");
{
  const { page, calls } = await open(browser, { signedIn: true, balance: 120, price: 5 });
  await loadVideo(page);
  await page.check('input[value="cloud"]');
  await page.click(".burn-row .btn-primary");
  await page.waitForSelector(".price-card");
  const card = await page.textContent(".price-card");
  check("the price is shown before anything is charged", card.includes("5 credits") && calls.translate.length === 0, card);
  check("it says what you have", card.includes("You have 120 credits"));
  await shot(page, "price-before-charge", ".screen");
  await page.click("text=Translate and burn");
  await page.waitForSelector(".success-card");
  check("the gateway was asked once, with the priced lines", calls.translate.length === 1 && calls.translate[0].lines.length === LINES.length);
  check("the request carries a job key, never a price", "idempotency_key" in calls.translate[0] && !("price" in calls.translate[0]) && !("credits" in calls.translate[0]));
  const burn = await page.evaluate(() => window.__calls.find((c) => c.cmd === "burn")?.args?.options);
  check("the export runs with the paid translations", burn?.cloud?.jobId === "job-1" && burn.cloud.translations.length === LINES.length, JSON.stringify(burn));
  check("the balance updates", (await page.textContent(".account-btn")).includes("115 credits"));
  await page.close();
}

console.log("cloud translation, not enough credits");
{
  const { page, calls } = await open(browser, { signedIn: true, balance: 2, price: 5 });
  await loadVideo(page);
  await page.check('input[value="cloud"]');
  await page.click(".burn-row .btn-primary");
  await page.waitForSelector(".price-card");
  const card = await page.textContent(".price-card");
  check("the shortfall is stated", card.includes("You need 3 credits more"), card);
  check("buying is offered instead of a translate button", (await page.locator("text=Buy credits").count()) === 1 && (await page.locator("text=Translate and burn").count()) === 0);
  await page.click("text=Buy credits");
  await page.waitForSelector(".account-card");
  check("the account panel opens", (await page.textContent(".account-card")).includes("Checkout opens in your browser"));
  check("nothing was sent to the gateway", calls.translate.length === 0);
  await shot(page, "not-enough-credits", ".screen");
  await page.close();
}

console.log("translating on this computer still needs no account");
{
  const { page } = await open(browser, { signedIn: false, balance: 0, price: 5 });
  await loadVideo(page);
  const button = page.locator(".burn-row .btn-primary");
  check("the free route is the default", await page.isChecked('input[value="device"]'));
  check("and exports without signing in", !(await button.isDisabled()) && (await button.textContent()).includes("Burn subtitles"));
  await button.click();
  await page.waitForSelector(".success-card");
  const burn = await page.evaluate(() => window.__calls.find((c) => c.cmd === "burn")?.args?.options);
  check("with no cloud translations attached", !burn?.cloud);
  await page.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? "\nall green" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
