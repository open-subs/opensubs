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

// ?model= and ?language= pick what is measured; the defaults are the iOS
// floor check's (the smallest model, English). ?clip= picks the file under
// public/testmedia. APP-112 measures on Base with the language on auto,
// because that is the web app's default and the case the report timed.
const params = new URLSearchParams(location.search);
const MODEL = params.get("model") ?? ASR_MODELS[0].id;
const LANGUAGE = params.get("language") ?? undefined;
const CLIP = params.get("clip") ?? "en.wav";
// Where the pass begins. Whisper reads in 30-second windows from the start, so
// moving the start by half a second reshuffles every window -- and which span,
// if any, the first pass drops moves with it. That is the only honest way to
// put the missed-line pass to work on a machine whose first pass drops
// nothing: the same input a user produces by trimming the start.
const START = Number(params.get("start") ?? "0");

/**
 * When the bar last said it was finished, and every stage after it.
 *
 * APP-112 is the time between "Listening to the audio · 100%" and the
 * subtitles appearing -- up to four minutes on a two-minute clip, with the
 * screen saying nothing. This records that interval directly rather than
 * inferring it from the total.
 */
const timeline: { t: number; stage: string; note: string; fraction: number | null }[] = [];

async function main() {
  const support = await asrSupport();
  say(`support: ${JSON.stringify(support)}`);
  say(`crossOriginIsolated: ${self.crossOriginIsolated}`);
  say(`SharedArrayBuffer: ${typeof SharedArrayBuffer !== "undefined"}`);
  say(`WebGPU: ${"gpu" in navigator}`);

  const wav = await fetch(`/testmedia/${CLIP}`).then((r) => r.blob());
  const file = new File([wav], CLIP, { type: wav.type || "audio/wav" });
  say(`clip: ${file.size} bytes`);

  const started = performance.now();
  const result = await transcribeLocally({
    file,
    model: MODEL,
    start: START,
    end: null,
    language: LANGUAGE,
    onProgress: (p) => {
      timeline.push({ t: performance.now(), stage: p.stage, note: p.note, fraction: p.fraction ?? null });
      progress(`  ${p.stage} ${p.note}${p.fraction == null ? "" : " " + Math.round(p.fraction * 100) + "%"}`);
    },
  });
  const seconds = (performance.now() - started) / 1000;
  const { transcript } = result;
  const text = transcript.segments.map((s) => s.text).join(" ").trim();
  const speed = transcript.duration / seconds;
  say(`transcribed ${transcript.duration.toFixed(1)}s of audio in ${seconds.toFixed(1)}s`);
  say(`${speed.toFixed(1)}x realtime, ${transcript.language}: ${text.slice(0, 200)}`);
  // The last moment the bar showed a finished transcription, and how long
  // the page then went on working with nothing new to show for it.
  const done = performance.now();
  const full = [...timeline].reverse().find((e) => e.stage === "transcribing" && (e.fraction ?? 0) >= 0.999);
  const after = full ? timeline.filter((e) => e.t > full.t) : [];
  const silentTail = full ? (done - (after.length ? after[after.length - 1].t : full.t)) / 1000 : null;
  const tail = full ? (done - full.t) / 1000 : null;
  say(`model ${MODEL}, language ${LANGUAGE ?? "auto"}`);
  say(`after the bar reached 100%: ${tail?.toFixed(1)}s, of which ${silentTail?.toFixed(1)}s with no new status`);
  for (const e of after) say(`    +${((e.t - full!.t) / 1000).toFixed(1)}s  ${e.stage} ${e.note}${e.fraction == null ? "" : " " + Math.round(e.fraction * 100) + "%"}`);
  await report("ok", {
    model: MODEL, requested: LANGUAGE ?? "auto", tail, silentTail,
    stagesAfterFull: after.map((e) => ({ at: (e.t - full!.t) / 1000, note: e.note, fraction: e.fraction })),
    seconds, realtime: speed, language: transcript.language,
    segments: transcript.segments.length, words: transcript.words.length, text, support,
  });
}

main().catch(async (e) => {
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  say(`FAILED ${message}`);
  await report("failed", { error: message, stack: e instanceof Error ? e.stack : null });
});
