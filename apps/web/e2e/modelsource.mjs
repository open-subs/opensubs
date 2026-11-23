// Where the speech model downloads from, checked without a browser.
//
// huggingface.co does not resolve from mainland China, and hf-mirror.com
// redirects the large weight files back to Hugging Face's own storage, which
// is blocked there too. ModelScope serves the same files from inside China.
// This covers the pure half of ./src/lib/modelsource.ts: which host a visitor
// gets first, that the other is always the fallback, that every host maps
// onto one cache key (so nothing is downloaded twice), and which errors are
// worth trying the other host for.
//
//   node --experimental-strip-types e2e/modelsource.mjs
const {
  MODEL_SOURCES,
  cacheKey,
  guessSource,
  inMainlandZone,
  isModelDownloadFailure,
  sourceOrder,
} = await import("../src/lib/modelsource.ts");

let pass = 0;
const fails = [];
const ok = (name, cond) => (cond ? pass++ : fails.push(name));

// Who gets ModelScope first.
for (const z of ["Asia/Shanghai", "Asia/Urumqi", "Asia/Chongqing", "Asia/Harbin", "Asia/Kashgar", "PRC"]) {
  ok(`${z} is mainland`, inMainlandZone(z) && guessSource(z) === "cn");
}
// Hong Kong, Macau and Taiwan reach Hugging Face, which is faster there.
for (const z of ["Asia/Hong_Kong", "Asia/Macau", "Asia/Taipei", "Asia/Singapore", "Europe/London", "America/Los_Angeles", "UTC"]) {
  ok(`${z} is not mainland`, !inMainlandZone(z) && guessSource(z) === "us");
}
ok("no zone falls back to Hugging Face", guessSource(null) === "us" && guessSource("") === "us");

// The order: chosen first, the other always second.
ok("auto in Shanghai: ModelScope, then Hugging Face", sourceOrder("auto", "Asia/Shanghai").join() === "cn,us");
ok("auto in Taipei: Hugging Face, then ModelScope", sourceOrder("auto", "Asia/Taipei").join() === "us,cn");
ok("cn chosen outside China still goes to ModelScope first", sourceOrder("cn", "Europe/London").join() === "cn,us");
ok("us chosen in Shanghai still goes to Hugging Face first", sourceOrder("us", "Asia/Shanghai").join() === "us,cn");

// The addresses transformers.js builds: host + template + file.
const url = (s, model, file) =>
  MODEL_SOURCES[s].host + MODEL_SOURCES[s].template.replace("{model}", model).replace("{revision}", "main") + file;
const hf = url("us", "onnx-community/whisper-base", "onnx/encoder_model.onnx");
const ms = url("cn", "onnx-community/whisper-base", "onnx/encoder_model.onnx");
ok("Hugging Face address", hf === "https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/encoder_model.onnx");
ok("ModelScope address names its branch, master", ms === "https://modelscope.cn/models/onnx-community/whisper-base/resolve/master/onnx/encoder_model.onnx");

// One cache entry per file, whichever host served it.
ok("ModelScope caches under the Hugging Face address", cacheKey(ms) === hf);
ok("Hugging Face's own address is unchanged", cacheKey(hf) === hf);
ok("a model taken through hf-mirror.com is still found",
  cacheKey("https://hf-mirror.com/onnx-community/whisper-base/resolve/main/onnx/encoder_model.onnx") === hf);
ok("a bundled model's local path is untouched", cacheKey("./models/onnx-community/whisper-base/config.json") === "./models/onnx-community/whisper-base/config.json");
ok("a dotted model name survives", cacheKey(url("cn", "onnx-community/whisper-tiny.en", "config.json")) === url("us", "onnx-community/whisper-tiny.en", "config.json"));

// Which failures are worth the other host.
const net = [
  new TypeError("Failed to fetch"),
  new DOMException("no response from the model host", "TimeoutError"),
  new Error("NetworkError when attempting to fetch resource."),
  new Error("Load failed"),
  new Error('Could not locate file: "https://modelscope.cn/models/x/resolve/master/config.json".'),
  new Error("Unexpected end of JSON input"),
  new Error("Error (502) occurred while trying to load file"),
  new Error("net::ERR_CONNECTION_RESET"),
];
for (const e of net) ok(`retried: ${e.message}`, isModelDownloadFailure(e));
const model = [
  new Error("TransposeDQWeightsForMatMulNBits Missing required scale"),
  new Error("no available backend found. ERR: [webgpu] Error: adapter not found"),
  new Error("Unsupported model type: whisper"),
];
for (const e of model) ok(`not retried: ${e.message}`, !isModelDownloadFailure(e));

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("FAIL", f);
process.exit(fails.length ? 1 : 0);
