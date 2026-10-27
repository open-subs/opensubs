// Burning a video with the switch on, around the connection and the kept work.
//
//   npm run build && node e2e/export-gate-offline.mjs [--engine chromium|webkit|firefox] [--phone] [--shots DIR]
//
// Served from dist/ with the switch file saying {"exportGate": true,
// "funnelEvents": true}; the accounts server is a Playwright route, so
// nothing signs in for real. The page-view tag is a stand-in that hands each
// funnel event to this test. "Offline" is the server refusing every
// connection and the accounts route failing -- navigator.onLine stays true,
// as it does on a network that answers nothing.
//
// What it checks:
//   - signed out: the button says a free sign-in burns it, with the line
//     under it; Not now sends signin-dismissed
//   - offline, signed out: the sheet opens with the offline sentence and the
//     burn does not start; the subtitles stay
//   - signed in (which confirms the session): offline, the burn starts;
//     confirmed 31 days ago, "connect once" and nothing starts, no sheet
//   - kept subtitles offered back to a signed-out visitor: pending-restored;
//     signing in and burning: pending-recovered
//   - kept subtitles past their age: deleted on load with the video pointer,
//     and pending-expired
//   - every new event carries only tool and device
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, firefox } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(process.env.DIST ?? resolve(HERE, "../dist"));
const SAMPLE = resolve(HERE, "../public/sample.mp4");
const args = process.argv.slice(2);
const arg = (n, d = null) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ENGINE = arg("--engine", "chromium");
const PHONE = args.includes("--phone");
const shots = arg("--shots") ? resolve(arg("--shots")) : null;
if (shots) mkdirSync(shots, { recursive: true });
const tag = `${ENGINE}-${PHONE ? "phone" : "desktop"}`;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
};

let offline = false;
const server = createServer(async (req, res) => {
  if (offline) return req.socket.destroy();
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__opensubs-gate-offline") return res.writeHead(200).end("opensubs-gate-offline");
  if (path === "/export-gate.json") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end('{"exportGate": true, "funnelEvents": true}');
  }
  try {
    const target = join(DIST, path === "/" ? "/index.html" : path);
    const body = await readFile(target);
    // As the site serves them: hashed assets are cached for a year, which is
    // what lets a burn started with no connection find its worker script.
    const cache = path.startsWith("/assets/") ? { "cache-control": "public, max-age=31536000, immutable" } : {};
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream", ...cache });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
const ready = await fetch(`${base}/__opensubs-gate-offline`).then((r) => r.text());
if (ready !== "opensubs-gate-offline") throw new Error(`the test server at ${base} is not this one`);

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = () =>
  `${b64url({ alg: "EdDSA" })}.${b64url({ sub: "u-gate", sid: "s1", exp: Math.floor(Date.now() / 1000) + 900 })}.sig`;
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });

const browser = await { chromium, webkit, firefox }[ENGINE].launch();
const events = [];

