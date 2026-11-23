import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

// Standard Tauri + Vite dev-server setup: a fixed port Tauri's shell waits
// on, HMR over a separate port so it survives the webview's own reloads,
// and `TAURI_DEV_HOST` support for testing on a physical mobile device.
// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

/**
 * The Mac App Store build (scripts/build-appstore.sh sets OPENSUBS_STORE=1):
 * three modules of src/lib are replaced by their src/store counterparts for
 * every importer outside src/store. Those sell credits through StoreKit
 * rather than the card checkout, sign in with Apple's own sheet, and save
 * exports to a folder the person picks, as the sandbox requires. Without
 * the variable this plugin is not added, and the build is the one it was.
 */
function macAppStore(): Plugin {
  const src = fileURLToPath(new URL("./src/", import.meta.url));
  const swaps: Record<string, string> = {
    [`${src}lib/account.ts`]: `${src}store/account.ts`,
    [`${src}lib/api.ts`]: `${src}store/api.ts`,
    [`${src}lib/AccountPanel.svelte`]: `${src}store/AccountPanel.svelte`,
  };
  return {
    name: "opensubs-mac-app-store",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(`${src}store/`)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && swaps[resolved.id] ? swaps[resolved.id] : null;
    },
  };
}
const store = process.env.OPENSUBS_STORE === "1";

export default defineConfig(async () => ({
  plugins: store ? [macAppStore(), svelte()] : [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
