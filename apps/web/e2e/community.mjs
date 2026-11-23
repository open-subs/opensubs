// The Telegram and X buttons (<openapps-community>, lib/support.ts): in the
// header, under a finished result (subtitles just made, a burned video), and
// that the footer and error boxes draw Telegram as an outlined button.
//
//   npm run build && node e2e/community.mjs
//
// SITE=<dir> serves a composed site (website/compose.mjs output) instead of
// dist/, so the real site header is the one checked. Nothing leaves the
// machine: the speech service is a stand-in, the account server refuses.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(process.env.SITE ?? join(HERE, "../dist"));
const SHOTS = process.env.SHOTS ?? join(HERE, "output-community");
const PORT = Number(process.env.COMMUNITY_E2E_PORT ?? 5519);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TELEGRAM = "https://t.me/openappsnetwork/57";
const X_URL = "https://x.com/OpenSubsApp";
const SCHEMES = (process.env.SCHEMES ?? "light,dark").split(",");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".onnx": "application/octet-stream",
};

if (!existsSync(join(ROOT, "index.html"))) {
  console.error(`${ROOT}/index.html is missing -- run \`npm run build\` first.`);
  process.exit(2);
}
await mkdir(SHOTS, { recursive: true });

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  try {
    const target = join(ROOT, path === "/" ? "/index.html" : path);
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
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

const CLIP = join(SHOTS, "clip.mp4");
let haveClip = existsSync(CLIP);
if (!haveClip) {
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15", "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", CLIP]);
    haveClip = true;
  } catch {
    console.log("  (no ffmpeg: the result cases are skipped)");
  }
}

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function wire(context) {
  await context.route(/\/script\.js$|\/api\/send$/, (route) => route.fulfill({ status: 200, body: "" }));
  await context.route(/^https:\/\/auth\.opensubs\.app\//, (route) => {
    const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-headers": "authorization,content-type" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 401, headers: cors, contentType: "application/json", body: "{}" });
  });
  // A speech service that hears two lines.
  await context.route(/^https:\/\/api\.openai\.com\/v1\/audio\/transcriptions/, (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({
      text: "Hello there. A second line.", language: "english", duration: 2,
      segments: [{ id: 0, start: 0.2, end: 0.9, text: " Hello there." }, { id: 1, start: 1.0, end: 1.8, text: " A second line." }],
    }) });
  });
}

/** The element's buttons once it has drawn. */
async function buttonsIn(page, selector) {
  await page.waitForFunction((sel) => document.querySelector(sel)?.shadowRoot?.querySelector("a.btn"), selector, { timeout: 30_000 });
  return page.locator(`${selector} a.btn`);
}

async function pairOk(page, selector, name) {
  const buttons = await buttonsIn(page, selector);
  await page.mouse.move(0, 0); // a hover tints the fill
  await page.waitForTimeout(250);
  const hrefs = await buttons.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  check(`${name}: Telegram and X`, hrefs[0] === TELEGRAM && hrefs[1] === X_URL, hrefs.join(" "));
  const look = await buttons.first().evaluate((a) => {
    const cs = getComputedStyle(a);
    return { border: cs.borderTopStyle, fill: cs.backgroundColor };
  });
  check(`${name}: outlined, not filled`, look.border === "solid" && /rgba\(0, 0, 0, 0\)|transparent/.test(look.fill), JSON.stringify(look));
  return buttons;
}

