// Restored work, end to end: the subtitles come back after a reload with the
// language they are in, and without the video the page says how to carry on.
//
//   npm run build && node e2e/restore.mjs [--shots DIR]
//
// Both servers are Playwright routes, so nothing reaches a real account and no
// credit is spent; what is measured is what the page shows and what it sends.
// The interface runs in Simplified Chinese throughout, and the browser is given
// a language detector that works, so "Translate from" starts on "detect
// automatically" -- which is what it does in a Chrome that has the model.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(process.env.DIST ?? resolve(HERE, "../dist"));
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".mp4": "video/mp4",
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const target = join(DIST, path === "/" ? "/index.html" : path);
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

// A short silent clip the browser can decode, named like the sample.
function makeVideo() {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return null;
  const out = join(mkdtempSync(join(tmpdir(), "opensubs-restore-")), "talk.webm");
  spawnSync("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25", "-t", "6",
    "-c:v", "libvpx", "-b:v", "300k", "-an", out,
  ]);
  return existsSync(out) ? out : null;
}
const VIDEO = makeVideo();

const SRT = (lines) =>
  lines.map((l, i) => `${i + 1}\n00:00:0${i * 3},000 --> 00:00:0${i * 3 + 2},500\n${l}\n`).join("\n");
const ENGLISH = ["This is a sample video, subtitled in your browser.", "Nothing was uploaded to make these captions."];

// --- the two servers ----------------------------------------------------

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (expIn) =>
  `${b64url({ alg: "EdDSA" })}.${b64url({ sub: "u-restore", sid: "s1", exp: Math.floor(Date.now() / 1000) + expIn })}.sig`;

const state = { balance: 40 };
const gatewayCalls = [];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 1000 } });
await context.addInitScript(() => {
  // A detector that works, as in a Chrome with the model downloaded.
  self.LanguageDetector = {
    availability: async () => "available",
    create: async () => ({ detect: async () => [{ detectedLanguage: "en", confidence: 0.99 }] }),
  };
  // The plain file input, so Playwright sees the chooser open.
  delete window.showOpenFilePicker;
});

await context.route("https://auth.opensubs.app/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const url = new URL(req.url());
  switch (url.pathname) {
    case "/v1/credits/balance":
      return json(route, 200, { balance: state.balance });
    case "/v1/auth/refresh":
      return json(route, 200, { access_token: token(900), refresh_token: "r1" });
    case "/v1/auth/methods":
      return json(route, 200, { methods: ["nostr"] });
    case "/v1/me":
      return json(route, 200, { id: "u-restore", balance: state.balance, linked_accounts: [] });
    case "/v1/payments/packages":
      return json(route, 200, { packages: [{ id: "starter", credits: 1000, usd_price: 500 }], rails: { stripe: true } });
    default:
      return json(route, 200, {});
  }
});

// The gateway as deployed: same language refused, a key it has seen replayed
// for nothing, anything else charged one credit.
const seen = new Map();
await context.route("https://gateway.opensubs.app/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const body = req.postDataJSON();
  gatewayCalls.push({ key: body.idempotency_key, target: body.target, source: body.source });
  const base = (c) => String(c ?? "").split("-")[0].toLowerCase();
  if (body.source && body.source !== "auto" && base(body.source) === base(body.target) && base(body.target) !== "zh") {
    return json(route, 400, { error: "same_language" });
  }
  if (seen.has(body.idempotency_key)) {
    return json(route, 200, { translations: seen.get(body.idempotency_key), charged: 0, new_balance: state.balance });
  }
  const translations = body.lines.map((l) => `[${body.target}] ${l}`);
  seen.set(body.idempotency_key, translations);
  state.balance -= 1;
  return json(route, 200, { translations, charged: 1, new_balance: state.balance });
});

// --- helpers ------------------------------------------------------------

