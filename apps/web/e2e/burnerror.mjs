// What a failed burn is counted as: its category and the error's type name,
// for the errors the burn really meets. No browser.
//
//   node --experimental-strip-types e2e/burnerror.mjs
import { burnStage, errorName, errorType, failureCode } from "../src/lib/burnerror.ts";

let pass = 0;
const fails = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else fails.push(`${name} -- got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const err = (name, message) => Object.assign(new Error(message), { name });
const dom = (name, message) => new DOMException(message, name);

// Measured in Chromium: what reading a picked file that has since gone throws.
const cases = [
  ["the demuxer's bad-format error, on its own (burn.ts re-reads the file first)", err("UnsupportedInputFormatError", "Input has an unsupported or unrecognizable format."), "unsupported-format", "UnsupportedInputFormatError"],
  ["a file changed after it was picked: the read stream breaks", new TypeError("network error"), "file-read", "TypeError"],
  ["the browser refuses the read", dom("NotReadableError", "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired."), "file-read", "NotReadableError"],
  ["the file is not there", dom("NotFoundError", "A requested file or directory could not be found at the time an operation was processed."), "file-read", "NotFoundError"],
  ["a burn the burn itself recognised", Object.assign(new Error("OpenSubs can no longer read this video."), { name: "Say", category: "file-read", ename: "NotReadableError" }), "file-read", "NotReadableError"],
  ["a codec this browser cannot decode", Object.assign(new Error("x"), { name: "Say", category: "codec-unsupported", ename: "NotSupportedError" }), "codec-unsupported", "NotSupportedError"],
  ["mediabunny on an undecodable track", new Error("This video track cannot be decoded in this environment. Make sure to check decodability before."), "codec-unsupported", "Error"],
  ["a font or the renderer's worker could not be fetched", new TypeError("Failed to fetch"), "network", "TypeError"],
  ["Firefox's fetch failure", new TypeError("NetworkError when attempting to fetch resource."), "network", "TypeError"],
  ["Safari's fetch failure", new TypeError("Load failed"), "network", "TypeError"],
  ["storage full", dom("QuotaExceededError", "The quota has been exceeded."), "quota", "QuotaExceededError"],
  ["out of memory", new RangeError("Array buffer allocation failed"), "memory", "RangeError"],
  ["cancelled", dom("AbortError", "Export cancelled"), "cancelled", "AbortError"],
  ["no video track", new Error("That file has no video track."), "no-video-track", "Error"],
  ["the encoder refuses a frame", dom("EncodingError", "The encoder could not take this frame"), "encode", "EncodingError"],
  ["no encoder for the size", new Error("This browser cannot encode video at 7680x4320."), "unsupported", "Error"],
  ["the renderer's canvas went away", new Error("Cannot set width of detached OffscreenCanvas"), "renderer", "Error"],
  ["something unknown", new Error("weird"), "other", "Error"],
  ["a thrown string", "boom", "other", "Error"],
];
for (const [name, e, category, ename] of cases) {
  eq(`${name}: category`, errorType(e), category);
  eq(`${name}: name`, errorName(e), ename);
}

// Never the message; never anything but letters in the name.
eq("a name with odd characters is reduced to letters", errorName({ name: "Bad Name/with:stuff 42" }), "BadNamewithstuff");
eq("a long name is cut", errorName({ name: "A".repeat(80) }).length, 32);
eq("an invented category is not trusted", errorType({ category: "Sneaky Value!", message: "weird" }), "other");
eq("the support code", failureCode("Reading the video", new TypeError("network error")), "burn:read:file-read:TypeError");
eq("the support code has no message", /network error/.test(failureCode("Reading the video", new Error("my holiday.mp4 failed"))), false);
eq("stages", ["Reading the video", "Copying audio", "Burning 4%", "Finishing the file", null].map(burnStage), ["read", "audio", "render", "finish", "prepare"]);

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
