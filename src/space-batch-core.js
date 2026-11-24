(function attachBiliSpaceBatchCore(global) {
  "use strict";

  const VIDEO_CARD_SELECTOR = ".list-content .list-video-item a.bili-cover-card[href]";
  const MAX_VIDEOS = 250;

  function extractBvid(href) {
    try {
      const url = new URL(href, "https://space.bilibili.com/");
      if (!["www.bilibili.com", "m.bilibili.com"].includes(url.hostname)) return "";
      const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/i);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  }

  function collectVideos(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    const seen = new Set();
    const result = [];
    for (const link of root.querySelectorAll(VIDEO_CARD_SELECTOR)) {
      const bvid = extractBvid(link.getAttribute("href"));
      if (!bvid || seen.has(bvid)) continue;
      seen.add(bvid);
      const item = link.closest(".list-video-item");
      const title = item?.querySelector(".bili-video-card__title")?.textContent?.trim()
        || link.querySelector(".bili-cover-card__thumbnail img")?.getAttribute("alt")?.trim()
        || bvid;
      result.push({ bvid, title, url: "https://www.bilibili.com/video/" + bvid });
      if (result.length >= MAX_VIDEOS) break;
    }
    return result;
  }

  function selectTracks(subtitles, preference) {
    const tracks = Array.isArray(subtitles)
      ? subtitles.filter(track => track && typeof track.subtitleUrl === "string" && track.subtitleUrl)
      : [];
    if (preference === "all") return tracks;
    const chinese = tracks.find(track => /^(?:zh|ai-zh)(?:-|$)/i.test(track.lan || ""));
    return chinese ? [chinese] : tracks.slice(0, 1);
  }

  function listPageNumbers(video, includeMultiPart) {
    if (!includeMultiPart) return [1];
    const pages = Array.isArray(video?.pages) ? video.pages : [];
    const numbers = [...new Set(pages.map(page => Number(page.page))
      .filter(page => Number.isInteger(page) && page > 0))];
    return numbers.length ? numbers.sort((a, b) => a - b) : [1];
  }

  function safeName(value) {
    return String(value || "")
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
      .replace(/\s+/g, " ").replace(/^\.+|\.+$/g, "").trim()
      .slice(0, 105) || "B站字幕";
  }

  function subtitleFilename(video, index, page, track, format) {
    const n = String(index + 1).padStart(3, "0");
    const pagePart = page > 1 ? "_P" + page : "";
    const language = track?.lan ? "_" + safeName(track.lan) : "";
    const ext = format === "srt" ? ".srt" : ".txt";
    return n + "_" + video.bvid + pagePart + "_" + safeName(video.title).slice(0, 75) + language + ext;
  }

  function mergedFilename(title) {
    return safeName(title) + "_合集字幕.txt";
  }

  function mergeText(title, entries, failures) {
    const sections = ["# " + String(title || "B站合集") + " — 字幕", ""];
    for (const entry of entries) {
      const pagePart = entry.page > 1 ? " / P" + entry.page : "";
      const language = entry.track?.lanDoc || entry.track?.lan || "字幕";
      sections.push("## " + String(entry.index + 1).padStart(2, "0") + ". "
        + entry.video.title + pagePart + " [" + language + "]");
      sections.push("来源：" + entry.video.url + (entry.page > 1 ? "?p=" + entry.page : ""));
      sections.push("");
      sections.push(String(entry.text || "").trim());
      sections.push("");
    }
    if (failures.length) {
      sections.push("## 未获取的字幕");
      for (const failure of failures) sections.push("- " + failure);
      sections.push("");
    }
    return sections.join("\n").trimEnd() + "\n";
  }

  global.BiliSpaceBatchCore = {
    VIDEO_CARD_SELECTOR, MAX_VIDEOS, extractBvid, collectVideos,
    selectTracks, listPageNumbers, safeName, subtitleFilename, mergedFilename, mergeText,
  };
})(globalThis);
