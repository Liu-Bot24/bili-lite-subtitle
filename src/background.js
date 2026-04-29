import "./bilibili-api.js";

const Api = globalThis.BilibiliSubtitleApi;
const MESSAGE_TYPES = new Set(["GET_VIDEO_SUBTITLES", "DOWNLOAD_SUBTITLE", "OPEN_SITE_RESULT"]);
const MESSAGE_ALIASES = {
  BILI_SUBTITLE_GET_TRACKS: "GET_VIDEO_SUBTITLES",
  BILI_SUBTITLE_FETCH: "DOWNLOAD_SUBTITLE",
};

if (!Api) {
  throw new Error("BilibiliSubtitleApi is not loaded");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message || {}, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => {
      const errorInfo = serializeError(error);
      sendResponse({ ok: false, error: errorInfo, message: errorInfo.message, errorInfo });
    });
  return true;
});

async function handleMessage(message, sender) {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage || !MESSAGE_TYPES.has(normalizedMessage.type)) {
    throw new Api.BilibiliApiError("Unsupported message type", {
      code: "UNSUPPORTED_MESSAGE",
      details: { type: message && message.type },
    });
  }

  if (normalizedMessage.type === "GET_VIDEO_SUBTITLES") {
    return handleGetVideoSubtitles(normalizedMessage, sender);
  }

  if (normalizedMessage.type === "DOWNLOAD_SUBTITLE") {
    return handleDownloadSubtitle(normalizedMessage, sender);
  }

  return handleOpenSiteResult(normalizedMessage, sender);
}

function normalizeMessage(message) {
  if (!message || typeof message !== "object") return message;
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {};
  const type = MESSAGE_ALIASES[message.type] || message.type;
  const normalized = { ...payload, ...message, type };

  if (message.type === "BILI_SUBTITLE_FETCH") {
    normalized.triggerDownload = false;
    normalized.subtitle = normalized.subtitle || normalized.track;
    normalized.subtitleUrl =
      normalized.subtitleUrl ||
      normalized.subtitle_url ||
      (normalized.track && (normalized.track.subtitleUrl || normalized.track.subtitle_url || normalized.track.url));
  }

  return normalized;
}

async function handleGetVideoSubtitles(message, sender) {
  const url = await resolveVideoUrl(message, sender);
  const result = await Api.getVideoSubtitles({
    url,
    bvid: message.bvid,
    cid: message.cid,
    page: message.page,
    lan: message.lan,
    subtitleId: message.subtitleId,
    subtitleUrl: message.subtitleUrl,
    includeBody: Boolean(message.includeBody),
  });
  return {
    type: "GET_VIDEO_SUBTITLES_RESULT",
    tracks: result.subtitles,
    ...result,
  };
}

async function handleDownloadSubtitle(message, sender) {
  const url = await resolveVideoUrl(message, sender, { allowMissing: true });
  let video = message.video || null;
  let subtitle = message.subtitle || message.track || null;
  let subtitleUrl = getDirectSubtitleUrl(message) || (subtitle && (subtitle.subtitleUrl || subtitle.subtitle_url || subtitle.url));

  if (!subtitleUrl) {
    const list = await Api.getVideoSubtitles({
      url,
      bvid: message.bvid,
      cid: message.cid,
      page: message.page,
      lan: message.lan,
      subtitleId: message.subtitleId,
    });
    video = list.video;
    subtitle = Api.normalizeUrl(message.subtitleUrl)
      ? list.subtitles.find((track) => track.subtitleUrl === Api.normalizeUrl(message.subtitleUrl))
      : list.subtitles.find((track) => message.subtitleId && String(track.id) === String(message.subtitleId)) ||
        list.subtitles.find((track) => message.lan && track.lan === message.lan) ||
        list.subtitles[0];

    if (!subtitle) {
      throw new Api.BilibiliApiError("No subtitles are available for this video", {
        code: "NO_SUBTITLES",
      });
    }
    subtitleUrl = subtitle.subtitleUrl;
  }
  if (!video) {
    video = await Api.fetchViewInfo({
      url,
      bvid: message.bvid,
      cid: message.cid,
      page: message.page,
    }).catch(() => null);
  }

  const format = message.format || "srt";
  const formatted = await Api.fetchAndFormatSubtitle({
    subtitleUrl,
    subtitle,
    video,
    bvid: message.bvid,
    title: message.title,
    ownerName: message.ownerName,
    page: message.page,
    lan: message.lan,
    format,
    filename: message.filename,
  });

  let downloadId = null;
  if (message.triggerDownload !== false && chrome.downloads && chrome.downloads.download) {
    downloadId = await saveTextDownload(formatted.text, formatted.filename, formatted.mimeType, format);
  }

  return {
    type: "DOWNLOAD_SUBTITLE_RESULT",
    video,
    subtitle,
    subtitleUrl,
    format,
    filename: formatted.filename,
    downloadId,
    subtitleData: formatted.subtitleData,
    body: formatted.subtitleData.body,
    cues: formatted.subtitleData.body,
    text: formatted.text,
  };
}

