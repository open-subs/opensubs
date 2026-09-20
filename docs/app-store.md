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

In-app purchase through StoreKit, end to end on the client side, and the
SQL the server needs. What is not done is anything that requires this
machine to build or this account to have an app record — see below.

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

### What the server needs

The rail already exists in `openapps-server` — Apple receipt
verification, `app_iap_products`, and the refund webhook — and is
documented in openpdfedit's `docs/PRODUCTION.md` §3b. OpenSubs needs its
own rows, and its own product ids:

```sql
-- /var/lib/docker/volumes/openapps-prod-data/_data/openapps.db
INSERT INTO app_iap_products
  (platform, product_id, app_id, bundle_id, credits, usd_price, created_at)
VALUES
  ('apple', 'opensubs_credits_1000', 'opensubs', 'app.opensubs.mobile', 1000,  499, unixepoch()),
  ('apple', 'opensubs_credits_5000', 'opensubs', 'app.opensubs.mobile', 5000, 1999, unixepoch());
```

499 and 1999, not 500 and 2000: the web packages are $5 and $20, and Apple
has no such price points -- the nearest tiers are $4.99 and $19.99. The
row should say what the customer is actually charged, or the ledger and
the receipt disagree by a cent for ever.

The ids are prefixed on purpose. The server looks a product up by
`(platform, product_id)` alone, so a bare `credits_1000` is already
openpdfedit's row: the lookup would succeed, resolve to
`com.openpdfedit.app`, and then fail verification against our bundle —
a confusing failure a long way from its cause.

Three places have to agree, and each decides something different: App
Store Connect decides what a pack *costs*, this table decides what it is
*worth*, and `OpenSubsStore.productIdentifiers` decides what to ask
about.

Also set the Server Notifications V2 URL in App Store Connect to
`https://auth.opensubs.app/v1/webhooks/apple`. Without it a refund is
never clawed back: Apple refunds the customer and the credits stay spent.

Three things about the deployment this needs, all of them checked
against the live server rather than assumed:

- **The rail is not deployed yet.** `/v1/payments/apple/redeem` answers
  404 there while `/v1/payments/stripe/checkout` answers 401, so the
  running image predates the Apple routes. The container is
  `openapps-prod` from `openapps-server:prod`; it has to be rebuilt from
  the monorepo and restarted before any of this can work.
- **The root certificate has to be inside the container.** The config
  mount is a single file -- `/opt/openapps/config/prod-base.toml` at
  `/etc/openapps/base.toml` -- so a `root_certificates_file` pointing at
  `/opt/openapps/config/apple-root-ca-g3.pem` names a path the server
  cannot see. Either mount the PEM as well or use
  `root_certificates_pem` inline.
- **`capacitor://localhost` is not an allowed origin.** The app is served
  from that scheme, and the allow-list on the running container names
  the web hostnames only. Without it the app cannot sign in, read a
  balance or redeem anything -- the failure is CORS, arrives before any
  of the purchase code runs, and looks nothing like a purchase bug.

### Sandbox, and where it can be tested

A TestFlight purchase is a *sandbox* purchase. The server refuses a
receipt from the other environment on purpose -- a sandbox receipt
verifies against Apple's real certificates exactly as a paid one does,
so only that check separates a tester from an unlimited credit printer.

That means production cannot credit a TestFlight test. Either point the
app at a second deployment configured `environment = "sandbox"` for the
test, or accept that the first end-to-end run of the chain happens on
the first real purchase. The first is the reason to have a staging
accounts server; the second is a decision, not an accident, and should
be made deliberately.

## Order of operations, once the above is settled

1. `sudo xcodebuild -license`, then the Apple Distribution certificate.
2. Create the app record in App Store Connect.
3. Create the two consumables in App Store Connect —
   `opensubs_credits_1000` and `opensubs_credits_5000` — and insert the
   rows above on the accounts server.
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
