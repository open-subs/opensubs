// Taking out what the recogniser said but nobody spoke.
//
// Whisper is a *generative* model with a transcription task bolted on: it
// predicts likely text given audio, and when the audio holds nothing it
// can transcribe -- silence, applause, a music bed under the credits --
// it does not fall silent. It writes the most likely thing to appear in
// a subtitle file at that moment, because its training set was subtitle
// files scraped off the web, and those end with "Thanks for watching!",
// "ご視聴ありがとうございました", "字幕由Amara.org社群提供", and a Korean
// news reporter signing off.
//
// This is not a bug that can be fixed by decoding better. It is what the
// model is for. So the output is read afterwards, and the passages that
// cannot be a transcript of the audio underneath them are removed.
//
// # Why not a voice-activity detector
//
// The obvious answer -- gate on a VAD, drop anything over non-speech --
// is half of what happens here, and only half, because it does not hold
// up against the case that prompted it. End-credit music is not silence.
// It is often mixed at or above the level of the narration it follows,
// so an energy gate passes it and the model goes on writing over it.
// A neural VAD would tell speech from music, but it is a second model to
// download before the first one has finished.
//
// What is used instead is the level *and* the text, because these
// failures are identifiable by what they say:
//
//   1. It is in the wrong script for the language being read. Chinese
//      does not contain Korean sentences.
//   2. It is a word repeated. "you you you" is not English.
//   3. It is one of the model's known sign-offs, and there is no speech
//      under it.
//   4. It is the line before it, said again, over silence.
//
// And because debris does not always get a line to itself, a loop stuck
// to the end of a real sentence is cut off it rather than taking the
// sentence down with it.
//
// Each rule fires on something that is impossible rather than merely
// unusual, and each is the direct answer to a defect seen in the wild.

/** Enough of a segment for these rules; matches `engine.Segment`. */
export interface Spoken {
  start: number;
  end: number;
  text: string;
}

export interface CleanUpOptions {
  /** RMS of the audio between two times, in seconds. */
  level: (from: number, to: number) => number;
  /** The language being read at a given time, as a Whisper code. */
  languageAt: (at: number) => string;
}

/** What one segment was judged to be, kept for the caller to report. */
export interface Removal {
  segment: Spoken;
  reason: "script" | "stutter" | "boilerplate" | "repeat";
}

export interface CleanUpResult {
  kept: Spoken[];
  removed: Removal[];
}

// --- scripts ------------------------------------------------------------

const SCRIPTS = {
  han: /[㐀-䶿一-鿿豈-﫿]/,
  kana: /[぀-ヿ]/,
  hangul: /[ᄀ-ᇿ㄰-㆏가-힯]/,
  latin: /[A-Za-zÀ-ɏ]/,
  cyrillic: /[Ѐ-ӿ]/,
  arabic: /[؀-ۿݐ-ݿ]/,
  hebrew: /[֐-׿]/,
  thai: /[฀-๿]/,
  devanagari: /[ऀ-ॿ]/,
} as const;

export type Script = keyof typeof SCRIPTS;

/** Every script with a meaningful share of the characters in `text`. */
export function scriptsIn(text: string): Script[] {
  const counts = new Map<Script, number>();
  let total = 0;
  for (const ch of text) {
    for (const [name, pattern] of Object.entries(SCRIPTS) as [Script, RegExp][]) {
      if (pattern.test(ch)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        total += 1;
        break;
      }
    }
  }
  if (total === 0) return [];
  // A stray character is a decoder slip or a loan word, not a second
  // language: one 漢字 in an English sentence must not make it Chinese.
  return [...counts]
    .filter(([, n]) => n / total >= SCRIPT_SHARE)
    .map(([name]) => name);
}

/** Below this share of the text, a script is incidental. */
const SCRIPT_SHARE = 0.2;

/**
 * Which scripts a language can be written in.
 *
 * Latin is allowed everywhere, because every one of these languages
 * borrows names, units and acronyms unchanged -- a Chinese interview
 * saying "GDP" is still Chinese. What is not allowed is a script the
 * language simply does not use, and that asymmetry is the whole value of
 * the rule: it is impossible, not unlikely.
 */
