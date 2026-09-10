// Language-label smoothing, kept apart from asr.ts so it can be tested.
//
// asr.ts imports the wasm engine and mediabunny, so importing anything
// from it drags a browser-only graph into a plain `node` test. This rule
// is arithmetic over a list of strings and needs none of that.

/**
 * Erase a single cell that disagrees with the cells around it.
 *
 * A lone disagreement is noise -- a bar of music, a held silence, one
 * ambiguous sentence. This is a deliberately weak rule and it used to be
 * stronger, when the cells were ten seconds: back then it erased the
 * *only* cell that had caught an eight-second return to English, and the
 * narration was captioned in Chinese. Two cells now means eight seconds,
 * which is about as short as a real stretch of speech gets, so anything
 * that survives two cells is believed.
 *
 * # The edges, which this used to skip
 *
 * APP-33. The loop ran `1 .. length - 2`, so the first and last cells had
 * no rule at all -- and a mislabel is *more* likely there, because those
 * cells are the ones holding a title card, a fade-in, or the tail of a
 * sting after the speaking stops. Measured on the two clips to hand, with
 * nobody having named a language:
 *
 *     ja.mp4   38 cells, 35 ja -- and the first two read as English
 *     zh.mp4   44 cells, 43 zh -- and the last one read as Korean
 *
 * Both landed exactly where the rule could not reach. An edge cell is now
 * corrected too, on the same evidence the interior rule demands: the two
 * cells inward have to agree with each other, which is the same eight
 * seconds. One cell of a genuine language change at the very start or end
 * is lost to this; eight seconds of one is not, and a real change that
 * brief at a boundary has not been seen.
 *
 * Exported so it can be tested on a list of labels, which is the only
 * honest way to test a rule about an intermittent fault: the fault is in
 * the labels, and reaching it through a whole transcription depends on
 * the model producing the mislabel again.
 */
export function smoothLabels(labels: string[]): string[] {
  for (let i = 1; i < labels.length - 1; i += 1) {
    if (labels[i] !== labels[i - 1] && labels[i - 1] === labels[i + 1]) labels[i] = labels[i - 1];
  }
  if (labels.length >= 3) {
    if (labels[0] !== labels[1] && labels[1] === labels[2]) labels[0] = labels[1];
    const n = labels.length;
    if (labels[n - 1] !== labels[n - 2] && labels[n - 2] === labels[n - 3]) {
      labels[n - 1] = labels[n - 2];
    }
  }
  return labels;
}