let failed = 0;
let passed = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${!ok && detail ? ` -- ${detail}` : ""}`);
  if (ok) passed += 1; else failed += 1;
};
async function section(name, fn) {
  console.log(name);
  try {
    await fn();
  } catch (e) {
    check(false, `${name}: could not run`, String(e.message ?? e).split("\n")[0]);
  }
}

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const panel = page.locator("#panel-translate");
const button = panel.locator(".checkbox-row button").first();
const into = panel.locator("select").first();
const fromPicker = panel.locator('label:has(.field-label:text-is("源语言")) select');
const shot = async (name, target = page) => shots && target.screenshot({ path: join(shots, `${name}.png`) });

async function ready() {
  await page.waitForFunction(() => !!document.querySelector('input[type=file][accept*=".srt"]'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
}
async function translateNow() {
  await button.click();
  await page.waitForFunction(() => {
    const b = document.querySelector("#panel-translate .checkbox-row button");
    return b && !/\d+\/\d+|正在翻译/.test(b.textContent ?? "");
  }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
}
async function paidRoute() {
  await panel.locator(".routes .route").nth(2).click();
  await page.waitForTimeout(500);
}
async function deviceRoute() {
  await panel.locator(".routes .route").nth(0).click();
  await page.waitForTimeout(300);
}

// --- work on a video, translate it, reload ------------------------------

await page.goto(base);
await page.evaluate((t) => {
  localStorage.setItem("openapps.session", JSON.stringify({ accessToken: t, refreshToken: "r0" }));
}, token(900));
await page.reload();
await ready();

await section("before the reload: a video, English subtitles, one paid translation", async () => {
  if (VIDEO) {
    await page.locator('input[type=file][accept="video/*"]').first().setInputFiles(VIDEO);
    await page.waitForFunction(() => (document.querySelector("video")?.videoWidth ?? 0) > 0, null, { timeout: 20000 });
  }
  await page.locator('input[type=file][accept*=".srt"]').first().setInputFiles({
    name: "talk.srt", mimeType: "text/plain", buffer: Buffer.from(SRT(ENGLISH)),
  });
  await page.click("#tab-translate");
  await panel.waitFor();
  // The person says what the subtitles are in -- the same thing the
  // recogniser does when it hears one language.
  await deviceRoute();
  await fromPicker.selectOption("en");
  await paidRoute();
  await into.selectOption("zh-Hans");
  await page.waitForTimeout(400);
  await translateNow();
  check(gatewayCalls.length === 1, "the first translation goes to the gateway", `${gatewayCalls.length} calls`);
  check(gatewayCalls[0]?.source === "en", "and is sent as English", gatewayCalls[0]?.source);
  check(state.balance === 39, "and costs one credit", `balance ${state.balance}`);
});

await page.reload();
await ready();

await section("the restore card, and restoring", async () => {
  await page.locator(".restore-card").waitFor({ timeout: 10000 });
  await shot("1-restore-card", page.locator(".restore-card"));
  await page.locator(".restore-card button", { hasText: "恢复字幕" }).click();
  await page.waitForTimeout(800);
  check((await page.locator("textarea.cue-text").count()) === 2, "the cues are back");
});

await section("without the video: the page says what is missing and how to get it back", async () => {
  const empty = page.locator("[data-no-video]");
  check((await empty.count()) === 1, "the player says the video is not loaded, rather than sitting empty");
  const said = (await empty.innerText().catch(() => "")).replace(/\s+/g, " ");
  check(said.includes("字幕已恢复。烧录需要重新载入视频。"), "it says the subtitles are back and the video is needed to burn", said);
  check(said.includes("talk.webm") || !VIDEO, "and names the video they were made for", said);
  check((await empty.locator("label", { hasText: "重新载入视频" }).count()) === 1, "with a button to load it again");
  const meta = await page.locator(".file-row .file-meta").innerText();
  check(!meta.includes("正在读取"), "the player is not captioned 'reading…' for ever", meta);
  check((await page.locator("#tab-subtitles").count()) === 0, "no Subtitles tab holding only a sentence and nothing to press");
  check((await page.getByText("重新生成", { exact: true }).count()) === 0, "and no 'Generate again' without a video to generate from");
  await shot("2-no-video", page.locator(".workspace"));
});

await section("export: burning is first, and is there without a video", async () => {
  await page.click("#tab-export");
  const exportPanel = page.locator("#panel-export");
  const heads = await exportPanel.locator(".subsection-title").allInnerTexts();
  check(heads[0] === "烧录了字幕的视频", "the burned-in video comes first", JSON.stringify(heads));
  check(heads.includes("字幕文件"), "the subtitle file is still offered", JSON.stringify(heads));
  const load = exportPanel.locator("label", { hasText: "先载入视频" });
  check((await load.count()) === 1, "without a video, the button says to load it first");
  await shot("3-export-no-video", exportPanel);
  if (VIDEO && (await load.count())) {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }), load.click()]);
    check(!!chooser, "and pressing it opens the file picker");
    await chooser.setFiles(VIDEO);
    await page.waitForFunction(() => (document.querySelector("video")?.videoWidth ?? 0) > 0, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const burn = exportPanel.getByRole("button", { name: "将字幕烧录进视频" });
    check(await burn.isVisible(), "once it loads, the burn button is there");
    check((await page.locator("[data-no-video]").count()) === 0, "and the player shows the video");
    await shot("4-export-with-video", exportPanel);
  }
});

await section("the language came back with the subtitles", async () => {
  await page.click("#tab-translate");
  await deviceRoute();
  const from = await fromPicker.inputValue();
  check(from === "en", "'Translate from' is still English, not 'detect automatically'", from);
  await paidRoute();
  check((await into.inputValue()) === "zh-Hans", "the target is still Simplified Chinese", await into.inputValue());
  const label = await button.innerText();
  check(label === "已翻译，不计费", "the button says it is already translated and not charged", label);
  check(await button.isDisabled(), "and cannot be pressed, since that translation is on screen");
  const card = await panel.locator(".routes .route").nth(2).locator(".route-price").innerText();
  check(card === "已翻译，不计费", "the paid card says the same", card);
  await shot("5-already-translated", panel);
  const calls = gatewayCalls.length;
  if (!(await button.isDisabled())) await translateNow();
  check(gatewayCalls.length === calls, "nothing is sent again", `${gatewayCalls.length - calls} more calls`);
  check(state.balance === 39, "and nothing more is charged", `balance ${state.balance}`);
});

await section("the subtitles' own language is refused after a restore", async () => {
  const en = into.locator('option[value="en"]');
  check(await en.evaluate((o) => o.disabled), "English cannot be picked as the target");
  await into.evaluate((el) => { el.value = "en"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(400);
  check(await button.isDisabled(), "translating into it is not possible");
  check((await panel.locator(".field-error").innerText().catch(() => "")).includes("字幕已经是这种语言"),
    "and the panel says the subtitles are already in it");
  await shot("6-same-language", panel);
  const calls = gatewayCalls.length;
  if (!(await button.isDisabled())) await translateNow();
  check(gatewayCalls.length === calls, "nothing is sent", `${gatewayCalls.length - calls} more calls`);
  check(state.balance === 39, "and nothing is charged", `balance ${state.balance}`);
});

await section("a new language is priced; picking a paid one again shows it at once", async () => {
  await into.selectOption("ja");
  await page.waitForTimeout(400);
  check((await button.innerText()) === "翻译 · 1 点数", "a language not yet translated says what it costs", await button.innerText());
  await shot("7-priced", panel);
  await translateNow();
  check(state.balance === 38, "translating it costs one credit", `balance ${state.balance}`);
  const calls = gatewayCalls.length;
  await into.selectOption("zh-Hans");
  await page.waitForTimeout(1000);
  const cue = await page.locator("textarea.cue-text").first().inputValue();
  check(cue.replace(/\n/g, " ") === `[zh-Hans] ${ENGLISH[0]}`, "picking the paid language again puts that translation on screen", cue);
  check(gatewayCalls.length === calls, "without sending anything", `${gatewayCalls.length - calls} more calls`);
  check((await button.innerText()) === "已翻译，不计费" && (await button.isDisabled()), "and the button says so");
});

await section("a gateway refusing the same language is explained", async () => {
  // Only reachable when the page did not know the language and the gateway
  // did; forced here by sending a request the page would not.
  await page.evaluate(() => {
    const realFetch = window.fetch;
    window.fetch = (url, init) => {
      if (String(url).includes("gateway.opensubs.app") && init?.body) {
        const body = JSON.parse(init.body);
        body.source = body.target;
        init = { ...init, body: JSON.stringify(body) };
      }
      return realFetch(url, init);
    };
  });
  await into.selectOption("ko");
  await page.waitForTimeout(300);
  await translateNow();
  const err = await panel.locator(".field-error").innerText().catch(() => "");
  check(err.includes("字幕已经是这种语言"), "the refusal is shown in the interface's language", err);
  check(state.balance === 38, "and nothing is charged", `balance ${state.balance}`);
});

check(errors.length === 0, "no page errors", errors.join(" | "));
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
