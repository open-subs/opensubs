// The "having trouble? leave us a message" box, where things fail.
//
//   npm run build && node e2e/support.mjs
//   SUPPORT_SERVER=http://127.0.0.1:18517 SUPPORT_ADMIN_TOKEN=… \
//     SUPPORT_SESSION='{"accessToken":…,"refreshToken":…,"topupId":…}' node e2e/support.mjs
//
// For the light and dark schemes (the app is light-only; the box must follow
// it rather than the OS), it checks that the box is offered:
//
//   - under a burn that failed (the encoder refuses, on a real clip);
//   - where a sign-in came back without a session;
//   - beside the credit packs while a purchase is pending (SUPPORT_SESSION);
//   - and as a quiet line in the footer;
//
// and that each message carries what the privacy page lists and nothing
// else: no query string, no fragment, no file name.
//
// Requests to auth.opensubs.app go to SUPPORT_SERVER when it is set (a local
// openapps-server, whose rows are read back through its admin API) and to a
// stand-in in this file otherwise. Nothing reaches the real account server.
// The clip is made with ffmpeg; without it the burn case is skipped.
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
const ADMIN = process.env.SUPPORT_ADMIN_TOKEN ?? null;
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
let standIn = 0;

async function wire(context) {
  // The site's page counter is not part of the app; never let a test count.
  await context.route(/\/script\.js$|\/api\/send$/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route((url) => url.href.startsWith(AUTH), async (route) => {
    const req = route.request();
    const path = req.url().slice(AUTH.length);
    if (path.startsWith("/v1/support/messages") && req.method() === "POST") sent.push(JSON.parse(req.postData() ?? "{}"));
    if (SERVER) {
      const response = await route.fetch({ url: SERVER + path, headers: { ...req.headers(), origin: ORIGIN } });
      return route.fulfill({ response });
    }
    const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,DELETE" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path.startsWith("/v1/support/messages")) {
      return route.fulfill({ status: 202, headers: cors, contentType: "application/json", body: JSON.stringify({ ref: `M-STANDIN${++standIn}`, received: true }) });
    }
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

async function sendFrom(page, host, { message, email, shotName }) {
  const before = sent.length;
  await (await triggerIn(page, host)).click();
  const dialog = page.locator(`${host} dialog[open]`).first();
  await dialog.waitFor({ timeout: 10_000 });
  if (shotName) await page.screenshot({ path: join(SHOTS, `${shotName}-dialog.png`) });
  await dialog.locator("textarea").fill(message);
  if (email) await dialog.locator('input[name="email"]').fill(email);
  await dialog.locator('button[type="submit"]').click();
  const ref = dialog.locator('[data-testid="support-ref"]');
  await ref.waitFor({ timeout: 30_000 });
  if (shotName) await page.screenshot({ path: join(SHOTS, `${shotName}-sent.png`) });
  const reference = (await ref.innerText()).trim();
  await dialog.getByRole("button").first().click();
  return { reference, body: sent.slice(before).pop() };
}

function clean(name, body, { context, codePrefix }) {
  check(`${name}: sent from the right place`, body?.context === context, body?.context);
  if (codePrefix) check(`${name}: carries its error code`, String(body?.error_code ?? "").startsWith(codePrefix), body?.error_code);
  check(`${name}: names the product and build`, body?.product === "OpenSubs" && /^\d+\.\d+/.test(body?.app_version ?? ""), `${body?.product} ${body?.app_version}`);
  check(`${name}: the page has no query or fragment`, typeof body?.page === "string" && !/[?#]/.test(body.page), body?.page);
  check(`${name}: no file name rides along`, !/clip\.(mp4|srt)/.test(JSON.stringify(body ?? {})));
}

async function stored(reference) {
  if (!SERVER || !ADMIN) return null;
  const list = await (await fetch(`${SERVER}/v1/admin/support?status=all&limit=200`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
  return list.messages.find((m) => m.ref === reference) ?? null;
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
      check("quiet line in the footer", await link.isVisible(), (await link.innerText()).trim());
      await page.locator(".web-footer").screenshot({ path: join(SHOTS, `opensubs-${scheme}-quiet.png`) });
      if (scheme === "light") {
        await page.evaluate(() => localStorage.setItem("opensubs.locale", "zh-Hant"));
        await page.reload();
        const zh = await triggerIn(page, ".web-footer openapps-support");
        check("the line follows the interface language", /留言/.test(await zh.innerText()), (await zh.innerText()).trim());
        await zh.click();
        const dialog = page.locator(".web-footer openapps-support dialog[open]");
        await dialog.waitFor();
        check("the box is in Traditional Chinese", /發生了什麼事/.test(await dialog.innerText()));
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
      await page.waitForSelector('input[accept="video/*"]', { state: "attached", timeout: 30_000 });
      await page.setInputFiles('input[accept="video/*"]', CLIP);
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
        const { reference, body } = await sendFrom(page, host, {
          message: `The burn stopped with an encoder error (${scheme} e2e)`,
          email: "tester@example.com",
          shotName: `opensubs-${scheme}-burn`,
        });
        clean("burn failure", body, { context: "export", codePrefix: "burn" });
        if (SERVER) check("stored as an export failure", (await stored(reference))?.context === "export", reference);
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
      await page.locator('[data-testid="signin-failed"]').screenshot({ path: join(SHOTS, `opensubs-${scheme}-signin-failed.png`) });
      const { reference, body } = await sendFrom(page, host, {
        message: `Signed in with Google and came back signed out (${scheme} e2e)`,
        shotName: scheme === "light" ? `opensubs-${scheme}-signin` : null,
      });
      clean("sign-in failure", body, { context: "signin", codePrefix: "signin:no_session" });
      if (SERVER) check("stored with no account", (await stored(reference))?.user_id === null, reference);
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
        await page.waitForSelector('input[accept="video/*"]', { state: "attached", timeout: 30_000 });
        await page.setInputFiles('input[accept="video/*"]', CLIP);
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
      const { reference, body } = await sendFrom(page, host, {
        message: `Bought credits by card and they are not here (${scheme} e2e)`,
        email: "payer@example.com",
        shotName: `opensubs-${scheme}-payment`,
      });
      clean("payment", body, { context: "payment" });
      check("the pending top-up is attached", body?.topup_id === SESSION.topupId, body?.topup_id);
      const row = await stored(reference);
      if (SERVER) check("stored with the account and the top-up", row?.user_id && row?.topup_id === SESSION.topupId, `${row?.user_id} ${row?.topup_id}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${sent.length} messages sent; screenshots in ${SHOTS}`);
if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
