# Installing OpenSubs

Four ways to run it. The first needs nothing at all; the other three each
have one prerequisite worth knowing before you download anything.

- [Web app](#web-app) — nothing to install
- [Browser extension](#browser-extension) — Chrome, Edge, Firefox
- [Desktop app](#desktop-app) — macOS, Windows, Linux
- [Command line](#command-line) — build from source
- [Mobile](#mobile) — not released yet

Builds live on the **[releases page](https://github.com/open-subs/opensubs/releases)**.

> **These are release candidates.** They are complete and tested; the
> version number says they have not been through a stable release yet.
> The desktop builds are **unsigned**, and the extension is **not in any
> store**, so both need a step that a signed build would not. Those steps
> are below, in full, rather than left for you to discover.

---

## Web app

Open **[opensubs.app](https://opensubs.app)**. That is the whole procedure.

A browser with WebAssembly. WebGPU makes transcription roughly ten times
faster where it exists, and everything still works without it. The speech
model downloads once (40–250 MB depending on which you pick) and is cached
by the browser after that.

---

## Browser extension

Subtitles over whatever is playing in the tab, generated as it plays. It
takes the audio from the video element itself, so it works the same in
Chrome, Edge and Firefox — and it needs the site's permission, which it
asks for when you press Start and for that site only.

**It is not in any store yet.** There is no listing to click "Add to
Chrome" on. What follows loads the build by hand, which is how every
unlisted extension is installed.

Download `opensubs-chrome-<version>.zip` or `opensubs-firefox-<version>.zip`
from the [releases page](https://github.com/open-subs/opensubs/releases).
The two are not interchangeable: Chromium and Firefox disagree about how a
background script is declared, and each rejects the other's manifest.

### Chrome and Edge

1. Unzip it. You need the **folder**, not the `.zip`.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** — top right.
4. **Load unpacked**, and choose the unzipped folder.

It stays installed. Chrome will remind you on each restart that a
developer-mode extension is loaded; that is the browser being careful about
unlisted extensions, and it stops once there is a store listing.

### Firefox

Firefox refuses to install unsigned extensions permanently on the release
and beta channels, and this build is unsigned. Two options, and neither is
a workaround for the other:

**A temporary install** — works on every channel, lasts until you quit
Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on**, and choose the `.zip` (or the `manifest.json`
   inside the unzipped folder).

**A permanent install** — needs Firefox Developer Edition, Nightly or ESR:

1. Open `about:config` and set `xpinstall.signatures.required` to `false`.
   This does nothing on release or beta; the setting is ignored there.
2. Install the `.zip` from `about:addons` → gear → **Install Add-on From
   File**.

### Using it

1. Play the video.
2. Open the extension, pick a model and a language, press **Start**.
3. Grant access to the site when asked.

Subtitles appear over the video about one window behind the audio — 10 to
30 seconds, whichever you chose. **Save .srt** writes the transcript out.

Two things it cannot do, and it says so rather than producing empty
subtitles: **DRM-protected video** (Netflix, Disney+ and so on) captures as
silence, and a plain cross-origin video file served without CORS headers
cannot be captured at all.

---

## Desktop app

For long files and batches, without a browser in the way.

### First: ffmpeg

The desktop app shells out to `ffmpeg` both to burn subtitles into the
picture and to run speech recognition, and it needs one built with the
**`ass`** and **`whisper`** filters. Homebrew's plain `ffmpeg` formula has
neither, and most distribution packages have `ass` but not `whisper` — the
whisper filter is recent. The failure looks like a bug in this app rather
than a missing dependency, which is why it is the first thing on this page.

Check what you have, on any platform:

```bash
ffmpeg -filters | grep -E ' (ass|whisper) '
```

Two lines back and you are set. **`whisper` missing** means you can still
burn subtitles you already have, and style and translate them — you just
cannot generate them from audio. **`ass` missing** means burning fails
outright.

**macOS.** The app can do this for you. When it starts without a usable
ffmpeg it shows **Install ffmpeg-full via Homebrew**, and streams the
install output so you can see what it is doing. It needs
[Homebrew](https://brew.sh) already installed and says so if it is missing.
By hand:

```bash
brew install ffmpeg-full          # not `ffmpeg` -- that build has neither filter
```

**Windows and Linux.** The in-app installer is Homebrew-only, so install
ffmpeg yourself. Take a *full* build rather than a minimal one, then run
the filter check above — if `whisper` is absent, the app still burns and
styles, and you generate subtitles in the web app or the extension instead.

The app searches its own folder first, then the usual Homebrew prefixes,
then `PATH` — there is no setting for an explicit path, so an ffmpeg
somewhere unusual needs a symlink into one of those. (The CLI does take
one: `--ffmpeg <PATH>`.)

### Then the app

Download for your platform from the
[releases page](https://github.com/open-subs/opensubs/releases):

| Platform | File |
|---|---|
| macOS (Apple silicon) | `OpenSubs_<version>_aarch64.dmg` |
| Windows | `OpenSubs_<version>_x64-setup.exe` or `_x64_en-US.msi` |
| Debian / Ubuntu | `OpenSubs_<version>_amd64.deb` |
| Fedora / RHEL | `OpenSubs-<version>-1.x86_64.rpm` |
| Any Linux | `OpenSubs_<version>_amd64.AppImage` |

**The builds are unsigned**, so each OS will stop you once:

- **macOS** — "OpenSubs cannot be opened because the developer cannot be
  verified." Right-click the app in Applications → **Open** → **Open**.
  Once, then never again. If it still refuses:
  `xattr -d com.apple.quarantine /Applications/OpenSubs.app`
- **Windows** — SmartScreen shows "Windows protected your PC". **More
  info** → **Run anyway**.
- **Linux (AppImage)** — `chmod +x OpenSubs_*.AppImage`, then run it.

### The speech model

The app downloads it for you. Under **Model**, press **Download a
model…** and pick one:

| Model | Download | Good for |
|---|---|---|
| `tiny.en` | 78 MB | English, clear speech, fastest |
| `base.en` | 148 MB | English, a sensible default |
| `large-v3-turbo` | 1.6 GB | 99 languages, most accurate |

They land in `~/.cache/opensubs-models` and are shared with the CLI.
**Choose model…** points at one you already have instead.

---

## Command line

There is no prebuilt binary yet — build it from source. Same `ffmpeg`
requirement as the desktop app, above.

```bash
git clone https://github.com/open-subs/opensubs
cd opensubs
cargo build --release -p opensubs
./target/release/opensubs --help
```

Rust 1.97.1; `rust-toolchain.toml` pins it, so `rustup` installs the right
one on first build.

```bash
# Burn subtitles into a video, generating them first
opensubs burn talk.mp4 --model ~/.cache/opensubs-models/ggml-base.en.bin

# A style, a translation, and sidecar files
opensubs burn talk.mp4 \
  --model ~/.cache/opensubs-models/ggml-base.en.bin \
  --style Clean --translate-to zh --srt talk.srt

opensubs styles         # the presets
opensubs languages      # translation targets
opensubs probe in.mp4   # what ffprobe sees, as JSON
```

Unlike the desktop app, the CLI does not download models — point `--model`
at a whisper `ggml` file. The desktop app's downloads work fine here.

---

## Mobile

**Not released.** The iOS, iPadOS and Android projects are in `apps/mobile`
and build, but nothing has been submitted to either store and there is no
build to sideload.

One thing already known, from measuring rather than guessing: on **iOS 17**
the speech engine cannot start at all — ONNX Runtime fails building its
execution plan, before any inference. iOS 26 works, at roughly 6x realtime.
The versions in between are untested. See [mobile.md](mobile.md).

---

## Uninstalling

- **Extension** — remove it from `chrome://extensions` or `about:addons`.
- **macOS** — drag OpenSubs to the Bin.
- **Windows** — Add or Remove Programs.
- **Linux** — `apt remove opensubs` / `dnf remove OpenSubs`, or delete the
  AppImage.
- **Models** — `rm -rf ~/.cache/opensubs-models` (up to 1.6 GB).
- **The web app** stores nothing but your preferences and the cached model,
  both of which go with the site's data in your browser settings.
