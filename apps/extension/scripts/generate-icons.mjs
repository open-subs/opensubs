// The extension's icons, rendered from the product's own SVG.
//
// Not copied from apps/web/public: those are favicons, sized 16/32/48/180
// and up, and a browser toolbar wants 16/48/128 exactly. Rendering from the
// one SVG keeps every surface on the same mark, so a change to the logo
// does not leave the extension showing last year's.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const svg = join(root, "..", "web", "public", "favicon.svg");
const out = join(root, "public", "icons");

if (!existsSync(svg)) {
  console.error(`generate-icons: ${svg} is missing`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });

// rsvg-convert if it is here, otherwise macOS's own renderer via sips on a
// PDF pass. Both are already on this machine; neither is a new dependency.
const has = (bin) => {
  try { execFileSync("which", [bin], { stdio: "ignore" }); return true; } catch { return false; }
};

for (const size of [16, 48, 128]) {
  const target = join(out, `icon${size}.png`);
  if (has("rsvg-convert")) {
    execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", target, svg]);
  } else if (has("qlmanage")) {
    // Quick Look renders SVG and writes a PNG beside the input; then sips
    // resizes. Clumsy, but it needs nothing installed.
    execFileSync("qlmanage", ["-t", "-s", String(size * 4), "-o", out, svg], { stdio: "ignore" });
    execFileSync("sips", ["-z", String(size), String(size), join(out, "favicon.svg.png"), "--out", target], { stdio: "ignore" });
  } else {
    console.error("generate-icons: install librsvg (brew install librsvg)");
    process.exit(1);
  }
  console.log(`icon${size}.png`);
}

// qlmanage leaves its full-size render behind; it is not an icon and would
// otherwise be copied into the package.
const litter = join(out, "favicon.svg.png");
if (existsSync(litter)) rmSync(litter);
