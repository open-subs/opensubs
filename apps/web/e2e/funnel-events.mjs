// The burn flow's funnel events: each once, at its step, with only the
// properties it is allowed; and none at all while the switch is off.
//
//   npm run build && node e2e/funnel-events.mjs [--shots DIR]
//   node e2e/funnel-events.mjs --live https://opensubs.app [--shots DIR]
//
// --live runs the switched-on sections against the deployed page, with the
// switch file as the server has it (they need it on) and the same stand-ins
// for the tag and the accounts server: nothing reaches the real counter and
// nobody really signs in. The switch-off and failure sections need the file
// under the test's control, so they run locally only.
//
// Served from dist/ with the switch file under the test's control; the
// accounts server is a Playwright route, as in export-gate.mjs. The
// page-view tag is never fetched: `/script.js` and `/api/send` are refused
// (and /api/send is counted -- it must stay at zero), and `window.umami` is a
// stand-in that hands every named call to this test.
//
// What it checks:
//   - switch off (gate on with funnelEvents absent or false, or no file): a
//     whole burn with an in-page sign-in sends nothing and keeps nothing;
//   - in place: burn-click, signin-shown, signin-complete (nostr),
//     burn-start, burn-complete, once each, in that order;
//   - a provider sign-in on an Android phone (Continue with Google leaves
//     the page, back with #code=): signin-complete (google) on the returning
//     page, then burn-start and burn-complete once the video is open again;
//   - signed in already: burn-click, burn-start, burn-complete only;
//   - .srt / .vtt / .ass / .txt: one subtitle-download each, with the format;
//   - a burn that fails: burn-failed with a stage, an error category and the
//     error's type name (ename);
//   - a video that can no longer be read (deleted after it was chosen):
//     burn-failed read / file-read, a sentence that says to choose it again
//     and a button for it, and once it is chosen again the burn runs by
//     itself (locally and, signed in through the sheet, live);
//   - nothing carries more than tool, device, method, stage, error and ename.
import { createServer } from "node:http";
import { readFile, copyFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(process.env.DIST ?? resolve(HERE, "../dist"));
const SAMPLE = resolve(HERE, "../public/sample.mp4");
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const LIVE = args.includes("--live") ? args[args.indexOf("--live") + 1].replace(/\/$/, "") : null;
if (shots) mkdirSync(shots, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
};

/** What `/export-gate.json` answers: null = 404, else this JSON. */
let gate = null;
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__opensubs-funnel") return res.writeHead(200).end("opensubs-funnel");
  if (path === "/export-gate.json") {
    if (gate === null) return res.writeHead(404).end("not found");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(gate));
  }
  try {
    const target = join(DIST, path === "/" ? "/index.html" : path);
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
let base = LIVE;
if (LIVE) {
  const live = await fetch(`${LIVE}/export-gate.json?t=${Date.now()}`).then((r) => r.json());
  console.log(`live switch file: ${JSON.stringify(live)}`);
  if (live.funnelEvents !== true) throw new Error("the live switch is off; --live needs it on");
} else {
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}`;
  if ((await fetch(`${base}/__opensubs-funnel`).then((r) => r.text())) !== "opensubs-funnel") {
    throw new Error(`the test server at ${base} is not this one`);
  }
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = () =>
  `${b64url({ alg: "EdDSA" })}.${b64url({ sub: "u-funnel", sid: "s1", exp: Math.floor(Date.now() / 1000) + 900 })}.sig`;
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });

const browser = await chromium.launch({ args: ["--no-proxy-server"] });

async function newContext({ device = null } = {}) {
  const context = await browser.newContext({
    ...(device ? devices[device] : { viewport: { width: 1280, height: 1000 } }),
    locale: "en-US", acceptDownloads: true,
  });
  const events = [];
  const sent = [];
  await context.exposeFunction("__funnelEvent", (e) => events.push(e));
  await context.route(/\/script\.js(\?.*)?$/, (r) => r.abort());
  await context.route(/\/api\/send/, (r) => { sent.push(r.request().url()); return r.abort(); });
  await context.addInitScript(() => {
    delete window.showOpenFilePicker;
    // The page-view tag, stood in for: named calls are events.
    window.umami = { track(name, data) { if (typeof name === "string") window.__funnelEvent({ name, data: data ?? null }); } };
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
    if (/^\/v1\/auth\/oidc\/[a-z]+\/start$/.test(url.pathname)) {
      // The provider's round trip, played: back to the same page with a code
      // in the fragment, as the accounts server sends it.
      const back = new URL(url.searchParams.get("return_to") ?? `${base}/`);
      back.searchParams.delete("sample");
      back.hash = `code=simulated-${Date.now()}`;
      return route.fulfill({ status: 302, headers: { location: back.toString() } });
    }
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
      case "/v1/auth/oidc/exchange":
      case "/v1/auth/refresh":
        return json(route, 200, { access_token: token(), refresh_token: "r1" });
      case "/v1/credits/balance":
        return json(route, 200, { balance: 0 });
      case "/v1/me":
        return json(route, 200, { id: "u-funnel", balance: 0, linked_accounts: [] });
      default:
        return json(route, 200, {});
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, events, sent, errors };
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
  }
}
const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${name}.png`) });
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const names = (events) => events.map((e) => e.name).join(" > ") || "(none)";
const sequence = (events, want, label) =>
  check(JSON.stringify(events.map((e) => e.name)) === JSON.stringify(want), label, names(events));
