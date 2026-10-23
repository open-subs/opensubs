<script lang="ts">
  import { onMount, onDestroy, tick, untrack } from "svelte";
  import Icon from "./lib/Icon.svelte";
  import { session } from "./lib/session.svelte";
  import CostBadge from "./lib/CostBadge.svelte";
  import RoutePicker, { type Route } from "./lib/RoutePicker.svelte";
  import {
    quoteForTranslation,
    quoteForTranscription,
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
    userId,
    InsufficientCredits,
    NotSignedIn,
    SignInExpired,
  } from "./lib/account";
  import { paidTranslation } from "./lib/paidjobs";
  import { Say } from "./lib/say";
  import { languageFromScript, sameLanguage } from "./lib/sourcelang";
  import AppleCredits from "./lib/AppleCredits.svelte";
  import { appleStore, inNativeShell, mustUseInAppPurchase } from "./lib/native";
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
  import { burnInBrowser, burnSupport, type BurnSupport } from "./lib/burn";
  import {
    exportGateOn,
    primeExportGate,
    markPendingExport,
    pendingExport,
    clearPendingExport,
  } from "./lib/exportgate";
  import ExportGate from "./lib/ExportGate.svelte";
  import { isChinese, toSimplified, wantsTraditional } from "./lib/script";
  import { initLocale, t } from "./lib/i18n/index.svelte";
  import LanguagePicker from "./lib/LanguagePicker.svelte";
  import Rich from "./lib/Rich.svelte";
  import { keepWorkAcrossLanguageLinks } from "./lib/i18n/inplace";
  import { humanRemaining, progressLabel, secondsRemaining } from "./lib/eta";
  import {
    ASR_ENGINES,
    opensubsAsrConfigured,
    ASR_MODELS,
    REMOTE_MODELS,
    asrSupport,
    hasKnownUploadLimit,
    lacksTimestamps,
    loudnessFor,
    remoteUploadSeconds,
    transcribeLocally,
    transcribeRemotely,
    type AsrSupport,
  } from "./lib/asr";
  import { prefersSmallModel } from "./lib/device";
  import {
    PROVIDERS,
    deviceAvailability,
    detectionAvailable,
    opensubsConfigured,
    opensubsRequests,
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
    writeTxt,
    writeVtt,
    fitToFrame,
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
  /**
   * Which video the subtitles on screen were made for.
   *
   * `null` when they belong to no video -- an .srt opened before any video
   * was loaded, which is a real way people use this and must not be
   * treated as a mismatch.
   */
  let cuesVideo = $state<string | null>(null);
  /**
   * The previous video's name, while its subtitles are still on screen
   * after a replace.
   *
   * Kept rather than cleared. Reaching a transcription costs a model
   * download and minutes of waiting, and somebody who replaces the video
   * by accident -- or deliberately, to re-cut the same content -- would
   * lose all of it to a silent tidy-up. So the subtitles stay and the
   * mismatch is stated, with discarding one click away.
   */
  let staleCues = $state<string | null>(null);
  let subtitleError = $state<string | null>(null);
  let selectedCue = $state<number | null>(null);

  let styles = $state<Style[]>([]);
  let selectedStyle = $state("Clean");
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
   * The language the subtitles are in, when something actually said so:
   * the recogniser heard one language, or the person picked it under
   * "Translate from". `sourceLanguage` cannot stand in for this -- it falls
   * back to English wherever the browser cannot detect, which is a default
   * for the device translator's picker, not a fact about the text.
   */
  let knownSource = $state<string | null>(null);
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
  /**
   * The language the subtitles on screen were translated into, or null
   * while they are the original. What tells "this translation is already
   * showing" apart from "this translation is paid for and could be shown".
   */
  let translatedTo = $state<string | null>(null);
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
  /**
   * Some lines came back untranslated. Not an error: everything
   * else was translated and is on screen, so this sits beside the result and
   * says what to do about the rest.
   */
  let translateShortfall = $state<string | null>(null);
  let deviceStatus = $state<string | null>(null);
  /**
   * The session ended without anyone signing out: the panel says so,
   * rather than silently turning into a sign-in prompt.
   */
  let signInExpired = $state(false);
  /** When the person last pressed a sign-out button, to tell the two apart. */
  let signedOutAt = 0;
  /** Bumped when a paid translation lands, so prices re-read what is held. */
  let paidVersion = $state(0);
  /** The top-up packs, opened on request when there is a balance. */
  let topUpOpen = $state(false);

  let asr = $state<AsrSupport | null>(null);
  /**
   * Where the local model runs, when this machine offers a choice.
   *
   * "gpu" follows the machine: WebGPU where there is one. "cpu" is the
   * user's override -- measured faster than WebGPU on an Intel
   * integrated GPU, and the way out on a machine where WebGPU is present
   * and misbehaves. Only offered where WebGPU exists; without it the CPU
   * is the only way this runs and there is nothing to choose.
   */
  let asrBackend = $state<"gpu" | "cpu">("gpu");
  const asrDevice = $derived<"webgpu" | "wasm">(
    asr?.device === "webgpu" && asrBackend === "gpu" ? "webgpu" : "wasm",
  );
  let asrEngine = $state("local");
  let asrKey = $state("");
  let asrBaseUrl = $state("");
  let asrRemoteModel = $state("");
  const asrEngineOption = $derived(
    ASR_ENGINES.find((e) => e.id === asrEngine) ?? ASR_ENGINES[0],
  );

  /**
   * Said before the button, not after the upload.
   *
   * Both of these were previously found out by the service: the user
   * pressed Generate, waited through a decode that on a fourteen-minute
   * video takes over a minute, and got a truncated JSON body back. Both
   * are knowable from what is already on screen -- the model is in a field
   * and the length came off the container when the video loaded -- so
   * there is no reason for either to cost a minute first.
   *
   * asr.ts refuses these as well. This is not the guard; it is the part
   * that means the guard is never reached.
   */
  const asrRouteWarning = $derived.by(() => {
    if (asrEngine === "local" || asrEngine === "opensubs") return "";
    const model = asrRemoteModel.trim() || asrEngineOption.defaultModel || "";
    if (lacksTimestamps(model)) {
      return t(
        "\u201c{model}\u201d writes out speech but does not time it, so it cannot make subtitles. Pick whisper-1, or a Whisper model on Groq.",
        { model },
      );
    }
    const base = asrBaseUrl.trim() || asrEngineOption.defaultBaseUrl || "";
    if (!hasVideo || !hasKnownUploadLimit(base)) return "";
    const span = (trimEnd ?? videoDuration) - (trimStart ?? 0);
    const limit = remoteUploadSeconds();
    if (span > limit) {
      return t(
        "This clip is {length}, and this service takes about {minutes} minutes at a time. Trim it under Clip & size, or use \u201cOn this device\u201d, which has no limit.",
        { length: formatDuration(span), minutes: Math.floor(limit / 60) },
      );
    }
    return "";
  });
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
   * Small where the GPU can carry it, Base everywhere else.
   *
   * Decided from the backend that will actually run, so it follows the GPU /
   * CPU switch as well as the machine, and never over a model the user picked
   * for themselves.
   */
  // Small on WebGPU, Base without it.
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
  //
  // What "can afford" means, refined. On an Intel Iris Xe, WebGPU is present and
  // Small was the slowest thing the machine could be asked to do: 517 s for a
  // 114 s clip, against 250 s for Base on the same GPU and 186 s for Base on
  // the CPU. An integrated Intel GPU now gets Base; discrete cards and Apple
  // silicon keep Small. See ./lib/device.
  function settleDefaultModel() {
    if (modelChosenByUser || !asr) return;
    const small = ASR_MODELS.find((m) => m.id.includes("whisper-small"));
    const base = ASR_MODELS.find((m) => m.id.includes("whisper-base"));
    const pick = prefersSmallModel({ device: asrDevice, integrated: asr.integrated }) ? small : base;
    if (pick) asrModel = pick.id;
  }

  /**
   * The language being spoken, or "auto" to let Whisper decide.
   *
   * "auto" used to mean English. transformers.js does not implement
   * Whisper's language detection and quietly substitutes `en`, so a
   * Chinese interview came back as confident, fluent, invented English --
   * on a bilingual news clip, from more than one machine. It is real
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
  /**
   * The voice detector heard nobody, and is asking rather than refusing.
   *
   * Kept apart from `asrError` because it is not an error: the clip may
   * genuinely be a song, and the answer to that is a button, not a
   * message in red.
   */
  let noSpeechOffer = $state(false);
  /** Set once the reader has said "yes, transcribe it anyway". */
  let ignoreNoSpeech = $state(false);
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
  /** The sign-in sheet in front of exporting a video is open. */
  let exportGateOpen = $state(false);
  /**
   * Back from a sign-in that left the page while an export was waiting:
   * the export starts by itself once the video is open again.
   */
  let exportWaiting = $state(false);

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

  /**
   * Nothing has been opened yet, so the page has exactly one thing to say.
   *
   * It used to say six: the drop zone, three engine cards, a model list, a
   * language list and a second file input were all on screen before there
   * was a video for any of them to act on. Measured against the sibling
   * app with the same shape -- a WASM tool that needs a local file -- 48%
   * of the people who opened this one ever used it, against 89% there. The
   * difference is not taste; it is that the first screen did not say where
   * to begin. Everything below now waits for a video.
   */
  const starting = $derived(!hasVideo && !hasCues);

  /**
   * Tell the page around the app that someone is working.
   *
   * The marketing copy is the site's, not the app's -- it is in the
   * document the app is mounted into, above and below it. It is the
   * right thing to read before you start and pure noise once you have a
   * video open, so the app states the fact and the site's stylesheet
   * decides what to do about it. One attribute rather than the app
   * reaching up and hiding somebody else's elements.
   */
  $effect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.toggleAttribute("data-working", !starting);
  });

  /**
   * Which settings panel is showing, once there are cues to act on.
   *
   * Opens on Style: the moment subtitles first appear, how they look is
   * the next question, and "Generate again" is the least likely one.
   */
  type Panel = "subtitles" | "style" | "clip" | "translate" | "export";
  let panel = $state<Panel>("style");
  /**
   * Whether the Subtitles card has anything in it once there are cues.
   *
   * Generating again needs the video's audio. Without a video -- subtitles
   * restored after a reload, or a file opened on its own -- the card used
   * to hold a heading and a sentence telling you to load a video, with
   * nothing to press. Loading one is the button under the player, so the
   * tab is left out until there is something it can do.
   */
  const subtitlesPanelHasContent = $derived(
    hasVideo || transcribing || !!asrError || !!subtitleError || noSpeechOffer,
  );
  const panelTabs = $derived(
    (
      [
        { id: "subtitles", label: "Subtitles" },
        { id: "style", label: "Style" },
        { id: "clip", label: "Clip & size" },
        { id: "translate", label: "Translate" },
        { id: "export", label: "Export" },
      ] as { id: Panel; label: string }[]
    ).filter((tab) => (tab.id !== "clip" || hasDimensions) && (tab.id !== "subtitles" || subtitlesPanelHasContent)),
  );
  $effect(() => {
    if (!panelTabs.some((tab) => tab.id === panel)) panel = "style";
  });
  /** Without cues there is only the Subtitles card, so no tabs at all. */
  function panelAttrs(id: Panel) {
    if (!hasCues) return {};
    return {
      id: `panel-${id}`,
      role: "tabpanel",
      "aria-labelledby": `tab-${id}`,
      hidden: panel !== id,
    };
  }
  function onPanelKey(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const i = panelTabs.findIndex((tab) => tab.id === panel);
    panel = panelTabs[(i + step + panelTabs.length) % panelTabs.length].id;
    void tick().then(() => document.getElementById(`tab-${panel}`)?.focus());
  }

  /** A translation is on screen, and the text it came from is still held. */
  const canShowBoth = $derived(
    sourceCues !== null && sourceCues.length === cues.length && cues.length > 0,
  );

  /** Whether the text exports carry both languages, one under the other. */
  const exportsBoth = $derived(bilingual && canShowBoth && !!sourceCues && engineReady);

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
    if (!exportsBoth || !sourceCues) return cues;
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

  /**
   * The language the original subtitles are in, as far as anything knows:
   * what was heard or chosen, else what the script alone settles.
   */
  const subtitleLanguage = $derived(
    knownSource ??
      languageFromScript((sourceCues ?? cues).map((c) => c.lines.join(" "))),
  );

  /** Translating into the language the text is already in changes nothing. */
  const sameAsSource = $derived(sameLanguage(subtitleLanguage, translateTo));

  const canTranslateNow = $derived(
    hasCues &&
      translateTo !== "" &&
      !sameAsSource &&
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
      // The frame decides how much one cue may hold. Cues are cut for a
      // broadcast line of 42 characters; the Shorts look on a 1080x1920
      // frame holds about seventeen, and one cue was drawn on six lines
      // over the middle of the picture. A cue too long for two of the
      // frame's lines is split over its own time here, where the frame is
      // known -- the list on the left, and the .srt, keep the cues as cut.
      const framed = (list: Cue[]) => fitToFrame($state.snapshot(list) as Cue[], selectedStyle, w, h);
      if (wordEffect === "karaoke") {
        return writeAssKaraoke(
          framed(cues).cues,
          selectedStyle,
          w,
          h,
          karaokeStrength,
          karaokeGlow,
          karaokeAccent,
        );
      }
      if (emphasise && loudness.length === cues.length) {
        const fitted = framed(cues);
        return writeAssEmphasised(
          fitted.cues,
          selectedStyle,
          w,
          h,
          shareLevels(fitted, loudness),
          emphasisStrength,
        );
      }
      return writeAss(framed(shownCues).cues, selectedStyle, w, h);
    } catch {
      return "";
    }
  });

  /**
   * Per-word loudness for cues that `fitToFrame` may have split: each piece
   * takes the next run of its source cue's levels, a word apiece. A source
   * whose words no longer add up gets no emphasis rather than misplaced
   * emphasis, which is what the writer does with a mismatch anyway.
   */
  function shareLevels(fitted: { cues: Cue[]; origin: number[] }, levels: number[][]): number[][] {
    const used = new Map<number, number>();
    const words = (c: Cue) => c.lines.join(" ").split(/\s+/).filter(Boolean).length;
    return fitted.cues.map((cue, i) => {
      const source = levels[fitted.origin[i]] ?? [];
      const from = used.get(fitted.origin[i]) ?? 0;
      const n = words(cue);
      used.set(fitted.origin[i], from + n);
      return from + n <= source.length ? source.slice(from, from + n) : [];
    });
  }

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

  let stopLanguageLinks: (() => void) | undefined;

  onMount(async () => {
    // Before anything renders: the stored choice, else what the browser
    // asks for. Called here rather than at module scope because the
    // catalogues are also imported by the extension's engine host, which
    // has no `window` to read a preference from.
    initLocale();
    primeExportGate();
    stopLanguageLinks = keepWorkAcrossLanguageLinks(() => !starting);
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
        const now = signedIn();
        // Signed in a moment ago, not now, and nobody pressed sign out:
        // the session ended under the page.
        if (session.signedIn && !now && Date.now() - signedOutAt > 5000) signInExpired = true;
        if (now) signInExpired = false;
        session.signedIn = now;
        paidVersion += 1;
        void refreshBalance();
      });
      session.signedIn = signedIn();
      void refreshBalance();

      // Offer back whatever survived the last visit. Not applied silently:
      // the video cannot come back with it, so a page that simply showed
      // cues over an empty player would look broken. The user is told what
      // is waiting and for which file.
      restored = loadWork();
      // An export was pressed before a sign-in took the page away. The
      // work comes back without asking -- the person already chose to
      // carry on -- and the export waits for the video.
      if (pendingExport()) {
        if (restored) {
          resumeWork();
          exportWaiting = true;
        } else {
          clearPendingExport();
        }
      }
      // The handle is looked up alongside the cues, so the restore card
      // can offer the video back in the same breath rather than as a
      // second surprise once the subtitles are already on screen.
      if (restored) rememberedVideoHandle = await rememberedVideo();
    } catch (e) {
      engineError = String(e);
    }

    void asrSupport().then((s) => {
      asr = s;
      // Firefox, with an adapter that says nothing: start on the
      // CPU, which then settles the model on Base. The switch stays.
      if (s.cpuFirst) asrBackend = "cpu";
      settleDefaultModel();
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
    stopLanguageLinks?.();
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

    // Before videoName is overwritten, and only when the subtitles on
    // screen were actually made for a different video. Exporting
    // them against this one would produce a file whose timings belong to
    // footage that is no longer here.
    staleCues =
      cues.length > 0 && cuesVideo !== null && cuesVideo !== file.name ? cuesVideo : null;

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

  /**
   * Put the next thing to press where it can be seen.
   *
   * Choosing a video swaps the start panel for the player, and the button
   * that acts on it lands roughly 300px below the fold -- so the reward
   * for the first click was a screen that looked unchanged. Scrolls the
   * generate button into view rather than the top of the page, because
   * that button is the next decision.
   *
   * Only when it is actually out of sight. On a tall window everything is
   * already visible, and a page that jumps when it did not need to is its
   * own small insult.
   */
  function showNextStep() {
    if (typeof document === "undefined") return;
    const next = document.querySelector<HTMLElement>("[data-next-step]");
    if (!next) return;
    const box = next.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    // `prefers-reduced-motion` covers people for whom a moving page is a
    // symptom, not a nicety; they still get taken there, instantly.
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    next.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
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
    // Here rather than at the end of `loadVideo`: the player has no height
    // until its metadata arrives, so a scroll computed before this point
    // aims at a document that is about to grow by the height of a video.
    void tick().then(showNextStep);
    // Ask about the real output size: an encoder can accept 720p and
    // refuse 4K, and finding that out after a long export is no use.
    void burnSupport(outputSize[0] || videoWidth, outputSize[1] || videoHeight).then(
      (s) => (support = s),
    );
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
    cuesVideo = restored.videoName || null;
    staleCues = videoName && restored.videoName && restored.videoName !== videoName
      ? restored.videoName
      : null;
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
    // The language the text is in comes back with the text. Without it a
    // restored English transcription was "auto" again: a paid translation
    // was keyed differently and charged a second time, the price did not
    // say it was already paid, and English into English was let through.
    knownSource = restored.knownSource ?? null;
    sourceLanguage = restored.sourceLanguage ?? restored.knownSource ?? sourceLanguage;
    if (sourceLanguage === "auto" && !canDetect) sourceLanguage = knownSource ?? "en";
    translatedTo =
      restored.translatedTo !== undefined
        ? restored.translatedTo
        : restored.sourceCues
          ? restored.translateTo || null
          : null;
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

  /**
   * The export button. Asks for an account first when the switch is on and
   * nobody is signed in; otherwise exactly `doBurn`.
   */
  async function requestBurn() {
    if (!videoFile || !assDocument || burning || exportGateOpen) return;
    if (!signedIn() && (await exportGateOn())) {
      markPendingExport(videoName);
      exportGateOpen = true;
      return;
    }
    void doBurn();
  }

  function closeExportGate() {
    exportGateOpen = false;
    clearPendingExport();
  }

  // Signed in with the sheet open, without leaving the page: carry on.
  $effect(() => {
    if (!exportGateOpen || !session.signedIn) return;
    untrack(() => {
      exportGateOpen = false;
      clearPendingExport();
      void doBurn();
    });
  });

  // Back from a provider, signed in, and the video is open again.
  $effect(() => {
    if (!exportWaiting || !session.signedIn) return;
    if (!videoFile || !assDocument || !hasDimensions || !support?.ok) return;
    untrack(() => {
      if (burning || burnedUrl) return;
      exportWaiting = false;
      clearPendingExport();
      void doBurn();
    });
  });

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

  /**
   * The sample, for someone who has arrived with nothing to try it on.
   *
   * It ships with its own .srt, so pressing this puts styled subtitles
   * over real footage without downloading an 80 MB speech model first --
   * which is the only version of "show me what this does" that answers
   * in under a second.
   *
   * Both files go through exactly the paths a chosen file takes. A
   * preview mode that bypassed `loadVideo` would be a second
   * implementation of the app's own opening sequence, and the first
   * thing a visitor saw would be the one path nothing else tests.
   */
  let loadingSample = $state(false);

  async function trySample() {
    if (loadingSample) return;
    loadingSample = true;
    videoError = null;
    try {
      const [clip, cues] = await Promise.all([
        fetch("sample.mp4").then((r) => r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))),
        fetch("sample.srt").then((r) => r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))),
      ]);
      await loadVideo(new File([clip], "sample.mp4", { type: "video/mp4" }));
      await useSubtitleFile(new File([cues], "sample.srt", { type: "text/plain" }));
    } catch (e) {
      videoError = `The sample could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      loadingSample = false;
    }
  }

  // `?sample` opens it directly, so a link can put someone straight into
  // a working app -- the same affordance the slides studio has.
  $effect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("sample")) return;
    untrack(() => {
      if (!hasVideo && !hasCues && !loadingSample) void trySample();
    });
  });

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
      // Opened deliberately for whatever is loaded now, so this is the
      // video they belong to -- or none, if no video is open yet.
      cuesVideo = videoName || null;
      staleCues = null;
      // A file's words are not tied to any moment in this audio.
      loudness = [];
      wordEffect = "none";
      selectedCue = null;
      sourceCues = null;
      translatedTo = null;
      bilingual = false;
      knownSource = null;
    } catch (e) {
      cues = [];
      cuesVideo = null;
      staleCues = null;
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
      translatedTo = null;
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
    noSpeechOffer = false;
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
        device: asrDevice,
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
          ? await transcribeLocally({ ...shared, allowEmpty: ignoreNoSpeech })
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

      // A clip with nobody speaking in it comes back with a full
      // set of confident subtitles, because the decoder always writes
      // something. Saying so is the whole fix -- an empty subtitle list
      // with no explanation reads as a failure of the app, and a page of
      // invented English over a cooking video reads as a working one.
      // Nobody spoke, so there is nothing to transcribe, and
      // Whisper would have written a confident page of English anyway.
      //
      // An offer rather than a refusal: singing is not speech to the
      // detector, so a music video lands here too, and refusing one
      // outright would be wrong about every music video.
      if (result.noSpeech) {
        noSpeechOffer = true;
        transcribing = false;
        return;
      }

      spokenFound = result.languages ?? [];
      // A single spoken language is also the language to translate *from*,
      // and the user should not have to tell us twice. Mixed audio leaves
      // it on "auto", which is the honest answer.
      knownSource = null;
      if (spokenFound.length === 1) {
        const match = languages.find((l) => l.code.split("-")[0] === spokenFound[0]);
        if (match) {
          sourceLanguage = match.code;
          knownSource = match.code;
        }
      }
      cues = segment(transcript);
      // Made from this video's own audio, so there is no doubt whose they
      // are and nothing left over to warn about.
      cuesVideo = videoName || null;
      staleCues = null;
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
      translatedTo = null;
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
      knownSource,
      sourceLanguage,
      translatedTo,
    });
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
  /**
   * The source language the paid route is told, and keys its jobs by.
   * Only a language something actually established -- never the device
   * picker's fallback, which would tell the model a Korean file is English.
   */
  const paidSource = $derived(knownSource ?? "auto");

  /**
   * What this translation would cost, priced before anything is committed.
   *
   * Priced request by request, as the gateway charges it: each request is
   * rounded up on its own, so pricing the whole file at once under-quoted
   * anything over sixty lines. A request this account has already paid
   * for, and whose answer is still held here, costs nothing -- applying
   * it again sends nothing at all. Priced on the original text, which is
   * what is sent, not on a translation that may be on screen.
   */
  const translationQuote = $derived.by<{ credits: number; paid: boolean } | null>(() => {
    if (providerId !== "opensubs" || !translateTo || cues.length === 0) return null;
    void paidVersion;
    void session.signedIn;
    try {
      const user = session.signedIn ? userId() : null;
      let credits = 0;
      let paid = true;
      for (const request of opensubsRequests(sourceCues ?? cues, translateTo, paidSource)) {
        if (paidTranslation(user, request.key)?.length === request.lines.length) continue;
        paid = false;
        credits += quoteForTranslation(request.lines, translateTo).credits;
      }
      return { credits, paid };
    } catch {
      return null;
    }
  });

  const affordable = $derived(!translationQuote || session.balance >= translationQuote.credits);

  /** The paid translation into the picked language is the one on screen. */
  const paidAndShown = $derived(!!translationQuote?.paid && translatedTo === translateTo);

  /**
   * A language this account has already paid for, picked again: that
   * translation goes straight back on screen. It is held here, so this
   * sends nothing and charges nothing. Pressing a button labelled "free"
   * to get it was a step that looked like a purchase, and pressing it
   * while that translation was already showing did nothing visible.
   *
   * One attempt per pick, so a failure is shown rather than retried in a
   * loop; picking the language again tries again.
   */
  let autoAppliedFor = "";
  $effect(() => {
    if (providerId !== "opensubs" || translating || !translationQuote?.paid) return;
    if (!translateTo || translatedTo === translateTo || sameAsSource) return;
    if (autoAppliedFor === translateTo) return;
    autoAppliedFor = translateTo;
    untrack(() => void doTranslate());
  });
  $effect(() => {
    if (translatedTo === translateTo) autoAppliedFor = "";
  });

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

  // Each card says what the result is like, not how it is produced: the
  // choice a person is making is between a literal line-by-line rendering,
  // a translation written for the whole clip, and a model of their own.
  const translateRoutes = $derived<Route[]>([
    {
      id: "device",
      label: "On this device",
      cost: "free",
      note: "Literal, one sentence at a time · Nothing is uploaded",
    },
    {
      id: "key",
      label: "Your own API key",
      cost: "own-key",
      costLabel: "You pay the provider",
      note: "Choose your model · The provider bills you",
    },
    {
      id: "opensubs",
      label: "OpenSubs",
      cost: "paid",
      note: "Ready to publish · Reads the whole clip for context · Natural wording",
      unavailable: opensubsConfigured()
        ? undefined
        : t("Not in this build"),
      price: translationQuote
        ? translationQuote.paid
          ? t("Already translated · not charged")
          : priceText(translationQuote.credits)
        : translateTo
          ? undefined
          : t("Pick a language"),
    },
  ]);

  /** "1 credit", "8 credits", in the interface's language. */
  function creditsText(n: number): string {
    return t(n === 1 ? "{n} credit" : "{n} credits", { n });
  }

  /** A credit count with its dollar value: `8 credits · $0.04`. */
  function priceText(n: number): string {
    return `${creditsText(n)} · ${usd(n * PRICING_OF().credit_usd)}`;
  }

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
        ? priceText(transcriptionQuote.credits)
        : t("Load a video"),
    },
  ]);

  const asrAffordable = $derived(
    asrEngine !== "opensubs" || !transcriptionQuote || session.balance >= transcriptionQuote.credits,
  );

  function pickTranslateRoute(id: string) {
    if (id === "device") providerId = "device";
    else if (id === "opensubs") {
      providerId = "opensubs";
      // About to spend: make sure the balance and the sign-in on screen
      // are the server's, not whatever they were an hour ago.
      if (session.signedIn) void refreshBalance();
    } else providerId = lastKeyProvider;
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
    translateShortfall = null;
    translateProgress = "";
    // Always translate the original, never a translation. Re-running with
    // a different target language used to feed the previous output back
    // in, compounding its mistakes; this makes the second attempt as good
    // as the first.
    const from = sourceCues ?? $state.snapshot(cues);
    // Read once: the picker can change while the request is out, and the
    // result is in the language that was asked for, not the one shown now.
    const target = translateTo;
    try {
      const translated = await translateCues({
        cues: from,
        target,
        // The device translator needs its picker's answer; everyone else is
        // told only what is known, so a guess never reaches a model.
        source: providerId === "device" ? sourceLanguage : paidSource,
        providerId,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || activeProvider.defaultBaseUrl,
        model: providerModel.trim() || activeProvider.defaultModel,
        onProgress: (done, total, note) => {
          translateProgress = `${done}/${total} ${t(note)}`;
        },
        onShortfall: (missed, total) => {
          translateShortfall = t(
            "{missed} of {total} lines came back untranslated, and are still in the original language. Translating again usually gets them; a larger model misses fewer.",
            { missed, total },
          );
        },
      });
      // Only once the translation is in hand: a failed or cancelled run
      // must leave the subtitles exactly as they were.
      sourceCues = from;
      translatedTo = target;
      // A translation into Chinese arrives in whichever script the
      // provider chose, and they are no more consistent than the
      // recogniser. Same rule, same reason -- and the same trap, so this
      // asks whether the target is Chinese rather than whether it is not
      // Traditional.
      cues =
        isChinese(target) && !wantsTraditional(target)
          ? await simplify(translated)
          : translated;
      translateProgress = "";
    } catch (e) {
      if (e instanceof SignInExpired) {
        signInExpired = true;
        // The SDK may not have noticed yet; the panel must not keep
        // showing a balance for a session that has ended.
        session.signedIn = signedIn();
      }
      if (e instanceof InsufficientCredits) topUpOpen = true;
      translateError = sayError(e);
    } finally {
      translating = false;
      translateProgress = "";
      paidVersion += 1;
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
      // A session the server has ended is dropped by the SDK, and the
      // account listener hears about that on its own.
    }
  }

  /**
   * A failure, in the interface's language.
   *
   * Errors this app raises carry their English text as a catalogue key; a
   * failure from somewhere else -- a vendor's own message -- is shown as
   * the reason inside a sentence that is translated.
   */
  function sayError(e: unknown): string | null {
    if (e instanceof Say) return t(e.key, e.params);
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("Cancelled") || (e instanceof Error && e.name === "AbortError")) return null;
    return t("Translation failed: {reason}", { reason: message });
  }

  /**
   * Re-read the account whenever the page comes back into view, at most
   * once a minute. A session that ended while the tab sat in the
   * background -- signed out elsewhere, or past its month -- shows as
   * ended when the person returns, not when they next try to pay.
   */
  let lastAccountCheck = 0;
  function checkAccountOnReturn() {
    if (document.visibilityState !== "visible" || !session.signedIn) return;
    if (Date.now() - lastAccountCheck < 60_000) return;
    lastAccountCheck = Date.now();
    void refreshBalance();
  }

  /** A press on a sign-out button, so that ending is not taken for expiry. */
  function noteSignOut(event: Event) {
    const tags = ["OPENAPPS-SIGNOUT", "OPENAPPS-ACCOUNT"];
    if (event.composedPath().some((el) => tags.includes((el as Element).tagName))) {
      signedOutAt = Date.now();
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
  <!--
    What a first-time reader has to decide, and nothing else.

    This used to open with three engine cards, a model list with download
    sizes in it, a GPU/CPU choice and four paragraphs of why, all before
    the button that does the thing. The defaults are right for almost
    everybody -- Whisper on this device, the base model, the language
    read from the audio -- so what is left above the fold is the button
    and the one choice a person actually has an opinion about.

    Everything that is a technicality rather than a choice is behind the
    disclosure. Closing it changes nothing: these are the same controls,
    not a second set kept in step with a first.
  -->
  <div class="field-row">
    <button
      type="button"
      class="btn btn-primary"
      data-next-step
      disabled={!canTranscribe || !asrAffordable}
      onclick={doTranscribe}
    >
      {#if asrEngine === "opensubs" && transcriptionQuote}
        {again
          ? t("Re-generate for {price}", { price: creditsText(transcriptionQuote.credits) })
          : t("Generate for {price}", { price: creditsText(transcriptionQuote.credits) })}
      {:else if again}
        {t("Re-generate")}
      {:else}
        {t("Generate from the audio")}
      {/if}
    </button>
    <label class="field field-wide">
      <span class="field-label">{t("Spoken language")}</span>
      <select class="input" bind:value={spokenLanguage} disabled={transcribing}>
        <option value="auto">{t("Detect it — any language")}</option>
        {#each languages as l (l.code)}
          <option value={l.code}>{l.endonym} &middot; {l.name}</option>
        {/each}
      </select>
    </label>
  </div>

  <details class="more">
    <summary>{t("Other settings")}</summary>
    <div class="more-body">
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
            <!--
              A datalist, not a <select>. The column beside this one
              says the route works with "any server of your own", and a closed
              list would make that untrue for every self-hosted endpoint. This
              suggests the four models known to return timings while leaving
              the field exactly as free as it was.
            -->
            <input
              class="input oa-mono"
              type="text"
              list="asr-remote-models"
              placeholder={asrEngineOption.defaultModel}
              bind:value={asrRemoteModel}
            />
            <datalist id="asr-remote-models">
              {#each REMOTE_MODELS as m (m.id)}
                <option value={m.id}>{m.note}</option>
              {/each}
            </datalist>
          </label>
        </div>
        {#if asrRouteWarning}
          <p class="field-error">{asrRouteWarning}</p>
        {/if}
      {/if}
      <p class="oa-caption card-intro">
        {#if !hasVideo}
          {t("Load a video first, or open a subtitle file you already have.")}
        {:else if asrEngine === "local"}
          {asrDevice === "webgpu"
            ? t("Whisper runs here, on your machine, on the GPU. The audio is never uploaded; only the model is downloaded, once.")
            : t("Whisper runs here, on your machine. The audio is never uploaded; only the model is downloaded, once.")}
          {#if asr?.integrated}
            <!-- This hardware was measured: say what it is and what it costs,
                 rather than only quietly choosing the smaller model. -->
            {t(
              "This machine has built-in graphics ({gpu}), which are slow for this work: on one of them a two-minute video took about four minutes with Base and about nine with Small. Base is chosen here for that reason. For anything faster, use your own API key above, which runs a bigger model elsewhere.",
              { gpu: asr.gpu ?? "integrated" },
            )}
          {/if}
          {#if asr?.device === "webgpu" && asrBackend === "cpu"}
            {t("On the processor it needs the larger full-precision model, about four times the download, and the page may stop responding while it works.")}
          {:else if asr?.device === "wasm"}
            {inNativeShell()
              ? t("This device has no WebGPU, so it runs on the CPU and needs the larger full-precision model — slower, and roughly four times the download.")
              : t("This browser has no WebGPU, so it runs on the CPU and needs the larger full-precision model — slower, and roughly four times the download.")}
          {/if}
        {:else if asrEngine === "opensubs"}
          {t("Only the trimmed span is uploaded, so shortening the clip lowers the price by the same proportion.")}
        {:else}
          {inNativeShell()
            ? t("This device can only run models up to about 250 MB. A hosted endpoint can run the full-size one, which is markedly better on accents, noise and proper nouns — and far faster on a long recording. Works with OpenAI, Groq, or any server of your own.")
            : t("The browser can only run models up to about 250 MB. A hosted endpoint can run the full-size one, which is markedly better on accents, noise and proper nouns — and far faster on a long recording. Works with OpenAI, Groq, or any server of your own.")}
        {/if}
      </p>

      <div class="field-row">
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
          {#if asr?.device === "webgpu"}
            <label class="field">
              <span class="field-label">{t("Runs on")}</span>
              <select
                class="input"
                bind:value={asrBackend}
                disabled={transcribing}
                onchange={settleDefaultModel}
              >
                <option value="gpu">{t("Graphics card (GPU)")}</option>
                <option value="cpu">{t("Processor (CPU)")}</option>
              </select>
            </label>
          {/if}
        {/if}
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
            {t("The language is read from the audio every four seconds, so a video that switches between two languages is transcribed in both and comes out as one subtitle file. If you know which two they are, name them — a choice between two is harder to get wrong than a choice between ninety-nine.")}
          {:else if secondLanguage !== "none"}
            {t("Both are expected, so the audio is still read every four seconds and each stretch is transcribed in whichever of the two is being spoken — and it cannot wander off into a third language.")}
          {:else}
            {t("One language, named, so nothing is detected and nothing can be misheard. Add a second if the video switches between two.")}
          {/if}
        {:else}
          <Rich text={t("This route sends the whole clip away at once, so it can only be transcribed in *one* language — detection picks whichever is spoken most and puts every other speaker through it. For a video that switches between two languages, use **{device}**, which reads the language every four seconds and transcribes each stretch in the language it was actually spoken in.", { device: t("On this device") })} />
        {/if}
      </p>
    </div>
  </details>
{/snippet}

{#snippet creditBar(quote: { credits: number; paid?: boolean } | null, ok: boolean, empty: string)}
  <!--
    Balance, price and the way to fix a shortfall, on one line. The only
    question here is "can I do this", and answering it should not need a
    second glance elsewhere on the page. Both the credits and the dollars,
    always: credits are a currency nobody has an instinct for, and a reader
    should not have to go and find the conversion to know whether 26 of them
    is pennies or a month's subscription.

    The credit packs open only when they are the next step: with no balance,
    or not enough for this job. Shown to everyone, they read as a second
    payment to a person who had already bought credits.
  -->
  {@const needsCredits = session.balance <= 0 || !ok}
  <div class="credit-bar">
    {#if session.signedIn}
      <span class="credit-balance">
        <span class="credit-balance-label">{t("Balance")}</span>
        <strong class="credit-balance-count">{creditsText(session.balance)}</strong>
        <span class="credit-worth">{usd(session.balance * PRICING_OF().credit_usd)}</span>
      </span>
      {#if quote}
        <span class="credit-price" class:credit-short={!ok}>
          {#if quote.paid}
            {t("Already translated · not charged")}
          {:else}
            {t("Costs")} <strong>{priceText(quote.credits)}</strong>
          {/if}
        </span>
      {:else}
        <span class="oa-caption">{t(empty)}</span>
      {/if}
      <span class="credit-actions">
        {#if !needsCredits && (!mustUseInAppPurchase() || appleStore())}
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            aria-expanded={topUpOpen}
            onclick={() => (topUpOpen = !topUpOpen)}
          >
            {topUpOpen ? t("Hide top-up") : t("Top up")}
          </button>
        {/if}
        <openapps-signout></openapps-signout>
      </span>
    {:else}
      <span class="credit-balance">
        {#if signInExpired}
          {t("Your sign-in has expired. Sign in again to use your credits.")}
        {:else}
          {#if quote}
            {t("Costs")} <strong>{priceText(quote.credits)}</strong> &mdash;
          {/if}
          {t("sign in to use it")}
        {/if}
      </span>
      <span class="credit-actions">
        <openapps-login></openapps-login>
      </span>
    {/if}
  </div>
  {#if session.signedIn && (needsCredits || topUpOpen)}
    <div class="credit-topup">
      <p class="oa-caption">
        {session.balance <= 0
          ? t("You have no credits yet. Pick a pack to start.")
          : !ok
            ? t("Not enough credits for this job. Pick a pack to top up.")
            : t("Pick a pack to top up.")}
      </p>
      <!--
        Inside the iOS shell credits are Apple's to sell: guideline 3.1.1
        requires in-app purchase, so the card checkout must not be rendered
        there, even for a build whose StoreKit plugin is missing. `return-to`
        "none" is for a page that cannot be returned to.
      -->
      {#if !mustUseInAppPurchase()}
        <openapps-buy return-to={inNativeShell() ? "none" : ""}></openapps-buy>
      {:else if appleStore()}
        <AppleCredits store={appleStore()!} oncredited={() => void refreshBalance()} />
      {/if}
    </div>
  {/if}
  <p class="oa-caption">
    {t("You are charged the price shown, never more, and only for work that succeeds — a failed job costs nothing. {credits} credits cost {price}, and they do not expire.", { credits: PRICING_OF().pack_credits, price: usd(PRICING_OF().pack_usd) })}
  </p>
{/snippet}

<svelte:document onvisibilitychange={checkAccountOnReturn} />

<svelte:window
  onfocus={checkAccountOnReturn}
  onclickcapture={noteSignOut}
  ondragover={(e) => {
    e.preventDefault();
    isDragOver = true;
  }}
  ondragleave={() => (isDragOver = false)}
  ondrop={onDrop}
/>

{#snippet noSpeechNotice()}
  <!--
    The detector found no voice in the clip. Whisper would have
    written a page of confident English over it, which is the fault this
    replaces -- but singing is not speech to the detector either, so this
    asks rather than refuses.
  -->
  <div class="no-speech">
    <p>{t("No voice was found in this clip, so no subtitles were made.")}</p>
    <p class="oa-caption">
      {t("Whisper writes something for any sound, so a clip with only music or background noise comes back full of sentences nobody said. Singing does not count as speech here either — if this is a song, go ahead.")}
    </p>
    <button
      type="button"
      class="btn btn-secondary btn-sm"
      onclick={() => { ignoreNoSpeech = true; noSpeechOffer = false; doTranscribe(); }}
    >
      {t("Transcribe it anyway")}
    </button>
  </div>
{/snippet}

<main class="screen" class:drag-over={isDragOver}>

  {#if exportGateOpen}
    <ExportGate onclose={closeExportGate} />
  {/if}

  {#if exportWaiting && session.signedIn && !videoFile}
    <div class="banner" data-export-waiting>
      <Icon name="check-circle" />
      <p>{t("Signed in. Open the video again and the export starts by itself.")}</p>
    </div>
  {/if}

  {#if restored}
    <!--
      Signing in navigates away and back, which destroys the tab. This is
      what stops that costing a transcription. The video cannot come with
      it, so the offer is explicit rather than silently applied.
    -->
    <section class="card restore-card">
      <p class="restore-title">
        <Rich text={t(restored.cues.length === 1
          ? "Your subtitles from **{name}** were kept — {n} cue, saved {age}."
          : "Your subtitles from **{name}** were kept — {n} cues, saved {age}.", {
          name: restored.videoName || t("a previous video"),
          n: restored.cues.length,
          age: describeAge(restored.at),
        })} />
      </p>
      <p class="oa-caption">
        {#if rememberedVideoHandle}
          {t("The video is offered back above — we kept a pointer to it, never a copy, so your browser will ask before opening it.")}
        {:else}
          {t("Open the video again to carry on. The subtitles come back; the video itself cannot, because it never left your machine for us to keep.")}
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
      <p>{t("The engine failed to load: {error}", { error: engineError })}</p>
    </div>
  {:else if !engineReady}
    <div class="banner">
      <p class="oa-caption">{t("Loading the engine…")}</p>
    </div>
  {/if}

  <!-- 1. the video -->
  {#if starting}
    <section class="card card-start">
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
              <Rich text={t("You were working on **{name}**.", { name: rememberedVideoHandle.name })} />
              <span class="oa-caption">
                {t("It never left your machine — your browser will ask before opening it again.")}
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
          Two columns, and one job: open a video. What to say on the left,
          where to put the file on the right.

          `showOpenFilePicker` is preferred because it yields a handle that
          outlives a sign-in redirect; `chooseVideo` steps aside on browsers
          without it, and the plain input inside each label does the work.
        -->
        <!--
        One column, one dominant button.

        This was two columns with a drop target beside the buttons, and
        the drop target competed with the thing people should press. The
        report from the team was that they landed and could not tell what
        to do -- so there is now one control with any visual weight on
        this screen, and the page takes a drop anywhere rather than
        asking for a particular rectangle.
      -->
      <div class="start">
        <h3 class="start-title">{t("Start with a video")}</h3>
        <p class="start-sub">
          {t("Its speech becomes subtitles here, on this machine. Nothing is uploaded.")}
        </p>
        <!--
          Beside the button, not under it: someone with nothing to try
          this on has the same problem as someone with a file, and the
          two ways out of it belong on the same line. A ghost button, so
          it reads as the second choice.
        -->
        <div class="start-row">
          <label class="btn btn-primary start-primary">
            <input
              type="file"
              accept="video/*"
              aria-label={t("Choose a video")}
              onclick={chooseVideo}
              onchange={onVideoInput}
              hidden
            />
            <Icon name="film" size={20} />
            {t("Choose a video")}
          </label>
          <button
            type="button"
            class="btn btn-secondary start-sample"
            disabled={loadingSample}
            onclick={trySample}
          >
            {loadingSample ? t("Opening…") : t("Try a sample")}
          </button>
        </div>
        <p class="start-drop-hint">{t("or drop one anywhere on this page")}</p>
        <div class="start-alt">
          <!--
            The shortest path through the product -- someone who already
            has a subtitle file waits for no model at all -- but a
            second-rank one, so it reads as a link rather than a rival
            button.
          -->
          <label class="start-alt-link">
            <input
              type="file"
              accept=".srt,.vtt,text/vtt"
              aria-label={t("Open an .srt or .vtt")}
              onchange={onSubtitleInput}
              hidden
            />
            {t("Already have subtitles? Open an .srt or .vtt")}
          </label>
        </div>
        <p class="start-fine">
          {t("MP4, MOV, WebM and MKV. Free, no account. The speech model downloads once, when you generate.")}
        </p>
      </div>
      {#if videoError}
        <p class="field-error">{videoError}</p>
      {/if}
    </section>
  {:else}
    <!--
      Two columns once there is something to work on: what you can change
      on the left, what you are changing on the right.

      Stacked, this was three and a half screens of cards, and the video
      was at the top of it -- so choosing a style meant scrolling down to
      the picker and back up to see what it did. The preview is sticky
      now, which is the whole point of the split: the thing the settings
      act on stays in front of you while you change them.

      The output comes first in the source so that a narrow screen, which
      gets one column, shows the video before the controls for it.
    -->
    <div class="workspace">
      <div class="workspace-output">
            <div class="stage" class:stage-empty={!hasVideo}>
              <!-- svelte-ignore a11y_media_has_caption -->
              <video
                bind:this={videoEl}
                src={videoUrl}
                onloadedmetadata={onVideoLoaded}
                controls
                playsinline
                hidden={!hasVideo}
              ></video>
              {#if !hasVideo}
                <!--
                  Subtitles with no video under them: restored after a reload
                  or a sign-in, or a subtitle file opened on its own. The
                  player used to sit here empty, captioned "reading…" for ever,
                  which reads as a page still loading rather than one waiting
                  for you. It says what is missing and offers the way back.
                -->
                <div class="no-video" data-no-video>
                  <Icon name="film" size={22} />
                  <p class="no-video-title">
                    {cuesVideo
                      ? t("Subtitles restored. To burn them in, load the video again.")
                      : t("To preview these subtitles and burn them in, load their video.")}
                  </p>
                  {#if cuesVideo}
                    <p class="oa-caption">
                      <Rich text={t("They were made for **{name}**. The video never left your device, so it cannot come back on its own.", { name: cuesVideo })} />
                    </p>
                  {/if}
                  <div class="field-row no-video-actions">
                    {#if rememberedVideoHandle}
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        disabled={reopening}
                        onclick={reopenRememberedVideo}
                      >
                        {reopening ? t("Opening…") : t("Open {name} again", { name: rememberedVideoHandle.name })}
                      </button>
                    {/if}
                    <label class="btn btn-sm" class:btn-primary={!rememberedVideoHandle} class:btn-secondary={!!rememberedVideoHandle}>
                      <input
                        type="file"
                        accept="video/*"
                        onclick={chooseVideo}
                        onchange={onVideoInput}
                        hidden
                      />
                      {cuesVideo ? t("Load the video again") : t("Load video")}
                    </label>
                  </div>
                </div>
              {/if}
            </div>
            <div class="file-row">
              {#if !hasVideo}
                <p class="oa-caption file-meta">{t("No video loaded")}</p>
              {:else if hasDimensions}
                <p class="oa-caption file-meta">
                  <span class="oa-mono">{videoName}</span>
                  &middot; {videoWidth}&times;{videoHeight}
                  &middot; {formatDuration(videoDuration)}
                </p>
              {:else}
                <p class="oa-caption file-meta">
                  <span class="oa-mono">{videoName}</span> &middot; {t("reading…")}
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
                {hasVideo ? t("Replace video") : t("Load video")}
              </label>
            </div>
        {#if videoError}
          <p class="field-error">{videoError}</p>
        {/if}
        {#if hasCues}
          <div class="cue-panel">
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
                  {t("Not Unicode, so this is a guess. If the characters below are wrong, pick another — the file is re-read, nothing is lost.")}
                </p>
              </div>
            {/if}
            <div class="cue-head">
              <span class="oa-caption">{t(cues.length === 1 ? "{n} cue" : "{n} cues", { n: cues.length })}</span>
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
          </div>
        {/if}
      </div>

      <div class="workspace-controls">
        {#if hasCues}
          <!--
            One panel at a time once there is something to adjust. Stacked,
            the five cards ran to several screens and Export sat at the very
            bottom; as tabs the whole column fits beside the video, and
            nothing is further away than one click.
          -->
          <div class="panel-tabs" role="tablist">
            {#each panelTabs as tab (tab.id)}
              <button
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-controls={`panel-${tab.id}`}
                aria-selected={panel === tab.id}
                tabindex={panel === tab.id ? 0 : -1}
                class="panel-tab"
                class:selected={panel === tab.id}
                onclick={() => (panel = tab.id)}
                onkeydown={onPanelKey}
              >
                {t(tab.label)}
              </button>
            {/each}
          </div>
        {/if}
        <section class="card" {...panelAttrs("subtitles")}>
          <h2 class="section-title">{t("Subtitles")}</h2>
          {#if hasCues}

          <!--
            The same controls again, because the reason to re-run is almost
            always that one of them was wrong: the wrong model for the accent,
            the wrong language, a route that was slower than expected. Sending
            someone back to a screen they can only reach by discarding what
            they have would be a strange way to offer a second attempt.
          -->
          {#if transcribing || hasVideo}
            <div class="subsection-head">
              <h3 class="subsection-title">{t("Generate again")}</h3>
            </div>
          {/if}
          {#if transcribing}
            {@render transcribeProgress()}
          {:else if hasVideo}
            <p class="oa-caption card-intro">
              {t("Change anything below and run it again. This replaces the subtitles above, including any edits and any translation, so save what you want to keep from Export first.")}
            </p>
            {@render transcribeControls(true)}
          {/if}
          {#if noSpeechOffer}
            {@render noSpeechNotice()}
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
          {#if noSpeechOffer}
            {@render noSpeechNotice()}
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
            <Rich text={t(spokenNames.length > 2
              ? "**{names}** were all heard, and the subtitles below carry all of them. Translating now renders the whole thing into one language, and *{keep}* shows the translation beside what was said."
              : "**{names}** were both heard, and the subtitles below carry both. Translating now renders the whole thing into one language, and *{keep}* shows the translation beside what was said.", {
              names: listOut(spokenNames),
              keep: t("Keep the original on screen too"),
            })} />
            {#if spokenLanguage === "auto" && spokenNames.length > 2}
              {t("Three or more is often one of them being misheard — if you know which two are really spoken, name them above and run it again.")}
            {/if}
          </p>
        </div>
      {/if}
      {#if missingGlyphs.length > 0}
        <div class="banner banner-danger">
          <Icon name="alert-triangle" />
          <p>
            {t("No bundled font can draw")}
            <span class="oa-mono">{missingGlyphs.slice(0, 12).join(" ")}</span>
            &mdash; {t("these will burn in as empty rectangles. Emoji and rare symbols are the usual cause; removing them from the cue text fixes it.")}
          </p>
        </div>
      {/if}

      <!-- 3. style -->
      <section class="card" {...panelAttrs("style")}>
        <div class="subsection-head">
          <h2 class="section-title">{t("Style")}</h2>
          <CostBadge cost="free" />
        </div>
        <!--
          A name, and the video above it.

          The twelve presets used to be laid out here as twelve rendered
          tiles, which meant the panel spent most of its height showing
          stills of footage the reader was already looking at, and the
          choice had to be made by comparing thumbnails rather than by
          seeing the thing itself. Picking a name re-renders the preview
          over the real frame immediately, which is the only comparison
          that settles it. The twelve, side by side and full size, are on
          /styles, where there is room for them.
        -->
        <div class="field-row">
          <label class="field field-wide">
            <span class="field-label">{t("Preset")}</span>
            <select
              class="input"
              value={selectedStyle}
              onchange={(e) => {
                selectedStyle = (e.currentTarget as HTMLSelectElement).value;
                showACue();
              }}
            >
              <optgroup label={t("Core")}>
                {#each corePresets as style (style.name)}
                  <option value={style.name}>{style.name}</option>
                {/each}
              </optgroup>
              {#if advancedPresets.length > 0}
                <optgroup label={t("Advanced pack")}>
                  {#each advancedPresets as style (style.name)}
                    <option value={style.name}>{style.name}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>
          </label>
          <a class="btn btn-ghost btn-sm" href="/styles" target="_blank" rel="noopener">
            {t("See all twelve")}
          </a>
        </div>
        <p class="oa-caption card-intro">
          {hasDimensions
            ? t("The preview above is libass, the same renderer that burns the video. What you see is what you get.")
            : t("Rendered by libass, the same renderer that burns the video. What you see is what you get.")}
        </p>
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
              {t("Sizing by loudness needs the audio, so it is offered only for subtitles this app transcribed. Highlighting works on any subtitles, imported ones included — it runs off the cue timings.")}
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
              {t("The whole line stays on screen; the word being spoken grows {pct}% and gains a glow. Word times are shared out across each cue by length — no speech model here reports exact ones — so the highlight tracks the line's pace but can sit a word out.", { pct: Math.round(karaokeStrength * 100) })}
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
                {t("{pct}% larger at the loudest", { pct: Math.round(emphasisStrength * 100) })}
              </span>
            </div>
            {#if emphasisSkipped > 0}
              <p class="field-error">
                {emphasisSkipped === cues.length
                  ? t("No line is being emphasised")
                  : t("{skipped} of {total} lines are not being emphasised", { skipped: emphasisSkipped, total: cues.length })}
                &mdash; <Rich text={t("their words no longer match the audio that was measured. Translating a line, or adding and removing words while editing, breaks that match. Re-run **{button}** to measure the current words, or turn emphasis off.", { button: t("Generate from the audio") })} />
              </p>
            {/if}
            <p class="oa-caption">
              {t("Measured from the audio, so it only applies to subtitles this app transcribed. Word timings are approximate — no speech model here reports exact ones — so emphasis lands on about the right word.")}
            </p>
          {/if}
        {/if}

      </section>

      <!-- 4. clip and size -->
      {#if hasDimensions}
        <section class="card" {...panelAttrs("clip")}>
          <h2 class="section-title">{t("Clip & size")}</h2>
        <details class="more">
          <summary>{t("Other settings")}</summary>
          <div class="more-body">
            <div class="field-row">
              <label class="field">
                <span class="field-label">{t("Start")}</span>
                <input class="oa-mono input" type="number" min="0" step="0.1" placeholder="0" bind:value={trimStart} />
                <span class="field-unit">{t("sec")}</span>
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
                <span class="field-unit">{t("sec")}</span>
              </label>
              <label class="field field-wide">
                <span class="field-label">{t("Resolution")}</span>
                <select class="input" bind:value={exportHeight}>
                  <option value="">{t("Source ({size})", { size: `${videoWidth}×${videoHeight}` })}</option>
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
                  </div>
        </details>
      </section>
      {/if}

      <!-- 5. translation -->
      <section class="card" {...panelAttrs("translate")}>
        <div class="subsection-head">
          <h2 class="section-title">{t("Translate")}</h2>
        </div>
        <p class="oa-caption card-intro">
          {t("Timings are never touched — only the text inside each cue is replaced, and the rewrapping happens in the same engine the desktop uses.")}
        </p>
        <div class="field-row">
          <label class="field field-wide">
            <span class="field-label">{t("Into")}</span>
            <select class="input" bind:value={translateTo} disabled={translating}>
              <option value="">{t("Don't translate")}</option>
              {#each languages as l (l.code)}
                {@const same = sameLanguage(subtitleLanguage, l.code)}
                <option value={l.code} disabled={same}>
                  {l.endonym} &middot; {l.name}{same ? ` — ${t("the subtitles' language")}` : ""}
                </option>
              {/each}
            </select>
          </label>
          {#if activeProvider.local}
            <label class="field field-wide">
              <span class="field-label">{t("Translate from")}</span>
              <select
                class="input"
                bind:value={sourceLanguage}
                disabled={translating}
                onchange={() => (knownSource = sourceLanguage === "auto" ? null : sourceLanguage)}
              >
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
            {t("The key stays in this tab. It is sent only to the service you picked, and never stored.")}
          </p>
        {/if}

        {#if sameAsSource}
          <p class="field-error">
            {t("The subtitles are already in this language, so there is nothing to translate. Pick another language.")}
          </p>
        {/if}

        {#if providerId === "device" && deviceStatus}
          <p class="oa-caption">{t(deviceStatus)}</p>
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
            disabled={!canTranslateNow || !affordable || paidAndShown}
            onclick={doTranslate}
          >
            {#if translating}
              {translateProgress || t("Translating")}
            {:else if translationQuote?.paid}
              {t("Already translated · not charged")}
            {:else if translationQuote}
              {t("Translate · {price}", { price: creditsText(translationQuote.credits) })}
            {:else}
              {t("Translate cues")}
            {/if}
          </button>
        </div>
        {#if translateShortfall}
          <p class="oa-caption">{translateShortfall}</p>
        {/if}
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
                    <option value={1}>{t("Same as the translation")}</option>
                    <option value={0.8}>{t("Smaller (80%)")}</option>
                    <option value={0.65}>{t("Much smaller (65%)")}</option>
                  </select>
                </label>
              </div>
            {/if}
            <p class="oa-caption">
              {#if bilingual}
                {t("Both languages are burned in, previewed and exported together. The .ass carries the sizes; .srt and .vtt are plain text, so they carry both languages but not the styling.")}
              {:else}
                {t("Burn the translation over the original, so viewers get both.")}
              {/if}
            </p>
            {#if bilingual && wordEffect !== "none"}
              <p class="oa-caption">
                <Rich text={t("The word effect runs on the **original**, whichever way round the two are stacked — its words are the ones the audio was timed against. The translation sits beside it, unhighlighted.")} />
              </p>
            {/if}
          </div>
        {/if}
      </section>

      <!-- 6. export -->
      <section class="card" {...panelAttrs("export")}>
        <div class="subsection-head">
          <h2 class="section-title">{t("Export")}</h2>
          <CostBadge cost="free" />
        </div>
        <!--
          Burning comes first and is always here. It used to appear only once
          a video had loaded, so with subtitles alone -- restored after a
          reload, or opened from a file -- the export offered text files and
          nothing else, and the one place the word "burn" appeared was a
          caption about bilingual subtitles.
        -->
        <div class="subsection-head">
          <h3 class="subsection-title">{t("A video, with the subtitles burned in")}</h3>
          {#if hasDimensions && support?.ok}
            <span class="tag tag-unlocked">
              {support.container === "mp4" ? "MP4 · H.264" : "WebM · VP9"}
            </span>
          {/if}
        </div>
        {#if !hasVideo}
          <p class="oa-caption card-intro">
            {t("The picture with the subtitles drawn into it, so they show up anywhere without a subtitle file beside them. It needs the video they belong to.")}
          </p>
          <div class="checkbox-row">
            <label class="btn btn-primary btn-sm" data-load-for-burn>
              <input type="file" accept="video/*" onclick={chooseVideo} onchange={onVideoInput} hidden />
              {t("Load the video first")}
            </label>
          </div>
        {:else if !hasDimensions}
          <p class="oa-caption card-intro">{t("reading…")}</p>
        {/if}
        {#if hasDimensions}

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
              {t("Saves")} <strong class="oa-mono">{burnWillSave}</strong> &mdash;
              {t("the picture with the subtitles drawn into it, so they show up anywhere without a subtitle file beside them. Encoded here in the browser with WebCodecs; the audio is copied across untouched rather than re-encoded, and the subtitles are drawn by libass — the same renderer the preview above uses.")}
            </p>
            <div class="checkbox-row">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={!assDocument}
                onclick={requestBurn}
              >
                {t("Burn subtitles into the video")}
              </button>
            </div>
          {/if}

          {#if burnError}
            <p class="field-error">{burnError}</p>
          {/if}
        {/if}

        <div class="subsection-head">
          <h3 class="subsection-title">{t("A subtitle file")}</h3>
          <span class="tag">{t("text only")}</span>
        </div>
        <p class="oa-caption card-intro">
          <Rich text={t("The subtitles on their own, to hand to a player, a platform or an editor — the video is not touched. **.ass** keeps the styling you chose here; **.srt** and **.vtt** are plain text that everything reads, with none of the styling. **.txt** is just the words, without timings: a transcript to read, quote or paste.")} />
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
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onclick={() => download(writeTxt(shownCues, exportsBoth), `${videoName.replace(/\.[^.]+$/, "") || "subs"}.txt`, "text/plain")}
          >
            <Icon name="download" size={14} />
            .txt
          </button>
        </div>

        {#if cliLine}
          <details class="raw-command">
            <summary class="oa-caption">{t("Prefer to burn it on the command line?")}</summary>
            <p class="oa-caption card-intro">
              {t("The CLI probes the real file, so it gets colour tags, rotation and variable frame rate right in ways a browser cannot see. Worth using for anything long, or for HDR footage.")}
            </p>
            <div class="command">
              <code class="oa-mono">{cliLine}</code>
              <button type="button" class="btn btn-ghost btn-sm" onclick={() => copy(cliLine, "cli")}>
                {copied === "cli" ? t("Copied") : t("Copy")}
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
                  {copied === "ffmpeg" ? t("Copied") : t("Copy")}
                </button>
              </div>
              <p class="oa-caption">
                {t("Download the .ass above first. This one assumes BT.709 colour, because a browser cannot read the file's real tags.")}
              </p>
            {/if}
          </details>
        {/if}
      </section>
        {/if}
      </div>
    </div>
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
          <Rich text={t("No account, no watermark and no export limit.")} />
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
      {t("Engine {version} running in WebAssembly — the same Rust the desktop app and CLI use.", { version })}
    </p>
  </footer>
</main>
