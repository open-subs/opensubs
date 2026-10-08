<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import Icon from "./lib/Icon.svelte";
  import AccountPanel from "./lib/AccountPanel.svelte";
  import {
    InsufficientCredits,
    NotSignedIn,
    PACK,
    balance as accountBalance,
    dollars,
    onAccountChange,
    priceLabel,
    signedIn as accountSignedIn,
    translateOnBackend,
  } from "./lib/account";
  import { openSignIn, onSignedIn } from "./lib/signin";
  import {
    probe,
    listStyles,
    listFeatures,
    listLanguages,
    translationReady,
    checkFfmpeg,
    installFfmpeg,
    getModelPath,
    setModelPath,
    listDownloadableModels,
    downloadModel,
    burn,
    reveal,
    type MediaInfoDto,
    type FfmpegCheck,
    type StyleDto,
    type FeatureDto,
    type LanguageDto,
    type BurnProgressPayload,
    type FfmpegInstallOutputPayload,
    type ModelOptionDto,
    type ModelDownloadProgressPayload,
    type BurnOptions,
    type TranscribedDto,
    transcribeForCloud,
  } from "./lib/api";

  const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];
  const MODEL_EXTENSIONS = ["bin", "ggml"];

  // --- state -------------------------------------------------------------

  let videoPath = $state<string | null>(null);
  let mediaInfo = $state<MediaInfoDto | null>(null);
  let probing = $state(false);
  let probeError = $state<string | null>(null);
  let isDragOver = $state(false);

  let styles = $state<StyleDto[]>([]);
  let selectedStyle = $state("Clean");
  const corePresets = $derived(styles.filter((s) => s.pack === "Core"));
  const advancedPresets = $derived(styles.filter((s) => s.pack === "Advanced"));

  // Clip selection. `null` means "from the beginning" / "to the end": a
  // cleared field has to stay distinguishable from a deliberate 0, and
  // Svelte binds an empty `<input type="number">` to null rather than "".
  // These are numbers, not strings -- treating them as strings and calling
  // .trim() on them throws the moment the user types a digit.
  let trimStart = $state<number | null>(null);
  let trimEnd = $state<number | null>(null);

  // Export options. `exportHeight` of "" means the source's own height.
  let exportHeight = $state("");
  let writeSrt = $state(false);
  let writeVtt = $state(false);

  let translateTo = $state("");
  /** "device": the offline model, free. "cloud": our servers, credits. */
  let translateVia = $state<"device" | "cloud">("device");

  let showAccount = $state(false);
  let loggedIn = $state(accountSignedIn());
  let credits = $state<number | null>(null);

  /** A cloud-translated export waiting for the person to agree to its price. */
  let pendingCloud = $state<TranscribedDto | null>(null);
  let pricing = $state(false);
  let cloudError = $state<string | null>(null);
  let languages = $state<LanguageDto[]>([]);
  let canTranslate = $state<boolean | null>(null);

  let features = $state<FeatureDto[]>([]);
  let showFeatures = $state(false);

  // Windows paths separate with backslashes, and a bundled model's path comes
  // back from Tauri with the `\\?\` prefix; the file name is what to show.
  const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
  const revealLabel = navigator.userAgent.includes("Windows")
    ? "Show in Explorer"
    : navigator.userAgent.includes("Mac")
      ? "Reveal in Finder"
      : "Show in folder";

  let modelPath = $state<string | null>(null);
  let downloadableModels = $state<ModelOptionDto[]>([]);
  let showModelDownloads = $state(false);
  let downloadingFilename = $state<string | null>(null);
  let downloadPercent = $state(0);
  let downloadedBytes = $state(0);
  let downloadTotalBytes = $state<number | null>(null);
  let downloadError = $state<string | null>(null);

  let ffmpeg = $state<FfmpegCheck | null>(null);
  let ffmpegOk = $derived(ffmpeg ? ffmpeg.found && ffmpeg.missing.length === 0 : null);
  let ffmpegCheckError = $state<string | null>(null);
  let installingFfmpeg = $state(false);
  let installLog = $state<string[]>([]);
  let installError = $state<string | null>(null);

  let burning = $state(false);
  let progress = $state(0);
  let burnError = $state<string | null>(null);
  let outputPath = $state<string | null>(null);

  /** The parsed clip. `end: null` runs to the end of the video. */
  const trim = $derived.by(() => ({
    start: trimStart ?? 0,
    end: trimEnd,
  }));

  /** Why the current clip cannot be exported, or `null` if it can. */
  const trimError = $derived.by(() => {
    const { start, end } = trim;
    if (!Number.isFinite(start) || start < 0) return "Start must be zero or more.";
    if (end !== null && !Number.isFinite(end)) return "End must be a number of seconds.";
    if (end !== null && end <= start) return "End must be after the start.";
    if (mediaInfo && start >= mediaInfo.duration)
      return `Start is past the end of the video (${formatDuration(mediaInfo.duration)}).`;
    return null;
  });

  const clipLength = $derived.by(() => {
    if (!mediaInfo) return null;
    const { start, end } = trim;
    const stop = end === null ? mediaInfo.duration : Math.min(end, mediaInfo.duration);
    return Math.max(0, stop - start);
  });

  const isTrimmed = $derived(trim.start > 0 || trim.end !== null);

  /**
   * Downscale targets that are actually smaller than this video. Upscaling
   * is not offered: it costs encode time and adds no detail.
   */
  const heightOptions = $derived(
    mediaInfo
      ? [2160, 1440, 1080, 720, 480].filter((h) => h < mediaInfo!.displayHeight)
      : [],
  );

  const canBurn = $derived(
    !!videoPath &&
      !!mediaInfo &&
      !!modelPath &&
      ffmpegOk === true &&
      !burning &&
      trimError === null,
  );

  // --- lifecycle -----------------------------------------------------------

  let unlistenDragDrop: (() => void) | null = null;
  let stopAccount: (() => void) | null = null;
  let unlistenSignIn: UnlistenFn | null = null;

  onMount(async () => {
    listStyles()
      .then((s) => (styles = s))
      .catch((e) => console.error("list_styles failed", e));

    listFeatures()
      .then((f) => (features = f))
      .catch((e) => console.error("list_features failed", e));

    listLanguages()
      .then((l) => (languages = l))
      .catch((e) => console.error("list_languages failed", e));

    translationReady()
      .then((ok) => (canTranslate = ok))
      .catch(() => (canTranslate = false));

    getModelPath()
      .then((p) => (modelPath = p))
      .catch((e) => console.error("get_model_path failed", e));

    checkFfmpeg()
      .then((check) => (ffmpeg = check))
      .catch((e) => {
        ffmpeg = { found: false, missing: [], install: null };
        ffmpegCheckError = String(e);
      });

    const refreshAccount = () => {
      loggedIn = accountSignedIn();
      if (!loggedIn) {
        credits = null;
        return;
      }
      accountBalance()
        .then((b) => (credits = b))
        .catch(() => (credits = null));
    };
    refreshAccount();
    stopAccount = onAccountChange(refreshAccount);
    unlistenSignIn = await onSignedIn(refreshAccount);

    const webview = getCurrentWebview();
    unlistenDragDrop = await webview.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        isDragOver = true;
      } else if (event.payload.type === "drop") {
        isDragOver = false;
        const path = event.payload.paths[0];
        if (path) void loadFile(path);
      } else {
        isDragOver = false;
      }
    });
  });

  onDestroy(() => {
    unlistenDragDrop?.();
    stopAccount?.();
    unlistenSignIn?.();
  });

  // --- actions -------------------------------------------------------------

  async function loadFile(path: string) {
    videoPath = path;
    mediaInfo = null;
    probeError = null;
    outputPath = null;
    burnError = null;
    progress = 0;
    probing = true;
    try {
      mediaInfo = await probe(path);
    } catch (e) {
      probeError = String(e);
    } finally {
      probing = false;
    }
  }

  async function chooseFile() {
    const selection = await openDialog({
      multiple: false,
      filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
    });
    if (typeof selection === "string") {
      await loadFile(selection);
    }
  }

  async function chooseModel() {
    const selection = await openDialog({
      multiple: false,
      filters: [{ name: "Whisper model", extensions: MODEL_EXTENSIONS }],
    });
    if (typeof selection === "string") {
      modelPath = selection;
      try {
        await setModelPath(selection);
      } catch (e) {
        console.error("set_model_path failed", e);
      }
    }
  }

  async function toggleModelDownloads() {
    showModelDownloads = !showModelDownloads;
    if (showModelDownloads) {
      downloadError = null;
      if (downloadableModels.length === 0) {
        try {
          downloadableModels = await listDownloadableModels();
        } catch (e) {
          downloadError = String(e);
        }
      }
    }
  }

  async function useOrDownloadModel(m: ModelOptionDto) {
    if (m.alreadyDownloaded && m.localPath) {
      modelPath = m.localPath;
      try {
        await setModelPath(m.localPath);
      } catch (e) {
        console.error("set_model_path failed", e);
      }
      showModelDownloads = false;
      return;
    }

    downloadingFilename = m.filename;
    downloadPercent = 0;
    downloadedBytes = 0;
    downloadTotalBytes = null;
    downloadError = null;

    let unlistenProgress: UnlistenFn | null = null;
    try {
      unlistenProgress = await listen<ModelDownloadProgressPayload>("model-download-progress", (event) => {
        if (event.payload.filename === m.filename) {
          downloadPercent = event.payload.percent;
          downloadedBytes = event.payload.downloadedBytes;
          downloadTotalBytes = event.payload.totalBytes;
        }
      });
      const path = await downloadModel(m.filename);
      modelPath = path;
      await setModelPath(path);
      downloadableModels = downloadableModels.map((x) =>
        x.filename === m.filename ? { ...x, alreadyDownloaded: true, localPath: path } : x,
      );
      showModelDownloads = false;
    } catch (e) {
      downloadError = String(e);
    } finally {
      unlistenProgress?.();
      downloadingFilename = null;
    }
  }

  function formatModelSize(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
  }

  function reset() {
    videoPath = null;
    mediaInfo = null;
    probeError = null;
    outputPath = null;
    burnError = null;
    progress = 0;
    // The clip belongs to the file that is going away; the style, model
    // and export preferences are the user's and stay put.
    trimStart = null;
    trimEnd = null;
  }

  function burnOptions(): BurnOptions {
    return {
      start: trim.start > 0 ? trim.start : null,
      end: trim.end,
      height: exportHeight === "" ? null : Number(exportHeight),
      translateTo: translateTo === "" ? null : translateTo,
      writeSrt,
      writeVtt,
    };
  }

  const usesCloud = $derived(translateTo !== "" && translateVia === "cloud");

  // A price belongs to one video, model, clip and language. Change any of
  // them and the person is shown a new price rather than charged an old one.
  $effect(() => {
    void [videoPath, modelPath, trim.start, trim.end, translateTo, translateVia];
    pendingCloud = null;
  });

  function doBurn() {
    if (usesCloud) void priceCloudTranslation();
    else void runBurn(burnOptions());
  }

  /** Step one of a cloud-translated export: listen, then show the price. */
  async function priceCloudTranslation() {
    if (!canBurn || !videoPath || !modelPath) return;
    cloudError = null;
    burnError = null;
    outputPath = null;
    if (!accountSignedIn()) {
      cloudError = new NotSignedIn().message;
      return;
    }
    pricing = true;
    try {
      pendingCloud = await transcribeForCloud(videoPath, modelPath, burnOptions());
      credits = await accountBalance().catch(() => credits);
    } catch (e) {
      cloudError = String(e);
    } finally {
      pricing = false;
    }
  }

  /** Step two: the person agreed to the price. Translate, then export. */
  async function confirmCloudTranslation() {
    const job = pendingCloud;
    if (!job || translateTo === "") return;
    cloudError = null;
    burning = true;
    try {
      const result = await translateOnBackend(job.lines, translateTo, job.language);
      credits = result.newBalance;
      pendingCloud = null;
      burning = false;
      await runBurn({ ...burnOptions(), cloud: { jobId: job.jobId, translations: result.translations } });
    } catch (e) {
      burning = false;
      cloudError = e instanceof Error ? e.message : String(e);
      if (e instanceof InsufficientCredits || e instanceof NotSignedIn) showAccount = true;
    }
  }

  async function runBurn(options: BurnOptions) {
    if (!canBurn || !videoPath || !modelPath) return;
    burning = true;
    progress = 0;
    burnError = null;
    outputPath = null;

    let unlistenProgress: UnlistenFn | null = null;
    try {
      unlistenProgress = await listen<BurnProgressPayload>("burn-progress", (event) => {
        progress = event.payload.percent;
      });
      outputPath = await burn(videoPath, selectedStyle, modelPath, null, options);
      progress = 100;
    } catch (e) {
      burnError = String(e);
    } finally {
      unlistenProgress?.();
      burning = false;
    }
  }

  async function doReveal() {
    if (!outputPath) return;
    try {
      await reveal(outputPath);
    } catch (e) {
      burnError = String(e);
    }
  }

  async function doInstallFfmpeg() {
    installingFfmpeg = true;
    installLog = [];
    installError = null;

    let unlistenOutput: UnlistenFn | null = null;
    try {
      unlistenOutput = await listen<FfmpegInstallOutputPayload>("ffmpeg-install-output", (event) => {
        installLog = [...installLog, event.payload.line];
      });
      await installFfmpeg();
      // A successful install doesn't guarantee the filters are now present
      // (e.g. brew no-ops on an already-installed formula, or an earlier
      // ffmpeg without whisper still comes first) -- re-check for real
      // rather than assuming.
      ffmpegCheckError = null;
      ffmpeg = await checkFfmpeg();
      if (!ffmpegOk) {
        // The install itself worked; this app cannot see it. On Windows,
        // winget without administrator rights writes the new folder to the
        // user's PATH in the registry, and a program keeps the PATH it
        // started with -- so a restart is the honest answer.
        installError = ffmpeg?.found
          ? "Installed, but that ffmpeg still cannot do the whole job. The log above says what it did."
          : "Installed. Close OpenSubs and open it again to use it -- a program only sees a new install once it starts afresh.";
      }
    } catch (e) {
      installError = String(e);
    } finally {
      unlistenOutput?.();
      installingFfmpeg = false;
    }
  }

  // --- formatting ------------------------------------------------------

  function formatDuration(seconds: number): string {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function formatFps(fps: number): string {
    return Number.isInteger(fps) ? String(fps) : fps.toFixed(2);
  }
</script>

<main class="screen" class:drag-over={isDragOver}>
  <header class="app-header">
    <div class="app-header-row">
      <div class="brand">
        <span class="brand-open">Open</span><span class="brand-name">Subs</span><span
          class="brand-dot">.</span
        >
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm account-btn"
        aria-expanded={showAccount}
        aria-label={loggedIn ? "Account and credits" : "Sign in for cloud translation"}
        onclick={() => (showAccount = !showAccount)}
      >
        <Icon name="user" size={16} />
        {#if loggedIn && credits !== null}
          <span class="oa-mono">{priceLabel(credits)}</span>
        {:else if !loggedIn}
          <span>Sign in</span>
        {/if}
      </button>
    </div>
    <p class="oa-caption">Subtitle a video: drop a file, pick a look, burn it in.</p>
  </header>

  {#if showAccount}
    <section class="card account-card">
      <h2 class="section-title">Account</h2>
      <AccountPanel />
    </section>
  {/if}

  {#if ffmpegOk === false}
    <div class="banner banner-danger">
      <Icon name="alert-triangle" />
      <div class="banner-body">
        {#if ffmpeg && !ffmpeg.found}
          <strong>OpenSubs needs ffmpeg, and this computer doesn't have it.</strong>
        {:else}
          <strong>This ffmpeg can't do the whole job.</strong>
        {/if}
        {#if ffmpegCheckError}
          <p class="oa-caption">{ffmpegCheckError}</p>
        {:else if ffmpeg}
          <p class="oa-caption">
            OpenSubs uses two of ffmpeg's filters: <code>whisper</code>, which transcribes the
            audio, and <code>ass</code> (libass), which burns the subtitles in.
            {#if ffmpeg.found}
              The ffmpeg found here has no {ffmpeg.missing.join(" and no ")}.
            {/if}
            {#if ffmpeg.install}
              {ffmpeg.install.note}
            {:else}
              Install an ffmpeg 8 or later built with whisper and libass.
            {/if}
          </p>
        {/if}

        {#if installingFfmpeg || installLog.length > 0}
          {#if installingFfmpeg}
            <p class="oa-caption">Installing ffmpeg (<code>{ffmpeg?.install?.command}</code>)&hellip; this can take several minutes.</p>
          {/if}
          {#if installLog.length > 0}
            <div class="install-log oa-mono">
              {#each installLog as line}<div>{line}</div>{/each}
            </div>
          {/if}
          {#if installError}
            <p class="error-text">{installError}</p>
          {/if}
        {/if}
        {#if !installingFfmpeg}
          {#if ffmpeg?.install}
            <div class="banner-actions">
              <button type="button" class="btn btn-secondary btn-sm" onclick={doInstallFfmpeg}>
                <Icon name="download" size={14} />
                {ffmpeg.install.label}
              </button>
              <span class="oa-caption">or run <code>{ffmpeg.install.command}</code> yourself</span>
            </div>
          {/if}
          {#if installError && installLog.length === 0}
            <p class="error-text">{installError}</p>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  <section class="card">
    {#if !videoPath}
      <button
        type="button"
        class="drop-zone"
        class:active={isDragOver}
        onclick={chooseFile}
        aria-label="Choose a video file"
      >
        <Icon name="upload" size={28} />
        <p class="drop-zone-title">Drop a video here</p>
        <p class="oa-caption">or click to choose a file</p>
      </button>
    {:else}
      <div class="file-summary">
        <div class="file-summary-icon">
          <Icon name="film" size={20} />
        </div>
        <div class="file-summary-body">
          {#if probing}
            <p class="oa-mono">Probing&hellip;</p>
          {:else if probeError}
            <p class="filename">{fileName(videoPath)}</p>
            <p class="error-text">{probeError}</p>
          {:else if mediaInfo}
            <p class="filename">{mediaInfo.filename}</p>
            <p class="oa-mono file-meta">
              {mediaInfo.displayWidth}&times;{mediaInfo.displayHeight} &middot; {formatDuration(
                mediaInfo.duration,
              )} &middot; {formatFps(mediaInfo.fps)} fps
              {#if !mediaInfo.hasAudio}&middot; no audio{/if}
              {#if mediaInfo.isHdr}&middot; <span class="badge">HDR</span>{/if}
            </p>
          {/if}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick={chooseFile} disabled={burning}>
          Change
        </button>
      </div>
    {/if}
  </section>

  <section class="card">
    <h2 class="section-title">Style</h2>
    <div class="style-grid">
      {#each corePresets as style (style.name)}
        <button
          type="button"
          class="style-tile"
          class:selected={selectedStyle === style.name}
          onclick={() => (selectedStyle = style.name)}
          disabled={burning}
        >
          <span
            class="style-swatch"
            style:background={style.primaryHex}
            style:box-shadow={style.borderStyle === "box"
              ? `0 0 0 3px ${style.backHex}`
              : `0 0 0 1.5px ${style.backHex}`}
          ></span>
          <span class="style-name">{style.name}</span>
        </button>
      {/each}
    </div>

    {#if advancedPresets.length > 0}
      <div class="subsection-head">
        <h3 class="subsection-title">Advanced pack</h3>
        <span class="tag tag-free">Free</span>
      </div>
      <div class="style-grid">
        {#each advancedPresets as style (style.name)}
          <button
            type="button"
            class="style-tile"
            class:selected={selectedStyle === style.name}
            onclick={() => (selectedStyle = style.name)}
            disabled={burning}
          >
            <span
              class="style-swatch"
              style:background={style.primaryHex}
              style:box-shadow={style.borderStyle === "box"
                ? `0 0 0 3px ${style.backHex}`
                : `0 0 0 1.5px ${style.backHex}`}
            ></span>
            <span class="style-name">{style.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  {#if mediaInfo}
    <section class="card">
      <h2 class="section-title">Clip</h2>
      <p class="oa-caption card-intro">
        Leave both empty to subtitle the whole video.
      </p>
      <div class="field-row">
        <label class="field">
          <span class="field-label">Start</span>
          <input
            class="oa-mono input"
            type="number"
            min="0"
            step="0.1"
            placeholder="0"
            bind:value={trimStart}
            disabled={burning}
          />
          <span class="field-unit">sec</span>
        </label>
        <label class="field">
          <span class="field-label">End</span>
          <input
            class="oa-mono input"
            type="number"
            min="0"
            step="0.1"
            placeholder={mediaInfo.duration.toFixed(1)}
            bind:value={trimEnd}
            disabled={burning}
          />
          <span class="field-unit">sec</span>
        </label>
      </div>
      {#if trimError}
        <p class="field-error">{trimError}</p>
      {:else if isTrimmed && clipLength !== null}
        <p class="oa-caption">
          Exporting {formatDuration(clipLength)} of {formatDuration(mediaInfo.duration)}. Only
          this span is transcribed.
        </p>
      {/if}
    </section>

    <section class="card">
      <h2 class="section-title">Export</h2>

      <div class="field-row">
        <label class="field field-wide">
          <span class="field-label">Resolution</span>
          <select class="input" bind:value={exportHeight} disabled={burning}>
            <option value="">
              Source ({mediaInfo.displayWidth}&times;{mediaInfo.displayHeight})
            </option>
            {#each heightOptions as h (h)}
              <option value={String(h)}>{h}p</option>
            {/each}
          </select>
        </label>

        <label class="field field-wide">
          <span class="field-label">Translate to</span>
          <select
            class="input"
            bind:value={translateTo}
            disabled={burning || canTranslate === false}
          >
            <option value="">Don't translate</option>
            {#each languages as l (l.code)}
              <option value={l.code}>{l.endonym} &middot; {l.name}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if translateTo !== ""}
        <fieldset class="translate-via" disabled={burning || pricing}>
          <legend class="field-label">Translate with</legend>
          <label class="radio">
            <input
              type="radio"
              name="translate-via"
              value="device"
              bind:group={translateVia}
              disabled={canTranslate === false}
            />
            <span>
              <strong>This computer</strong> &middot; free
              <span class="oa-caption radio-note">
                {#if canTranslate === false}
                  Not available in this build.
                {:else}
                  The model that came with the app, with no network and no account. Quick, but
                  more literal.
                {/if}
              </span>
            </span>
          </label>
          <label class="radio">
            <input type="radio" name="translate-via" value="cloud" bind:group={translateVia} />
            <span>
              <strong>Cloud</strong> &middot; uses credits
              <span class="oa-caption radio-note">
                Reads more naturally. You see the exact price before anything is charged, and a
                failed translation costs nothing. {PACK.credits.toLocaleString("en")} credits
                cost ${PACK.usd}.
                {#if !loggedIn}
                  <button type="button" class="link-btn" onclick={() => void openSignIn()}>
                    Sign in to use it
                  </button>
                {/if}
              </span>
            </span>
          </label>
        </fieldset>
        <p class="oa-caption">Subtitle timings are unchanged; only the text is replaced.</p>
      {/if}

      <div class="checkbox-row">
        <label class="checkbox">
          <input type="checkbox" bind:checked={writeSrt} disabled={burning} />
          <span>Also write .srt</span>
        </label>
        <label class="checkbox">
          <input type="checkbox" bind:checked={writeVtt} disabled={burning} />
          <span>Also write .vtt</span>
        </label>
      </div>
    </section>
  {/if}

  <section class="card">
    <h2 class="section-title">Model</h2>
    {#if modelPath}
      <div class="model-row">
        <span class="oa-mono model-path">{fileName(modelPath)}</span>
        <div class="model-row-actions">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={chooseModel}
            disabled={burning || downloadingFilename !== null}
          >
            Change
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={toggleModelDownloads}
            disabled={burning || downloadingFilename !== null}
          >
            Download a model&hellip;
          </button>
        </div>
      </div>
    {:else}
      <div class="model-row">
        <p class="oa-caption model-hint">
          No whisper model set. Get a <code>.bin</code> model from
          huggingface.co/ggerganov/whisper.cpp and choose it below.
        </p>
        <div class="model-row-actions">
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            onclick={chooseModel}
            disabled={burning || downloadingFilename !== null}
          >
            Choose model&hellip;
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={toggleModelDownloads}
            disabled={burning || downloadingFilename !== null}
          >
            Download a model&hellip;
          </button>
        </div>
      </div>
    {/if}

    {#if showModelDownloads}
      <div class="model-download-list">
        {#each downloadableModels as m (m.filename)}
          <div class="model-download-row">
            <div class="model-download-info">
              <span class="model-download-name">{m.name}</span>
              <span class="oa-caption">{formatModelSize(m.sizeBytes)} &middot; {m.description}</span>
            </div>
            {#if downloadingFilename === m.filename}
              <div class="model-download-progress">
                <div
                  class="progress-track"
                  role="progressbar"
                  aria-valuenow={Math.round(downloadPercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div class="progress-fill" style:width={`${downloadPercent}%`}></div>
                </div>
                {#if downloadTotalBytes === null}
                  <span class="oa-mono progress-label">{(downloadedBytes / (1024 * 1024)).toFixed(0)} MB downloaded</span>
                {:else}
                  <span class="oa-mono progress-label">{downloadPercent.toFixed(0)}%</span>
                {/if}
              </div>
            {:else if m.alreadyDownloaded && modelPath === m.localPath}
              <button type="button" class="btn btn-ghost btn-sm" disabled>
                <Icon name="check-circle" size={14} />
                Selected
              </button>
            {:else if m.alreadyDownloaded}
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onclick={() => useOrDownloadModel(m)}
                disabled={downloadingFilename !== null || burning}
              >
                Use this model
              </button>
            {:else}
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onclick={() => useOrDownloadModel(m)}
                disabled={downloadingFilename !== null || burning}
              >
                <Icon name="download" size={14} />
                Download
              </button>
            {/if}
          </div>
        {/each}
        {#if downloadError}
          <p class="error-text">{downloadError}</p>
        {/if}
      </div>
    {/if}
  </section>

  {#if burnError}
    <div class="banner banner-danger">
      <Icon name="alert-triangle" />
      <p>{burnError}</p>
    </div>
  {/if}

  {#if outputPath}
    <section class="card success-card">
      <Icon name="check-circle" size={22} />
      <div class="success-body">
        <p class="success-title">Wrote {fileName(outputPath)}</p>
        <p class="oa-mono file-meta">{outputPath}</p>
      </div>
      <div class="success-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick={doReveal}>
          <Icon name="folder-open" size={14} />
          {revealLabel}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" onclick={reset}>Start over</button>
      </div>
    </section>
  {:else}
    {#if pendingCloud}
      {@const need = pendingCloud.credits}
      {@const short = credits !== null && credits < need}
      <section class="card price-card" aria-live="polite">
        <h2 class="section-title">Cloud translation: {priceLabel(need)}</h2>
        <p class="oa-caption">
          {pendingCloud.lines.length}
          {pendingCloud.lines.length === 1 ? "subtitle" : "subtitles"}, about {dollars(need)}.
          {#if credits !== null}You have {priceLabel(credits)}.{/if}
          You are charged this price only once the translation succeeds.
        </p>
        <div class="price-actions">
          {#if short}
            <p class="oa-caption">
              You need {priceLabel(need - (credits ?? 0))} more.
            </p>
            <button type="button" class="btn btn-primary btn-sm" onclick={() => (showAccount = true)}>
              Buy credits
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={burning}
              onclick={() => void confirmCloudTranslation()}
            >
              Translate and burn &middot; {priceLabel(need)}
            </button>
          {/if}
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={burning}
            onclick={() => (pendingCloud = null)}
          >
            Cancel
          </button>
        </div>
      </section>
    {/if}
    {#if cloudError}
      <div class="banner banner-danger" role="alert">
        <Icon name="alert-triangle" />
        <div class="banner-body">
          <p class="oa-caption">{cloudError}</p>
          {#if !loggedIn}
            <button type="button" class="btn btn-secondary btn-sm" onclick={() => void openSignIn()}>
              Sign in
            </button>
          {/if}
        </div>
      </div>
    {/if}
    <div class="burn-row">
      {#if pendingCloud}
        <!-- The price card above carries this step's buttons. -->
      {:else if pricing}
        <span class="oa-caption">Listening to the video to work out the price&hellip;</span>
      {:else if burning}
        <div class="progress-track" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div class="progress-fill" style:width={`${progress}%`}></div>
        </div>
        <span class="oa-mono progress-label">{progress.toFixed(0)}%</span>
      {:else}
        <button
          type="button"
          class="btn btn-primary"
          disabled={!canBurn || pendingCloud !== null || (usesCloud && !loggedIn)}
          onclick={doBurn}
        >
          {usesCloud ? "See the price" : "Burn subtitles"}
        </button>
        {#if usesCloud && !loggedIn}
          <span class="oa-caption">Cloud translation needs an account.
            <button type="button" class="link-btn" onclick={() => void openSignIn()}>Sign in</button>
          </span>
        {/if}
        {#if videoPath && !modelPath}
          <span class="oa-caption">Pick a whisper model to enable burning.</span>
        {:else if ffmpegOk === false}
          <span class="oa-caption">ffmpeg needs {ffmpeg && !ffmpeg.found ? "installing" : "whisper and libass"} before this can run.</span>
        {:else if trimError}
          <span class="oa-caption">{trimError}</span>
        {/if}
      {/if}
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
        <h2 class="section-title">What's included</h2>
        <span class="oa-caption">
          {showFeatures ? "Hide" : "Free on this computer"}
        </span>
      </button>

      {#if showFeatures}
        <p class="oa-caption card-intro">
          No account, no watermark, no export limit.
        </p>
        <ul class="feature-list">
          {#each features as f (f.id)}
            <li class="feature-row">
              <span class="feature-title">{f.title}</span>
              <span class="tag" class:tag-free={f.cost === "free"} title={f.costNote}
                >{f.costLabel}</span
              >
              <span class="oa-caption feature-why">{f.why}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</main>
