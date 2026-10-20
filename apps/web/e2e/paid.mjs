// What the paid translation route knows before it sends anything.
//
//   node --experimental-strip-types e2e/paid.mjs
//
// Two pure modules, no browser and no wasm: which language the subtitles
// are already in (so translating into it is refused rather than charged),
// and which jobs this account has already paid for (so applying them again
// is free and sends nothing).
import assert from "node:assert/strict";

// A stand-in for the browser's storage, installed before the module loads.
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const { languageFromScript, sameLanguage } = await import("../src/lib/sourcelang.ts");
const paid = await import("../src/lib/paidjobs.ts");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { failed += 1; console.log(`FAIL  ${name}\n      ${e.message.split("\n").join("\n      ")}`); }
}

// --- the language the text is already in --------------------------------

test("Korean text is Korean", () => {
  assert.equal(languageFromScript(["안녕하세요 여러분, 오늘은 자막을 만드는 방법을 보여 드리겠습니다"]), "ko");
});

test("kana makes it Japanese, not Chinese", () => {
  assert.equal(languageFromScript(["今日は字幕の作り方を紹介します"]), "ja");
});

test("Han alone is Chinese, with the script left open", () => {
  assert.equal(languageFromScript(["今天我们来看看怎么做字幕"]), "zh");
  assert.equal(sameLanguage("zh", "zh-Hans"), false);
  assert.equal(sameLanguage("zh", "zh-Hant"), false);
});

test("Latin text is not guessed: English and Spanish look alike to a script", () => {
  assert.equal(languageFromScript(["This is a sample video, subtitled in your browser."]), null);
  assert.equal(languageFromScript(["Este es un vídeo de ejemplo."]), null);
});

test("Ukrainian and Russian are told apart only by the letters one of them lacks", () => {
  assert.equal(languageFromScript(["Привіт, це наше відео"]), "uk");
  assert.equal(languageFromScript(["Это наше видео, вы его увидите"]), "ru");
  assert.equal(languageFromScript(["Привет"]), null);
});

test("timestamps, numbers and punctuation say nothing", () => {
  assert.equal(languageFromScript(["00:01", "...", "42!"]), null);
});

test("a target is the source when the base language matches", () => {
  assert.equal(sameLanguage("en", "en"), true);
  assert.equal(sameLanguage("ko", "ko"), true);
  assert.equal(sameLanguage("pt-BR", "pt"), true);
  assert.equal(sameLanguage("en", "ko"), false);
  assert.equal(sameLanguage(null, "en"), false);
});

test("Simplified into Traditional is a real translation, never refused", () => {
  assert.equal(sameLanguage("zh-Hans", "zh-Hant"), false);
  assert.equal(sameLanguage("zh-Hans", "zh-Hans"), true);
});

// --- what this account has paid for --------------------------------------

test("a job is not paid until the gateway has answered it", () => {
  assert.equal(paid.paidTranslation("u1", "k1"), undefined);
  paid.rememberPaid("u1", "k1", ["你好", "世界"]);
  assert.deepEqual(paid.paidTranslation("u1", "k1"), ["你好", "世界"]);
});

test("one account's jobs are not another's", () => {
  assert.equal(paid.paidTranslation("u2", "k1"), undefined);
});

test("signed out, nothing is paid and nothing is kept", () => {
  paid.rememberPaid(null, "k9", ["x"]);
  assert.equal(paid.paidTranslation(null, "k9"), undefined);
});

test("what was paid for survives a reload", () => {
  paid.forgetAll(); // the tab's copy goes; storage stays
  assert.deepEqual(paid.paidTranslation("u1", "k1"), ["你好", "世界"]);
});

test("a key refused as already paid moves to its next generation", () => {
  assert.equal(paid.keyFor("u1", "base"), "base");
  paid.retireKey("u1", "base");
  assert.equal(paid.keyFor("u1", "base"), "base-g1");
  paid.retireKey("u1", "base");
  assert.equal(paid.keyFor("u1", "base"), "base-g2");
  assert.equal(paid.keyFor("u2", "base"), "base", "another account is not moved");
});

test("the record is bounded, oldest first out", () => {
  for (let i = 0; i < 130; i += 1) paid.rememberPaid("u3", `job${i}`, [`line ${i}`]);
  assert.equal(paid.paidTranslation("u3", "job0"), undefined);
  assert.deepEqual(paid.paidTranslation("u3", "job129"), ["line 129"]);
});

test("unreadable storage is an empty record, not an error", () => {
  backing.set("opensubs.paid.u4", "{not json");
  paid.forgetAll();
  assert.equal(paid.paidTranslation("u4", "k"), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
