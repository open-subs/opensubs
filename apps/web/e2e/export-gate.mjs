// Exporting a video asks for an account only when the switch says so, and
// the export a sign-in interrupted finishes afterwards.
//
//   npm run build && node e2e/export-gate.mjs [--shots DIR]
//
// The page is served from dist/ with the switch file under the test's
// control, and the accounts server is a Playwright route: nothing signs in
// for real and nothing is charged. Analytics is blocked.
//
// What it checks:
//   - no switch file, an HTML fallback, or `false`: the burn starts at once,
//     no sheet, exactly as before the switch existed;
//   - the switch on (file or ?gate=1), signed out: the sheet opens and the
//     burn does not start; "Not now" closes it and nothing is waiting;
//   - signing in inside the sheet (Nostr, no navigation): the sheet closes
//     and the burn starts by itself and finishes;
//   - a provider sign-in (the page is left and comes back with #code=):
//     the subtitles come back by themselves, the page says what to do, and
//     re-opening the video starts the burn;
//   - signed in already: the burn starts at once;
//   - the text exports are never asked about.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(process.env.DIST ?? resolve(HERE, "../dist"));
const SAMPLE = resolve(HERE, "../public/sample.mp4");
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
};

/** What `/export-gate.json` answers: null = 404, "html" = the page, else this JSON. */
let gate = null;
const switchReads = [];
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__opensubs-export-gate") return res.writeHead(200).end("opensubs");
  if (path === "/export-gate.json") {
    switchReads.push(req.url);
    if (gate === null) return res.writeHead(404).end("not found");
    if (gate !== "html") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(gate));
    }
  }
  try {
    const target = join(DIST, path === "/" || path === "/export-gate.json" ? "/index.html" : path);
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
const ready = await fetch(`${base}/__opensubs-export-gate`).then((r) => r.text());
if (ready !== "opensubs") throw new Error(`the test server at ${base} is not this one`);

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = () =>
  `${b64url({ alg: "EdDSA" })}.${b64url({ sub: "u-gate", sid: "s1", exp: Math.floor(Date.now() / 1000) + 900 })}.sig`;
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
const auth = { verifies: 0, exchanges: 0 };

const browser = await chromium.launch();

async function newContext(locale = "en-US") {
  const context = await browser.newContext({ locale, viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  await context.route(/\/script\.js(\?.*)?$/, (r) => r.abort());
  await context.route(/\/api\/send/, (r) => r.abort());
  await context.addInitScript(() => {
    // The plain file input, so a test can hand it a file.
    delete window.showOpenFilePicker;
    const pk = "ab".repeat(32);
    window.nostr = {
      getPublicKey: async () => pk,
      signEvent: async (e) => ({ ...e, pubkey: pk, created_at: e.created_at ?? Math.floor(Date.now() / 1000), id: "00".repeat(32), sig: "00".repeat(64) }),
    };
  });
  await context.route("https://auth.opensubs.app/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    switch (url.pathname) {
      case "/v1/auth/methods":
        return json(route, 200, { methods: { google: true, nostr: true, apple: false, github: false, eip155: false, openwallet: false, telegram: false, ton: false } });
      case "/v1/auth/challenge":
        return json(route, 200, {
          challenge_id: "c1",
          expires_at: Math.floor(Date.now() / 1000) + 300,
          message: JSON.stringify({ content: "", kind: 27235, tags: [["u", "https://auth.opensubs.app/v1/auth/verify"], ["method", "POST"], ["challenge", "c1"]] }),
        });
      case "/v1/auth/verify":
        auth.verifies += 1;
        return json(route, 200, { access_token: token(), refresh_token: "r1" });
      case "/v1/auth/oidc/exchange":
        auth.exchanges += 1;
        return json(route, 200, { access_token: token(), refresh_token: "r1" });
      case "/v1/auth/refresh":
        return json(route, 200, { access_token: token(), refresh_token: "r1" });
      case "/v1/credits/balance":
        return json(route, 200, { balance: 0 });
      case "/v1/me":
        return json(route, 200, { id: "u-gate", balance: 0, linked_accounts: [] });
      default:
        return json(route, 200, {});
    }
  });
  return context;
}

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
const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${name}.png`) });

const BURN = /^(Burn subtitles into the video|将字幕烧录进视频)$/;
const SHEET = "[data-export-gate]";
const started = (page) => page.locator(".burn-progress, .burn-done").first();
const startedNow = async (page, timeout = 15000) =>
  started(page).waitFor({ state: "attached", timeout }).then(() => true, () => false);
/** The panels are tabs once there are cues; export is one of them. */
async function exportTab(page) {
  const tab = page.getByRole("tab", { name: /^(Export|导出)$/ });
  await tab.waitFor({ timeout: 60000 });
  await tab.click();
}

/** Open the page with the sample loaded and wait for the burn button. */
async function openSample(context, query = "") {
  const page = await context.newPage();
  await page.goto(`${base}/?sample${query}`);
  await exportTab(page);
  await page.getByRole("button", { name: BURN }).waitFor({ timeout: 60000 });
  return page;
}

async function burnStartsAtOnce(label, query = "") {
  const context = await newContext();
  const page = await openSample(context, query);
  await page.getByRole("button", { name: BURN }).click();
  check(await startedNow(page), `${label}: the burn starts at once`);
  check(!(await page.locator(SHEET).isVisible()), `${label}: no sign-in sheet`);
  return { context, page };
}

await section("switch off: no file", async () => {
  gate = null;
  const { context, page } = await burnStartsAtOnce("no file");
  check(switchReads.length > 0 && switchReads.every((u) => /\?t=\d+/.test(u)), "the switch is read with a cache-busting query", switchReads.join(" "));
  await page.locator(".burn-done").waitFor({ state: "attached", timeout: 120000 });
  await shot(page, "flag-off-burn-unchanged");
  await context.close();
});

await section("switch off: an HTML fallback, and false", async () => {
  gate = "html";
  await (await burnStartsAtOnce("HTML fallback")).context.close();
  gate = { exportGate: false };
  await (await burnStartsAtOnce("exportGate false")).context.close();
  gate = { exportGate: "true" };
  await (await burnStartsAtOnce("exportGate \"true\" (a string)")).context.close();
});

await section("switch on via ?gate=1, signed out: the sheet, and Not now", async () => {
  gate = null;
  const context = await newContext();
  const page = await openSample(context, "&gate=1");
  // The text exports are never asked about.
  const download = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await page.getByRole("button", { name: ".srt" }).click();
  check(!!(await download), ".srt downloads with the switch on and nobody signed in");
  check(!(await page.locator(SHEET).isVisible()), ".srt opens no sheet");

  await page.getByRole("button", { name: BURN }).click();
  await page.locator(SHEET).waitFor({ timeout: 5000 });
  check(await page.locator(SHEET).isVisible(), "pressing export opens the sign-in sheet");
  check(await page.locator(`${SHEET} openapps-login`).count() === 1, "the sheet holds the existing <openapps-login>");
  check(!(await startedNow(page, 1500)), "the burn has not started");
  check(await page.evaluate(() => !!sessionStorage.getItem("opensubs.pendingExport")), "the waiting export is marked for a redirect sign-in");
  await shot(page, "gate-sheet-en");
  await page.getByRole("button", { name: "Not now" }).click();
  check(!(await page.locator(SHEET).isVisible()), "Not now closes the sheet");
  check(await page.evaluate(() => !sessionStorage.getItem("opensubs.pendingExport")), "Not now leaves nothing waiting");
  check(!(await startedNow(page, 1500)), "and starts nothing");
  await context.close();
});

await section("switch on via the file, in Simplified Chinese", async () => {
  gate = { exportGate: true };
  const context = await newContext("zh-CN");
  const page = await openSample(context);
  await page.getByRole("button", { name: BURN }).click();
  await page.locator(SHEET).waitFor({ timeout: 5000 });
  const title = await page.locator(`${SHEET} h2`).textContent();
  check(title?.trim() === "登录后导出视频", "the sheet is in the interface language", title ?? "");
  await shot(page, "gate-sheet-zh-Hans");
  await context.close();
});

await section("signing in inside the sheet (Nostr) carries on with the export", async () => {
  gate = null;
  const context = await newContext();
  const page = await openSample(context, "&gate=1");
  await page.getByRole("button", { name: BURN }).click();
  await page.locator(SHEET).waitFor({ timeout: 5000 });
  const before = auth.verifies;
  await page.locator(SHEET).getByRole("button", { name: /Continue with Nostr/ }).click();
  await page.locator(SHEET).waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  check(auth.verifies === before + 1, "the sign-in went through the accounts server once");
  check(!(await page.locator(SHEET).isVisible()), "the sheet closes once signed in");
  check(await startedNow(page), "the burn starts by itself");
  await shot(page, "after-signin-burn-running");
  await page.locator(".burn-done").waitFor({ state: "attached", timeout: 120000 }).catch(() => {});
  check(await page.locator(".burn-done a[download]").isVisible(), "the burn finishes and Save is offered");
  check(await page.evaluate(() => !sessionStorage.getItem("opensubs.pendingExport")), "nothing is left waiting");
  await shot(page, "after-signin-burn-done");

  // Signed in now: the next export goes straight through.
  await page.getByRole("button", { name: "Burn again" }).click();
  await page.getByRole("button", { name: BURN }).click();
  check((await startedNow(page)) && !(await page.locator(SHEET).isVisible()), "signed in, the burn starts at once");
  await context.close();
});

await section("a provider sign-in leaves the page; the export finishes after", async () => {
  gate = null;
  const context = await newContext();
  const page = await openSample(context, "&gate=1");
  const cuesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("opensubs.work") || "{}").cues?.length ?? 0);
  await page.getByRole("button", { name: BURN }).click();
  await page.locator(SHEET).waitFor({ timeout: 5000 });
  // The provider's round trip: the page is left, and comes back to the same
  // path and query with the code in the fragment. (`?sample` is dropped so
  // the sample does not load itself: this is any video, not the sample.)
  const before = auth.exchanges;
  await page.goto(`${base}/?gate=1#code=test-code`);
  await page.locator("[data-export-waiting]").waitFor({ timeout: 30000 }).catch(() => {});
  check(auth.exchanges === before + 1, "the code is exchanged once");
  check(await page.locator("[data-export-waiting]").isVisible(), "back and signed in, the page says the export will start when the video is open");
  check(!(await page.locator(".restore-card").isVisible()), "the subtitles came back without being asked for");
  const cuesAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("opensubs.work") || "{}").cues?.length ?? 0);
  check(cuesBefore > 0 && cuesAfter === cuesBefore, `the subtitles are intact (${cuesBefore} -> ${cuesAfter} cues)`);
  const shown = await page.evaluate(() => [...document.querySelectorAll("textarea")].map((a) => a.value));
  check(shown.includes("Nothing was uploaded to make these captions."), "a restored cue is on screen", shown.join(" | "));
  await shot(page, "after-redirect-notice");
  await page.locator("[data-no-video] input[type=file]").setInputFiles(SAMPLE);
  check(await startedNow(page, 30000), "opening the video again starts the burn by itself");
  await exportTab(page);
  check(!(await page.locator(SHEET).isVisible()), "with no sheet");
  await shot(page, "after-redirect-burn-running");
  await page.locator(".burn-done").waitFor({ state: "attached", timeout: 120000 }).catch(() => {});
  check(await page.locator(".burn-done a[download]").isVisible(), "and finishes");
  check(await page.evaluate(() => !sessionStorage.getItem("opensubs.pendingExport")), "nothing is left waiting");
  await context.close();
});

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
