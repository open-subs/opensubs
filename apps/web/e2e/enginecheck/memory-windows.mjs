// memory.mjs's measurement in Windows Chrome, on the machine's real GPU,
// driven from WSL over the DevTools protocol.
//
//   node e2e/enginecheck/serve.mjs 5187          # in WSL, one terminal
//   node e2e/enginecheck/memory-windows.mjs [--port 5187] [--models tiny.en,base,small]
//                                           [--devices webgpu,wasm] [--clip en40.wav]
//
// Needs WSL with mirrored networking (so Windows' localhost is this one) and
// Chrome installed in the default place. Headless Chromium in WSL only gets
// SwiftShader, a CPU stand-in for WebGPU that is neither fast nor
// representative, which is why the WebGPU figures come from here.
//
// Memory is the rise over an idle tab at the peak: the summed Private Bytes
// of the chrome.exe processes on this script's own profile (PowerShell,
// sampled about every 300 ms), plus the rise in GPU memory used (nvidia-smi;
// it includes anything else drawing on that GPU meanwhile). The first run of
// each model on the profile downloads it and is printed as "warm-up", not
// counted.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const port = flag("--port", "5187");
const clip = flag("--clip", "en40.wav");
const models = flag("--models", "tiny.en,base,small").split(",");
const devices = flag("--devices", "webgpu").split(",");
const CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
const TAG = "opensubs-enginecheck-memory";
const winTemp = execFileSync("cmd.exe", ["/c", "echo %TEMP%"], { cwd: "/mnt/c", encoding: "utf8" }).trim();
const WINPROFILE = `${winTemp}\\${TAG}`;
const WSLPROFILE = execFileSync("wslpath", ["-u", WINPROFILE], { encoding: "utf8" }).trim();
const MB = 1024 * 1024;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const PS = `
$ErrorActionPreference='SilentlyContinue'
while ($true) {
  $s = 0
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${TAG}*' } | ForEach-Object { $s += $_.PrivatePageCount }
  [Console]::Out.WriteLine($s); [Console]::Out.Flush()
  Start-Sleep -Milliseconds 300
}`;

function gpuUsed() {
  try {
    return Number(execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" }).split("\n")[0]) * MB;
  } catch { return null; }
}

async function measure(model, device) {
  const chrome = spawn(CHROME, [
    "--headless=new", `--user-data-dir=${WINPROFILE}`, "--remote-debugging-port=9333",
    "--no-first-run", "--no-default-browser-check", "--enable-unsafe-webgpu", "about:blank",
  ], { stdio: "ignore" });
  let browser;
  for (let i = 0; i < 60 && !browser; i += 1) {
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9333"); } catch { await settle(500); }
  }
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`http://localhost:${port}/no-such-page`).catch(() => {});
  const ps = spawn("powershell.exe", ["-NoProfile", "-Command", PS], { stdio: ["ignore", "pipe", "ignore"] });
  let last = 0, buf = "";
  const samples = [];
  ps.stdout.on("data", (d) => {
    buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop();
    for (const l of lines) if (/^\d+$/.test(l.trim())) { last = Number(l); samples.push(last); }
  });
  await settle(6000);
  const idle = Math.min(...samples.slice(-5));
  const idleGpu = gpuUsed();
  let peakGpu = idleGpu;
  const timer = setInterval(() => { const g = gpuUsed(); if (g != null) peakGpu = Math.max(peakGpu, g); }, 300);
  const from = samples.length;
  const query = new URLSearchParams({ model: `onnx-community/whisper-${model}`, clip });
  if (device === "wasm") query.set("device", "wasm");
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForFunction(() => /transcribed|FAILED/.test(document.getElementById("out")?.textContent ?? ""), null, { timeout: 60 * 60 * 1000, polling: 1000 });
  clearInterval(timer);
  const out = await page.textContent("#out");
  const peak = Math.max(...samples.slice(from));
  ps.kill();
  await browser.close().catch(() => {});
  chrome.kill();
  try { execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${TAG}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: "ignore" }); } catch {}
  await settle(3000);
  const support = JSON.parse(/support: (.*)/.exec(out)?.[1] ?? "{}");
  const result = out.split("\n").find((l) => /transcribed|FAILED/.test(l))?.trim();
  const ramMB = Math.round((peak - idle) / MB), gpuMB = idleGpu == null ? null : Math.round((peakGpu - idleGpu) / MB);
  return { model, device, ran: device === "wasm" ? "wasm" : support.device, adapter: support.gpu ?? null, result,
    idleMB: Math.round(idle / MB), ramDeltaMB: ramMB, gpuDeltaMB: gpuMB, totalMB: ramMB + (gpuMB ?? 0) };
}

mkdirSync(WSLPROFILE, { recursive: true });
for (const device of devices) for (const model of models) {
  const warm = `${WSLPROFILE}/.warm-${model}-${device}`;
  if (!existsSync(warm)) {
    const first = await measure(model, device);
    console.log("warm-up", JSON.stringify(first));
    if (/transcribed/.test(first.result ?? "")) writeFileSync(warm, "");
  }
  console.log(JSON.stringify(await measure(model, device)));
}
