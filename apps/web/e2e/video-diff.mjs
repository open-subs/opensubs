// Two runs of e2e/videos.mjs, side by side.
//
//   node e2e/video-diff.mjs before after

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const [a, b] = process.argv.slice(2);
const load = async (label) =>
  JSON.parse(await readFile(join(HERE, "video-results", label, "report.json"), "utf8"));
const before = await load(a);
const after = await load(b);

const ROWS = [
  ["cues", (r) => r.cues],
  ["seconds captioned", (r) => Math.round(r.covered)],
  ["cues after the sound ends", (r) => r.past.length],
  ["stock sign-offs", (r) => r.signOffs.length],
  ["repeated-word loops", (r) => r.stutters.length],
  ["lines repeating the one before", (r) => r.repeats.length],
  ["Traditional characters", (r) => r.traditional],
  ["script changes between cues", (r) => r.switches],
  ["scripts written", (r) => Object.keys(r.scripts).sort().join("+") || "none"],
];

for (const name of Object.keys(before)) {
  if (!after[name]) continue;
  console.log(`\n${name}`);
  const width = Math.max(...ROWS.map(([title]) => title.length));
  for (const [title, read] of ROWS) {
    const was = read(before[name]);
    const now = read(after[name]);
    const mark = String(was) === String(now) ? " " : "*";
    console.log(`  ${mark} ${title.padEnd(width)}  ${String(was).padStart(8)} -> ${String(now).padStart(8)}`);
  }
  const gone = before[name].past.filter((line) => !after[name].past.includes(line));
  if (gone.length > 0) {
    console.log("    no longer written over the silence:");
    for (const line of gone.slice(0, 10)) console.log(`      ${line}`);
  }
  const added = after[name].past.filter((line) => !before[name].past.includes(line));
  if (added.length > 0) {
    console.log("    NEW after the sound ends:");
    for (const line of added) console.log(`      ${line}`);
  }
}
