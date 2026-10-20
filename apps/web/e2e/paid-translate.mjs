// The paid translation panel, end to end, against a faked accounts server
// and gateway.
//
//   npm run build && node e2e/paid-translate.mjs [--shots DIR]
//
// Nothing here reaches a real server or spends a credit: both hosts are
// Playwright routes, and what is measured is what the page shows and what
// it sends. The interface runs in Simplified Chinese throughout, so every
// message checked is also checked for being translated.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// DIST=<dir> runs the same checks against another build, such as the
// composed site in ../../website-deploy.
const DIST = resolve(process.env.DIST ?? resolve(HERE, "../dist"));
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
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

const SRT = (lines) =>
  lines.map((l, i) => `${i + 1}\n00:00:0${i * 3},000 --> 00:00:0${i * 3 + 2},500\n${l}\n`).join("\n");
const ENGLISH = ["This is a sample video, subtitled in your browser.", "Nothing was uploaded to make these captions."];
const KOREAN = ["안녕하세요 여러분, 오늘은 자막을 만드는 방법을 보여 드리겠습니다", "영상을 올리면 브라우저에서 바로 자막이 만들어집니다"];
const KOREAN_BACK = ["안녕하세요 여러분, 오늘은 라이스 대학교가 텍사스와 경기를 합니다", "이 영상에서는 자막을 만드는 방법을 보여 드리겠습니다"];

// --- the two servers ----------------------------------------------------

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (expIn) =>
  `${b64url({ alg: "EdDSA" })}.${b64url({ sub: "u-review", sid: "s1", exp: Math.floor(Date.now() / 1000) + expIn })}.sig`;
const expOf = (t) => {
  try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).exp; } catch { return 0; }
};

const state = { balance: 40, revoked: false, gateway: "ok", gatewayQueue: [] };
const gatewayCalls = [];
const refreshes = [];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
const bearerOf = (req) => (req.headers()["authorization"] ?? "").replace(/^Bearer /, "");
const valid = (t) => !state.revoked && expOf(t) * 1000 > Date.now();

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 1000 } });

await context.route("https://auth.opensubs.app/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const url = new URL(req.url());
  switch (url.pathname) {
    case "/v1/credits/balance":
      return valid(bearerOf(req))
        ? json(route, 200, { balance: state.balance })
        : json(route, 401, { error: { code: "unauthorized", message: "token expired" } });
    case "/v1/auth/refresh": {
      refreshes.push(Date.now());
      if (state.revoked) return json(route, 401, { error: { code: "unauthorized", message: "revoked" } });
      return json(route, 200, { access_token: token(900), refresh_token: `r${refreshes.length}` });
    }
    case "/v1/auth/methods":
      return json(route, 200, { methods: ["nostr"] });
    case "/v1/me":
      return json(route, 200, { id: "u-review", balance: state.balance, linked_accounts: [] });
    case "/v1/payments/packages":
      return json(route, 200, {
        packages: [{ id: "starter", credits: 1000, usd_price: 500 }, { id: "pro", credits: 5000, usd_price: 2000 }],
        rails: { stripe: true },
      });
    default:
      return json(route, 200, {});
  }
});

