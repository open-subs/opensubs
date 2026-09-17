// Sentence grouping and re-spreading, for the two translators that cannot
// read across a batch.
//
//   node --experimental-strip-types e2e/context.mjs
import { contextGroups, joinGroup, spread } from "../src/lib/context.ts";

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- grouping ------------------------------------------------------------

{
  const cues = [
    { start: 0, end: 6.567 },
    { start: 6.633, end: 13.433 },
    { start: 13.5, end: 20.333 },
    { start: 20.4, end: 23.733 },
  ];
  const texts = [
    "Earthquakes are among the most common",
    "natural disasters in the world. From one second",
    "to the next, the ground starts to shake, sometimes destroying entire cities.",
    "But what exactly makes the Earth quake?",
  ];
  eq("a sentence spanning three cues is one group", contextGroups(cues, texts), [
    { from: 0, to: 3 },
    { from: 3, to: 4 },
  ]);
}

{
  // A long pause is a new thought whatever the punctuation says.
  const cues = [{ start: 0, end: 2 }, { start: 9, end: 11 }];
  eq("a gap splits a group", contextGroups(cues, ["and then", "we left"]), [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ]);
}

eq("joining spaced text puts a space in", joinGroup(["one two", "three"]), "one two three");
eq("joining Chinese does not", joinGroup(["地震是", "常见的"]), "地震是常见的");
eq("empty parts are skipped", joinGroup(["", "a", ""]), "a");

// --- APP-53 --------------------------------------------------------------

{
  // The reported failure. Chrome returns the two sentences with a single
  // space between them; that space used to switch the split from forty
  // character positions to two "words", and two pieces cannot fill three
  // cues -- so the first got nothing and kept its untranslated English.
  const sources = [
    "Earthquakes are among the most common",
    "natural disasters in the world. From one second",
    "to the next, the ground starts to shake, sometimes destroying entire cities.",
  ];
  const spaced = "地震是世界上最常见的自然灾害之一。 转眼之间，大地开始震动，有时会摧毁整座城市。";
  const tight = spaced.replace(/\s+/g, "");

  for (const [label, translated] of [["with the translator's space", spaced], ["without it", tight]]) {
    const out = spread(translated, sources);
    eq(`${label}: one piece per cue`, out.length, sources.length);
    ok(`${label}: no cue is left empty`, out.every((p) => p.length > 0), JSON.stringify(out));
    ok(
      `${label}: nothing is lost`,
      out.join("").replace(/\s+/g, "") === tight.replace(/\s+/g, ""),
      JSON.stringify(out.join("")),
    );
  }
  ok(
    "a space in the translation does not change the split",
    JSON.stringify(spread(spaced, sources)) === JSON.stringify(spread(tight, sources)),
    `${JSON.stringify(spread(spaced, sources))} vs ${JSON.stringify(spread(tight, sources))}`,
  );
  ok(
    "the break lands on punctuation when one is near",
    spread(tight, sources)[1].endsWith("。"),
    JSON.stringify(spread(tight, sources)[1]),
  );
}

{
  // Fewer units than cues: somebody has to get nothing, and it must be a
  // later cue rather than the first one the reader meets.
  const out = spread("是", ["aaaa", "bbbb", "cccc"]);
  eq("a one-character translation still fills the first cue", out[0], "是");
  eq("and leaves the later ones blank", out.slice(1), ["", ""]);
}

{
  const out = spread("Hello there", ["aaa", "bbb", "ccc"]);
  ok("a two-word translation fills the first cue", out[0].length > 0, JSON.stringify(out));
}

// --- the ordinary cases --------------------------------------------------

eq("a single cue is passed through", spread("anything", ["one"]), ["anything"]);
eq("an empty translation empties every cue", spread("   ", ["a", "b"]), ["", ""]);

{
  const out = spread("Under the crust there is a liquid mantle.", [
    "Under the Earth's crust, there's",
    "a liquid mantle.",
  ]);
  eq("english splits at a word boundary", out.length, 2);
  ok("english loses no words", out.join(" ").split(/\s+/).length === 8, JSON.stringify(out));
}

