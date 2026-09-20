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

Everything except the build itself and the things only a person may press.
Each line below was checked against Apple or the live server, not assumed.

**Signing and identity**

- Xcode's licence is accepted (`xcodebuild -checkFirstLaunchStatus` exits 0;
  it exits 69 when it is not, which is what `archive.sh` tests — the notice
  goes to the terminal rather than to stdout, so grepping for it finds
  nothing and sails past the one thing in the way).
- `Apple Distribution: DE JIAN KOH (JY2NWT5QFV)` is in the login keychain.
- App ID `app.opensubs.mobile` is registered, with the **In-App Purchase**
  capability. Without that the profile is still valid and StoreKit finds no
  products at runtime.
- The `OpenSubs App Store` provisioning profile is cut and installed in
  `~/Library/MobileDevice/Provisioning Profiles`, expiring 2027-09-20.

`apps/mobile/scripts/asc.py` does all three from the App Store Connect API
key, so none of it is a click in Xcode's Accounts pane on one particular
Mac:

```sh
set -a; . ~/.config/opensubs-apple/env; set +a
./scripts/asc.py setup         # cert, app id, profile
./scripts/asc.py show-iaps     # what App Store Connect holds
```

**The app record and the two consumables**

`OpenSubs` exists in App Store Connect — iOS, SKU `opensubs-ios`, primary
language en-US, bundle id `app.opensubs.mobile`. The record itself is the
one step the API refuses:

```
POST /v1/apps → 403
  The resource 'apps' does not allow 'CREATE'.
  Allowed operations are: GET_COLLECTION, GET_INSTANCE, UPDATE
```

so it was made through the website. Everything after it is `asc.py
ensure-iaps`: both consumables exist, carry their en-US name and
description, are priced from Apple's own price points at **$4.99** and
**$19.99**, and have a review note saying what a credit is for.

They read `MISSING_METADATA`, and the missing thing is the **App Store
review screenshot** — one image per product, showing where the purchase
appears. It cannot be produced from a script: the panel only renders for a
signed-in account inside the shell, so it wants a real run of the app.
That is the last piece of IAP metadata and it is needed at submission, not
before.

**The iOS floor is set, and measured**

`IPHONEOS_DEPLOYMENT_TARGET` and the Podfile's `IOS_MIN` are **26.0**. See
`docs/mobile.md`: the engine does not run on iOS 17 at all, it runs on
26.0, 26.5 and 27.0, and iOS 18 is untestable here because Xcode 27 offers
no iOS 18 simulator runtime to download. The app builds and runs on the
26.0 simulator at that floor.

**The accounts server**

Deployed and answering. `/v1/payments/packages` reports
`"apple_iap":true`, and the rail was proved end to end from a throwaway
Nostr account signing in from the app's own origin:

```
challenge  200  CORS capacitor://localhost
signed in  200  CORS capacitor://localhost
redeem     400  receipt verification: receipt is malformed: a JWS has
                exactly three dot-separated parts
webhook    400  notification verification: … three dot-separated parts
```

A 404 would mean the route is absent and a 401 would prove only that
something is listening. A *parse* error from the verifier is the answer
that separates a configured rail from a compiled one.

What that took, all three of which were missing:

- **The image predated the Apple routes.** Rebuilt from the monorepo and
  restarted with `deploy/run.sh prod`; the previous image is kept as
  `openapps-server:rollback-apple-<timestamp>`.
- **`[apple_iap]` in `config/prod-base.toml`**, not in `prod.env`:
  `OPENAPPS_APPLE_IAP_ENVIRONMENT` can only override a section that already
  exists. `environment = "production"`, and Apple's root certificate is
  **inline** as `root_certificates_pem` rather than
  `root_certificates_file`, because the container mounts that one file and
  nothing else from `config/` — a path there names a file the server cannot
  see, and the failure would arrive only when somebody first paid.
- **`capacitor://localhost` in `OPENAPPS_SERVER_ALLOWED_ORIGINS`.** The app
  is served from that scheme, so it is the `Origin` on every call it makes.
  Without it sign-in, balance and redeem all fail before any purchase code
  runs, as CORS, looking nothing like a purchase bug.

And the rows, which decide what a pack is *worth* (App Store Connect
decides what it *costs*):

```
apple  opensubs_credits_1000  opensubs  app.opensubs.mobile  1000   499
apple  opensubs_credits_5000  opensubs  app.opensubs.mobile  5000  1999
```

499 and 1999, not 500 and 2000: the web packages are $5 and $20, and Apple
has no such price points — the nearest tiers are $4.99 and $19.99. The row
should say what the customer is actually charged, or the ledger and the
receipt disagree by a cent for ever.

The ids are prefixed on purpose. The server looks a product up by
`(platform, product_id)` alone, so a bare `credits_1000` is already
openpdfedit's row: the lookup would succeed, resolve to
`com.openpdfedit.app`, and then fail verification against our bundle — a
confusing failure a long way from its cause.

**The client**

- `apps/mobile/ios/scripts/archive.sh` — stage the web app, archive,
  export, validate with Apple, upload. Modelled on openpdfedit's, with
  two Capacitor differences: it builds the **workspace** (the Capacitor
  runtime lives in `Pods.xcodeproj`, which `-project` cannot see), and it
  stages `www/` through `npm run sync` first, because that directory is a
  copy and archiving without it ships whatever was there last.
- `apps/mobile/ios/ExportOptions.plist` — App Store method, automatic
  signing, export-only so no accidental upload can consume a build
  number.