async function newContext() {
  const context = await browser.newContext({
    viewport: PHONE ? { width: 390, height: 844 } : { width: 1280, height: 1000 },
    ...(PHONE && ENGINE !== "firefox" ? { isMobile: true, hasTouch: true } : {}),
    acceptDownloads: true,
  });
  await context.route(/\/script\.js(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await context.route(/\/api\/send/, (r) => r.fulfill({ status: 200, body: "" }));
  await context.exposeFunction("__track", (name, data) => events.push({ name, data }));
  await context.addInitScript(() => {
    delete window.showOpenFilePicker;
    window.umami = { track: (n, d) => window.__track(n, d) };
    const pk = "ab".repeat(32);
    window.nostr = {
      getPublicKey: async () => pk,
      signEvent: async (e) => ({ ...e, pubkey: pk, created_at: e.created_at ?? Math.floor(Date.now() / 1000), id: "00".repeat(32), sig: "00".repeat(64) }),
    };
  });
  await context.route("https://auth.opensubs.app/**", async (route) => {
    if (offline) return route.abort("internetdisconnected").catch(() => {});
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    switch (new URL(req.url()).pathname) {
      case "/v1/auth/methods":
        return json(route, 200, { methods: { google: true, nostr: true, apple: false, github: false, eip155: false, openwallet: false, telegram: false, ton: false } });
      case "/v1/auth/challenge":
        return json(route, 200, {
          challenge_id: "c1",
          expires_at: Math.floor(Date.now() / 1000) + 300,
          message: JSON.stringify({ content: "", kind: 27235, tags: [["u", "https://auth.opensubs.app/v1/auth/verify"], ["method", "POST"], ["challenge", "c1"]] }),
        });
      case "/v1/auth/verify":
      case "/v1/auth/oidc/exchange":
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
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${detail ? ` -- ${detail}` : ""}`);
  if (ok) passed += 1; else failed += 1;
};
async function section(name, fn) {
  console.log(name);
  try {
    await fn();
  } catch (e) {
    check(false, `${name}: could not run`, String(e.message ?? e).split("\n")[0]);
  } finally {
    offline = false;
  }
}
const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${tag}-${name}.png`) });
const named = (n) => events.filter((e) => e.name === n);

const GATED = "Sign in free to burn the video";
const PLAIN = "Burn subtitles into the video";
const SHEET = "[data-export-gate]";
const started = (page) => page.locator(".burn-progress, .burn-done").first();
const startedNow = async (page, timeout = 15000) =>
  started(page).waitFor({ state: "attached", timeout }).then(() => true, () => false);
async function exportTab(page) {
  const tab = page.getByRole("tab", { name: /^Export$/ });
  await tab.waitFor({ timeout: 60000 });
  await tab.click();
}
async function openSample(context, query = "") {
  const page = await context.newPage();
  await page.goto(`${base}/?sample${query}`);
  await exportTab(page);
  await page.getByRole("button", { name: new RegExp(`^(${GATED}|${PLAIN})$`) }).waitFor({ timeout: 90000 });
  await page.waitForTimeout(500);
  return page;
}
const cueCount = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("opensubs.work") || "{}").cues?.length ?? 0);

console.log(`OpenSubs export offline: ${tag}`);

await section("signed out, online: the label, the line under it, and Not now", async () => {
  const context = await newContext();
  const page = await openSample(context);
  check(await page.getByRole("button", { name: GATED }).isVisible(), "the button says a free sign-in burns it");
  const note = await page.locator("[data-gate-note]").textContent().catch(() => "");
  check(note?.trim() === "Free account. The video is burned here, on your device, and never uploaded.", "the line under it", note ?? "");
  await shot(page, "signed-out");
  events.length = 0;
  await page.getByRole("button", { name: GATED }).click();
  await page.locator(SHEET).waitFor({ timeout: 8000 });
  check(!(await page.locator("[data-export-gate-offline]").isVisible()), "online, the sheet has no offline sentence");
  await page.getByRole("button", { name: "Not now" }).click();
  await page.waitForTimeout(1500);
  check(named("signin-dismissed").length === 1, "Not now sends signin-dismissed", JSON.stringify(named("signin-dismissed")));
  await context.close();
});

await section("offline, signed out: the sheet says why, and nothing burns", async () => {
  const context = await newContext();
  const page = await openSample(context);
  const cues = await cueCount(page);
  offline = true;
  await page.getByRole("button", { name: GATED }).click();
  await page.locator(SHEET).waitFor({ timeout: 10000 });
  const off = await page.locator("[data-export-gate-offline]").textContent().catch(() => "");
  check(off?.trim() === "You're offline. Signing in needs a connection; your work stays here until you're back.", "the sheet opens with the offline sentence", off ?? "");
  check(!(await startedNow(page, 2000)), "the burn does not start");
  await shot(page, "offline-sheet");
  await page.getByRole("button", { name: "Not now" }).click();
  check((await cueCount(page)) === cues && cues > 0, "the subtitles stay", `${cues} cues`);
  await context.close();
});

await section("signed in: offline burns; confirmed 31 days ago asks to connect once", async () => {
  const context = await newContext();
  let page = await openSample(context);
  await page.getByRole("button", { name: GATED }).click();
  await page.locator(SHEET).waitFor({ timeout: 8000 });
  await page.locator(SHEET).getByRole("button", { name: /Continue with Nostr/ }).click();
  check(await startedNow(page, 20000), "signing in starts the burn");
  const at = await page.evaluate(() => Number(localStorage.getItem("opensubs.session.confirmedAt")));
  check(Date.now() - at < 5 * 60_000, "the sign-in counted as a confirmation");
  await page.locator(".burn-done").waitFor({ state: "attached", timeout: 180000 }).catch(() => {});
  check(await page.getByRole("button", { name: PLAIN }).count() === 0, "(the burn finished)");
  await page.getByRole("button", { name: "Burn again" }).click();
  check(await page.getByRole("button", { name: PLAIN }).isVisible(), "signed in, the ordinary label");
  check(!(await page.locator("[data-gate-note]").count()), "and no sign-in line");
  // The sample streams from this server by URL; a visitor's video is a
  // file on their device. Hand the same clip over as a file before the
  // connection goes, so the burn reads nothing from the network.
  await page.locator('input[type=file][accept="video/*"]').first().setInputFiles(SAMPLE);
  await exportTab(page);
  await page.getByRole("button", { name: PLAIN }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1000);
  offline = true;
  await page.getByRole("button", { name: PLAIN }).click();
  check(await startedNow(page, 15000), "offline, confirmed recently: the burn starts");
  check(!(await page.locator(SHEET).isVisible()), "with no sheet");
  // What is checked is the gate letting it through. Finishing offline is a
  // separate matter: the subtitle renderer's worker is fetched for every
  // burn and this site has no service worker, so a burn started with no
  // connection stops early whatever the gate says (it did before the gate).
  // A stuck burn's Cancel does not come back either, so the rest runs on a
  // fresh page, loaded online and then cut off.
  offline = false;
  await page.close();
  page = await openSample(context);
  offline = true;
  await page.evaluate(() => localStorage.setItem("opensubs.session.confirmedAt", String(Date.now() - 31 * 24 * 3600 * 1000)));
  await page.getByRole("button", { name: PLAIN }).click();
  await page.locator("[data-connect-once]").waitFor({ timeout: 8000 }).catch(() => {});
  const c = await page.locator("[data-connect-once]").textContent().catch(() => "");
  check(c?.trim() === "Connect to the internet once to keep saving. Your work stays here.", "confirmed 31 days ago: connect once", c ?? "");
  check(!(await startedNow(page, 2000)) && !(await page.locator(SHEET).isVisible()), "nothing starts, and no sheet");
  await shot(page, "connect-once");
  await context.close();
});

await section("kept subtitles, signed out: restored, then recovered after signing in", async () => {
  const context = await newContext();
  let page = await openSample(context);
  await page.close();
  events.length = 0;
  page = await context.newPage();
  await page.goto(`${base}/`);
  const card = page.locator(".restore-card");
  await card.waitFor({ timeout: 60000 }).catch(() => {});
  check(await card.isVisible(), "the kept subtitles are offered back");
  await page.waitForTimeout(1500);
  check(named("pending-restored").length === 1, "pending-restored is sent once", JSON.stringify(named("pending-restored")));
  await shot(page, "restored");
  await card.getByRole("button", { name: /Restore subtitles/ }).click();
  await page.locator("[data-no-video] input[type=file]").setInputFiles(SAMPLE);
  await exportTab(page);
  await page.getByRole("button", { name: GATED }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: GATED }).click();
  await page.locator(SHEET).waitFor({ timeout: 8000 });
  await page.locator(SHEET).getByRole("button", { name: /Continue with Nostr/ }).click();
  check(await startedNow(page, 20000), "signing in starts the burn");
  await page.waitForTimeout(1500);
  check(named("pending-recovered").length === 1, "pending-recovered is sent once", JSON.stringify(named("pending-recovered")));
  await context.close();
});

