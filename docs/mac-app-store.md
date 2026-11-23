# OpenSubs on the Mac App Store

The Mac App Store build is the desktop app (`apps/desktop`) built a second
way. The direct-download build (`npx tauri build`, the release workflow)
is untouched by any of it: every difference is behind the Cargo feature
`appstore` and the page variable `OPENSUBS_STORE=1`, both off by default,
and the direct-download binary compiles to the same bytes with or without
the store code in the tree.

```sh
apps/desktop/scripts/fetch-bundled.sh            # the models (once)
apps/desktop/scripts/build-appstore.sh test      # sandboxed, runs on this Mac
apps/desktop/scripts/appstore-smoke.sh speech.mp4 hdr-speech.mp4
apps/mobile/scripts/asc.py ensure-mac-profile    # the store profile (once a year)
apps/desktop/scripts/build-appstore.sh store     # the .pkg for App Store Connect
```

`store` stops at a signed `.pkg`. Scanning it (`publish-scan.sh`),
validating it and uploading it (`xcrun altool --validate-app` /
`--upload-app -t macos`) are separate steps, and submitting for review is
never scripted.

## One app record

The Mac app uses the iOS app's bundle id, **`app.opensubs.mobile`**, so it
is the macOS platform of the same App Store Connect record (`6814209431`)
and sells the same two credit packs (`opensubs_credits_1000`,
`opensubs_credits_5000`): one purchase history, one review of the products.
The App ID is UNIVERSAL and already has In-App Purchase and Sign in with
Apple. The direct-download app keeps `com.opensubs.desktop`.

The macOS platform is added to the record in App Store Connect's website
(the API cannot add one).

## What differs from the direct-download build

| | Direct download | Mac App Store |
|---|---|---|
| Bundle id | `com.opensubs.desktop` | `app.opensubs.mobile` |
| ffmpeg | prebuilt GPL build (`fetch-bundled.sh`), or an install through Homebrew | LGPL build from source (`scripts/ffmpeg-lgpl.sh`), signed inside the app as a helper in its sandbox; nothing installed or downloaded to run |
| H.264 encoder | libx264 | VideoToolbox (`h264_videotoolbox`): x264 is GPL |
| Credits | card checkout in the browser | StoreKit 2 (`src-tauri/appstore/StoreBridge.swift`), redeemed by `apps/web/src/lib/iap.ts`, the iOS app's own code |
| Sign in with Apple | the web redirect | Apple's sheet (`src/store/account.ts`), against the same `apple_native` challenge as iOS |
| Account deletion | on the website | in the account panel (guideline 5.1.1(v)) |
| Where an export goes | beside the video | a folder the person picks, starting at the video's (`src/store/api.ts`); the sandbox grants the picked video, not its folder |
| Reveal in Finder | `open -R` | `NSWorkspace` |
| Updates | none compiled in | none compiled in |
| Architectures | arm64 | arm64 |

The sandbox entitlements are only what the app does
(`src-tauri/appstore/OpenSubs.entitlements`): user-selected read-write
files, network client (model downloads from Hugging Face, the account and
cloud translation), Sign in with Apple. ffmpeg and ffprobe carry only
`app-sandbox` and `inherit` (`helper.entitlements`), so they run in the
app's sandbox and cannot be started on their own. The privacy manifest is
`src-tauri/appstore/PrivacyInfo.xcprivacy`; NOTICE, LICENSE, the ffmpeg
licences, its configure line and the complete source archives of ffmpeg
and every library in it are copied into `Contents/Resources/licences/`.

The store build is the page built with `OPENSUBS_STORE=1`: `vite.config.ts`
swaps `src/lib/account.ts`, `api.ts` and `AccountPanel.svelte` for their
`src/store/` counterparts. The Rust side is `src-tauri/src/store.rs` and
`commands::store_cmds`.

## Testing without the store

A store-signed app does not launch outside the store, so `build-appstore.sh
test` builds the same sandboxed app with the Apple Development certificate
and the sandbox entitlements only, plus a hook (Cargo feature
`appstore-test`) that runs a script in the real window. `appstore-smoke.sh`
drives it with no clicks or keystrokes and checks a burn with its `.srt`, an
HDR burn translated on the Mac, a video opened with the app, that the
sandbox refuses anything else, and that StoreKit answers through the
bridge. Sign in with Apple and a purchase need the store profile, so they
are tested from TestFlight.

## Traps

- **A helper signed with `inherit` traps (exit 133) when started from a
  terminal.** That is the sandbox working. Read the outputs with the
  unsigned copy in `src-tauri/bundled/ffmpeg-lgpl/`.
- **Compiled paths name the builder's home.** Panic locations and C++
  `__FILE__`s carry the Cargo registry and checkout paths; the store build
  remaps them (`--remap-path-prefix`, `-ffile-prefix-map`) and builds into
  `appstore-target/` so the direct-download cache is not invalidated.
- **`publish-scan.sh` fails on the ffmpeg source the bundle carries.** The
  upstream archives in `Resources/licences/ffmpeg/source/` are full of
  their authors' e-mail addresses and version numbers that read as IPs:
  about 2,500 hits, none of them ours. Check the archives against the
  SHA-256 pins in `ffmpeg-lgpl.sh`, then scan everything else with
  `--skip-path 'licences/ffmpeg/source/'`. The one remaining hit is the
  app's own redaction markers (`"\Users\"`, `"/Users/"`, `"/home/"` in
  `commands::redact`) running into the next string, `/home/struct`, which
  the direct-download binary has too: `--allow '/home/struct'`.
- **Permissive Security blocks every App Store app.** On Apple Silicon with
  SIP disabled, macOS refuses to launch any App Store or TestFlight binary,
  with a dialog that names Security Policy, not signing.
- **An empty review submission cannot be deleted or cancelled.** Create one
  only when there are items ready to go into it, in the same run.
