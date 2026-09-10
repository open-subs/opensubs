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

/** Punctuation a subtitle can end on without looking cut off. */
const BREAKS_WELL = /[，。、；：！？,.;:!?…]/;

/** ...and the subset that ends a whole sentence, which is better still. */
const ENDS_A_SENTENCE = /[。！？.!?…]/;

/** How far from the proportional split point to look for one, as a
 * fraction of the piece just taken. */
const PUNCTUATION_REACH = 0.25;

/**
 * ...and never less than this many units.
 *
 * The measured misses were three and four characters away from the split
 * on pieces short enough that a quarter of them was two. Four is the
 * distance the reported cases actually needed.
 */
const MIN_REACH = 4;

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
 * The pieces a translation may be broken into.
 *
 * APP-53. This used to be "words if the translation has any, characters
 * otherwise", which reads sensibly and is wrong for exactly the case it
 * was written for. A Chinese translation of two sentences comes back as
 *
 *     地震是世界上最常见的自然灾害之一。 转眼之间，大地开始震动…
 *
 * -- one space, between the sentences, because the translator put it
 * there. That single space means "the translation has words", so forty
 * available break points collapse to two, and two pieces cannot fill
 * three cues.
 *
 * The unit is a property of the *script*, not of whether a space happens
 * to appear. Chinese, Japanese and Thai may be broken at any character;
 * everything else breaks at whitespace.
 */
function unitsOf(text: string): string[] {
  // Judged on the text as a whole rather than its first character: a
  // Chinese line often opens with a Latin acronym or a numeral.
  const unspaced = [...text].filter((c) => UNSPACED.test(c)).length;
  const letters = [...text].filter((c) => /\S/.test(c)).length;
  if (letters > 0 && unspaced / letters >= 0.5) {
    // Drop whitespace the translator inserted between two characters of a
    // script that does not use it -- typically one space between
    // sentences. Chinese does not put a space there, so it is the
    // translator's punctuation habit rather than the text's, and left in
    // it becomes a unit of its own that pushes the sentence-final 。 out
    // of reach of the break-point search below.
    //
    // A space with a Latin word on either side is kept: "iPhone 15" and
    // an embedded acronym are real.
    const chars = [...text];
    return chars.filter((c, i) => {
      if (/\S/.test(c)) return true;
      const before = chars[i - 1];
      const after = chars[i + 1];
      return !(before && after && UNSPACED.test(before) && UNSPACED.test(after));
    });
  }
  const words = text.split(/(?<=\s)/);
  return words.length > 1 ? words : [...text];
}

/**
 * Divide one translated sentence back across the cues it came from.
 *
 * The split is proportional to the source cues' lengths and lands on a
 * word boundary, or on any character in a script that has none. Each cue
 * takes at least one unit while any remain, and the last takes everything
 * left over, so no text is lost to rounding.
 */
export function spread(translated: string, sources: string[]): string[] {
  if (sources.length <= 1) return [translated];
  const text = translated.trim();
  if (!text) return sources.map(() => "");

  const total = sources.reduce((sum, part) => sum + part.length, 0);
  if (total === 0) return sources.map((_, i) => (i === 0 ? text : ""));

  const units = unitsOf(text);
  // Not `text.length`: unitsOf may have dropped translator-inserted
  // whitespace, and the proportions have to be measured against what is
  // actually being divided up or the last cue silently absorbs the
  // difference.
  const length = units.reduce((sum, u) => sum + u.length, 0);
  const out: string[] = [];

  let at = 0;
  let consumed = 0;
  let source = 0;
  for (let i = 0; i < sources.length - 1; i += 1) {
    source += sources[i].length;
    const target = (length * source) / total;
    // Leave one unit for each cue still to come, so a short translation
    // spreads thin rather than leaving later cues blank...
    const reserved = units.length - (sources.length - 1 - i);
    // ...but never at the cost of this one. The reservation above can go
    // to zero -- or negative -- when there are fewer units than cues, and
    // then the loop below runs zero times and *this* cue is the one left
    // blank. That is APP-53's visible half: the first cue of a group kept
    // its untranslated source while the whole translation landed on the
    // second. A cue that gets nothing has to be a later one, never an
    // earlier one, because the reader meets it first.
    const limit = Math.max(reserved, at + 1);
    const started = at;
    let piece = "";
    while (at < Math.min(limit, units.length)) {
      const next = consumed + units[at].length;
      if (piece && Math.abs(next - target) > Math.abs(consumed - target)) break;
      piece += units[at];
      consumed = next;
      at += 1;
    }
    // Prefer a punctuation boundary if one is close, in either direction.
    //
    // Character-unit splitting is free to break anywhere, and left alone
    // it breaks 转眼之间 into 转眼之 / 间 -- legal, and unreadable. A comma
    // or full stop within a short reach of the proportional split point
    // is a much better place to end a subtitle, and moving to it costs at
    // most a few characters of drift against the audio.
    //
    // APP-53, second round. This searched *backwards* only, and every
    // case that got through had its punctuation a few characters ahead:
    //
    //     …大脑并没 | 有改变，…      the comma is three characters on
    //     …感受特 | 定情绪时，…      four characters on
    //     …选择不同的情绪 | 。我们…   the full stop opened the next cue
    //
    // That last one is the clearest: a subtitle should end on its full
    // stop, never begin with one. Reaching forward is what fixes it, so
    // both directions are searched and the nearer boundary wins; a tie
    // goes forward, because ending a line *on* its punctuation reads
    // better than ending just before it.
    const reach = Math.max(MIN_REACH, Math.round(piece.length * PUNCTUATION_REACH));

    // A full stop is a better place to end a subtitle than a comma, so
    // the whole reach is searched for one before a comma is considered at
    // all. Without the two passes, a comma two characters away beats a
    // full stop three away and the line ends mid-sentence -- which is how
    // 的自然灾害之一。 became 的自然灾害之一。转眼之间， on the first try
    // at searching forwards.
    const find = (isBoundary: (u: string | undefined) => boolean) => {
      for (let step = 1; step <= reach; step += 1) {
        // Forward: take `step` more units, if they are there and are not
        // owed to a later cue.
        if (at + step - 1 < Math.min(limit, units.length) && isBoundary(units[at + step - 1])) {
          return step;
        }
        // Backward: give `step` units back, keeping at least one.
        if (at - step > started && isBoundary(units[at - step - 1])) return -step;
      }
      return 0;
    };
    const is = (re: RegExp) => (u: string | undefined) => !!u && re.test(u);
    const move = find(is(ENDS_A_SENTENCE)) || find(is(BREAKS_WELL));
    for (let n = 0; n < Math.abs(move); n += 1) {
      if (move > 0) {
        piece += units[at];
        consumed += units[at].length;
        at += 1;
      } else {
        at -= 1;
        consumed -= units[at].length;
        piece = piece.slice(0, -units[at].length);
      }
    }
    out.push(piece.trim());
  }
  out.push(units.slice(at).join("").trim());
  return out;
}
