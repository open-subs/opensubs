// Which GPU gets which default model (APP-111), and which browser starts on
// the CPU (APP-121).
//
// The adapter descriptions are the shapes Chrome reports through WebGPU's
// GPUAdapterInfo, whose names come from Dawn. The first is the reporter's
// machine verbatim: i7-1360P, Intel Iris Xe, where WebGPU + Small was the
// slowest of the three combinations measured.
//
//   node --experimental-strip-types e2e/device.mjs
import { isIntegratedGpu, prefersSmallModel, describeGpu, isAnonymousAdapter, isFirefox, startsOnCpu } from "../src/lib/device.ts";

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

// --- APP-121: Firefox, whose adapter says nothing -------------------------
//
// The user agents are real ones, and the adapter is what Firefox 154 gave
// on the reporter's Iris Xe: every field an empty string.
const UA = {
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) Gecko/20100101 Firefox/155.0",
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
};
const firefoxInfo = { vendor: "", architecture: "", device: "", description: "" };

ok("Firefox's empty adapter is anonymous", isAnonymousAdapter(firefoxInfo));
ok("an adapter that names itself is not", !isAnonymousAdapter({ vendor: "intel", architecture: "gen-12lp" }));
ok("whitespace is not a name", isAnonymousAdapter({ vendor: " ", architecture: "" }));
ok("Firefox is Firefox", isFirefox(UA.firefoxWin) && isFirefox(UA.firefoxMac));
ok("Chrome, Edge and Safari are not", !isFirefox(UA.chromeWin) && !isFirefox(UA.edgeWin) && !isFirefox(UA.safariMac));

ok("the reporter's Firefox starts on the CPU", startsOnCpu({ info: firefoxInfo, userAgent: UA.firefoxWin }));
ok("so does Firefox with no info object at all", startsOnCpu({ info: undefined, userAgent: UA.firefoxWin }));
ok("Chrome on the same machine does not -- it names the GPU, and APP-111 already handles it",
  !startsOnCpu({ info: { vendor: "intel", architecture: "gen-12lp" }, userAgent: UA.chromeWin }));
ok("Chrome with an anonymous adapter is left alone -- not measured",
  !startsOnCpu({ info: firefoxInfo, userAgent: UA.chromeWin }));
ok("Safari is left alone -- Apple silicon's GPU was measured to pay off",
  !startsOnCpu({ info: firefoxInfo, userAgent: UA.safariMac }));
ok("a Firefox that does name its GPU is judged like any other",
  !startsOnCpu({ info: { vendor: "nvidia", architecture: "ampere" }, userAgent: UA.firefoxWin }));
ok("and on the CPU the default is Base", small("wasm", firefoxInfo) === false);

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
