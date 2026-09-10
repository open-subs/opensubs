// Giving a sentence to the translator in one piece.
//
// The engine cuts subtitles by reading speed, not by grammar, so one
// sentence routinely becomes three cues. A translator handed those cues
// one at a time is being asked to translate three fragments, and the
// results read like it: tense guessed and then guessed differently,
// pronouns invented, a subordinate clause turned into its own sentence,
// a verb stranded from the object it governs. Nothing in the fragment
// says which of those is right, because the information is in the cue
// before it.
//
// A large language model is given the whole batch at once and can look
// across it. The two translators that cannot are the ones that take a
// string and return a string: Chrome's built-in `Translator`, which
// handles one call at a time, and DeepL, which translates each entry of
// its array independently of the others. For those, the sentence is
// reassembled here, translated whole, and laid back out over the cues it
// came from.
//
// # Why the text is re-spread rather than re-timed
//
// Putting a sentence back is the awkward half. A translation is not the
// same length as its source and its words are not in the same order, so
// there is no honest mapping from a word in one to a moment in the
// other. What can be preserved exactly is the span: the group starts
// when its first cue starts and ends when its last one ends, so the
// sentence is on screen for precisely as long as it was spoken. Inside
// that span the text is divided in proportion to the source cues, at
// word boundaries.
//
// The cost is that a word may sit a beat early or late against the
// audio. The benefit is that it is the right word. Only groups of two or
// more cues are affected at all -- a cue that is already a whole
// sentence is passed through and comes back untouched.

export interface Timed {
  start: number;
  end: number;
}

/** A run of consecutive cues that make one sentence between them. */
export interface Group {
  /** First cue index. */
  from: number;
  /** One past the last cue index. */
  to: number;
}

/** Sentence-final punctuation, Latin and CJK. */
const ENDS_SENTENCE = /[.!?。！？…]["'”’)）\]】]*\s*$/;

/** A pause longer than this is a new thought whatever the punctuation says. */
const GROUP_GAP_S = 1.5;
/** No group is longer than this many cues... */
const MAX_GROUP_CUES = 4;
/** ...nor this many characters, so no provider's limit is approached. */
const MAX_GROUP_CHARS = 500;

/**
 * Gather consecutive cues into the sentences they belong to.
 *
 * A cue ends a group when it ends a sentence, when the next cue is far
 * enough away in time to be a different one, or when the group has grown
 * as large as it is allowed to. Every cue is in exactly one group and
 * groups are in order, so the mapping back is total.
 */
export function contextGroups(cues: Timed[], texts: string[]): Group[] {
  const groups: Group[] = [];
  let from = 0;
  let chars = 0;
  for (let i = 0; i < cues.length; i += 1) {
    chars += texts[i].length;
    const last = i === cues.length - 1;
    const closed =
      last ||
      ENDS_SENTENCE.test(texts[i]) ||
      cues[i + 1].start - cues[i].end > GROUP_GAP_S ||
      i - from + 1 >= MAX_GROUP_CUES ||
      chars >= MAX_GROUP_CHARS;
    if (closed) {
      groups.push({ from, to: i + 1 });
      from = i + 1;
      chars = 0;
    }
  }
  return groups;
}

/** Scripts that do not put spaces between words. */
const UNSPACED = /[\u3000-\u303f\u3040-\u9fff\uf900-\ufaff\uff00-\uffef\u0e00-\u0e7f]/;

/**
 * Join the pieces of a group into the sentence to be translated.
 *
 * A space between fragments of a spaced script; nothing between
 * fragments of one that has no spaces, because inserting a space into
 * Chinese is a word boundary the translator can see and the speaker
 * never made.
 */
export function joinGroup(parts: string[]): string {
  const kept = parts.filter((part) => part.length > 0);
  if (kept.length === 0) return "";
  return kept.reduce((joined, part) => {
    const between =
      UNSPACED.test(joined[joined.length - 1]) || UNSPACED.test(part[0]) ? "" : " ";
    return joined + between + part;
  });
}

/**
 * Divide one translated sentence back across the cues it came from.
 *
 * The split is proportional to the source cues' lengths and lands on a
 * word boundary, or on any character in a script that has none. Each cue
 * is left at least one word where there are enough to go round, and the
 * last takes everything remaining, so no text is lost to rounding.
 */
export function spread(translated: string, sources: string[]): string[] {
  if (sources.length <= 1) return [translated];
  const text = translated.trim();
  if (!text) return sources.map(() => "");

  const total = sources.reduce((sum, part) => sum + part.length, 0);
  if (total === 0) return sources.map((_, i) => (i === 0 ? text : ""));

  // Words if the translation has any, characters otherwise -- which is
  // the right unit for Chinese, Japanese and Thai, where every position
  // is a legal break.
  const words = text.split(/(?<=\s)/);
  const units = words.length > 1 ? words : [...text];
  const out: string[] = [];

  let at = 0;
  let consumed = 0;
  let source = 0;
  for (let i = 0; i < sources.length - 1; i += 1) {
    source += sources[i].length;
    const target = (text.length * source) / total;
    // Leave one unit for each cue still to come, so a short translation
    // spreads thin rather than leaving later cues blank.
    const limit = units.length - (sources.length - 1 - i);
    let piece = "";
    while (at < limit) {
      const next = consumed + units[at].length;
      if (piece && Math.abs(next - target) > Math.abs(consumed - target)) break;
      piece += units[at];
      consumed = next;
      at += 1;
    }
    out.push(piece.trim());
  }
  out.push(units.slice(at).join("").trim());
  return out;
}
