// The "having trouble? ask us on Telegram" box, where things fail.
//
//   npm run build && node e2e/support.mjs
//   SUPPORT_SERVER=http://127.0.0.1:18517 \
//     SUPPORT_SESSION='{"accessToken":…,"refreshToken":…,"topupId":…}' node e2e/support.mjs
//
// For the light and dark schemes (the app is light-only; the box must follow
// it rather than the OS), it checks that the box is offered:
//
//   - under a burn that failed (the encoder refuses, on a real clip);
//   - where a sign-in came back without a session;
//   - beside the credit packs while a purchase is pending (SUPPORT_SESSION);
//   - and in the footer, as the "Ask us on Telegram" and "Follow @OpenSubsApp
//     on X" outlined buttons;
//
// and that each one opens a panel pointing at the OpenSubs topic on Telegram
// in a new tab, shows the error code (or the pending top-up id) to include,
// and sends nothing: no request to the old /v1/support/messages route.
//
// Requests to auth.opensubs.app go to SUPPORT_SERVER when it is set (a local
// openapps-server) and to a stand-in in this file otherwise. Nothing reaches
// the real account server. The clip is made with ffmpeg; without it the burn
// case is skipped.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(HERE, "../dist");
const SHOTS = process.env.SHOTS ?? join(HERE, "output-support");
// Fixed, because the local account server's CORS list names it.
const PORT = Number(process.env.SUPPORT_E2E_PORT ?? 5518);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const AUTH = "https://auth.opensubs.app";
const SERVER = process.env.SUPPORT_SERVER ?? null;
const TELEGRAM = "https://t.me/openappsnetwork/57";
const X_URL = "https://x.com/OpenSubsApp";
const SESSION = process.env.SUPPORT_SESSION ? JSON.parse(process.env.SUPPORT_SESSION) : null;
const SCHEMES = (process.env.SCHEMES ?? "light,dark").split(",");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".onnx": "application/octet-stream",
};

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/ is missing -- run `npm run build` first.");
  process.exit(2);
}
await mkdir(SHOTS, { recursive: true });

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  if (path === "/__opensubs-support-e2e") return res.writeHead(200).end("opensubs");
  try {
    const target = join(DIST, path === "/" ? "/index.html" : path);
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      // What the site sends, so SharedArrayBuffer and the encoder behave as live.
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok, fail) => {
  server.once("error", fail);
  server.listen(PORT, "127.0.0.1", ok);
});

// A two-second clip and two cues, made here rather than committed.
const CLIP = join(SHOTS, "clip.mp4");
const SRT = join(SHOTS, "clip.srt");
let haveClip = existsSync(CLIP);
if (!haveClip) {
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15", "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", CLIP]);
    haveClip = true;
  } catch {
    console.log("  (no ffmpeg: the burn case is skipped)");
  }
}
await writeFile(SRT, "1\n00:00:00,200 --> 00:00:00,900\nHello there\n\n2\n00:00:01,000 --> 00:00:01,800\nA second line\n");

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sent = [];

async function wire(context) {
  // The site's page counter is not part of the app; never let a test count.
  await context.route(/\/script\.js$|\/api\/send$/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route((url) => url.href.startsWith(AUTH), async (route) => {
    const req = route.request();
    const path = req.url().slice(AUTH.length);
    if (path.startsWith("/v1/support/messages")) sent.push(`${req.method()} ${path}`);
    if (SERVER) {
      const response = await route.fetch({ url: SERVER + path, headers: { ...req.headers(), origin: ORIGIN } });
      return route.fulfill({ response });
    }
    const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,DELETE" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path.startsWith("/v1/auth/methods")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ methods: { google: true } }) });
    if (path.startsWith("/v1/payments/packages")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ packages: [], rails: {} }) });
    return route.fulfill({ status: 401, headers: cors, contentType: "application/json", body: JSON.stringify({ error: { code: "unauthorized", message: "unauthorized" } }) });
  });
}

async function triggerIn(page, selector) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el && !el.hasAttribute("data-empty") && el.shadowRoot?.querySelector(".trigger");
  }, selector, { timeout: 30_000 });
  return page.locator(`${selector} .trigger`).first();
}

/**
 * Open the box at `host` and check the panel: the Telegram topic in a new
 * tab, the X link, the code to include, and that nothing was sent.
 */
