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
| 18.5 | works | a real iPhone 16, not a simulator -- see below; the floor this app ships with |
| 26.0 | works | |
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

### The floor is 18.5, and it is a measurement

`IPHONEOS_DEPLOYMENT_TARGET` and the Podfile's `IOS_MIN` both say 18.5.

It was 26.0 until an iPhone 16 on iOS 18.5 turned the app away in
TestFlight. 26.0 was never a finding about iOS 18: Xcode 27 offers no
iOS 18 simulator runtime at all, so 18 could not be tested here.

```
$ xcodebuild -downloadPlatform iOS -buildVersion 18.5
iOS 18.5 is not available for download.        # and 18, 18.0, 18.1, 18.3, 18.4, 18.6
```

That phone was the missing test device. In Safari on opensubs.app, with
the engine set to "On this device" and the Base model -- the model the app
carries -- it transcribed the sample clip, and a marker typed into the
subtitles beforehand was replaced by the real transcript, so the text came
from the recogniser. Safari there is a fair stand-in for the app: the same
WebKit, the same full-precision Base on the CPU (Safari 18 has no WebGPU),
and single-threaded in both, because neither the site nor the shell sends
the COOP/COEP headers that would allow threads. iOS 17's failure happened
in Safari as well, while the session was being built, so this is the
check that would have caught it.

The floor is 18.5 rather than 18.0 because 18.0 to 18.4 are still
untested, and every phone on one of them is a free update away from 18.5.
Before this ships to the App Store, transcribe once in the TestFlight
build on an 18.5 phone: the app is the one thing that check did not run.

To lower it further, run `e2e/enginecheck` -- or the same steps on the
site -- on an older device, then move both numbers down and re-run
`pod install`.

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
