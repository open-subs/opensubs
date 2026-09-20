// Does the transcription engine run on this OS at all?
//
// This is the harness the iOS floor is set from. It exists because the
// failure it looks for is not a slow path: on iOS 17 ONNX Runtime cannot
// build an execution plan for Whisper and throws before any inference,
// which no amount of waiting on a device turns into a result. The only way
// to know which iOS versions are affected is to run the real pipeline on
// each one.
//
// It imports `transcribeLocally` rather than reimplementing it: a harness
// that loads its own model with its own settings measures the harness.
//
// It reports by POSTing to the page's own origin instead of console.log,
// because the interesting runs are in a simulator's Safari, where there is
// no console to read -- and a result that has to be transcribed off a
// screenshot is a result nobody re-runs.
//
//   node e2e/enginecheck/serve.mjs      # builds, serves, prints the reports
import { transcribeLocally, asrSupport, ASR_MODELS } from "../../src/lib/asr";

const out = document.getElementById("out")!;
const log: string[] = [];
const say = (line: string) => {
  log.push(line);
  out.textContent = log.join("\n");
};

// Progress arrives many times a second and is nearly all repeats. Kept as
// one line per stage, because the question this harness answers is "which
// stage did it die in", and a thousand identical `model 0%` lines bury it.
let stage = "";
const progress = (line: string) => {
  if (line === stage) return;
  stage = line;
  say(line);
};

const report = (verdict: string, detail: Record<string, unknown>) =>
  fetch("/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      verdict,
      ua: navigator.userAgent,
      // Apple freezes the `CPU iPhone OS` token -- an iOS 26 simulator says
      // 18_6 -- so the only honest version in the string is `Version/`.
      safari: /Version\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? null,
      ...detail,
      log,
    }),
  }).catch(() => {});

async function main() {
  const support = await asrSupport();
  say(`support: ${JSON.stringify(support)}`);
  say(`crossOriginIsolated: ${self.crossOriginIsolated}`);
  say(`SharedArrayBuffer: ${typeof SharedArrayBuffer !== "undefined"}`);
  say(`WebGPU: ${"gpu" in navigator}`);

  const wav = await fetch("/testmedia/en.wav").then((r) => r.blob());
  const file = new File([wav], "en.wav", { type: "audio/wav" });
  say(`clip: ${file.size} bytes`);

  const started = performance.now();
  const result = await transcribeLocally({
    file,
    model: ASR_MODELS[0].id,
    start: 0,
    end: null,
    onProgress: (p) => progress(`  ${p.stage} ${Math.round((p.value ?? 0) * 100)}%`),
  });
  const seconds = (performance.now() - started) / 1000;
  const { transcript } = result;
  const text = transcript.segments.map((s) => s.text).join(" ").trim();
  const speed = transcript.duration / seconds;
  say(`transcribed ${transcript.duration.toFixed(1)}s of audio in ${seconds.toFixed(1)}s`);
  say(`${speed.toFixed(1)}x realtime, ${transcript.language}: ${text.slice(0, 200)}`);
  await report("ok", {
    seconds, realtime: speed, language: transcript.language,
    segments: transcript.segments.length, words: transcript.words.length, text, support,
  });
}

main().catch(async (e) => {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  say(`FAILED ${message}`);
  await report("failed", { error: message, stack: e instanceof Error ? e.stack : null });
});