async function openFrom(page, host, { name, code, shotName }) {
  const before = sent.length;
  await (await triggerIn(page, host)).click();
  const dialog = page.locator(`${host} dialog[open]`).first();
  await dialog.waitFor({ timeout: 10_000 });
  const tg = dialog.locator('[data-testid="support-telegram"]');
  check(`${name}: points at the OpenSubs topic`, (await tg.getAttribute("href")) === TELEGRAM, await tg.getAttribute("href"));
  check(`${name}: opens Telegram in a new tab`, (await tg.getAttribute("target")) === "_blank" && /noopener/.test((await tg.getAttribute("rel")) ?? ""));
  check(`${name}: offers the X account`, (await dialog.locator('[data-testid="support-x"]').getAttribute("href")) === X_URL);
  check(`${name}: no message form`, (await dialog.locator("textarea, form").count()) === 0);
  let shown = null;
  if (code) {
    const value = dialog.locator('[data-testid="support-code-value"]');
    shown = (await value.count()) ? (await value.innerText()).trim() : "";
    check(`${name}: shows the code to include`, code(shown), shown);
    check(`${name}: the code can be copied`, (await dialog.locator('[data-testid="support-copy"]').count()) === 1);
    check(`${name}: no file name in the code`, !/clip\.(mp4|srt)/.test(shown), shown);
  }
  if (shotName) await page.screenshot({ path: join(SHOTS, `${shotName}-dialog.png`) });
  await dialog.locator("button.btn:not(.small)").first().click(); // Close
  check(`${name}: sends nothing`, sent.length === before, sent.slice(before).join(", "));
  return shown;
}

