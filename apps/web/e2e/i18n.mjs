// The three checks a translation needs that a browser cannot make.
//
// A missing entry is invisible at runtime *by design* -- t() falls back to
// the English it was written in, which keeps the product usable. These
// stop that fallback hiding a gap for a release or two.
//
//   node --experimental-strip-types e2e/i18n.mjs
import fs from "node:fs";
import path from "node:path";
import { LOCALES } from "../src/lib/i18n/locales.ts";
import zhHans from "../src/lib/i18n/zh-Hans.ts";
import zhHant from "../src/lib/i18n/zh-Hant.ts";
import ja from "../src/lib/i18n/ja.ts";
import ko from "../src/lib/i18n/ko.ts";
import de from "../src/lib/i18n/de.ts";
import es from "../src/lib/i18n/es.ts";
import pt from "../src/lib/i18n/pt.ts";
import ru from "../src/lib/i18n/ru.ts";

const CATALOGUES = { "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko, de, es, pt, ru };

/**
 * Values that are legitimately the same as their English source.
 *
 * Allowlisted one by one rather than by loosening the check, because the
 * check's whole job is to catch a copy-paste that never got translated --
 * and every exception here is a proper noun or an identifier that would
 * be wrong to translate.
 */
const SAME_ON_PURPOSE = new Set([
  "Base",             // a Whisper checkpoint name, in all seven
  "Small",            // ditto
  "Unicode (UTF-8)",  // an encoding identifier
  "Devanagari",       // the script's name is spelled this way in de and es
  "Video",            // German
  "Start",            // German
  "Export",           // German
  "Engine",           // German, in this sense
  "Server",           // German
]);

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};

// 1. Every declared locale has a catalogue. Without this a language sits
//    in the picker and silently does nothing.
for (const { code } of LOCALES) {
  if (code === "en") continue;
  ok(`${code} has a catalogue`, !!CATALOGUES[code]);
}
ok(
  "no catalogue exists for a locale that is not offered",
  Object.keys(CATALOGUES).every((c) => LOCALES.some((l) => l.code === c)),
  Object.keys(CATALOGUES).filter((c) => !LOCALES.some((l) => l.code === c)).join(", "),
);

// 2. Every catalogue covers the same keys.
const reference = Object.keys(zhHans);
ok("the reference catalogue is not empty", reference.length > 0);
for (const [code, table] of Object.entries(CATALOGUES)) {
  const keys = Object.keys(table);
  const missing = reference.filter((k) => !(k in table));
  const extra = keys.filter((k) => !reference.includes(k));
  ok(`${code} covers every key`, missing.length === 0, `missing ${missing.length}: ${missing.slice(0, 3).join(" | ")}`);
  ok(`${code} has no key the others lack`, extra.length === 0, `extra: ${extra.slice(0, 3).join(" | ")}`);
}

// 3. No value is its own English source -- the copy-paste that never got
//    translated. It found two real gaps the first time this ran.
for (const [code, table] of Object.entries(CATALOGUES)) {
  const same = Object.entries(table)
    .filter(([k, v]) => v === k && !SAME_ON_PURPOSE.has(k))
    .map(([k]) => k);
  ok(`${code} translates every key`, same.length === 0, `untranslated: ${same.slice(0, 5).join(" | ")}`);
}

// 4. Placeholders survive translation. A dropped {name} renders the brace
//    to the user; an invented one renders nothing at all. A value with
//    plural forms ("a|b|c") is checked form by form: each is shown alone.
for (const [code, table] of Object.entries(CATALOGUES)) {
  const broken = [];
  for (const [k, v] of Object.entries(table)) {
    const want = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const form of v.split("|")) {
      const got = [...form.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      if (want !== got) broken.push(`${k} (${want || "none"} -> ${got || "none"})`);
    }
  }
  ok(`${code} keeps every placeholder`, broken.length === 0, broken.slice(0, 3).join(" | "));
}

// 5. The two Chinese catalogues are actually different. Running a
//    character converter over Simplified produces text that reads as
//    machine output in Taipei; if they were converted rather than
//    translated, most values would be near-identical in length and
//    structure. A blunt but effective smell test: they must differ on a
//    good share of entries.
{
  const differing = reference.filter((k) => zhHans[k] !== zhHant[k]).length;
  ok(
    "zh-Hant is translated separately from zh-Hans",
    differing / reference.length > 0.5,
    `${differing}/${reference.length} entries differ`,
  );
}

