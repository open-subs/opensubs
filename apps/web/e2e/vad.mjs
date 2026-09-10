// Does the voice detector agree with reality on real clips?
//
// APP-54. The rule this replaces looked decisive on one file and was
// wrong on two others, so this suite is built the other way round: most
// of it is clips that must NOT be flagged.
//
//   node e2e/vad.mjs               (uses whatever fixtures are present)
import * as ort from "onnxruntime-node";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const MODEL = "public/vad/silero_vad.onnx";
if (!existsSync(MODEL)) {
  console.error(`cannot run: ${MODEL} is missing`);
  process.exit(1);
}

// The same contract src/lib/vad.ts uses, and the same reason: 512 new
// samples preceded by the previous frame's last 64. A bare 512 returns
// 0.001 for everything, speech included.
const CONTEXT = 64, HOP = 512, WINDOW = CONTEXT + HOP, RATE = 16000, SPEECH_P = 0.5;
const session = await ort.InferenceSession.create(MODEL);

function decode(path) {
  const wav = join(tmpdir(), `vad-${basename(path)}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path, "-ac", "1", "-ar", String(RATE), wav]);
  const b = readFileSync(wav);
  let off = 12, dataOff = 0, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "data") { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size & 1);
  }
  const n = Math.floor(dataLen / 2), a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = b.readInt16LE(dataOff + i * 2) / 32768;
  return a;
}

async function speechSeconds(samples) {
  let state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(RATE)]), []);
  const frame = new Float32Array(WINDOW);
  let voiced = 0;
  for (let i = 0; i + HOP <= samples.length; i += HOP) {
    frame.set(samples.subarray(i, i + HOP), CONTEXT);
    const out = await session.run({ input: new ort.Tensor("float32", frame.slice(), [1, WINDOW]), state, sr });
    state = out.stateN;
    if (out.output.data[0] >= SPEECH_P) voiced += 1;
    frame.copyWithin(0, WINDOW - CONTEXT);
  }
  return voiced * (HOP / RATE);
}

// `speech` is what the clip must be judged as. The interesting entries
// are the ones expecting true: the previous attempt at this rule passed
// the no-speech clip and condemned both of these.
const CLIPS = [
  { path: process.env.VAD_NOSPEECH ?? "/tmp/claude-501/nospeech.mp4", speech: false,
    why: "a cooking video: music and a wok, nobody talking (the reported clip)" },
  { path: process.env.VAD_LOOPED ?? "/tmp/claude-501/adv-looped.mp4", speech: true,
    why: "ten seconds of real narration looped twelve times -- repetitive, and speech" },
  { path: `${process.env.HOME}/Downloads/en.mp4`, speech: true, why: "English narration" },
  { path: `${process.env.HOME}/Downloads/zh.mp4`, speech: true, why: "Chinese narration" },
  { path: `${process.env.HOME}/Downloads/ja.mp4`, speech: true, why: "Japanese narration" },
];

const ENOUGH = 1.5;
let pass = 0, skipped = 0;
const fails = [];
for (const clip of CLIPS) {
  if (!existsSync(clip.path)) { skipped += 1; console.log(`  --   ${basename(clip.path)} not present, skipped`); continue; }
  const seconds = await speechSeconds(decode(clip.path));
  const heard = seconds >= ENOUGH;
  const ok = heard === clip.speech;
  if (ok) pass += 1;
  else fails.push(`${basename(clip.path)}: ${seconds.toFixed(1)}s of speech, expected ${clip.speech ? "speech" : "none"} -- ${clip.why}`);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${basename(clip.path).padEnd(18)} ${seconds.toFixed(1).padStart(6)}s  ${clip.why}`);
}

console.log(`\n${pass} passed, ${fails.length} failed, ${skipped} skipped`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
