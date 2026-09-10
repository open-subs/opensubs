# OpenSubs on the web

Subtitle authoring in the browser. Nothing is uploaded: the video is read
through an object URL and never leaves the machine, and there is no server,
no account and no build-time secret.

```
npm install
npm run build:wasm     # Rust -> wasm32, glue into src/wasm-gen/ (committed)
npm run dev            # http://localhost:5174
npm run build          # static site into dist/
npm run check          # svelte-check -- the only thing that typechecks .svelte
npm test               # headless-browser smoke test against dist/
```

## Trying it by hand

```
bash scripts/make-sample.sh    # writes testdata/fixtures/web-sample.{mp4,srt}
npm run dev
```

Open http://localhost:5174, drop `web-sample.mp4` on the page, then either
press **Generate from the audio** or open `web-sample.srt` under Subtitles. The audio is real speech and the cues are
written from its measured timings, so a cue appearing late is a real bug
rather than a bad fixture.

The clip is deliberately awkward: `testsrc2` is a busy, high-contrast
background (a flat colour makes every style look equally good), one line is
long enough to force a wrap, one contains an apostrophe the ASS writer has
to escape, and one is digits.

Worth checking while you are in there:

- **Style** — switch between `Clean` and `Boxed`, then `Neon` and `Podcast`.
  Podcast is top-anchored, so the subtitle should jump to the top of the
  frame. This is libass rendering, so what you see is what a burn produces.
- **Clip** — set Start to 3. The line under the fields should report the
  shortened length, and the `opensubs burn` command should grow a
  `--start 3.000`.
- **Resolution** — pick 480p. Subtitle size is a percentage of frame height,
  so the text should get *proportionally* smaller, not stay pinned.
- **Burn** — press *Burn subtitles into the video*. A 14-second clip takes
  about a second; the result is an MP4 you can save straight away.
- **Non-Latin text** — translate to Chinese, or open a Chinese `.srt`. If
  you see rectangles instead of characters, the script font did not load;
  that is the failure mode `e2e/smoke.mjs` guards against.
- **Export** — `.ass` is what the desktop burns; `.srt`/`.vtt` round-trip
  back into the app if you re-open them.

## What runs where

The engine is the same Rust the desktop app and the CLI run, compiled to
WebAssembly (`crates/subs-wasm`, 254 KB). Everything that decides how the
output looks lives there:

| In Rust (shared) | In the page |
|---|---|
| Reading `.srt` / `.vtt` | The video element and playback |
| Cue segmentation, line breaking, reading-speed caps | The cue editor |
| ASS generation, all 12 style presets | Style picking |
| Clip validation and export-size maths | Clip fields |
| The translation prompt, schema and rewrapping | The `fetch` to Claude |
| The free/premium catalogue | Rendering it |

Splitting it this way is the point: the browser cannot break a line
differently from the desktop, because neither of them decides how to break
a line — `subs-subtitle` does.

## The preview is real libass