const WRITTEN_IN: Record<string, Script[]> = {
  zh: ["han", "latin"],
  ja: ["kana", "han", "latin"],
  ko: ["hangul", "han", "latin"],
  yue: ["han", "latin"],
  ru: ["cyrillic", "latin"],
  uk: ["cyrillic", "latin"],
  ar: ["arabic", "latin"],
  fa: ["arabic", "latin"],
  ur: ["arabic", "latin"],
  he: ["hebrew", "latin"],
  th: ["thai", "latin"],
  hi: ["devanagari", "latin"],
  mr: ["devanagari", "latin"],
  ne: ["devanagari", "latin"],
};

/** The default for the many languages written only in Latin script. */
const LATIN_ONLY: Script[] = ["latin"];

/**
 * Whether text could have been spoken in a given language.
 *
 * Measured on a Chinese clip: after the narration ended the model emitted
 * a full Korean sentence over the credit music -- the sign-off from a
 * Korean news bulletin, which is what a great deal of Whisper's Korean
 * training data is. No amount of listening produces Korean from Mandarin
 * audio, so the segment is discarded rather than second-guessed.
 */
export function scriptFits(language: string, text: string): boolean {
  const found = scriptsIn(text);
  if (found.length === 0) return true; // digits and punctuation only
  const allowed = WRITTEN_IN[language.split("-")[0].toLowerCase()] ?? LATIN_ONLY;
  return found.every((script) => allowed.includes(script));
}

// --- repetition ---------------------------------------------------------

/** Case, spacing and punctuation removed, for comparing two lines. */
export function bare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/** A line that is one short piece of text repeated, and nothing else. */
export interface Stutter {
  /** The piece that repeats. */
  unit: string;
  /** How many times it fills the line. */
  repeats: number;
}

/**
 * Find the loop in a line, if the line is nothing but one.
 *
 * The decoder is already told not to repeat a six-token sequence, which
 * stops a line running forever but leaves the short ones: "you you you"
 * over the closing music of an English clip, and a bare "you" on the
 * Japanese one.
 *
 * Whether that is a fault is not decided here, because it is not decided
 * by the text alone. A person can say a word three times -- "no, no, no"
 * is a sentence -- so the caller weighs the count, the audio and the word
 * itself. What this does is measure the repetition.
 */
export function stutterOf(text: string): Stutter | null {
  const words = text.trim().split(/\s+/).filter((w) => bare(w));
  if (words.length >= MIN_STUTTER) {
    const first = bare(words[0]);
    if (first && words.every((word) => bare(word) === first)) {
      return { unit: words[0], repeats: words.length };
    }
  }
  // The same, for the scripts that do not put spaces between words. A
  // single repeated character is held to a higher count than a repeated
  // word: 哈哈哈 is laughter, and only a much longer run of it is a loop.
  const flat = bare(text);
  for (let size = 1; size * MIN_STUTTER <= flat.length; size += 1) {
    if (flat.length % size !== 0) continue;
    const head = flat.slice(0, size);
    let same = true;
    for (let at = size; at < flat.length; at += size) {
      if (flat.slice(at, at + size) !== head) {
        same = false;
        break;
      }
    }
    const repeats = flat.length / size;
    if (same && (size > 1 || repeats >= SINGLE_CHARACTER_LOOP)) {
      return { unit: head, repeats };
    }
  }
  return null;
}

/** Below this many repeats a run of one character is laughter, not a loop. */
const SINGLE_CHARACTER_LOOP = 6;

/** Fewer repeats than this is not repetition at all. */
const MIN_STUTTER = 3;
/**
 * At this many repeats it is a loop whatever the audio says.
 *
 * Three can be emphasis, so three is put to the audio and to the word
 * itself. Four of the same word, alone, with nothing else in the line,
 * is not something anybody says.
 */
const LOOP_REPEATS = 4;

// --- the model's own sign-offs -----------------------------------------

/**
 * Lines Whisper writes when it has nothing to transcribe.
 *
 * These are not guesses. They are the boilerplate of the subtitle files
 * the model was trained on -- fan-sub credits, YouTube outros, a Korean
 * broadcast sign-off -- and they surface, in the language being decoded,
 * whenever the audio runs out of speech before the file runs out of time.
 *
 * Matching is on `bare` text, so punctuation and spacing do not matter.
 */