- Credentials live in `~/.config/opensubs-apple/env`, chmod 600, outside
  every git working tree: the Apple ID (the account holder, read back from
  the API rather than assumed), an app-specific password for `altool`, the
  team id, and the App Store Connect API key id and issuer. The `.p8`
  itself is in `~/.appstoreconnect/private_keys/`, where `altool` and
  `notarytool` also look; Apple allows it to be downloaded once, so that
  file is the only copy.

Build numbers are minutes-since-2020: monotonic, stateless, and unique
per upload. Apple never releases a build number back, so a duplicate
costs a round trip to discover.

## What is left, and who does it

1. **Archive and upload.** `cd apps/mobile/ios && ./scripts/archive.sh
   --validate`, then `--upload`. Nothing in this repository does it
   unprompted.
2. **A review screenshot for each consumable.** See above; it needs the app
   running, signed in.
3. **Install the TestFlight build on a real device.** Every number in
   `docs/mobile.md` is from a simulator with no GPU adapter.
4. **Decide how the chain gets its first end-to-end run** — see Sandbox,
   below. This is a decision, not an oversight.
5. **Screenshots, App Privacy answers, export compliance, review notes,
   and the submit button.** All of it a person's, by hand.

## The two guidelines that decide this submission

**4.2, minimum functionality.** A repackaged website is rejected. The
whole engine is in the bundle — Whisper through ONNX Runtime, the Rust
cue segmenter and the libass renderer, all WebAssembly — so it transcribes,
styles and burns with the network off. Say that in the review notes: a
reviewer who taps around the first screen sees a web view.

**3.1.1, in-app purchase.** Credits are digital content used inside the
app, so Apple requires them to be sold through the App Store. This is
built:

- `apps/mobile/ios/App/App/OpenSubsStore.swift` — StoreKit 2, reduced to
  four calls: `products`, `purchase`, `outstanding`, `finish`. It holds a
  transaction and finishes nothing on its own.
- `apps/web/src/lib/native.ts` — the shell as the page sees it. The
  plugin is asked for by name through Capacitor rather than assumed from
  the platform, so a TestFlight build made before the plugin existed does
  not offer a button that throws.
- `apps/web/src/lib/iap.ts` — the order: pay, redeem on the server, and
  only then finish. Imports nothing at runtime, which is what lets
  `apps/web/e2e/iap.mjs` drive it against a fake StoreKit and a fake
  server; 23 cases, including the ones a real sandbox purchase cannot
  produce because it succeeds.
- `apps/web/src/lib/AppleCredits.svelte` — the panel that replaces
  `<openapps-buy>` inside the shell, and the startup sweep that redeems
  anything StoreKit still considers owing.

The card checkout is behind `{#if !mustUseInAppPurchase()}` in
`App.svelte`, and a test asserts there is exactly one of it and that it
sits behind that guard — the way this breaks is somebody adding a second
`<openapps-buy>` elsewhere on the page, which looks harmless and takes
the app down.

**A transaction is finished only after the server grants the credits.**
StoreKit re-delivers an unfinished transaction on every launch, which is
what makes a purchase survive a crash or a dead network between paying
and being credited. Finishing early throws that away and leaves somebody
charged for credits nobody granted, with no record left to retry from.

The related trap is 3.1.3(b): an account made elsewhere may be *used* in
the app, and the app may not *tell* anyone where to make one. The
sign-in element is fine. A "sign up on our website" link is not.

### Server Notifications V2

One thing on the server side is still unset: the **App Store Server
Notifications V2 URL** in App Store Connect, which should be
`https://auth.opensubs.app/v1/webhooks/apple`. It is set on the app record
rather than through the API used above, and it cannot be set until the app
has a build. Without it a refund is never clawed back: Apple refunds the
customer and the credits stay spent.

### Sandbox, and where it can be tested

A TestFlight purchase is a *sandbox* purchase. The server refuses a
receipt from the other environment on purpose -- a sandbox receipt
verifies against Apple's real certificates exactly as a paid one does,
so only that check separates a tester from an unlimited credit printer.

The live server is now configured `environment = "production"`, so it
cannot credit a TestFlight test — deliberately. Either point the app at a
second deployment configured `environment = "sandbox"` for the test, or
accept that the first end-to-end run of the chain happens on the first
real purchase. The first is the reason to have a staging accounts server;
the second is a decision, not an accident, and should be made
deliberately.

## Order of operations

Struck through in effect — steps 1 to 4 are done, and what is left is the
list under "What is left, and who does it" above. Kept because the order
matters if any of it has to be redone:

1. Xcode licence, then the Apple Distribution certificate.
2. The app record in App Store Connect.
3. The two consumables, and the `app_iap_products` rows on the server.
4. Test the iOS floor on simulators; set `IPHONEOS_DEPLOYMENT_TARGET`.
5. `cd apps/mobile/ios && ./scripts/archive.sh --validate`, then
   `--upload`.
6. The build appears under TestFlight after processing. Install it on a
   real device — every measurement in `docs/mobile.md` is from a
   simulator with no GPU adapter.
7. **Sandbox-test a real purchase through TestFlight before submitting.**
   This is the first moment the whole chain runs end to end — StoreKit,
   the receipt, the server's verifier, the ledger — and the first moment
   Apple's real certificate chain is parsed by anything of ours. Check
   both halves of the rule while you are there: the credits appear, and
   killing the app between paying and being credited still ends with the
   credits arriving on the next launch.
8. Screenshots, App Privacy answers, export-compliance answer, review
   notes. Then the submit button, by hand.
