/**
 * Where Whisper actually runs.
 *
 * This is deliberately thin. Every decision about *how* to transcribe --
 * which precision on which backend, how to window a long clip, which lines
 * are hallucinated music and have to go -- lives in the web app's
 * `asr.ts`, and is imported from there rather than copied.
 *
 * That is the whole point of putting the extension in this repository. The
 * work behind the clean-up rules (a majority vote over annotation
 * vocabulary, a function-word guard, the crammed-repeat test) took two
 * rounds of field reports to get right; a fork of it would be wrong within
 * a month, and wrong in a way nobody would notice until a user complained
 * about the same outro captions all over again.
 *
 * # Why this exports a factory rather than registering a listener
 *
 * On Chromium the engine lives in an offscreen document, so the background
 * reaches it with `runtime.sendMessage`. On Firefox it lives in the
 * background page itself -- and `runtime.sendMessage` does **not** deliver
 * to listeners in the sending page, so a listener here would never fire.
 * Exporting a plain function lets each host wire it up the way that host
 * can: a direct call on Firefox, a message hop on Chromium.
 */

import { transcribeLocally, asrSupport } from "../../../web/src/lib/asr";
import { isSignOff } from "../../../web/src/lib/cleanup";
import { isChinese, toSimplified, wantsTraditional } from "../../../web/src/lib/script";
import type { Cue, FromEngine, Status, ToEngine } from "../lib/protocol";

export type Emit = (message: FromEngine) => void;

export interface Engine {
  handle(message: ToEngine): void;
}

/**
 * The recorded window, as something `transcribeLocally` will take.
 *
 * It wants a File because that is what the web app hands it, and because
 * mediabunny reads a container rather than raw samples. A Blob from
 * MediaRecorder is already a container -- WebM/Opus almost everywhere,
 * MP4/AAC on some builds -- so this is a relabel, not a transcode.
 */
function asFile(audio: ArrayBuffer, mime: string): File {
  const type = mime || "audio/webm";
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
  return new File([audio], `window.${ext}`, { type });
}

/**
 * Drop "Thank you." and friends from the edges of a window.
 *
 * The shared clean-up already removes a sign-off that sits over silence,
 * and that rule is the right one for a file: it compares the line's
 * loudness against the median of the whole recording, so a speaker really
 * closing a talk with "thank you" survives and the model's version does
 * not.
 *
 * Live capture breaks the comparison in a way a file never does. A window
 * is ten seconds long, playback begins mid-silence, and Whisper stamps a
 * hallucination across the *whole chunk* rather than over the quiet part
 * it came from -- so the line's measured level is the level of the speech
 * beside it, and it reads as loud. Observed on the first window of every
 * capture: "Thank you." ahead of the real first sentence.
 *
 * What a window has that a file does not is a known artificial edge. The
 * model runs out of audio there, and that is where it invents. So a
 * sign-off is dropped at the first or last position and kept everywhere
 * else -- an interior "thank you" had audio on both sides of it and is
 * somebody talking.
 *
 * The trade is explicit: a speaker whose "thank you" happens to land on a
 * window boundary loses that caption. One missing line beats a line that
 * was never said, in a caption track nobody can proofread as it goes.
 */
function trimBoundarySignOffs(cues: Cue[]): Cue[] {
  if (!cues.length) return cues;
  let from = 0;
  let to = cues.length;
  while (from < to && isSignOff(cues[from].text)) from += 1;
  while (to > from && isSignOff(cues[to - 1].text)) to -= 1;
  return cues.slice(from, to);
}

/**
 * One Chinese script for the whole session.
 *
 * Whisper has a single Chinese token and decides Traditional or Simplified
 * from the audio, inconsistently -- the same speaker, seconds apart, comes
 * back in either. Over a file that produces a subtitle track that changes
 * script halfway; over a live capture it is worse, because every window is
 * a fresh decision and the caption can flip mid-sentence.
 *
 * The web app normalises after transcription for exactly this reason, and
 * this does the same thing for the same reason, using the same table. Only
 * one direction is safe: Traditional to Simplified is one character to
 * one, while Simplified 干 is Traditional 干, 乾 or 幹 depending on the
 * sentence and no table can choose. So a caller who asked for Traditional
 * is left alone rather than answered wrongly.
 */
async function settleScript(cues: Cue[], heard: string, chosen: string): Promise<Cue[]> {
  if (!isChinese(heard) && !isChinese(chosen)) return cues;
  if (wantsTraditional(chosen)) return cues;
  return Promise.all(cues.map(async (c) => ({ ...c, text: await toSimplified(c.text) })));
}

export function createEngine(emit: Emit): Engine {
  let device: "webgpu" | "wasm" | undefined;
  /**
   * One window at a time, and the queue is one deep on purpose.
   *
   * If transcription falls behind capture, the right response is to drop
   * windows rather than build a backlog: a backlog gets further behind for
   * the rest of the film, and subtitles that arrive four minutes late are
   * worse than subtitles with a gap in them.
   */
  let running = false;
  let pending: Extract<ToEngine, { kind: "transcribe" }> | null = null;
  let dropped = 0;

  const say = (status: Status) => emit({ kind: "status", status });

  async function run(message: Extract<ToEngine, { kind: "transcribe" }>) {
    const { audio, mime, offset, settings } = message;
    try {
      device ??= (await asrSupport()).device;
      const result = await transcribeLocally({
        file: asFile(audio, mime),
        model: settings.model,
        start: 0,
        end: null,
        language: settings.language === "auto" ? undefined : settings.language,
        // One window of many. A window that is all music or all silence
        // must be allowed to come back with nothing in it.
        allowEmpty: true,
        onProgress: (p) =>
          say({
            stage: p.stage === "model" ? "model" : "transcribing",
            fraction: p.fraction,
            note: p.note,
            device,
          }),
      });
      // Back onto the page's timeline. `transcribeLocally` reports seconds
      // from the start of what it was given, and what it was given began
      // at `offset` in the video.
      const cues: Cue[] = await settleScript(
        trimBoundarySignOffs(
          result.transcript.segments
            .map((s) => ({ start: s.start + offset, end: s.end + offset, text: s.text.trim() }))
            .filter((c) => c.text),
        ),
        result.transcript.language ?? settings.language,
        settings.language,
      );
      emit({ kind: "segments", cues, offset });
    } catch (e) {
      emit({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const next = pending;
        pending = null;
        await run(next);
      }
    } finally {
      running = false;
    }
  }

  return {
    handle(message) {
      if (message.kind === "transcribe") {
        if (pending) {
          dropped += 1;
          say({
            stage: "transcribing",
            fraction: null,
            note: `Transcribing (${dropped} window${dropped === 1 ? "" : "s"} skipped to keep up)`,
            device,
          });
        }
        pending = message;
        void pump();
        return;
      }
      if (message.kind === "warm") {
        say({ stage: "model", fraction: null, note: "Loading the speech model", device });
      }
    },
  };
}
