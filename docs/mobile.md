# OpenSubs on iOS, iPadOS and Android

The mobile app is the web app in a native shell (Capacitor). That is a
decision, not a shortcut: the product *is* the pipeline in
`apps/web/src/lib` — audio decoding, Whisper, the hallucination clean-up —
and all of it is JavaScript and WebAssembly that WKWebView and Android's
WebView both run. A native rewrite would fork that logic three ways to
reach the same answers more slowly, and the clean-up rules in particular
took two rounds of field reports to get right.

## What was measured, and where

Everything below was run rather than assumed, by `apps/web/e2e/enginecheck`:
a page that imports the app's own `transcribeLocally`, transcribes
`public/testmedia/en.wav` (104 seconds of real speech) and **POSTs** what it
got back to the server that built it. It reports by fetch rather than
`console.log` because the interesting runs happen in a simulator's Safari,
where there is no console to read, and a result that has to be retyped from
a screenshot is a result nobody re-runs.

```bash
cd apps/web && npm run test:engine        # builds, serves, prints each report
xcrun simctl boot <udid> && xcrun simctl openurl <udid> http://localhost:5180/
```

| iOS (Safari `Version/`) | Engine | Notes |
|---|---|---|
| 17.0 | **fails** | `Can't create a session. ERROR_CODE: 1` |
| 26.0 | works | the floor this app ships with |
| 26.5 | works | |
| 27.0 | works | |

Speed is deliberately not in that table. The four runs above were taken
with four simulators booted at once on one laptop, so their throughput
numbers say more about the laptop than about iOS. The figures worth having
are from one machine at a time:

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

### The floor is 26.0, and it is a measurement

`IPHONEOS_DEPLOYMENT_TARGET` and the Podfile's `IOS_MIN` both say 26.0.

Not because iOS 18 was tested and failed — because **it cannot be tested
here**. Xcode 27 offers no iOS 18 simulator runtime at all:

```
$ xcodebuild -downloadPlatform iOS -buildVersion 18.5
iOS 18.5 is not available for download.        # and 18, 18.0, 18.1, 18.3, 18.6
$ xcodebuild -downloadPlatform iOS -buildVersion 26.0
Downloading iOS 26.0 Simulator (23A343) (arm64): Done.
```

So 26.0 is the lowest version this toolchain can run the engine on, and
therefore the lowest floor anyone here can stand behind. There is no
version of iOS between 18 and 26: Apple renumbered, so the untested band is
26 minus 18 in name only — it is iOS 18.x and nothing else.

The cost is real and it is a deliberate trade. An app that refuses to
install on iOS 18 reaches fewer phones; an app that installs and cannot
transcribe is a guideline 2.1 rejection and a one-star review, and the
reviewer will not catch it because Apple reviews on the current OS. Given a
choice between "fewer users" and "an unknown number of users with a broken
app", this picks the one that is not a surprise.

**Lowering it is one run away.** Point `e2e/enginecheck` at an iOS 18
device or at a machine with an Xcode that still ships the runtime. If it
passes, move both numbers down and re-run `pod install`.

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

`scripts/stage.mjs` is the part worth knowing about. It copies the built
app, drops the two SEO pages and the 19 MB of test clips, and refuses to
stage a directory missing the bundle, the ONNX files or the VAD model —
because the way this fails otherwise is an app that ships whatever was in
`www/` last time.

It no longer rewrites any copy. It used to, when the site and the app were
one document and the wording lived in a page a script could edit. Since the
site moved to its own repository the app decides its own wording at
runtime: `inNativeShell()` turns "This browser" into "This device", and
"Drop a video here" becomes "Choose a video" when the pointer is coarse —
which is a property of the device rather than of the wrapper, so a tablet
in a browser gets it too.

## Android

The project is generated and committed, and has not been built here — this
machine has the Android command-line tools but no SDK installed
(`ANDROID_HOME` unset, no `adb`). `npm run open:android` and a first
Gradle sync will fetch what it needs.

Nothing in the measurements above transfers to Android: it is a different
WebView, a different ONNX build and a different GPU stack, and it needs its
own run of the same harness before any claim is made about it.
