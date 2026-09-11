// What the bring-your-own-key route tells the user when it cannot work.
//
// Every error body below is the one quoted in the report, verbatim. That
// matters more than usual here: the bug was not that the app failed, it
// was that it showed the service's raw JSON, truncated mid-key, to
// somebody who cannot be expected to read it (APP-70). A test written
// against a tidy invented payload would pass while the real one still
// produced a wall of braces.
//
// The two guards are checked as well, because the point of them is that
// neither failure costs a decode first: a fourteen-minute video takes
// over a minute to decode, and both of these were previously discovered
// by the service after that minute had been spent.
//
//   node --experimental-strip-types e2e/remote.mjs

import assert from "node:assert/strict";

import {
  REMOTE_MODELS,
  hasKnownUploadLimit,
  lacksTimestamps,
  remoteError,
  remoteUploadSeconds,
} from "../src/lib/remote.ts";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${error.message.split("\n").join("\n      ")}`);
  }
}

// The body OpenAI returned for `model=gpt-4o-transcribe`, as quoted.
const BODY_400 = JSON.stringify({
  error: {
    message:
      "response_format 'verbose_json' is not compatible with model " +
      "'gpt-4o-transcribe-api-ev3'. Use 'json' or 'text' instead.",
    type: "invalid_request_error",
    param: "response_format",
    code: "unsupported_value",
  },
});

// The body returned for a fourteen-minute video, as quoted.
const BODY_413 = JSON.stringify({
  error: {
    message: "413: Maximum content size limit (26214400) exceeded (26344371 bytes read)",
    type: "server_error",
  },
});

// --- APP-71: which models can produce subtitles at all ------------------

test("the three reported models are known to have no timings", () => {
  for (const model of ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "gpt-transcribe"]) {
    assert.equal(lacksTimestamps(model), true, model);
  }
});

test("and so is the suffixed name the service reports back", () => {
  // The field was typed as gpt-4o-transcribe; the 400 names this.
  assert.equal(lacksTimestamps("gpt-4o-transcribe-api-ev3"), true);
});

test("every suggested model is one that does have timings", () => {
  for (const { id } of REMOTE_MODELS) assert.equal(lacksTimestamps(id), false, id);
});

test("whisper-1 is the first suggestion, being the default", () => {
  assert.equal(REMOTE_MODELS[0].id, "whisper-1");
});

test("a model nobody has heard of is not condemned", () => {
  // The route promises "any server of your own". An unknown name is the
  // normal case for a self-hosted endpoint, not a mistake.
  for (const model of ["my-own-whisper", "faster-whisper-large-v3", ""]) {
    assert.equal(lacksTimestamps(model), false, model);
  }
});

// --- APP-70: the length guard -------------------------------------------

test("the length limit matches the bytes the service actually counted", () => {
  // 26,214,400 bytes at 16 kHz mono 16-bit. The report's own numbers.
  const limit = remoteUploadSeconds();
  assert.equal(limit, Math.floor((25 * 1024 * 1024 - 44) / 32000));
  assert.ok(limit > 13 * 60 && limit < 14 * 60, `${limit}s is not about 13 and a half minutes`);
});

test("a 14-minute clip is over it, a 13-minute clip is not", () => {
  assert.ok(14 * 60 > remoteUploadSeconds(), "the reported failure must be caught");
  assert.ok(13 * 60 < remoteUploadSeconds(), "a clip that works must not be refused");
});

test("the limit is only claimed for the service known to enforce it", () => {
  assert.equal(hasKnownUploadLimit("https://api.openai.com/v1"), true);
  // Groq and a server of your own have their own rules, and guessing at
  // them would refuse work that would have succeeded.
  assert.equal(hasKnownUploadLimit("https://api.groq.com/openai/v1"), false);
  assert.equal(hasKnownUploadLimit("http://localhost:8000/v1"), false);
  assert.equal(hasKnownUploadLimit("not a url"), false);
});

// --- APP-70: what the user is shown -------------------------------------

const raw = (e) => e.message;

test("the 400 says the model cannot do it, and names what can", () => {
  const message = raw(remoteError(400, BODY_400, "gpt-4o-transcribe"));
  assert.match(message, /gpt-4o-transcribe/);
  assert.match(message, /whisper-1/);
  assert.doesNotMatch(message, /verbose_json|response_format|\{|\}|"error"/);
});

test("the 413 says the clip is too long, and how long is allowed", () => {
  const message = raw(remoteError(413, BODY_413, "whisper-1"));
  assert.match(message, /too long/i);
  assert.match(message, /13 minutes/);
  assert.doesNotMatch(message, /26214400|\{|\}|bytes read/);
});

test("no mapped message carries any of the JSON it came from", () => {
  for (const [status, body] of [[400, BODY_400], [413, BODY_413]]) {
    const message = raw(remoteError(status, body, "whisper-1"));
    assert.doesNotMatch(message, /[{}"]/, `${status} leaked punctuation from the body`);
  }
});

test("an unmapped failure quotes the service's sentence, not its JSON", () => {
  const body = JSON.stringify({ error: { message: "Quota exceeded for this organisation." } });
  const message = raw(remoteError(402, body, "whisper-1"));
  assert.match(message, /Quota exceeded for this organisation\./);
  assert.doesNotMatch(message, /[{}]/);
});

test("a body that is not JSON at all is not shown", () => {
  // A proxy's HTML error page. Truncating it to 200 characters was the
  // old behaviour and produced half an opening tag.
  const message = raw(remoteError(502, "<!doctype html><html><head><title>502", "whisper-1"));
  assert.doesNotMatch(message, /doctype|<html/);
  assert.match(message, /502/);
});

test("a rejected key still reads as a rejected key", () => {
  for (const status of [401, 403]) {
    assert.match(raw(remoteError(status, "{}", "whisper-1")), /rejected the key/);
  }
});

test("a size complaint is caught by its wording even without a 413", () => {
  // Some gateways answer 400 for this. The sentence is the same.
  const body = JSON.stringify({ error: { message: "Maximum content size limit exceeded" } });
  assert.match(raw(remoteError(400, body, "whisper-1")), /too long/i);
});

test("a missing model is told apart from a model that cannot do timings", () => {
  const body = JSON.stringify({ error: { message: "The model `whisper-2` does not exist" } });
  const message = raw(remoteError(404, body, "whisper-2"));
  assert.match(message, /no model called/);
  assert.match(message, /whisper-2/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
