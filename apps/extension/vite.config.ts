import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

/**
 * Stop Vite emitting a second copy of the 23 MB ONNX Runtime binary.
 *
 * `ort.webgpu.bundle.min.mjs` locates its WebAssembly with
 * `new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href`.
 * Vite recognises that pattern, copies the file into the bundle and
 * rewrites the URL -- reasonable behaviour, and wrong here twice over: the
 * package already carries the file under `ort/` (scripts/sync-ort.mjs puts
 * it there), and `asr.ts` sets `env.backends.onnx.wasm.wasmPaths` before
 * any session is created, so the rewritten URL is never read.
 *
 * The replacement is a working path rather than a stub, so the fallback
 * still resolves if that override is ever removed: every extension page
 * that loads the engine sits at the package root, and `ort/` is beside it.
 */
function singleOrtCopy(): Plugin {
  const pattern = /new URL\(\s*(["'])(ort-wasm[^"']*\.wasm)\1\s*,\s*import\.meta\.url\s*\)\.href/g;
  return {
    name: "opensubs:single-ort-copy",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("onnxruntime-web") || !pattern.test(code)) return null;
      pattern.lastIndex = 0;
      return { code: code.replace(pattern, (_m, _q, file) => JSON.stringify(`ort/${file}`)), map: null };
    },
  };
}

/**
 * Five entry points, each of which has to land at a predictable path
 * because a manifest names it by file name. Vite's default hashed asset
 * names are exactly wrong here.
 *
 * `format: "es"` matters for the background: the Chromium manifest declares
 * `"type": "module"`, and an IIFE bundle in that slot fails to register
 * its listeners with no error anywhere a user would look.
 */
export default defineConfig({
  // copy-static.mjs owns everything that is not JavaScript, because it has
  // to pick *which* manifest goes in and rewrite the HTML's script paths.
  // Leaving vite's default publicDir on as well drops a second, wrong
  // manifest into the package -- manifest.firefox.json inside the Chrome
  // build -- which is the kind of stray file a store review asks about.
  plugins: [singleOrtCopy()],
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content/overlay.ts"),
        offscreen: resolve(__dirname, "src/engine/offscreen.ts"),
        popup: resolve(__dirname, "src/popup/popup.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    // The engine chunk is large because Whisper's runtime is large. Saying
    // so on every build trains people to ignore the warning.
    chunkSizeWarningLimit: 4096,
  },
  worker: { format: "es" },
});
