// Which language the subtitles are already in, and whether a target is it.
//
// Translating into the language the text is already written in returns the
// text, and on the paid route it is charged for. The page cannot always
// know the language -- an imported English file and an imported Spanish one
// look the same to anything short of a language detector -- but often it
// can: the recogniser reports what it heard, the person may have said, and
// some scripts belong to one language only.
//
// No imports, so it can be tested in Node.

/**
 * The language a body of subtitle text must be in, judged by its script
 * alone, or null when the script does not settle it.
 *
 * Only scripts that name one language among those the engine offers:
 * Hangul is Korean, kana is Japanese, Thai is Thai. Han without kana is
 * Chinese, but Simplified or Traditional is a separate question, so it is
 * reported as bare `zh` and never blocks either. Latin and Cyrillic are
 * shared by many languages and say nothing, except that Ukrainian and
 * Russian each have letters the other lacks.
 */
export function languageFromScript(texts: string[]): string | null {
  let letters = 0;
  const count = { hangul: 0, kana: 0, han: 0, thai: 0, arabic: 0, devanagari: 0, cyrillic: 0 };
  let ukrainian = 0;
  let russian = 0;
  for (const text of texts) {
    for (const c of text) {
      if (!/\p{L}/u.test(c)) continue;
      letters += 1;
      if (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(c)) count.hangul += 1;
      else if (/[぀-ヿ]/.test(c)) count.kana += 1;
      else if (/\p{Script=Han}/u.test(c)) count.han += 1;
      else if (/\p{Script=Thai}/u.test(c)) count.thai += 1;
      else if (/\p{Script=Arabic}/u.test(c)) count.arabic += 1;
      else if (/\p{Script=Devanagari}/u.test(c)) count.devanagari += 1;
      else if (/\p{Script=Cyrillic}/u.test(c)) {
        count.cyrillic += 1;
        if (/[іїєґІЇЄҐ]/.test(c)) ukrainian += 1;
        if (/[ыэъёЫЭЪЁ]/.test(c)) russian += 1;
      }
    }
  }
  if (letters === 0) return null;
  const share = (n: number) => n / letters;
  if (share(count.hangul) > 0.5) return "ko";
  // Japanese is written partly in Han, so kana anywhere in a mostly-CJK
  // text decides it.
  if (share(count.kana + count.han) > 0.5 && share(count.kana) > 0.1) return "ja";
  if (share(count.han) > 0.5) return "zh";
  if (share(count.thai) > 0.5) return "th";
  if (share(count.arabic) > 0.5) return "ar";
  if (share(count.devanagari) > 0.5) return "hi";
  if (share(count.cyrillic) > 0.5) {
    if (ukrainian > 0 && russian === 0) return "uk";
    if (russian > 0 && ukrainian === 0) return "ru";
  }
  return null;
}

/**
 * Whether translating text in `source` into `target` would change nothing.
 *
 * Compared on the base language, except for Chinese: Simplified into
 * Traditional is a real conversion, so two Chinese codes are the same only
 * when they name the same script, and a bare `zh` matches neither.
 */
export function sameLanguage(source: string | null, target: string): boolean {
  if (!source || !target) return false;
  if (source === target) return true;
  const a = source.split("-")[0].toLowerCase();
  const b = target.split("-")[0].toLowerCase();
  if (a !== b) return false;
  return a !== "zh";
}
