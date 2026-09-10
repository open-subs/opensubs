# OpenSubs on iOS, iPadOS and Android

The mobile app is the web app in a native shell (Capacitor). That is a
decision, not a shortcut: the product *is* the pipeline in
`apps/web/src/lib` — audio decoding, Whisper, the hallucination clean-up —
and all of it is JavaScript and WebAssembly that WKWebView and Android's
WebView both run. A native rewrite would fork that logic three ways to
reach the same answers more slowly, and the clean-up rules in particular
took two rounds of field reports to get right.

## What was measured, and where

Everything below was run rather than assumed. The harness is a page that
loads `whisper-tiny.en`, transcribes a 12-second clip of real speech, and
reports what it got; on the simulator it reports through `console.log`,
which Capacitor bridges to the process stdout (`simctl launch --console-pty`).

| | iOS 17.0 Safari | iOS 26.5 Safari | iOS 26.5 WKWebView (this app) |
|---|---|---|---|
| WebGPU present | no | yes | yes |
| GPU adapter | — | none *(simulator)* | none *(simulator)* |
| SharedArrayBuffer | yes | yes | **no** |
| crossOriginIsolated | yes | yes | **no** |
| Model load | — | 2 s | 2 s |
| Transcription | **fails** | 7.9x realtime | 6.1x realtime |

### iOS 17 cannot run the engine at all

Not slowly — not at all. ONNX Runtime fails while building its execution
plan, before any inference:

```
Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE:
  onnxruntime/core/framework/allocation_planner.cc:237
  Could not find OrtValue with name '/layers.0/self_attn/Transpose_1_output_0'
```

So the app needs a minimum OS version. iOS 26 works and iOS 17 does not;
**the versions between them are untested here**, because only those two
simulator runtimes are installed. Test 18 through 25 before choosing the
floor — do not read this table as saying 18 fails.

### The app runs single-threaded, and that is the shell's doing

`crossOriginIsolated` is false inside the app and true in Safari. Capacitor
serves the bundle from `capacitor://localhost` and sends no COOP/COEP
headers, so `SharedArrayBuffer` is unavailable and ONNX Runtime falls back
to a single thread.

It costs about 20% (6.1x realtime against Safari's 7.9x) and nothing else —
the transcript is identical. Worth revisiting if transcription ever feels
slow on a real device: the fix is response headers from the shell's scheme
handler, not a change to any of this app's own code.

Both numbers are from a simulator with **no GPU adapter**, so both are the
CPU path. A real device has a GPU and should do better than either.

## Building it

```bash
cd apps/mobile
npm install
npm run sync          # builds apps/web, stages www/, and runs cap sync
npm run open:ios      # or open:android
```

`scripts/stage.mjs` is the part worth knowing about. The site and the app
are one bundle on the desktop — the tool in the hero of opensubs.app with
the marketing below it — so the staging step keeps the tool, drops the
marketing sections and the SEO markup, and rewrites the copy that is true
of a web page and false of an app ("in your browser", "your machine").

It **fails the build** if any of those phrases survive, rather than warning.
The failure it exists to prevent is quiet: an app whose first screenshot in
three stores says "runs in your browser".

One string is decided at runtime instead, in `App.svelte`: "Drop a video
here" becomes "Choose a video" when the pointer is coarse. That is a
property of the device rather than of the wrapper, so a tablet in a browser
gets it too.

## Android

The project is generated and committed, and has not been built here — this
machine has the Android command-line tools but no SDK installed
(`ANDROID_HOME` unset, no `adb`). `npm run open:android` and a first
Gradle sync will fetch what it needs.

Nothing in the measurements above transfers to Android: it is a different
WebView, a different ONNX build and a different GPU stack, and it needs its
own run of the same harness before any claim is made about it.
