// Assemble a loadable extension directory out of the Vite output.
//
// Vite emits the JavaScript. Everything a manifest names besides scripts --
// the manifest itself, icons, locales, the ONNX runtime, the popup's HTML
// and CSS, the offscreen document -- is copied here, and the *right*
// manifest is chosen by the argument: Chromium and Firefox disagree about
// how a background script is declared, and shipping either one to the other
// store is an instant rejection.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2] === "firefox" ? "firefox" : "chrome";
const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const out = join(root, target === "firefox" ? "dist-firefox" : "dist");

if (!existsSync(out)) {
  console.error(`copy-static: ${out} does not exist -- run vite build first`);
  process.exit(1);
}

const manifestName = target === "firefox" ? "manifest.firefox.json" : "manifest.json";
const manifest = JSON.parse(readFileSync(join(root, "public", manifestName), "utf8"));

// One version number, taken from package.json, so a release cannot ship a
// manifest that disagrees with the tag it was built from.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
manifest.version = pkg.version;

writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const dir of ["icons", "_locales", "ort"]) {
  const from = join(root, "public", dir);
  if (existsSync(from)) cpSync(from, join(out, dir), { recursive: true });
}

mkdirSync(out, { recursive: true });
copyFileSync(join(root, "src", "popup", "popup.html"), join(out, "popup.html"));
copyFileSync(join(root, "src", "popup", "popup.css"), join(out, "popup.css"));
copyFileSync(join(root, "src", "engine", "engine.html"), join(out, "engine.html"));

// The popup's HTML is written for the source tree, where the script sits
// beside it in src/popup/. In the bundle everything is flat.
const popup = join(out, "popup.html");
writeFileSync(popup, readFileSync(popup, "utf8").replace(/\.\/popup\.(js|css)/g, "popup.$1"));
const engine = join(out, "engine.html");
writeFileSync(engine, readFileSync(engine, "utf8").replace("./offscreen.js", "offscreen.js"));

// Every path a manifest names, checked to exist.
//
// Without this the build is happy to emit an extension with no icons in
// it, and the only symptom is Chrome refusing to install it with "Could
// not load icon 'icons/icon16.png'" -- at load time, in a browser, long
// after the build said it succeeded. It happened once; the icons were
// generated after the copy and the copy did not care.
const named = new Set();
const walk = (node) => {
  if (typeof node === "string") {
    if (/\.(png|html|js|css|json)$/.test(node) && !node.includes("://")) named.add(node);
    return;
  }
  if (Array.isArray(node)) return node.forEach(walk);
  if (node && typeof node === "object") return Object.values(node).forEach(walk);
};
walk(manifest);
// The locale machinery is named by folder, not by file.
if (manifest.default_locale) named.add(`_locales/${manifest.default_locale}/messages.json`);

const missing = [...named].filter((f) => !existsSync(join(out, f)));
if (missing.length) {
  console.error(`copy-static: the manifest names files that are not in the build:`);
  for (const f of missing) console.error(`  ${f}`);
  process.exit(1);
}

// content.js is injected with `scripting.executeScript`, which runs a file as
// a classic script. A top-level `import` or `export` there is a syntax error
// that rejects the whole file before a line of it runs -- and the extension
// still says "Listening", because nothing downstream can tell. 1.0.1 shipped
// exactly that (APP-109). Refuse the build instead.
const content = join(out, "content.js");
if (!existsSync(content)) {
  console.error("copy-static: content.js is missing -- is vite.content.config.ts in the build script?");
  process.exit(1);
}
const source = readFileSync(content, "utf8");
if (/^\s*(import|export)[\s{*]/m.test(source) || /(^|[;}])\s*import\s*[{*\w]/.test(source.slice(0, 400))) {
  console.error("copy-static: content.js is an ES module, and executeScript can only inject a classic script.");
  console.error(`  it opens with: ${source.slice(0, 80)}`);
  process.exit(1);
}

console.log(`copy-static: ${target} -> ${out} (${named.size} named files present, content.js is a classic script)`);
