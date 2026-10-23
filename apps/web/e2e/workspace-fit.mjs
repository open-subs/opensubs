// The workspace's right column on short windows: the video keeps its size
// and its controls stay on screen, the file name is one line, and the cue
// list scrolls to its last cue.
//
//   npm run build && node e2e/workspace-fit.mjs [--shots DIR]
//   DIST=../../website/out node e2e/workspace-fit.mjs   # the composed site
//   BASE=https://opensubs.app VIEWPORTS=1280x680,1440x800 node e2e/workspace-fit.mjs
//     (a deployed site: analytics is blocked, so the run is not a visit)
//
// The output column is capped at the window's height. Before this check
// existed the stage was the flex item that gave way, so on a 1280x680 window
// with fifteen cues the player lost 121 px off its bottom -- controls and
// all -- and a long file name, wrapping to three lines, took more. Every
// case below measures the boxes rather than looking at a screenshot.
//
// Needs Chrome (H.264) and ffmpeg (to make the portrait clip).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
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
  ".onnx": "application/octet-stream",
};
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  try {
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = process.env.BASE ?? `http://127.0.0.1:${server.address().port}`;

// A landscape clip (the app's own sample, 16:9) and a portrait one made from it.
const LANDSCAPE = readFileSync(resolve(HERE, "../public/sample.mp4"));
const work = mkdtempSync(join(tmpdir(), "opensubs-fit-"));
const portraitPath = join(work, "portrait.mp4");
const made = spawnSync("ffmpeg", [
  "-v", "error", "-y", "-i", resolve(HERE, "../public/sample.mp4"), "-t", "4",
  "-vf", "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", portraitPath,
]);
if (made.status !== 0) {
  console.error("workspace-fit: ffmpeg could not make the portrait clip\n" + made.stderr);
  process.exit(1);
}
const PORTRAIT = readFileSync(portraitPath);

const SHORT = "talk.mp4";
const LONG = "Quarterly all-hands recording, full session with questions from the floor and the closing remarks_final_v2.mp4";
const srt = (n) =>
  Array.from({ length: n }, (_, i) => {
    const t = (s) => `00:00:${String(s).padStart(2, "0")},000`;
    return `${i + 1}\n${t(i * 3)} --> ${t(i * 3 + 2)}\nSubtitle line number ${i + 1}, long enough to wrap\nonto a second line in the list.\n`;
  }).join("\n");

const VIEWPORTS = process.env.VIEWPORTS
  ? process.env.VIEWPORTS.split(",").map((v) => v.split("x").map(Number))
  : [[1280, 680], [1280, 720], [1440, 800], [1440, 900], [1920, 1080]];
const TABS = ["subtitles", "style", "clip", "translate", "export"];

const browser = await chromium.launch({ channel: "chrome" });
const rows = [];
const fails = [];

for (const [width, height] of VIEWPORTS) {
  for (const [shape, video] of [["16:9", LANDSCAPE], ["9:16", PORTRAIT]]) {
    for (const name of [SHORT, LONG]) {
      for (const cues of [3, 16]) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.route(/\/script\.js$|\/api\/send$/, (r) => r.abort());
        await page.goto(base + "/");
        await page.waitForFunction(() => !!document.querySelector('input[type=file][accept*=".srt"]'), null, { timeout: 60000 });
        await page.locator('input[type=file][accept="video/*"]').first().setInputFiles({ name, mimeType: "video/mp4", buffer: video });
        await page.waitForFunction(() => (document.querySelector("video")?.videoWidth ?? 0) > 0, null, { timeout: 30000 });
        await page.locator('input[type=file][accept*=".srt"]').first().setInputFiles({ name: "cues.srt", mimeType: "text/plain", buffer: Buffer.from(srt(cues)) });
        await page.waitForFunction((n) => document.querySelectorAll("textarea.cue-text").length === n, cues, { timeout: 15000 });
        for (const tab of TABS) {
          const tabEl = page.locator(`#tab-${tab}`);
          if (!(await tabEl.count())) { fails.push(`${width}x${height} ${shape} ${cues} cues: no ${tab} tab`); continue; }
          await tabEl.click();
          await page.evaluate(() => document.querySelector(".workspace").scrollIntoView({ block: "start" }));
          await page.waitForTimeout(250);
          const m = await page.evaluate(() => {
            const v = document.querySelector(".workspace-output video");
            const s = document.querySelector(".workspace-output .stage");
            const meta = document.querySelector(".workspace-output .file-meta");
            const list = document.querySelector(".workspace-output .cue-list");
            const vr = v.getBoundingClientRect(), sr = s.getBoundingClientRect();
            const cap = parseFloat(getComputedStyle(v).maxHeight) || Infinity;
            const natural = vr.width * (v.videoHeight / v.videoWidth);
            const expected = Math.min(natural, cap);
            list.scrollTop = list.scrollHeight;
            const last = list.lastElementChild.getBoundingClientRect();
            const lr = list.getBoundingClientRect();
            const line = parseFloat(getComputedStyle(meta).lineHeight) || 20;
            return {
              video: Math.round(vr.height), expected: Math.round(expected),
              stageClips: sr.height < vr.height - 1,
              // The controls sit on the video's bottom edge: on screen, and not cut
              // off by the stage, whose overflow is hidden.
              controlsOnScreen: vr.bottom <= Math.min(innerHeight, sr.bottom) + 0.5 && vr.top >= -0.5,
              stage: Math.round(sr.height),
              metaLines: Math.round(meta.getBoundingClientRect().height / line),
              metaTitle: meta.getAttribute("title"),
              lastCueReachable: last.bottom <= lr.bottom + 1 && lr.bottom <= innerHeight + 0.5,
              listHeight: Math.round(lr.height),
            };
          });
          const label = `${width}x${height} ${shape} ${name === LONG ? "long" : "short"} name ${cues} cues ${tab}`;
          const ok = {
            "video at full size": m.video >= m.expected - 1 && !m.stageClips,
            "controls on screen": m.controlsOnScreen,
            "file name on one line": m.metaLines <= 1,
            "full name on hover": m.metaTitle === name,
            "last cue reachable": m.lastCueReachable,
          };
          for (const [what, pass] of Object.entries(ok)) if (!pass) fails.push(`${label}: ${what} (${JSON.stringify(m)})`);
          rows.push({ width, height, shape, name: name === LONG ? "long" : "short", cues, tab, ...m });
          if (shots && tab === "export") await page.screenshot({ path: join(shots, `${width}x${height}-${shape.replace(":", "x")}-${name === LONG ? "long" : "short"}-${cues}.png`) });
        }
        await page.close();
      }
    }
  }
}

await browser.close();
server.close();
if (process.env.FIT_JSON) (await import("node:fs")).writeFileSync(process.env.FIT_JSON, JSON.stringify(rows, null, 1));
console.log(`${rows.length} cases, ${fails.length} failures`);
for (const f of fails.slice(0, 40)) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
