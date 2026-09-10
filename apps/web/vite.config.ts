import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plain Svelte 5 + Vite, matching apps/desktop. No SvelteKit: this is a
// single-page tool with no routing and no server, and the desktop app's
// stylesheet and tokens are reused verbatim.
export default defineConfig({
  plugins: [svelte()],
  // Absolute from the site root, not relative. The site is multi-page now
  // (APP-49), and a relative `./assets/...` resolves against the *directory*
  // of the current URL: correct at /, and wrong the moment a landing page is
  // requested with a trailing slash. The app is only ever served from the
  // root of opensubs.app, so there is nothing left for a relative base to
  // buy.
  base: "/",
  build: {
    target: "es2022",
    rollupOptions: {
      // Every page shares one bundle -- the tool on the landing page is the
      // same tool, not a copy of it.
      input: {
        index: resolve(__dirname, "index.html"),
        burn: resolve(__dirname, "burn-subtitles-into-video.html"),
      },
    },
    // The wasm is imported as a URL and fetched at runtime; never inline it
    // as a base64 data URI, which would inflate it by a third and block
    // streaming compilation.
    assetsInlineLimit: 4096,
  },
  server: { port: 5174, strictPort: false },
});