// 6. Every string the source asks to translate has an entry. Checks 2-5
//    only compare the catalogues with each other, so a sentence wrapped in
//    t() and never added to any of them passed all of them and shipped in
//    English -- which is how the whole editing panel did.
{
  const root = new URL("../src/", import.meta.url).pathname;
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (!["i18n", "wasm-gen", "assets", "styles"].includes(name)) walk(p);
      } else if (/\.(svelte|ts)$/.test(name)) files.push(p);
    }
  })(root);
  const asked = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      asked.add(JSON.parse(`"${m[1]}"`));
    }
    // t(cond ? "a" : "b") -- both arms are keys.
    for (const m of src.matchAll(/\bt\(\s*[^"()]+?\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      asked.add(JSON.parse(`"${m[1]}"`));
      asked.add(JSON.parse(`"${m[2]}"`));
    }
    // An error raised as `new Say("…")` (or a Say subclass's super("…")) is
    // shown through t() at the one place errors are displayed, so its text
    // is a key too. It must be one literal: a key glued together with `+`
    // cannot be checked here, and would reach the screen in English.
    if (/\bSay\b/.test(src)) {
      for (const m of src.matchAll(/\b(?:new Say|super)\(\s*"((?:[^"\\]|\\.)*)"(\s*\+)?/g)) {
        if (m[2]) fails.push(`a Say key is built with + in ${path.basename(f)}: ${m[1].slice(0, 40)}`);
        asked.add(JSON.parse(`"${m[1]}"`));
      }
    }
    // The list's edits refuse with `fail("…")`, and the list shows the
    // reason through t() -- so those are keys too.
    if (path.basename(f) === "cueedit.ts") {
      for (const m of src.matchAll(/\bfail\(\s*"((?:[^"\\]|\\.)*)"/g)) asked.add(JSON.parse(`"${m[1]}"`));
    }
  }
  // Text that reaches t() through a variable rather than a literal: progress
  // notes, the device translator's status, and the panel's empty states.
  for (const k of [
    "Translating",
    "Translating on this device",
    "Downloading the language model",
    "Chrome will download a small language model the first time.",
    "This browser has no built-in translator. Chrome 138+ does; otherwise pick a provider below.",
    "Your browser cannot translate between these two languages.",
    "Add subtitles to see the price",
    "Pick a language to see the price",
    "Load a video to see the price",
    // The translate route cards (RoutePicker renders t(route.note)).
    "Literal, one sentence at a time · Nothing is uploaded",
    "Choose your model · The provider bills you",
    "Ready to publish · Reads the whole clip for context · Natural wording",
    "You pay the provider",
  ]) asked.add(k);
  const absent = [...asked].filter((k) => !(k in zhHans));
  ok("every t() string in the source is catalogued", absent.length === 0,
    `${absent.length}: ${absent.slice(0, 3).join(" | ")}`);
  if (process.env.LIST_MISSING) console.log(JSON.stringify(absent, null, 1));
}

// 7. "Save" is keeping a file, never economising. "Saves" (the export's
//    "Saves sample.subbed.mp4 -- ...") went out as 節省 / 节省 / 削減 / 절감 /
//    Spart / Ahorra / Economiza in all seven: the money sense of the word.
{
  const thrift = /节省|節省|节约|節約|削減|절감|절약|\bspar(t|en|e)?\b|ahorr|econom/i;
  for (const [code, table] of Object.entries(CATALOGUES)) {
    const wrong = Object.entries(table)
      .filter(([k, v]) => /\b(save|saves|saved|saving)\b/i.test(k) && thrift.test(v))
      .map(([k, v]) => `${k} = ${v}`);
    ok(`${code} says "save" as storing a file, not saving money`, wrong.length === 0, wrong.slice(0, 3).join(" | "));
  }
}

// 8. Plural forms. Russian has three ("1 кредит", "3 кредита", "5 кредитов",
//    and 21 goes with 1); a "|" value must hold exactly that many, and only
//    a catalogue whose language needs them may use one. Then the forms are
//    picked the way t() picks them (plural.ts).
{
  const FORMS = { ru: 3 };
  for (const [code, table] of Object.entries(CATALOGUES)) {
    const wrong = Object.entries(table)
      .filter(([, v]) => v.includes("|") && v.split("|").length !== (FORMS[code] ?? 1))
      .map(([k]) => k);
    ok(`${code} uses plural forms only as its language needs`, wrong.length === 0, wrong.slice(0, 3).join(" | "));
  }
  // Every English key that comes in a singular/plural pair is a count, so
  // Russian must decline it (or be phrased to need no declension).
  const counted = reference.filter((k) => /\{n\}/.test(k) || k === "credit" || k === "credits");
  const flat = counted.filter((k) => !ru[k].includes("|"));
  ok("ru declines every {n} count", flat.length === 0, flat.slice(0, 3).join(" | "));

  const { pluralForm } = await import("../src/lib/i18n/plural.ts");
  const credits = (n) => pluralForm(ru[n === 1 ? "{n} credit" : "{n} credits"], "ru", { n }).replaceAll("{n}", String(n));
  const said = [1, 2, 5, 11, 21, 22, 25, 1000].map(credits);
  ok("ru picks one / few / many by the count", JSON.stringify(said) === JSON.stringify([
    "1 кредит", "2 кредита", "5 кредитов", "11 кредитов", "21 кредит", "22 кредита", "25 кредитов", "1000 кредитов",
  ]), said.join(", "));
  ok("ru declines a bare noun by n", pluralForm(ru["credits"], "ru", { n: 3 }) === "кредита", pluralForm(ru["credits"], "ru", { n: 3 }));
  ok("ru takes a fraction's form from few", pluralForm(ru["credits"], "ru", { n: 1.5 }) === "кредита");
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