await section("kept subtitles past their age: deleted on load, with the video pointer", async () => {
  const context = await newContext();
  let page = await openSample(context);
  await page.evaluate(() => new Promise((ok, no) => {
    const work = JSON.parse(localStorage.getItem("opensubs.work"));
    localStorage.setItem("opensubs.work", JSON.stringify({ ...work, at: Date.now() - 25 * 3600 * 1000 }));
    const req = indexedDB.open("opensubs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => {
      const tx = req.result.transaction("handles", "readwrite");
      tx.objectStore("handles").put("a stand-in for a file handle", "video");
      tx.oncomplete = () => { req.result.close(); ok(); };
      tx.onerror = () => no(tx.error);
    };
  }));
  await page.close();
  events.length = 0;
  page = await context.newPage();
  await page.goto(`${base}/`);
  await page.waitForTimeout(4000);
  check(!(await page.locator(".restore-card").isVisible()), "nothing is offered back");
  check(await page.evaluate(() => localStorage.getItem("opensubs.work") === null), "the subtitles are deleted");
  const left = await page.evaluate(() => new Promise((ok) => {
    const req = indexedDB.open("opensubs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => {
      const g = req.result.transaction("handles").objectStore("handles").get("video");
      g.onsuccess = () => { req.result.close(); ok(g.result ?? null); };
    };
  }));
  check(left === null, "and the video pointer with them", String(left));
  check(named("pending-expired").length === 1, "pending-expired is sent once", JSON.stringify(named("pending-expired")));
  await context.close();
});

const fresh = events.filter((e) => /^(signin-dismissed|pending-)/.test(e.name));
check(fresh.every((e) => Object.keys(e.data).sort().join() === "device,tool"), "the new events carry exactly tool and device", JSON.stringify(fresh).slice(0, 200));

await browser.close();
server.close();
console.log(`\n${tag}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