Subtitles over the video are rendered by [JASSUB](https://github.com/ThaUnknown/jassub),
which is libass compiled to wasm — the same renderer ffmpeg's `ass` filter
uses when the desktop app burns a video. So outline widths, margins,
alignment and CJK shaping are what a burn will actually produce, not a CSS
lookalike.

One honest difference: nothing bundles the app's own fonts yet, so libass
falls back to JASSUB's single default face. A desktop burn resolves real
font names through fontconfig. Layout matches; letterforms may not.

## What costs what

The interface labels every capability with one of four badges, and the
vocabulary is the engine's (`subs_tier::Cost`) so it reads identically
everywhere:

| Badge | Means |
|---|---|
| **Free** | Runs on your machine. No key, no account, nothing uploaded. |
| **Free · or your key** | Works free on-device; a key buys better quality. |
| **Your own API key** | Calls a service with your key. You pay them directly; the key stays in the tab. |
| **Paid** | Runs on our backend. Free while testing. |

Today almost everything is **Free**: transcription, styles (both packs),
emphasis, trimming, burning and every export. Only translation can cost
anything, and only if you choose a cloud provider over the on-device one.

Cost is deliberately modelled apart from *tier*. Tier says where revenue
would come from one day; cost says what pressing the button costs you now.
They are different questions and conflating them left the UI unable to
answer either.

## Speech recognition, on this machine

**Generate from the audio** runs Whisper locally: ONNX weights driven by
transformers.js on WebGPU, falling back to WASM. Three models are offered,
40 MB to 250 MB, downloaded once and then cached by the browser. The audio
never leaves the machine — only the model is fetched, from the same
huggingface.co repository the desktop app already pulls its ggml weights
from.

The words come back as sentences, not words: the small quantised ONNX
exports are not built with the cross-attentions that word timestamps need,
and asking for them throws. Per-word timings are therefore synthesised from
each sentence's span, proportional to character count — which is exactly
what the desktop does, because ffmpeg's `af_whisper` has the same
limitation. That synthesis lives in Rust (`subs_asr::transcript_from_segments`)
and is shared, so the browser and the desktop derive identical words from
identical segments. Cue segmentation is then the same engine again.

### Cloud transcription

**Using → OpenAI-compatible API** posts the clip's audio to any Whisper
transcription endpoint (OpenAI, Groq, or a local server) with your own key.
A large hosted model is markedly better on accents, background noise and
proper nouns, which is exactly where the small local models earn
complaints.

The audio genuinely does leave the machine on that path — that is the
trade — and only the trimmed span is sent, so a 20-second clip from an
hour-long file uploads 20 seconds.

### "Can this be done without AI?"

Not usefully, and it is worth being straight about rather than shipping
something weak to tick a box. Every speech recogniser that works on real
audio is a statistical acoustic model; the pre-neural ones (Sphinx, Kaldi's
GMM-HMM) are still models, just older and markedly less accurate, and they
need per-domain grammars to be tolerable. There is no rule-based path from
a waveform to words.

The distinction that *does* matter to a user is **local versus cloud**, and
that is the one this app acts on: this runs on your machine, costs nothing,
needs no key, and uploads nothing.

## Word effects

Two of them, and the difference between them matters more than it looks:

| | Driven by | Needs audio | What you see |
|---|---|---|---|
| **Highlight each word as it is spoken** | the cue's timings | no | one word at a time grows and glows, travelling along the line |
| **Size every word by how loud it was** | measured loudness | yes | every word sized once; the line arrives fully formed |

The second one was built first and reported as broken three times. It was
working the whole time. The problem is that **nothing about it moves**: it
sets each word's size once for the cue's whole duration, so a viewer sees a
line with some big words and some small ones and reads it as "the styling is
a bit uneven", not as an effect. What people picture when they ask for words
that grow as they are said is the first row — a highlight travelling in time.
Shipping only the second was the actual mistake.

### Highlight each word as it is spoken

The line stays on screen throughout; the word being spoken grows and gains a
coloured halo. The halo is libass's `\blur` — a real gaussian blur of the
border, not a stack of outlines imitating one — over `\bord`, with the
colour picked in the UI.

ASS cannot animate a property per word inside one event, so each cue becomes
**one event per word**, each showing the whole line with a different word
active. The events tile the cue exactly, so the line never blinks off between
words.

It runs off cue timings alone, which has a pleasant consequence: it works on
an imported `.srt` too, and it is unaffected by translating or editing.
Chinese and Japanese have no spaces, so a CJK run is split per character —
otherwise a translated line would light up all at once and mean nothing.

Word times within a cue are shared out by character count, because no speech
backend here reports real ones. The highlight tracks the line's pace but can
sit a word out on a line mixing very short and very long words.

### Size every word by how loud it was

With subtitles this app transcribed, this
sizes each word by its own loudness: per-word RMS from the decoded audio,
normalised across the clip's own min-to-max range, emitted as `{\fs}`
overrides by the shared Rust ASS writer. It shows in the preview and burns
into the video.

Two honest limits, both stated in the UI:

- It needs the audio, so it is not offered for an imported `.srt`/`.vtt` —
  those words are not anchored to any moment in this clip.
- Word timings are **synthesised**, not measured (no backend here reports
  real ones), so emphasis lands on approximately the right word. Next to a
  long quiet word, a short emphatic one can land a word out.
- If a line's words stop matching the audio that was measured — you
  translated it, or edited a word in or out — that line is left plain
  rather than having the sizes slid onto the wrong words. The UI **says so**
  when it happens; it used to just quietly stop working with the box still
  ticked.

Normalising against the clip's range rather than against silence is what
makes it visible at all: speech occupies a narrow band of amplitudes, and
dividing by the peak alone left the quietest word still 17% larger than
base.

Changing a style or picking a word effect **seeks the preview onto a cue** if the
playhead is sitting where nothing is captioned. This is not a nicety: play a
short clip through and the playhead rests past the last cue, so the preview
is a bare frame and every subtitle setting you touch appears to do nothing.
The effect was reported as broken twice on that basis while the renderer was
producing it correctly. Picking the travelling highlight goes further and
**plays** the cue, because a time effect is invisible on a still frame — a
paused highlight is indistinguishable from a word that was simply sized
larger, which is the confusion that started all of this.

## Three routes, not a dropdown

Subtitles and translation each offer the same three bargains, and they are
laid out as three columns rather than hidden in a `<select>`:

| | Runs | Pays |
|---|---|---|
| **On this device** | here | nothing |
| **Your own API key** | a vendor you choose | them, directly |
| **OpenSubs** | our backend | us, in credits |

The dropdown made three unlike things look like three flavours of one, and
it put the price behind an interaction — the free option and the paid one
read identically until you opened the menu. As columns, cost is visible on
all three at once, which is the comparison a user is actually making.

The vendor choice (Claude, an OpenAI-compatible server, DeepL) lives *inside*
the key route, because which cloud you use is a detail of that bargain, not
a peer of the other two.

## Credits

Paid work is priced **before** you commit, and the figure on the button is
what gets charged. The price is quoted in credits **and dollars** — a
private currency alone tells nobody anything, and "26 credits" could be
pennies or a subscription.

**$5 buys 1,000 credits.** The rule behind that is one constant,
`subs_credits::COST_SHARE = 0.30`: price is vendor cost ÷ 0.30, a 70% gross
margin. Nothing else in the codebase encodes the markup.

The quote runs in the wasm engine rather than on a server, so the price
appears the moment you pick a language, with no round trip and no account
needed to see it. The estimate lives next to the prompt builder
(`subs_translate::pricing`) rather than in the browser, because the two
biggest cost drivers are invisible from outside: the 342-token system prompt
is re-sent with **every batch of 60 cues**, and JSON scaffolding is charged
per line. Counting cue characters in the browser would under-quote a long
clip by several batches' worth of prompt — and since we honour the quote,
that error is money.

Transcription is billed per second of the *trimmed* span, since that is all
that gets uploaded.

Everything account-shaped — balance, top-up, ledger — is mocked in
`localStorage` behind `VITE_CREDITS_API_URL`, and the interface says so in
plain words rather than imitating a checkout.

## Translation providers

| Provider | Key needed | Runs where |
|---|---|---|
| **On this device** | no | Chrome's built-in translation models, locally |
| OpenSubs | no | Our endpoint — only offered when `VITE_OPENSUBS_TRANSLATE_URL` is set |
| Claude | yours | Anthropic |
| OpenAI-compatible | yours | Any server speaking the OpenAI chat API — OpenAI, Groq, OpenRouter, DeepSeek, or **Ollama / LM Studio on this machine** |
| DeepL | yours | DeepL (has a free tier) |

Every provider does one job: N strings in, N strings out, in order. The
count check, the line rewrapping against the target script's budget, and
the guarantee that no timestamp moves all happen once, in Rust, shared with
the desktop. A provider can change what a subtitle says, never how it
breaks.

Two honest caveats. The on-device translator works string by string, so it
has none of the surrounding-dialogue context an LLM uses to get pronouns
and continuing sentences right — it is free and private, not best. And it
needs an explicit **source** language: its models are per language pair, and
Chrome's separate `LanguageDetector` model is absent on many machines, so
where detection is not genuinely available the app offers a visible
language choice instead of an "automatic" option that would always fail.

## Burning, in the browser

The page encodes the finished video itself — no upload, no CLI, no ffmpeg:

```
demux -> decode -> composite libass over the frame -> encode -> mux
                                   audio: copied, never re-encoded
```

[mediabunny](https://github.com/Vanilagy/mediabunny) demuxes and muxes,
WebCodecs decodes and encodes (hardware-backed on most machines), and libass
rasterises each subtitle frame. Output is MP4/H.264 where the browser can
encode it, WebM/VP9 otherwise. Roughly 8× faster than realtime on a laptop.

What survives, and what does not:

| | |
|---|---|
| Audio | Copied packet for packet. No `AudioDecoder` or `AudioEncoder` is constructed anywhere in `burn.ts`. |
| Subtitles | Real libass output, rasterised at the export resolution. |
| Frame timing | Output timestamps come from the source samples, so variable frame rate survives. |
| Colour metadata | **Lost.** The browser hands over a decoded frame, not the container's colour tags. |

That last row is the one honest reason to still reach for the CLI: it probes
the real file, so it gets colour, rotation and HDR right in ways a page
cannot see. The command is still offered under *Prefer to burn it on the
command line?* — it is the better tool for HDR footage or a long export, and
it is no longer the only way to finish the job.

## Testing

`npm test` drives the built site in headless Chromium: that the wasm engine
loads and answers, that a real `.srt` round-trips into cues, that libass
paints subtitle pixels over a real video, that a burn produces a file with
the subtitles actually in its pixels, that the generate-from-audio control
is offered and correctly gated, that several translation providers are
offered with the free local one first, and that the emitted CLI command
carries the choices made in the UI.

Real speech recognition is opt-in, because it downloads a ~40 MB model:

```
OPENSUBS_TEST_ASR=1 npm test
```

One of those checks is that a style change **shows itself on a paused
preview parked past the last cue** — the two ways a working subtitle setting
can look dead.
JASSUB draws on `requestVideoFrameCallback`, so a paused video presents no
frames and `setTrack` silently updates only the worker's copy — changing a
style or toggling emphasis looked like it did nothing until you pressed
play. `attachPreview` now forces a render on every track change and seek.

**The pixel checks are the important ones, and they are fussy on purpose.**
A misconfigured font makes libass emit zero bitmaps while throwing nothing:
the worker starts, the canvas attaches, the export completes, and the video
simply has no subtitles on it. Weak versions of these checks — asserting the
canvas exists, or diffing frames of an animating video, or screenshotting
with the video controls visible — all passed against a build that rendered
nothing at all. Hence: a static background, hidden controls, and a cue/gap
pair taken from the test's own SRT. If you touch them, break the font key in
`raster.ts` first and confirm they go red.

It generates its own WebM fixture with ffmpeg rather than using
`testdata/fixtures/sample-clip.mp4`: that clip is H.264, and Playwright's
bundled Chromium has no proprietary codecs, so it would report a zero-width
video forever and look exactly like an application bug. If ffmpeg is not
installed the video checks skip and say so.

Playwright is borrowed from `opendocscan/apps/web/node_modules` rather than
added as a dependency here.

## Deploying

`dist/` is static and uses relative URLs, so it works from a subdirectory,
a host root, or `file://`.

It totals ~27 MB on disk, but **the initial page load is ~1.2 MB**: the two
big assets are fetched only when the feature that needs them is used.

| Asset | Size | Fetched when |
|---|---|---|
| `ort-wasm-*.wasm` (ONNX Runtime) | 23.5 MB | you transcribe |
| `jassub-worker.wasm` (libass) | 2.0 MB | a video with cues is loaded |
| everything else | ~1.2 MB | on load |

Serve it with compression: the ONNX runtime gzips to 5.8 MB and libass to
836 KB.

One server-side gotcha, already documented for `openpdfedit`: nginx did not
learn the `application/wasm` MIME type until 1.21, and Ubuntu 22.04 ships
1.18. Without an explicit `types { application/wasm wasm; }` block the
browser refuses to stream-compile the module.
