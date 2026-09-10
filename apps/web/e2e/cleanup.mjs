// What the recogniser writes that nobody said, and what a translator is
// handed when a sentence is cut into three.
//
// These are unit tests, deliberately. The rules they cover were written
// against three videos this machine does not have -- an English, a
// Chinese and a Japanese clip that a team member ran and reported on --
// and the failures were quoted, not attached. What can be pinned down
// without the files is the rule: given this text, at this level, in this
// language, does the pass do the right thing.
//
// The audio level is injected rather than measured. Synthesised audio
// cannot stand in for a music bed under a voice-over, so pretending
// otherwise with a generated tone would be a test that passes without
// testing anything. The real waveform reaches these functions through one
// callback, and the callback is what the tests supply.
//
//   node e2e/cleanup.mjs

import assert from "node:assert/strict";

import {
  cleanUp, scriptFits, scriptsIn, stutterOf, isSignOff, bare, trimTail, foreignOnly,
  isNonSpeech, trimDebrisTail, mergeBriefs,
} from "../src/lib/cleanup.ts";
import { contextGroups, joinGroup, spread } from "../src/lib/context.ts";
import { wantsTraditional, isChinese, toSimplified } from "../src/lib/script.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${error.message.split("\n").join("\n      ")}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${error.message.split("\n").join("\n      ")}`);
  }
}

/** A clip where everything is at speech level unless it is listed quiet. */
function clip(segments, { quiet = [], language = () => "en" } = {}) {
  const isQuiet = new Set(quiet);
  return cleanUp(segments, {
    level: (from) => (isQuiet.has(Math.round(from)) ? 0.002 : 0.05),
    languageAt: language,
  });
}

const say = (start, text, span = 2) => ({ start, end: start + span, text });

console.log("\nscripts");

test("a language is not written in a script it does not use", () => {
  assert.equal(scriptFits("zh", "中国的商业航天"), true);
  assert.equal(scriptFits("zh", "MBC 뉴스 김지경입니다"), false);
  assert.equal(scriptFits("ja", "ご視聴ありがとうございました"), true);
  assert.equal(scriptFits("ja", "감사합니다"), false);
  assert.equal(scriptFits("ko", "감사합니다"), true);
  assert.equal(scriptFits("en", "Hello there"), true);
  assert.equal(scriptFits("en", "中国的商业航天"), false);
});

test("a borrowed word does not change the language", () => {
  // A Chinese interview saying "GDP" is still Chinese, and an English one
  // naming 北京 is still English.
  assert.equal(scriptFits("zh", "去年的GDP增长很快"), true);
  assert.equal(scriptFits("en", "We flew to Beijing 北京 last week for the launch"), true);
});

test("punctuation and digits belong to every language", () => {
  assert.deepEqual(scriptsIn("2026 -- 100%"), []);
  assert.equal(scriptFits("zh", "2026"), true);
});

console.log("\nloops");

test("a word repeated is a loop, a word said twice is speech", () => {
  assert.equal(stutterOf("you you you")?.repeats, 3);
  assert.equal(stutterOf("you you you you")?.repeats, 4);
  assert.equal(stutterOf("Well, well"), null);
  assert.equal(stutterOf("No, I said no"), null);
});

test("laughter is not a loop until it is absurd", () => {
  assert.equal(stutterOf("哈哈哈"), null);
  assert.equal(stutterOf("哈哈哈哈哈哈")?.repeats, 6);
});

test("a repeated phrase in an unspaced script is a loop", () => {
  assert.equal(stutterOf("专业的专业的专业的")?.unit, "专业的");
});

console.log("\nsign-offs");

test("the model's stock endings are recognised in four languages", () => {
  assert.equal(isSignOff("Thanks for watching!"), true);
  assert.equal(isSignOff("字幕由Amara.org社群提供"), true);
  assert.equal(isSignOff("ご視聴ありがとうございました"), true);
  assert.equal(isSignOff("MBC 뉴스 김지경입니다"), true);
  assert.equal(isSignOff("Thank you for coming to the launch site with us"), false);
});

test("punctuation and case do not hide one", () => {
  assert.equal(bare("Thank you."), "thankyou");
  assert.equal(isSignOff("thank you"), true);
});

