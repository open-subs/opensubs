import { speechSeconds } from "../../src/lib/vad";
declare global { interface Window { timeVad(url: string): Promise<unknown>; } }
window.timeVad = async (url) => {
  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const decoded = await ctx.decodeAudioData(buf);
  let mono = decoded.getChannelData(0);
  if (decoded.sampleRate !== 16000) {
    const oc = new OfflineAudioContext(1, Math.round(decoded.length * 16000 / decoded.sampleRate), 16000);
    const src = oc.createBufferSource(); src.buffer = decoded; src.connect(oc.destination); src.start();
    mono = (await oc.startRendering()).getChannelData(0);
  }
  const t0 = performance.now();
  const r = await speechSeconds(mono);
  return { ...r, audioSeconds: +(mono.length / 16000).toFixed(1), wallSeconds: +((performance.now() - t0) / 1000).toFixed(1) };
};
(document.getElementById("out") as HTMLElement).textContent = "ready";
