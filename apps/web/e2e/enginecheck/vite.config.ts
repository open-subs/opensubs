// A build of its own, so the harness cannot reach the site.
//
// Adding it as a fourth input to the app's vite config would put an
// enginecheck.html in dist/, where the locale generator would translate it
// into thirty-two languages and the sitemap would list it. It shares the
// app's source and nothing else.
import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "/",
  build: {
    target: "es2022",
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
  },
});
