// Fetch the speech model the iOS and Android apps carry inside them.
//
//   node scripts/fetch-models.mjs
//
// Whisper Base, multilingual, in both of the weights the recogniser loads:
// quantised for the GPU and full precision for the CPU (`asr.ts` explains
// why the CPU cannot take the quantised ones). Which one a phone uses is
// only known on the phone, so both ship -- about 350 MB. Cached in
// models-cache/ (gitignored); stage.mjs copies it into www/models/.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = "onnx-community/whisper-base";
const OUT = join(here, "..", "models-cache", REPO);
export const FILES = [
  "config.json", "generation_config.json", "preprocessor_config.json",
  "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
  "added_tokens.json", "vocab.json", "merges.txt", "normalizer.json",
  "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx",
  "onnx/encoder_model.onnx", "onnx/decoder_model_merged.onnx",
];

for (const file of FILES) {
  const to = join(OUT, file);
  if (existsSync(to) && statSync(to).size > 0) continue;
  mkdirSync(dirname(to), { recursive: true });
  const res = await fetch(`https://huggingface.co/${REPO}/resolve/main/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${to}.part`));
  renameSync(`${to}.part`, to);
  console.log(`fetched ${file} (${(statSync(to).size / 1048576).toFixed(1)} MB)`);
}
console.log(`models: ${OUT}`);