const all = [];

const BURN = /^(Burn subtitles into the video|将字幕烧录进视频|Sign in free to burn the video|免费登录后烧录视频)$/;
const SHEET = "[data-export-gate]";
const done = (page, timeout = 120000) =>
  page.locator(".burn-done").waitFor({ state: "attached", timeout }).then(() => true, () => false);
async function exportTab(page) {
  const tab = page.getByRole("tab", { name: /^(Export|导出)$/ });
  await tab.waitFor({ timeout: 60000 });
  await tab.click();
}
async function openSample(page) {
  await page.goto(`${base}/?sample`);
  await exportTab(page);
  await page.getByRole("button", { name: BURN }).waitFor({ timeout: 60000 });
}

for (const [label, body] of LIVE ? [] : [
  ["gate on, funnelEvents absent", { exportGate: true }],
  ["funnelEvents false", { exportGate: true, funnelEvents: false }],
]) {
  await section(`switch off (${label}): a burn with an in-page sign-in, and a .srt`, async () => {
    gate = body;
    const { context, page, events, sent, errors } = await newContext();
    await openSample(page);
    await page.getByRole("button", { name: ".srt" }).click();
    await page.getByRole("button", { name: BURN }).click();
    await page.locator(SHEET).waitFor({ timeout: 5000 });
    await page.locator(SHEET).getByRole("button", { name: /Continue with Nostr/ }).click();
    check(await done(page), "the burn finishes after signing in, as before");
    await settle(9000); // longer than an event waits for the tag
    check(events.length === 0, "no event is sent", names(events));
    check(sent.length === 0, "nothing reaches /api/send", String(sent.length));
    const kept = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.includes("funnel")));
    check(kept.length === 0, "nothing is kept for the funnel", kept.join(","));
    check(errors.length === 0, "no page errors", errors.join(" | ").slice(0, 160));
    await context.close();
  });
}

if (!LIVE) await section("switch off (no file): the burn starts at once and sends nothing", async () => {
  gate = null;
  const { context, page, events, sent } = await newContext();
  await openSample(page);
  await page.getByRole("button", { name: BURN }).click();
  check(await done(page), "the burn finishes");
  await settle(9000);
  check(events.length === 0 && sent.length === 0, "no event is sent", names(events));
  await context.close();
});

