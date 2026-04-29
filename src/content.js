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

  const MessageType = Object.freeze({
    GET_SUBTITLES: "GET_VIDEO_SUBTITLES",
    DOWNLOAD_SUBTITLE: "DOWNLOAD_SUBTITLE",
    OPEN_SITE_RESULT: "OPEN_SITE_RESULT",
  });

  const state = {
    bvid: "",
    cid: null,
    page: 1,
    title: "",
    ownerName: "",
    tracks: [],
    selectedTrackId: "",
    cues: [],
    searchQuery: "",
    status: "正在识别当前视频",
    statusTone: "muted",
    collapsed: false,
    userToggledCollapse: false,
    loadingTracks: false,
    loadingSubtitle: false,
    lastHref: "",
    viewerHeight: DEFAULT_VIEWER_HEIGHT,
    loadTracksTimer: 0,
  };

  const refs = {};
  let routeTimer = 0;
  let placementObserver = null;
  let placementRetryTimer = 0;
  let mountDelayTimer = 0;
  let pendingMountTarget = null;
  let parsedInitialState = null;

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
        reject(new Error("扩展通信不可用，请重新加载扩展"));
        return;
      }

      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message || "扩展后台无响应"));
          return;
        }
        if (response?.ok === false) {
          reject(new Error(response.error?.message || response.message || "字幕获取失败"));
          return;
        }
        resolve(response?.data ?? response ?? {});
      });
    });
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
    root.setAttribute("aria-label", "B站字幕列表");
    root.style.setProperty("--bdsp-viewer-height", `${state.viewerHeight}px`);
    root.innerHTML = `
      <div class="bdsp-header">
        <div class="bdsp-title-group">
          <div class="bdsp-title-line">
            <div class="bdsp-title">字幕列表</div>
            <div class="bdsp-status" data-role="status">识别中</div>
          </div>
          <div class="bdsp-video" data-role="video-meta">等待识别视频</div>
        </div>
        <button class="bdsp-icon-button" type="button" data-action="collapse" aria-label="折叠字幕面板" title="折叠字幕面板">⌃</button>
      </div>

      <div class="bdsp-body">
        <div class="bdsp-controls" aria-label="字幕控制">
          <select class="bdsp-select" data-role="track-select" aria-label="字幕语言" disabled>
            <option value="">暂无字幕</option>
          </select>
          <input class="bdsp-search" data-role="cue-search" type="search" placeholder="搜索字幕" aria-label="搜索字幕关键词" autocomplete="off" spellcheck="false">
          <button class="bdsp-button bdsp-button-secondary" type="button" data-action="refresh">刷新</button>
        </div>

        <div class="bdsp-viewer" data-role="viewer" aria-live="polite">
          <div class="bdsp-empty">打开 B 站视频页后自动读取字幕。</div>
        </div>

        <div class="bdsp-actions">
          <button class="bdsp-button" type="button" data-action="copy-subtitles" disabled>复制字幕</button>
          <button class="bdsp-button" type="button" data-action="download-txt" disabled>下载 TXT</button>
          <button class="bdsp-button" type="button" data-action="download-srt" disabled>下载 SRT</button>
          <button class="bdsp-button bdsp-button-primary bdsp-button-ai" type="button" data-action="open-site" disabled>AI分析</button>
        </div>
      </div>
      <div class="bdsp-resizer" data-action="resize" role="separator" aria-orientation="horizontal" title="拖动调整字幕列表高度"></div>
    `;

    target.container.insertBefore(root, target.before);
    refs.root = root;
    refs.body = root.querySelector(".bdsp-body");
    refs.meta = root.querySelector("[data-role='video-meta']");
    refs.status = root.querySelector("[data-role='status']");
    refs.select = root.querySelector("[data-role='track-select']");
    refs.search = root.querySelector("[data-role='cue-search']");
    refs.viewer = root.querySelector("[data-role='viewer']");
    refs.refresh = root.querySelector("[data-action='refresh']");
    refs.copySubtitles = root.querySelector("[data-action='copy-subtitles']");
    refs.downloadTxt = root.querySelector("[data-action='download-txt']");
    refs.downloadSrt = root.querySelector("[data-action='download-srt']");
    refs.openSite = root.querySelector("[data-action='open-site']");
    refs.collapse = root.querySelector("[data-action='collapse']");
    refs.resizer = root.querySelector("[data-action='resize']");

    refs.select.addEventListener("change", () => {
      state.selectedTrackId = refs.select.value;
      loadSelectedSubtitle();
    });
    refs.search.addEventListener("input", () => {
      state.searchQuery = refs.search.value;
      renderViewer();
    });
    refs.refresh.addEventListener("click", () => loadTracks({ force: true }));
    refs.copySubtitles.addEventListener("click", copyCurrentSubtitles);
    refs.downloadTxt.addEventListener("click", () => downloadCurrentSubtitle("txt"));
    refs.downloadSrt.addEventListener("click", () => downloadCurrentSubtitle("srt"));
    refs.openSite.addEventListener("click", openResultPage);
    refs.collapse.addEventListener("click", togglePanel);
    refs.resizer.addEventListener("pointerdown", startResizeDrag);
    protectPanelInteractions(root);
    unlockPointerAncestors(root);
    setPanelCollapsed(state.collapsed);
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

  function unlockPointerAncestors(root) {
    let current = root;
    while (current && current !== document.body) {
      if (getComputedStyle(current).pointerEvents === "none") {
        current.style.pointerEvents = "auto";
      }
      current = current.parentElement;
    }
  }

  function ensurePanelPlacement() {
    if (!refs.root) {
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
    unlockPointerAncestors(refs.root);
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
    state.statusTone = tone;
    if (refs.status) {
      refs.status.textContent = message;
      refs.status.dataset.tone = tone;
    }
  }

  function setBusy(isBusy) {
    state.loadingTracks = isBusy;
    if (refs.refresh) {
      refs.refresh.disabled = isBusy || !state.bvid;
      refs.refresh.textContent = isBusy ? "刷新中" : "刷新";
    }
  }

  function renderVideoMeta() {
    if (!refs.meta) {
      return;
    }
    if (!state.bvid) {
      refs.meta.textContent = "未检测到 BV 号";
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
      option.textContent = "暂无字幕";
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
    if (refs.search && refs.search.value !== state.searchQuery) {
      refs.search.value = state.searchQuery;
    }

    if (state.loadingSubtitle) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">正在读取字幕...</div>`;
      return;
    }

    if (!state.bvid) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">当前页面不是 B 站视频页。</div>`;
      return;
    }

    if (!state.tracks.length) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">没有可查看的字幕。登录 B 站后可点击刷新再试。</div>`;
      return;
    }

    if (!state.cues.length) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">选择字幕语言后将在这里显示内容。</div>`;
      return;
    }

    if (!visibleCues.length) {
      refs.viewer.innerHTML = `<div class="bdsp-empty">没有匹配“${escapeHTML(state.searchQuery.trim())}”的字幕。</div>`;
      return;
    }

    const list = document.createElement("ol");
    list.className = "bdsp-cue-list";
    for (const cue of visibleCues) {
      const item = document.createElement("li");
      item.className = "bdsp-cue";
      item.tabIndex = 0;
      item.title = `双击跳转到 ${formatClock(cue.from)}`;
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
      setStatus("未找到播放器", "warn");
      return;
    }

    try {
      const duration = Number(video.duration);
      const maxTime = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.05) : seconds;
      const targetTime = clamp(seconds, 0, maxTime);
      video.currentTime = targetTime;
      video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      setStatus(`已跳转 ${formatClock(targetTime)}`, "ok");
    } catch (error) {
      setStatus(error.message || "跳转失败", "error");
    }
  }

  function findCurrentVideoElement() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (!videos.length) {
      return null;
    }

    const visibleVideos = videos
      .map((video) => ({
        video,
        rect: video.getBoundingClientRect(),
        style: getComputedStyle(video),
      }))
      .filter(({ rect, style }) => (
        rect.width > 120 &&
        rect.height > 80 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      ))
      .sort((left, right) => (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height));

    return visibleVideos[0]?.video || videos[0];
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
          `字幕 ${index + 1}`;
        const subtitleUrl = track.subtitleUrl || track.subtitle_url || track.url || "";
        return {
          id: String(track.id || track.trackId || subtitleUrl || lan || index),
          lan,
          label,
          subtitleUrl,
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
    state.searchQuery = "";
    state.userToggledCollapse = false;
    state.lastHref = currentHref;
    renderAll();

    if (!state.bvid) {
      setStatus("未检测到 B 站视频 BV 号", "warn");
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
    setStatus(force ? "正在刷新字幕列表" : "正在获取字幕列表", "muted");
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
        setStatus("没有找到可用字幕", "warn");
        applyAutoPanelVisibility(false);
        renderAll();
        return;
      }

      const previousSelection = state.selectedTrackId;
      const hasPrevious = state.tracks.some((track) => track.id === previousSelection);
      state.selectedTrackId = hasPrevious ? previousSelection : state.tracks[0].id;
      setStatus(`已找到 ${state.tracks.length} 条字幕`, "ok");
      renderTracks();
      await loadSelectedSubtitle();
    } catch (error) {
      state.tracks = [];
      state.selectedTrackId = "";
      state.cues = [];
      setStatus(error.message || "字幕列表获取失败", "error");
      applyAutoPanelVisibility(false);
      renderAll();
    } finally {
      setBusy(false);
      renderTracks();
    }
  }

  async function loadSelectedSubtitle() {
    const track = state.tracks.find((item) => item.id === state.selectedTrackId);
    if (!track || state.loadingSubtitle) {
      renderViewer();
      return;
    }

    state.loadingSubtitle = true;
    state.cues = [];
    setStatus(`正在读取${track.label}`, "muted");
    renderViewer();

    try {
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
      state.cues = normalizeCues(response);
      if (!state.cues.length) {
        setStatus("字幕内容为空", "warn");
      } else {
        setStatus(`已载入 ${state.cues.length} 行字幕`, "ok");
      }
      applyAutoPanelVisibility(Boolean(state.cues.length));
    } catch (error) {
      state.cues = [];
      setStatus(error.message || "字幕内容获取失败", "error");
      applyAutoPanelVisibility(false);
    } finally {
      state.loadingSubtitle = false;
      renderViewer();
    }
  }

  async function downloadCurrentSubtitle(format) {
    if (!state.cues.length) {
      return;
    }

    setStatus(`正在下载 ${format.toUpperCase()}`, "muted");
    try {
      downloadTextFile(formatSubtitleDownload(format), makeDownloadFilename(format), mimeTypeForDownload(format));
      setStatus(`${format.toUpperCase()} 已开始下载`, "ok");
    } catch (error) {
      setStatus(error.message || `${format.toUpperCase()} 下载失败`, "error");
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
      setStatus(`已复制 ${visibleCues.length} 行字幕`, "ok");
    } catch (error) {
      setStatus(error.message || "复制字幕失败", "error");
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
      throw new Error("浏览器未允许复制");
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
    if (state.userToggledCollapse || !refs.root) {
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
    refs.collapse.setAttribute("aria-label", state.collapsed ? "展开字幕面板" : "折叠字幕面板");
    refs.collapse.title = state.collapsed ? "展开字幕面板" : "折叠字幕面板";
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
    if (refs.root) {
      ensurePanelPlacement();
    } else {
      schedulePanelMount();
    }
    refreshVideoContext();
  }

  ready(() => {
    startPlacementObserver();
    if (document.readyState === "complete") {
      startOrRefresh();
    } else {
      window.addEventListener("load", startOrRefresh, { once: true });
    }
    startRouteWatcher();
  });
})();
