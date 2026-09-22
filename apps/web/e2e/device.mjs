// Which GPU gets which default model (APP-111).
//
// The adapter descriptions are the shapes Chrome reports through WebGPU's
// GPUAdapterInfo, whose names come from Dawn. The first is the reporter's
// machine verbatim: i7-1360P, Intel Iris Xe, where WebGPU + Small was the
// slowest of the three combinations measured.
//
//   node --experimental-strip-types e2e/device.mjs
import { isIntegratedGpu, prefersSmallModel, describeGpu } from "../src/lib/device.ts";

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => { if (cond) pass += 1; else fails.push(`${name}${detail ? ` -- ${detail}` : ""}`); };

const cases = [
  // [label, adapter info, integrated?]
  ["Iris Xe, the reported machine", { vendor: "intel", architecture: "gen-12lp" }, true],
  ["UHD 620, a common older laptop", { vendor: "intel", architecture: "gen-9" }, true],
  ["Iris Plus, Ice Lake", { vendor: "intel", architecture: "gen-11" }, true],
  ["Meteor Lake Arc graphics (integrated)", { vendor: "intel", architecture: "xe-lpg" }, true],
  ["Lunar Lake Xe2 (integrated)", { vendor: "intel", architecture: "xe-2lpg" }, true],
  ["Intel with the architecture withheld", { vendor: "intel" }, true],
  ["Arc A770 (discrete)", { vendor: "intel", architecture: "gen-12hp" }, false],
  ["Arc B580 (discrete)", { vendor: "intel", architecture: "xe-2hpg" }, false],
  ["Apple M-series", { vendor: "apple", architecture: "metal-3" }, false],
  ["NVIDIA discrete", { vendor: "nvidia", architecture: "ampere" }, false],
  ["AMD, not measured -- left alone", { vendor: "amd", architecture: "rdna-2" }, false],
  ["Qualcomm, not measured -- left alone", { vendor: "qualcomm", architecture: "adreno-7xx" }, false],
  ["no info at all", undefined, false],
  ["vendor blank, description names Intel UHD", { vendor: "", description: "Intel(R) UHD Graphics 630" }, true],
  ["vendor blank, description names Intel Arc", { vendor: "", description: "Intel(R) Arc(TM) A750 Graphics" }, false],
];
for (const [label, info, want] of cases) {
  ok(`${label}: ${want ? "integrated" : "not integrated"}`, isIntegratedGpu(info) === want, JSON.stringify(info));
}

// The default the page ends up offering.
const small = (device, info) => prefersSmallModel({ device, integrated: isIntegratedGpu(info) });
ok("the reported machine is offered Base, not Small", small("webgpu", { vendor: "intel", architecture: "gen-12lp" }) === false);
ok("Apple silicon keeps Small, as before", small("webgpu", { vendor: "apple", architecture: "metal-3" }) === true);
ok("a discrete card keeps Small, as before", small("webgpu", { vendor: "nvidia", architecture: "ampere" }) === true);
ok("no WebGPU gets Base, as before", small("wasm", undefined) === false);
ok("choosing the CPU on a discrete card gets Base -- Small in full precision is ~1 GB",
  small("wasm", { vendor: "nvidia", architecture: "ampere" }) === false);

ok("the GPU is named for the one line that says so", describeGpu({ vendor: "intel", architecture: "gen-12lp" }) === "intel · gen-12lp");

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
