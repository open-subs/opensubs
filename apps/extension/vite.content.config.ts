import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * The content script, built on its own as one classic script.
 *
 * It cannot share the main build. `scripting.executeScript({ files })`
 * injects a file as a *classic* script -- there is no module option -- and
 * the main build is `format: "es"` with shared chunks, so content.js came out
 * opening with `import{...}from"./chunks/protocol-....js"`. Chrome rejects
 * that line as a syntax error before any of the file runs. In 1.0.1 that was
 * the whole feature: Start answered "Listening", nothing was ever in the page
 * to listen, and no subtitle could arrive (APP-109).
 *
 * So this is an IIFE with everything it imports inlined. The cost is a second
 * copy of protocol.ts and seam.ts, a few kilobytes; the alternative -- a
 * classic loader that `import()`s a module -- would have to list the module
 * and every chunk it pulls in under `web_accessible_resources`, which hands
 * any web page a way to detect that this extension is installed.
 *
 * `emptyOutDir: false` because the main build has just written everything
 * else into the same directory; `--outDir` on the command line picks dist or
 * dist-firefox.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2022",
    rollupOptions: {
      input: { content: resolve(__dirname, "src/content/overlay.ts") },
      output: {
        format: "iife",
        entryFileNames: "[name].js",
        inlineDynamicImports: true,
      },
    },
  },
});