await section("switch on, desktop: sign in inside the sheet (Nostr)", async () => {
  gate = { exportGate: true, funnelEvents: true };
  const { context, page, events, sent, errors } = await newContext();
  await openSample(page);
  await page.getByRole("button", { name: BURN }).click();
  await page.locator(SHEET).waitFor({ timeout: 5000 });
  await settle();
  sequence(events, ["burn-click", "signin-shown"], "Burn is burn-click, the sheet is signin-shown");
  await shot(page, "funnel-sheet");
  await page.locator(SHEET).getByRole("button", { name: /Continue with Nostr/ }).click();
  check(await done(page), "the burn starts by itself and finishes");
  await settle(2000);
  sequence(events, ["burn-click", "signin-shown", "signin-complete", "burn-start", "burn-complete"], "then signin-complete, burn-start, burn-complete, once each");
  const signin = events.find((e) => e.name === "signin-complete");
  check(signin?.data?.method === "nostr", "signin-complete names the method", JSON.stringify(signin?.data));
  check(events.every((e) => e.data?.tool === "burn" && e.data?.device === "desktop"), "every event names the tool and the device", JSON.stringify(events[0]?.data));

  // Signed in now: the next burn goes straight through.
  const before = events.length;
  await page.getByRole("button", { name: "Burn again" }).click();
  await page.getByRole("button", { name: BURN }).click();
  check(await done(page), "signed in, the next burn finishes");
  await settle(2000);
  sequence(events.slice(before), ["burn-click", "burn-start", "burn-complete"], "and is burn-click, burn-start, burn-complete only");

  // The text exports, which need no account.
  const mark = events.length;
  for (const f of [".srt", ".vtt", ".ass", ".txt"]) {
    const dl = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: f, exact: true }).click();
    await dl;
  }
  await settle(1500);
  const downloads = events.slice(mark);
  check(downloads.length === 4 && downloads.every((e) => e.name === "subtitle-download"), "one subtitle-download per text export", names(downloads));
  check(downloads.map((e) => e.data?.tool).join(",") === "srt,vtt,ass,txt", "each names its format", downloads.map((e) => e.data?.tool).join(","));
  check(sent.length === 0, "nothing reaches /api/send", String(sent.length));
  check(errors.length === 0, "no page errors", errors.join(" | ").slice(0, 160));
  all.push(...events);
  await context.close();
});

