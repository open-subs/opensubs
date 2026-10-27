// The subtitle list, edited in the page: times, delete, add, split, merge
// and undo, and every export -- .srt, .vtt, .txt, .ass and the burned MP4 --
// carrying the edited times.
//
//   npm run build && node e2e/cue-edit.mjs [--engine chromium|webkit|firefox] [--phone] [--burn] [--shots DIR]
//   node e2e/cue-edit.mjs --live https://opensubs.app   (the deployed page; no burn, analytics refused)
//
// Served from dist/ on a port of its own, with no export-gate.json (so the
// burn starts at once) and analytics refused. --burn burns the sample after
// editing it and reads frames back with ffmpeg: a deleted cue must leave
// its moment bare, and a cue whose end was pulled in must be gone by then.
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pw from "playwright";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(process.env.DIST ?? resolve(HERE, "../dist"));
const SAMPLE = resolve(HERE, "../public/sample.mp4");
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ENGINE = arg("--engine", "chromium");
const PHONE = args.includes("--phone");
const BURN = args.includes("--burn");
const PHASE = Number(arg("--phase", "3"));
const shots = args.includes("--shots") ? resolve(arg("--shots")) : null;
if (shots) mkdirSync(shots, { recursive: true });
const LIVE = arg("--live", null);
const tag = `${LIVE ? "live-" : ""}${ENGINE}-${PHONE ? "phone" : "desktop"}`;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__opensubs-cue-edit") return res.writeHead(200).end("opensubs-cue-edit");
  if (path === "/export-gate.json") return res.writeHead(404).end("not found");
  try {
    const target = join(DIST, path === "/" ? "/index.html" : path);
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
let base = LIVE?.replace(/\/$/, "");
if (!LIVE) {
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}`;
  if ((await fetch(`${base}/__opensubs-cue-edit`).then((r) => r.text())) !== "opensubs-cue-edit") {
    throw new Error(`the test server at ${base} is not this one`);
  }
}

let passed = 0;
let failed = 0;
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
const shot = async (target, name) => shots && target.screenshot({ path: join(shots, `${tag}-${name}.png`) });

const browser = await pw[ENGINE].launch(ENGINE === "chromium" ? { args: ["--no-proxy-server"] } : {});
const context = await browser.newContext({
  viewport: PHONE ? { width: 390, height: 844 } : { width: 1280, height: 1000 },
  ...(PHONE && ENGINE !== "firefox" ? { isMobile: true, hasTouch: true } : {}),
  locale: "en-US",
  acceptDownloads: true,
});
await context.route(/\/script\.js(\?.*)?$/, (r) => r.abort());
await context.route(/\/api\/send/, (r) => r.abort());
// Signed out, and never the real accounts server from a test origin.
await context.route("https://auth.opensubs.app/**", (r) =>
  r.request().method() === "OPTIONS"
    ? r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } })
    : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ methods: { google: true } }) }),
);
await context.addInitScript(() => {
  delete window.showOpenFilePicker;
  // A clean start on each load, unless a step is testing what survives one.
  try { if (!sessionStorage.getItem("cue-edit-keep")) localStorage.clear(); } catch {}
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const rows = page.locator("ol.cue-list > li.cue");
const row = (i) => rows.nth(i);
const clock = (i, edge) => row(i).locator(`input[data-edge="${edge}"]`);
const texts = () => page.locator("textarea.cue-text").evaluateAll((els) => els.map((e) => e.value));
const times = () =>
  page.locator("ol.cue-list > li.cue").evaluateAll((els) =>
    els.map((el) => [el.querySelector('[data-edge="start"]').value, el.querySelector('[data-edge="end"]').value]),
  );
const problem = (i) => row(i).locator(".cue-problem");
async function setClock(i, edge, value) {
  const input = clock(i, edge);
  await input.click();
  await input.fill(value);
  await input.press("Enter");
  // WebKit fires change on Enter; blur makes sure of it everywhere.
  await input.evaluate((el) => el.blur());
}
async function select(i) {
  await row(i).locator("textarea.cue-text").focus();
}
async function tool(i, name) {
  await select(i);
  await row(i).getByRole("button", { name, exact: true }).click();
}
async function exportTab() {
  const tab = page.getByRole("tab", { name: /^Export$/ });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}
async function subtitlesTab() {
  // The list sits with the picture, not in a tab; nothing to open.
}
async function exported(label) {
  await exportTab();
  const dl = page.waitForEvent("download", { timeout: 15000 });
  await page.getByRole("button", { name: label, exact: true }).click();
  const file = await dl;
  const path = await file.path();
  return { name: file.suggestedFilename(), text: await readFile(path, "utf8"), path };
}
async function seek(seconds) {
  await page.evaluate(async (s) => {
    const v = document.querySelector("video");
    v.pause();
    v.currentTime = s;
    await new Promise((r) => (v.seeking ? v.addEventListener("seeked", r, { once: true }) : r()));
  }, seconds);
}
async function sample() {
  await page.goto(`${base}/?sample`);
  await page.waitForFunction(() => document.querySelectorAll("textarea.cue-text").length === 3, null, { timeout: 90000 });
  await page.waitForFunction(() => (document.querySelector("video")?.duration ?? 0) > 9, null, { timeout: 30000 });
}
const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Each text box shows all of its text, wrapped lines included. */
const boxesFit = () =>
  page.locator("ol.cue-list textarea").evaluateAll((els) =>
    els.every((e) => e.offsetParent === null || e.scrollHeight <= e.clientHeight + 1),
  );

console.log(`cue editing on ${tag}, phase ${PHASE}`);

await section("times: typed, refused, and taken from the playhead", async () => {
  await sample();
  await shot(page.locator(".cue-panel"), "list");
  check((await clock(0, "start").inputValue()) === "0:00.000", "each cue shows its start", await clock(0, "start").inputValue());
  check((await clock(1, "end").inputValue()) === "0:05.857", "and its end", await clock(1, "end").inputValue());
  await setClock(1, "start", "3.2");
  check((await clock(1, "start").inputValue()) === "0:03.200", "a typed start is taken", await clock(1, "start").inputValue());
  await setClock(1, "start", "2.5");
  check(/overlaps the subtitle before, which ends at 0:03\.040/.test(await problem(1).innerText().catch(() => "")), "an overlap with the cue before is refused, and says where", await problem(1).innerText().catch(() => "(none)"));
  check((await clock(1, "start").inputValue()) === "0:03.200", "the field goes back to the time that stands");
  await shot(row(1), "refused");
  await setClock(1, "end", "0:03");
  check(/The start must be before the end/.test(await problem(1).innerText().catch(() => "")), "an end before the start is refused");
  await setClock(1, "end", "6.5");
  check(/overlaps the subtitle after, which starts at 0:06\.357/.test(await problem(1).innerText().catch(() => "")), "an overlap with the cue after is refused");
  await setClock(1, "end", "soon");
  check(/Type a time like 1:02\.5/.test(await problem(1).innerText().catch(() => "")), "a non-time is refused");
  await setClock(2, "end", "0:20");
  check(/The video ends at 0:10\./.test(await problem(2).innerText().catch(() => "")), "an end past the video is refused");
  await setClock(1, "end", "0:05,5");
  check((await clock(1, "end").inputValue()) === "0:05.500", "an .srt-style time is taken", await clock(1, "end").inputValue());
  check(!(await problem(1).isVisible().catch(() => false)), "and the complaint goes");
  await seek(8.2);
  await tool(2, "End at playhead");
  check((await clock(2, "end").inputValue()) === "0:08.200", "End at playhead", await clock(2, "end").inputValue());
  await seek(6.4);
  await tool(2, "Start at playhead");
  check((await clock(2, "start").inputValue()) === "0:06.400", "Start at playhead", await clock(2, "start").inputValue());
  check(/Play the video to near this subtitle first/.test(await row(2).locator(".cue-hint").innerText().catch(() => "")), "a selected cue says the playhead buttons use where the video is");
  check((await page.locator(".cue-hint").count()) === 1, "on the selected cue only", String(await page.locator(".cue-hint").count()));
  await shot(page.locator(".cue-panel"), "selected");
  // Paused far before the selected cue: the refusal says where the video is.
  await seek(1);
  await tool(2, "Start at playhead");
  check(/The video is at 0:01\.000, before the subtitle above ends \(0:05\.500\)/.test(await problem(2).innerText().catch(() => "")), "Start at playhead, video too early: says where it is", await problem(2).innerText().catch(() => "(none)"));
  check((await clock(2, "start").inputValue()) === "0:06.400", "and the start stands");
  await shot(row(2), "playhead-refused");
  await tool(2, "End at playhead");
  check(/The video is at 0:01\.000, before this subtitle starts \(0:06\.400\)/.test(await problem(2).innerText().catch(() => "")), "End at playhead, video too early: says where it is", await problem(2).innerText().catch(() => "(none)"));
  check((await clock(2, "end").inputValue()) === "0:08.200", "and the end stands");
  check(await noSideScroll(), "no sideways scroll");
});

await section("delete, and the exports carry the edited times", async () => {
  await tool(0, "Delete");
  check((await rows.count()) === 2, "a cue is deleted", String(await rows.count()));
  check(JSON.stringify(await times()) === JSON.stringify([["0:03.200", "0:05.500"], ["0:06.400", "0:08.200"]]), "the rest keep their times", JSON.stringify(await times()));
  const srt = await exported(".srt");
  check(srt.text.includes("1\n00:00:03,200 --> 00:00:05,500\nNothing was uploaded"), ".srt has the edited first cue", srt.text.slice(0, 80));
  check(srt.text.includes("2\n00:00:06,400 --> 00:00:08,200\n"), ".srt has the edited second cue");
  check(!srt.text.includes("sample video") && srt.text.trim().split(/\n\n/).length === 2, ".srt leaves the deleted cue out");
  const vtt = await exported(".vtt");
  check(vtt.text.includes("00:00:03.200 --> 00:00:05.500") && vtt.text.includes("00:00:06.400 --> 00:00:08.200"), ".vtt has the edited times");
  const txt = await exported(".txt");
  check(!txt.text.includes("sample video") && txt.text.includes("Nothing was uploaded"), ".txt leaves the deleted cue out");
  const ass = await exported(".ass");
  const dialogue = ass.text.split("\n").filter((l) => l.startsWith("Dialogue:"));
  check(dialogue.length >= 2 && dialogue[0].includes("0:00:03.20,0:00:05.50"), ".ass has the edited times", dialogue[0]?.slice(0, 60));
  check(!ass.text.includes("sample video"), ".ass leaves the deleted cue out");
  await writeFile(join(await mkdtemp(join(tmpdir(), "cue-edit-")), "edited.ass"), ass.text);
});

if (BURN && !LIVE) {
  await section("the burned MP4 uses the edited times", async () => {
    await exportTab();
    await page.getByRole("button", { name: /^Burn subtitles into the video$/ }).click();
    await page.locator(".burn-done").waitFor({ state: "attached", timeout: 240000 });
    const href = await page.locator(".burn-done a[download]").getAttribute("href");
    const bytes = await page.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), href);
    const dir = await mkdtemp(join(tmpdir(), "cue-burn-"));
    const out = join(dir, "burned.mp4");
    await writeFile(out, Buffer.from(bytes));
    // Pixels in the bottom third, where the subtitles are drawn, that differ
    // from the untouched sample by more than re-encoding ever moves one: a
    // drawn letter does, compression noise does not.
    const region = (file, t) =>
      execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=320:180,crop=320:60:0:120,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
    const diff = (t) => {
      const a = region(out, t);
      const b = region(SAMPLE, t);
      let hits = 0;
      for (let k = 0; k < Math.min(a.length, b.length); k++) if (Math.abs(a[k] - b[k]) > 64) hits += 1;
      return (100 * hits) / Math.min(a.length, b.length);
    };
    const at = { deleted: diff(1.5), shown: diff(4.5), ended: diff(8.5) };
    console.log(`    % of bottom-third pixels drawn over the source: ${JSON.stringify(Object.fromEntries(Object.entries(at).map(([k, v]) => [k, +v.toFixed(2)])))}`);
    check(at.shown > 0.5, "a kept cue is drawn at 4.5 s", at.shown.toFixed(2));
    check(at.deleted < 0.2, "the deleted cue's moment (1.5 s) is bare", at.deleted.toFixed(2));
    check(at.ended < 0.2, "a cue whose end moved to 8.2 s is gone at 8.5 s", at.ended.toFixed(2));
    if (shots) execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "4.5", "-i", out, "-frames:v", "1", join(shots, `${tag}-burned-4.5s.png`)]);
  });
}

await section("an imported .srt and .vtt are edited the same way", async () => {
  for (const [name, body] of [
    ["imported.srt", "1\n00:00:01,000 --> 00:00:02,000\nFirst line\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond line\n"],
    ["imported.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst line\n\n00:00:04.000 --> 00:00:05.000\nSecond line\n"],
  ]) {
    await page.locator('.cue-head input[type="file"]').setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(body) });
    await page.waitForFunction(() => document.querySelectorAll("textarea.cue-text").length === 2 && document.querySelector("textarea.cue-text").value === "First line", null, { timeout: 15000 });
    await setClock(0, "end", "2.75");
    await setClock(1, "start", "3.5");
    await tool(0, "Delete");
    const srt = await exported(".srt");
    check(srt.text === "1\n00:00:03,500 --> 00:00:05,000\nSecond line\n\n", `${name}: edited and exported`, JSON.stringify(srt.text));
  }
});

if (PHASE >= 2) {
  await section("add, split and merge", async () => {
    await sample();
    await seek(3.2);
    await page.getByRole("button", { name: "Add at playhead", exact: true }).click();
    check((await rows.count()) === 4, "a cue is added at the playhead", String(await rows.count()));
    check(JSON.stringify((await times())[1]) === JSON.stringify(["0:03.200", "0:03.540"]), "between the cues, up to the next", JSON.stringify((await times())[1]));
    check(await page.evaluate(() => document.activeElement?.classList.contains("cue-text")), "and its text box is ready to type in");
    await page.keyboard.type("Added");
    check((await texts())[1] === "Added", "typed into the new cue");
    await seek(1);
    await page.getByRole("button", { name: "Add at playhead", exact: true }).click();
    const busy = await page.locator(".cue-head-problem").innerText().catch(() => "");
    check(/The video is at 0:01\.000, where a subtitle is already showing \(0:00\.000–0:03\.040\)/.test(busy), "not over a cue that is showing, and says where the video is", busy);
    check(/Select a subtitle and use “Add after” instead/.test(busy), "and points to Add after");
    await shot(page.locator(".cue-panel"), "add-refused");
    await tool(1, "Delete");
    await tool(2, "Add after");
    check(JSON.stringify((await times())[3]) === JSON.stringify(["0:08.874", "0:10.160"]), "Add after: from its end to the video's end", JSON.stringify((await times())[3]));
    await tool(3, "Delete");

    // Split at the cursor: "Nothing was | uploaded to make these captions."
    const box = row(1).locator("textarea.cue-text");
    await box.focus();
    await box.evaluate((el) => el.setSelectionRange("Nothing was".length, "Nothing was".length));
    await row(1).getByRole("button", { name: "Split at cursor", exact: true }).click();
    check(JSON.stringify((await texts()).slice(1, 3)) === JSON.stringify(["Nothing was", "uploaded to make these captions."]), "split at the cursor", JSON.stringify((await texts()).slice(1, 3)));
    const [, a, b] = await times();
    check(a[0] === "0:03.540" && b[1] === "0:05.857" && a[1] === b[0], "the time is split between them", JSON.stringify([a, b]));
    await shot(page.locator(".cue-panel"), "split");
    await tool(1, "Merge with next");
    check((await texts())[1] === "Nothing was\nuploaded to make these captions.", "merged back, a line each", JSON.stringify((await texts())[1]));
    check(JSON.stringify((await times())[1]) === JSON.stringify(["0:03.540", "0:05.857"]), "over both cues' time");
    await seek(7);
    await tool(2, "Split at playhead");
    check((await times())[2][1] === "0:07.000" && (await times())[3][0] === "0:07.000", "split at the playhead", JSON.stringify((await times()).slice(2)));
    await seek(1);
    await tool(1, "Split at playhead");
    check(/The video is at 0:01\.000, outside this subtitle \(0:03\.540–0:05\.857\)/.test(await problem(1).innerText().catch(() => "")), "not when the playhead is outside the cue, and says where it is", await problem(1).innerText().catch(() => "(none)"));
    const srt = await exported(".srt");
    check(srt.text.trim().split(/\n\n/).length === 4 && srt.text.includes("00:00:07,000 -->"), "the .srt has all four", String(srt.text.trim().split(/\n\n/).length));
    check(await noSideScroll(), "no sideways scroll");
  });

  await section("a translated track: original and translation stay paired", async () => {
    // A translation as the app holds one, put in through the saved work the
    // page restores on load -- the same path a sign-in round trip takes.
    await page.evaluate(() => {
      const source = [
        { start: 0, end: 3.04, lines: ["This is a sample video, subtitled in your browser."] },
        { start: 3.54, end: 5.857, lines: ["Nothing was uploaded to make these captions."] },
      ];
      const cues = [
        { start: 0, end: 3.04, lines: ["这是一个示例视频，在你的浏览器里加上字幕。"] },
        { start: 3.54, end: 5.857, lines: ["制作这些字幕时没有上传任何东西。"] },
      ];
      sessionStorage.setItem("cue-edit-keep", "1");
      localStorage.setItem("opensubs.work", JSON.stringify({
        at: Date.now(), videoName: "sample.mp4", cues, sourceCues: source,
        loudness: source.map((c) => c.lines[0].split(/\s+/).map(() => 0.5)),
        selectedStyle: "Clean", wordEffect: "none", translateTo: "zh-Hans", translatedTo: "zh-Hans",
        bilingual: true, bilingualOrder: "original-first", originalScale: 0.8, knownSource: "en", sourceLanguage: "en",
      }));
    });
    await page.goto(`${base}/`);
    await page.getByRole("button", { name: "Restore subtitles", exact: true }).click();
    await page.evaluate(() => sessionStorage.removeItem("cue-edit-keep"));
    await page.waitForFunction(() => document.querySelectorAll("textarea.cue-text").length === 2, null, { timeout: 20000 });
    check((await page.locator("textarea.cue-original").count()) === 2, "each cue shows its original beside the translation");
    const original = row(1).locator("textarea.cue-original");
    await original.focus();
    await original.evaluate((el) => el.setSelectionRange("Nothing was uploaded".length, "Nothing was uploaded".length));
    await row(1).getByRole("button", { name: "Split at cursor", exact: true }).click();
    const originals = await page.locator("textarea.cue-original").evaluateAll((els) => els.map((e) => e.value));
    check(JSON.stringify(originals.slice(1)) === JSON.stringify(["Nothing was uploaded", "to make these captions."]), "the original splits at the cursor", JSON.stringify(originals));
    const translated = await texts();
    check(translated.length === 3 && translated[1] && translated[2] && translated[1] + translated[2] === "制作这些字幕时没有上传任何东西。", "the translation splits by proportion, nothing lost", JSON.stringify(translated));
    check((await page.locator(".cue-check").count()) === 2, "both halves say to check the translation");
    check(/Check the translation/.test(await row(1).locator(".cue-check span").innerText()), "in words", await row(1).locator(".cue-check span").innerText());
    await shot(page.locator(".cue-panel"), "bilingual-split");
    const srt = await exported(".srt");
    check(srt.text.includes("Nothing was uploaded\n") && srt.text.trim().split(/\n\n/).length === 3, "both languages export, three cues", srt.text.slice(0, 120));
    await row(1).getByRole("button", { name: "Looks right", exact: true }).click();
    check((await page.locator(".cue-check").count()) === 1, "a mark can be dismissed");
    if (PHASE >= 3) {
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      const back = await page.locator("textarea.cue-original").evaluateAll((els) => els.map((e) => e.value));
      check((await texts()).length === 2 && back.length === 2 && back[1] === "Nothing was uploaded to make these captions.", "undoing the split puts both languages back together", JSON.stringify(back));
      check((await page.locator(".cue-check").count()) === 0, "and the marks go with it");
    }
  });
}

if (PHASE >= 3) {
  await section("undo and redo", async () => {
    await page.evaluate(() => localStorage.clear());
    await sample();
    await tool(0, "Delete");
    await setClock(0, "start", "3.2");
    const box = row(0).locator("textarea.cue-text");
    await box.focus();
    await box.press("End");
    await page.keyboard.type(" Edited");
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    const redo = page.getByRole("button", { name: "Redo", exact: true });
    await undo.click();
    check((await texts())[0] === "Nothing was uploaded to make these captions.", "undo takes back a run of typing in one step", JSON.stringify((await texts())[0]));
    await undo.click();
    check((await clock(0, "start").inputValue()) === "0:03.540", "then the time", await clock(0, "start").inputValue());
    await undo.click();
    check((await rows.count()) === 3, "then the delete", String(await rows.count()));
    check(await undo.isDisabled(), "and then there is nothing to undo");
    await redo.click();
    check((await rows.count()) === 2, "redo");
    // The keyboard: outside a text box, Ctrl/Cmd+Z is the list's undo...
    await page.locator(".cue-head").click({ position: { x: 2, y: 2 } });
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+z`);
    check((await rows.count()) === 3, `${mod}+Z outside a text box undoes the list`, String(await rows.count()));
    await page.keyboard.press(`${mod}+Shift+z`);
    check((await rows.count()) === 2, `${mod}+Shift+Z redoes it`, String(await rows.count()));
    // ...and inside one it is the browser's own, for the text.
    await box.focus();
    await box.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press(`${mod}+z`);
    check((await rows.count()) === 2, "inside a text box it leaves the list alone", String(await rows.count()));
    const srt = await exported(".srt");
    check(srt.text.trim().split(/\n\n/).length === 2, "the export follows the undone state");
    await page.evaluate(() => sessionStorage.setItem("cue-edit-keep", "1"));
    // Not a reload of /?sample, which opens the sample afresh.
    await page.goto(`${base}/`);
    await page.getByRole("button", { name: "Restore subtitles", exact: true }).click();
    await page.evaluate(() => sessionStorage.removeItem("cue-edit-keep"));
    await page.waitForFunction(() => document.querySelectorAll("textarea.cue-text").length > 0, null, { timeout: 20000 });
    check((await rows.count()) === 2, "and survives a reload", String(await rows.count()));
  });
}

await section("phone-width text boxes show every line", async () => {
  await page.evaluate(() => localStorage.clear());
  await sample();
  const long = "A much longer subtitle than the others, so that it wraps onto several lines in a narrow box on a phone";
  await row(1).locator("textarea.cue-text").fill(long);
  check(await boxesFit(), "every box is as tall as its text");
  await page.setViewportSize({ width: PHONE ? 360 : 900, height: 844 });
  await page.waitForTimeout(300);
  check(await boxesFit(), "and still after the width changes");
  check(await noSideScroll(), "no sideways scroll");
  await shot(page.locator(".cue-panel"), "wrapped");
});

check(errors.length === 0, "no page errors", errors.join(" | ").slice(0, 200));
await browser.close();
if (!LIVE) server.close();
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
