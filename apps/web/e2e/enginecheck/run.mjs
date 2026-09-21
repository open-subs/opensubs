// Drive the engine check in Chromium and print what it reported.
//
//   node e2e/enginecheck/run.mjs [--model onnx-community/whisper-base] [--language auto]
//                                [--clip en.wav] [--profile DIR] [--port 5180]
//
// serve.mjs must already be running on --port. The profile is reused so the
// model downloads once: Hugging Face is not always quick, and a download is
// not what APP-112 measures.
import { chromium } from "playwright";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const port = flag("--port", "5180");
const query = new URLSearchParams({ model: flag("--model", "onnx-community/whisper-base"), clip: flag("--clip", "en.wav") });
const language = flag("--language", "auto");
if (language !== "auto") query.set("language", language);

const context = await chromium.launchPersistentContext(resolve(flag("--profile", "/tmp/enginecheck-profile")), {
  channel: "chromium",
  headless: true,
  args: ["--enable-unsafe-webgpu"],
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 200)));
await page.goto(`http://localhost:${port}/?${query}`);
// The page POSTs its report and also leaves it on screen; wait for either.
await page.waitForFunction(() => /transcribed|FAILED/.test(document.getElementById("out")?.textContent ?? ""),
  null, { timeout: 30 * 60 * 1000, polling: 2000 });
const out = await page.textContent("#out");
console.log(out.split("\n").filter((l) => !/^\s+(audio|model) /.test(l)).slice(-40).join("\n"));
await context.close();