await section("switch on, Android phone: Continue with Google leaves the page and comes back", async () => {
  gate = { exportGate: true, funnelEvents: true };
  const { context, page, events, sent, errors } = await newContext({ device: "Pixel 7" });
  await openSample(page);
  await page.getByRole("button", { name: BURN }).click();
  await page.locator(SHEET).waitFor({ timeout: 5000 });
  await settle();
  const first = events.length;
  sequence(events, ["burn-click", "signin-shown"], "before leaving: burn-click, signin-shown");
  const back = page.waitForURL(/#code=/, { timeout: 30000 }).catch(() => {});
  await page.locator(SHEET).getByRole("button", { name: /Google/ }).first().click();
  await back;
  await page.locator("[data-export-waiting]").waitFor({ timeout: 30000 }).catch(() => {});
  await settle(2500);
  sequence(events.slice(first), ["signin-complete"], "back and signed in: signin-complete, once");
  const signin = events.find((e) => e.name === "signin-complete");
  check(signin?.data?.method === "google", "it names google", JSON.stringify(signin?.data));
  await shot(page, "funnel-redirect-back");
  await page.locator("[data-no-video] input[type=file]").setInputFiles(SAMPLE);
  check(await done(page, 150000), "opening the video again burns it");
  await settle(2000);
  sequence(events.slice(first), ["signin-complete", "burn-start", "burn-complete"], "then burn-start and burn-complete");
  check(events.every((e) => e.data?.device === "android"), "every event says android", events.map((e) => e.data?.device).join(","));
  await page.reload();
  await settle(5000);
  check(events.length === first + 3, "a reload afterwards reports nothing again", names(events.slice(first + 3)));
  check(sent.length === 0, "nothing reaches /api/send", String(sent.length));
  check(errors.length === 0, "no page errors", errors.join(" | ").slice(0, 160));
  all.push(...events);
  await context.close();
});

if (!LIVE) await section("switch on: a burn that fails", async () => {
  gate = { funnelEvents: true };
  const { context, page, events } = await newContext();
  await openSample(page);
  // From here the page's encoder refuses: VideoEncoder throws on its first frame.
  await page.evaluate(() => {
    const Real = window.VideoEncoder;
    window.VideoEncoder = class extends Real {
      encode() { throw new DOMException("The encoder could not take this frame", "EncodingError"); }
    };
  });
  await page.getByRole("button", { name: BURN }).click();
  await page.locator(".burn-error, [role=alert]").first().waitFor({ timeout: 60000 }).catch(() => {});
  await settle(2500);
  sequence(events, ["burn-click", "burn-start", "burn-failed"], "burn-click, burn-start, burn-failed");
  const f = events.find((e) => e.name === "burn-failed");
  check(!!f?.data?.stage && !!f?.data?.error && f?.data?.stage === "render" && f?.data?.error === "encode" && !/could not/.test(JSON.stringify(f?.data)), "burn-failed says render / encode, not the message", JSON.stringify(f?.data));
  check(f?.data?.ename === "EncodingError", "and names the error type", JSON.stringify(f?.data));
  const code = await page.locator("openapps-support[context=export]").getAttribute("error-code").catch(() => null);
  check(code === "burn:render:encode:EncodingError", "the support box carries burn:stage:category:name", String(code));
  all.push(...events);
  await context.close();
});

await section("a video that can no longer be read: choose it again and the burn carries on", async () => {
  gate = { funnelEvents: true };
  const dir = await mkdtemp(join(tmpdir(), "opensubs-gone-"));
  const video = join(dir, "holiday clip.mp4");
  const srt = join(dir, "holiday clip.srt");
  try {
    await copyFile(SAMPLE, video);
    await writeFile(srt, "1\n00:00:00,500 --> 00:00:02,500\nHello\n\n");
    const { context, page, events, errors } = await newContext();
    await page.goto(`${base}/`);
    await page.locator('input[type=file][accept="video/*"]').first().setInputFiles(video);
    await page.waitForFunction(() => (document.querySelector("video")?.videoWidth ?? 0) > 0, null, { timeout: 30000 });
    await page.locator('input[type=file][accept=".srt,.vtt,text/vtt"]').first().setInputFiles(srt);
    await exportTab(page);
    await page.getByRole("button", { name: BURN }).waitFor({ timeout: 30000 });
    // Gone from disk after it was chosen: the File the page holds can no
    // longer be read, however often Burn is pressed.
    await rm(video);
    await page.getByRole("button", { name: BURN }).click();
    // Live, the sign-in comes first; signed in, the burn starts by itself.
    if (await page.locator(SHEET).waitFor({ timeout: 4000 }).then(() => true, () => false)) {
      await page.locator(SHEET).getByRole("button", { name: /Continue with Nostr/ }).click();
    }
    const reselect = page.locator("[data-burn-reselect]");
    await reselect.waitFor({ timeout: 60000 });
    await settle(2000);
    const burnSteps = (list) => list.filter((e) => !e.name.startsWith("signin-"));
    sequence(burnSteps(events), ["burn-click", "burn-start", "burn-failed"], "burn-click, burn-start, burn-failed");
    const f = events.find((e) => e.name === "burn-failed");
    check(f?.data?.stage === "read" && f?.data?.error === "file-read", "burn-failed says read / file-read", JSON.stringify(f?.data));
    check(/^[A-Za-z]+Error$/.test(f?.data?.ename ?? ""), "with the browser's error name", String(f?.data?.ename));
    check(!/holiday/.test(JSON.stringify(events)), "and no file name");
    const said = await page.locator(".field-error").first().innerText();
    check(/can no longer read this video/.test(said) && /choose it again/.test(said), "the page says to choose the video again", said);
    check(!/unsupported or unrecognizable|network error/.test(said), "not that the format is bad or the network failed", said);
    const code = await page.locator("openapps-support[context=export]").getAttribute("error-code");
    check(/^burn:read:file-read:[A-Za-z]+$/.test(code ?? ""), "the support box carries burn:read:file-read:<name>", String(code));
    await shot(page, "funnel-file-gone");
    // Chosen again: the burn starts by itself.
    await copyFile(SAMPLE, video);
    const mark = events.length;
    await reselect.locator("input[type=file]").setInputFiles(video);
    check(await done(page), "chosen again, the burn runs by itself and finishes");
    await settle(2000);
    sequence(events.slice(mark), ["burn-start", "burn-complete"], "then burn-start, burn-complete");
    check(!(await reselect.isVisible().catch(() => false)), "and the button has gone");
    check(errors.length === 0, "no page errors", errors.join(" | ").slice(0, 160));
    all.push(...events);
    await context.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await section("what the events carry", async () => {
  const allowed = new Set(["tool", "device", "method", "stage", "error", "ename"]);
  const extra = all.flatMap((e) => Object.keys(e.data ?? {}).filter((k) => !allowed.has(k)));
  check(all.length > 0 && extra.length === 0, `${all.length} events carry only tool, device, method, stage, error, ename`, extra.join(","));
  check(!/sample|\.mp4|u-funnel|simulated|Nothing was uploaded/.test(JSON.stringify(all)), "no file name, subtitle text, account id or code");
  check(all.filter((e) => e.data?.method).every((e) => e.name === "signin-complete"), "method only on signin-complete");
  check(all.filter((e) => e.data?.ename).every((e) => e.name === "burn-failed"), "ename only on burn-failed");
  console.log(`  (${[...new Set(all.map((e) => e.name))].join(", ")})`);
});

await browser.close();
if (!LIVE) server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