{
  // Latin inside Chinese keeps its spaces. Only a space with an unspaced
  // character on BOTH sides is dropped, so "iPhone 15" must never come
  // back glued together inside one piece. (A space that happens to land
  // on a cue boundary is trimmed, which is right -- that is the edge of a
  // subtitle, not a missing space.)
  const pieces = spread("这个手机是 iPhone 15 的新功能，非常好用，值得一试。", ["aaaaaaaaaaaa", "bb"]);
  ok(
    "a Latin run inside Chinese is not glued together",
    pieces.every((p) => !/iPhone15/.test(p)) && pieces.some((p) => p.includes("iPhone 15")),
    JSON.stringify(pieces),
  );
}


// --- APP-53, second round: the punctuation snap ------------------------
//
// The first fix ended the missing translations, which thea confirmed --
// 26 of 26 translated, none left in English. What did not take effect was
// the third part, aligning the break to nearby punctuation. Five of 25
// split points still cut a word, and in one the full stop opened the next
// cue instead of closing the previous one:
//
//     …大脑并没 | 有改变，…       the comma is four units on
//     …感受特 | 定情绪时，…       four units on
//     …选择不同的情绪 | 。我们…    the full stop opened the next cue
//
// Every one is *ahead* of the break, and the search only looked behind.
// These fix the distance rather than the sentence: a sentence chosen to
// make the point is a sentence that proves nothing.

/** Two sources whose lengths put the proportional break after `aChars`. */
function splitAt(text, aChars) {
  return spread(text, ["x".repeat(aChars), "y".repeat(text.length - aChars)]);
}

for (const distance of [1, 2, 3, 4]) {
  const text = "甲乙丙丁" + "王".repeat(distance - 1) + "。" + "壬癸子丑寅卯";
  const out = splitAt(text, 4);
  ok(
    `a full stop ${distance} unit(s) ahead pulls the break onto it`,
    out[0].endsWith("。"),
    `got 「${out[0]}」 | 「${out[1]}」`,
  );
}

{
  const out = splitAt("你可以选择不同的情绪。我们开始吧", 8);
  ok("a full stop never opens the next cue", !out[1].startsWith("。"), `「${out[0]}」 | 「${out[1]}」`);
  ok("and it closes the previous one", out[0].endsWith("。"), `「${out[0]}」 | 「${out[1]}」`);
}

{
  // The comma is one unit ahead, the full stop three. Ending a subtitle
  // mid-sentence to save two characters is the wrong trade, so the whole
  // reach is searched for a sentence end before a comma is considered.
  const out = splitAt("天气很好，今天。明天再说吧", 4);
  ok("a full stop beats a nearer comma", out[0].endsWith("。"), `「${out[0]}」 | 「${out[1]}」`);
}

{
  const out = splitAt("好的。甲乙丙丁戊己庚辛壬癸", 6);
  ok("punctuation behind the break still works", /[。，]$/.test(out[0]), `「${out[0]}」 | 「${out[1]}」`);
}

{
  const text = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳";
  const out = splitAt(text, 8);
  eq("with no punctuation in reach nothing is lost", out.join(""), text);
  ok("and no cue is left empty", out.every((p) => p.length > 0), JSON.stringify(out));
}

// --- the alignment budget is in characters, not units (APP-53, round 3) ---
//
// The reach was a count of units against a budget measured in characters.
// In Chinese a unit is a character, so every reported case behaved and this
// went unseen; in a language with spaces a unit is a whole word, and a
// fifty-character piece bought a reach of twelve words. The split then
// landed wherever the nearest comma was rather than where the audio was.
//
// Measured against the proportional split, in characters, because that is
// the drift a viewer sees between the words on screen and the words spoken.
{
  const drift = (text, aChars) => {
    const out = splitAt(text, aChars);
    return Math.abs(out[0].length - aChars);
  };
  const english =
    "The brain is adaptive, like plastic and clay it can be shaped by what happens to you every day.";
  // The comma sits 23 characters before the proportional split. It must not
  // drag the break there: that was 4 words on screen against 12 of audio.
  ok(
    "a distant comma does not drag an English split",
    drift(english, 45) <= 12,
    `drift ${drift(english, 45)} chars, got 「${splitAt(english, 45)[0]}」`,
  );
  const worst = [];
  for (let a = 10; a <= 80; a += 5) worst.push(drift(english, a));
  ok(
    "no English split drifts more than a short word from proportional",
    Math.max(...worst) <= 12,
    `worst ${Math.max(...worst)} chars`,
  );
  // The same sentence in Chinese still snaps to its comma, unchanged.
  const chinese = "大脑是适应性的，就像塑料和黏土一样可以被塑形。";
  ok(
    "a Chinese split still snaps to a comma within reach",
    splitAt(chinese, 9)[0].endsWith("，"),
    `got 「${splitAt(chinese, 9)[0]}」`,
  );
}

