/**
 * APP-33. What language does Whisper call each window, with nobody having
 * said what is being spoken?
 *
 * The report describes the Korean hallucination as intermittent. Before
 * anything can be fixed, it has to be seen: this reads the raw per-window
 * label -- the token Whisper predicts first, before any smoothing -- so a
 * wrong one shows up with its timestamp instead of being averaged away.
 */
import { pipeline, env } from "@huggingface/transformers";

declare global { interface Window { probeLanguages(url: string, model: string): Promise<unknown>; } }

const DETECT_WINDOW_S = 4;
const RATE = 16000;

window.probeLanguages = async (url, model) => {
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) wasm.wasmPaths = new URL("./ort/", document.baseURI).href;

  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const decoded = await ctx.decodeAudioData(buf);
  let mono = decoded.getChannelData(0);
  if (decoded.sampleRate !== RATE) {
    const oc = new OfflineAudioContext(1, Math.round(decoded.length * RATE / decoded.sampleRate), RATE);
    const src = oc.createBufferSource(); src.buffer = decoded; src.connect(oc.destination); src.start();
    mono = (await oc.startRendering()).getChannelData(0);
  }

  const pipe = await pipeline("automatic-speech-recognition", model, { device: "wasm", dtype: "fp32" });
  const p = pipe as unknown as {
    model: { generation_config: { lang_to_id?: Record<string, number>; decoder_start_token_id: number }; generate(o: Record<string, unknown>): Promise<unknown> };
    processor(a: Float32Array): Promise<{ input_features: unknown }>;
  };
  const langToId = p.model.generation_config.lang_to_id;
  if (!langToId) return { error: "this checkpoint has no language tokens" };
  const idToLang = new Map(Object.entries(langToId).map(([t, id]) => [id, t.replace(/[<|>]/g, "")]));

  const cell = DETECT_WINDOW_S * RATE;
  const cells = Math.ceil(mono.length / cell);
  const labels: { at: number; language: string }[] = [];
  for (let i = 0; i < cells; i += 1) {
    const win = mono.slice(i * cell, Math.min((i + 1) * cell, mono.length));
    const out = await p.model.generate({
      inputs: (await p.processor(win)).input_features,
      max_new_tokens: 1,
      decoder_input_ids: [p.model.generation_config.decoder_start_token_id],
    }) as { sequences?: { tolist(): unknown[] }[] };
    const ids = (out.sequences?.[0] ?? (out as never)[0])?.tolist?.() as (number | bigint)[] | undefined;
    const lang = ids?.length ? idToLang.get(Number(ids[ids.length - 1])) ?? "?" : "?";
    labels.push({ at: +(i * DETECT_WINDOW_S).toFixed(1), language: lang });
  }
  const tally: Record<string, number> = {};
  for (const l of labels) tally[l.language] = (tally[l.language] ?? 0) + 1;
  return { seconds: +(mono.length / RATE).toFixed(1), cells, tally, labels };
};
(document.getElementById("out") as HTMLElement).textContent = "ready";
