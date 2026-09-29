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

const CATALOGUES = { "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko, de, es, pt };

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
//    to the user; an invented one renders nothing at all.
for (const [code, table] of Object.entries(CATALOGUES)) {
  const broken = [];
  for (const [k, v] of Object.entries(table)) {
    const want = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const got = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    if (want !== got) broken.push(`${k} (${want || "none"} -> ${got || "none"})`);
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
  }
  const absent = [...asked].filter((k) => !(k in zhHans));
  ok("every t() string in the source is catalogued", absent.length === 0,
    `${absent.length}: ${absent.slice(0, 3).join(" | ")}`);
  if (process.env.LIST_MISSING) console.log(JSON.stringify(absent, null, 1));
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
