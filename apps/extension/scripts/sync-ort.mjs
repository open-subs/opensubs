// Copy ONNX Runtime's WebAssembly backend into public/ort/.
//
// The extension cannot fetch it from a CDN: the manifest's CSP does not
// list one, and widening the CSP to allow one would make the extension's
// own claim -- that the audio never leaves the machine -- depend on a
// third party nobody audited. So the backend ships inside the package.
//
// Exactly one of ONNX Runtime's four builds is copied, and which one is not
// a guess. transformers.js imports `onnxruntime-web/webgpu`, and that entry
// -- `ort.webgpu.bundle.min.mjs` -- names a single wasm file in both of its
// `locateFile` calls: `ort-wasm-simd-threaded.asyncify.wasm`. `jsep`,
// `jspi` and the plain build are never requested by it, on the GPU path or
// the CPU one, so copying them adds 50 MB to the package that no code path
// can reach.
//
// Check this again after a transformers.js or onnxruntime-web upgrade. The
// failure if it changes is loud but confusing: "no available backend found"
// on a 404 for a file the package does not carry.
import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const src = join(root, "node_modules", "onnxruntime-web", "dist");
const dest = join(root, "public", "ort");

if (!existsSync(src)) {
  console.error(`sync-ort: ${src} is missing -- run npm install first`);
  process.exit(1);
}

const wanted = [
  "ort-wasm-simd-threaded.asyncify.wasm",
  // The glue is already inlined in the bundle build, so this is belt and
  // braces: it costs 47 KB and covers a future non-bundle entry point.
  "ort-wasm-simd-threaded.asyncify.mjs",
];

mkdirSync(dest, { recursive: true });
let bytes = 0;
for (const name of wanted) {
  const from = join(src, name);
  if (!existsSync(from)) {
    console.error(`sync-ort: ${name} is not in this onnxruntime-web build`);
    process.exit(1);
  }
  cpSync(from, join(dest, name));
  bytes += statSync(from).size;
}
console.log(`sync-ort: ${wanted.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
