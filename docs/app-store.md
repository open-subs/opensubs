# Publishing OpenSubs to the App Store (iOS and iPadOS)

The app is the web app in a native shell — see `docs/mobile.md` for why,
and for what was measured on the simulator. This file is about the
submission, and follows `openpdfedit/docs/STORES.md`, which is the one
App Store submission this suite has already thought through.

Nothing here submits anything. `apps/mobile/ios/scripts/archive.sh`
builds a signed `.ipa` and can upload it to App Store Connect, where it
appears under TestFlight. Pressing **Submit for Review** is a person's
decision.

## What is ready

- `apps/mobile/ios/scripts/archive.sh` — stage the web app, archive,
  export, validate with Apple, upload. Modelled on openpdfedit's, with
  two Capacitor differences: it builds the **workspace** (the Capacitor
  runtime lives in `Pods.xcodeproj`, which `-project` cannot see), and it
  stages `www/` through `npm run sync` first, because that directory is a
  copy and archiving without it ships whatever was there last.
- `apps/mobile/ios/ExportOptions.plist` — App Store method, automatic
  signing, export-only so no accidental upload can consume a build
  number.
- The Xcode project states `DEVELOPMENT_TEAM = JY2NWT5QFV` and
  `MARKETING_VERSION = 1.0.0`, matching the `v1.0.0` release.
- Credentials live in `~/.config/opensubs-apple/env`, chmod 600, outside
  every git working tree. The app-specific password authenticates
  `altool`; it is not the Apple ID password and cannot sign in to the
  account.

Build numbers are minutes-since-2020: monotonic, stateless, and unique
per upload. Apple never releases a build number back, so a duplicate
costs a round trip to discover.

## What has to happen first, and by whom

**1. Accept Xcode's licence.** Every build tool on this machine refuses
to run until then — `xcodebuild`, `simctl`, and through them CocoaPods
and `cap sync`:

```sh
sudo xcodebuild -license
```

It needs a password and a scroll through the agreement, so it cannot be
scripted. The licence notice is written straight to the terminal rather
than to stdout, which is why `archive.sh` tests the exit status (69)
instead of grepping for the message — grepping finds nothing and sails
past the one thing in the way.

**2. An iOS distribution certificate.** The keychain holds a *Developer
ID Application* certificate, which signs Mac apps distributed outside the
App Store. It cannot sign an iOS App Store build. Xcode → Settings →
Accounts → Manage Certificates → **+** → Apple Distribution, signed in to
the Apple ID that holds team `JY2NWT5QFV`.

**3. An App Store Connect record** for bundle id `app.opensubs.mobile`,
created by hand. `altool` uploads a build *to* an app; it cannot create
one.

**4. A minimum iOS version that works.** The project says **14.0** and
that is known to be wrong: `docs/mobile.md` measured iOS 17 failing
outright — ONNX Runtime cannot even build its execution plan — while iOS
26 transcribes at 6.1x realtime. Everything between is untested, because
only those two simulator runtimes were installed. Shipping 14.0 means an
app that opens and cannot transcribe for anyone below the real floor,
which is both a bad app and a guideline 2.1 rejection. Test 18 through 25
and set the floor to the lowest that works.

## The two guidelines that decide this submission

**4.2, minimum functionality.** A repackaged website is rejected. The
whole engine is in the bundle — Whisper through ONNX Runtime, the Rust
cue segmenter and the libass renderer, all WebAssembly — so it transcribes,
styles and burns with the network off. Say that in the review notes: a
reviewer who taps around the first screen sees a web view.

**3.1.1, in-app purchase.** This is the open question, and it is not
answered yet. Credits are digital content used inside the app, so Apple
requires them to be sold through in-app purchase. The staged bundle today
carries `<openapps-buy>` — the card checkout — and `<openapps-login>`,
and reaches `gateway.opensubs.app` for paid translation. Submitted as it
stands, that is a rejection.

Three ways out, and the choice is a product decision:

1. **Ship the app free-only.** Hide the paid translation route and the
   purchase element inside the shell. Everything that made the product —
   transcription, on-device translation, all twelve styles, burning,
   every export — is free and runs locally, so the app loses the one
   feature that costs money and needs no IAP at all. Smallest change,
   nothing to maintain, no revenue on iOS.
2. **StoreKit.** What openpdfedit did: the shell sells credits through
   Apple and the server grants them from the receipt. The server rail
   already exists — `app_iap_products`, Apple receipt verification and
   the refund webhook are in `openapps-server` and documented in
   openpdfedit's `docs/PRODUCTION.md` §3b — so the missing half is the
   client: a StoreKit purchase in the Capacitor shell, a bridge to the
   page, and the page swapping its card checkout for it inside the app.
   Most work; the only option that earns anything on iOS.
3. **Sign-in only, no selling.** Credits bought on the web may be *used*
   in the app; the app must neither sell them nor point anyone at where
   to buy. Cheaper than StoreKit and allowed on its face, but 3.1.3(b) is
   read narrowly by reviewers outside the reader categories, so it is the
   option most likely to come back.

## Order of operations, once the above is settled

1. `sudo xcodebuild -license`, then the Apple Distribution certificate.
2. Create the app record in App Store Connect.
3. Decide the 3.1.1 route and implement it.
4. Test the iOS floor on simulators; set `IPHONEOS_DEPLOYMENT_TARGET`.
5. `cd apps/mobile/ios && ./scripts/archive.sh --validate`, then
   `--upload`.
6. The build appears under TestFlight after processing. Install it on a
   real device — every measurement in `docs/mobile.md` is from a
   simulator with no GPU adapter.
7. Screenshots, App Privacy answers, export-compliance answer, review
   notes. Then the submit button, by hand.
