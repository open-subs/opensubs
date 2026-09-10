import type { CapacitorConfig } from "@capacitor/cli";

/**
 * OpenSubs on a phone is the web app in a native shell.
 *
 * It is a wrapper on purpose. The whole product is the pipeline in
 * `apps/web/src/lib` -- audio decoding, Whisper, the hallucination
 * clean-up that took two rounds of field reports to get right -- and all
 * of it is JavaScript and WebAssembly that a WKWebView and an Android
 * WebView both run. A native rewrite would fork that logic three ways to
 * arrive at the same answers more slowly.
 *
 * Measured on the iOS 26.5 simulator before this project existed:
 * whisper-tiny.en loads in 2 seconds and transcribes at about 8x
 * realtime, on the CPU backend, with no GPU adapter available. That is
 * comfortably fast enough, and a real device has a GPU.
 */
const config: CapacitorConfig = {
  appId: "app.opensubs.mobile",
  appName: "OpenSubs",
  // Staged by scripts/stage.mjs rather than pointed straight at
  // ../web/dist: the mobile build drops the parts of the site that make no
  // sense in an app shell, and adds the engine check.
  webDir: "www",
  // The model is fetched from Hugging Face on first use and cached. Every
  // other byte is local.
  server: {
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  ios: {
    contentInset: "always",
    // The engine cannot start at all below this. Verified, not assumed:
    // on the iOS 17.0 simulator ONNX Runtime fails with "Can't create a
    // session ... Could not find OrtValue with name
    // '/layers.0/self_attn/Transpose_1_output_0'" -- not a slow path, no
    // path. See docs/mobile.md.
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    // Cleartext is off; everything is either app-local or HTTPS.
    allowMixedContent: false,
  },
};

export default config;
