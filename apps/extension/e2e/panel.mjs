// The popup as a person sees it: in their browser's language, short enough to
// start from, and honest on pages it cannot work on.
//
//   node e2e/panel.mjs --lang zh-CN [--package dist] [--shots DIR] [--video lecture.mp4]
//
// Three things, each asserted rather than looked at:
//
//   language   the browser is launched in --lang, and every word in the panel
//              -- the folded settings too -- must come out in that language;
//              an English launch must stay English
//   reach      on its first open, with nothing changed, Start is on screen at
//              the smallest height the panel is shown at, without scrolling,
//              and no text is cut off or pushes the panel sideways
//   refusal    Start on the browser's own pages and on a store page says where
//              the extension does work, in that language, and never passes
//              the browser's own error through -- both from the popup's check
//              of the address and from the background, when the injection is
//              refused on a page that check did not know
//
// With --video the panel is also caught mid-run: the video is played, Start is
// sent with the default settings, and the panel is read once lines arrive.
//
// Chromium takes its interface language from --lang on Linux and Windows. On
// macOS it ignores --lang and reads the AppleLanguages default instead, and
// the renderer and the service worker then disagree -- the panel came up in
// Chinese while the background reported en-GB. So on a Mac, set it for the
// test browser alone and put it back afterwards:
//
//   defaults write com.google.chrome.for.testing AppleLanguages '("zh-CN")'
//   node e2e/panel.mjs --lang zh-CN ...
//   defaults delete com.google.chrome.for.testing AppleLanguages
//
// The first check fails if the browser is not in the language asked for.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { cpSync, createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const lang = flag("--lang", "en-US");
const shots = args.includes("--shots") ? resolve(flag("--shots")) : null;
const video = args.includes("--video") ? resolve(flag("--video")) : null;
const chinese = /^zh/i.test(lang);
// What the panel should come out in, by the product's own rule, and its words
// in that language -- so the checks below hold for any --lang.
const { resolveLocale } = await import("../../web/src/lib/i18n/locales.ts");
const i18n = await import("../src/lib/i18n.ts");
const { NOT_A_WEB_PAGE } = await import("../src/lib/pages.ts");
const expected = resolveLocale([lang]);
const say = (text, vars) => { i18n.setLocale(expected); return i18n.t(text, vars); };
const translated = Object.keys(i18n.catalogues()[expected] ?? {}).filter((k) => say(k) !== k);

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ok    ${name}`); return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
  console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
};

const work = mkdtempSync(join(tmpdir(), "opensubs-panel-"));
const unpacked = join(work, "extension");
cpSync(resolve(flag("--package", "dist")), unpacked, { recursive: true });
const manifestPath = join(unpacked, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// As in installed.mjs: the test copy may read the local video page without the
// permission prompt nobody can click from automation. The package on disk is
// not touched.
manifest.host_permissions = [...(manifest.host_permissions ?? []), "http://127.0.0.1/*"];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const server = createServer((req, res) => {
  if (req.url === "/" && video) {
    res.writeHead(200, { "content-type": "text/html" }).end(
      `<!doctype html><title>video</title><video src="/v.mp4" controls style="width:640px"></video>`);
    return;
  }
  if (req.url?.startsWith("/v.mp4") && video) {
    const size = statSync(video).size;
    res.writeHead(200, { "content-type": "video/mp4", "content-length": size, "accept-ranges": "bytes" });
    createReadStream(video).pipe(res);
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  // Full Chromium: the headless shell cannot load extensions.
  channel: "chromium",
  headless: true,
  locale: lang,
  env: { ...process.env, LANG: `${lang.replace("-", "_")}.UTF-8`, LANGUAGE: lang.replace("-", "_") },
  args: [
    `--disable-extensions-except=${unpacked}`,
    `--load-extension=${unpacked}`,
    `--lang=${lang}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});

