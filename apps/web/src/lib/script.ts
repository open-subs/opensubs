// Which Chinese script the subtitles come out in.
//
// Whisper has one Chinese: `<|zh|>`. Which script it writes is decided by
// the audio and by nothing the caller can set, and it is not even
// consistent within a file -- measured on a bilingual news clip, one pass
// came back Traditional and the same speaker, re-read seconds later,
// came back Simplified. Half a subtitle file in each script is not a
// style, it is a fault.
//
// So picking 中文（简体）in the interface has to mean something, and the
// only place it can mean anything is here, afterwards.
//
// # Only one direction
//
// Traditional -> Simplified is very nearly one character to one
// character, which is what makes it safe to apply to a whole transcript
// without understanding a word of it. The reverse is not: Simplified 干
// is Traditional 干, 乾 or 幹 depending on the sentence, and a lookup
// table cannot choose. So a request for Traditional is left alone rather
// than answered wrongly.

/**
 * Whether a language code asks for Traditional Chinese specifically.
 *
 * The one case that must be left alone. Everything else Chinese --
 * 简体, or a language nobody named because the audio was read
 * automatically -- is normalised, because "whichever script the model
 * felt like, changing six times in one file" is not a choice anyone made.
 */
export function wantsTraditional(code: string | undefined): boolean {
  if (!code) return false;
  const lower = code.toLowerCase();
  return lower.startsWith("zh") && /hant|tw|hk|mo/.test(lower);
}

/** Whether a language code is Chinese at all, in either script. */
export function isChinese(code: string | undefined): boolean {
  return !!code && code.toLowerCase().startsWith("zh");
}

/**
 * Kana and Hangul: seeing either proves the text is not Chinese.
 *
 * Japanese and Korean are written partly in Han characters, and a great
 * many of those are the *Traditional* form -- 時, 見, 後, 風, 書, 電, 車.
 * Converting them produces 时, 见, 后, 风, 书, 电, 车 in the middle of a
 * Japanese sentence, which is not a script change but a different
 * language's characters spliced into the line. Measured on a Japanese
 * lesson video: 24 characters in one subtitle file.
 *
 * The caller checks the language, which is the real answer. This is the
 * second lock, for the case where the language is wrong or unknown.
 */
const NOT_CHINESE = /[\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af\u1100-\u11ff]/;

let table: Map<string, string> | null = null;

/**
 * Rewrite Traditional characters as Simplified, leaving everything else --
 * Latin, punctuation, numbers, and characters shared by both scripts --
 * exactly as it was.
 *
 * Every substitution is one character for one, so the length of the text
 * does not change and neither does any timing derived from it.
 */
export async function toSimplified(text: string): Promise<string> {
  if (!/[㐀-鿿豈-﫿]/.test(text)) return text;
  if (NOT_CHINESE.test(text)) return text;
  if (!table) {
    const { TS_PAIRS } = await import("./hanzi.ts");
    const built = new Map<string, string>();
    for (let i = 0; i + 1 < TS_PAIRS.length; i += 2) {
      built.set(TS_PAIRS[i], TS_PAIRS[i + 1]);
    }
    // The table is read back two UTF-16 units at a time, so anything in it
    // above U+FFFF would shift every pair after it by one -- which is not
    // a crash, it is a table of plausible wrong answers. It shipped for one
    // build and turned 发 into 鬆 and 后 into 徑 in someone's subtitles.
    // The generator now refuses to emit such a character; this refuses to
    // trust a table that somehow contains one. Leaving the text as Whisper
    // wrote it is a poor outcome. Rewriting it into different words is a
    // much worse one.
    const intact = ["這这", "發发", "後后", "學学"].every(
      (pair) => built.get(pair[0]) === pair[1],
    );
    if (!intact) {
      table = new Map();
      return text;
    }
    table = built;
  }
  if (table.size === 0) return text;
  let out = "";
  for (const ch of text) out += table.get(ch) ?? ch;
  return out;
}
