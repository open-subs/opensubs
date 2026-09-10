<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from "svelte";
  import Icon from "./lib/Icon.svelte";
  import { session } from "./lib/session.svelte";
  import CostBadge from "./lib/CostBadge.svelte";
  import RoutePicker, { type Route } from "./lib/RoutePicker.svelte";
  import {
    quoteForTranslation,
    quoteForTranscription,
    priceLabel,
    creditWord,
    usd,
    PRICING_OF,
    type Quote,
  } from "./lib/credits";
  import {
    account,
    balance as fetchBalance,
    signedIn,
    configureAccount,
    onAccountChange,
    InsufficientCredits,
    NotSignedIn,
  } from "./lib/account";
  import {
    saveWork,
    loadWork,
    clearWork,
    describeAge,
    type SavedWork,
  } from "./lib/workinprogress";
  import {
    videoHandlesWork,
    rememberVideo,
    rememberedVideo,
    forgetVideo,
    reopenVideo,
    pickVideo,
    handleFromDrop,
  } from "./lib/videohandle";
  import { attachPreview, type Preview } from "./lib/preview";
  import { fontKey, unsupportedCharacters } from "./lib/fonts";
  import {
    decodeSubtitles,
    decodeAs,
    SUBTITLE_ENCODINGS,
    type Decoded,
  } from "./lib/decode";
  import { captureFrame, renderStyleThumbnails } from "./lib/stylePreview";
  import { burnInBrowser, burnSupport, type BurnSupport } from "./lib/burn";
  import { isChinese, toSimplified, wantsTraditional } from "./lib/script";
  import { initLocale, t } from "./lib/i18n/index.svelte";
  import LanguagePicker from "./lib/LanguagePicker.svelte";
  import { humanRemaining, progressLabel, secondsRemaining } from "./lib/eta";
  import {
    ASR_ENGINES,
    opensubsAsrConfigured,
    ASR_MODELS,
    asrSupport,
    loudnessFor,
    transcribeLocally,
    transcribeRemotely,
    type AsrSupport,
  } from "./lib/asr";
  import {
    PROVIDERS,
    deviceAvailability,
    detectionAvailable,
    opensubsConfigured,
    provider as providerById,
    translateCues,
    type ProviderId,
  } from "./lib/translate";
  import {
    load,
    segment,
    engineVersion,
    listStyles,
    listFeatures,
    listLanguages,
    readSubtitles,
    writeAss,
    writeAssEmphasised,
    writeAssKaraoke,
    writeAssBilingual,
    writeAssBilingualKaraoke,
    writeAssBilingualEmphasised,
    mergeBilingualCues,
    emphasisCap,
    glowCap,
    writeSrt,
    writeVtt,
    clipError,
    clipLength,
    exportSize,
    opensubsCommand,
    rawFfmpegCommand,
    type Cue,
    type Style,
    type Feature,
    type Language,
  } from "./lib/engine";

  // --- state -------------------------------------------------------------

  /**
   * Whether this is a device with no mouse to drag with.
   *
   * "Drop a video here" is an instruction a phone cannot follow, and it is
   * the first line of the app-shell build's opening screen. A coarse
   * pointer is the honest test rather than a check for the native wrapper:
   * a tablet in a browser cannot drag either, and gets the same wording.
   *
   * Read once. A pointer does not change type mid-session, and a media
   * query subscription here would re-render the drop zone for nothing.
   */
  const touchOnly =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  let engineReady = $state(false);
  let engineError = $state<string | null>(null);
  let version = $state("");

  let videoEl = $state<HTMLVideoElement | null>(null);
  let videoUrl = $state<string | null>(null);
  let videoName = $state("");
  let videoWidth = $state(0);
  let videoHeight = $state(0);
  let videoDuration = $state(0);
  /** Bumped when a frame is actually decodable, so thumbnails can use one. */
  let videoFrameReady = $state(0);
  let isDragOver = $state(false);
  /**
   * The video the last visit was working on, if this browser can hand it
   * back. Offered beside the restored subtitles rather than reopened on
   * load: reaching into someone's filesystem unprompted is not on.
   */
  let rememberedVideoHandle = $state<FileSystemFileHandle | null>(null);
  let reopening = $state(false);
  /**
   * Why a chosen video did not load. `loadVideo` used to run with no
   * `catch` anywhere above it, so anything that threw inside it -- tearing
   * down the previous renderer, most plausibly -- left an unhandled
   * rejection in the console and a dropzone that looked untouched. The
   * user's video simply did not appear, with nothing said.
   */
  let videoError = $state<string | null>(null);
  /** Set once the handle picker has proved unusable here. */
  let pickerBroken = $state(false);

  let cues = $state<Cue[]>([]);
  /**
   * Subtitles recovered from a previous visit, waiting for their video.
   *
   * Signing in is a full-page redirect, so the tab is destroyed and rebuilt.
   * Without this, pressing "sign in" to pay for a translation threw away the
   * transcription the user was about to translate -- and threw it away even
   * if they then abandoned the sign-in.
   */
  let restored = $state<SavedWork | null>(null);
  let subtitleError = $state<string | null>(null);
  let selectedCue = $state<number | null>(null);

  let styles = $state<Style[]>([]);
  let selectedStyle = $state("Clean");
  /** Preset name -> a libass-rendered thumbnail, once they are ready. */
  let thumbnails = $state<Record<string, string>>({});
  /**
   * Display-only. Deliberately never *read* inside the effect that starts
   * a render: reading and writing the same `$state` there makes the effect
   * invalidate itself, and the picker re-renders its twelve thumbnails
   * forever. The guard below is a plain variable for exactly that reason.
   */
  let thumbnailsBusy = $state(false);
  let thumbnailRun = 0;
  let thumbnailsRunning = false;
  let thumbnailsStale = false;
  const corePresets = $derived(styles.filter((s) => s.pack === "Core"));
  const advancedPresets = $derived(styles.filter((s) => s.pack === "Advanced"));

  // `null` means "from the beginning" / "to the end". Numbers, not strings:
  // Svelte binds `<input type="number">` to a number, so treating these as
  // strings and calling .trim() on them throws on the first keystroke.
  let trimStart = $state<number | null>(null);
  let trimEnd = $state<number | null>(null);
  let exportHeight = $state("");

  let languages = $state<Language[]>([]);
  let translateTo = $state("");
  let providerId = $state<ProviderId>("device");
  /**
   * The language being translated *from*.
   *
   * Only the on-device translator needs this: its models are per language
   * pair, so it cannot work it out for itself, and Chrome's separate
   * `LanguageDetector` model is unavailable on many machines. LLM
   * providers infer the source from the text and ignore it.
   */
  let sourceLanguage = $state("auto");
  /**
   * Chrome exposes `LanguageDetector` even where its model is absent, so
   * this is resolved once at startup. When detection is not real, the
   * "detect automatically" option is not offered at all -- an option that
   * always fails is worse than no option.
   */
  let canDetect = $state(true);
  let apiKey = $state("");
  let baseUrl = $state("");
  let providerModel = $state("");
  let translating = $state(false);
  let translateProgress = $state("");
  /**
   * The subtitles as they were before translation.
   *
   * Kept for two reasons. It is what makes burning both languages
   * possible at all -- translation used to overwrite `cues`, so the
   * original was gone the moment it succeeded. And it is what a second
   * translation should start from: translating the translation compounds
   * every error the first pass made, which is what used to happen when
   * someone changed their mind about the target language.
   */
  /**
   * The bytes of an imported subtitle file, kept so the text can be read
   * again under a different encoding. Chinese `.srt` files are frequently
   * GB18030 or Big5, and no amount of sniffing tells the two apart
   * reliably -- so the guess is shown and can be corrected, which needs
   * the original bytes rather than the string they were turned into.
   */
  let subtitleBytes: ArrayBuffer | null = null;
  let subtitleEncoding = $state<string>("utf-8");
  let subtitleEncodingCertain = $state(true);

  let sourceCues = $state<Cue[] | null>(null);
  /** Burn the original alongside the translation. */
  let bilingual = $state(false);
  let bilingualOrder = $state<"original-first" | "translation-first">("original-first");
  /**
   * How large the original is set relative to the translation.
   *
   * Defaults below full size because that is what bilingual subtitles
   * normally look like: the translation is what the viewer is reading and
   * the original is there for reference, so setting both at the same size
   * makes the cue a wall of text and doubles how much picture it covers.
   */
  let originalScale = $state(0.8);
  let translateError = $state<string | null>(null);
  let deviceStatus = $state<string | null>(null);

  let asr = $state<AsrSupport | null>(null);
  let asrEngine = $state("local");
  let asrKey = $state("");
  let asrBaseUrl = $state("");
  let asrRemoteModel = $state("");
  const asrEngineOption = $derived(
    ASR_ENGINES.find((e) => e.id === asrEngine) ?? ASR_ENGINES[0],
  );
  let asrModel = $state(ASR_MODELS[1].id);
  /**
   * Whether the model choice is still the one we picked, not the user's.
   *
   * The default is decided once, when `asrSupport()` comes back and we
   * know whether this machine has WebGPU. Somebody who has already chosen
   * for themselves must not have it changed underneath them.
   */
  let modelChosenByUser = $state(false);
  /**
   * The language being spoken, or "auto" to let Whisper decide.
   *
   * "auto" used to mean English. transformers.js does not implement
   * Whisper's language detection and quietly substitutes `en`, so a
   * Chinese interview came back as confident, fluent, invented English --
   * reported by two people on the same bilingual news clip. It is real
   * detection now, per 30-second window, so one file can hold both
   * languages; this control is for overriding it when it guesses wrong.
   */
  let spokenLanguage = $state("auto");
  /**
   * A second spoken language, when the user knows there are two.
   *
   * Detection is then a choice between two rather than ninety-nine, which
   * is how a bilingual English/Chinese clip came back also reporting
   * Korean. "auto" alone stays the default -- naming the pair is for when
   * you already know it, not a step everyone has to take.
   */
  let secondLanguage = $state("none");
  /** The languages the last transcription actually heard. */
  let spokenFound = $state<string[]>([]);

  /** Those language codes as names a person would recognise. */
  /** "A and B", "A, B and C" -- an English list, not a join. */
  function listOut(items: string[]): string {
    if (items.length < 2) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  }

  /** Naming a second language only means anything beside a first one. */
  const canNameSecond = $derived(asrEngine === "local" && spokenLanguage !== "auto");

  const spokenNames = $derived(
    spokenFound.map((code) => languages.find((l) => l.code.split("-")[0] === code)?.name ?? code),
  );
  let transcribing = $state(false);
  let asrNote = $state("");
  let asrPercent = $state<number | null>(null);
  /**
   * How much longer the transcription has, in words.
   *
   * The clock restarts whenever the engine says it has moved on to
   * something else: reading the audio, fetching each file of the model and
   * listening to it run at wildly different speeds, so one rate averaged
   * across all of them would be wrong at every moment of the job.
   */
  let asrRemaining = $state("");
  let asrPhase = "";
  let asrPhaseStarted = 0;
  let asrError = $state<string | null>(null);
  let asrAbort: AbortController | null = null;

  /**
   * Per-word loudness, measured from the audio during transcription.
   * Empty when the cues came from a subtitle file, since there is nothing
   * tying those words to a moment in the audio.
   */
  let loudness = $state<number[][]>([]);
  /**
   * Which word effect is running, if any.
   *
   * Two genuinely different things, and conflating them is what made the
   * feature read as broken: `loudness` sizes every word once from how loud
   * it was, so the line arrives fully formed and nothing ever moves --
   * which looks like "the whole line is big" rather than an effect.
   * `karaoke` moves a highlight along the line in time with the speech,
   * which is what people picture when they ask for this.
   */
  let wordEffect = $state<"none" | "karaoke" | "loudness">("none");
  const emphasise = $derived(wordEffect === "loudness");
  let emphasisStrength = $state(0.45);
  let karaokeStrength = $state(0.4);
  let karaokeGlow = $state(0.6);
  let karaokeAccent = $state("#FFD400");

  let features = $state<Feature[]>([]);
  let showFeatures = $state(false);
  let copied = $state<string | null>(null);

  let videoFile = $state<File | null>(null);
  let support = $state<BurnSupport | null>(null);
  let burning = $state(false);
  let burnNote = $state("");
  let burnRemaining = $state("");
  /** The file a burn would write, known before it is pressed. */
  const burnWillSave = $derived(
    support?.ok ? burnedFileName(videoName, support.container) : "",
  );
  let burnStartedAt = 0;
  let burnPercent = $state(0);
  let burnError = $state<string | null>(null);
  let burnedUrl = $state<string | null>(null);
  let burnedName = $state("");
  let burnedNote = $state<string | null>(null);
  let burnAbort: AbortController | null = null;

  let preview: Preview | null = null;

  // --- derived -----------------------------------------------------------

  const hasVideo = $derived(!!videoUrl);

  const canTranscribe = $derived(
    hasVideo && !transcribing && (!asrEngineOption.needsKey || asrKey.trim() !== ""),
  );
  /**
   * Dimensions arrive from the element's own `loadedmetadata`, so anything
   * that needs them must wait for it -- and, critically, the `<video>` tag
   * itself must NOT be gated on them. It was, once: the element lived
   * inside `{#if videoWidth > 0}`, so it never rendered, never fired
   * `loadedmetadata`, and never set the width that would have rendered it.
   * A dropped video simply sat there.
   */
  const hasDimensions = $derived(videoWidth > 0 && videoHeight > 0);
  const hasCues = $derived(cues.length > 0);

  /** A translation is on screen, and the text it came from is still held. */
  const canShowBoth = $derived(
    sourceCues !== null && sourceCues.length === cues.length && cues.length > 0,
  );

  /**
   * The cues the text exports and the glyph check work from.
   *
   * The merge belongs to the engine rather than here. Stacking the two
   * line lists in JS was the obvious thing and it is what this did, but
   * the ASS writer undoes a machine's line wrap before stacking -- a cue
   * that arrived wrapped onto two lines otherwise becomes a three-line cue
   * the moment a translation goes under it -- and a `.srt` that merged the
   * lines itself would then disagree with the burned picture.
   */
  const shownCues = $derived.by<Cue[]>(() => {
    if (!bilingual || !canShowBoth || !sourceCues || !engineReady) return cues;
    const original = $state.snapshot(sourceCues);
    const translated = $state.snapshot(cues);
    try {
      return bilingualOrder === "original-first"
        ? mergeBilingualCues(original, translated)
        : mergeBilingualCues(translated, original);
    } catch {
      // The exports must still work if the merge ever refuses.
      return cues;
    }
  });

  /**
   * Characters no bundled font can draw. libass renders these as tofu
   * boxes and reports nothing, so the export looks broken with no
   * explanation -- saying it out loud is the whole point.
   */
  const missingGlyphs = $derived(
    hasCues ? unsupportedCharacters(shownCues.map((c) => c.lines.join(" ")).join(" ")) : [],
  );

  const trim = $derived.by(() => ({
    start: trimStart ?? 0,
    // The engine reads a non-positive end as "to the end of the source".
    end: trimEnd ?? 0,
  }));

  const trimProblem = $derived.by(() => {
    if (!engineReady || !hasDimensions) return "";
    const { start, end } = trim;
    if (!Number.isFinite(start) || (trimEnd !== null && !Number.isFinite(end))) {
      return "Start and end must be numbers of seconds.";
    }
    return clipError(start, end, videoDuration);
  });

  const clipSeconds = $derived(
    engineReady && hasDimensions && !trimProblem
      ? clipLength(trim.start, trim.end, videoDuration)
      : 0,
  );

  const isTrimmed = $derived(trim.start > 0 || trimEnd !== null);

  const activeProvider = $derived(providerById(providerId));

  /** The same cost vocabulary the engine uses, applied to a provider. */
  function providerCost(p: { local: boolean; needsKey: boolean; id: string }) {
    if (p.local) return "free" as const;
    if (p.id === "opensubs") return "paid" as const;
    return "own-key" as const;
  }

  const providerOptions = $derived(
    PROVIDERS.filter((p) => p.id !== "opensubs" || opensubsConfigured()),
  );

  const canTranslateNow = $derived(
    hasCues &&
      translateTo !== "" &&
      !translating &&
      (!activeProvider.needsKey || apiKey.trim() !== ""),
  );

  const heightOptions = $derived(
    [2160, 1440, 1080, 720, 480].filter((h) => videoHeight > 0 && h < videoHeight),
  );

  /** The dimensions an export would encode at, which the ASS is bound to. */
  const outputSize = $derived.by<[number, number]>(() => {
    if (!engineReady || !hasDimensions) return [0, 0];
    return exportSize(videoWidth, videoHeight, exportHeight === "" ? 0 : Number(exportHeight));
  });

  /**
   * The ASS document, regenerated whenever anything it depends on changes.
   *
   * Bound to the *output* size rather than the source size, so what the
   * preview shows is what an export at the chosen resolution would look
   * like -- subtitle size is a percentage of frame height, so a 4K source
   * exported at 720p is not simply the same picture smaller.
   */
  const assDocument = $derived.by(() => {
    if (!engineReady || !hasCues) return "";
    const [w, h] = outputSize;
    if (w === 0) return "";
    const bilingualNow = bilingual && canShowBoth;
    try {
      if (bilingualNow && sourceCues) {
        // The two languages go to the engine as two lists rather than one
        // merged one, so each can be set at its own size -- and so a word
        // effect can run on one of them. Merging them here, which is what
        // this did first, can only ever produce one size and one
        // undifferentiated block of text, because cue text is escaped on
        // the way in.
        const original = $state.snapshot(sourceCues);
        const translated = $state.snapshot(cues);
        const originalFirst = bilingualOrder === "original-first";
        const top = originalFirst ? original : translated;
        const bottom = originalFirst ? translated : original;
        const topScale = originalFirst ? originalScale : 1;
        const bottomScale = originalFirst ? 1 : originalScale;
        // The effect follows the *original*, whichever way round they are
        // stacked: its words are the ones the audio was timed against.
        if (wordEffect === "karaoke") {
          return writeAssBilingualKaraoke(
            top,
            bottom,
            selectedStyle,
            w,
            h,
            topScale,
            bottomScale,
            originalFirst,
            karaokeStrength,
            karaokeGlow,
            karaokeAccent,
          );
        }
        if (emphasise && loudness.length === original.length) {
          return writeAssBilingualEmphasised(
            top,
            bottom,
            selectedStyle,
            w,
            h,
            topScale,
            bottomScale,
            originalFirst,
            loudness,
            emphasisStrength,
          );
        }
        return writeAssBilingual(top, bottom, selectedStyle, w, h, topScale, bottomScale);
      }
      if (wordEffect === "karaoke") {
        return writeAssKaraoke(
          cues,
          selectedStyle,
          w,
          h,
          karaokeStrength,
          karaokeGlow,
          karaokeAccent,
        );
      }
      return emphasise && loudness.length === cues.length
        ? writeAssEmphasised(cues, selectedStyle, w, h, loudness, emphasisStrength)
        : writeAss(shownCues, selectedStyle, w, h);
    } catch {
      return "";
    }
  });

  /**
   * How many cues the emphasis silently declined to touch.
   *
   * The writer drops emphasis for any line whose word count no longer
   * matches the loudness it measured, rather than sliding the sizes onto
   * the wrong words -- which is the right call, but it happens *silently*.
   * Translate a line, or add a word while editing, and the box stays
   * ticked while nothing grows. That is indistinguishable from a broken
   * feature, so the count is surfaced instead of swallowed.
   */
  const emphasisSkipped = $derived.by(() => {
    if (!emphasise || !assDocument) return 0;
    // Counted from the words, not by scanning the output for `{\fs`.
    // That scan worked only because a plain cue carried no override at
    // all, and it stopped meaning anything the moment bilingual cues
    // started stating their size on every line -- it would have reported a
    // confident zero while emphasis quietly did nothing.
    const measured = bilingual && canShowBoth && sourceCues ? sourceCues : cues;
    if (loudness.length !== measured.length) return measured.length;
    return measured.filter(
      (cue, i) => cue.lines.join(" ").split(/\s+/).filter(Boolean).length !== loudness[i].length,
    ).length;
  });

  const burnRequest = $derived({
    input: videoName || "input.mp4",
    output: outputName(videoName),
    width: videoWidth,
    height: videoHeight,
    duration: videoDuration,
    style: selectedStyle,
    start: trim.start,
    end: trim.end,
    targetHeight: exportHeight === "" ? 0 : Number(exportHeight),
    assPath: assName(videoName),
  });

  const cliLine = $derived(
    engineReady && hasDimensions ? safely(() => opensubsCommand(burnRequest)) : "",
  );
  const ffmpegLine = $derived(
    engineReady && hasDimensions && hasCues
      ? safely(() => rawFfmpegCommand(burnRequest))
      : "",
  );

  function safely(fn: () => string): string {
    try {
      return fn();
    } catch {
      return "";
    }
  }

  // --- lifecycle ---------------------------------------------------------

  onMount(async () => {
    // Before anything renders: the stored choice, else what the browser
    // asks for. Called here rather than at module scope because the
    // catalogues are also imported by the extension's engine host, which
    // has no `window` to read a preference from.
    initLocale();
    try {
      await load();
      engineReady = true;
      version = engineVersion();
      styles = listStyles();
      features = listFeatures();
      languages = listLanguages();

      // One client for the whole page, so `<openapps-login>` and this
      // module share a session rather than each holding their own.
      configureAccount();
      onAccountChange(() => {
        session.signedIn = signedIn();
        void refreshBalance();
      });
      session.signedIn = signedIn();
      void refreshBalance();

      // Offer back whatever survived the last visit. Not applied silently:
      // the video cannot come back with it, so a page that simply showed
      // cues over an empty player would look broken. The user is told what
      // is waiting and for which file.
      restored = loadWork();
      // The handle is looked up alongside the cues, so the restore card
      // can offer the video back in the same breath rather than as a
      // second surprise once the subtitles are already on screen.
      if (restored) rememberedVideoHandle = await rememberedVideo();
    } catch (e) {
      engineError = String(e);
    }

    void asrSupport().then((s) => {
      asr = s;
      // APP-32. Small on WebGPU, Base without it.
      //
      // Small is plainly the better recogniser on Chinese: on the reported
      // clip it fixed 抵押区 -> 低压区 and 广网 -> 往往, and 27 differences
      // in all, nearly every one of them in its favour. So the question is
      // only what it costs, and that depends entirely on WebGPU.
      //
      // Without WebGPU the WASM backend cannot load the quantised weights
      // at all and pulls the fp32 export instead -- four times the bytes
      // (see WASM_SIZE_MULTIPLIER). Small would be about a gigabyte before
      // anybody sees a subtitle. With WebGPU it is ~250 MB and roughly an
      // order of magnitude faster to run.
      //
      // So the machines that can afford Small get it, and the ones that
      // cannot are not asked to.
      if (!modelChosenByUser && s.device === "webgpu") {
        const small = ASR_MODELS.find((m) => m.id.includes("whisper-small"));
        if (small) asrModel = small.id;
      }
    });

    void detectionAvailable().then((ok) => {
      canDetect = ok;
      // Chrome exposes the detector interface even where the model is
      // missing, so an unusable "detect automatically" would be the
      // default for most people. Fall back to a visible explicit choice.
      if (!ok && sourceLanguage === "auto") sourceLanguage = "en";
    });
  });

  onDestroy(() => {
    preview?.destroy();
    burnAbort?.abort();
    asrAbort?.abort();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (burnedUrl) URL.revokeObjectURL(burnedUrl);
  });

  // Rebuild the libass renderer when the document changes. `$effect` rather
  // than a call site because the document has several independent inputs
  // (cues, style, output size) and any of them may change.
  /**
   * Which fallback font the current subtitles need. A JASSUB instance
   * fixes that at construction, so when this changes -- translating a
   * Latin track into Chinese, say -- the renderer has to be rebuilt
   * rather than handed a new track, or it keeps the old font and draws
   * tofu boxes.
   */
  let previewFontKey = "";

  $effect(() => {
    const ass = assDocument;
    const el = videoEl;
    if (!el || !ass) {
      preview?.destroy();
      preview = null;
      previewFontKey = "";
      return;
    }

    const key = fontKey(ass);
    if (preview && key === previewFontKey) {
      preview.update(ass);
      return;
    }

    preview?.destroy();
    preview = null;
    previewFontKey = key;
    // Async because the script font is fetched before the renderer is
    // built; a newer run may land first, so only the latest key wins.
    void attachPreview(el, ass)
      .then((next) => {
        if (previewFontKey !== key) {
          next.destroy();
          return;
        }
        preview?.destroy();
        preview = next;
      })
      .catch((e) => console.error("libass preview failed to start", e));
  });

  // --- actions -----------------------------------------------------------

  function outputName(name: string): string {
    const stem = name.replace(/\.[^.]+$/, "") || "output";
    return `${stem}.subbed.mp4`;
  }

  function assName(name: string): string {
    const stem = name.replace(/\.[^.]+$/, "") || "subs";
    return `${stem}.ass`;
  }

  /**
   * What a burn saves.
   *
   * One definition, used both to name the finished file and to say what is
   * coming *before* the button is pressed. The export section offers two
   * quite different things -- a subtitle file and a video -- and reading it
   * top to bottom it was possible to come away thinking the burn produced
   * the `.ass`, which is the first thing the section offers.
   */
  function burnedFileName(name: string, extension: string): string {
    const stem = name.replace(/\.[^.]+$/, "") || "output";
    return `${stem}.subbed.${extension}`;
  }

  /**
   * Show a chosen video, and remember how to find it again.
   *
   * Everything before the assignment is teardown of the *previous* video,
   * and none of it may be allowed to stop the new one appearing -- so it
   * is guarded individually rather than trusted. A failure to destroy a
   * renderer is a leak; a failure to display the file the user just picked
   * is the app looking broken.
   */
  async function loadVideo(file: File, handle: FileSystemFileHandle | null = null) {
    videoError = null;
    try {
      preview?.destroy();
    } catch (e) {
      console.error("tearing down the previous preview failed", e);
    }
    preview = null;
    previewFontKey = "";
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    clearBurned();

    videoFile = file;
    videoUrl = URL.createObjectURL(file);
    videoName = file.name;
    videoWidth = 0;
    videoHeight = 0;
    videoDuration = 0;
    trimStart = null;
    trimEnd = null;
    // Nothing waits on this: whether the video can be offered back after a
    // sign-in is a convenience, and it must not delay showing it now.
    if (handle) void rememberVideo(handle);
    rememberedVideoHandle = null;
    await tick();
  }

  /** Bring back the video the previous visit was working on. */
  async function reopenRememberedVideo() {
    const handle = rememberedVideoHandle;
    if (!handle || reopening) return;
    reopening = true;
    try {
      const file = await reopenVideo(handle);
      if (file) {
        await loadVideo(file, handle);
      } else {
        // Declined, moved, renamed or deleted. All ordinary; the dropzone
        // is right there.
        rememberedVideoHandle = null;
        void forgetVideo();
      }
    } finally {
      reopening = false;
    }
  }

  /**
   * The video picker.
   *
   * Prefers `showOpenFilePicker`, which returns a handle that survives the
   * sign-in redirect. Browsers without it fall through to the plain
   * `<input type=file>` behind this control, which is why the input is
   * still in the markup rather than replaced.
   */
  async function chooseVideo(event: MouseEvent) {
    if (pickerBroken || !canUseHandlePicker()) return; // the <input> takes it
    event.preventDefault();
    try {
      const picked = await pickVideo();
      if (picked) await loadVideo(picked.file, picked.handle);
    } catch (e) {
      // Something unexpected -- a policy, or a browser that claims the
      // method and then throws. The dropzone must not become dead, and it
      // cannot be rescued programmatically: opening a file dialog needs
      // the user's gesture, and this catch runs after an `await`, by which
      // point the gesture is spent. So stand down permanently and say so.
      // The next click reaches the plain <input> and behaves exactly as it
      // always has -- one wasted click, once, instead of a product that
      // will not open a file.
      console.error("showOpenFilePicker failed; using the plain input from now on", e);
      pickerBroken = true;
      videoError = "Could not open the file picker. Click again to choose a video.";
    }
  }

  /**
   * Whether to take the picker over.
   *
   * Checked *before* `preventDefault`, because everything after it is
   * unrecoverable within the same gesture. These are the conditions the
   * File System Access API actually refuses on -- a cross-origin frame, an
   * insecure origin -- so failing them means stepping aside rather than
   * discovering it too late.
   */
  function canUseHandlePicker(): boolean {
    return (
      videoHandlesWork() &&
      window.isSecureContext &&
      window.self === window.top
    );
  }

  function onVideoLoaded() {
    if (!videoEl) return;
    videoWidth = videoEl.videoWidth;
    videoHeight = videoEl.videoHeight;
    videoDuration = videoEl.duration;
    // Ask about the real output size: an encoder can accept 720p and
    // refuse 4K, and finding that out after a long export is no use.
    void burnSupport(outputSize[0] || videoWidth, outputSize[1] || videoHeight).then(
      (s) => (support = s),
    );
  }

  /**
   * Render the style thumbnails.
   *
   * Regenerated when the video or the first cue changes, so the tiles show
   * the user's own footage and their own words rather than a stock sample.
   * Runs are numbered because a second request can start while the first
   * is still walking its twelve presets, and the stale one must not
   * overwrite the fresh one's results.
   */
  /**
   * Coalesce a burst of refresh requests into one.
   *
   * The delay is short enough to feel immediate after a single seek and
   * long enough to swallow a scrub, which arrives as a seek every few
   * frames.
   */
  let thumbnailTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleThumbnails() {
    if (thumbnailTimer !== null) clearTimeout(thumbnailTimer);
    thumbnailTimer = setTimeout(() => {
      thumbnailTimer = null;
      void refreshThumbnails();
    }, 350);
  }

  async function refreshThumbnails() {
    if (styles.length === 0) return;
    if (thumbnailsRunning) {
      // A request arriving mid-run must not be dropped, or the tiles keep
      // showing the previous video's frame and the previous cue's words.
      thumbnailsStale = true;
      return;
    }
    const run = ++thumbnailRun;
    thumbnailsRunning = true;
    thumbnailsBusy = true;
    try {
      // Bounded, whatever happens inside.
      //
      // Every await in the renderer has its own timeout, and yet the
      // "rendering previews..." label was still reported stuck in the
      // field. Rather than keep guessing at which await can hang, this
      // caps the whole operation: the tiles fall back to their colour
      // swatches, which is a visible degradation, instead of a spinner
      // that never stops, which is a broken-looking page.
      //
      // Generous, because twelve libass documents over a large frame is
      // genuinely slow on a modest machine and cutting a working render
      // short would be its own bug.
      const rendered = await Promise.race([
        renderStyleThumbnails({
          styles: styles.map((s) => s.name),
          background: await captureFrame(videoEl),
          aspect: hasDimensions ? { width: videoWidth, height: videoHeight } : undefined,
          text: cues[0]?.lines.join(" "),
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 45000)),
      ]);
      if (run !== thumbnailRun) return;
      if (rendered === null) {
        console.warn("style thumbnails timed out; keeping the previous set");
        return;
      }
      const next: Record<string, string> = {};
      for (const t of rendered) next[t.name] = t.url;
      thumbnails = next;
    } catch (e) {
      // A picker without thumbnails still works -- the tiles fall back to
      // their colour swatch -- so this must never take the page down.
      console.error("style thumbnails failed", e);
    } finally {
      if (run === thumbnailRun) {
        thumbnailsRunning = false;
        thumbnailsBusy = false;
        if (thumbnailsStale) {
          thumbnailsStale = false;
          void refreshThumbnails();
        }
      }
    }
  }

  /**
   * Put the recovered subtitles back.
   *
   * Everything except the video, which cannot be restored -- see
   * `workinprogress.ts`. The style and word effect come back too, because
   * losing those after choosing them is the same annoyance in miniature.
   */
  function resumeWork() {
    if (!restored) return;
    cues = restored.cues;
    loudness = restored.loudness;
    selectedStyle = restored.selectedStyle;
    wordEffect = restored.wordEffect;
    translateTo = restored.translateTo;
    // A translation that cost credits must not need paying for twice
    // because signing in threw the original away.
    sourceCues = restored.sourceCues ?? null;
    bilingual = restored.bilingual ?? false;
    bilingualOrder = restored.bilingualOrder ?? "original-first";
    originalScale = restored.originalScale ?? 0.8;
    restored = null;
  }

  function discardWork() {
    rememberedVideoHandle = null;
    void forgetVideo();
    clearWork();
    restored = null;
  }

  function clearBurned() {
    if (burnedUrl) URL.revokeObjectURL(burnedUrl);
    burnedUrl = null;
    burnedName = "";
    burnedNote = null;
    burnError = null;
    burnPercent = 0;
    burnNote = "";
    burnRemaining = "";
  }

  async function doBurn() {
    if (!videoFile || !assDocument || burning) return;
    clearBurned();
    burning = true;
    burnAbort = new AbortController();
    burnStartedAt = performance.now();
    const [w, h] = outputSize;
    try {
      const result = await burnInBrowser({
        file: videoFile,
        ass: assDocument,
        width: w,
        height: h,
        start: trim.start,
        end: trimEnd,
        signal: burnAbort.signal,
        onProgress: (fraction, note) => {
          burnPercent = Math.round(fraction * 100);
          burnNote = note;
          const left = secondsRemaining((performance.now() - burnStartedAt) / 1000, fraction);
          burnRemaining = left === null ? "" : humanRemaining(left);
        },
      });
      burnedUrl = URL.createObjectURL(result.blob);
      burnedName = burnedFileName(videoName, result.extension);
      burnedNote = result.audioDropped
        ? "The source audio could not be carried into this container, so the export is silent."
        : null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      burnError = message.includes("cancelled") ? null : message;
    } finally {
      burning = false;
      burnAbort = null;
      burnNote = "";
      burnRemaining = "";
    }
  }

  function cancelBurn() {
    burnAbort?.abort();
  }

  async function onVideoInput(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await loadVideo(file);
    } catch (e) {
      videoError = `That video could not be opened: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function onSubtitleInput(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await useSubtitleFile(file);
  }

  /**
   * Read an imported subtitle file, whatever it is encoded in.
   *
   * `file.text()` would decode as UTF-8 unconditionally, which turns every
   * GB18030 or Big5 Chinese subtitle into mojibake -- the app showing
   * `這就是` as `�o�N�O` and calling it a subtitle.
   */
  async function useSubtitleFile(file: File) {
    subtitleError = null;
    try {
      subtitleBytes = await file.arrayBuffer();
      const decoded: Decoded = decodeSubtitles(subtitleBytes);
      subtitleEncoding = decoded.encoding;
      subtitleEncodingCertain = decoded.certain;
      cues = readSubtitles(decoded.text);
      // A file's words are not tied to any moment in this audio.
      loudness = [];
      wordEffect = "none";
      selectedCue = null;
      sourceCues = null;
      bilingual = false;
    } catch (e) {
      cues = [];
      subtitleError = String(e);
    }
  }

  /** Read the same file again, under the encoding the user says it is. */
  function rereadSubtitles(encoding: string) {
    if (!subtitleBytes) return;
    subtitleEncoding = encoding;
    subtitleError = null;
    try {
      cues = readSubtitles(decodeAs(subtitleBytes, encoding));
      sourceCues = null;
      bilingual = false;
    } catch (e) {
      subtitleError = String(e);
    }
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    isDragOver = false;
    // Items carry the handle; `files` does not. Read them first, because
    // `DataTransferItem` is only valid for the duration of the event.
    const items = Array.from(event.dataTransfer?.items ?? []);
    const handles = await Promise.all(
      items.map((item) => (item.kind === "file" ? handleFromDrop(item) : null)),
    );
    const files = Array.from(event.dataTransfer?.files ?? []);
    for (const [i, file] of files.entries()) {
      if (file.type.startsWith("video/")) {
        await loadVideo(file, handles[i] ?? null);
      } else if (/\.(srt|vtt)$/i.test(file.name)) {
        await useSubtitleFile(file);
      }
    }
  }

  function editCue(index: number, text: string) {
    // Split on newlines so a two-line cue stays two lines; the engine's
    // own wrapping only runs when text comes from ASR or a translation.
    cues[index] = { ...cues[index], lines: text.split("\n") };
    cues = [...cues];
  }

  /**
   * Park the playhead on a cue so a change to the subtitles is visible.
   *
   * Toggling emphasis or switching style does nothing you can see if no
   * cue covers the current moment -- and after playing a clip through, the
   * playhead sits at the end, past the last cue. The feature then looks
   * broken when it is working perfectly. Only moves when the current
   * position shows no subtitle at all.
   */
  function showACue() {
    if (!videoEl || cues.length === 0) return;
    const first = cues[0];

    // A highlight that travels along the line cannot be seen on a still
    // frame at all -- pausing on one word looks exactly like sizing that
    // word once. So this effect starts the cue playing rather than parking
    // in the middle of it.
    if (wordEffect === "karaoke") {
      videoEl.currentTime = first.start;
      void videoEl.play();
      return;
    }

    const now = videoEl.currentTime;
    if (cues.some((c) => now >= c.start && now <= c.end)) return;
    videoEl.currentTime = first.start + Math.min(0.4, first.end - first.start) / 2;
  }

  function seekTo(seconds: number) {
    if (videoEl) {
      videoEl.currentTime = seconds;
      void videoEl.play();
    }
  }

  function download(text: string, filename: string, type: string) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
      setTimeout(() => (copied = null), 1600);
    } catch {
      copied = null;
    }
  }

  async function doTranscribe() {
    if (!videoFile || transcribing) return;
    transcribing = true;
    asrError = null;
    asrPercent = null;
    asrRemaining = "";
    spokenFound = [];
    asrPhase = "";
    asrPhaseStarted = performance.now();
    asrAbort = new AbortController();
    try {
      const shared = {
        file: videoFile,
        model: asrModel,
        language: spokenLanguage,
        secondLanguage,
        start: trim.start,
        end: trimEnd,
        signal: asrAbort.signal,
        onProgress: (p: { note: string; fraction: number | null }) => {
          asrPercent = p.fraction === null ? null : Math.round(p.fraction * 100);
          // The clock is keyed on the note, which is the engine saying what
          // it is doing right now: reading the audio, fetching one file of
          // the model, listening. Each runs at its own rate and each starts
          // its own percentage from zero, so carrying one clock across them
          // would divide this piece of work's progress by the previous
          // piece's elapsed time -- and report minutes that mean nothing.
          if (p.note !== asrPhase) {
            asrPhase = p.note;
            asrPhaseStarted = performance.now();
            asrRemaining = "";
          }
          asrNote = p.note;
          const left = secondsRemaining((performance.now() - asrPhaseStarted) / 1000, p.fraction);
          asrRemaining = left === null ? "" : humanRemaining(left);
        },
      };
      const result =
        asrEngine === "local"
          ? await transcribeLocally(shared)
          : await transcribeRemotely({
              ...shared,
              hosted: asrEngine === "opensubs",
              apiKey: asrKey.trim(),
              baseUrl: asrBaseUrl.trim() || asrEngineOption.defaultBaseUrl,
              remoteModel: asrRemoteModel.trim() || asrEngineOption.defaultModel,
            });
      // Cue segmentation is the engine's, shared with the desktop: line
      // breaking, reading-speed caps and frame snapping all happen in the
      // same Rust the CLI runs.
      const { transcript, audio, audioOffset } = result;
      spokenFound = result.languages ?? [];
      // A single spoken language is also the language to translate *from*,
      // and the user should not have to tell us twice. Mixed audio leaves
      // it on "auto", which is the honest answer.
      if (spokenFound.length === 1) {
        const match = languages.find((l) => l.code.split("-")[0] === spokenFound[0]);
        if (match) sourceLanguage = match.code;
      }
      cues = segment(transcript);
      // One file, one script. Whisper has a single `<|zh|>` and writes
      // whichever script it feels like behind it -- measured on a team
      // clip, six changes and 132 Traditional characters inside one set
      // of subtitles, which is not a style but a fault. Normalising is
      // safe to do blind: every substitution is one character for one, so
      // no cue changes length or timing, and text in any other language
      // passes through untouched.
      //
      // Two conditions, both learned the hard way. It used to run only
      // when 简体 was picked by hand, which left every automatically
      // detected Chinese file mixing the two scripts. Running it on
      // everything instead was worse: Japanese is written partly in Han
      // characters and many of them are the Traditional form, so a
      // Japanese lesson video came back with 时, 见 and 后 spliced into
      // its sentences. So: only when Chinese was actually heard, and
      // never when 繁體 was the thing asked for.
      const chinese =
        spokenFound.includes("zh") || isChinese(spokenLanguage) || isChinese(secondLanguage);
      if (chinese && !wantsTraditional(spokenLanguage) && !wantsTraditional(secondLanguage)) {
        cues = await simplify(cues);
      }
      // A fresh transcription is a fresh original; anything held from a
      // previous translation belongs to text that is no longer here.
      sourceCues = null;
      bilingual = false;
      // Nothing was decoded, so there is no encoding to second-guess.
      subtitleBytes = null;
      subtitleEncodingCertain = true;
      loudness = loudnessFor(cues, audio, audioOffset);
      selectedCue = null;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      asrError = message.includes("Cancelled") ? null : message;
    } finally {
      transcribing = false;
      asrAbort = null;
      asrNote = "";
      asrPercent = null;
      asrRemaining = "";
    }
  }

  function cancelTranscribe() {
    asrAbort?.abort();
  }

  async function refreshDeviceStatus() {
    deviceStatus = null;
    if (providerId !== "device" || !translateTo) return;
    const from = sourceLanguage === "auto" ? "en" : sourceLanguage;
    const availability = await deviceAvailability(from, translateTo);
    deviceStatus = availability.ok
      ? availability.needsDownload
        ? "Chrome will download a small language model the first time."
        : null
      : (availability.reason ?? null);
  }

  $effect(() => {
    // Persist the expensive part on every change, so a sign-in redirect --
    // or a crash, or a closed laptop -- costs nothing. Cheap: a few KB of
    // JSON against minutes of transcription.
    saveWork({
      videoName,
      cues: $state.snapshot(cues),
      loudness: $state.snapshot(loudness),
      selectedStyle,
      wordEffect,
      translateTo,
      sourceCues: sourceCues ? $state.snapshot(sourceCues) : undefined,
      bilingual,
      bilingualOrder,
      originalScale,
    });
  });

  $effect(() => {
    // The thumbnails depend on the preset list, a frame of the video and
    // the first cue's text. Reading them here is what subscribes this
    // effect to them.
    const count = styles.length;
    const ready = engineReady;
    void videoName;
    void hasDimensions;
    void videoFrameReady;
    void cues[0]?.lines.join(" ");
    // `untrack` so the reads inside the renderer -- and the state it
    // writes -- cannot feed back into this effect's dependencies.
    // Debounced, not immediate. `videoFrameReady` ticks on every `seeked`,
    // and scrubbing the video -- the natural thing to do while checking
    // subtitles -- fires a burst of them. Each one restarts a walk through
    // twelve presets, every preset awaiting a libass frame, so a few
    // seconds of scrubbing queues more work than the renderer can retire:
    // `thumbnailsStale` is set again before each run ends, the run loops
    // forever, and "rendering previews..." never clears. Coalescing the
    // burst into one run is the whole fix.
    if (ready && count > 0) untrack(() => scheduleThumbnails());
  });

  $effect(() => {
    // Re-check whenever the pair changes; the device translator's models
    // are per language pair.
    void providerId;
    void translateTo;
    void sourceLanguage;
    void refreshDeviceStatus();
  });




  /**
   * What this translation would cost, priced before anything is committed.
   *
   * Derived, so it follows the cue text and the target language without
   * anyone having to press an "estimate" button -- the price is simply on
   * screen, next to the thing it is the price of.
   */
  const translationQuote = $derived.by<Quote | null>(() => {
    if (providerId !== "opensubs" || !translateTo || cues.length === 0) return null;
    try {
      return quoteForTranslation(
        cues.map((c) => c.lines.join(" ")),
        translateTo,
      );
    } catch {
      return null;
    }
  });

  const affordable = $derived(!translationQuote || session.balance >= translationQuote.credits);

  /**
   * Which of the three ways to translate is selected.
   *
   * The five providers collapse into three *routes*, because three is the
   * number of genuinely different bargains on offer: free and private,
   * paid to someone else with your key, or paid to us in credits. Which
   * cloud vendor sits behind the middle one is a detail inside it, not a
   * peer of the other two.
   */
  const translateRoute = $derived(
    providerId === "device" ? "device" : providerId === "opensubs" ? "opensubs" : "key",
  );

  /** The vendor providers, for the picker inside the "your key" route. */
  const keyProviders = $derived(
    providerOptions.filter((p) => p.id !== "device" && p.id !== "opensubs"),
  );

  /** Remembered so switching away from the key route and back returns here. */
  let lastKeyProvider = $state<ProviderId>("claude");

  const translateRoutes = $derived<Route[]>([
    {
      id: "device",
      label: "On this device",
      cost: "free",
      note: "Chrome's built-in translation. Nothing is uploaded and nothing is charged.",
    },
    {
      id: "key",
      label: "Your own API key",
      cost: "own-key",
      costLabel: "You pay them",
      note: "Claude, an OpenAI-compatible server, or DeepL.",
    },
    {
      id: "opensubs",
      label: "OpenSubs",
      cost: "paid",
      note: "Our backend. No key, no account elsewhere.",
      unavailable: opensubsConfigured()
        ? undefined
        : t("Not in this build"),
      price: translationQuote
        ? priceLabel(translationQuote.credits)
        : translateTo
          ? undefined
          : t("Pick a language"),
    },
  ]);

  /**
   * What our backend would charge to transcribe the current clip.
   *
   * Priced on the *trimmed* span, because that is all that gets uploaded.
   * Trimming a twenty-second excerpt out of an hour therefore cuts the
   * price by the same proportion, which is the behaviour anyone would
   * expect and the opposite of what billing the whole file would do.
   */
  const transcriptionQuote = $derived.by<Quote | null>(() => {
    if (!hasVideo) return null;
    // The raw trim state, not `trim` -- that one folds "no end set" to 0
    // for the engine, which would price every untrimmed clip at nothing.
    const span = (trimEnd ?? videoDuration) - (trimStart ?? 0);
    if (!(span > 0)) return null;
    try {
      return quoteForTranscription(span);
    } catch {
      return null;
    }
  });

  const asrRoutes = $derived<Route[]>([
    {
      id: "local",
      label: "On this device",
      cost: "free",
      note: "Whisper runs here. The audio is never uploaded and nothing is charged.",
    },
    {
      id: "openai",
      label: "Your own API key",
      cost: "own-key",
      costLabel: "You pay them",
      // Names the benefit, not the mechanism. "Any Whisper endpoint" is
      // true and tells a user nothing about whether they want it; the
      // browser tops out around 250 MB of model, and that ceiling is the
      // actual reason this column exists.
      note: "A bigger model than a browser can run. Best for long recordings or weak devices.",
    },
    {
      id: "opensubs",
      label: "OpenSubs",
      cost: "paid",
      note: "Our backend. A large model with no key and no account elsewhere.",
      // Priced and ready on the client, but there is no speech vendor
      // behind the gateway yet -- DeepSeek does not transcribe. Shown
      // rather than hidden so the choice is discoverable, and disabled
      // rather than pretending, because a paid button that cannot deliver
      // is worse than an absent one.
      unavailable: opensubsAsrConfigured() ? undefined : t("Not yet available"),
      price: transcriptionQuote
        ? priceLabel(transcriptionQuote.credits)
        : t("Load a video"),
    },
  ]);

  const asrAffordable = $derived(
    asrEngine !== "opensubs" || !transcriptionQuote || session.balance >= transcriptionQuote.credits,
  );

  function pickTranslateRoute(id: string) {
    if (id === "device") providerId = "device";
    else if (id === "opensubs") providerId = "opensubs";
    else providerId = lastKeyProvider;
  }

  /**
   * Every line of every cue in Simplified Chinese, others untouched.
   *
   * `toSimplified` declines any line holding kana or Hangul, so a
   * Japanese caption inside a mixed file keeps its own characters.
   */
  async function simplify(list: Cue[]): Promise<Cue[]> {
    return Promise.all(
      list.map(async (cue) => ({
        ...cue,
        lines: await Promise.all(cue.lines.map((line) => toSimplified(line))),
      })),
    );
  }

  async function doTranslate() {
    if (!canTranslateNow) return;

    translating = true;
    translateError = null;
    translateProgress = "";
    // Always translate the original, never a translation. Re-running with
    // a different target language used to feed the previous output back
    // in, compounding its mistakes; this makes the second attempt as good
    // as the first.
    const from = sourceCues ?? $state.snapshot(cues);
    try {
      const translated = await translateCues({
        cues: from,
        target: translateTo,
        source: sourceLanguage,
        providerId,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || activeProvider.defaultBaseUrl,
        model: providerModel.trim() || activeProvider.defaultModel,
        onProgress: (done, total, note) => {
          translateProgress = `${done}/${total} ${note}`;
        },
      });
      // Only once the translation is in hand: a failed or cancelled run
      // must leave the subtitles exactly as they were.
      sourceCues = from;
      // A translation into Chinese arrives in whichever script the
      // provider chose, and they are no more consistent than the
      // recogniser. Same rule, same reason -- and the same trap, so this
      // asks whether the target is Chinese rather than whether it is not
      // Traditional.
      cues =
        isChinese(translateTo) && !wantsTraditional(translateTo)
          ? await simplify(translated)
          : translated;
      translateProgress = "";
    } catch (e) {
      if (e instanceof NotSignedIn) {
        translateError = t("Sign in to translate on our backend.");
      } else if (e instanceof InsufficientCredits) {
        translateError = `This needs ${creditWord(e.need)} and you have ${e.have}. Add credits below.`;
      } else {
        const message = e instanceof Error ? e.message : String(e);
        translateError = message.includes("Cancelled") ? null : message;
      }
    } finally {
      translating = false;
      translateProgress = "";
      // The gateway charged (or did not), so the authoritative balance is
      // the server's. Re-read rather than adjusting a local copy, which
      // would drift the moment anything else spent from this account --
      // and the same account can be spent from elsewhere.
      void refreshBalance();
    }
  }

  /**
   * The balance, from the server.
   *
   * Never decremented locally. The same account can be spent from other
   * surfaces, so a number this tab computed is a guess; the only true
   * balance is the one the account server reports.
   */
  async function refreshBalance() {
    try {
      session.balance = await fetchBalance();
    } catch {
      // A failed read leaves the last known figure rather than showing
      // zero, which would read as "you have no credits" for a network blip.
    }
  }

  function formatTime(seconds: number): string {
    const total = Math.max(0, seconds);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const ms = Math.round((total % 1) * 100);
    return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
  }

  function formatDuration(seconds: number): string {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
  }
</script>

{#snippet transcribeProgress()}
  <div class="burn-progress">
    <div
      class="progress-track"
      role="progressbar"
      aria-valuenow={asrPercent ?? 0}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        class="progress-fill"
        class:indeterminate={asrPercent === null}
        style:width={asrPercent === null ? "100%" : `${asrPercent}%`}
      ></div>
    </div>
    <span class="oa-mono progress-label">
      {progressLabel(t(asrNote), asrPercent, asrRemaining)}
    </span>
    <button type="button" class="btn btn-ghost btn-sm" onclick={cancelTranscribe}>
      {t("Cancel")}
    </button>
  </div>
{/snippet}

<!--
  Everything needed to run the recogniser: the first time, and the
  fifth. `again` changes only what the button is called. The model,
  the spoken language and the route are the things someone re-runs
  *to* change, so they have to still be here rather than left behind
  on the first attempt.
-->
{#snippet transcribeControls(again: boolean)}
  <RoutePicker
    routes={asrRoutes}
    selected={asrEngine}
    disabled={transcribing}
    onselect={(id) => (asrEngine = id)}
  />

  {#if asrEngine === "opensubs"}
    {@render creditBar(transcriptionQuote, asrAffordable, "Load a video to see the price")}
  {/if}

  {#if asrEngineOption.needsKey}
    <div class="field-row">
      <label class="field field-wide">
        <span class="field-label">{t("API key")}</span>
        <input
          class="input oa-mono"
          type="password"
          placeholder={asrEngineOption.keyPlaceholder}
          autocomplete="off"
          bind:value={asrKey}
        />
      </label>
      <label class="field field-wide">
        <span class="field-label">{t("Server")}</span>
        <input
          class="input oa-mono"
          type="text"
          placeholder={asrEngineOption.defaultBaseUrl}
          bind:value={asrBaseUrl}
        />
      </label>
      <label class="field field-wide">
        <span class="field-label">{t("Model")}</span>
        <input
          class="input oa-mono"
          type="text"
          placeholder={asrEngineOption.defaultModel}
          bind:value={asrRemoteModel}
        />
      </label>
    </div>
  {/if}
  <p class="oa-caption card-intro">
    {#if !hasVideo}
      Load a video first, or open a subtitle file you already have.
    {:else if asrEngine === "local"}
      Whisper runs here, on your machine{asr?.device === "webgpu"
        ? ", on the GPU"
        : ""}. The audio is never uploaded; only the model is downloaded, once.
      {#if asr?.device === "wasm"}
        This browser has no WebGPU, so it runs on the CPU and needs the
        larger full-precision model &mdash; slower, and roughly four times
        the download.
      {/if}
    {:else if asrEngine === "opensubs"}
      Only the trimmed span is uploaded, so shortening the clip lowers
      the price by the same proportion.
    {:else}
      The browser can only run models up to about 250&nbsp;MB. A hosted
      endpoint can run the full-size one, which is markedly better on
      accents, noise and proper nouns &mdash; and far faster on a long
      recording. Works with OpenAI, Groq, or any server of your own.
    {/if}
  </p>
  <!--
    The button comes last, after the route, the price and the
    explanation. It used to sit above all three, which asked the user
    to press "Generate" before the page had told them what it would
    do or what it would cost.
 
    The same controls serve the first run and every one after it. A
    second set, or a "settings" panel kept in step with this one,
    would be two places to change a language and one of them would
    drift.
  -->
  <div class="field-row">
    <button
      type="button"
      class="btn btn-primary btn-sm"
      disabled={!canTranscribe || !asrAffordable}
      onclick={doTranscribe}
    >
      {#if asrEngine === "opensubs" && transcriptionQuote}
        {again
          ? t("Re-generate for {price}", { price: creditWord(transcriptionQuote.credits) })
          : t("Generate for {price}", { price: creditWord(transcriptionQuote.credits) })}
      {:else if again}
        {t("Re-generate")}
      {:else}
        {t("Generate from the audio")}
      {/if}
    </button>
    {#if asrEngine === "local"}
      <label class="field field-wide">
        <span class="field-label">{t("Model")}</span>
        <select
          class="input"
          bind:value={asrModel}
          onchange={() => (modelChosenByUser = true)}
        >
          {#each ASR_MODELS as m (m.id)}
            <option value={m.id}>{t(m.label)} &middot; {m.size}</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="field field-wide">
      <span class="field-label">{t("Spoken language")}</span>
      <select class="input" bind:value={spokenLanguage} disabled={transcribing}>
        <option value="auto">{t("Detect it — any language")}</option>
        {#each languages as l (l.code)}
          <option value={l.code}>{l.endonym} &middot; {l.name}</option>
        {/each}
      </select>
    </label>
    {#if canNameSecond}
      <label class="field field-wide">
        <span class="field-label">{t("Second language")}</span>
        <select class="input" bind:value={secondLanguage} disabled={transcribing}>
          <option value="none">{t("None — only the one above")}</option>
          {#each languages.filter((l) => l.code !== spokenLanguage) as l (l.code)}
            <option value={l.code}>{l.endonym} &middot; {l.name}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>
  <p class="oa-caption card-intro">
    {#if asrEngine === "local"}
      {#if spokenLanguage === "auto"}
        The language is read from the audio every four seconds, so a video
        that switches between two languages is transcribed in both and comes
        out as one subtitle file. If you know which two they are, name them
        &mdash; a choice between two is harder to get wrong than a choice
        between ninety-nine.
      {:else if secondLanguage !== "none"}
        Both are expected, so the audio is still read every four seconds and
        each stretch is transcribed in whichever of the two is being spoken
        &mdash; and it cannot wander off into a third language.
      {:else}
        One language, named, so nothing is detected and nothing can be
        misheard. Add a second if the video switches between two.
      {/if}
    {:else}
      This route sends the whole clip away at once, so it can only be
      transcribed in <em>one</em> language &mdash; detection picks whichever
      is spoken most and puts every other speaker through it. For a video
      that switches between two languages, use <strong>{t("On this device")}</strong>,
      which reads the language every four seconds and transcribes each
      stretch in the language it was actually spoken in.
    {/if}
  </p>
{/snippet}

{#snippet creditBar(quote: Quote | null, ok: boolean, empty: string)}
  <!--
    Balance, price and the way to fix a shortfall, on one line. The only
    question here is "can I do this", and answering it should not need a
    second glance elsewhere on the page. Both the credits and the dollars,
    always: credits are a currency nobody has an instinct for, and a reader
    should not have to go and find the conversion to know whether 26 of them
    is pennies or a month's subscription.
  -->
  <div class="credit-bar">
    {#if session.signedIn}
      <span class="credit-balance">
        <strong>{session.balance}</strong>
        {session.balance === 1 ? "credit" : "credits"} left
        <span class="credit-worth">{usd(session.balance * PRICING_OF().credit_usd)}</span>
      </span>
      {#if quote}
        <span class="credit-price" class:credit-short={!ok}>
          {t("Costs")} <strong>{priceLabel(quote.credits)}</strong>
        </span>
      {:else}
        <span class="oa-caption">{empty}</span>
      {/if}
      <span class="credit-actions">
        <openapps-buy return-to="none"></openapps-buy>
        <openapps-signout></openapps-signout>
      </span>
    {:else}
      <span class="credit-balance">
        {#if quote}
          {t("Costs")} <strong>{priceLabel(quote.credits)}</strong> &mdash;
        {/if}
        sign in to use it
      </span>
      <span class="credit-actions">
        <openapps-login></openapps-login>
      </span>
    {/if}
  </div>
  <p class="oa-caption">
    You are charged the price shown, never more, and only for work that
    succeeds &mdash; a failed job costs nothing. {PRICING_OF().pack_credits} credits
    cost {usd(PRICING_OF().pack_usd)}, and they do not expire.
  </p>
{/snippet}

<svelte:window
  ondragover={(e) => {
    e.preventDefault();
    isDragOver = true;
  }}
  ondragleave={() => (isDragOver = false)}
  ondrop={onDrop}
/>

<main class="screen" class:drag-over={isDragOver}>

  {#if restored}
    <!--
      Signing in navigates away and back, which destroys the tab. This is
      what stops that costing a transcription. The video cannot come with
      it, so the offer is explicit rather than silently applied.
    -->
    <section class="card restore-card">
      <p class="restore-title">
        Your subtitles from <strong>{restored.videoName || "a previous video"}</strong>
        were kept &mdash; {restored.cues.length}
        {restored.cues.length === 1 ? "cue" : "cues"}, saved {describeAge(restored.at)}.
      </p>
      <p class="oa-caption">
        {#if rememberedVideoHandle}
          The video is offered back above &mdash; we kept a pointer to it, never
          a copy, so your browser will ask before opening it.
        {:else}
          Open the video again to carry on. The subtitles come back; the video
          itself cannot, because it never left your machine for us to keep.
        {/if}
      </p>
      <div class="field-row">
        <button type="button" class="btn btn-secondary btn-sm" onclick={resumeWork}>
          {t("Restore subtitles")}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" onclick={discardWork}>
          {t("Discard")}
        </button>
      </div>
    </section>
  {/if}

  {#if engineError}
    <div class="banner banner-danger">
      <Icon name="alert-triangle" />
      <p>The engine failed to load: {engineError}</p>
    </div>
  {:else if !engineReady}
    <div class="banner">
      <p class="oa-caption">{t("Loading the engine…")}</p>
    </div>
  {/if}

  <!-- 1. the video -->
  <section class="card">
    <h2 class="section-title">{t("Video")}</h2>
    {#if hasVideo}
      <div class="stage">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={videoEl}
          src={videoUrl}
          onloadedmetadata={onVideoLoaded}
          onloadeddata={() => (videoFrameReady += 1)}
          onseeked={() => (videoFrameReady += 1)}
          controls
          playsinline
        ></video>
      </div>
      <div class="file-row">
        {#if hasDimensions}
          <p class="oa-caption file-meta">
            <span class="oa-mono">{videoName}</span>
            &middot; {videoWidth}&times;{videoHeight}
            &middot; {formatDuration(videoDuration)}
          </p>
        {:else}
          <p class="oa-caption file-meta">
            <span class="oa-mono">{videoName}</span> &middot; reading&hellip;
          </p>
        {/if}
        <label class="btn btn-ghost btn-sm" class:disabled={burning || transcribing}>
          <input
            type="file"
            accept="video/*"
            onclick={chooseVideo}
            onchange={onVideoInput}
            disabled={burning || transcribing}
            hidden
          />
          {t("Replace video")}
        </label>
      </div>
    {:else}
      {#if rememberedVideoHandle}
        <!--
          Signing in destroys the tab, which used to cost the video as well
          as the subtitles -- and the burn section is gated on the video's
          dimensions, so losing it made the export look like it had been
          taken away. Only the *handle* was kept, never the footage, so
          this asks rather than reaches.
        -->
        <div class="resume-video">
          <Icon name="film" size={18} />
          <p class="resume-video-text">
            You were working on <strong>{rememberedVideoHandle.name}</strong>.
            <span class="oa-caption">
              It never left your machine &mdash; your browser will ask before
              opening it again.
            </span>
          </p>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={reopening}
            onclick={reopenRememberedVideo}
          >
            {reopening ? "Opening…" : "Open it again"}
          </button>
        </div>
      {/if}
      <!--
        `showOpenFilePicker` is preferred because it yields a handle that
        outlives a sign-in redirect; `chooseVideo` steps aside on browsers
        without it, and the plain input below does the work instead.
      -->
      <label class="dropzone">
        <!--
          The handler is on the input, not the label: a label click is
          forwarded here, and so is a keyboard activation of the focused
          input, so one listener covers both and `preventDefault` suppresses
          the native dialog in either case.
        -->
        <input type="file" accept="video/*" onclick={chooseVideo} onchange={onVideoInput} hidden />
        <Icon name="film" size={22} />
        <span>{touchOnly ? t("Choose a video") : t("Drop a video here, or choose one")}</span>
        <span class="oa-caption">{t("It stays on your device. No upload, no account.")}</span>
      </label>
    {/if}
    {#if videoError}
      <p class="field-error">{videoError}</p>
    {/if}
  </section>

  <!-- 2. the subtitles -->
  <section class="card">
    <h2 class="section-title">{t("Subtitles")}</h2>
    {#if hasCues}
      {#if !subtitleEncodingCertain}
        <!--
          The file was not UTF-8 and had no BOM, so the encoding is a
          guess. GB18030 is the right guess for most Chinese subtitle
          files, and a wrong one produces valid, plausible, entirely wrong
          characters rather than anything that looks like an error -- so
          the guess is stated and can be changed.
        -->
        <div class="encoding-row">
          <label class="field">
            <span class="field-label">{t("This file's text encoding")}</span>
            <select
              class="input"
              value={subtitleEncoding}
              onchange={(e) => rereadSubtitles((e.currentTarget as HTMLSelectElement).value)}
            >
              {#each SUBTITLE_ENCODINGS as option (option.id)}
                <option value={option.id}>{t(option.label)}</option>
              {/each}
            </select>
          </label>
          <p class="oa-caption">
            Not Unicode, so this is a guess. If the characters below are wrong,
            pick another &mdash; the file is re-read, nothing is lost.
          </p>
        </div>
      {/if}
      <div class="cue-head">
        <span class="oa-caption">{cues.length} cues</span>
        <label class="btn btn-ghost btn-sm">
          <input type="file" accept=".srt,.vtt,text/vtt" onchange={onSubtitleInput} hidden />
          {t("Replace")}
        </label>
      </div>
      <ol class="cue-list">
        {#each cues as cue, i (i)}
          <li class="cue" class:selected={selectedCue === i}>
            <button
              type="button"
              class="cue-time oa-mono"
              onclick={() => {
                selectedCue = i;
                seekTo(cue.start);
              }}
              title={t("Jump here")}
            >
              {formatTime(cue.start)}
            </button>
            <textarea
              class="cue-text"
              rows={cue.lines.length}
              value={cue.lines.join("\n")}
              oninput={(e) => editCue(i, (e.currentTarget as HTMLTextAreaElement).value)}
              onfocus={() => (selectedCue = i)}
            ></textarea>
          </li>
        {/each}
      </ol>

      <!--
        The same controls again, because the reason to re-run is almost
        always that one of them was wrong: the wrong model for the accent,
        the wrong language, a route that was slower than expected. Sending
        someone back to a screen they can only reach by discarding what
        they have would be a strange way to offer a second attempt.
      -->
      <div class="subsection-head">
        <h3 class="subsection-title">{t("Generate again")}</h3>
      </div>
      {#if transcribing}
        {@render transcribeProgress()}
      {:else if hasVideo}
        <p class="oa-caption card-intro">
          Change anything below and run it again. This replaces the subtitles
          above, including any edits and any translation, so save what you want
          to keep from Export first.
        </p>
        {@render transcribeControls(true)}
      {:else}
        <p class="oa-caption card-intro">
          Load a video to generate subtitles from its audio.
        </p>
      {/if}
      {#if asrError}
        <p class="field-error">{asrError}</p>
      {/if}
    {:else}
      {#if transcribing}
        {@render transcribeProgress()}
      {:else}
        {@render transcribeControls(false)}

        <label class="dropzone dropzone-sm">
          <input type="file" accept=".srt,.vtt,text/vtt" onchange={onSubtitleInput} hidden />
          <Icon name="upload" size={18} />
          <span>{t("Or open an .srt / .vtt you already have")}</span>
        </label>
      {/if}
      {#if asrError}
        <p class="field-error">{asrError}</p>
      {/if}
    {/if}
    {#if subtitleError}
      <p class="field-error">{subtitleError}</p>
    {/if}
  </section>

  {#if hasCues}
    {#if spokenNames.length > 1}
      <!--
        A subtitle file that changes script halfway looks like a fault
        unless something says it is deliberate. It is: the audio changed
        language, and both halves were transcribed in the language they
        were actually spoken in.
      -->
      <div class="banner banner-ok">
        <Icon name="check-circle" />
        <p>
          <strong>{listOut(spokenNames)}</strong>
          {spokenNames.length > 2 ? "were all heard" : "were both heard"}, and the
          subtitles below carry {spokenNames.length > 2 ? "all of them" : "both"}.
          Translating now renders the whole thing into one language, and
          <em>{t("Keep the original on screen too")}</em> shows the translation beside
          what was said.
          {#if spokenLanguage === "auto" && spokenNames.length > 2}
            Three or more is often one of them being misheard &mdash; if you know
            which two are really spoken, name them above and run it again.
          {/if}
        </p>
      </div>
    {/if}
    {#if missingGlyphs.length > 0}
      <div class="banner banner-danger">
        <Icon name="alert-triangle" />
        <p>
          No bundled font can draw
          <span class="oa-mono">{missingGlyphs.slice(0, 12).join(" ")}</span>
          &mdash; these will burn in as empty rectangles. Emoji and rare symbols
          are the usual cause; removing them from the cue text fixes it.
        </p>
      </div>
    {/if}

    <!-- 3. style -->
    <section class="card">
      <div class="subsection-head">
        <h2 class="section-title">{t("Style")}</h2>
        <CostBadge cost="free" />
        {#if thumbnailsBusy}
          <span class="oa-caption">{t("rendering previews…")}</span>
        {/if}
      </div>
      <p class="oa-caption card-intro">
        Every tile is rendered by libass &mdash; the same renderer that burns the
        video{hasDimensions ? ", over a frame of your own footage" : ""}. What you
        pick is what you get.
      </p>
      <div class="style-grid">
        {#each corePresets as style (style.name)}
          <button
            type="button"
            class="style-tile"
            class:selected={selectedStyle === style.name}
            onclick={() => {
              selectedStyle = style.name;
              showACue();
            }}
          >
            {#if thumbnails[style.name]}
              <img class="style-shot" src={thumbnails[style.name]} alt="" loading="lazy" />
            {:else}
              <span
                class="style-shot style-shot-pending"
                style:background={style.primaryHex}
                style:box-shadow={style.borderStyle === "box"
                  ? `inset 0 0 0 4px ${style.backHex}`
                  : `inset 0 0 0 2px ${style.backHex}`}
              ></span>
            {/if}
            <span class="style-name">{style.name}</span>
          </button>
        {/each}
      </div>
      {#if advancedPresets.length > 0}
        <div class="subsection-head">
          <h3 class="subsection-title">{t("Advanced pack")}</h3>
          <CostBadge cost="free" label="Included, free" />
        </div>
        <div class="style-grid">
          {#each advancedPresets as style (style.name)}
            <button
              type="button"
              class="style-tile"
              class:selected={selectedStyle === style.name}
              onclick={() => {
              selectedStyle = style.name;
              showACue();
            }}
            >
              {#if thumbnails[style.name]}
                <img class="style-shot" src={thumbnails[style.name]} alt="" loading="lazy" />
              {:else}
                <span
                  class="style-shot style-shot-pending"
                  style:background={style.primaryHex}
                  style:box-shadow={style.borderStyle === "box"
                    ? `inset 0 0 0 4px ${style.backHex}`
                    : `inset 0 0 0 2px ${style.backHex}`}
                ></span>
              {/if}
              <span class="style-name">{style.name}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if hasCues}
        <div class="subsection-head">
          <h3 class="subsection-title">{t("Word effects")}</h3>
          <CostBadge cost="free" />
        </div>
        <label class="checkbox">
          <input
            type="radio"
            value="none"
            bind:group={wordEffect}
            onchange={showACue}
          />
          <span>{t("None")}</span>
        </label>
        <label class="checkbox">
          <input
            type="radio"
            value="karaoke"
            bind:group={wordEffect}
            onchange={showACue}
          />
          <span>{t("Highlight each word as it is spoken")}</span>
        </label>
        <label class="checkbox" class:disabled={loudness.length === 0}>
          <input
            type="radio"
            value="loudness"
            bind:group={wordEffect}
            disabled={loudness.length === 0}
            onchange={showACue}
          />
          <span>{t("Size every word by how loud it was")}</span>
        </label>
        {#if loudness.length === 0}
          <p class="oa-caption">
            Sizing by loudness needs the audio, so it is offered only for
            subtitles this app transcribed. Highlighting works on any
            subtitles, imported ones included &mdash; it runs off the cue
            timings.
          </p>
        {/if}
        {#if wordEffect === "karaoke"}
          <div class="field-row emphasis-row">
            <label class="field field-wide">
              <span class="field-label">{t("Growth")}</span>
              <input
                class="input range"
                type="range"
                min="0"
                max={emphasisCap()}
                step="0.05"
                bind:value={karaokeStrength}
              />
            </label>
            <label class="field field-wide">
              <span class="field-label">{t("Glow")}</span>
              <input
                class="input range"
                type="range"
                min="0"
                max={glowCap()}
                step="0.05"
                bind:value={karaokeGlow}
              />
            </label>
            <label class="field">
              <span class="field-label">{t("Colour")}</span>
              <input class="input swatch" type="color" bind:value={karaokeAccent} />
            </label>
          </div>
          <p class="oa-caption">
            The whole line stays on screen; the word being spoken grows
            {Math.round(karaokeStrength * 100)}% and gains a glow. Word times are
            shared out across each cue by length &mdash; no speech model here
            reports exact ones &mdash; so the highlight tracks the line's pace
            but can sit a word out.
          </p>
        {/if}
        {#if emphasise}
          <div class="field-row emphasis-row">
            <label class="field field-wide">
              <span class="field-label">{t("Strength")}</span>
              <input
                class="input range"
                type="range"
                min="0.1"
                max={emphasisCap()}
                step="0.05"
                bind:value={emphasisStrength}
              />
            </label>
            <span class="oa-caption">
              {Math.round(emphasisStrength * 100)}% larger at the loudest
            </span>
          </div>
          {#if emphasisSkipped > 0}
            <p class="field-error">
              {emphasisSkipped === cues.length
                ? "No line is being emphasised"
                : `${emphasisSkipped} of ${cues.length} lines are not being emphasised`}
              &mdash; their words no longer match the audio that was measured.
              Translating a line, or adding and removing words while editing,
              breaks that match. Re-run <strong>{t("Generate from the audio")}</strong>
              to measure the current words, or turn emphasis off.
            </p>
          {/if}
          <p class="oa-caption">
            Measured from the audio, so it only applies to subtitles this app
            transcribed. Word timings are approximate &mdash; no speech model here
            reports exact ones &mdash; so emphasis lands on about the right word.
          </p>
        {/if}
      {/if}

    </section>

    <!-- 4. clip and size -->
    {#if hasDimensions}
      <section class="card">
        <h2 class="section-title">{t("Clip & size")}</h2>
        <div class="field-row">
          <label class="field">
            <span class="field-label">{t("Start")}</span>
            <input class="oa-mono input" type="number" min="0" step="0.1" placeholder="0" bind:value={trimStart} />
            <span class="field-unit">sec</span>
          </label>
          <label class="field">
            <span class="field-label">{t("End")}</span>
            <input
              class="oa-mono input"
              type="number"
              min="0"
              step="0.1"
              placeholder={videoDuration.toFixed(1)}
              bind:value={trimEnd}
            />
            <span class="field-unit">sec</span>
          </label>
          <label class="field field-wide">
            <span class="field-label">{t("Resolution")}</span>
            <select class="input" bind:value={exportHeight}>
              <option value="">Source ({videoWidth}&times;{videoHeight})</option>
              {#each heightOptions as h (h)}
                <option value={String(h)}>{h}p</option>
              {/each}
            </select>
          </label>
        </div>
        {#if trimProblem}
          <p class="field-error">{trimProblem}</p>
        {:else if isTrimmed}
          <p class="oa-caption">
            {t("Exporting {clip} of {total}.", { clip: formatDuration(clipSeconds), total: formatDuration(videoDuration) })}
          </p>
        {/if}
      </section>
    {/if}

    <!-- 5. translation -->
    <section class="card">
      <div class="subsection-head">
        <h2 class="section-title">{t("Translate")}</h2>
      </div>
      <p class="oa-caption card-intro">
        Timings are never touched &mdash; only the text inside each cue is replaced,
        and the rewrapping happens in the same engine the desktop uses.
      </p>
      <div class="field-row">
        <label class="field field-wide">
          <span class="field-label">{t("Into")}</span>
          <select class="input" bind:value={translateTo} disabled={translating}>
            <option value="">{t("Don't translate")}</option>
            {#each languages as l (l.code)}
              <option value={l.code}>{l.endonym} &middot; {l.name}</option>
            {/each}
          </select>
        </label>
        {#if activeProvider.local}
          <label class="field field-wide">
            <span class="field-label">{t("Translate from")}</span>
            <select class="input" bind:value={sourceLanguage} disabled={translating}>
              {#if canDetect}
                <option value="auto">{t("Detect automatically")}</option>
              {/if}
              {#each languages as l (l.code)}
                <option value={l.code}>{l.endonym} &middot; {l.name}</option>
              {/each}
            </select>
          </label>
        {/if}
      </div>

      <RoutePicker
        routes={translateRoutes}
        selected={translateRoute}
        disabled={translating}
        onselect={pickTranslateRoute}
      />

      {#if translateRoute === "key"}
        <label class="field field-wide route-detail">
          <span class="field-label">{t("Service")}</span>
          <select
            class="input"
            value={providerId}
            disabled={translating}
            onchange={(e) => {
              providerId = e.currentTarget.value as ProviderId;
              lastKeyProvider = providerId;
            }}
          >
            {#each keyProviders as p (p.id)}
              <option value={p.id}>{t(p.label)}</option>
            {/each}
          </select>
        </label>
        <p class="oa-caption">{t(activeProvider.note)}</p>
      {/if}

      {#if activeProvider.needsKey}
        <div class="field-row">
          <label class="field field-wide">
            <span class="field-label">{t("API key")}</span>
            <input
              class="input oa-mono"
              type="password"
              placeholder={activeProvider.keyPlaceholder}
              autocomplete="off"
              bind:value={apiKey}
              disabled={translating}
            />
          </label>
          {#if activeProvider.needsBaseUrl}
            <label class="field field-wide">
              <span class="field-label">{t("Server")}</span>
              <input
                class="input oa-mono"
                type="text"
                placeholder={activeProvider.defaultBaseUrl}
                bind:value={baseUrl}
                disabled={translating}
              />
            </label>
            <label class="field field-wide">
              <span class="field-label">{t("Model")}</span>
              <input
                class="input oa-mono"
                type="text"
                placeholder={activeProvider.defaultModel}
                bind:value={providerModel}
                disabled={translating}
              />
            </label>
          {/if}
        </div>
        <p class="oa-caption">
          The key stays in this tab. It is sent only to the service you picked, and
          never stored.
        </p>
      {/if}

      {#if providerId === "device" && deviceStatus}
        <p class="oa-caption">{deviceStatus}</p>
      {/if}

      {#if providerId === "opensubs"}
        {@render creditBar(
          translationQuote,
          affordable,
          translateTo ? "Add subtitles to see the price" : "Pick a language to see the price",
        )}
      {/if}

      <div class="checkbox-row">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          disabled={!canTranslateNow || !affordable}
          onclick={doTranslate}
        >
          {#if translating}
            {translateProgress || t("Translating")}
          {:else if translationQuote}
            {t("Translate for {price}", { price: creditWord(translationQuote.credits) })}
          {:else}
            {t("Translate cues")}
          {/if}
        </button>
      </div>
      {#if translateError}
        <p class="field-error">{translateError}</p>
      {/if}

      {#if canShowBoth}
        <!--
          Only offered once there is something to compare: before a
          translation runs there is no second language, and afterwards the
          original is still held rather than overwritten, which is what
          makes this possible at all.
        -->
        <div class="bilingual">
          <label class="checkbox">
            <input type="checkbox" bind:checked={bilingual} />
            <span>{t("Keep the original on screen too")}</span>
          </label>
          {#if bilingual}
            <div class="field-row">
              <label class="field">
                <span class="field-label">{t("Order")}</span>
                <select class="input" bind:value={bilingualOrder}>
                  <option value="original-first">{t("Original on top")}</option>
                  <option value="translation-first">{t("Translation on top")}</option>
                </select>
              </label>
              <label class="field">
                <span class="field-label">{t("Original size")}</span>
                <select class="input" bind:value={originalScale}>
                  <option value={1}>Same as the translation</option>
                  <option value={0.8}>{t("Smaller (80%)")}</option>
                  <option value={0.65}>{t("Much smaller (65%)")}</option>
                </select>
              </label>
            </div>
          {/if}
          <p class="oa-caption">
            {#if bilingual}
              Both languages are burned in, previewed and exported together.
              The .ass carries the sizes; .srt and .vtt are plain text, so they
              carry both languages but not the styling.
            {:else}
              Burn the translation over the original, so viewers get both.
            {/if}
          </p>
          {#if bilingual && wordEffect !== "none"}
            <p class="oa-caption">
              The word effect runs on the <strong>original</strong>, whichever way
              round the two are stacked &mdash; its words are the ones the audio
              was timed against. The translation sits beside it, unhighlighted.
            </p>
          {/if}
        </div>
      {/if}
    </section>

    <!-- 6. export -->
    <section class="card">
      <div class="subsection-head">
        <h2 class="section-title">{t("Export")}</h2>
        <CostBadge cost="free" />
      </div>
      <div class="subsection-head">
        <h3 class="subsection-title">{t("A subtitle file")}</h3>
        <span class="tag">{t("text only")}</span>
      </div>
      <p class="oa-caption card-intro">
        The subtitles on their own, to hand to a player, a platform or an editor
        &mdash; the video is not touched. <strong>.ass</strong> keeps the styling
        you chose here; <strong>.srt</strong> and <strong>.vtt</strong> are plain
        text that everything reads, with none of the styling.
      </p>
      <div class="checkbox-row">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          disabled={!assDocument}
          onclick={() => download(assDocument, assName(videoName), "text/plain")}
        >
          <Icon name="download" size={14} />
          .ass
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onclick={() => download(writeSrt(shownCues), `${videoName.replace(/\.[^.]+$/, "") || "subs"}.srt`, "text/plain")}
        >
          <Icon name="download" size={14} />
          .srt
        </button>
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onclick={() => download(writeVtt(shownCues), `${videoName.replace(/\.[^.]+$/, "") || "subs"}.vtt`, "text/vtt")}
        >
          <Icon name="download" size={14} />
          .vtt
        </button>
      </div>

      {#if hasDimensions}
        <div class="subsection-head">
          <h3 class="subsection-title">{t("A video, with the subtitles burned in")}</h3>
          {#if support?.ok}
            <span class="tag tag-unlocked">
              {support.container === "mp4" ? "MP4 · H.264" : "WebM · VP9"}
            </span>
          {/if}
        </div>

        {#if support && !support.ok}
          <div class="banner banner-danger">
            <Icon name="alert-triangle" />
            <p>{support.reason}</p>
          </div>
        {:else if burnedUrl}
          <div class="burn-done">
            <Icon name="check-circle" size={20} />
            <div class="burn-done-body">
              <p class="success-title">{burnedName}</p>
              {#if burnedNote}
                <p class="oa-caption">{burnedNote}</p>
              {/if}
            </div>
            <div class="success-actions">
              <a class="btn btn-primary btn-sm" href={burnedUrl} download={burnedName}>
                <Icon name="download" size={14} />
                {t("Save")}
              </a>
              <button type="button" class="btn btn-ghost btn-sm" onclick={clearBurned}>
                {t("Burn again")}
              </button>
            </div>
          </div>
        {:else if burning}
          <div class="burn-progress">
            <div
              class="progress-track"
              role="progressbar"
              aria-valuenow={burnPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div class="progress-fill" style:width={`${burnPercent}%`}></div>
            </div>
            <span class="oa-mono progress-label">
              {progressLabel(t(burnNote), burnPercent, burnRemaining)}
            </span>
            <button type="button" class="btn btn-ghost btn-sm" onclick={cancelBurn}>
              {t("Cancel")}
            </button>
          </div>
        {:else}
          <p class="oa-caption card-intro">
            {t("Saves")} <strong class="oa-mono">{burnWillSave}</strong> &mdash; the
            picture with the subtitles drawn into it, so they show up anywhere
            without a subtitle file beside them. Encoded here in the browser with
            WebCodecs; the audio is copied across untouched rather than
            re-encoded, and the subtitles are drawn by libass &mdash; the same
            renderer the preview above uses.
          </p>
          <div class="checkbox-row">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={!assDocument}
              onclick={doBurn}
            >
              {t("Burn subtitles into the video")}
            </button>
          </div>
        {/if}

        {#if burnError}
          <p class="field-error">{burnError}</p>
        {/if}
      {/if}

      {#if cliLine}
        <details class="raw-command">
          <summary class="oa-caption">{t("Prefer to burn it on the command line?")}</summary>
          <p class="oa-caption card-intro">
            The CLI probes the real file, so it gets colour tags, rotation and
            variable frame rate right in ways a browser cannot see. Worth using for
            anything long, or for HDR footage.
          </p>
          <div class="command">
            <code class="oa-mono">{cliLine}</code>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => copy(cliLine, "cli")}>
              {copied === "cli" ? "Copied" : "Copy"}
            </button>
          </div>
          {#if ffmpegLine}
            <div class="command">
              <code class="oa-mono">{ffmpegLine}</code>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onclick={() => copy(ffmpegLine, "ffmpeg")}
              >
                {copied === "ffmpeg" ? "Copied" : "Copy"}
              </button>
            </div>
            <p class="oa-caption">
              Download the .ass above first. This one assumes BT.709 colour, because
              a browser cannot read the file's real tags.
            </p>
          {/if}
        </details>
      {/if}
    </section>
  {/if}

  {#if features.length > 0}
    <section class="card features-card">
      <button
        type="button"
        class="features-toggle"
        onclick={() => (showFeatures = !showFeatures)}
        aria-expanded={showFeatures}
      >
        <h2 class="section-title">{t("What's included")}</h2>
        <span class="oa-caption">{showFeatures ? t("Hide") : t("Everything is unlocked")}</span>
      </button>
      {#if showFeatures}
        <p class="oa-caption card-intro">
          No account, no watermark and no export limit. The badge says what a
          thing costs <em>you</em>; the tier says where this would be paid for
          one day, which is not the same question.
        </p>
        <ul class="feature-list">
          {#each features as f (f.id)}
            <li class="feature-row">
              <span class="feature-title">{f.title}</span>
              <CostBadge cost={f.cost} />
              <span class="oa-caption feature-why">{f.why}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <footer class="web-footer">
    <p class="oa-caption">
      Engine {version} running in WebAssembly &mdash; the same Rust the desktop app
      and CLI use.
    </p>
  </footer>
</main>