let exitCode = 0;
try {
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent("serviceworker", { timeout: 30000 });
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const ui = await worker.evaluate(() => chrome.i18n.getUILanguage());
  console.log(`browser interface language: ${ui}`);
  ok(`the browser reports the language it was launched in (${lang})`, ui.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()), ui);

  // English words that may stand in a Chinese panel: names, units, formats.
  const KEEP = /^(OpenSubs|Hugging|Face|Base|Tiny|Small|GPU|CPU|Firefox|Intel|Apple|Web|Audio|srt|MB)$/;

  /** Open the panel afresh at a height, and measure it. */
  async function panel(height, { open = false, tab = null } = {}) {
    const page = await context.newPage();
    // Opened as a tab, the panel's "active tab" would be itself. Pointed at
    // the page under test instead -- the one thing the toolbar does that a
    // tab cannot -- before its script asks.
    if (tab) {
      await page.addInitScript(({ id, url }) => {
        if (globalThis.chrome?.tabs) chrome.tabs.query = async () => [{ id, url }];
      }, tab);
    }
    await page.setViewportSize({ width: 320, height });
    await page.goto(`${base}/popup.html`);
    await page.waitForFunction(() => document.querySelector("#language option"));
    await page.waitForTimeout(400);
    if (open) await page.evaluate(() => { document.querySelector("#advanced").open = true; });
    const m = await page.evaluate(() => {
      const go = document.querySelector("#go").getBoundingClientRect();
      const clipped = [...document.querySelectorAll("button, label, summary, select, .status, .hint, .foot, h1, .sub, .changed, option")]
        .filter((el) => el.offsetParent !== null && el.tagName !== "OPTION")
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.tagName.toLowerCase()}#${el.id}: ${el.textContent.trim().slice(0, 30)}`);
      const words = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest("script,style") || !n.textContent.trim()) continue;
        // The interface-language list names each language in itself, by design.
        if (el.closest("[lang]:not(html)")) continue;
        // Folded text is still text a person will read once they unfold it,
        // and <option>s are read when the menu opens; both count.
        words.push(n.textContent.trim());
      }
      const buttons = [...document.querySelectorAll(".actions button")].map((b) => ({
        text: b.textContent, lines: Math.round(b.getBoundingClientRect().height / parseFloat(getComputedStyle(b).lineHeight) - 0.6),
      }));
      return {
        goBottom: Math.round(go.bottom), goTop: Math.round(go.top), inner: innerHeight,
        content: Math.ceil(document.body.getBoundingClientRect().height), sideways: document.documentElement.scrollWidth > innerWidth,
        clipped, words, buttons, lang: document.documentElement.lang, dir: document.documentElement.dir, go: document.querySelector("#go").textContent,
        changed: document.querySelector("#changed").hidden ? "" : document.querySelector("#changed").textContent,
      };
    });
    return { page, ...m };
  }

  /** The panel at its own height, as the toolbar shows it. */
  async function shoot(page, name) {
    if (!shots) return;
    mkdirSync(shots, { recursive: true });
    const h = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    await page.setViewportSize({ width: 320, height: Math.min(h, 600) });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots, `${lang}-${name}.png`) });
  }

  const english = (words) => words.flatMap((w) => w.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !KEEP.test(w));

  // --- reach and language, on a first open ------------------------------
  // Chrome sizes a popup to its content, up to 600px. The first open is the
  // content's own height; it is also checked squeezed, as a short window
  // squeezes it.
  {
    const first = await panel(600);
    console.log(`first open: content ${first.content}px tall, Start at ${first.goTop}-${first.goBottom}px`);
    ok("Start is the panel's own word for it", first.go === say("Start"), first.go);
    ok(`<html lang> follows the browser: ${lang} -> ${first.lang}`, first.lang === expected, first.lang);
    ok("the panel runs left to right", first.dir === "ltr", first.dir);
    ok("on first open the whole panel fits without scrolling", first.content <= first.inner, `${first.content} > ${first.inner}`);
    ok("nothing is cut off", first.clipped.length === 0, first.clipped.join("; "));
    ok("nothing pushes the panel sideways", !first.sideways);
    ok("no setting is counted as changed", first.changed === "", first.changed);
    for (const b of first.buttons) ok(`button "${b.text}" sits on one line`, b.lines <= 1, `${b.lines} lines`);
    // Each model gives its download and, in this language, about how much
    // memory it takes (the measured figures in ../web/src/lib/asr.ts).
    const models = await first.page.evaluate(() =>
      [...document.querySelectorAll("#model option")].filter((o) => o.value !== "auto").map((o) => o.textContent));
    const [before, after] = say("needs about {memory} of memory", { memory: "\u0000" }).split("\u0000");
    ok("every model says, in this language, about how much memory it needs",
      models.length === 3 && models.every((m) => m.includes(before) && m.includes(after) && /\d(\.\d)? GB/.test(m)), models.join(" | "));
    await shoot(first.page, "1-first-open");
    const natural = first.content;
    await first.page.close();

    // The smallest a popup gets is its own content; a shorter window can cut
    // it further. Start must survive both.
    for (const h of [natural, 360, 300]) {
      const p = await panel(h);
      ok(`at ${h}px tall Start is visible without scrolling`, p.goBottom <= h, `bottom ${p.goBottom}`);
      await p.page.close();
    }

    const open = await panel(600, { open: true });
    const leftover = english(open.words);
    if (chinese) ok("every word, folded settings included, is Chinese", leftover.length === 0, leftover.join(" "));
    if (expected === "en") ok("the English panel is all English", !open.words.some((w) => /[\u3400-\u9fff]/.test(w)));
    else {
      const stillEnglish = open.words.filter((w) => translated.includes(w));
      ok(`no word that has a ${expected} translation is left in English`, stillEnglish.length === 0, stillEnglish.join(" | "));
    }
    ok("unfolded: nothing is cut off", open.clipped.length === 0, open.clipped.join("; "));
    ok("unfolded: nothing pushes the panel sideways", !open.sideways);
    console.log(`unfolded: content ${open.content}px tall`);
    await shoot(open.page, "2-advanced-open");
    // Remembered: the next open comes up unfolded.
    await open.page.evaluate(() => document.querySelector("#advanced").dispatchEvent(new Event("toggle")));
    await open.page.close();
    const again = await panel(600);
    ok("the fold is remembered for the next open", await again.page.evaluate(() => document.querySelector("#advanced").open));
    await again.page.evaluate(() => { const d = document.querySelector("#advanced"); d.open = false; d.dispatchEvent(new Event("toggle")); });
    await again.page.close();
  }

  // --- the interface language, chosen in the panel -----------------------
  {
    const p = await panel(600, { open: true });
    const offered = await p.page.evaluate(() => [...document.querySelectorAll("#locale option")].map((o) => o.textContent));
    ok("the interface language list is Follow browser and the eight, each in itself",
      JSON.stringify(offered) === JSON.stringify([say("Follow browser"), "English", "简体中文", "繁體中文", "日本語", "한국어", "Deutsch", "Español", "Português"]),
      offered.join(", "));
    const labels = await p.page.evaluate(() => [...document.querySelectorAll("label")].map((l) => l.textContent.trim()));
    ok("the panel's own language and the video's are labelled apart",
      labels.includes(say("Interface language")) && labels.includes(say("Spoken language")) && say("Interface language") !== say("Spoken language"),
      labels.join(" | "));
    await shoot(p.page, "8-interface-language");
    const other = expected === "de" ? "ja" : "de";
    await p.page.selectOption("#locale", other);
    await p.page.waitForTimeout(300);
    const now = await p.page.evaluate(() => ({
      go: document.querySelector("#go").textContent, lang: document.documentElement.lang,
      label: document.querySelector("label[for=language]").textContent,
    }));
    i18n.setLocale(other);
    const theirs = { go: i18n.t("Start"), label: i18n.t("Spoken language") };
    ok(`choosing ${other} redraws the panel at once`, now.go === theirs.go && now.lang === other && now.label === theirs.label, JSON.stringify(now));
    await shoot(p.page, `9-switched-to-${other}`);
    await p.page.close();
    const again = await panel(600);
    ok(`and ${other} is remembered on the next open`, again.go === theirs.go && again.lang === other, `${again.go} ${again.lang}`);
    ok("and counted as a changed setting", again.changed === (i18n.setLocale(other), i18n.t("1 changed")), again.changed);
    await again.page.evaluate(() => chrome.storage.local.remove("settings"));
    await again.page.close();
    const back = await panel(600);
    ok("Follow browser brings the browser's language back", back.go === say("Start") && back.lang === expected, `${back.go} ${back.lang}`);
    await back.page.evaluate(() => { const d = document.querySelector("#advanced"); d.open = false; d.dispatchEvent(new Event("toggle")); });
    await back.page.close();
  }

  // --- a changed setting shows on the fold --------------------------------
  {
    const p = await panel(600);
    await p.page.evaluate(() => chrome.storage.local.set({
      settings: { model: "onnx-community/whisper-tiny.en", language: "auto", window: 20, overlay: false, fontScale: 0.8, backend: "auto" },
    }));
    await p.page.close();
    const q = await panel(600);
    ok("two settings changed are counted on the folded header", q.changed === say("{n} changed", { n: 2 }), q.changed);
    await shoot(q.page, "3-two-changed");
    await q.page.evaluate(() => chrome.storage.local.remove("settings"));
    await q.page.close();
  }

  // --- pages the extension cannot work on --------------------------------
  const want = say(NOT_A_WEB_PAGE);
  const raw = /cannot be scripted|Cannot access|chrome:\/\/|error page|permission/i;
  for (const target of ["chrome://extensions/", "chrome://newtab/", "https://chromewebstore.google.com/", "about:blank"]) {
    const tab = await context.newPage();
    await tab.goto(target, { timeout: 20000 }).catch(() => undefined);
    const probe = await panel(600);
    const id = await probe.page.evaluate(async () => {
      const me = (await chrome.tabs.getCurrent()).id;
      const all = await chrome.tabs.query({});
      return all.filter((t) => t.id !== me).at(-1).id;
    });
    await probe.page.close();
    const p = await panel(600, { tab: { id, url: target } });
    await p.page.click("#go");
    await p.page.waitForFunction(() => !document.querySelector("#status").hidden, null, { timeout: 5000 }).catch(() => undefined);
    const said = await p.page.evaluate(() => document.querySelector("#status").textContent);
    ok(`popup on ${target}: says where it does work`, said === want, said);
    if (target.includes("webstore")) await shoot(p.page, "4-store-page");

    // And the background, for a page the address check does not know: the
    // injection is refused and must come back as the same sentence.
    const state = await p.page.evaluate(async (tabId) => {
      await chrome.runtime.sendMessage({ kind: "start", tabId, settings: {
        model: "auto", language: "auto", window: 20, overlay: true, fontScale: 0.8, backend: "auto" } });
      return chrome.runtime.sendMessage({ kind: "state", tabId });
    }, id);
    ok(`background on ${target}: the refusal is turned into guidance`, state.status.note === want, state.status.note);
    ok(`background on ${target}: no browser error text`, !raw.test(state.status.note), state.status.note);
    await p.page.close();
    await tab.close();
  }

  // --- mid-run, on the defaults ------------------------------------------
  if (video) {
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await page.evaluate(() => document.querySelector("video").play());
    const control = await panel(600);
    const tabId = await control.page.evaluate(async (o) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(o)).id, origin);
    await control.page.evaluate(async (tabId) => {
      const { settings } = await chrome.runtime.sendMessage({ kind: "state", tabId });
      await chrome.runtime.sendMessage({ kind: "start", tabId, settings });
    }, tabId);
    const until = Date.now() + 240000;
    let state;
    while (Date.now() < until) {
      state = await control.page.evaluate((tabId) => chrome.runtime.sendMessage({ kind: "state", tabId }), tabId);
      if (state.count >= 3 || state.status.stage === "error") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(`mid-run: ${state.count} lines, status "${state.status.note}"`);
    ok("a run on the default settings produces subtitles", state.count >= 3, `${state.count} lines, ${state.status.note}`);
    if (chinese) ok("its status is in Chinese", /[\u3400-\u9fff]/.test(state.status.note), state.status.note);
    await control.page.close();
    const live = await panel(600, { tab: { id: tabId, url: `${origin}/` } });
    ok("mid-run Start reads Stop", live.go === say("Stop"), live.go);
    ok("mid-run: nothing is cut off", live.clipped.length === 0, live.clipped.join("; "));
    await shoot(live.page, "5-running");
    if (shots) await page.screenshot({ path: join(shots, `${lang}-6-video.png`) });
    const srt = await live.page.evaluate((tabId) => chrome.runtime.sendMessage({ kind: "cues", tabId }), tabId);
    console.log(`first lines:\n${srt.srt.split("\n").slice(0, 12).join("\n")}`);
    await live.page.evaluate((tabId) => chrome.runtime.sendMessage({ kind: "stop", tabId }), tabId);
    const stopped = await panel(600, { tab: { id: tabId, url: `${origin}/` } });
    ok("after Stop the lines are kept and offered", (await stopped.page.evaluate(() => !document.querySelector("#save").disabled)));
    await shoot(stopped.page, "7-stopped");
    await stopped.page.close();
    await live.page.close();
    await page.close();
  }
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await context.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(exitCode || (fails.length ? 1 : 0));