const SIGN_OFFS = [
  // English
  "thankyou", "thanksforwatching", "thankyouforwatching", "thanksforwatchingthisvideo",
  "pleasesubscribe", "pleasesubscribetomychannel", "dontforgettosubscribe",
  "subtitlesbytheamaraorgcommunity", "subtitlesbyamaraorg", "transcriptionbycastingwords",
  "bye", "byebye", "thanks", "you",
  // Chinese
  "字幕由amaraorg社群提供", "字幕由amaraorg社区提供", "谢谢观看", "謝謝觀看",
  "谢谢大家", "請不吝點贊訂閱轉發打賞支持明鏡與點點欄目",
  "请不吝点赞订阅转发打赏支持明镜与点点栏目", "明鏡與點點欄目", "字幕志願者",
  "下次再見", "下次再见", "感謝觀看", "感谢收看",
  // Japanese
  "ご視聴ありがとうございました", "ご視聴ありがとうございます",
  "最後までご視聴いただきありがとうございました", "チャンネル登録お願いします",
  "おやすみなさい", "ありがとうございました",
  // Korean
  "시청해주셔서감사합니다", "구독과좋아요부탁드립니다", "감사합니다",
] as const;

const SIGN_OFF_SET = new Set<string>(SIGN_OFFS);

/**
 * Whether a line is written only in a script its language does not use.
 *
 * Latin is tolerated inside every language here, because acronyms and
 * names are borrowed unchanged -- but a line that is *nothing but* Latin,
 * in a language not written in it, is not a borrowing. A bare "you" at
 * the end of a Japanese lesson is the model's, not the speaker's.
 */
export function foreignOnly(language: string, text: string): boolean {
  const found = scriptsIn(text);
  if (found.length !== 1 || found[0] !== "latin") return false;
  const written = WRITTEN_IN[language.split("-")[0].toLowerCase()];
  return written !== undefined && written[0] !== "latin";
}

/** What the model writes instead of transcribing an audio event. */
const AUDIO_EVENT = /\s*\b(music|applause|laughter|♪+)\s*$/i;

/**
 * Cut a loop off the end of a line, with the audio-event marker before it.
 *
 * A hallucination does not always get a subtitle to itself. Measured on
 * an English clip: the last real sentence came back as "...if not many,
 * pairs of jeans. music you you", the transcript and the debris in one
 * line, so every rule that judges a whole line saw a line that was mostly
 * real and kept all of it.
 *
 * Only a run of the *same* word, separated by nothing but spaces, and
 * only when that word is one the model reaches for over silence. Ordinary
 * emphasis is punctuated -- "I want you, you" has a comma in it and is
 * left alone, which is the whole reason the run must be unbroken.
 *
 * The marker goes only once a loop has been found. On its own, a line
 * ending in "music" is someone talking about music.
 */
export function trimTail(text: string): string {
  const loop = /(\S+)(?:\s+\1)+\s*$/i.exec(text);
  if (!loop || !SIGN_OFF_SET.has(bare(loop[1]))) return text;
  return text.slice(0, loop.index).trim().replace(AUDIO_EVENT, "").trim();
}

/** Whether a whole line is one of the model's stock sign-offs. */
export function isSignOff(text: string): boolean {
  const flat = bare(text);
  if (SIGN_OFF_SET.has(flat)) return true;
  // "MBC 뉴스 김철수입니다" -- the reporter's name changes, the frame does
  // not, and this exact shape is what turned up in the Chinese clip.
  return /^(mbc|kbs|sbs|ytn)뉴스/.test(flat);
}

/** What the model writes down instead of transcribing an audio event. */
/**
 * The vocabulary a subtitle annotation is built from.
 *
 * APP-51. The first version of this rule only recognised an annotation
 * that was a whole line and properly closed -- "[Music]", "(applause)".
 * Whisper does not oblige. On a fresh English clip it produced twelve of
 * these in five seconds after the narration ended:
 *
 *     [147.3] PLAYING [♪ OUTRO      [148.3] music playing [♪
 *     [147.9] OUTRO MUSIC           [148.8] PLAYING OUTRUNN
 *
 * Unclosed brackets, the words in any order, and one of them truncated
 * mid-word. None of it matched. What they have in common is not their
 * shape, it is their *vocabulary*: strip the brackets and the note glyphs
 * and every word left is one of these.
 */
const NON_SPEECH_WORDS = new Set([
  "music", "musical", "applause", "laughter", "laughs", "laughing",
  "clapping", "cheering", "cheers", "silence", "instrumental",
  "playing", "plays", "outro", "intro", "theme", "song", "singing",
  "sound", "sounds", "noise", "static", "beeping", "upbeat",
  "音乐", "掌声", "拍手", "笑声",
]);

