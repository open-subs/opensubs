import { extractAudio } from "../../src/lib/asr";
declare global {
  interface Window {
    extract(url: string, start: number, end: number | null): Promise<unknown>;
  }
}
window.extract = async (url, start, end) => {
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], url.split("/").pop() ?? "clip", { type: blob.type });
  try {
    const audio = await extractAudio(file, start, end);
    let sum = 0;
    for (const s of audio) sum += s * s;
    // Where the loudest sample is, in seconds from `start`: a click at a
    // known time says whether the audio came back where it belongs.
    let peak = 0;
    for (let i = 1; i < audio.length; i += 1) if (Math.abs(audio[i]) > Math.abs(audio[peak])) peak = i;
    return {
      ok: true,
      seconds: audio.length / 16000,
      rms: Math.sqrt(sum / Math.max(1, audio.length)),
      peak: peak / 16000,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};
(document.body as HTMLElement).dataset.audioDecoder = typeof (globalThis as { AudioDecoder?: unknown }).AudioDecoder;
(document.getElementById("out") as HTMLElement).textContent = "ready";
