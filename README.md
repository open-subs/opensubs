# OpenSubs

**The open-source alternative to VEED and Kapwing auto-subtitles — your video never leaves your machine.** [opensubs.app](https://opensubs.app)

Subtitle any video without uploading it anywhere. OpenSubs transcribes the
speech, translates it, styles it and burns it into the picture — and the
video file never leaves your machine, because there is nowhere for it to
go.

**[opensubs.app](https://opensubs.app)** runs the whole thing in a browser
tab with nothing to install. If you would rather have it installed, or want
subtitles over a video already playing in another tab, there are three more
ways to run it — see **[docs/install.md](docs/install.md)**.

[![ci](https://github.com/open-subs/opensubs/actions/workflows/ci.yml/badge.svg)](https://github.com/open-subs/opensubs/actions/workflows/ci.yml)
[![licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE)

## Four places, one engine

| | What it adds | Install |
|---|---|---|
| **Web app** | Nothing to install, nothing to trust — open the page | [opensubs.app](https://opensubs.app) |
| **Browser extension** | Live subtitles over whatever is playing in a tab. Chrome, Edge, Firefox | [guide](docs/install.md#browser-extension) |
| **Desktop app** | Long files and batches, without a browser in the way. macOS, Windows, Linux | [guide](docs/install.md#desktop-app) |
| **Command line** | Scripting and CI | [guide](docs/install.md#command-line) |

Line breaking, reading-speed limits, the style presets and the ASS writer
are one Rust crate compiled two ways — to WebAssembly for the browser and
to a native binary for everything else — so all four produce the same
subtitles from the same input rather than four dialects of nearly-the-same.

## What actually happens to your video

Nothing leaves the machine unless you ask it to.

- **The video** is read through an object URL and decoded locally. There is
  no upload endpoint in this product, so a footage leak is not something to
  promise against — it is not possible.
- **The speech model** is downloaded once (from Hugging Face in the browser,
  from Hugging Face into `~/.cache/opensubs-models` on the desktop) and
  cached. Only the model is fetched; the audio stays put.
- **Subtitle text** is the only thing that can ever be sent anywhere, and
  only if you pick a cloud translator instead of the on-device one.

The full statement is at [opensubs.app/privacy.html](https://opensubs.app/privacy.html),
and it is written to match what this repository does rather than the other
way round.

## Layout

```
crates/            the engine, shared by every front end
  subs-media         probing and container facts
  subs-asr           speech recognition
  subs-subtitle      cue model, SRT/VTT/ASS
  subs-style         the presets and the style template
  subs-pipeline      the burn job, and where ffmpeg is found
  subs-qa            reading-speed and overlap checks
  subs-tier          what is free and what is paid
  subs-translate     the translation providers
  subs-credits       billing, linked by a separate gateway
  subs-wasm          the browser build of the above

apps/
  web                the site and the web app (Svelte 5 + Vite)
  extension          Chrome, Edge and Firefox (MV3)
  desktop            Tauri 2
  mobile             iOS, iPadOS and Android (Capacitor)
  cli                the `opensubs` binary
```

The clean-up rules that decide which lines are hallucinated music rather
than speech live in `apps/web/src/lib/cleanup.ts`, and the extension
imports them rather than copying them. They took two rounds of field
reports to get right; a fork of them would be wrong within a month.

## Building it

Rust 1.97.1 and Node 22. The toolchain file pins the version and the
`wasm32-unknown-unknown` target, so `rustup` sorts itself out on first
build.

```bash
cargo test -p subs-media -p subs-subtitle -p subs-style -p subs-pipeline

cd apps/web       && npm ci && npm run build   # dist/
cd apps/extension && npm ci && npm run build:all
cd apps/desktop   && npm install && npx tauri build
cargo build --release -p opensubs               # the CLI
```

The desktop app and the CLI shell out to `ffmpeg` to burn, and need one
built with the `ass` and `whisper` filters — Homebrew's plain `ffmpeg`
formula has neither. [docs/install.md](docs/install.md) covers it per
platform.

`apps/web/vendor/openapps/` holds two built packages the accounts and
paid-translation UI depends on. They are checked in so a clone builds
offline; `scripts/vendor-openapps.sh` regenerates them.

## Testing

```bash
cd apps/web
npm run test:cleanup     # the hallucination rules
npm run test:context     # sentence grouping and re-spreading
npm test                 # 109 checks in a real browser against dist/
npm run test:languages   # six language fixtures, end to end

cd apps/extension
npm test                 # the window-stitching logic
npm run test:pipeline -- /path/to/video.mp4 --engine firefox
```

`test:pipeline` is the one that matters: it captures audio from a real
video element in a real browser, runs the real model, and asserts a real
transcript comes back. Fixtures pass in this repository while real files
fail, so a green synthetic test is not evidence.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE).

Two crates opt out deliberately, and say why in their own `Cargo.toml`:
`subs-credits` and `subs-translate` are linked by a separate gateway
binary.