/** Bracket halves and note glyphs, matched singly so an unclosed one counts. */
const ANNOTATION_MARKS = /[[\]()（）【】♪♫*_-]/g;

/**
 * Whether a whole line is the model naming a sound rather than transcribing.
 *
 * Whisper annotates a music bed or a round of applause the way the
 * subtitle files it learned from do -- "[Music]", "(applause)", a bare
 * "music". None of those is speech, and a line that is *only* that is
 * never someone talking about music: it is the model reporting that there
 * was none.
 */
export function isNonSpeech(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Marks are stripped rather than matched as a pair: `[♪ OUTRO` has an
  // opening bracket and no closing one, which is exactly the shape that
  // got through before.
  const words = trimmed
    .replace(ANNOTATION_MARKS, " ")
    .split(/\s+/)
    .map((w) => bare(w))
    .filter(Boolean);
  if (words.length === 0) return true; // brackets and note glyphs only

  // A sentence is a sentence, whatever words are in it.
  if (/[.!?。！？…]$/.test(trimmed)) return false;

  // Function words are the tell. An annotation is content words only --
  // "outro music playing" -- while speech about music has the scaffolding
  // of a sentence in it: "we listened to the music playing". One "the" is
  // enough to say which this is.
  if (words.some((w) => FUNCTION_WORDS.has(w))) return false;

  // Most, not all.
  //
  // APP-51, second round. Requiring *every* word to be in the vocabulary
  // meant one truncation vetoed the whole line, and the model truncates
  // constantly: the reported segment was
  //
  //   OUTRO MUSIC PLAYING [♪ Outro music playing [♪ OUTro music
  //   playing [♪ OUTRESO OUTRESO OUTRESO
  //
  // -- nine annotation words and three of a word that is not a word. The
  // line survived, and the engine then cut it into the six fragments that
  // came back on the retest. It looked like six separate misses; it was
  // one, split six ways.
  const known = words.filter((w) => NON_SPEECH_WORDS.has(w)).length;
  return known > 0 && known / words.length >= NON_SPEECH_SHARE;
}

/**
 * Words that mean a line is somebody talking, not a caption of a sound.
 *
 * Deliberately tiny and deliberately grammatical. Annotations are written
 * as bare content words; the moment a line needs a determiner or a
 * pronoun to hold together, it is a sentence.
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "from", "by", "as", "is", "are", "was", "were", "be", "been",
  "i", "we", "you", "he", "she", "it", "they", "this", "that", "these", "those",
  "my", "our", "your", "his", "her", "its", "their", "not", "no", "so", "if",
]);

/** How much of a line must be annotation vocabulary for the line to be one. */
const NON_SPEECH_SHARE = 0.6;

/**
 * Whether a line is short enough, and plain enough, to be swallowed by the
 * annotation block around it.
 *
 * "PLAYING OUTRUNN" is not caught by the vocabulary -- the second word is
 * a truncation of nothing in particular -- but it sat between two lines
 * that were. A completed sentence is never taken this way, which is what
 * the punctuation test is for: "Let's rewind." survives, "PLAYING
 * OUTRUNN" does not.
 */
function swallowable(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /[.!?。！？…]$/.test(trimmed)) return false;
  return trimmed.split(/\s+/).filter(Boolean).length <= SWALLOW_WORDS;
}

/** Longer than this and a line is a sentence, not a fragment of an outro. */
const SWALLOW_WORDS = 3;
/** A fragment further from the block than this is not part of it. */
const SWALLOW_GAP_S = 2;
/** And the block grows at most this far, so it cannot creep down the file. */
const SWALLOW_REACH = 4;

/**
 * How many consecutive segments saying the same thing make a loop.
 *
 * A loop does not have to arrive as one line. Measured on an English
 * clip: over the closing music the decoder emitted "you", then "you",
 * then "you", each with its own timestamp, and the segmenter laid them
 * out as subtitles exactly as it would lay out three real sentences --
 * "music you you" on one cue and "you you you" on the next, six seconds
 * of them. Every rule that reads a whole line saw lines that were each
 * one ordinary word.
 *
 * Whisper marks a segment where it hears a sentence end. Three of them in
 * a row carrying the same word is not three sentences.
 */
const LOOP_RUN = 3;