const browser = await chromium.launch({ args: ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] });
try {
  for (const scheme of SCHEMES) {
    console.log(`\n${scheme}`);
    const options = { viewport: { width: 1180, height: 1000 }, colorScheme: scheme, locale: "en-US" };

    // --- the quiet line ---------------------------------------------------
    {
      const context = await browser.newContext(options);
      await wire(context);
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/`);
      const link = await triggerIn(page, ".web-footer openapps-support");
      check("Telegram button in the footer", await link.isVisible(), (await link.innerText()).trim());
      check("the button says Telegram", /Telegram/.test(await link.innerText()));
      const follow = page.locator(".web-footer openapps-support [data-testid=support-x-quiet]");
      check("Follow @OpenSubsApp on X, in the footer", (await follow.getAttribute("href")) === X_URL && /@OpenSubsApp/.test(await follow.innerText()), (await follow.innerText()).trim());
      check("the X link opens in a new tab", (await follow.getAttribute("target")) === "_blank" && /noopener/.test((await follow.getAttribute("rel")) ?? ""));
      // One pair: both drawn with their brand glyph, same size, no underline.
      const looks = async (loc) => loc.evaluate((a) => {
        const svg = a.querySelector("svg");
        const text = a.querySelector("span") ?? a;
        const cs = getComputedStyle(text);
        return { glyph: !!svg && svg.getAttribute("fill") === "currentColor", size: cs.fontSize, underline: cs.textDecorationLine !== "none" || getComputedStyle(a).textDecorationLine !== "none", color: getComputedStyle(a).color };
      });
      const [tgLook, xLook] = [await looks(link), await looks(follow)];
      check("both buttons carry their glyph", tgLook.glyph && xLook.glyph);
      check("neither is underlined", !tgLook.underline && !xLook.underline);
      check("same size and colour", tgLook.size === xLook.size && tgLook.color === xLook.color, `${tgLook.size}/${xLook.size} ${tgLook.color}/${xLook.color}`);
      await openFrom(page, ".web-footer openapps-support", { name: "footer" });
      await page.locator(".web-footer").screenshot({ path: join(SHOTS, `opensubs-${scheme}-quiet.png`) });
      if (scheme === "light") {
        await page.evaluate(() => localStorage.setItem("opensubs.locale", "zh-Hant"));
        await page.reload();
        const zh = await triggerIn(page, ".web-footer openapps-support");
        check("the line follows the interface language", /問我們/.test(await zh.innerText()), (await zh.innerText()).trim());
        check("so does the X link", /追蹤 @OpenSubsApp/.test(await page.locator(".web-footer openapps-support [data-testid=support-x-quiet]").innerText()));
        await zh.click();
        const dialog = page.locator(".web-footer openapps-support dialog[open]");
        await dialog.waitFor();
        check("the box is in Traditional Chinese", /OpenSubs 話題/.test(await dialog.innerText()));
        await page.screenshot({ path: join(SHOTS, `opensubs-${scheme}-zh-dialog.png`) });
      }
      await context.close();
    }

    // --- a burn that failed ----------------------------------------------
    if (haveClip) {
      const context = await browser.newContext(options);
      await wire(context);
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/`);
      await page.waitForSelector('input[accept^="video/*"]', { state: "attached", timeout: 30_000 });
      await page.setInputFiles('input[accept^="video/*"]', CLIP);
      await page.waitForFunction(() => document.querySelector(".file-meta")?.textContent?.includes("×"), null, { timeout: 120_000 });
      await page.locator('input[accept=".srt,.vtt,text/vtt"]').first().setInputFiles(SRT);
      await page.waitForSelector(".cue", { timeout: 30_000 });
      // The encoder refuses partway, as a GPU encoder that runs out of
      // memory does.
      await page.evaluate(() => {
        VideoEncoder.prototype.encode = function () {
          throw new DOMException("The encoder could not take another frame", "EncodingError");
        };
      });
      // With cues on screen the settings are tabs; the burn is under Export.
      await page.locator("#tab-export").click();
      const burn = page.locator('button:has-text("Burn subtitles into the video")');
      if ((await burn.count()) === 0 || (await burn.isDisabled())) {
        check("burning is offered in this browser", false);
      } else {
        await burn.click();
        const error = page.locator(".card .field-error").first();
        await error.waitFor({ timeout: 120_000 });
        const host = ".card openapps-support[context=\"export\"]";
        await triggerIn(page, host);
        await error.scrollIntoViewIfNeeded();
        const card = page.locator("section.card", { has: page.locator('openapps-support[context="export"]') }).first();
        const box = await card.boundingBox();
        const errBox = await error.boundingBox();
        // The part of the card that matters: from a little above the error to the box.
        await page.screenshot({
          path: join(SHOTS, `opensubs-${scheme}-burn-failed.png`),
          clip: { x: box.x, y: Math.max(box.y, errBox.y - 160), width: box.width, height: Math.min(260, box.y + box.height - Math.max(box.y, errBox.y - 160)) },
        });
        await openFrom(page, host, {
          name: "burn failure",
          code: (c) => c.startsWith("burn"),
          shotName: `opensubs-${scheme}-burn`,
        });
      }
      await context.close();
    }

    // --- a sign-in that came back without a session ----------------------
    {
      const context = await browser.newContext(options);
      await wire(context);
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/#code=not-a-real-code`);
      await page.locator('[data-testid="signin-failed"]').waitFor({ timeout: 30_000 });
      const host = '[data-testid="signin-failed"] openapps-support';
      check("a failed sign-in is said, with the box", await (await triggerIn(page, host)).isVisible());
      const prompt = await page.locator(`${host} .prompt`).innerText();
      check("at a failure: \"Having trouble?\" and the Telegram button", /Having trouble\?/.test(prompt) && /Ask us on Telegram/.test(prompt), prompt.replace(/\s+/g, " "));
      const look = await page.locator(`${host} .trigger`).evaluate((b) => getComputedStyle(b).borderTopStyle);
      check("at a failure: the button is outlined", look === "solid", look);
      await page.locator('[data-testid="signin-failed"]').screenshot({ path: join(SHOTS, `opensubs-${scheme}-signin-failed.png`) });
      await openFrom(page, host, {
        name: "sign-in failure",
        code: (c) => c === "signin:no_session",
        shotName: scheme === "light" ? `opensubs-${scheme}-signin` : null,
      });
      await context.close();
    }

    // --- a purchase still pending ----------------------------------------
    if (SESSION) {
      const context = await browser.newContext(options);
      await wire(context);
      await context.addInitScript((s) => {
        localStorage.setItem("openapps.session", JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken }));
      }, SESSION);
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/`);
      if (haveClip) {
        await page.waitForSelector('input[accept^="video/*"]', { state: "attached", timeout: 30_000 });
        await page.setInputFiles('input[accept^="video/*"]', CLIP);
        await page.waitForFunction(() => document.querySelector(".file-meta")?.textContent?.includes("×"), null, { timeout: 120_000 });
      }
      await page.locator('input[accept=".srt,.vtt,text/vtt"]').first().setInputFiles(SRT);
      await page.waitForSelector(".cue", { timeout: 30_000 });
      // The hosted translation: the credit bar, and with no balance the
      // packs, beside which a pending purchase is offered the box.
      await page.locator("#tab-translate").click();
      await page.locator("#panel-translate").getByRole("radio", { name: /OpenSubs/ }).first().click();
      const host = '.credit-topup openapps-support[auto="pending-topup"]';
      const prompt = await triggerIn(page, host);
      check("a pending purchase offers the box", await prompt.isVisible(), (await prompt.innerText()).trim());
      await page.locator(".credit-topup").first().scrollIntoViewIfNeeded();
      await page.locator(".credit-topup").first().screenshot({ path: join(SHOTS, `opensubs-${scheme}-payment-pending.png`) });
      await openFrom(page, host, {
        name: "payment",
        code: (c) => c === String(SESSION.topupId),
        shotName: `opensubs-${scheme}-payment`,
      });
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\nscreenshots in ${SHOTS}`);
check("nothing posted to the old message route", sent.length === 0, sent.join(", "));
if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
