import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Standard Tauri + Vite dev-server setup: a fixed port Tauri's shell waits
// on, HMR over a separate port so it survives the webview's own reloads,
// and `TAURI_DEV_HOST` support for testing on a physical mobile device.
// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [svelte()],
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
