// The default model and the GPU / CPU switch, in the built page (APP-111).
//
// e2e/device.mjs tests the rule. This tests what a person is shown: the page
// is loaded with navigator.gpu standing in for each kind of machine, and the
// model picker, the switch and the caption are read back from the DOM.
//
// The stand-in only answers requestAdapter(), which is the one WebGPU call the
// page makes before a transcription starts. Nothing here transcribes.
//
//   npm run build && node e2e/backend.mjs [--shots DIR] [video.mp4]
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const video = args.find((a) => /\.(mp4|webm|mov)$/i.test(a));
const dist = resolve("dist");
if (!existsSync(join(dist, "index.html"))) {
  console.error("no dist/ -- run npm run build first");
  process.exit(2);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = join(dist, path === "/" ? "index.html" : path);
  if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => { if (cond) pass += 1; else fails.push(`${name}${detail ? ` -- ${detail}` : ""}`); };

const machines = [
  { name: "iris-xe", label: "Intel Iris Xe (the reported laptop)", info: { vendor: "intel", architecture: "gen-12lp" }, model: "whisper-base", switch: true },
  { name: "apple", label: "Apple silicon", info: { vendor: "apple", architecture: "metal-3" }, model: "whisper-small", switch: true },
  { name: "nvidia", label: "NVIDIA discrete", info: { vendor: "nvidia", architecture: "ampere" }, model: "whisper-small", switch: true },
  { name: "none", label: "no WebGPU", info: null, model: "whisper-base", switch: false },
  // APP-121: Firefox withholds every field, so its GPU cannot be judged, and
  // on the reporter's Iris Xe its WebGPU was dozens of times slower than its
  // CPU. It starts on the CPU, with Base, and keeps the switch.
  { name: "firefox", label: "Firefox, adapter says nothing", info: { vendor: "", architecture: "", device: "", description: "" },
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0",
    model: "whisper-base", switch: true, backend: "cpu" },
  // The same empty adapter in Chrome is left alone: not measured.
  { name: "chrome-anon", label: "Chrome, adapter says nothing", info: { vendor: "", architecture: "" },
    model: "whisper-small", switch: true, backend: "gpu" },
];

const browser = await chromium.launch();
for (const m of machines) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, ...(m.ua ? { userAgent: m.ua } : {}) });
  await page.addInitScript((info) => {
    const gpu = info
      ? { requestAdapter: async () => ({ info, features: new Set(), limits: {} }) }
      : undefined;
    Object.defineProperty(Navigator.prototype, "gpu", { configurable: true, get: () => gpu });
  }, m.info);
  await page.goto(base);
  // The video input specifically: the page also has two subtitle inputs, and
  // an ambiguous selector is refused outright.
  if (video) await page.setInputFiles('input[type="file"][accept="video/*"]', video);

  // The default is set when asrSupport() answers; wait for the model picker
  // to settle on something rather than reading it on the first frame.
  const model = page.locator("select").filter({ has: page.locator('option[value*="whisper"]') }).first();
  await model.waitFor();
  await page.waitForTimeout(800);
  const chosen = await model.inputValue();
  ok(`${m.label}: the default model is ${m.model.replace("whisper-", "")}`, chosen.includes(m.model), chosen);

  const backend = page.locator("select").filter({ has: page.locator('option[value="cpu"]') });
  const hasSwitch = (await backend.count()) > 0;
  ok(`${m.label}: the GPU / CPU switch is ${m.switch ? "offered" : "not offered"}`, hasSwitch === m.switch);

  if (shots) await model.locator("xpath=ancestor::div[contains(@class,'field-row')]").screenshot({ path: `${shots}/${m.name}-gpu.png` }).catch(() => {});

  if (hasSwitch && m.backend) {
    ok(`${m.label}: it starts on the ${m.backend.toUpperCase()}`, (await backend.inputValue()) === m.backend, await backend.inputValue());
  }
  if (hasSwitch && m.backend === "cpu") {
    // Started on the CPU, the way back is the switch, and the model follows.
    await backend.selectOption("gpu");
    await page.waitForTimeout(300);
    ok(`${m.label}: the GPU is one switch away`, (await backend.inputValue()) === "gpu");
  } else if (hasSwitch) {
    await backend.selectOption("cpu");
    await page.waitForTimeout(300);
    const onCpu = await model.inputValue();
    ok(`${m.label}: on the CPU the default is Base, whatever the GPU was`, onCpu.includes("whisper-base"), onCpu);
    if (video) {
      const warned = await page.getByText("about four times the download", { exact: false }).count();
      ok(`${m.label}: choosing the CPU says what it costs`, warned > 0);
    }
    if (shots) await page.locator(".card-intro").first().locator("xpath=ancestor::section[1]").screenshot({ path: `${shots}/${m.name}-cpu.png` }).catch(() => {});
    await backend.selectOption("gpu");
    await page.waitForTimeout(300);
    ok(`${m.label}: back on the GPU the default returns`, (await model.inputValue()).includes(m.model), await model.inputValue());

    // A model the person picked is theirs: the switch must not change it.
    await model.selectOption({ index: 0 });
    const picked = await model.inputValue();
    await backend.selectOption("cpu");
    await page.waitForTimeout(300);
    ok(`${m.label}: a model the user picked survives the switch`, (await model.inputValue()) === picked, await model.inputValue());
  }
  await page.close();
}
await browser.close();
server.close();

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
