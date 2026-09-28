# OpenSubs on the Mac App Store: what it would take

2026-09-28. Written while publishing the iOS app, from what that
publication found. **Nothing here is started.** This is the scope, in the
order the pieces depend on each other, so the work can be costed rather
than discovered.

`docs/app-store.md` covers iOS, where most of this is already done. The Mac
is a different app, a different binary, and — as things stand — a different
purchase.

---

## The decision that comes first

**One bundle id across iPhone, iPad and Mac, or two?**

| | Today |
|---|---|
| iOS | `app.opensubs.mobile` (Capacitor, App Store Connect record `6814209431`) |
| Mac | `com.opensubs.desktop` (Tauri, no App Store Connect record at all) |

The suite's rule, in `openapps-integration/native-apps.md`, is one universal
id: *"One purchase and one set of credit packs across all three. Two ids
means two app records, two product sets, two reviews of the same thing."*

Two ids also means **credits bought on the iPhone do not appear on the
Mac's purchase panel as the same product** — they would still land on the
same OpenApps account, because credits are the server's and the account is
shared, but Apple sees two unrelated consumables and the review of each is
separate.

Changing the desktop id is cheap *now* and impossible later: the Mac app
has never been on the store, so nothing is tied to `com.opensubs.desktop`
except the Developer ID build people may already have installed. Changing
it after a store release orphans every purchase.

**This decision blocks everything below.** Nothing else should start until
it is made.

## What does not exist yet

- **No Mac app record** in App Store Connect. `asc.py whoami` lists two
  records for this team, `com.openpdfedit.app` and `app.opensubs.mobile`.
  The record is the one step the API refuses (`POST /v1/apps` → 403), so it
  is a web-UI step, by hand, once.
- **No Mac provisioning support in this repo.** `apps/mobile/scripts/asc.py`
  has `ensure-cert`, `ensure-app-id` and `ensure-profile`, all iOS. A Mac
  App Store build needs a *Mac App Distribution* certificate, a *Mac
  Installer Distribution* certificate, and a Mac provisioning profile —
  three more things, and openpdfedit's `asc.py` already has
  `ensure-installer-cert` and `ensure-mac-profile` to copy from.
- **No store build script.** `apps/desktop` has no `scripts/` directory.
  openpdfedit's `build-appstore.sh` (`test | store | upload`) is the model:
  `test` builds the sandboxed app ad-hoc so it runs on this Mac, `store`
  signs it for submission and cannot launch locally at all.
- **No StoreKit bridge on the Mac.** The page asks `storeKit()` in
  `apps/web/src/lib/native.ts`; the iOS shell answers through
  `OpenSubsStore.swift`. Tauri answers nothing, so the Mac store build
  would show a card checkout — which is the 3.1.1 rejection.
- **No sandbox entitlements**, and `tauri.conf.json` has an empty
  `bundle.macOS` block.

## What is already right

- **Nothing shells out to a binary.** `grep -rn "Command::new"` in
  `apps/desktop/src-tauri/src` finds nothing, so the sandbox rule that cost
  openpdfedit its OCR feature does not bite here. The engine is already
  WebAssembly in the page.
- **No updater plugin compiled in** (`plugins: []`), so there is no
  self-updating app to put behind a Cargo feature. An app that updates
  itself is refused; this one does not.
- **The account, the credits and the ledger are the server's**, and already
  work — the iOS work proved the rail end to end.

## The order

1. **Decide the bundle id.** If universal: change `identifier` in
   `tauri.conf.json` to `app.opensubs.mobile`, and add the macOS platform
   to the *existing* App Store Connect record rather than making a second
   one. If separate: register `com.opensubs.desktop` as its own App ID and
   accept a second set of consumables.
2. **Certificates and profile.** Port `ensure-installer-cert` and
   `ensure-mac-profile` from openpdfedit's `asc.py` into
   `apps/mobile/scripts/asc.py` (or a new `apps/desktop/scripts/asc.py`).
3. **Sandbox the app.** Entitlements: `app-sandbox`,
   `files.user-selected.read-write`, `files.bookmarks.app-scope` for
   recents, `network.client` for the account and the paid routes. Then walk
   every file path in the app: a sandboxed app may read what the person
   picked, for that session, and needs a security-scoped bookmark for
   anything it wants to reopen.
4. **The StoreKit bridge.** A Tauri command backed by StoreKit 2 with the
   same four calls `OpenSubsStore.swift` exposes — `products`, `purchase`,
   `outstanding`, `finish` — wired to the same `storeKit()` interface the
   page already asks for. The purchase *ordering* is already written and
   tested in `apps/web/src/lib/iap.ts`; only the bridge is new.
5. **`build-appstore.sh`.** Universal (arm64 + x86_64) — an arm64-only app
   will not install on an Intel Mac. Read the tail of its log rather than
   its exit code: openpdfedit's exits non-zero on the updater-signature
   step, long after a successful build.
6. **Listing, screenshots (`APP_DESKTOP`), review notes**, and the same
   review account.
7. **Submit**, with the IAPs attached in the web UI — the API rejects every
   documented relationship name for that, which is measured, not assumed.

## Two traps that will cost a day each if met cold

- **Permissive Security blocks every App Store app.** On Apple Silicon,
  disabling SIP forces the boot policy to Permissive, and macOS then
  refuses to launch *any* App Store or TestFlight binary — with a dialog
  that names Security Policy, not signing. Developer ID builds are
  unaffected, which is the tell. `csrutil status` says `disabled` when this
  is the problem.
- **An empty review submission cannot be deleted or cancelled.** Create one
  only when there are items ready to go into it, in the same run.
