// How much memory a transcription actually takes, per model and backend.
//
//   node e2e/enginecheck/serve.mjs                # in one terminal
//   node e2e/enginecheck/memory.mjs [--models tiny.en,base,small] [--devices webgpu,wasm]
//                                   [--clip en.wav] [--port 5180] [--headed]
//
// Drives the engine check (check.ts, the real `transcribeLocally`) in
// Chromium and samples the whole browser's memory -- every process under the
// one Playwright started, summed as PSS from /proc/<pid>/smaps_rollup, so a
// page shared by two processes is not counted twice. Linux only.
//
// What it prints is the peak during the run minus the same browser sitting
// on an idle page of the same origin: the memory the model and the
// transcription cost on top of having the tab open, which is what the model
// picker's "about … of memory" claims (see ASR_MODELS in src/lib/asr.ts).
//
// Each run gets a fresh browser so one model's heap cannot inflate the next
// one's peak, on one profile so the download happens once: the first time a
// model and backend are seen, a warm-up run fills the cache and is not
// counted. On a discrete GPU the WebGPU weights live in video memory, which
// PSS does not see; where nvidia-smi exists the rise in GPU memory used is
// printed beside it (and includes anything else using that GPU meanwhile).
// The adapter is printed too: a headless Chromium on Linux often gets
// SwiftShader, a CPU implementation of WebGPU, whose "GPU" buffers are
// ordinary memory -- the same arrangement as integrated graphics and Apple
// silicon, where the GPU has no memory of its own.
import { chromium } from "playwright";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const port = flag("--port", "5180");
// en40.wav: the first 40 s of en.wav (ffmpeg -t 40), so a run is one full
// 30-second window and a part one. The peak is the model's, not the clip's
// -- a 116-second clip adds about 5 MB of samples -- and the WASM runs of
// Small would otherwise take most of an hour.
const clip = flag("--clip", "en40.wav");
const models = flag("--models", "tiny.en,base,small").split(",");
const devices = flag("--devices", "webgpu,wasm").split(",");
const profile = resolve(flag("--profile", join(tmpdir(), "enginecheck-memory-profile")));

const MB = 1024 * 1024;

function children() {
  const kids = new Map();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      // The command may contain spaces and parentheses; the fields after
      // the last ")" are fixed.
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(name));
    } catch {}
  }
  return kids;
}

/** PSS of the whole tree, and of each process type (browser, renderer, gpu-process, ...). */
function treePss(root) {
  const kids = children();
  let total = 0;
  const byType = {};
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop();
    try {
      const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"));
      if (m) {
        const type = /--type=([\w-]+)/.exec(readFileSync(`/proc/${pid}/cmdline`, "utf8"))?.[1] ?? "browser";
        total += Number(m[1]) * 1024;
        byType[type] = (byType[type] ?? 0) + Number(m[1]) * 1024;
      }
    } catch {}
    stack.push(...(kids.get(pid) ?? []));
  }
  return { total, byType };
}

function gpuUsed() {
  try {
    return Number(execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"],
      { encoding: "utf8" }).split("\n")[0]) * MB;
  } catch { return null; }
}

/** The browser's own pid: the process whose command line names this profile. */
function browserPid(profile) {
  const kids = children();
  const pids = [...kids.values()].flat();
  const named = pids.filter((pid) => {
    try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(profile); } catch { return false; }
  });
  // The one whose parent is not itself in the set: the root of the tree.
  return named.find((pid) => !named.some((p) => (kids.get(p) ?? []).includes(pid)));
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(model, device) {
  mkdirSync(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: !args.includes("--headed"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan"],
  });
  const pid = browserPid(profile);
  const page = await context.newPage();
  await page.goto(`http://localhost:${port}/robots.txt`).catch(() => page.goto("about:blank"));
  await settle(3000);
  const { total: idle, byType: idleByType } = treePss(pid);
  const idleGpu = gpuUsed();

  let peak = idle, peakGpu = idleGpu, peakByType = idleByType;
  const timer = setInterval(() => {
    const now = treePss(pid);
    if (now.total > peak) ({ total: peak, byType: peakByType } = now);
    const g = gpuUsed();
    if (g != null) peakGpu = Math.max(peakGpu ?? 0, g);
  }, 200);
  const query = new URLSearchParams({ model: `onnx-community/whisper-${model}`, clip });
  if (device === "wasm") query.set("device", "wasm");
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForFunction(() => /transcribed|FAILED/.test(document.getElementById("out")?.textContent ?? ""),
    null, { timeout: 60 * 60 * 1000, polling: 1000 });
  clearInterval(timer);
  const out = await page.textContent("#out");
  const support = JSON.parse(/support: (.*)/.exec(out)?.[1] ?? "{}");
  const result = out.split("\n").find((l) => /transcribed|FAILED/.test(l))?.trim();
  await context.close();
  return {
    model, device, ran: device === "wasm" ? "wasm" : support.device, adapter: support.gpu ?? null, result,
    idleMB: Math.round(idle / MB), peakMB: Math.round(peak / MB), deltaMB: Math.round((peak - idle) / MB),
    // Where the rise is: usually the renderer (the page, ONNX Runtime's
    // WASM heap) and, on WebGPU, the GPU process.
    byTypeMB: Object.fromEntries(Object.entries(peakByType).map(([k, v]) => [k, Math.round((v - (idleByType[k] ?? 0)) / MB)])),
    gpuDeltaMB: idleGpu == null ? null : Math.round((peakGpu - idleGpu) / MB),
  };
}

const rows = [];
for (const device of devices) {
  for (const model of models) {
    // The first run of a model on a profile downloads it; that one is not
    // what is measured.
    const warm = join(profile, `.warm-${model}-${device}`);
    if (!existsSync(warm)) {
      const first = await measure(model, device);
      // Only a finished run has the whole model in the cache.
      if (/transcribed/.test(first.result ?? "")) writeFileSync(warm, "");
    }
    const r = await measure(model, device);
    console.log(JSON.stringify(r));
    rows.push(r);
  }
}
console.log("\nmodel      device  ran     peak-idle  gpu   adapter");
for (const r of rows) {
  console.log(`${r.model.padEnd(10)} ${r.device.padEnd(7)} ${String(r.ran).padEnd(7)} ${String(r.deltaMB).padStart(6)} MB  ${String(r.gpuDeltaMB ?? "-").padEnd(5)} ${r.adapter ?? ""}`);
}