{
  // thea's #13->#14: the full stop is the last character of the translation,
  // four ahead of the split. Taking it would leave the final cue empty, so
  // the break stays put -- correct, and the reason it can never align.
  const out = spread("变得更容易大脑去旅行这条途径。", ["a".repeat(47), "b".repeat(50), "c".repeat(38)]);
  eq("a sentence-final stop is not stolen from the last cue", out, [
    "变得更容易",
    "大脑去旅行这",
    "条途径。",
  ]);
  ok("and no cue in that group is empty", out.every((p) => p.length > 0), JSON.stringify(out));
}

// --- a split already on a comma stays there (APP-53, round 4) ---------
//
// thea's #4 -> #5, from app_en2.srt on ELpfYCZa87g, Chrome's translation to
// Simplified Chinese. The ideal split ends #4 on the comma, because
// "它是适应性的，就像" is "It is adaptable, like" -- the last words of #4's
// own audio. A full stop seven characters back used to win whenever it was
// inside the reach, however close the comma was, including when the split
// had landed exactly on it.
{
  const S4 = "not true. The brain can and does change throughout our lives. It is adaptable, like";
  const S5 = "plastic, and neuroscientists call this neuroplasticity.";
  const T45 = "大脑可以而且确实在我们的生活中发生变化。它是适应性的，就像塑料和神经科学家称之为神经可塑性。";

  const two = spread(T45, [S4, S5]);
  ok("the reported pair ends #4 on its comma", two[0].endsWith("它是适应性的，") && two[1].startsWith("就像塑料"),
    `「${two[0]}」 | 「${two[1]}」`);

  // With the cue before it in the group -- #4 opens with "not true.", so
  // #3 is always part of this group in the real file. This shape put the
  // split exactly on the comma and then moved it seven characters back.
  const three = spread("一二三。" + T45, ["x".repeat(10), S4, S5]);
  ok("a split that lands on the comma is not dragged back to a full stop",
    three[1].endsWith("它是适应性的，") && three[2].startsWith("就像塑料"),
    `「${three[1]}」 | 「${three[2]}」`);

  // Every shape of the unseen #3 that is as dense as its neighbours and
  // agrees with what the report showed at the #3/#4 boundary. Before this
  // round 895 of 2,346 ended #4 on 变化。; the rest are the full stop
  // winning a genuine near-tie, which is the rule working.
  const ratio = T45.length / (S4.length + S5.length);
  const filler = "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃辰宿列张";
  let shapes = 0;
  let onComma = 0;
  for (let s3 = 8; s3 <= 160; s3 += 1) {
    for (let l3 = 3; l3 <= 55; l3 += 1) {
      const r = l3 / s3;
      if (r < ratio * 0.7 || r > ratio * 1.3) continue;
      const out = spread(filler.slice(0, l3 - 1) + "。" + T45, ["x".repeat(s3), S4, S5]);
      if (!(out[0].endsWith("。") && out[1].startsWith("大脑可以"))) continue;
      shapes += 1;
      if (out[1].endsWith("，") && out[2].startsWith("就像")) onComma += 1;
    }
  }
  ok("across realistic shapes of #3, #4 almost always ends on its comma",
    shapes > 2000 && onComma / shapes > 0.98, `${onComma} of ${shapes}`);
}

{
  // Distance, not sentences. Already on a comma with a full stop seven
  // back: stay. The margin that still lets a full stop win is pinned by
  // "a full stop beats a nearer comma" above -- one against four.
  const out = splitAt("甲乙丙丁戊己庚。辛壬癸，子丑寅卯辰巳午未", 12);
  ok("a comma the split is already on beats a full stop seven back", out[0].endsWith("，"),
    `「${out[0]}」 | 「${out[1]}」`);
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
