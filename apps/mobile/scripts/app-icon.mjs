// The iOS app icon, drawn from the product's own SVG.
//
// Run by hand (`npm run icon`), like the extension's generator, and commit
// the PNG. It exists because the Capacitor template ships *its* logo in
// AppIcon.appiconset and nothing ever complains: the app builds, installs and
// runs with somebody else's mark on the home screen, and the first place
// anyone notices is the App Store listing.
//
// Two rules make the App Store icon different from every other icon this
// product has, and both are Apple's rather than taste:
//
//   - **Square, not rounded.** iOS applies the mask itself, so shipping the
//     rounded artwork gets it rounded twice: a visibly smaller icon with pale
//     corners. The radius is dropped here rather than in a second SVG that
//     would drift from the first.
//   - **No alpha channel at all.** Not "opaque everywhere" -- no channel. An
//     icon with one is rejected during upload, after the archive, so it costs
//     a whole build to find out.
//
// That second rule is why this rasterises rather than calling a converter.
// `sips` cannot drop an alpha channel (a PNG -> BMP -> PNG round trip comes
// back with one), `qlmanage` always writes RGBA, and going through JPEG to
// flatten puts ringing on the one thing an icon is made of: hard edges. The
// mark is four rounded rectangles, which is pixel math, so the pixels are
// computed here and written straight out as 8-bit RGB.
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const svgPath = join(root, "..", "web", "public", "favicon.svg");
const out = join(root, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset");
const target = join(out, "AppIcon-512@2x.png");
const SIZE = 1024;
const SS = 4; // samples per pixel edge; 16 per pixel

if (!existsSync(svgPath)) {
  console.error(`app-icon: ${svgPath} is missing`);
  process.exit(1);
}
const svg = readFileSync(svgPath, "utf8");

const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
if (!viewBox || viewBox[1] !== viewBox[2]) {
  console.error("app-icon: expected a square viewBox starting at 0 0");
  process.exit(1);
}
const UNITS = Number(viewBox[1]);

/** Every <rect> in the mark, with the attributes that decide how it is drawn. */
const rects = [...svg.matchAll(/<rect\b([^>]*)\/>/g)].map(([, attrs]) => {
  const attr = (name) => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
    return m ? m[1] : null;
  };
  const num = (name, fallback = 0) => {
    const v = attr(name);
    return v === null ? fallback : Number(v);
  };
  return {
    x: num("x"), y: num("y"), w: num("width"), h: num("height"), r: num("rx"),
    fill: attr("fill"), stroke: attr("stroke"), strokeWidth: num("stroke-width"),
    opacity: num("opacity", 1),
  };
});
if (rects.length === 0) {
  console.error("app-icon: no <rect> elements found; this only knows how to draw those");
  process.exit(1);
}
// The first full-bleed rect is the background, and it is the one whose corner
// radius has to go. Found by size rather than by position in the file.
const background = rects.find((r) => r.w === UNITS && r.h === UNITS);
if (!background || !background.fill) {
  console.error("app-icon: no full-bleed background rect to sit the icon on");
  process.exit(1);
}
background.r = 0;

const rgb = (hex) => {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};

/** Is (px, py) inside a rounded rectangle, in SVG units? */
function insideRounded(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  if (r <= 0) return true;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Coverage of one rect at one sample point: fill, or the band of a stroke. */
function covers(rect, px, py) {
  if (rect.fill && rect.fill !== "none") {
    return insideRounded(px, py, rect.x, rect.y, rect.w, rect.h, rect.r);
  }
  if (!rect.stroke) return false;
  const half = rect.strokeWidth / 2;
  const outer = insideRounded(px, py, rect.x - half, rect.y - half,
    rect.w + rect.strokeWidth, rect.h + rect.strokeWidth, rect.r + half);
  const inner = insideRounded(px, py, rect.x + half, rect.y + half,
    rect.w - rect.strokeWidth, rect.h - rect.strokeWidth, Math.max(0, rect.r - half));
  return outer && !inner;
}

// --- draw ------------------------------------------------------------------

const scale = UNITS / (SIZE * SS);
const pixels = Buffer.alloc(SIZE * SIZE * 3);
for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const ux = (px * SS + sx + 0.5) * scale;
        const uy = (py * SS + sy + 0.5) * scale;
        // Painter's order, as the SVG declares it.
        let c = [0, 0, 0];
        for (const rect of rects) {
          if (!covers(rect, ux, uy)) continue;
          const paint = rgb(rect.fill && rect.fill !== "none" ? rect.fill : rect.stroke);
          const a = rect.opacity;
          c = [
            Math.round(c[0] * (1 - a) + paint[0] * a),
            Math.round(c[1] * (1 - a) + paint[1] * a),
            Math.round(c[2] * (1 - a) + paint[2] * a),
          ];
        }
        r += c[0]; g += c[1]; b += c[2];
      }
    }
    const n = SS * SS;
    const at = (py * SIZE + px) * 3;
    pixels[at] = Math.round(r / n);
    pixels[at + 1] = Math.round(g / n);
    pixels[at + 2] = Math.round(b / n);
  }
}

// --- write a PNG, 8-bit RGB, no alpha --------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 2;   // colour type 2 = truecolour, no alpha
// Every scanline gets filter 0. The image is flat colour and large runs, which
// deflate handles well on its own; per-line filter selection would save a few
// hundred KB on a file nobody downloads.
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 3 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 3 + 1) + 1, y * SIZE * 3, (y + 1) * SIZE * 3);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(out, { recursive: true });
writeFileSync(target, png);
console.log(`wrote ${target} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} KB, no alpha)`);