/** A word that is the model's debris rather than something anyone said. */
function isDebris(word: string): boolean {
  const flat = bare(word);
  return flat.length > 0 && (SIGN_OFF_SET.has(flat) || NON_SPEECH_WORDS.has(flat));
}

/**
 * Cut a debris tail off the line a loop is about to continue.
 *
 * The first repetition does not always get a segment of its own. On the
 * English clip the real sentence came back as "...pairs of jeans. music
 * you" and the loop proper began in the *next* segment, so removing the
 * loop left one stray "you" welded to the last thing the narrator said.
 *
 * Two things have to hold. The tail must start after a completed
 * sentence -- so the words that were actually spoken are never at risk --
 * and every word in it must be debris: an audio-event marker, or one of
 * the sign-offs. "So do you" is safe because "so" and "do" are neither;
 * "Thank you" is safe because "thank" alone is not in the list.
 *
 * And it is only called where a loop of the same word follows, which is
 * what makes it evidence rather than suspicion. A line ending in
 * "Thanks", with real speech after it, is somebody thanking somebody.
 */
export function trimDebrisTail(text: string): string {
  const ends = [...text.matchAll(/[.!?。！？…]["\'”’)）\]】]*\s*/g)].pop();
  const from = ends ? ends.index + ends[0].length : 0;
  const tail = text.slice(from).trim();
  if (!tail) return text;
  if (!tail.split(/\s+/).every(isDebris)) return text;
  return text.slice(0, from).trim();
}

/**
 * The longest run of characters two lines share, as a share of the shorter.
 *
 * Short strings, so the simple table is fine and the clarity is worth more
 * than the constant factor.
 */
function overlap(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best / Math.min(a.length, b.length);
}

/**
 * A span of audio that could not hold the words attributed to it, where
 * those words are already said properly next door.
 *
 * APP-52, second round. The six unreadable cues were not a timing defect
 * on their own -- they were one segment the engine had cut up, and that
 * segment said in one second what the segment after it says in five and a
 * half:
 *
 *   [23.93-24.93]  1.0s   we should mention that the Earth's crust, the
 *                         top layer of the Earth quake? Let's rewind.
 *   [25.00-30.50]  5.5s   First we should mention that the Earth's crust,
 *                         the top layer of the Earth, is made
 *
 * Eighty-eight characters in one second is not a transcript of that
 * second; nobody speaks at eighty-eight characters a second. So the first
 * test is arithmetic rather than judgement.
 *
 * On its own that would only prove the *timing* is wrong, and dropping it
 * would lose the words. The second test is what makes deletion safe: the
 * same words are already carried, at a readable pace, by a neighbour. The
 * report put it exactly right -- the full line loses nothing when the
 * fragments go, because it holds the content already.
 *
 * Merging them instead, which is what the first attempt did, cannot work
 * here: the merged cue would say the sentence a second time, right before
 * the copy that is correctly timed.
 */
function crammedRepeat(segments: Spoken[], texts: string[], i: number): boolean {
  const span = segments[i].end - segments[i].start;
  const flat = bare(texts[i]);
  if (span <= 0 || flat.length < MIN_CRAMMED_CHARS) return false;
  if (flat.length / span < MAX_CHARS_PER_SECOND) return false;
  for (const j of [i - 2, i - 1, i + 1, i + 2]) {
    if (j < 0 || j >= texts.length || j === i) continue;
    if (Math.abs(segments[j].start - segments[i].start) > REPEAT_NEAR_S) continue;
    if (overlap(flat, bare(texts[j])) >= REPEAT_OVERLAP) return true;
  }
  return false;
}

/** Below this many characters, a dense span is a fragment, not a sentence. */
const MIN_CRAMMED_CHARS = 30;
/**
 * The ceiling on how fast a span can be spoken.
 *
 * Fast English narration runs about 20 characters a second and Chinese
 * about six. Twenty-five leaves room for both and still refuses eighty.
 */
const MAX_CHARS_PER_SECOND = 25;
/** How far away the properly timed copy may be. */
const REPEAT_NEAR_S = 12;
/** And how much of the crammed line it has to carry. */
const REPEAT_OVERLAP = 0.6;

// --- the pass -----------------------------------------------------------

/**
 * How quiet, against the file's own speech, counts as nothing to hear.
 *
 * Relative because there is no absolute answer: a quietly recorded
 * interview and a loud one are both speech. The reference is the median
 * level across the segments, which is a level the file demonstrably
 * reaches while someone is talking.
 */
const QUIET_RATIO = 0.35;

/** Two identical lines further apart than this are two identical lines. */
const REPEAT_WINDOW_S = 30;

/** Short enough that repeating it proves nothing. */
const MIN_REPEAT_CHARS = 4;

/**
 * Remove the segments that cannot be a transcript of their own audio.
 *
 * Order matters: this runs *after* gap-filling, because dropping a
 * hallucinated line leaves a gap, and a gap-filler that ran afterwards
 * would read the same silence again and write the same line back.
 */
export function cleanUp(segments: Spoken[], options: CleanUpOptions): CleanUpResult {
  const { level, languageAt } = options;
  if (segments.length === 0) return { kept: [], removed: [] };

  // The debris comes off before anything else, because a line can be a
  // real sentence with a loop stuck to the end of it, and because the
  // runs below are runs of what the text *is* once that is gone.
  const texts = segments.map((s) => trimTail(s.text));
  // How long a run of identical consecutive segments each one sits in,
  // and where that run starts.
  const runLength = texts.map(() => 1);
  const runStart = texts.map((_, i) => i);
  for (let i = 1; i < texts.length; i += 1) {
    if (bare(texts[i]) && bare(texts[i]) === bare(texts[i - 1])) runStart[i] = runStart[i - 1];
  }
  // Forwards, so the last write for a run is its furthest member.
  for (let i = 0; i < texts.length; i += 1) {
    runLength[runStart[i]] = i - runStart[i] + 1;
  }
  // A loop that is about to be removed is also evidence about the line
  // before it, which may be holding the loop's first repetition.
  for (let i = 0; i < texts.length; i += 1) {
    if (i !== runStart[i] || runLength[i] < LOOP_RUN) continue;
    if (!SIGN_OFF_SET.has(bare(texts[i])) || i === 0) continue;
    texts[i - 1] = trimDebrisTail(texts[i - 1]);
  }

  // APP-51. An annotation block is contiguous: the outro arrives as a run
  // of them, and a fragment sitting inside that run belongs to it even
  // when its own words are not in the vocabulary. The run is grown from
  // the lines that *are* certain, outwards, over neighbours that are short
  // and unpunctuated and close in time -- so a completed sentence is never
  // taken, and the block cannot creep across a gap into real speech.
  const annotation = texts.map((t) => isNonSpeech(t));
  for (let pass = 0; pass < SWALLOW_REACH; pass += 1) {
    let grew = false;
    for (const [i, isAnn] of annotation.entries()) {
      if (!isAnn) continue;
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= texts.length || annotation[j]) continue;
        const gap =
          j < i ? segments[i].start - segments[j].end : segments[j].start - segments[i].end;
        if (gap > SWALLOW_GAP_S || !swallowable(texts[j])) continue;
        annotation[j] = true;
        grew = true;
      }
    }
    if (!grew) break;
  }

  const levels = segments.map((s) => level(s.start, s.end));
  const reference = median(levels.filter((l) => l > 0));
  const quiet = (i: number) => reference > 0 && levels[i] < reference * QUIET_RATIO;

  const kept: Spoken[] = [];
  /** Where each kept segment sat in the input, so its level is to hand. */
  const keptAt: number[] = [];
  const removed: Removal[] = [];
  const drop = (i: number, reason: Removal["reason"]) =>
    removed.push({ segment: segments[i], reason });

  for (const [i, segment] of segments.entries()) {
    const language = languageAt((segment.start + segment.end) / 2);
    const text = texts[i];
    if (!text || annotation[i]) {
      drop(i, "stutter");
      continue;
    }
    if (crammedRepeat(segments, texts, i)) {
      drop(i, "repeat");
      continue;
    }
    // The same word, in this segment and the two before it. A sign-off
    // repeated that way is all loop and goes entirely; anything else
    // keeps its first utterance, because a word said once is a word said.
    if (runLength[runStart[i]] >= LOOP_RUN) {
      if (SIGN_OFF_SET.has(bare(text)) || i !== runStart[i]) {
        drop(i, "repeat");
        continue;
      }
    }
    if (!scriptFits(language, text)) {
      drop(i, "script");
      continue;
    }
    // A loop, weighed three ways. Four repeats is a loop outright; three
    // is only a loop if there was nothing to hear, or if the word itself
    // is one the model reaches for when there is nothing to hear -- which
    // is exactly the reported case, "you you you" over the end credits.
    const stutter = stutterOf(text);
    if (
      stutter &&
      (stutter.repeats >= LOOP_REPEATS || quiet(i) || SIGN_OFF_SET.has(bare(stutter.unit)))
    ) {
      drop(i, "stutter");
      continue;
    }
    // A sign-off is only wrong when nothing was said under it. Someone
    // closing a talk with "thank you" is speaking at the level the rest
    // of their talk was recorded at; the model closing a file with it is
    // writing over a music bed or over nothing.
    // ...or when it is not in the language being read at all: an English
    // "you" cannot be a transcript of Japanese however loud it is.
    if (isSignOff(text) && (quiet(i) || foreignOnly(language, text))) {
      drop(i, "boilerplate");
      continue;
    }
    // The stutter, one whole sentence wide: the decoder reaches a silent
    // stretch, has nothing new to hear, and emits the line it just
    // finished. So the copy is discarded only when one of the two sits
    // over silence -- said twice over real audio is said twice.
    const previous = kept[kept.length - 1];
    if (
      previous &&
      bare(previous.text).length >= MIN_REPEAT_CHARS &&
      bare(previous.text) === bare(text) &&
      segment.start - previous.end <= REPEAT_WINDOW_S &&
      (quiet(i) || quiet(keptAt[keptAt.length - 1]))
    ) {
      drop(i, "repeat");
      continue;
    }
    kept.push(text === segment.text ? segment : { ...segment, text });
    keptAt.push(i);
  }

  return { kept, removed };
}

/**
 * Give every cue long enough on screen to be read, by joining the ones
 * that are not rather than dropping them.
 *
 * APP-52. This is not a hallucination and none of the rules above touch
 * it: the words are right, the timing is not. Measured on an English
 * clip, one second holding six cues:
 *
 *     [23.9-24.0] 0.13s  should mention
 *     [24.1-24.2] 0.13s  that the Earth's
 *     [24.3-24.4] 0.13s  crust, the top
 *     [24.5-24.6] 0.07s  layer of the
 *
 * A tenth of a second is below the threshold at which a person registers
 * that text appeared at all, so six correct fragments read as a flicker.
 * One of them had identical start and end times and was on screen for
 * exactly no time.
 *
 * Joined, not dropped, because the content is real: deleting it would
 * lose the sentence to fix its timing. Neighbours are only joined when
 * they are close enough in time to be one utterance, and the join stops
 * at `MAX_JOIN_S` so a merge cannot build a cue nobody can read either.
 *
 * Where this runs matters. It is after `cleanUp`, so it never joins a
 * hallucination to a real line, and after gap-filling, so it is working
 * on the final set rather than one that is about to grow.
 */
export function mergeBriefs(segments: Spoken[]): Spoken[] {
  const out: Spoken[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    const tooBrief = last && last.end - last.start < MIN_DISPLAY_S;
    const adjacent = last && segment.start - last.end <= JOIN_GAP_S;
    const roomLeft = last && segment.end - last.start <= MAX_JOIN_S;
    if (tooBrief && adjacent && roomLeft) {
      last.end = segment.end;
      last.text = `${last.text} ${segment.text}`.replace(/\s+/g, " ").trim();
      continue;
    }
    out.push({ ...segment });
  }
  // A cue with nothing after it to join, or a neighbour too far away, is
  // stretched instead -- never past the one that follows it, which would
  // put two cues on screen at once.
  for (const [i, segment] of out.entries()) {
    if (segment.end - segment.start >= MIN_DISPLAY_S) continue;
    const next = out[i + 1];
    const ceiling = next ? next.start : segment.start + MIN_DISPLAY_S;
    segment.end = Math.max(segment.end, Math.min(segment.start + MIN_DISPLAY_S, ceiling));
  }
  return out;
}

/**
 * How long a cue must be on screen. The common range for subtitle work is
 * 0.8-1.2 seconds; this takes the low end, because the alternative to a
 * short cue here is a longer one that runs over the next line.
 */
const MIN_DISPLAY_S = 0.9;
/** Two cues further apart than this are two utterances, not one. */
const JOIN_GAP_S = 0.4;
/** And no join builds a cue longer than the engine will show as one. */
const MAX_JOIN_S = 7;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