console.log("\ndebris stuck to a real sentence");

test("a loop is cut off the end of the line it is stuck to", () => {
  // Verbatim from en.mp4 before the fix: the last real sentence and the
  // hallucination arrived as one line, so every whole-line rule kept it.
  assert.equal(
    trimTail("least one, if not many, pairs of jeans. music you you"),
    "least one, if not many, pairs of jeans.",
  );
});

test("a line that is only debris is left empty", () => {
  assert.equal(trimTail("music you you"), "");
  assert.equal(trimTail("you you you"), "");
});

test("punctuated emphasis is not a loop", () => {
  assert.equal(trimTail("I want you, you"), "I want you, you");
  assert.equal(trimTail("It was you"), "It was you");
});

test("a word that is not the model's is not trimmed", () => {
  assert.equal(trimTail("we went round and round and round"), "we went round and round and round");
});

test("music is only debris once a loop proves it is", () => {
  assert.equal(trimTail("we sat and listened to music"), "we sat and listened to music");
});

test("an audio-event annotation is not speech", () => {
  assert.equal(isNonSpeech("[Music]"), true);
  assert.equal(isNonSpeech("(applause)"), true);
  assert.equal(isNonSpeech("music"), true);
  assert.equal(isNonSpeech("♪♪♪"), true);
  assert.equal(isNonSpeech("we sat and listened to music"), false);
});

test("a debris tail after a finished sentence comes off", () => {
  assert.equal(
    trimDebrisTail("least one, if not many, pairs of jeans. music you"),
    "least one, if not many, pairs of jeans.",
  );
  assert.equal(trimDebrisTail("you"), "");
  assert.equal(trimDebrisTail("music you"), "");
});

test("words that were spoken are never in the tail", () => {
  // The tail starts after a completed sentence, so this has none.
  assert.equal(trimDebrisTail("So do you"), "So do you");
  // "thank" alone is not one of the model's sign-offs, so this survives.
  assert.equal(trimDebrisTail("That is all. Thank you"), "That is all. Thank you");
  assert.equal(trimDebrisTail("We listened. It was music to my ears"), "We listened. It was music to my ears");
});

console.log("\nthe pass");