const browser = await chromium.launch({ args: ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] });
try {
  for (const scheme of SCHEMES) {
    console.log(`\n${scheme}`);
    // --- the header, desktop and phone --------------------------------
    for (const width of [1440, 1024, 700, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, locale: "en-US" });
      await wire(context);
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/`);
      const sel = 'openapps-community[variant="header"]';
      const buttons = await pairOk(page, sel, `header ${width}`);
      // Labelled from 640px unless the header's fit script went compact to
      // keep the tabs on row one (openapps-header-fit.js sets `compact`).
      await page.waitForTimeout(300);
      const compact = await page.locator(sel).first().evaluate((el) => el.hasAttribute("compact"));
      const labels = await buttons.evaluateAll((as) => as.map((a) => (a.querySelector(".label")?.getBoundingClientRect().width ?? 0) > 1 ? a.textContent.trim() : ""));
      const names = await buttons.evaluateAll((as) => as.map((a) => a.getAttribute("aria-label") || a.textContent.trim()));
      if (width >= 640 && !compact) check(`header ${width}: labelled`, labels[0] === "Telegram" && labels[1] === "Follow on X", labels.join(" | "));
      else check(`header ${width}: icon-only${compact ? " (compact)" : ""}`, labels.every((l) => l === ""), labels.join(" | "));
      check(`header ${width}: accessible names`, names.every((n) => /OpenSubs|Telegram|X/.test(n)), names.join(" | "));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      check(`header ${width}: no horizontal scroll`, !overflow);
      const header = page.locator(".site-header").first();
      if (await header.count()) {
        const box = await header.boundingBox();
        // The standard header ("The header, standardised"): nothing past the
        // edge, the brand and the actions on row 1, the pair first in the
        // actions, then language, account, "Open the app"; one row or two
        // (measured), never three; no GitHub link in the bar.
        await page.waitForFunction(() => document.querySelector(".site-header")?.dataset.rows, null, { timeout: 10_000 });
        const fit = await page.evaluate(() => {
          const r = (q) => document.querySelector(q)?.getBoundingClientRect();
          const brand = r(".site-header .site-brand"), actions = r(".site-header .header-actions"), pair = r(".site-header openapps-community");
          const all = [...document.querySelectorAll(".site-header .wrap > *")].map((e) => e.getBoundingClientRect());
          const acts = document.querySelector(".site-header .header-actions");
          const pos = (q) => [...acts.children].findIndex((e) => e.matches(q));
          const order = [pos("openapps-community"), pos(".lang-menu"), pos("#account"), pos(".site-btn-primary")];
          return {
            inside: all.every((b) => b.left >= -0.5 && b.right <= innerWidth + 0.5) && pair.right <= innerWidth && pair.left >= 0,
            oneRow: Math.abs(brand.top + brand.height / 2 - (actions.top + actions.height / 2)) < 4,
            order: order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])),
            rows: document.querySelector(".site-header").dataset.rows,
            tall: Math.round(document.querySelector(".site-header").getBoundingClientRect().height),
            noGitHub: !document.querySelector(".site-header a[href*='github']"),
          };
        });
        check(`header ${width}: fits`, fit.inside && fit.oneRow && fit.tall <= 106, `${JSON.stringify(fit)} ${Math.round(box.height)}px tall`);
        check(`header ${width}: the standard order, no GitHub link`, fit.order && fit.noGitHub);
        if (width >= 1200) check(`header ${width}: one row`, fit.rows === "1", `data-rows=${fit.rows}`);
        await header.screenshot({ path: join(SHOTS, `header-${width}-${scheme}.png`) });
      } else {
        await page.screenshot({ path: join(SHOTS, `header-${width}-${scheme}.png`), clip: { x: 0, y: 0, width, height: 60 } });
      }
      if (width === 1280) {
        await pairOk(page, ".web-footer openapps-support", "footer").catch(async () => {
          // The support box draws its own pair in its shadow root.
          const tg = page.locator(".web-footer openapps-support [data-testid=support-trigger]");
          await tg.waitFor({ timeout: 30_000 });
          const look = await tg.evaluate((b) => { const cs = getComputedStyle(b); return { border: cs.borderTopStyle, fill: cs.backgroundColor }; });
          check("footer: Telegram is an outlined button", look.border === "solid", JSON.stringify(look));
        });
        await page.locator(".web-footer").scrollIntoViewIfNeeded();
        await page.locator(".web-footer").screenshot({ path: join(SHOTS, `footer-${scheme}.png`) });
      }
      await context.close();
    }

    if (!haveClip || process.env.HEADER_ONLY) continue;
    // --- subtitles just made, then a burned video ----------------------
    {
      const context = await browser.newContext({ viewport: { width: 1180, height: 1000 }, colorScheme: scheme, locale: "en-US" });
      await wire(context);
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/`);
      await page.waitForSelector('input[accept^="video/*"]', { state: "attached", timeout: 30_000 });
      await page.setInputFiles('input[accept^="video/*"]', CLIP);
      await page.waitForFunction(() => document.querySelector(".file-meta")?.textContent?.includes("×"), null, { timeout: 120_000 });
      check("no success line before there is a result", (await page.locator('openapps-community[variant="success"]').count()) === 0);
      await page.locator("details.more summary").first().click();
      await page.locator("button", { hasText: "Your own API key" }).first().click();
      await page.locator('input[type="password"]').first().fill("sk-test");
      await page.locator("button[data-next-step]").first().click();
      await page.waitForSelector(".cue", { timeout: 120_000 });
      const sel = 'openapps-community[variant="success"]';
      await pairOk(page, sel, "subtitles made");
      const lede = await page.locator(`${sel} .lede`).innerText();
      check("subtitles made: the line", /Enjoying OpenSubs\?/.test(lede), lede);
      check("subtitles made: shown once", (await page.locator(sel).count()) === 1);
      const host = page.locator(sel);
      await host.scrollIntoViewIfNeeded();
      const hb = await host.boundingBox();
      const cb = await host.evaluate((el) => { const r = (el.closest("section, .card") ?? el.parentElement).getBoundingClientRect(); return { x: r.x, width: r.width }; });
      await page.screenshot({ path: join(SHOTS, `success-subtitles-${scheme}.png`), clip: { x: cb.x, y: Math.max(0, hb.y - 80), width: cb.width, height: hb.height + 220 } });

      await page.locator("#tab-export").click();
      const burn = page.locator('button:has-text("Burn subtitles into the video")');
      if ((await burn.count()) === 0 || (await burn.isDisabled())) {
        check("burning is offered in this browser", false);
      } else {
        await burn.click();
        await page.waitForSelector(".burn-done", { timeout: 180_000 });
        const after = page.locator(`.burn-done ~ ${sel}`);
        await pairOk(page, `.burn-done ~ ${sel}`, "burned video");
        check("burned video: one success line on the screen", (await page.locator(sel).count()) === 1, String(await page.locator(sel).count()));
        await after.scrollIntoViewIfNeeded();
        const done = await page.locator(".burn-done").boundingBox();
        const ab = await after.boundingBox();
        await page.screenshot({ path: join(SHOTS, `success-burned-${scheme}.png`), clip: { x: done.x - 16, y: done.y - 16, width: done.width + 32, height: ab.y + ab.height - done.y + 32 } });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\nscreenshots in ${SHOTS}`);
if (failures.length) {
  console.log(`${failures.length} failed`);
  process.exit(1);
}
