(function initBilibiliSubtitleApi(global) {
  "use strict";

  const API_BASE = "https://api.bilibili.com";
  const DEFAULT_SITE_BASE_URL = "https://danmu.liu-qi.cn/";
  const BVID_RE = /(BV[0-9A-Za-z]{10,})/;

  class BilibiliApiError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "BilibiliApiError";
      this.code = options.code || "BILIBILI_API_ERROR";
      this.status = options.status || 0;
      this.details = options.details || null;
    }
  }

  function extractBvid(input) {
    if (!input) return "";
    const text = String(input);
    const match = text.match(BVID_RE);
    return match ? match[1] : "";
  }

  function getUrlPage(input) {
    if (!input) return 1;
    try {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("p") || url.searchParams.get("page") || 1);
      return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    } catch (_error) {
      return 1;
    }
  }

  function normalizeUrl(url) {
    if (!url) return "";
    const value = String(url).trim();
    if (!value) return "";
    if (value.startsWith("//")) return `https:${value}`;
    if (value.startsWith("/")) return `${API_BASE}${value}`;
    return value;
  }

  function makeQuery(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    });
    return query.toString();
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      credentials: options.credentials || "omit",
      headers: {
        accept: "application/json, text/plain, */*",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new BilibiliApiError(`Request failed with HTTP ${response.status}`, {
        code: "HTTP_ERROR",
        status: response.status,
        details: { url: stripSensitiveQuery(url) },
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new BilibiliApiError("Response is not valid JSON", {
        code: "INVALID_JSON",
        status: response.status,
        details: { url: stripSensitiveQuery(url), cause: error.message },
      });
    }
  }

  function stripSensitiveQuery(url) {
    try {
      const parsed = new URL(url);
      const safeParams = new URLSearchParams();
      for (const key of ["bvid", "cid", "aid"]) {
        if (parsed.searchParams.has(key)) safeParams.set(key, parsed.searchParams.get(key));
      }
      parsed.search = safeParams.toString();
      return parsed.toString();
    } catch (_error) {
      return String(url).split("?")[0];
    }
  }

  function requireOkPayload(payload, source) {
    if (!payload || typeof payload !== "object") {
      throw new BilibiliApiError(`${source} returned an empty response`, {
        code: "EMPTY_RESPONSE",
      });
    }
    if (Number(payload.code) !== 0) {
      throw new BilibiliApiError(payload.message || `${source} returned code ${payload.code}`, {
        code: "BILIBILI_RESPONSE_ERROR",
        details: { responseCode: payload.code, source },
      });
    }
    return payload.data || {};
  }

  function selectPage(viewData, pageNumber, explicitCid) {
    const pages = Array.isArray(viewData.pages) ? viewData.pages : [];
    if (explicitCid) {
      const cid = Number(explicitCid);
      const matched = pages.find((page) => Number(page.cid) === cid);
      return {
        cid,
        page: matched ? Number(matched.page) || pageNumber : pageNumber,
        part: matched ? matched.part || "" : "",
        duration: matched ? Number(matched.duration) || 0 : 0,
      };
    }

    const targetPage = pages.find((page) => Number(page.page) === Number(pageNumber));
    const fallbackPage = pages[0] || null;
    const selected = targetPage || fallbackPage;
    return {
      cid: selected ? Number(selected.cid) : Number(viewData.cid),
      page: selected ? Number(selected.page) || pageNumber : pageNumber,
      part: selected ? selected.part || "" : "",
      duration: selected ? Number(selected.duration) || 0 : Number(viewData.duration) || 0,
    };
  }

  async function fetchViewInfo(options = {}) {
    const bvid = options.bvid || extractBvid(options.url);
    if (!bvid) {
      throw new BilibiliApiError("No BV id found in the current Bilibili URL", {
        code: "MISSING_BVID",
      });
    }

    const endpoint = `${API_BASE}/x/web-interface/view?${makeQuery({ bvid })}`;
    const payload = await fetchJson(endpoint, { credentials: "include" });
    const data = requireOkPayload(payload, "view");
    const pageNumber = Number(options.page) || getUrlPage(options.url);
    const selectedPage = selectPage(data, pageNumber, options.cid);

    if (!selectedPage.cid) {
      throw new BilibiliApiError("Could not resolve cid for this video", {
        code: "MISSING_CID",
        details: { bvid, page: pageNumber },
      });
    }

    return {
      bvid,
      aid: Number(data.aid) || 0,
      cid: selectedPage.cid,
      page: selectedPage.page,
      part: selectedPage.part,
      title: data.title || "",
      owner: data.owner
        ? {
            mid: Number(data.owner.mid) || 0,
            name: data.owner.name || "",
          }
        : null,
      duration: Number(data.duration) || selectedPage.duration || 0,
      pages: Array.isArray(data.pages)
        ? data.pages.map((page) => ({
            cid: Number(page.cid) || 0,
            page: Number(page.page) || 0,
            part: page.part || "",
            duration: Number(page.duration) || 0,
          }))
        : [],
    };
  }

  async function fetchPlayerInfo(video) {
    if (!video || !video.bvid || !video.cid) {
      throw new BilibiliApiError("Missing video bvid or cid", {
        code: "MISSING_VIDEO_IDENTIFIERS",
      });
    }

    const endpoint = `${API_BASE}/x/player/wbi/v2?${makeQuery({
      bvid: video.bvid,
      cid: video.cid,
      aid: video.aid || undefined,
    })}`;
    const payload = await fetchJson(endpoint, { credentials: "include" });
    return requireOkPayload(payload, "player");
  }

  function normalizeSubtitleTrack(track, index) {
    const url = normalizeUrl(track.subtitle_url || track.url || "");
    return {
      id: track.id || track.id_str || `${track.lan || "subtitle"}-${index + 1}`,
      lan: track.lan || "",
      lanDoc: track.lan_doc || track.lanDoc || track.lan || "",
      subtitleUrl: url,
      type: Number(track.type) || 0,
      aiStatus: Number(track.ai_status) || 0,
      authorMid: Number(track.author_mid) || 0,
      author: track.author || null,
      raw: {
        id: track.id || track.id_str || null,
        lan: track.lan || "",
        lan_doc: track.lan_doc || "",
        type: track.type || 0,
        ai_status: track.ai_status || 0,
      },
    };
  }

  async function getVideoSubtitles(options = {}) {
    const video = await fetchViewInfo(options);
    const player = await fetchPlayerInfo(video);
    const subtitle = player.subtitle || {};
    const tracks = Array.isArray(subtitle.subtitles) ? subtitle.subtitles : [];
    const subtitles = tracks
      .map(normalizeSubtitleTrack)
      .filter((track) => Boolean(track.subtitleUrl));

    const result = {
      video,
      needLoginSubtitle: Boolean(player.need_login_subtitle),
      subtitles,
      selectedSubtitle: null,
      subtitleData: null,
    };

    if (options.includeBody && subtitles.length) {
      const selected = pickSubtitle(subtitles, options);
      result.selectedSubtitle = selected;
      result.subtitleData = await fetchSubtitleJson(selected.subtitleUrl);
    }

    return result;
  }

  function pickSubtitle(subtitles, options = {}) {
    if (!Array.isArray(subtitles) || !subtitles.length) {
      throw new BilibiliApiError("No subtitles are available for this video", {
        code: "NO_SUBTITLES",
      });
    }
    if (options.subtitleUrl) {
      const target = normalizeUrl(options.subtitleUrl);
      const matched = subtitles.find((track) => track.subtitleUrl === target);
      if (matched) return matched;
    }
    if (options.subtitleId) {
      const targetId = String(options.subtitleId);
      const matched = subtitles.find((track) => String(track.id) === targetId);
      if (matched) return matched;
    }
    if (options.lan) {
      const targetLan = String(options.lan);
      const matched = subtitles.find((track) => track.lan === targetLan);
      if (matched) return matched;
    }
    return subtitles[0];
  }

  async function fetchSubtitleJson(subtitleUrl) {
    const url = normalizeUrl(subtitleUrl);
    if (!url) {
      throw new BilibiliApiError("Missing subtitle URL", {
        code: "MISSING_SUBTITLE_URL",
      });
    }
    const payload = await fetchJson(url, { credentials: "omit" });
    const body = Array.isArray(payload.body) ? payload.body : [];
    return {
      ...payload,
      body: body.map(normalizeCue).filter((cue) => cue.content),
    };
  }

  function normalizeCue(cue) {
    const from = Number(cue.from ?? cue.start ?? 0);
    const to = Number(cue.to ?? cue.end ?? from);
    return {
      from: Number.isFinite(from) ? from : 0,
      to: Number.isFinite(to) ? to : Number.isFinite(from) ? from : 0,
      content: cleanText(cue.content || cue.text || ""),
      location: Number(cue.location) || 0,
    };
  }

  function cleanText(text) {
    return String(text)
      .replace(/\ufeff/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function pad3(value) {
    return String(value).padStart(3, "0");
  }

  function formatClock(seconds, withMilliseconds) {
    const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (withMilliseconds) return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
    return h ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  function formatSubtitle(subtitleData, options = {}) {
    const format = String(options.format || "srt").toLowerCase();
    const cues = Array.isArray(subtitleData && subtitleData.body) ? subtitleData.body : [];
    if (format === "json") {
      return `${JSON.stringify(subtitleData, null, 2)}\n`;
    }
    if (format === "txt") {
      return cues.map((cue) => `[${formatClock(cue.from, false)}] ${cue.content}`).join("\n") + (cues.length ? "\n" : "");
    }
    if (format === "compact") {
      return formatCompactText(cues);
    }
    return formatSrt(cues);
  }

  function formatSrt(cues) {
    return cues
      .map((cue, index) => {
        const start = formatClock(cue.from, true);
        const end = formatClock(cue.to || cue.from + 1, true);
        return `${index + 1}\n${start} --> ${end}\n${cue.content}`;
      })
      .join("\n\n")
      .concat(cues.length ? "\n" : "");
  }

  function formatCompactText(cues) {
    const lines = [];
    let groupStart = null;
    let groupEnd = 0;
    let parts = [];

    function flush() {
      if (groupStart === null || !parts.length) return;
      lines.push(`[${formatClock(groupStart, false)}] ${joinTextParts(parts)}`);
      groupStart = null;
      groupEnd = 0;
      parts = [];
    }

    cues.forEach((cue) => {
      if (groupStart === null) {
        groupStart = cue.from;
        groupEnd = cue.to;
        parts = [cue.content];
        return;
      }
      const nextText = joinTextParts([...parts, cue.content]);
      if (cue.to - groupStart > 24 || nextText.length > 280) {
        flush();
        groupStart = cue.from;
        groupEnd = cue.to;
        parts = [cue.content];
      } else {
        groupEnd = cue.to;
        parts.push(cue.content);
      }
    });
    flush();
    return lines.join("\n") + (lines.length ? "\n" : "");
  }

  function joinTextParts(parts) {
    return parts
      .map(cleanText)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+([,.;:!?，。！？；：、])/g, "$1")
      .trim();
  }

  function extensionFromFormat(format) {
    const normalized = String(format || "srt").toLowerCase();
    if (normalized === "json") return "json";
    if (normalized === "txt" || normalized === "compact") return "txt";
    return "srt";
  }

  function makeSubtitleFilename(options = {}) {
    const format = options.format || "srt";
    const extension = extensionFromFormat(format);
    const bvid = options.bvid || (options.video && options.video.bvid) || "bilibili";
    const title = options.title || (options.video && options.video.title) || "";
    const ownerName = options.ownerName || (options.video && options.video.owner && options.video.owner.name) || "";
    const page = options.page || (options.video && options.video.page) || "";
    const pagePart = page && Number(page) > 1 ? `_p${page}` : "";
    const parts = [String(bvid) + pagePart, title, ownerName]
      .map(sanitizeFilenamePart)
      .filter(Boolean);
    return buildFilename(parts.join("_") || "bilibili", extension);
  }

  function sanitizeFilename(name) {
    return String(name)
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function sanitizeFilenamePart(value) {
    return String(value || "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }

  function limitFilename(name, extension) {
    const suffix = `.${extension}`;
    const sanitized = sanitizeFilename(name).replace(/^\.+|\.+$/g, "");
    const withoutExtension = sanitized.toLowerCase().endsWith(suffix.toLowerCase())
      ? sanitized.slice(0, -suffix.length)
      : sanitized.replace(/\.[^.]*$/u, "");
    return buildFilename(withoutExtension || "bilibili", extension);
  }

  function ensureFilenameExtension(filename, format) {
    const extension = extensionFromFormat(format);
    return limitFilename(String(filename || ""), extension);
  }

  function buildFilename(base, extension) {
    const suffix = `.${extension}`;
    const cleanBase = sanitizeFilenamePart(base).slice(0, Math.max(1, 180 - suffix.length)) || "bilibili";
    return `${cleanBase}${suffix}`;
  }

  async function fetchAndFormatSubtitle(options = {}) {
    const subtitleUrl = options.subtitleUrl || (options.subtitle && options.subtitle.subtitleUrl);
    const subtitleData = await fetchSubtitleJson(subtitleUrl);
    const text = formatSubtitle(subtitleData, options);
    const filename = ensureFilenameExtension(
      options.filename ||
      makeSubtitleFilename({
        ...options,
        lan: options.lan || (options.subtitle && options.subtitle.lan),
      }),
      options.format,
    );
    return {
      subtitleData,
      text,
      filename,
      mimeType: mimeTypeForFormat(options.format),
    };
  }

  function mimeTypeForFormat(format) {
    const normalized = String(format || "srt").toLowerCase();
    if (normalized === "json") return "application/json;charset=utf-8";
    if (normalized === "srt") return "application/x-subrip;charset=utf-8";
    return "text/plain;charset=utf-8";
  }

  function buildSiteResultUrl(options = {}) {
    const base = options.siteBaseUrl || DEFAULT_SITE_BASE_URL;
    const bvid = options.bvid || extractBvid(options.url) || (options.video && options.video.bvid);
    if (!bvid) {
      throw new BilibiliApiError("No BV id found for site jump", {
        code: "MISSING_BVID",
      });
    }
    const target = new URL(base);
    target.searchParams.set("bvid", bvid);
    target.searchParams.set("source", "bili-lite-subtitle");
    if (options.cid || (options.video && options.video.cid)) {
      target.searchParams.set("cid", String(options.cid || options.video.cid));
    }
    if (options.page || (options.video && options.video.page)) {
      target.searchParams.set("p", String(options.page || options.video.page));
    }
    if (options.analysisTab) {
      target.searchParams.set("analysis", String(options.analysisTab));
    }
    return target.toString();
  }

  global.BilibiliSubtitleApi = {
    API_BASE,
    DEFAULT_SITE_BASE_URL,
    BilibiliApiError,
    extractBvid,
    getUrlPage,
    fetchViewInfo,
    fetchPlayerInfo,
    getVideoSubtitles,
    fetchSubtitleJson,
    fetchAndFormatSubtitle,
    formatSubtitle,
    makeSubtitleFilename,
    buildSiteResultUrl,
    normalizeUrl,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.BilibiliSubtitleApi;
  }
})(globalThis);
