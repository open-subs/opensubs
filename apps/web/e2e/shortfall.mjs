// A model that answers with one line too few (APP-141).
//
// Reported on opensubs.app with an OpenAI key and the default gpt-4o-mini:
// the same nineteen-line file translated twice and failed once, and the
// failure threw the whole batch away -- every subtitle untranslated, one red
// line of "The model returned 18 lines for 19 subtitles.", and the API call
// already paid for.
//
// The provider here is a stub, because the real fault is not reproducible on
// demand: it is the model having an off day. The stub does exactly what the
// model did -- drops a line -- so the recovery can be tested at all.
//
//   node --experimental-strip-types e2e/shortfall.mjs
const { translateChunk, isMiscount } = await import("../src/lib/shortfall.ts");

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => { if (cond) pass += 1; else fails.push(`${name}${detail ? ` -- ${detail}` : ""}`); };

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`);

/**
 * Stand in for a provider. `short` decides which calls come back a line
 * short; `calls` records how many lines each call was asked for, which is
 * what says whether the fix asks again once or hammers the API.
 *
 * Two shapes of miscount, because providers differ: some return the wrong
 * number of lines, and some (the OpenAI reader, the engine) throw about it.
 */
function stub(short, { throws = false } = {}) {
  const calls = [];
  const batch = async (texts) => {
    calls.push(texts.length);
    const back = texts.map((t) => `<${t}>`);
    if (short(texts, calls.length)) {
      back.pop();
      if (throws) throw new Error(`The model returned ${back.length} lines for ${texts.length} subtitles.`);
    }
    return back;
  };
  return { batch, calls };
}

// --- the reported run: one short reply, then a good one ------------------
for (const throws of [false, true]) {
  const how = throws ? "thrown" : "returned";
  const { batch, calls } = stub((_, n) => n === 1, { throws });
  const out = await translateChunk(batch, lines(19), undefined);
  ok(`one short reply (${how}): every line is translated`, out.lines.every((l) => l.startsWith("<")), JSON.stringify(out.lines.slice(0, 2)));
  ok(`one short reply (${how}): nineteen back for nineteen sent`, out.lines.length === 19, String(out.lines.length));
  ok(`one short reply (${how}): asked again once, and only once`, calls.join() === "19,19", calls.join());
  ok(`one short reply (${how}): nothing reported missing`, out.missed === 0, String(out.missed));
}

// --- a model that keeps dropping the same line ---------------------------
//
// One line it will not translate, however often it is asked -- the shape a
// stubborn failure takes, rather than "every reply is short". The retry
// cannot save it, so the chunk is halved until that line is alone, and
// everything else still comes back translated.
{
  const { batch, calls } = stub((texts) => texts.includes("line 7"));
  const out = await translateChunk(batch, lines(19), undefined);
  const done = out.lines.filter((l) => l.startsWith("<")).length;
  ok("one stubborn line: the other eighteen are translated", done === 18, `${done} of 19`);
  ok("one stubborn line: nineteen lines come back", out.lines.length === 19);
  ok("one stubborn line: the one it would not do keeps its original text",
    out.lines[7] === "line 7", JSON.stringify(out.lines[7]));
  ok("one stubborn line: the count is reported", out.missed === 1, String(out.missed));
  // 19,19 then halves, each half retried once: bounded by the depth of the
  // split, not by the number of lines.
  ok("one stubborn line: bounded calls, not one per line", calls.length <= 20 && calls.length < 19, calls.join());
}

// --- a provider that counts correctly is untouched -----------------------
{
  const { batch, calls } = stub(() => false);
  const out = await translateChunk(batch, lines(19), undefined);
  ok("a good reply costs one call, as before", calls.join() === "19", calls.join());
  ok("a good reply reports no shortfall", out.missed === 0);
}

// --- an error that is not a miscount belongs to the caller ---------------
{
  let calls = 0;
  const batch = async () => { calls += 1; throw new Error("401 Unauthorized"); };
  let threw = null;
  await translateChunk(batch, lines(4), undefined).catch((e) => (threw = e));
  ok("an auth failure is raised, not retried", threw?.message === "401 Unauthorized" && calls === 1, `${threw} after ${calls}`);
}
{
  const controller = new AbortController();
  controller.abort();
  let threw = null;
  await translateChunk(async () => [], lines(4), controller.signal).catch((e) => (threw = e));
  ok("a cancelled run stops at once", threw?.name === "AbortError", String(threw));
}

// --- which errors count as a miscount ------------------------------------
ok("the OpenAI wording is recognised", isMiscount(new Error("The model returned 18 lines for 19 subtitles.")));
ok("the engine's own wording is recognised",
  isMiscount(new Error("translation returned 18 lines for 19 subtitles; refusing to guess which is which")));
ok("an auth failure is not", !isMiscount(new Error("401 Unauthorized")));
ok("a cancellation is not", !isMiscount(new DOMException("Cancelled", "AbortError")));

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
