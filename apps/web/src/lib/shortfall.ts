/**
 * A batch whose reply does not line up with what was sent.
 *
 * Its own module, like ./refill, so it can be tested without the engine:
 * translate.ts pulls in the wasm bindings, and the thing worth testing here
 * is what happens when a model miscounts, which needs no wasm and no key.
 */

/** Translate these strings, in order, one for one. */
export type Batch = (texts: string[]) => Promise<string[]>;

/**
 * One chunk, aligned to the lines that were sent -- retried, then split.
 *
 * A model asked for nineteen lines sometimes answers with eighteen, and it
 * is not reproducible: the same file, model and settings succeeded twice and
 * failed once (APP-141). Throwing away the whole batch cost the user the
 * call they had paid for and left every subtitle untranslated, with only
 * "The model returned 18 lines for 19 subtitles." to go on.
 *
 * So: ask again once, since the next answer usually counts correctly. If it
 * miscounts again, halve the chunk and ask for each half, down to single
 * lines -- which translates everything except the line the model keeps
 * dropping, and costs a few small calls rather than the whole file. A line
 * that cannot be had comes back in its original language and is counted, so
 * the page can say how many were left.
 */
export async function translateChunk(
  batch: Batch,
  chunk: string[],
  signal: AbortSignal | undefined,
  retry = true,
): Promise<{ lines: string[]; missed: number }> {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  let back: string[] | null = null;
  try {
    back = await batch(chunk);
  } catch (e) {
    // A miscount is the batcher's own error for some providers; anything
    // else (auth, network, cancellation) belongs to the caller.
    if (!isMiscount(e) || !retry) throw e;
  }
  if (back && back.length === chunk.length) return { lines: back, missed: 0 };

  if (retry) return translateChunk(batch, chunk, signal, false);
  if (chunk.length === 1) return { lines: [chunk[0]], missed: 1 };

  const half = Math.ceil(chunk.length / 2);
  const first = await translateChunk(batch, chunk.slice(0, half), signal);
  const second = await translateChunk(batch, chunk.slice(half), signal);
  return { lines: [...first.lines, ...second.lines], missed: first.missed + second.missed };
}

/** A reply with the wrong number of lines in it, however the provider says so. */
export function isMiscount(e: unknown): boolean {
  return e instanceof Error && /returned \d+ lines for \d+/.test(e.message);
}
