(() => {
  "use strict";

  const PANEL_ID = "bili-subtitle-lite-panel";
  const SITE_RESULT_URL = "https://danmu.liu-qi.cn/result";
  const ROUTE_POLL_MS = 1200;
  const PLACEMENT_RETRY_MS = 250;
  const LOAD_TRACKS_DELAY_MS = 400;
  const PANEL_MOUNT_DELAY_MS = 1800;
  const DEFAULT_VIEWER_HEIGHT = 360;
  const MIN_VIEWER_HEIGHT = 180;
  const MAX_VIEWER_HEIGHT = 680;
  const LLM_CONFIG_STORAGE_KEY = "bdsp.llmConfig.v1";
  const UI_LOCALE_STORAGE_KEY = "bdsp.uiLocale.v1";
  const TARGET_LANGUAGE_STORAGE_KEY = "bdsp.targetLanguage.v1";
  const OVERLAY_ENABLED_STORAGE_KEY = "bdsp.overlayEnabled.v1";
  const OVERLAY_POSITION_STORAGE_KEY = "bdsp.overlayPosition.v1";
  const SILICONFLOW_API_KEY_URL = "https://cloud.siliconflow.cn/i/My0p5Jgs";
  const OPENROUTER_API_KEY_URL = "https://openrouter.ai/keys";
  const DEFAULT_OVERLAY_POSITION = Object.freeze({ x: 0.5, y: 0.72 });
  const MIN_OVERLAY_POSITION_RATIO = 0.04;
  const MAX_OVERLAY_POSITION_RATIO = 0.96;
  const OVERLAY_POSITION_SAVE_DELAY_MS = 120;

  const MessageType = Object.freeze({
    GET_SUBTITLES: "GET_VIDEO_SUBTITLES",
    DOWNLOAD_SUBTITLE: "DOWNLOAD_SUBTITLE",
    OPEN_SITE_RESULT: "OPEN_SITE_RESULT",
    TRANSLATE_SUBTITLE: "TRANSLATE_SUBTITLE",
    TRANSLATE_SUBTITLE_PROGRESS: "TRANSLATE_SUBTITLE_PROGRESS",
    PRUNE_TRANSLATION_CACHE: "PRUNE_TRANSLATION_CACHE",
  });

  const I18n = globalThis.BiliSubtitleI18n;
  const Translation = globalThis.BiliSubtitleTranslationCore;
  const TranslationCache = globalThis.BiliSubtitleTranslationCache;
  let uiLocaleOverride = "auto";

  function getPreferredLocale() {
    if (uiLocaleOverride === "zh" || uiLocaleOverride === "en") {
      return uiLocaleOverride;
    }
    return typeof I18n?.pickLocale === "function" ? I18n.pickLocale() : "zh";
  }

  const state = {
    locale: getPreferredLocale(),
    bvid: "",
    cid: null,
    page: 1,
    title: "",
    ownerName: "",
    tracks: [],
    selectedTrackId: "",
    cues: [],
    activeCue: null,
    searchQuery: "",
    status: "",
    statusKey: "status.detectingCurrentVideo",
    statusParams: {},
    statusTone: "muted",
    collapsed: true,
    userToggledCollapse: false,
    loadingTracks: false,
    loadingSubtitle: false,
    translating: false,
    overlayEnabled: false,
    overlayPosition: { ...DEFAULT_OVERLAY_POSITION },
    targetLanguage: getDefaultTargetLanguage(),
    llmConfig: {
      baseUrl: "",
      model: "",
      apiKey: "",
    },
    lastHref: "",
    viewerHeight: DEFAULT_VIEWER_HEIGHT,
    loadTracksTimer: 0,
    overlayTimer: 0,
    translationRequestId: "",
    translationTrackId: "",
  };

  const refs = {};
  let routeTimer = 0;
  let placementObserver = null;
  let placementRetryTimer = 0;
  let mountDelayTimer = 0;
  let pendingMountTarget = null;
  let parsedInitialState = null;
  let overlayDragState = null;
  let overlayPositionSaveTimer = 0;
  let activeVideoElement = null;
  const nativeSubtitleTrackByMedia = new WeakMap();
  let nativeSubtitleTrackState = {
    media: null,
    track: null,
    cues: [],
    cuesRef: null,
    trackId: "",
  };

  function t(key, params = {}) {
    if (typeof I18n?.translate === "function") {
      return I18n.translate(key, params, state.locale);
    }
    return key;
  }

  function ready(callback) {
    if (document.body) {
      callback();
      return;
    }
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  }

  function canUseRuntime() {
    return Boolean(globalThis.chrome?.runtime?.sendMessage);
  }

  function sendMessage(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!canUseRuntime()) {
        reject(new Error(t("error.runtimeUnavailable")));
        return;
      }

      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message || t("error.runtimeNoResponse")));
          return;
        }
        if (response?.ok === false) {
          reject(new Error(response.error?.message || response.message || t("error.fetchSubtitlesFailed")));
          return;
        }
        resolve(response?.data ?? response ?? {});
      });
    });
  }

  function registerRuntimeMessageListener() {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.onMessage?.addListener) {
      return;
    }
    runtime.onMessage.addListener((message) => {
      if (message?.type === MessageType.TRANSLATE_SUBTITLE_PROGRESS) {
        handleTranslationProgress(message);
      }
    });
  }

  function getDefaultTargetLanguage() {
    if (!Translation?.normalizeTargetLanguage) {
      return "en";
    }
    const languages = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "en"];
    for (const language of languages) {
      const normalized = Translation.normalizeTargetLanguage(language);
      if (normalized && !normalized.startsWith("zh")) {
        return normalized;
      }
    }
    return "en";
  }

  async function loadPersistedSettings() {
    const stored = await storageGet([
      LLM_CONFIG_STORAGE_KEY,
      UI_LOCALE_STORAGE_KEY,
      TARGET_LANGUAGE_STORAGE_KEY,
      OVERLAY_ENABLED_STORAGE_KEY,
      OVERLAY_POSITION_STORAGE_KEY,
    ]).catch(() => ({}));
    const nextUiLocale = stored[UI_LOCALE_STORAGE_KEY] || "auto";
    uiLocaleOverride = ["auto", "zh", "en"].includes(nextUiLocale) ? nextUiLocale : "auto";
    state.locale = getPreferredLocale();
    state.llmConfig = normalizeStoredLlmConfig(stored[LLM_CONFIG_STORAGE_KEY]);
    state.targetLanguage = Translation?.normalizeTargetLanguage?.(stored[TARGET_LANGUAGE_STORAGE_KEY]) || state.targetLanguage;
    state.overlayEnabled = Boolean(stored[OVERLAY_ENABLED_STORAGE_KEY]);
    state.overlayPosition = normalizeOverlayPosition(stored[OVERLAY_POSITION_STORAGE_KEY], document.getElementById("bdsp-subtitle-overlay"));
    await TranslationCache?.pruneStoredTranslationCache?.().catch(() => {});
    sendMessage(MessageType.PRUNE_TRANSLATION_CACHE).catch(() => {});
    if (refs.root) {
      applyLocalizedStaticText();
      updateSettingsForm();
      renderAll();
      updateSubtitleOverlayState();
    }
  }

  function normalizeStoredLlmConfig(config = {}) {
    return {
      baseUrl: String(config.baseUrl || "").trim(),
      model: String(config.model || "").trim(),
      apiKey: String(config.apiKey || "").trim(),
    };
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage?.get) {
        resolve({});
        return;
      }
      storage.get(keys, (result) => {
        const lastError = globalThis.chrome?.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message || t("error.storageUnavailable")));
          return;
        }
        resolve(result || {});
      });
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      const storage = globalThis.chrome?.storage?.local;
      if (!storage?.set) {
        resolve();
        return;
      }
      storage.set(value, () => {
        const lastError = globalThis.chrome?.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message || t("error.storageUnavailable")));
          return;
        }
        resolve();
      });
    });
  }

  function apiKeyHelpUrl() {
    return state.locale === "zh" ? SILICONFLOW_API_KEY_URL : OPENROUTER_API_KEY_URL;
  }

  function isBilibiliVideoShellReady() {
    const checker = globalThis.BiliSubtitlePageShell?.isBilibiliVideoShellReady;
    if (typeof checker !== "function") {
      return true;
    }
    try {
      return Boolean(checker(document));
    } catch {
      return false;
    }
  }

  function parseBvidFromUrl(url = window.location.href) {
    const match = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    if (match?.[1]) {
      return match[1];
    }
    try {
      return new URL(url).searchParams.get("bvid") || "";
    } catch {
      return "";
    }
  }

  function getCurrentPageIndex() {
    try {
      const value = new URL(window.location.href).searchParams.get("p");
      const page = Number.parseInt(value || "1", 10);
      return Number.isFinite(page) && page > 0 ? page : 1;
    } catch {
      return 1;
    }
  }

  function extractBalancedObject(source, startIndex) {
    const firstBrace = source.indexOf("{", startIndex);
    if (firstBrace < 0) {
      return "";
    }

    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = firstBrace; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          inString = false;
          quote = "";
        }
        continue;
      }

      if (char === "\"" || char === "'") {
        inString = true;
        quote = char;
        continue;
      }
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(firstBrace, index + 1);
        }
      }
    }

    return "";
  }

  function getInitialState() {
    if (parsedInitialState) {
      return parsedInitialState;
    }

    const scripts = Array.from(document.scripts);
    for (const script of scripts) {
      const text = script.textContent || "";
      const markerIndex = text.indexOf("window.__INITIAL_STATE__");
      if (markerIndex < 0) {
        continue;
      }
      const jsonText = extractBalancedObject(text, markerIndex);
      if (!jsonText) {
        continue;
      }
      try {
        parsedInitialState = JSON.parse(jsonText);
        return parsedInitialState;
      } catch {
        parsedInitialState = null;
      }
    }

    return null;
  }

  function readVideoContext() {
    const bvid = parseBvidFromUrl();
    if (!bvid) {
      return { bvid: "", cid: null, page: 1, title: "", ownerName: "" };
    }

    const initialState = getInitialState();
    const videoData = initialState?.videoData || initialState?.videoInfo || {};
    const pageIndex = getCurrentPageIndex();
    const page = Array.isArray(videoData.pages) ? videoData.pages[pageIndex - 1] : null;
    const cid = page?.cid || videoData.cid || initialState?.cid || null;
    const title =
      videoData.title ||
      initialState?.title ||
      document.querySelector("h1.video-title")?.textContent?.trim() ||
      document.title.replace(/_哔哩哔哩.*$/u, "").trim();
    const ownerName =
      videoData.owner?.name ||
      initialState?.upData?.name ||
      initialState?.videoStaffs?.[0]?.name ||
      "";

    return { bvid, cid, page: pageIndex, title, ownerName };
  }

  function createPanel() {
    if (!isBilibiliVideoShellReady()) {
      return false;
    }

    if (document.getElementById(PANEL_ID)) {
      refs.root = document.getElementById(PANEL_ID);
      return true;
    }

    const target = findDanmakuEmbedTarget();
    if (!target?.container || !target.before) {
      return false;
    }

    const root = document.createElement("section");
    root.id = PANEL_ID;
    root.className = "bdsp-panel";
    root.setAttribute("aria-label", t("panel.aria"));
    root.style.setProperty("--bdsp-viewer-height", `${state.viewerHeight}px`);
    root.innerHTML = `
      <div class="bdsp-header">
        <div class="bdsp-title-group">
          <div class="bdsp-title-line">
            <div class="bdsp-title" data-role="panel-title">${t("panel.title")}</div>
            <div class="bdsp-status" data-role="status">${t("status.detecting")}</div>
          </div>
          <div class="bdsp-video" data-role="video-meta">${t("panel.videoPending")}</div>
        </div>
        <button class="bdsp-icon-button" type="button" data-action="settings" aria-label="${t("settings.open")}" title="${t("settings.open")}">⚙</button>
        <button class="bdsp-icon-button" type="button" data-action="collapse" aria-label="${t("panel.collapse")}" title="${t("panel.collapse")}">⌃</button>
      </div>

      <div class="bdsp-body">
        <div class="bdsp-translation-tools" data-role="translation-tools" aria-label="${t("translation.tools")}">
          <button class="bdsp-button bdsp-button-compact" type="button" data-action="toggle-overlay">${t("overlay.toggle")}</button>
          <button class="bdsp-button bdsp-button-compact bdsp-button-primary" type="button" data-action="translate-current" disabled>${t("translation.translateTo")}</button>
          <select class="bdsp-select bdsp-select-compact" data-role="target-language" aria-label="${t("translation.targetLanguage")}"></select>
        </div>

        <div class="bdsp-controls" data-role="controls" aria-label="${t("panel.controls")}">
          <select class="bdsp-select" data-role="track-select" aria-label="${t("select.aria")}" disabled>
            <option value="">${t("select.none")}</option>
          </select>
          <input class="bdsp-search" data-role="cue-search" name="bdsp-cue-search-local" type="search" placeholder="${t("search.placeholder")}" aria-label="${t("search.aria")}" aria-autocomplete="none" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true">
          <button class="bdsp-button bdsp-button-secondary" type="button" data-action="refresh">${t("button.refresh")}</button>
        </div>

        <div class="bdsp-viewer" data-role="viewer" aria-live="polite">
          <div class="bdsp-empty">${t("empty.initial")}</div>
        </div>

        <div class="bdsp-actions">
          <button class="bdsp-button" type="button" data-action="copy-subtitles" disabled>${t("action.copySubtitles")}</button>
          <button class="bdsp-button" type="button" data-action="download-txt" disabled>${t("action.downloadTxt")}</button>
          <button class="bdsp-button" type="button" data-action="download-srt" disabled>${t("action.downloadSrt")}</button>
          <button class="bdsp-button bdsp-button-primary bdsp-button-ai" type="button" data-action="open-site" disabled>${t("action.aiAnalysis")}</button>
        </div>
      </div>
      <div class="bdsp-settings-backdrop" data-role="settings-modal" hidden>
        <div class="bdsp-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="bdsp-settings-title">
          <div class="bdsp-settings-head">
            <div>
              <div class="bdsp-settings-title" id="bdsp-settings-title">${t("settings.title")}</div>
              <div class="bdsp-settings-compat">${t("settings.compat")}</div>
            </div>
            <button class="bdsp-icon-button" type="button" data-action="close-settings" aria-label="${t("settings.close")}" title="${t("settings.close")}">×</button>
          </div>
          <label class="bdsp-field">
            <span>Base URL</span>
            <input data-role="llm-base-url" type="url" placeholder="https://api.siliconflow.cn/v1/chat/completions" spellcheck="false">
            <small>${t("settings.baseUrlExample")}</small>
          </label>
          <div class="bdsp-field-grid">
            <label class="bdsp-field">
              <span>Model</span>
              <input data-role="llm-model" type="text" placeholder="${t("settings.modelPlaceholder")}" spellcheck="false">
            </label>
            <label class="bdsp-field">
              <span>API Key <a data-role="api-key-link" href="${apiKeyHelpUrl()}" target="_blank" rel="noopener noreferrer">${t("settings.getApiKey")}</a></span>
              <input data-role="llm-api-key" type="password" placeholder="sk-..." spellcheck="false" autocomplete="off">
            </label>
          </div>
          <div class="bdsp-settings-divider"></div>
          <div class="bdsp-settings-extra">
            <label class="bdsp-field">
              <span>${t("settings.uiLanguage")}</span>
              <select data-role="ui-locale">
                <option value="auto">${t("settings.uiLanguageAuto")}</option>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <button class="bdsp-button" type="button" data-action="clear-cache">${t("settings.clearCache")}</button>
          </div>
          <div class="bdsp-settings-actions">
            <button class="bdsp-button" type="button" data-action="close-settings">${t("settings.cancel")}</button>
            <button class="bdsp-button bdsp-button-primary" type="button" data-action="save-settings">${t("settings.save")}</button>
          </div>
        </div>
      </div>
      <div class="bdsp-resizer" data-action="resize" role="separator" aria-orientation="horizontal" title="${t("panel.resizer")}"></div>
    `;

    target.container.insertBefore(root, target.before);
    refs.root = root;
    refs.body = root.querySelector(".bdsp-body");
    refs.title = root.querySelector("[data-role='panel-title']");
    refs.controls = root.querySelector("[data-role='controls']");
    refs.meta = root.querySelector("[data-role='video-meta']");
    refs.status = root.querySelector("[data-role='status']");
    refs.translationTools = root.querySelector("[data-role='translation-tools']");
    refs.select = root.querySelector("[data-role='track-select']");
    refs.targetLanguage = root.querySelector("[data-role='target-language']");
    refs.search = root.querySelector("[data-role='cue-search']");
    refs.viewer = root.querySelector("[data-role='viewer']");
    refs.refresh = root.querySelector("[data-action='refresh']");
    refs.settings = root.querySelector("[data-action='settings']");
    refs.settingsModal = root.querySelector("[data-role='settings-modal']");
    refs.closeSettings = root.querySelectorAll("[data-action='close-settings']");
    refs.saveSettings = root.querySelector("[data-action='save-settings']");
    refs.clearCache = root.querySelector("[data-action='clear-cache']");
    refs.llmBaseUrl = root.querySelector("[data-role='llm-base-url']");
    refs.llmModel = root.querySelector("[data-role='llm-model']");
    refs.llmApiKey = root.querySelector("[data-role='llm-api-key']");
    refs.uiLocale = root.querySelector("[data-role='ui-locale']");
    refs.apiKeyLink = root.querySelector("[data-role='api-key-link']");
    refs.toggleOverlay = root.querySelector("[data-action='toggle-overlay']");
    refs.translateCurrent = root.querySelector("[data-action='translate-current']");
    refs.copySubtitles = root.querySelector("[data-action='copy-subtitles']");
    refs.downloadTxt = root.querySelector("[data-action='download-txt']");
    refs.downloadSrt = root.querySelector("[data-action='download-srt']");
    refs.openSite = root.querySelector("[data-action='open-site']");
    refs.collapse = root.querySelector("[data-action='collapse']");
    refs.resizer = root.querySelector("[data-action='resize']");

    refs.select.addEventListener("change", () => {
      state.selectedTrackId = refs.select.value;
      loadSelectedSubtitle({ autoSelectCachedTranslation: false });
    });
    refs.search.addEventListener("input", () => {
      state.searchQuery = refs.search.value;
      renderViewer();
    });
    refs.targetLanguage.addEventListener("change", () => {
      state.targetLanguage = refs.targetLanguage.value;
      storageSet({ [TARGET_LANGUAGE_STORAGE_KEY]: state.targetLanguage }).catch(() => {});
    });
    refs.refresh.addEventListener("click", () => loadTracks({ force: true }));
    refs.settings.addEventListener("click", openSettingsModal);
    refs.closeSettings.forEach((button) => button.addEventListener("click", closeSettingsModal));
    refs.saveSettings.addEventListener("click", saveSettingsFromModal);
    refs.clearCache.addEventListener("click", clearTranslationCacheFromModal);
    refs.toggleOverlay.addEventListener("click", toggleSubtitleOverlay);
    refs.translateCurrent.addEventListener("click", translateCurrentSubtitle);
    refs.copySubtitles.addEventListener("click", copyCurrentSubtitles);
    refs.downloadTxt.addEventListener("click", () => downloadCurrentSubtitle("txt"));
    refs.downloadSrt.addEventListener("click", () => downloadCurrentSubtitle("srt"));
    refs.openSite.addEventListener("click", openResultPage);
    refs.collapse.addEventListener("click", togglePanel);
    refs.resizer.addEventListener("pointerdown", startResizeDrag);
    protectPanelInteractions(root);
    renderTargetLanguageOptions();
    updateTranslationControls();
    updateSettingsForm();
    applyLocalizedStaticText();
    setStatusKey(state.statusKey, state.statusParams, state.statusTone);
    setPanelCollapsed(state.collapsed);
    updateSubtitleOverlayState();
    return true;
  }

  function protectPanelInteractions(root) {
    const stopEvents = [
      "click",
      "dblclick",
      "mousedown",
      "mouseup",
      "pointerdown",
      "pointerup",
      "touchstart",
      "keydown",
      "keyup",
      "input",
      "change",
    ];
    for (const eventName of stopEvents) {
      root.addEventListener(eventName, (event) => event.stopPropagation());
    }

    root.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
    refs.viewer.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
    refs.viewer.addEventListener("touchmove", (event) => event.stopPropagation(), { passive: true });
  }

  function ensurePanelPlacement() {
    if (!refs.root) {
      return;
    }
    if (!isBilibiliVideoShellReady()) {
      return;
    }

    const target = findDanmakuEmbedTarget();
    if (!target?.container) {
      return;
    }

    const alreadyPlaced = refs.root.parentElement === target.container && refs.root.nextElementSibling === target.before;
    if (alreadyPlaced) {
      return;
    }

    target.container.insertBefore(refs.root, target.before);
  }

  function findDanmakuEmbedTarget() {
    const danmukuBox = document.querySelector("#danmukuBox");
    if (isUsableDanmakuModule(danmukuBox)) {
      return {
        container: danmukuBox.parentElement,
        before: danmukuBox,
      };
    }

    const titleElement = findDanmakuTitleElement();
    if (!titleElement) {
      return null;
    }

    const block = findDanmakuModuleFromTitle(titleElement);
    if (!block?.parentElement || block.contains(document.getElementById(PANEL_ID))) {
      return null;
    }
    return {
      container: block.parentElement,
      before: block,
    };
  }

  function isUsableDanmakuModule(element) {
    if (!element || element.closest(`#${PANEL_ID}`) || !element.parentElement) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width >= 260 && rect.left >= window.innerWidth * 0.34 && rect.top >= 60;
  }

  function findDanmakuTitleElement() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const element = node.parentElement;
        return node.nodeValue &&
          node.nodeValue.includes("弹幕列表") &&
          element &&
          !element.closest(`#${PANEL_ID}`)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    let node = walker.nextNode();
    while (node) {
      if (isVisibleElement(node.parentElement)) {
        return node.parentElement;
      }
      node = walker.nextNode();
    }

    return null;
  }

  function findDanmakuModuleFromTitle(titleElement) {
    const rightColumn = findRightColumnAncestor(titleElement);
    if (rightColumn) {
      let child = titleElement;
      while (child.parentElement && child.parentElement !== rightColumn) {
        child = child.parentElement;
      }
      if (
        child !== titleElement &&
        isVisibleElement(child) &&
        isLikelyRightModuleRect(child.getBoundingClientRect()) &&
        child.textContent.includes("弹幕列表")
      ) {
        return child;
      }
    }

    return findOuterModuleAncestor(titleElement);
  }

  function findRightColumnAncestor(element) {
    let current = element;
    let bestColumn = null;
    while (current && current !== document.body) {
      const rect = current.getBoundingClientRect();
      if (isLikelyRightColumnRect(rect)) {
        bestColumn = current;
      }
      current = current.parentElement;
    }

    return bestColumn;
  }

  function findOuterModuleAncestor(element) {
    let current = element;
    let best = null;
    while (current && current !== document.body) {
      const rect = current.getBoundingClientRect();
      if (isLikelyRightModuleRect(rect) && current.textContent.includes("弹幕列表")) {
        best = current;
      }
      current = current.parentElement;
    }
    return best;
  }

  function isLikelyRightColumnRect(rect) {
    return (
      rect.width >= 260 &&
      rect.width <= 820 &&
      rect.height >= 280 &&
      rect.height <= Math.max(1600, window.innerHeight * 1.6) &&
      rect.left >= window.innerWidth * 0.34 &&
      rect.top >= 60
    );
  }

  function isLikelyRightModuleRect(rect) {
    return (
      rect.width >= 260 &&
      rect.width <= 820 &&
      rect.height >= 48 &&
      rect.height <= 900 &&
      rect.left >= window.innerWidth * 0.34 &&
      rect.top >= 60
    );
  }

  function isVisibleElement(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function startResizeDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = state.viewerHeight;
    const pointerId = event.pointerId;
    refs.root.classList.add("bdsp-panel-resizing");
    refs.resizer.setPointerCapture?.(pointerId);

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const nextHeight = clamp(startHeight + moveEvent.clientY - startY, MIN_VIEWER_HEIGHT, MAX_VIEWER_HEIGHT);
      state.viewerHeight = nextHeight;
      refs.root.style.setProperty("--bdsp-viewer-height", `${nextHeight}px`);
    };
    const onEnd = (endEvent) => {
      endEvent?.preventDefault?.();
      endEvent?.stopPropagation?.();
      refs.root.classList.remove("bdsp-panel-resizing");
      try {
        refs.resizer.releasePointerCapture?.(pointerId);
      } catch {
        // Pointer capture may already be gone when the browser cancels the drag.
      }
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      window.removeEventListener("blur", onEnd, true);
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onEnd, true);
    window.addEventListener("pointercancel", onEnd, true);
    window.addEventListener("blur", onEnd, true);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setStatus(message, tone = "muted") {
    state.status = message;
    state.statusKey = "";
    state.statusParams = {};
    state.statusTone = tone;
    renderStatus();
  }

  function setStatusKey(key, params = {}, tone = "muted") {
    state.statusKey = key;
    state.statusParams = params;
    state.status = t(key, params);
    state.statusTone = tone;
    renderStatus();
  }

  function renderStatus() {
    if (refs.status) {
      const message = state.statusKey ? t(state.statusKey, state.statusParams) : state.status;
      refs.status.textContent = message;
      refs.status.title = message;
      refs.status.dataset.tone = state.statusTone;
    }
  }

  function renderTargetLanguageOptions() {
    if (!refs.targetLanguage || !Translation?.getTargetLanguages) {
      return;
    }
    const selected = Translation.normalizeTargetLanguage(state.targetLanguage);
    refs.targetLanguage.innerHTML = "";
    for (const language of Translation.getTargetLanguages(state.locale)) {
      const option = document.createElement("option");
      option.value = language.code;
      option.textContent = state.locale === "zh"
        ? `${language.label} / ${language.nativeLabel}`
        : language.label;
      refs.targetLanguage.append(option);
    }
    refs.targetLanguage.value = selected;
  }

  function updateTranslationControls() {
    if (refs.translateCurrent) {
      refs.translateCurrent.disabled = state.translating || state.loadingSubtitle || !state.cues.length;
      refs.translateCurrent.textContent = state.translating ? t("translation.translating") : t("translation.translateTo");
    }
    if (refs.targetLanguage) {
      refs.targetLanguage.disabled = state.translating;
      if (refs.targetLanguage.value !== state.targetLanguage) {
        refs.targetLanguage.value = state.targetLanguage;
      }
    }
    if (refs.toggleOverlay) {
      refs.toggleOverlay.classList.toggle("bdsp-button-active", state.overlayEnabled);
      refs.toggleOverlay.setAttribute("aria-pressed", String(state.overlayEnabled));
      refs.toggleOverlay.title = state.overlayEnabled ? t("overlay.disable") : t("overlay.enable");
    }
  }

  function updateSettingsStaticText() {
    if (!refs.settingsModal) {
      return;
    }
    const title = refs.settingsModal.querySelector(".bdsp-settings-title");
    const compat = refs.settingsModal.querySelector(".bdsp-settings-compat");
    const baseUrlHint = refs.settingsModal.querySelector(".bdsp-field small");
    const modelInput = refs.llmModel;
    const apiKeyLink = refs.apiKeyLink;
    const uiLocaleLabel = refs.settingsModal.querySelector(".bdsp-settings-extra .bdsp-field span");
    const autoOption = refs.uiLocale?.querySelector("option[value='auto']");
    const cancelButton = refs.settingsModal.querySelector("[data-action='close-settings'].bdsp-button");
    if (title) title.textContent = t("settings.title");
    if (compat) compat.textContent = t("settings.compat");
    if (baseUrlHint) baseUrlHint.textContent = t("settings.baseUrlExample");
    if (modelInput) modelInput.placeholder = t("settings.modelPlaceholder");
    if (apiKeyLink) {
      apiKeyLink.textContent = t("settings.getApiKey");
      apiKeyLink.href = apiKeyHelpUrl();
    }
    if (uiLocaleLabel) uiLocaleLabel.textContent = t("settings.uiLanguage");
    if (autoOption) autoOption.textContent = t("settings.uiLanguageAuto");
    if (refs.clearCache) refs.clearCache.textContent = t("settings.clearCache");
    if (refs.saveSettings) refs.saveSettings.textContent = t("settings.save");
    if (cancelButton) cancelButton.textContent = t("settings.cancel");
  }

  function updateSettingsForm() {
    if (!refs.settingsModal) {
      return;
    }
    refs.llmBaseUrl.value = state.llmConfig.baseUrl || "";
    refs.llmModel.value = state.llmConfig.model || "";
    refs.llmApiKey.value = state.llmConfig.apiKey || "";
    refs.uiLocale.value = uiLocaleOverride;
    updateSettingsStaticText();
  }

  function openSettingsModal() {
    setPanelCollapsed(false);
    updateSettingsForm();
    refs.settingsModal.hidden = false;
    refs.llmBaseUrl?.focus();
  }

  function closeSettingsModal() {
    if (refs.settingsModal) {
      refs.settingsModal.hidden = true;
    }
  }

  async function saveSettingsFromModal() {
    const nextConfig = {
      baseUrl: refs.llmBaseUrl.value.trim(),
      model: refs.llmModel.value.trim(),
      apiKey: refs.llmApiKey.value.trim(),
    };
    const nextUiLocale = refs.uiLocale.value || "auto";
    state.llmConfig = nextConfig;
    uiLocaleOverride = ["auto", "zh", "en"].includes(nextUiLocale) ? nextUiLocale : "auto";
    state.locale = getPreferredLocale();
    await storageSet({
      [LLM_CONFIG_STORAGE_KEY]: nextConfig,
      [UI_LOCALE_STORAGE_KEY]: uiLocaleOverride,
    });
    closeSettingsModal();
    applyLocalizedStaticText();
    renderAll();
    setStatusKey("status.settingsSaved", {}, "ok");
  }

  async function clearTranslationCacheFromModal() {
    await TranslationCache?.clearTranslationCache?.();
    state.tracks = state.tracks.filter((track) => track.kind !== "ai");
    if (!state.tracks.some((track) => track.id === state.selectedTrackId)) {
      state.selectedTrackId = state.tracks[0]?.id || "";
      state.cues = [];
      if (state.selectedTrackId) {
        await loadSelectedSubtitle({ autoSelectCachedTranslation: false });
      }
    }
    renderTracks();
    renderViewer();
    setStatusKey("status.cacheCleared", {}, "ok");
  }

  function applyLocalizedStaticText() {
    if (!refs.root) {
      return;
    }

    refs.root.setAttribute("aria-label", t("panel.aria"));
    if (refs.title) {
      refs.title.textContent = t("panel.title");
    }
    if (refs.controls) {
      refs.controls.setAttribute("aria-label", t("panel.controls"));
    }
    if (refs.translationTools) {
      refs.translationTools.setAttribute("aria-label", t("translation.tools"));
    }
    if (refs.select) {
      refs.select.setAttribute("aria-label", t("select.aria"));
    }
    if (refs.targetLanguage) {
      refs.targetLanguage.setAttribute("aria-label", t("translation.targetLanguage"));
      renderTargetLanguageOptions();
    }
    if (refs.search) {
      refs.search.placeholder = t("search.placeholder");
      refs.search.setAttribute("aria-label", t("search.aria"));
    }
    if (refs.settings) {
      refs.settings.setAttribute("aria-label", t("settings.open"));
      refs.settings.title = t("settings.open");
    }
    if (refs.toggleOverlay) {
      refs.toggleOverlay.textContent = t("overlay.toggle");
    }
    if (refs.translateCurrent) {
      refs.translateCurrent.textContent = state.translating ? t("translation.translating") : t("translation.translateTo");
    }
    if (refs.refresh) {
      refs.refresh.textContent = state.loadingTracks ? t("button.refreshing") : t("button.refresh");
    }
    if (refs.copySubtitles) {
      refs.copySubtitles.textContent = t("action.copySubtitles");
    }
    if (refs.downloadTxt) {
      refs.downloadTxt.textContent = t("action.downloadTxt");
    }
    if (refs.downloadSrt) {
      refs.downloadSrt.textContent = t("action.downloadSrt");
    }
    if (refs.openSite) {
      refs.openSite.textContent = t("action.aiAnalysis");
    }
    if (refs.resizer) {
      refs.resizer.title = t("panel.resizer");
    }
    updateSettingsStaticText();
    updateTranslationControls();
    renderStatus();
    setPanelCollapsed(state.collapsed);
  }

  function setBusy(isBusy) {
    state.loadingTracks = isBusy;
    if (refs.refresh) {
      refs.refresh.disabled = isBusy || !state.bvid;
      refs.refresh.textContent = isBusy ? t("button.refreshing") : t("button.refresh");
    }
    updateTranslationControls();
  }

  function renderVideoMeta() {
    if (!refs.meta) {
      return;
    }
    if (!state.bvid) {
      refs.meta.textContent = t("meta.noBv");
      refs.openSite.disabled = true;
      return;
    }
    const title = state.title ? ` · ${truncate(state.title, 18)}` : "";
    refs.meta.textContent = `${state.bvid}${title}`;
    refs.openSite.disabled = false;
  }

  function renderTracks() {
    const select = refs.select;
    if (!select) {
      return;
    }

    select.innerHTML = "";
    if (!state.tracks.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = t("select.none");
      select.append(option);
      select.disabled = true;
      return;
    }

    for (const track of state.tracks) {
      const option = document.createElement("option");
      option.value = track.id;
      option.textContent = track.label;
      select.append(option);
    }
    select.disabled = state.loadingTracks;
    select.value = state.selectedTrackId || state.tracks[0].id;
  }

  function renderViewer() {
    if (!refs.viewer) {
      return;
    }

    const visibleCues = getVisibleCues();
    refs.copySubtitles.disabled = !visibleCues.length;
    refs.downloadTxt.disabled = !state.cues.length;
    refs.downloadSrt.disabled = !state.cues.length;
    refs.search.disabled = state.loadingSubtitle || !state.cues.length;
    updateTranslationControls();
    updateOverlayCue();
    if (refs.search && refs.search.value !== state.searchQuery) {
      refs.search.value = state.searchQuery;
    }

    if (state.loadingSubtitle) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">${t("empty.loadingSubtitle")}</div>`;
      return;
    }

    if (!state.bvid) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">${t("empty.notVideoPage")}</div>`;
      return;
    }

    if (!state.tracks.length) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">${t("empty.noSubtitles")}</div>`;
      return;
    }

    if (!state.cues.length) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">${t("empty.noCues")}</div>`;
      return;
    }

    if (!visibleCues.length) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">${escapeHTML(t("empty.noMatches", { query: state.searchQuery.trim() }))}</div>`;
      return;
    }

    const list = document.createElement("ol");
    list.className = "bdsp-cue-list";
    for (const cue of visibleCues) {
      const item = document.createElement("li");
      item.className = "bdsp-cue";
      item.tabIndex = 0;
      item.title = t("cue.jumpTitle", { time: formatClock(cue.from) });
      item.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        seekToCue(cue);
      });
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        seekToCue(cue);
      });
      const time = document.createElement("span");
      time.className = "bdsp-cue-time";
      time.textContent = formatClock(cue.from);
      const text = document.createElement("span");
      text.className = "bdsp-cue-text";
      text.textContent = cue.content;
      item.append(time, text);
      list.append(item);
    }

    refs.viewer.replaceChildren(list);
  }

  function filterCues(cues, query) {
    const keyword = String(query || "").trim().toLocaleLowerCase();
    if (!keyword) {
      return cues;
    }
    return cues.filter((cue) => String(cue.content || "").toLocaleLowerCase().includes(keyword));
  }

  function getVisibleCues() {
    return filterCues(state.cues, state.searchQuery);
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function seekToCue(cue) {
    const seconds = Number(cue?.from);
    if (!Number.isFinite(seconds)) {
      return;
    }

    const video = findCurrentVideoElement();
    if (!video) {
      setStatusKey("error.noPlayer", {}, "warn");
      return;
    }
    rememberActiveVideoElement(video);

    try {
      const duration = Number(video.duration);
      const maxTime = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.05) : seconds;
      const targetTime = clamp(seconds, 0, maxTime);
      video.currentTime = targetTime;
      video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      setStatusKey("status.seeked", { time: formatClock(targetTime) }, "ok");
    } catch (error) {
      setStatus(error.message || t("error.seekFailed"), "error");
    }
  }

  function findCurrentVideoElement() {
    if (isUsableVideoElement(activeVideoElement)) {
      return activeVideoElement;
    }

    const videos = Array.from(document.querySelectorAll("video"));
    if (!videos.length) {
      return null;
    }

    const visibleVideos = videos
      .filter(isUsableVideoElement)
      .map((video) => {
        const rect = video.getBoundingClientRect();
        const area = rect.width * rect.height;
        const score = area +
          (!video.paused ? 1_000_000_000 : 0) +
          (Number(video.currentTime) > 0 ? 10_000_000 : 0) +
          (Number(video.readyState) >= 2 ? 1_000_000 : 0);
        return { video, score };
      })
      .sort((left, right) => right.score - left.score);

    activeVideoElement = visibleVideos[0]?.video || null;
    return activeVideoElement || videos[0];
  }

  function bindVideoActivityListeners() {
    for (const eventName of ["play", "playing", "timeupdate", "seeking", "seeked", "loadedmetadata", "ratechange"]) {
      document.addEventListener(eventName, handleVideoActivity, true);
    }
  }

  function handleVideoActivity(event) {
    if (!rememberActiveVideoElement(event.target)) {
      return;
    }
    if (state.overlayEnabled) {
      updateOverlayCue();
    }
  }

  function rememberActiveVideoElement(element) {
    if (!isMediaElement(element) || element.tagName !== "VIDEO") {
      return false;
    }
    if (!isUsableVideoElement(element)) {
      return false;
    }
    activeVideoElement = element;
    return true;
  }

  function isUsableVideoElement(video) {
    if (!video?.isConnected) {
      return false;
    }
    try {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      return (
        rect.width > 120 &&
        rect.height > 80 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    } catch {
      return false;
    }
  }

  function toggleSubtitleOverlay() {
    state.overlayEnabled = !state.overlayEnabled;
    storageSet({ [OVERLAY_ENABLED_STORAGE_KEY]: state.overlayEnabled }).catch(() => {});
    updateSubtitleOverlayState();
    updateTranslationControls();
  }

  function updateSubtitleOverlayState() {
    if (state.overlayEnabled) {
      ensureSubtitleOverlay();
      startOverlayTimer();
      updateOverlayCue();
      return;
    }
    stopOverlayTimer();
    disableNativeSubtitleTrack();
    hideSubtitleOverlay();
  }

  function ensureSubtitleOverlay() {
    let overlay = document.getElementById("bdsp-subtitle-overlay");
    if (overlay) {
      ensureSubtitleOverlayMarkup(overlay);
      bindSubtitleOverlayEvents(overlay);
      ensureSubtitleOverlayParent(overlay);
      applySubtitleOverlayPosition(overlay);
      return overlay;
    }
    overlay = document.createElement("div");
    overlay.id = "bdsp-subtitle-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    ensureSubtitleOverlayMarkup(overlay);
    bindSubtitleOverlayEvents(overlay);
    ensureSubtitleOverlayParent(overlay);
    applySubtitleOverlayPosition(overlay);
    return overlay;
  }

  function ensureSubtitleOverlayMarkup(overlay) {
    if (!overlay.querySelector("[data-role='overlay-text']")) {
      overlay.innerHTML = `
        <div class="bdsp-overlay-drag-handle" data-role="overlay-drag-handle" aria-hidden="true"><span></span></div>
        <span data-role="overlay-text"></span>
      `;
    }
    if (!overlay.querySelector("[data-role='overlay-drag-handle']")) {
      const handle = document.createElement("div");
      handle.className = "bdsp-overlay-drag-handle";
      handle.dataset.role = "overlay-drag-handle";
      handle.setAttribute("aria-hidden", "true");
      handle.innerHTML = "<span></span>";
      overlay.prepend(handle);
    }
  }

  function bindSubtitleOverlayEvents(overlay) {
    overlay.removeEventListener("pointerdown", startSubtitleOverlayDrag);
    overlay.removeEventListener("mousedown", startSubtitleOverlayDrag);
    overlay.removeEventListener("dblclick", handleSubtitleOverlayDoubleClick);
    overlay.addEventListener("pointerdown", startSubtitleOverlayDrag);
    overlay.addEventListener("mousedown", startSubtitleOverlayDrag);
    overlay.addEventListener("dblclick", handleSubtitleOverlayDoubleClick);
  }

  function handleSubtitleOverlayDoubleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (state.activeCue) {
      seekToCue(state.activeCue);
    }
  }

  function startSubtitleOverlayDrag(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    const overlay = document.getElementById("bdsp-subtitle-overlay");
    if (!overlay || overlayDragState) {
      return;
    }
    const rect = overlay.getBoundingClientRect();
    overlayDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left - rect.width / 2,
      offsetY: event.clientY - rect.top - rect.height / 2,
    };
    overlay.classList.add("bdsp-overlay-dragging");
    try {
      if (event.pointerId !== undefined) {
        overlay.setPointerCapture?.(event.pointerId);
      }
    } catch {
      // Some pages or synthetic events may not allow pointer capture.
    }
    window.addEventListener("pointermove", dragSubtitleOverlay, true);
    window.addEventListener("pointerup", endSubtitleOverlayDrag, true);
    window.addEventListener("pointercancel", endSubtitleOverlayDrag, true);
    window.addEventListener("mousemove", dragSubtitleOverlay, true);
    window.addEventListener("mouseup", endSubtitleOverlayDrag, true);
    event.preventDefault();
    event.stopPropagation();
  }

  function dragSubtitleOverlay(event) {
    if (!overlayDragState) {
      return;
    }
    const overlay = document.getElementById("bdsp-subtitle-overlay");
    if (!overlay) {
      endSubtitleOverlayDrag(event);
      return;
    }
    const bounds = getSubtitleOverlayBounds(overlay);
    const targetX = event.clientX - overlayDragState.offsetX;
    const targetY = event.clientY - overlayDragState.offsetY;
    state.overlayPosition = normalizeOverlayPosition({
      x: (targetX - bounds.left) / bounds.width,
      y: (targetY - bounds.top) / bounds.height,
    }, overlay);
    applySubtitleOverlayPosition(overlay);
    scheduleSubtitleOverlayPositionSave();
    event.preventDefault();
    event.stopPropagation();
  }

  function endSubtitleOverlayDrag(event) {
    const overlay = document.getElementById("bdsp-subtitle-overlay");
    if (overlay) {
      overlay.classList.remove("bdsp-overlay-dragging");
      try {
        if (event?.pointerId !== undefined && overlay.hasPointerCapture?.(event.pointerId)) {
          overlay.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Pointer capture may already have been released.
      }
    }
    overlayDragState = null;
    window.removeEventListener("pointermove", dragSubtitleOverlay, true);
    window.removeEventListener("pointerup", endSubtitleOverlayDrag, true);
    window.removeEventListener("pointercancel", endSubtitleOverlayDrag, true);
    window.removeEventListener("mousemove", dragSubtitleOverlay, true);
    window.removeEventListener("mouseup", endSubtitleOverlayDrag, true);
    saveSubtitleOverlayPosition();
  }

  function applySubtitleOverlayPosition(overlay) {
    if (!overlay) {
      return;
    }
    state.overlayPosition = normalizeOverlayPosition(state.overlayPosition, overlay);
    const fullscreenMount = getSubtitleOverlayFullscreenMount(overlay);
    overlay.style.left = `${state.overlayPosition.x * 100}${fullscreenMount ? "%" : "vw"}`;
    overlay.style.top = `${state.overlayPosition.y * 100}${fullscreenMount ? "%" : "vh"}`;
  }

  function normalizeOverlayPosition(position, overlay) {
    const bounds = getSubtitleOverlayBounds(overlay);
    const halfWidth = overlay ? overlay.offsetWidth / 2 / bounds.width : MIN_OVERLAY_POSITION_RATIO;
    const halfHeight = overlay ? overlay.offsetHeight / 2 / bounds.height : MIN_OVERLAY_POSITION_RATIO;
    const minX = Math.max(MIN_OVERLAY_POSITION_RATIO, halfWidth);
    const maxX = Math.min(MAX_OVERLAY_POSITION_RATIO, 1 - halfWidth);
    const minY = Math.max(MIN_OVERLAY_POSITION_RATIO, halfHeight);
    const maxY = Math.min(MAX_OVERLAY_POSITION_RATIO, 1 - halfHeight);
    const x = Number(position?.x);
    const y = Number(position?.y);
    return {
      x: clamp(Number.isFinite(x) ? x : DEFAULT_OVERLAY_POSITION.x, minX, maxX),
      y: clamp(Number.isFinite(y) ? y : DEFAULT_OVERLAY_POSITION.y, minY, maxY),
    };
  }

  function scheduleSubtitleOverlayPositionSave() {
    window.clearTimeout(overlayPositionSaveTimer);
    overlayPositionSaveTimer = window.setTimeout(saveSubtitleOverlayPosition, OVERLAY_POSITION_SAVE_DELAY_MS);
  }

  function saveSubtitleOverlayPosition() {
    window.clearTimeout(overlayPositionSaveTimer);
    storageSet({ [OVERLAY_POSITION_STORAGE_KEY]: state.overlayPosition }).catch(() => {});
  }

  function handleSubtitleOverlayViewportChange() {
    const overlay = document.getElementById("bdsp-subtitle-overlay");
    if (overlay) {
      ensureSubtitleOverlayParent(overlay);
      applySubtitleOverlayPosition(overlay);
    }
    if (state.overlayEnabled) {
      updateOverlayCue();
    } else {
      disableNativeSubtitleTrack();
    }
  }

  function ensureSubtitleOverlayParent(overlay) {
    const mount = getSubtitleOverlayMount();
    if (!overlay) {
      return;
    }
    if (overlay.parentElement !== mount) {
      mount.append(overlay);
    }
    syncSubtitleOverlayMountState(overlay);
  }

  function getSubtitleOverlayBounds(overlay) {
    const mount = getSubtitleOverlayFullscreenMount(overlay);
    if (mount) {
      const rect = mount.getBoundingClientRect?.() || {};
      return {
        left: Number(rect.left || 0),
        top: Number(rect.top || 0),
        width: Math.max(1, Number(rect.width || mount.clientWidth || window.innerWidth)),
        height: Math.max(1, Number(rect.height || mount.clientHeight || window.innerHeight)),
      };
    }
    return {
      left: 0,
      top: 0,
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
    };
  }

  function getSubtitleOverlayMount() {
    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement && !isMediaElement(fullscreenElement)) {
      return fullscreenElement;
    }
    return document.documentElement;
  }

  function getSubtitleOverlayFullscreenMount(overlay) {
    const fullscreenElement = document.fullscreenElement;
    if (
      !overlay ||
      !fullscreenElement ||
      isMediaElement(fullscreenElement) ||
      overlay.parentElement !== fullscreenElement
    ) {
      return null;
    }
    return fullscreenElement;
  }

  function syncSubtitleOverlayMountState(overlay) {
    if (!overlay) {
      return;
    }
    if (getSubtitleOverlayFullscreenMount(overlay)) {
      overlay.classList.add("bdsp-overlay-fullscreen-mounted");
      overlay.dataset.fullscreenMounted = "true";
      return;
    }
    overlay.classList.remove("bdsp-overlay-fullscreen-mounted");
    delete overlay.dataset.fullscreenMounted;
  }

  function isMediaElement(element) {
    return (
      (typeof HTMLMediaElement !== "undefined" && element instanceof HTMLMediaElement) ||
      element?.tagName === "VIDEO" ||
      element?.tagName === "AUDIO"
    );
  }

  function startOverlayTimer() {
    if (state.overlayTimer) {
      return;
    }
    state.overlayTimer = window.setInterval(updateOverlayCue, 250);
  }

  function stopOverlayTimer() {
    window.clearInterval(state.overlayTimer);
    state.overlayTimer = 0;
  }

  function updateOverlayCue() {
    if (!state.overlayEnabled) {
      disableNativeSubtitleTrack();
      return;
    }
    const video = findCurrentVideoElement();
    if (!video || !state.cues.length) {
      disableNativeSubtitleTrack();
      hideSubtitleOverlay();
      state.activeCue = null;
      return;
    }
    const cue = findCueAtTime(video.currentTime, state.cues);
    state.activeCue = cue || null;
    if (syncNativeFullscreenSubtitles(video)) {
      hideSubtitleOverlay({ force: true });
      return;
    }
    disableNativeSubtitleTrack();
    const overlay = ensureSubtitleOverlay();
    if (!cue) {
      hideSubtitleOverlay();
      return;
    }
    const text = overlay.querySelector("[data-role='overlay-text']");
    if (text) {
      text.textContent = cue.content;
    }
    delete overlay.dataset.dragHold;
    overlay.dataset.trackId = state.selectedTrackId;
    overlay.hidden = false;
  }

  function hideSubtitleOverlay(options = {}) {
    const overlay = document.getElementById("bdsp-subtitle-overlay");
    if (!overlay) {
      return;
    }
    if (!options.force && overlayDragState) {
      overlay.hidden = false;
      overlay.dataset.dragHold = "true";
      return;
    }
    delete overlay.dataset.dragHold;
    overlay.hidden = true;
    const text = overlay.querySelector("[data-role='overlay-text']");
    if (text) {
      text.textContent = "";
    }
  }

  function syncNativeFullscreenSubtitles(media) {
    if (
      !state.overlayEnabled ||
      !isMediaElement(media) ||
      document.fullscreenElement !== media ||
      !state.cues.length
    ) {
      return false;
    }
    const Cue = window.VTTCue || window.TextTrackCue;
    if (!Cue || typeof media.addTextTrack !== "function") {
      return false;
    }
    if (
      nativeSubtitleTrackState.media !== media ||
      nativeSubtitleTrackState.trackId !== state.selectedTrackId ||
      nativeSubtitleTrackState.cuesRef !== state.cues ||
      !nativeSubtitleTrackState.track
    ) {
      if (nativeSubtitleTrackState.media && nativeSubtitleTrackState.media !== media) {
        disableNativeSubtitleTrack();
      }
      const track = getOrCreateNativeSubtitleTrack(media);
      if (!track) {
        return false;
      }
      clearNativeSubtitleTrackCues(track, nativeSubtitleTrackState.track === track ? nativeSubtitleTrackState.cues : []);
      nativeSubtitleTrackState = {
        media,
        track,
        cues: [],
        cuesRef: state.cues,
        trackId: state.selectedTrackId,
      };
      for (const cue of state.cues) {
        const nativeCue = createNativeSubtitleCue(Cue, cue);
        if (!nativeCue) {
          continue;
        }
        try {
          nativeSubtitleTrackState.track.addCue(nativeCue);
          nativeSubtitleTrackState.cues.push(nativeCue);
        } catch {
          // Skip malformed or rejected cues; the DOM overlay remains available outside media fullscreen.
        }
      }
    }
    applyNativeCueLayout();
    try {
      nativeSubtitleTrackState.track.mode = "showing";
    } catch {
      disableNativeSubtitleTrack();
      return false;
    }
    return nativeSubtitleTrackState.cues.length > 0;
  }

  function getOrCreateNativeSubtitleTrack(media) {
    const existing = nativeSubtitleTrackByMedia.get(media);
    if (existing) {
      return existing;
    }
    try {
      const track = media.addTextTrack("subtitles", getNativeSubtitleTrackLabel(), "");
      nativeSubtitleTrackByMedia.set(media, track);
      return track;
    } catch {
      return null;
    }
  }

  function disableNativeSubtitleTrack() {
    const track = nativeSubtitleTrackState.track;
    if (!track) {
      nativeSubtitleTrackState = {
        media: null,
        track: null,
        cues: [],
        cuesRef: null,
        trackId: "",
      };
      return;
    }
    try {
      track.mode = "disabled";
    } catch {
      // Some player wrappers expose read-only track state.
    }
    clearNativeSubtitleTrackCues(track, nativeSubtitleTrackState.cues);
    nativeSubtitleTrackState = {
      media: null,
      track: null,
      cues: [],
      cuesRef: null,
      trackId: "",
    };
  }

  function clearNativeSubtitleTrackCues(track, fallbackCues = []) {
    const cues = Array.from(track?.cues || fallbackCues || []);
    for (const cue of cues) {
      try {
        track.removeCue(cue);
      } catch {
        // The browser may already have detached the cue.
      }
    }
  }

  function createNativeSubtitleCue(Cue, cue) {
    const from = Math.max(0, Number(cue?.from) || 0);
    const rawTo = Number(cue?.to);
    const to = Number.isFinite(rawTo) && rawTo > from ? rawTo : from + 2.5;
    const text = String(cue?.content || "").trim();
    if (!text) {
      return null;
    }
    try {
      return new Cue(from, to, text);
    } catch {
      return null;
    }
  }

  function applyNativeCueLayout() {
    const x = clamp(state.overlayPosition.x * 100, 8, 92);
    const y = clamp(state.overlayPosition.y * 100, 8, 92);
    for (const cue of nativeSubtitleTrackState.cues) {
      try {
        cue.snapToLines = false;
        cue.line = y;
        cue.position = x;
        cue.size = 72;
        cue.align = "center";
        if ("lineAlign" in cue) {
          cue.lineAlign = "center";
        }
        if ("positionAlign" in cue) {
          cue.positionAlign = "center";
        }
      } catch {
        // Native cue layout support differs by browser; the cue text still remains available.
      }
    }
  }

  function getNativeSubtitleTrackLabel() {
    const track = state.tracks.find((item) => item.id === state.selectedTrackId);
    return String(track?.label || track?.targetLanguageLabel || "Bili Subtitle");
  }

  function findCueAtTime(time, cues) {
    const current = Number(time);
    if (!Number.isFinite(current)) {
      return null;
    }
    return (Array.isArray(cues) ? cues : []).find((cue) => {
      const from = Number(cue.from) || 0;
      const to = Number(cue.to);
      const end = Number.isFinite(to) && to > from ? to : from + 2.5;
      return current >= from && current <= end;
    }) || null;
  }

  function renderAll() {
    renderVideoMeta();
    renderTracks();
    renderViewer();
  }

  function normalizeTracks(rawTracks) {
    const tracks = Array.isArray(rawTracks) ? rawTracks : [];
    return tracks
      .map((track, index) => {
        const lan = track.lan || track.lang || track.language || track.code || "";
        const label =
          track.label ||
          track.lanDoc ||
          track.lan_doc ||
          track.name ||
          track.title ||
          lan ||
          t("track.fallback", { number: index + 1 });
        const subtitleUrl = track.subtitleUrl || track.subtitle_url || track.url || "";
        return {
          id: String(track.id || track.trackId || subtitleUrl || lan || index),
          lan,
          label,
          subtitleUrl,
          kind: "official",
          raw: track,
        };
      })
      .filter((track) => track.id);
  }

  function normalizeCueTime(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeCues(response) {
    const body =
      response?.cues ||
      response?.body ||
      response?.subtitleData?.body ||
      response?.subtitle?.body ||
      response?.data?.body ||
      response?.data?.subtitleData?.body ||
      response?.data?.subtitle?.body ||
      [];
    if (!Array.isArray(body)) {
      return [];
    }

    return body
      .map((cue) => ({
        from: normalizeCueTime(cue.from ?? cue.start ?? cue.startTime),
        to: normalizeCueTime(cue.to ?? cue.end ?? cue.endTime),
        content: String(cue.content || cue.text || cue.line || "").trim(),
      }))
      .filter((cue) => cue.content);
  }

  async function refreshVideoContext() {
    const currentHref = window.location.href;
    if (currentHref !== state.lastHref || !refs.root?.isConnected) {
      ensurePanelPlacement();
    }
    if (currentHref !== state.lastHref) {
      parsedInitialState = null;
    }

    const next = readVideoContext();
    const sameRoute = currentHref === state.lastHref && next.bvid === state.bvid;
    const nextCid = next.cid || (sameRoute ? state.cid : null);
    const nextPage = next.page || (sameRoute ? state.page : 1);
    const changed =
      next.bvid !== state.bvid ||
      nextCid !== state.cid ||
      nextPage !== state.page ||
      currentHref !== state.lastHref;
    if (!changed) {
      return;
    }

    state.bvid = next.bvid;
    state.cid = nextCid;
    state.page = nextPage;
    state.title = next.title;
    state.ownerName = next.ownerName;
    state.tracks = [];
    state.selectedTrackId = "";
    state.cues = [];
    state.activeCue = null;
    activeVideoElement = null;
    disableNativeSubtitleTrack();
    state.searchQuery = "";
    state.userToggledCollapse = false;
    setPanelCollapsed(true);
    state.lastHref = currentHref;
    renderAll();

    if (!state.bvid) {
      setStatusKey("status.noBv", {}, "warn");
      renderViewer();
      return;
    }

    scheduleLoadTracks();
  }

  function scheduleLoadTracks() {
    window.clearTimeout(state.loadTracksTimer);
    state.loadTracksTimer = window.setTimeout(() => loadTracks(), LOAD_TRACKS_DELAY_MS);
  }

  async function loadTracks({ force = false } = {}) {
    if (!state.bvid || state.loadingTracks) {
      return;
    }

    setBusy(true);
    setStatusKey(force ? "status.refreshingList" : "status.fetchingList", {}, "muted");
    state.cues = [];
    renderViewer();

    try {
      const response = await sendMessage(MessageType.GET_SUBTITLES, {
        bvid: state.bvid,
        cid: state.cid,
        page: state.page,
        pageUrl: window.location.href,
        title: state.title,
        includeBody: false,
      });
      const rawTracks = response.tracks || response.subtitles || response.subtitleTracks || [];
      state.tracks = normalizeTracks(rawTracks);
      if (response.video) {
        state.cid = response.video.cid || state.cid;
        state.page = response.video.page || state.page;
        state.title = response.video.title || state.title;
        state.ownerName = response.video.owner?.name || state.ownerName;
        renderVideoMeta();
      }

      if (!state.tracks.length) {
        state.selectedTrackId = "";
        setStatusKey("status.noSubtitlesFound", {}, "warn");
        applyAutoPanelVisibility(false);
        renderAll();
        return;
      }

      const previousSelection = state.selectedTrackId;
      const hasPrevious = state.tracks.some((track) => track.id === previousSelection);
      state.selectedTrackId = hasPrevious ? previousSelection : state.tracks[0].id;
      setStatusKey("status.foundSubtitleTracks", { count: state.tracks.length }, "ok");
      renderTracks();
      await loadSelectedSubtitle({ autoSelectCachedTranslation: true });
    } catch (error) {
      state.tracks = [];
      state.selectedTrackId = "";
      state.cues = [];
      setStatus(error.message || t("error.fetchListFailed"), "error");
      applyAutoPanelVisibility(false);
      renderAll();
    } finally {
      setBusy(false);
      renderTracks();
    }
  }

  async function loadSelectedSubtitle({ autoSelectCachedTranslation = false } = {}) {
    const track = state.tracks.find((item) => item.id === state.selectedTrackId);
    if (!track || state.loadingSubtitle) {
      renderViewer();
      return;
    }

    if (track.kind === "ai") {
      state.cues = Array.isArray(track.cues) ? track.cues : [];
      state.activeCue = null;
      const failureCount = Array.isArray(track.failures) ? track.failures.length : 0;
      if (failureCount) {
        setStatusKey("status.translationLoadedPartial", { count: state.cues.length, failed: failureCount }, "warn");
      } else {
        setStatusKey("status.loadedSubtitleLines", { count: state.cues.length }, "ok");
      }
      applyAutoPanelVisibility(Boolean(state.cues.length));
      renderViewer();
      return;
    }

    state.loadingSubtitle = true;
    state.cues = [];
    setStatusKey("status.loadingTrack", { label: track.label }, "muted");
    renderViewer();

    try {
      state.cues = await loadOfficialTrackCues(track);
      if (!state.cues.length) {
        setStatusKey("status.contentEmpty", {}, "warn");
      } else {
        setStatusKey("status.loadedSubtitleLines", { count: state.cues.length }, "ok");
        await restoreCachedTranslationsForSource(track, state.cues, { autoSelect: autoSelectCachedTranslation });
      }
      applyAutoPanelVisibility(Boolean(state.cues.length));
    } catch (error) {
      state.cues = [];
      setStatus(error.message || t("error.fetchContentFailed"), "error");
      applyAutoPanelVisibility(false);
    } finally {
      state.loadingSubtitle = false;
      renderViewer();
    }
  }

  async function loadOfficialTrackCues(track) {
    const response = await sendMessage(MessageType.GET_SUBTITLES, {
      bvid: state.bvid,
      cid: state.cid,
      page: state.page,
      pageUrl: window.location.href,
      includeBody: true,
      subtitleId: track.id,
      lan: track.lan,
      subtitleUrl: track.subtitleUrl,
      track: {
        id: track.id,
        lan: track.lan,
        label: track.label,
        subtitleUrl: track.subtitleUrl,
      },
    });
    return normalizeCues(response);
  }

  async function translateCurrentSubtitle() {
    const selectedTrack = state.tracks.find((track) => track.id === state.selectedTrackId);
    if (!selectedTrack || state.translating) {
      return;
    }
    if (!hasUsableLlmConfig(state.llmConfig)) {
      openSettingsModal();
      setStatusKey("status.translationNeedsConfig", {}, "warn");
      return;
    }

    const targetLanguage = Translation.normalizeTargetLanguage(state.targetLanguage);
    const requestId = createTranslationRequestId();
    state.translationRequestId = requestId;
    state.translationTrackId = "";
    state.translating = true;
    updateTranslationControls();
    setStatusKey("status.translating", { language: Translation.targetLanguageNativeName(targetLanguage) }, "muted");

    try {
      const translationSource = await resolveTranslationSource(selectedTrack);
      const sourceTrack = translationSource?.sourceTrack;
      const sourceCues = cloneCues(translationSource?.sourceCues);
      if (!sourceTrack || !sourceCues.length) {
        setStatusKey("status.contentEmpty", {}, "warn");
        return;
      }

      createPendingGeneratedSubtitleTrack({
        sourceTrack,
        targetLanguage,
        cues: sourceCues,
        requestId,
      });

      const sourceHash = await TranslationCache.hashCues(sourceCues);
      const cacheKey = await TranslationCache.createTranslationCacheKey({
        bvid: state.bvid,
        cid: state.cid,
        page: state.page,
        sourceTrackId: sourceTrack.id,
        targetLanguage,
        sourceHash,
      });
      const cached = await TranslationCache.getCachedTranslation(cacheKey);
      if (cached?.cues?.length) {
        addGeneratedSubtitleTrack({
          sourceTrack,
          targetLanguage,
          cues: cached.cues,
          sourceCues,
          failures: cached.failures || [],
          cacheId: cacheKey,
        });
        setTranslationResultStatus(cached.cues.length, cached.failures || [], true);
        return;
      }

      const response = await sendMessage(MessageType.TRANSLATE_SUBTITLE, {
        bvid: state.bvid,
        cid: state.cid,
        page: state.page,
        pageUrl: window.location.href,
        title: state.title,
        targetLanguage,
        sourceTrack: {
          id: sourceTrack.id,
          lan: sourceTrack.lan,
          label: sourceTrack.label,
          kind: sourceTrack.kind,
        },
        cues: sourceCues,
        requestId,
      });
      const translatedCues = normalizeCues(response);
      const failures = Array.isArray(response.failures) ? response.failures : [];
      addGeneratedSubtitleTrack({
        sourceTrack,
        targetLanguage,
        cues: translatedCues,
        sourceCues,
        failures,
        cacheId: cacheKey,
      });
      await TranslationCache.putCachedTranslation({
        id: cacheKey,
        bvid: state.bvid,
        cid: state.cid,
        page: state.page,
        sourceTrackId: sourceTrack.id,
        sourceTrackLabel: sourceTrack.label,
        targetLanguage,
        sourceHash,
        cues: translatedCues,
        failures,
      });
      setTranslationResultStatus(translatedCues.length, failures, false);
    } catch (error) {
      setStatus(error.message || t("error.translationFailed"), "error");
    } finally {
      state.translating = false;
      state.translationRequestId = "";
      state.translationTrackId = "";
      updateTranslationControls();
    }
  }

  async function resolveTranslationSource(selectedTrack) {
    if (!selectedTrack) {
      return null;
    }
    if (selectedTrack.kind === "ai") {
      const sourceTrack = state.tracks.find((track) => (
        track.id === selectedTrack.sourceTrackId &&
        track.kind !== "ai"
      ));
      if (!sourceTrack) {
        throw new Error(t("error.fetchContentFailed"));
      }
      const savedSourceCues = cloneCues(selectedTrack.sourceCues);
      const sourceCues = savedSourceCues.length ? savedSourceCues : await loadOfficialTrackCues(sourceTrack);
      return { sourceTrack, sourceCues };
    }
    return {
      sourceTrack: selectedTrack,
      sourceCues: cloneCues(state.cues),
    };
  }

  function createTranslationRequestId() {
    return `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }

  function handleTranslationProgress(message = {}) {
    if (!state.translating || !message.requestId || message.requestId !== state.translationRequestId) {
      return;
    }
    if (message.stage === "batch-result" || message.stage === "repair-result") {
      applyPartialTranslatedCues(message.cues);
      if (message.stage === "repair-result") {
        setStatusKey("status.translationRepairProgress", {
          current: normalizeProgressInteger(message.current) || 1,
          total: normalizeProgressInteger(message.total) || 1,
        }, "muted");
      }
      return;
    }
    const language = Translation.targetLanguageNativeName(message.targetLanguage || state.targetLanguage);
    const total = normalizeProgressInteger(message.total ?? message.batchTotal);
    const batch = normalizeProgressInteger(message.batchIndex);
    if (message.stage === "batch-start" && batch && total) {
      setStatusKey("status.translationProgress", { language, current: batch, total }, "muted");
      return;
    }
    if (message.stage === "batch-done" && total) {
      const done = normalizeProgressInteger(message.done);
      if (done) {
        setStatusKey("status.translationProgress", { language, current: done, total }, "muted");
      }
      return;
    }
    if (message.stage === "batch-retry" && batch && total) {
      setStatusKey("status.translationRetry", {
        batch,
        total,
        attempt: normalizeProgressInteger(message.attempt) || 1,
        maxRetries: normalizeProgressInteger(message.maxRetries) || 1,
      }, "warn");
      return;
    }
    if (message.stage === "batch-splitting" && batch && total) {
      setStatusKey("status.translationSplitting", { batch, total }, "warn");
      return;
    }
    if (message.stage === "repair-start") {
      setStatusKey("status.translationRepairStarted", {
        total: normalizeProgressInteger(message.total) || 1,
      }, "warn");
      return;
    }
    if (message.stage === "repair-retry") {
      setStatusKey("status.translationRepairRetry", {
        current: normalizeProgressInteger(message.current) || 1,
        total: normalizeProgressInteger(message.total) || 1,
        attempt: normalizeProgressInteger(message.attempt) || 1,
        maxRetries: normalizeProgressInteger(message.maxRetries) || 1,
      }, "warn");
    }
  }

  function normalizeProgressInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function hasUsableLlmConfig(config) {
    return Boolean(config?.baseUrl && config?.model && config?.apiKey);
  }

  async function restoreCachedTranslationsForSource(sourceTrack, sourceCues, options = {}) {
    if (
      sourceTrack?.kind !== "official" ||
      !Array.isArray(sourceCues) ||
      !sourceCues.length ||
      typeof TranslationCache?.getCachedTranslationsForSource !== "function"
    ) {
      return false;
    }

    let cachedEntries = [];
    try {
      const sourceHash = await TranslationCache.hashCues(sourceCues);
      cachedEntries = await TranslationCache.getCachedTranslationsForSource({
        bvid: state.bvid,
        cid: state.cid,
        page: state.page,
        sourceTrackId: sourceTrack.id,
        sourceHash,
      });
    } catch {
      return false;
    }
    if (!cachedEntries.length) {
      return false;
    }

    const preferredTarget = Translation.normalizeTargetLanguage(state.targetLanguage);
    let preferredTrack = null;
    const restoredTracks = [];
    for (const entry of cachedEntries) {
      const targetLanguage = Translation.normalizeTargetLanguage(entry.targetLanguage);
      if (!targetLanguage || !Array.isArray(entry.cues) || !entry.cues.length) {
        continue;
      }
      const generatedTrack = addGeneratedSubtitleTrack({
        sourceTrack,
        targetLanguage,
        cues: entry.cues,
        sourceCues,
        failures: Array.isArray(entry.failures) ? entry.failures : [],
        cacheId: entry.id,
        select: false,
      });
      restoredTracks.push(generatedTrack);
      if (targetLanguage === preferredTarget) {
        preferredTrack = generatedTrack;
      }
    }

    const trackToSelect = options.autoSelect
      ? preferredTrack || (restoredTracks.length === 1 ? restoredTracks[0] : null)
      : null;
    if (trackToSelect) {
      selectGeneratedSubtitleTrack(trackToSelect, { fromCache: true });
      return true;
    }
    renderTracks();
    return Boolean(restoredTracks.length);
  }

  function createPendingGeneratedSubtitleTrack({ sourceTrack, targetLanguage, cues, requestId, cacheId = "" }) {
    const generatedTrack = addGeneratedSubtitleTrack({
      sourceTrack,
      targetLanguage,
      cues: cloneCues(cues),
      sourceCues: cues,
      failures: [],
      cacheId,
      requestId,
      pending: true,
    });
    state.translationTrackId = generatedTrack.id;
    return generatedTrack;
  }

  function applyPartialTranslatedCues(cues) {
    const updates = Array.isArray(cues) ? cues : [];
    if (!updates.length || !state.translationTrackId) {
      return;
    }
    const track = state.tracks.find((item) => item.id === state.translationTrackId);
    if (!track || !Array.isArray(track.cues)) {
      return;
    }
    const nextCues = cloneCues(track.cues);
    for (const cue of updates) {
      const index = Number(cue?.index);
      const content = String(cue?.content || "").trim();
      if (!Number.isInteger(index) || index < 0 || index >= nextCues.length || !content) {
        continue;
      }
      nextCues[index] = {
        from: normalizeCueTime(cue.from ?? nextCues[index]?.from),
        to: normalizeCueTime(cue.to ?? nextCues[index]?.to),
        content,
      };
    }
    track.cues = nextCues;
    if (state.selectedTrackId === track.id) {
      state.cues = track.cues;
      renderViewer();
    }
  }

  function cloneCues(cues) {
    return (Array.isArray(cues) ? cues : []).map((cue) => ({
      from: normalizeCueTime(cue.from),
      to: normalizeCueTime(cue.to),
      content: String(cue.content || "").trim(),
    }));
  }

  function addGeneratedSubtitleTrack({ sourceTrack, targetLanguage, cues, sourceCues = [], failures = [], cacheId = "", requestId = "", pending = false, select = true }) {
    const target = Translation.normalizeTargetLanguage(targetLanguage);
    const trackId = makeGeneratedTrackId(sourceTrack.id, target);
    const label = `${Translation.targetLanguageNativeName(target)}（AI）`;
    const generatedTrack = {
      id: trackId,
      lan: target,
      label,
      kind: "ai",
      sourceTrackId: sourceTrack.id,
      sourceLabel: sourceTrack.label,
      targetLanguage: target,
      cues,
      sourceCues: cloneCues(sourceCues),
      failures,
      cacheId,
      requestId,
      pending,
    };
    state.tracks = [
      ...state.tracks.filter((track) => track.id !== trackId),
      generatedTrack,
    ];
    if (select) {
      state.selectedTrackId = trackId;
      state.cues = cues;
      state.activeCue = null;
    }
    renderTracks();
    if (select) {
      renderViewer();
    }
    return generatedTrack;
  }

  function selectGeneratedSubtitleTrack(track, options = {}) {
    if (!track) {
      return;
    }
    state.selectedTrackId = track.id;
    state.cues = Array.isArray(track.cues) ? track.cues : [];
    state.activeCue = null;
    renderTracks();
    renderViewer();
    if (options.fromCache) {
      setTranslationResultStatus(state.cues.length, Array.isArray(track.failures) ? track.failures : [], true);
    }
  }

  function makeGeneratedTrackId(sourceTrackId, targetLanguage) {
    return `ai:${String(sourceTrackId || "source")}:${Translation.normalizeTargetLanguage(targetLanguage)}`;
  }

  function setTranslationResultStatus(lineCount, failures, fromCache) {
    const failureCount = failures.length;
    if (failureCount) {
      setStatusKey("status.translationPartial", { count: lineCount, failed: failureCount }, "warn");
      return;
    }
    setStatusKey(fromCache ? "status.translationLoadedFromCache" : "status.translationDone", { count: lineCount }, "ok");
  }

  async function downloadCurrentSubtitle(format) {
    if (!state.cues.length) {
      return;
    }

    setStatusKey("status.downloading", { format: format.toUpperCase() }, "muted");
    try {
      downloadTextFile(formatSubtitleDownload(format), makeDownloadFilename(format), mimeTypeForDownload(format));
      setStatusKey("status.downloadStarted", { format: format.toUpperCase() }, "ok");
    } catch (error) {
      setStatus(error.message || t("error.downloadFailed", { format: format.toUpperCase() }), "error");
    }
  }

  async function copyCurrentSubtitles() {
    const visibleCues = getVisibleCues();
    if (!visibleCues.length) {
      return;
    }

    const text = formatPlainTextDownload(visibleCues);
    try {
      await writeClipboardText(text);
      setStatusKey("status.subtitlesCopied", { count: visibleCues.length }, "ok");
    } catch (error) {
      setStatus(error.message || t("error.copyFailed"), "error");
    }
  }

  async function writeClipboardText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.append(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) {
      throw new Error(t("error.clipboardDenied"));
    }
  }

  function downloadTextFile(text, filename, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.documentElement.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function formatSubtitleDownload(format) {
    if (String(format || "").toLowerCase() === "srt") {
      return formatSrtDownload(state.cues);
    }
    return formatPlainTextDownload(state.cues);
  }

  function formatPlainTextDownload(cues) {
    return cues
      .map((cue) => `[${formatClock(cue.from)}] ${cue.content}`)
      .join("\n") + "\n";
  }

  function formatSrtDownload(cues) {
    return cues
      .map((cue, index) => [
        String(index + 1),
        `${formatSrtTimestamp(cue.from)} --> ${formatSrtTimestamp(cue.to || cue.from + 1)}`,
        cue.content,
      ].join("\n"))
      .join("\n\n") + "\n";
  }

  function formatSrtTimestamp(seconds) {
    const totalMilliseconds = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    const milliseconds = totalMilliseconds % 1000;
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const second = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minute = totalMinutes % 60;
    const hour = Math.floor(totalMinutes / 60);
    return `${padNumber(hour, 2)}:${padNumber(minute, 2)}:${padNumber(second, 2)},${padNumber(milliseconds, 3)}`;
  }

  function padNumber(value, size) {
    return String(value).padStart(size, "0");
  }

  function mimeTypeForDownload(format) {
    return String(format || "").toLowerCase() === "srt"
      ? "application/x-subrip;charset=utf-8"
      : "text/plain;charset=utf-8";
  }

  function makeDownloadFilename(format) {
    const extension = String(format || "txt").toLowerCase() === "srt" ? "srt" : "txt";
    const parts = [state.bvid, state.title, state.ownerName]
      .map(sanitizeDownloadPart)
      .filter(Boolean);
    const base = (parts.join("_") || "bilibili").slice(0, Math.max(1, 180 - extension.length - 1));
    return `${base}.${extension}`;
  }

  function sanitizeDownloadPart(value) {
    return String(value || "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/[\u0000-\u001f\u007f]+/g, "")
      .replace(/\s+/g, " ")
      .replace(/^\.+|\.+$/g, "")
      .trim();
  }

  async function openResultPage() {
    if (!state.bvid) {
      return;
    }
    try {
      await sendMessage(MessageType.OPEN_SITE_RESULT, {
        bvid: state.bvid,
        cid: state.cid,
        page: state.page,
        pageUrl: window.location.href,
        analysisTab: "deep",
        siteBaseUrl: SITE_RESULT_URL,
      });
    } catch {
      const url = new URL(SITE_RESULT_URL);
      url.searchParams.set("bvid", state.bvid);
      url.searchParams.set("analysis", "deep");
      if (state.cid) {
        url.searchParams.set("cid", String(state.cid));
      }
      if (state.page) {
        url.searchParams.set("p", String(state.page));
      }
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    }
  }

  function togglePanel() {
    state.userToggledCollapse = true;
    setPanelCollapsed(!state.collapsed);
  }

  function applyAutoPanelVisibility(hasSubtitles) {
    if (state.userToggledCollapse) {
      return;
    }
    setPanelCollapsed(!hasSubtitles);
  }

  function setPanelCollapsed(collapsed) {
    state.collapsed = Boolean(collapsed);
    if (!refs.root || !refs.collapse) {
      return;
    }
    refs.root.classList.toggle("bdsp-panel-collapsed", state.collapsed);
    refs.collapse.textContent = state.collapsed ? "⌄" : "⌃";
    refs.collapse.setAttribute("aria-label", state.collapsed ? t("panel.expand") : t("panel.collapse"));
    refs.collapse.title = state.collapsed ? t("panel.expand") : t("panel.collapse");
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const restSeconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
  }

  function truncate(value, maxLength) {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength - 1)}...`;
  }

  function startRouteWatcher() {
    if (routeTimer) {
      return;
    }
    routeTimer = window.setInterval(startOrRefresh, ROUTE_POLL_MS);
  }

  function handleLanguageChange() {
    if (uiLocaleOverride !== "auto") {
      return;
    }
    const nextLocale = getPreferredLocale();
    if (nextLocale === state.locale) {
      return;
    }
    state.locale = nextLocale;
    applyLocalizedStaticText();
    renderAll();
  }

  function startPlacementObserver() {
    if (placementObserver || !document.body) {
      return;
    }
    placementObserver = new MutationObserver(() => {
      window.clearTimeout(placementRetryTimer);
      placementRetryTimer = window.setTimeout(startOrRefresh, PLACEMENT_RETRY_MS);
    });
    placementObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopPlacementObserver() {
    if (placementObserver) {
      placementObserver.disconnect();
      placementObserver = null;
    }
    window.clearTimeout(placementRetryTimer);
    window.clearTimeout(mountDelayTimer);
    pendingMountTarget = null;
  }

  function schedulePanelMount() {
    if (refs.root?.isConnected) {
      return;
    }
    if (!isBilibiliVideoShellReady()) {
      pendingMountTarget = null;
      window.clearTimeout(mountDelayTimer);
      return;
    }

    const target = findDanmakuEmbedTarget();
    if (!target?.container || !target.before?.isConnected) {
      pendingMountTarget = null;
      window.clearTimeout(mountDelayTimer);
      return;
    }

    if (pendingMountTarget === target.before) {
      return;
    }

    pendingMountTarget = target.before;
    window.clearTimeout(mountDelayTimer);
    mountDelayTimer = window.setTimeout(() => {
      if (refs.root?.isConnected || pendingMountTarget !== target.before || !target.before.isConnected) {
        return;
      }
      if (!createPanel()) {
        pendingMountTarget = null;
        return;
      }
      pendingMountTarget = null;
      stopPlacementObserver();
      renderAll();
    }, document.readyState === "complete" ? PANEL_MOUNT_DELAY_MS : PANEL_MOUNT_DELAY_MS + 1200);
  }

  function startOrRefresh() {
    if (!isBilibiliVideoShellReady()) {
      if (refs.root?.isConnected) {
        refs.root.remove();
      }
      pendingMountTarget = null;
      window.clearTimeout(mountDelayTimer);
      return;
    }

    if (refs.root) {
      ensurePanelPlacement();
    } else {
      schedulePanelMount();
    }
    refreshVideoContext();
  }

  ready(async () => {
    registerRuntimeMessageListener();
    bindVideoActivityListeners();
    await loadPersistedSettings();
    startPlacementObserver();
    if (document.readyState === "complete") {
      startOrRefresh();
    } else {
      window.addEventListener("load", startOrRefresh, { once: true });
    }
    startRouteWatcher();
    window.addEventListener("languagechange", handleLanguageChange);
    window.addEventListener("resize", handleSubtitleOverlayViewportChange);
    document.addEventListener("fullscreenchange", handleSubtitleOverlayViewportChange);
    window.addEventListener("pagehide", () => {
      window.clearTimeout(overlayPositionSaveTimer);
      disableNativeSubtitleTrack();
      TranslationCache?.pruneStoredTranslationCache?.().catch(() => {});
    });
  });
})();