async function handleOpenSiteResult(message, sender) {
  const url = await resolveVideoUrl(message, sender, { allowMissing: true });
  let video = message.video || null;

  if (!message.bvid && !Api.extractBvid(url) && !video) {
    throw new Api.BilibiliApiError("No BV id found for site jump", {
      code: "MISSING_BVID",
    });
  }

  if (!video && (message.includeCid || message.cid || message.page)) {
    video = await Api.fetchViewInfo({
      url,
      bvid: message.bvid,
      cid: message.cid,
      page: message.page,
    });
  }

  const targetUrl = Api.buildSiteResultUrl({
    url,
    video,
    bvid: message.bvid,
    cid: message.cid,
    page: message.page,
    analysisTab: message.analysisTab,
    siteBaseUrl: message.siteBaseUrl,
  });

  if (chrome.tabs && chrome.tabs.create) {
    await chromePromise(chrome.tabs.create.bind(chrome.tabs), { url: targetUrl });
  }

  return {
    type: "OPEN_SITE_RESULT_RESULT",
    url: targetUrl,
  };
}

async function resolveVideoUrl(message, sender, options = {}) {
  if (message.videoUrl) return message.videoUrl;
  if (message.currentUrl) return message.currentUrl;
  if (message.pageUrl) return message.pageUrl;
  if (message.sourceUrl) return message.sourceUrl;
  if (message.url && Api.extractBvid(message.url)) return message.url;
  if (message.bvid) return `https://www.bilibili.com/video/${message.bvid}/`;
  if (sender && sender.tab && sender.tab.url) return sender.tab.url;

  const activeTab = await getActiveTab().catch(() => null);
  if (activeTab && activeTab.url) return activeTab.url;
  if (options.allowMissing) return "";

  throw new Api.BilibiliApiError("Could not resolve the current Bilibili tab URL", {
    code: "MISSING_TAB_URL",
  });
}

async function getActiveTab() {
  if (!chrome.tabs || !chrome.tabs.query) return null;
  const tabs = await chromePromise(chrome.tabs.query.bind(chrome.tabs), { active: true, currentWindow: true });
  return Array.isArray(tabs) && tabs.length ? tabs[0] : null;
}

async function saveTextDownload(text, filename, mimeType, format) {
  return chromePromise(chrome.downloads.download.bind(chrome.downloads), {
    url: makeTextDataUrl(text, mimeType),
    filename: ensureDownloadFilename(filename, format),
    saveAs: false,
    conflictAction: "uniquify",
  });
}

function ensureDownloadFilename(filename, format) {
  const extension = String(format || "txt").toLowerCase() === "srt" ? "srt" : "txt";
  const suffix = `.${extension}`;
  let safeName = String(filename || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  safeName = safeName.replace(/^\.+|\.+$/g, "");
  if (!safeName) {
    safeName = `subtitle${suffix}`;
  }
  if (!safeName.toLowerCase().endsWith(suffix)) {
    safeName = safeName.replace(/\.[^.]*$/u, "").replace(/\.+$/g, "");
    safeName = `${safeName || "subtitle"}${suffix}`;
  }
  if (safeName.length > 180) {
    return `${safeName.slice(0, Math.max(1, 180 - suffix.length))}${suffix}`;
  }
  return safeName;
}

function makeTextDataUrl(text, mimeType) {
  return `data:${mimeType || "text/plain;charset=utf-8"},${encodeURIComponent(text || "")}`;
}

function getDirectSubtitleUrl(message) {
  const directUrl = message.subtitleUrl || message.subtitle_url;
  if (directUrl) return directUrl;
  if (!message.url || Api.extractBvid(message.url)) return "";
  return message.url;
}

function chromePromise(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const lastError = chrome.runtime && chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

function serializeError(error) {
  return {
    name: error && error.name ? error.name : "Error",
    message: error && error.message ? error.message : "Unknown error",
    code: error && error.code ? error.code : "UNKNOWN_ERROR",
    status: error && error.status ? error.status : 0,
    details: error && error.details ? error.details : null,
  };
}
