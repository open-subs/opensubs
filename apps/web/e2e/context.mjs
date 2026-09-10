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

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
