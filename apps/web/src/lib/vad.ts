/**
 * Is anyone actually speaking?
 *
 * APP-54. Whisper always writes something. Hand it 118 seconds of a wok
 * and a music bed and it returns a confident page of English:
 *
 *     I'm going to be a little bit more careful. I'm
 *     going to be able to do it.
 *     I'm going to be doing it.
 *
 * Every rule in `cleanup.ts` passes that, and correctly — each line is
 * grammatical English with function words in it. The fault is not in any
 * line, so no rule that reads a line can find it.
 *
 * # Why a model and not a measurement
 *
 * The cheap answers were tried and measured first, and both fail:
 *
 * - **Loudness.** The clip is not quiet. It has music and cooking in it.
 * - **The syllabic band of the amplitude envelope** (3–9 Hz, where speech
 *   lives). Measured across four clips: the silent one scores 31.9%,
 *   between English at 29.6% and Chinese at 48.3%, and *above* Japanese
 *   at 19.9%. It would delete the Japanese subtitles and keep these.
 * - **Repetition in the transcript.** The no-speech clip repeats 80% of
 *   its four-word sequences against 0% for real narration, which looks
 *   decisive until it is tried on real speech that repeats: the same ten
 *   seconds of narration looped twelve times, and a song with a chorus,
 *   were both wrongly condemned by it.
 *
 * Silero VAD separates all six clips correctly, which is what earns it
 * its 2.3 MB:
 *
 *     no-speech cooking   0.0s of 118s     looped narration  45.8s of 131s
 *     English narration  66.7s of 116s     Chinese           115.5s of 120s
 *     Japanese           62.4s of 120s
 *
 * # The one thing it does not do
 *
 * Singing is not speech to it: a song with vocals scores 0.2 seconds.
 * That is the model's definition, not a bug, and it is why the caller
 * offers to transcribe anyway rather than refusing. A refusal would be
 * wrong about every music video.
 */

/** Where the model is served from, relative to the page. */
const MODEL_URL = "./vad/silero_vad.onnx";

/**
 * The frame contract, which is not the one the documentation implies.
 *
 * Silero v5 takes 512 new samples at 16 kHz — but this export wants them
 * *preceded by the previous frame's last 64*, as one 576-sample input.
 * Feeding a bare 512 runs without error and returns 0.001 for everything,
 * speech included, which is the worst kind of wrong: a confident "nobody
 * spoke" over a recording of somebody speaking. Found by sweeping the
 * window size against a clip known to be narration.
 */
const CONTEXT = 64;
const HOP = 512;
const WINDOW = CONTEXT + HOP;
const RATE = 16000;

/** Above this, the frame holds a voice. Silero's own default. */
const SPEECH_P = 0.5;

/**
 * Below this much speech in the whole clip, treat it as having nobody
 * speaking in it.
 *
 * Not zero. A cough, a doorbell or one word of an advert can register a
 * frame or two, and refusing to caption a two-minute interview because
 * the detector found 0.4 seconds somewhere in it would be a worse fault
 * than the one this fixes. The measured gap is 0.0 seconds against 45.8,
 * so where exactly this sits between them does not matter much.
 */
const ENOUGH_SPEECH_S = 1.5;

type Session = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>;
};

let session: Promise<{ session: Session; Tensor: new (t: string, d: unknown, s?: number[]) => unknown }> | null = null;

/**
 * Load the model once, through the ONNX Runtime transformers.js already
 * pulled in.
 *
 * `onnxruntime-web/webgpu` deliberately, and not plain `onnxruntime-web`:
 * it is the entry point transformers.js imports, so the two share one
 * WebAssembly binary. Importing the other entry adds a second 23 MB
 * download for the same runtime.
 */
async function load() {
  session ??= (async () => {
    const ort = await import("onnxruntime-web/webgpu");
    // Same reason as asr.ts: the runtime's WebAssembly is served from our
    // own origin, not from a CDN the CSP does not list and the privacy
    // page does not mention.
    const wasm = (ort.env as { wasm?: { wasmPaths?: string } }).wasm;
    if (wasm) wasm.wasmPaths = new URL("./ort/", document.baseURI).href;
    const created = await ort.InferenceSession.create(
      new URL(MODEL_URL, document.baseURI).href,
      // The CPU backend on purpose. The model is tiny, it runs at
      // hundreds of times realtime there, and asking for the GPU would
      // compete with Whisper for the same device.
      { executionProviders: ["wasm"] },
    );
    return { session: created as unknown as Session, Tensor: ort.Tensor as never };
  })();
  return session;
}

export interface SpeechReport {
  /** Seconds of the clip that hold a voice, up to the point of decision. */
  seconds: number;
  /** Seconds examined, which is less than the clip when it stopped early. */
  total: number;
  /** Whether it heard enough to stop looking. */
  enough: boolean;
}

/**
 * How many seconds of `samples` hold a voice.
 *
 * `samples` must be mono at 16 kHz, which is what `extractAudio` already
 * produces for Whisper — so this costs one extra pass over audio that has
 * already been decoded, and no extra decode.
 */
export async function speechSeconds(
  samples: Float32Array,
  onProgress?: (fraction: number) => void,
): Promise<SpeechReport> {
  const { session: s, Tensor } = await load();

  let state = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new Tensor("int64", BigInt64Array.from([BigInt(RATE)]), []);
  const frame = new Float32Array(WINDOW);
  const perFrame = HOP / RATE;

  let voiced = 0;
  let frames = 0;
  for (let i = 0; i + HOP <= samples.length; i += HOP) {
    frame.set(samples.subarray(i, i + HOP), CONTEXT);
    const out = await s.run({
      input: new Tensor("float32", frame.slice(), [1, WINDOW]),
      state,
      sr,
    });
    state = out.stateN as never;
    if (Number(out.output.data[0]) >= SPEECH_P) voiced += 1;
    frames += 1;
    // This frame's tail is the next frame's context.
    frame.copyWithin(0, WINDOW - CONTEXT);

    // The question is "did anyone speak", not "how much", so there is
    // nothing left to learn once the answer is yes. A two-minute clip is
    // about 3,700 inferences; real narration answers within the first
    // few seconds of it, and only a clip with nobody in it is scanned
    // all the way through -- which is the one case where the whole
    // answer depends on having looked everywhere.
    if (voiced * perFrame >= ENOUGH_SPEECH_S) {
      return { seconds: voiced * perFrame, total: frames * perFrame, enough: true };
    }
    if ((frames & 63) === 0) onProgress?.(i / samples.length);
  }

  return { seconds: voiced * perFrame, total: frames * perFrame, enough: false };
}

export function hasSpeech(report: SpeechReport): boolean {
  return report.seconds >= ENOUGH_SPEECH_S;
}
