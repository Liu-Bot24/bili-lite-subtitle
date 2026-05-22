(function initBiliSubtitlePageShell(global) {
  "use strict";

  const HEADER_TEXT_RE = /首页|番剧|直播|游戏中心|会员购|漫画|赛事|下载客户端|投稿/u;

  function isBilibiliVideoShellReady(documentRef = global.document) {
    if (!documentRef?.body || typeof documentRef.querySelector !== "function") {
      return false;
    }

    const videoContainer = documentRef.querySelector("#mirror-vdcon, .video-container-v1");
    const danmakuBox = documentRef.querySelector("#danmukuBox");
    if (!videoContainer || !danmakuBox) {
      return false;
    }

    return isMainHeaderReady(documentRef);
  }

  function isMainHeaderReady(documentRef) {
    const mainHeader = documentRef.querySelector("#biliMainHeader");
    if (mainHeader) {
      const text = getElementText(mainHeader);
      return Boolean(text && hasChildElements(mainHeader) && HEADER_TEXT_RE.test(text));
    }

    const header = documentRef.querySelector(".bili-header, .mini-header, .bili-header__bar, .left-entry");
    return header ? HEADER_TEXT_RE.test(getElementText(header)) : true;
  }

  function getElementText(element) {
    return String(element?.innerText || element?.textContent || "").trim();
  }

  function hasChildElements(element) {
    return Boolean(element?.children && element.children.length > 0);
  }

  global.BiliSubtitlePageShell = {
    isBilibiliVideoShellReady,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.BiliSubtitlePageShell;
  }
})(globalThis);