await context.route("https://gateway.opensubs.app/**", async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const body = req.postDataJSON();
  const call = { key: body.idempotency_key, target: body.target, source: body.source, lines: body.lines, bearer: bearerOf(req) };
  gatewayCalls.push(call);
  const mode = state.gatewayQueue.shift() ?? state.gateway;
  if (mode === "401" || !valid(call.bearer)) return json(route, 401, { error: "unauthorized" });
  if (mode === "502") return json(route, 502, { error: "vendor_error" });
  if (mode === "already") {
    return json(route, 409, { error: "already_charged", message: "this job was already completed and paid for" });
  }
  const translations =
    body.target === "ko" ? body.lines.map((_, i) => KOREAN_BACK[i % KOREAN_BACK.length]) : body.lines.map((l) => `[${body.target}] ${l}`);
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

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const panel = page.locator("#panel-translate");
const button = panel.locator(".checkbox-row button").first();
const into = panel.locator("select").first();

async function open(lines, name = "subs.srt") {
  await page.waitForFunction(() => !!document.querySelector('input[type=file][accept*=".srt"]'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.locator('input[type=file][accept*=".srt"]').first().setInputFiles({
    name, mimeType: "text/plain", buffer: Buffer.from(SRT(lines)),
  });
  await page.click("#tab-translate");
  await panel.waitFor();
}
async function paidRoute() {
  await panel.locator(".routes .route").nth(2).click();
  await page.waitForTimeout(400);
}
async function signIn(expIn = 900) {
  await page.evaluate((t) => {
    localStorage.setItem("openapps.session", JSON.stringify({ accessToken: t, refreshToken: "r0" }));
  }, token(expIn));
}
async function reload() {
  await page.reload();
}
async function cueTexts() {
  await page.click("#tab-subtitles");
  const values = await page.locator("textarea.cue-text").evaluateAll((els) => els.map((e) => e.value));
  await page.click("#tab-translate");
  return values;
}
async function translateNow() {
  await button.click();
  await page.waitForFunction(() => {
    const b = document.querySelector("#panel-translate .checkbox-row button");
    return b && !/\d+\/\d+|正在翻译/.test(b.textContent ?? "");
  }, null, { timeout: 30000 });
  await page.waitForTimeout(300);
}
/**
 * One group of checks. A group that cannot run -- a control missing from
 * the build under test -- is a failure of that group, and the rest still
 * run, so an older build shows every place it differs rather than the first.
 */
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    check(false, `${name}: could not run`, String(e.message ?? e).split("\n")[0]);
  }
}
const shot = async (name) => shots && panel.screenshot({ path: join(shots, `${name}.png`) });

// --- signed out: the cards and the sign-in prompt ------------------------
await section("signed out: the cards and the sign-in prompt", async () => {

  await page.goto(base);
  await open(ENGLISH);
  const notes = await panel.locator(".route-note").allInnerTexts();
  check(notes[0] === "逐句直译 · 不上传", "the free card says what the result is like", notes[0]);
  check(notes[1] === "自选模型 · 费用由服务商收取", "the own-key card says who bills", notes[1]);
  check(notes[2] === "发布级质量 · 结合上下文 · 译文自然", "the paid card says what is paid for", notes[2]);
  await paidRoute();
  check(await panel.locator("openapps-login").isVisible(), "signed out, the paid route asks for a sign-in");
  check((await panel.locator("openapps-buy").count()) === 0, "signed out, no credit packs");
  await shot("1-signed-out");
});

// --- signed in, with a balance: balance and a Top up button --------------
await section("signed in, with a balance: balance and a Top up button", async () => {

  await signIn();
  await reload();
  await open(ENGLISH);
  await paidRoute();
  await panel.locator(".credit-balance-count").waitFor({ timeout: 10000 });
  check((await panel.locator(".credit-balance-count").innerText()) === "40 点数", "the balance is shown, in the interface's language",
    await panel.locator(".credit-balance-count").innerText());
  check((await panel.locator("openapps-buy").count()) === 0, "with a balance, the packs stay closed");
  const topUp = panel.getByRole("button", { name: "充值" });
  check(await topUp.isVisible(), "with a balance, a Top up button is offered");
  await shot("2-balance");
  await topUp.click();
  check(await panel.locator("openapps-buy").isVisible(), "Top up opens the packs");
  await shot("3-top-up-open");
  await panel.getByRole("button", { name: "收起充值" }).click();
});

// --- signed in, no balance: the packs open by themselves ------------------
await section("signed in, no balance: the packs open by themselves", async () => {

  state.balance = 0;
  await reload();
  await open(ENGLISH);
  await paidRoute();
  await page.waitForTimeout(800);
  check(await panel.locator("openapps-buy").isVisible(), "with no balance, the packs are open without a click");
  check((await panel.getByRole("button", { name: "充值" }).count()) === 0, "with no balance, there is no Top up button to press first");
  await shot("4-no-balance");
  state.balance = 40;
});

// --- translating, and translating the same thing again --------------------
await section("translating, and translating the same thing again", async () => {

  await reload();
  await open(ENGLISH);
  await paidRoute();
  await into.selectOption("zh-Hans");
  await page.waitForTimeout(300);
  check((await button.innerText()) === "翻译，1 点数", "a new job is priced, in the interface's language", await button.innerText());
  await translateNow();
  check(gatewayCalls.length === 1, "the first run goes to the gateway", `${gatewayCalls.length} calls`);
  check(gatewayCalls[0]?.source === "auto", "an unestablished source is sent as auto, not as a guess", gatewayCalls[0]?.source);
  await into.selectOption("ja");
  await translateNow();
  check(gatewayCalls.length === 2, "another language is another job", `${gatewayCalls.length} calls`);
  await into.selectOption("zh-Hans");
  await page.waitForTimeout(300);
  check((await button.innerText()) === "已翻译，免费重新应用", "a language already paid for says so on the button", await button.innerText());
  const priceOnCard = await panel.locator(".routes .route").nth(2).locator(".route-price").innerText();
  check(priceOnCard === "已付费 · 再次应用免费", "and on the card", priceOnCard);
  await shot("5-already-translated");
  await translateNow();
  check(gatewayCalls.length === 2, "applying it again sends nothing", `${gatewayCalls.length} calls`);
  const again = await cueTexts();
  check(again[0].replace(/\n/g, " ") === `[zh-Hans] ${ENGLISH[0]}`, "and puts back the text that was paid for", again[0]);

  await reload();
  await open(ENGLISH);
  await paidRoute();
  await into.selectOption("zh-Hans");
  await page.waitForTimeout(300);
  check((await button.innerText()) === "已翻译，免费重新应用", "what was paid for is still known after a reload", await button.innerText());
});

// --- Korean keeps its spaces ----------------------------------------------
await section("Korean keeps its spaces", async () => {

  await into.selectOption("ko");
  await translateNow();
  const korean = await cueTexts();
  check(korean[0].includes(" "), "a Korean translation keeps the spaces between words", JSON.stringify(korean[0]));
  check(korean[0].replace(/\n/g, " ") === KOREAN_BACK[0], "and breaks its lines only at a space", JSON.stringify(korean[0]));
  await shot("6-korean");
});

// --- the same language as the subtitles -----------------------------------
await section("the same language as the subtitles", async () => {

  await reload();
  await open(KOREAN, "ko.srt");
  await paidRoute();
  const koOption = into.locator('option[value="ko"]');
  check(await koOption.evaluate((o) => o.disabled), "the subtitles' own language cannot be picked");
  check((await koOption.innerText()).includes("字幕原文的语言"), "and says why", await koOption.innerText());
  // A target already set to it (restored work, or set before the language was
  // known) is refused with a reason rather than sent.
  await into.evaluate((el) => { el.value = "ko"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(300);
  const before = gatewayCalls.length;
  check(await button.isDisabled(), "translating into it is not possible");
  check((await panel.locator(".field-error").innerText()).includes("字幕已经是这种语言"), "and the panel says the subtitles are already in it");
  await shot("7-same-language");
  check(gatewayCalls.length === before, "nothing is sent");
  await into.selectOption("en");
  check(!(await button.isDisabled()), "another language is still offered");
});

// --- failures, in the interface's language --------------------------------
await section("failures, in the interface's language", async () => {

  await reload();
  await open(ENGLISH);
  await paidRoute();
  state.gateway = "502";
  await into.selectOption("es");
  await translateNow();
  const failure = await panel.locator(".field-error").innerText();
  check(failure === "无法连接翻译服务。未扣费。", "a gateway failure is reported in Chinese", failure);
  await shot("8-failure-localised");

  state.gateway = "already";
  await into.selectOption("de");
  await translateNow();
  const alreadyMsg = await panel.locator(".field-error").innerText();
  check(alreadyMsg.startsWith("这段内容之前已翻译并付费"), "a job the gateway has as paid, with no copy held, is explained", alreadyMsg);
  state.gateway = "ok";
  await translateNow();
  const last = gatewayCalls[gatewayCalls.length - 1];
  check(last.key.endsWith("-g1"), "and running it again is a new job under a new key", last.key);
});

// --- a token that ran out while the page sat open --------------------------
await section("a token that ran out while the page sat open", async () => {

  await reload();
  await open(ENGLISH);
  await paidRoute();
  await page.waitForTimeout(800);
  // The access token ran out a minute ago while the page sat open; the
  // session behind it is fine. The SDK reads its store on every call.
  await signIn(-60);
  const refreshesBefore = refreshes.length;
  await into.selectOption("fr");
  await translateNow();
  const viaGateway = gatewayCalls[gatewayCalls.length - 1];
  check(refreshes.length > refreshesBefore, "a stale token is renewed before paying");
  check(expOf(viaGateway.bearer) * 1000 > Date.now(), "the gateway is sent the renewed token");
  check((await panel.locator(".field-error").count()) === 0, "and the translation goes through, with no sign-in prompt");

  state.gatewayQueue.push("401");
  await into.selectOption("it");
  const callsBefore401 = gatewayCalls.length;
  await translateNow();
  check(gatewayCalls.length === callsBefore401 + 2, "a gateway 401 is answered by renewing and asking once more", `${gatewayCalls.length - callsBefore401} calls`);
  check((await panel.locator(".field-error").count()) === 0, "and the second answer is used");
});

// --- a session that ended while the page was in the background -------------
await section("a session that ended while the page was in the background", async () => {

  state.revoked = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1500);
  const expiredText = await panel.locator(".credit-balance").first().innerText();
  check(expiredText.includes("登录已过期"), "coming back to the page, an ended session is shown as ended", expiredText);
  check((await panel.locator(".credit-balance-count").count()) === 0, "no balance is shown for it");
  check((await panel.locator("openapps-signout").count()) === 0, "and no Sign out");
  check(await panel.locator("openapps-login").isVisible(), "a sign-in is offered instead");
  await shot("9-expired");
});

check(errors.length === 0, "no page errors", errors.join(" | "));
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