test("English: 'you you you' over the closing music goes", () => {
  // The reported defect. The music is not quiet, so an energy gate alone
  // would keep this; the word is one the model reaches for when it has
  // nothing, and three of it alone in a line is not a sentence.
  const { kept, removed } = clip([
    say(0, "Positioning themselves for the boom in commercial launch"),
    say(4, "you you you"),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(removed[0].reason, "stutter");
});

test("Japanese: a bare 'you' goes however loud it is", () => {
  // From ja.mp4: the last cue, 02:30.1, straight after
  // 「それではまた次回会いましょう」. An English word alone cannot be a
  // transcript of Japanese, so this one does not wait on the level.
  const { kept, removed } = clip(
    [say(0, "商業宇宙開発は急速に進んでいます"), say(4, "you")],
    { language: () => "ja" },
  );
  assert.equal(kept.length, 1);
  assert.equal(removed[0].reason, "boilerplate");
});

test("English: the sentence survives the loop stuck to it", () => {
  const { kept } = clip([
    say(0, "Today, 96% of American consumers own at"),
    say(4, "least one, if not many, pairs of jeans. music you you"),
    say(8, "you you you"),
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept[1].text, "least one, if not many, pairs of jeans.");
});

test("English: a loop spread over separate cues goes too", () => {
  // Verbatim from en.mp4. The decoder gave each "you" its own timestamp,
  // so the segmenter laid them out as ordinary one-word subtitles and
  // every whole-line rule passed them. Six seconds of it, over the
  // closing music -- which is not quiet, so no energy gate sees it
  // either.
  const { kept } = clip([
    say(0, "both work and play by the 1960s. Today, 96% of American consumers own at"),
    say(4, "least one, if not many, pairs of jeans. music you"),
    say(8, "you", 2),
    say(10, "you", 2),
    say(12, "you", 2),
    say(14, "you", 2),
    say(16, "you", 2),
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept[1].text, "least one, if not many, pairs of jeans.");
});

test("a word really said three times in a row keeps one", () => {
  // Not a sign-off, so the loop is collapsed rather than deleted: the
  // speaker did say it.
  const { kept } = clip([
    say(0, "Stop", 1),
    say(1, "Stop", 1),
    say(2, "Stop", 1),
    say(3, "That is enough"),
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].text, "Stop");
});

test("two identical lines in a row are left alone", () => {
  // Two is not a run. Over real audio this stays as it was.
  const { kept } = clip([say(0, "Ready", 1), say(1, "Ready", 1)]);
  assert.equal(kept.length, 2);
});

test("a borrowed acronym alone is not foreign debris", () => {
  assert.equal(foreignOnly("zh", "GDP"), true);
  assert.equal(foreignOnly("en", "you"), false);
  // ...but only a sign-off is dropped for it, so this survives.
  const { kept } = clip([say(0, "去年的增长"), say(4, "GDP")], { language: () => "zh" });
  assert.equal(kept.length, 2);
});

test("Chinese: a Korean sign-off in a Chinese clip goes", () => {
  const { kept, removed } = clip(
    [say(0, "去年开始慢慢感觉政府的支持力度更大了"), say(4, "MBC 뉴스 김지경입니다")],
    { language: () => "zh" },
  );
  assert.equal(kept.length, 1);
  assert.equal(removed[0].reason, "script");
});

test("a sentence said twice over silence is said once", () => {
  const { kept, removed } = clip(
    [
      say(0, "这个火箭是我们自己研发的"),
      say(4, "这个火箭是我们自己研发的"),
    ],
    { quiet: [4], language: () => "zh" },
  );
  assert.equal(kept.length, 1);
  assert.equal(removed[0].reason, "repeat");
});

test("a sentence said twice out loud is said twice", () => {
  const { kept } = clip(
    [say(0, "这个火箭是我们自己研发的"), say(4, "这个火箭是我们自己研发的")],
    { language: () => "zh" },
  );
  assert.equal(kept.length, 2);
});

test("someone really thanking the audience keeps their line", () => {
  // At the level the rest of the clip was recorded at, so it is speech.
  const { kept } = clip([
    say(0, "And that is how the launch window was chosen"),
    say(4, "Thank you."),
  ]);
  assert.equal(kept.length, 2);
});

test("a clip that is nothing but sign-offs is not emptied", () => {
  // Whatever the rules think, handing back no subtitles at all is worse
  // than handing back doubtful ones.
  const { kept } = clip([say(0, "Thank you."), say(4, "Thanks for watching!")], {
    quiet: [0, 4],
  });
  assert.equal(kept.length, 2);
});

test("the language is read at the time the segment was spoken", () => {
  // English first, Chinese after ten seconds: the Chinese line must not
  // be judged against English.
  const { kept } = clip(
    [say(0, "The rocket city"), say(12, "去年开始慢慢感觉")],
    { language: (at) => (at < 10 ? "en" : "zh") },
  );
  assert.equal(kept.length, 2);
});

console.log("\nannotations the model leaves behind (APP-51)");

test("an annotation is recognised however broken it arrives", () => {
  // Verbatim from the tracker. Unclosed brackets, the words in any order,
  // and every case the model felt like using.
  for (const line of ["PLAYING [\u266a OUTRO", "OUTRO MUSIC", "music playing [\u266a",
                      "playing [\u266a", "[outro music playing]", "[Music]", "\u266a\u266a\u266a",
                      "OUTRO", "Outro", "OUTro", "outro"]) {
    assert.equal(isNonSpeech(line), true, JSON.stringify(line));
  }
});

test("a sentence about music is not an annotation", () => {
  assert.equal(isNonSpeech("we sat and listened to music"), false);
  assert.equal(isNonSpeech("Let's rewind."), false);
  assert.equal(isNonSpeech("should mention"), false);
});

test("the whole outro block goes, including the word that is not in the list", () => {
  // "PLAYING OUTRUNN" is a truncation of nothing; it is caught by sitting
  // inside the block, not by its own words.
  const { kept } = clip([
    say(140, "and that is why the ground shakes."),
    say(147.3, "PLAYING [\u266a OUTRO", 0.2),
    say(147.9, "OUTRO MUSIC", 0.1),
    say(148.3, "music playing [\u266a", 0.2),
    say(148.8, "PLAYING OUTRUNN", 0.1),
    say(149.7, "playing [\u266a", 0.1),
    say(151.5, "you", 0.4),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].text, "and that is why the ground shakes.");
});

test("case was never the problem", () => {
  // Reported as a suspected cause. `bare` lowercases, so every rule that
  // compares through it already ignores case -- worth a test so nobody
  // spends an afternoon on it.
  assert.equal(bare("OUTRO"), bare("outro"));
  assert.equal(bare("OUTro"), bare("Outro"));
  assert.equal(isSignOff("THANK YOU."), true);
  assert.equal(stutterOf("YOU you You")?.repeats, 3);
});

test("the outro arrives as one segment, and one truncation must not save it", () => {
  // The actual root cause, found by running the reporter's own video.
  // Requiring every word to be annotation vocabulary meant three
  // truncations of a word that is not a word vetoed nine that were --
  // and the engine then cut the survivor into six cues, which read as
  // six separate misses.
  const whole =
    "OUTRO MUSIC PLAYING [\u266a Outro music playing [\u266a OUTro music " +
    "playing [\u266a OUTRESO OUTRESO OUTRESO";
  assert.equal(isNonSpeech(whole), true);
});

test("a sentence about music survives the majority rule", () => {
  // The function words are what separate these from an annotation.
  assert.equal(isNonSpeech("we listened to the outro music playing on the radio"), false);
  assert.equal(isNonSpeech("The music playing was loud."), false);
  assert.equal(isNonSpeech("we sat and listened to music"), false);
});

console.log("\ncues too short to read (APP-52)");

test("a second's worth of a five-second sentence is dropped, not merged", () => {
  // Verbatim from the retest. 88 characters in one second is not a
  // transcript of that second, and the sentence is already carried
  // properly by the cue after it -- so merging would say it twice.
  const { kept, removed } = clip([
    { start: 23.93, end: 24.93,
      text: "we should mention that the Earth's crust, the top layer of the Earth quake? Let's rewind." },
    { start: 25.0, end: 30.5,
      text: "First we should mention that the Earth's crust, the top layer of the Earth, is made" },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(removed[0].reason, "repeat");
  assert.ok(kept[0].text.startsWith("First we should mention"));
});

test("a dense line with no copy beside it is kept", () => {
  // Density alone only proves the timing is wrong. Dropping then loses
  // the words, so it takes both tests.
  const { kept } = clip([
    { start: 0, end: 1, text: "a genuinely fast but unrepeated line of narration here" },
    { start: 2, end: 8, text: "something else entirely, sharing nothing with it" },
  ]);
  assert.equal(kept.length, 2);
});



test("a flicker of correct fragments becomes one readable cue", () => {
  const merged = mergeBriefs([
    { start: 23.9, end: 24.03, text: "should mention" },
    { start: 24.1, end: 24.23, text: "that the Earth's" },
    { start: 24.3, end: 24.43, text: "crust, the top" },
    { start: 24.5, end: 24.57, text: "layer of the" },
    { start: 24.6, end: 24.7, text: "Earth quake?" },
    { start: 24.8, end: 24.93, text: "Let's rewind." },
  ]);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].end - merged[0].start >= 0.9);
  // Not one word lost: the content was real, only the timing was wrong.
  assert.equal(merged[0].text,
    "should mention that the Earth's crust, the top layer of the Earth quake? Let's rewind.");
});

test("a cue with no duration at all is given one", () => {
  const merged = mergeBriefs([{ start: 149.7, end: 149.7, text: "still here" }]);
  assert.ok(merged[0].end - merged[0].start >= 0.9);
});

test("cues that are already readable are left alone", () => {
  const input = [
    { start: 0, end: 3, text: "A whole sentence, comfortably long." },
    { start: 4, end: 7, text: "And the one after it." },
  ];
  assert.deepEqual(mergeBriefs(input), input);
});

test("a real pause is not joined across", () => {
  const merged = mergeBriefs([
    { start: 0, end: 0.2, text: "one" },
    { start: 5, end: 5.2, text: "two" },
  ]);
  assert.equal(merged.length, 2, "five seconds apart is two utterances");
});

console.log("\nChinese script");

test("only an explicit request for Traditional is left alone", () => {
  assert.equal(wantsTraditional("zh-Hant"), true);
  assert.equal(wantsTraditional("zh-TW"), true);
  assert.equal(wantsTraditional("zh-Hans"), false);
  assert.equal(wantsTraditional("zh"), false);
  assert.equal(wantsTraditional("auto"), false);
  assert.equal(wantsTraditional("en"), false);
});

await asyncTest("a file that changes script mid-way comes out in one", async () => {
  const mixed = "這個火箭是我们自己研发的";
  const out = await toSimplified(mixed);
  assert.equal(out, "这个火箭是我们自己研发的");
  assert.equal(out.length, mixed.length, "timings depend on length being unchanged");
});

await asyncTest("Japanese keeps its own characters", async () => {
  // Japanese is written partly in Han characters and many of them are the
  // Traditional form. Converting them splices Chinese into a Japanese
  // sentence: 24 characters in one file of ja.mp4 before this guard.
  const japanese = "今日一緒に勉強した内容を見て 皆さんもぜひ日本で使ってみてください";
  assert.equal(await toSimplified(japanese), japanese);
  assert.equal(await toSimplified("それではまた次回会いましょう"), "それではまた次回会いましょう");
});

test("only Chinese asks for the conversion at all", () => {
  assert.equal(isChinese("zh-Hans"), true);
  assert.equal(isChinese("zh"), true);
  assert.equal(isChinese("ja"), false);
  assert.equal(isChinese("auto"), false);
  assert.equal(isChinese(undefined), false);
});

await asyncTest("nothing else is touched", async () => {
  assert.equal(await toSimplified("The rocket city, 2026"), "The rocket city, 2026");
});

console.log("\ntranslation context");

test("a sentence broken over cues is one group", () => {
  const cues = [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
    { start: 4, end: 6 },
  ];
  const texts = ["The company said that", "the next launch would", "slip to March."];
  assert.deepEqual(contextGroups(cues, texts), [{ from: 0, to: 3 }]);
});

test("two sentences are two groups", () => {
  const cues = [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ];
  assert.deepEqual(contextGroups(cues, ["That was the first one.", "Then it slipped."]), [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ]);
});

test("a long pause ends a group whatever the punctuation says", () => {
  const cues = [
    { start: 0, end: 2 },
    { start: 20, end: 22 },
  ];
  assert.deepEqual(contextGroups(cues, ["and then we", "went to the pad"]), [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ]);
});

test("every cue is in exactly one group", () => {
  const cues = Array.from({ length: 17 }, (_, i) => ({ start: i, end: i + 1 }));
  const texts = cues.map(() => "and then");
  const groups = contextGroups(cues, texts);
  assert.equal(groups[0].from, 0);
  assert.equal(groups[groups.length - 1].to, texts.length);
  for (let i = 1; i < groups.length; i += 1) assert.equal(groups[i].from, groups[i - 1].to);
});

test("joining respects scripts that have no spaces", () => {
  assert.equal(joinGroup(["The company said that", "the launch would slip"]),
    "The company said that the launch would slip");
  assert.equal(joinGroup(["去年开始", "慢慢感觉政府"]), "去年开始慢慢感觉政府");
});

test("spreading a translation back loses no words", () => {
  const sources = ["The company said that", "the next launch would", "slip to March."];
  const pieces = spread("公司表示下一次发射将推迟到三月", sources);
  assert.equal(pieces.length, sources.length);
  assert.equal(pieces.join(""), "公司表示下一次发射将推迟到三月");
});

test("spreading keeps whole words in a spaced language", () => {
  const pieces = spread("The company said the launch would slip to March", ["公司表示", "发射将推迟到三月"]);
  assert.equal(pieces.length, 2);
  assert.equal(pieces.join(" "), "The company said the launch would slip to March");
  for (const piece of pieces) assert.ok(!piece.startsWith(" ") && !piece.endsWith(" "));
});

test("a translation shorter than its cues still fills every one", () => {
  const pieces = spread("Yes it did", ["aaaa", "bbbb", "cccc"]);
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces, ["Yes", "it", "did"]);
});

test("a cue that is already a sentence is passed through untouched", () => {
  assert.deepEqual(spread("公司表示下一次发射将推迟", ["The company said the launch would slip."]),
    ["公司表示下一次发射将推迟"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
