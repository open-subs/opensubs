/**
 * The Chromium host for the engine.
 *
 * Loaded by engine.html, which the service worker creates as an offscreen
 * document because a worker has no DOM, no Web Audio and no WebGPU. All
 * this file does is bridge messages to the engine and its replies back.
 */

import { api, type ToEngine } from "../lib/protocol";
import { createEngine } from "./engine";

const engine = createEngine((message) => {
  void api.runtime.sendMessage(message).catch(() => undefined);
});

api.runtime.onMessage.addListener((message: ToEngine, _sender, respond) => {
  if (message.kind === "transcribe" || message.kind === "warm") {
    engine.handle(message);
    respond({ ok: true });
    return true;
  }
  return false;
});
