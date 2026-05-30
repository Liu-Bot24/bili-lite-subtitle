(function initBiliSubtitleI18n(global) {
  "use strict";

  const DEFAULT_LOCALE = "en";
  const ZH_LOCALE = "zh";

  const messages = {
    en: {
      "action.aiAnalysis": "AI Analysis",
      "action.copySubtitles": "Copy",
      "action.downloadSrt": "Download SRT",
      "action.downloadTxt": "Download TXT",
      "button.refresh": "Refresh",
      "button.refreshing": "Refreshing",
      "cue.jumpTitle": "Double-click to jump to {time}",
      "empty.initial": "Open a Bilibili video page to load subtitles automatically.",
      "empty.loadingSubtitle": "Loading subtitles...",
      "empty.noCues": "Select a subtitle language to show content here.",
      "empty.noMatches": "No subtitles match \"{query}\".",
      "empty.noSubtitles": "No subtitles available. Log in to Bilibili, then try Refresh.",
      "empty.notVideoPage": "This is not a Bilibili video page.",
      "error.clipboardDenied": "The browser did not allow copying",
      "error.copyFailed": "Failed to copy subtitles",
      "error.downloadFailed": "{format} download failed",
      "error.fetchContentFailed": "Failed to fetch subtitle content",
      "error.fetchListFailed": "Failed to fetch subtitle list",
      "error.fetchSubtitlesFailed": "Failed to fetch subtitles",
      "error.noPlayer": "Player not found",
      "error.runtimeNoResponse": "Extension background did not respond",
      "error.runtimeUnavailable": "Extension messaging is unavailable. Please reload the extension.",
      "error.seekFailed": "Seek failed",
      "error.storageUnavailable": "Extension storage is unavailable",
      "error.translationFailed": "Translation failed",
      "meta.noBv": "BV id not detected",
      "overlay.disable": "Turn off floating subtitles",
      "overlay.enable": "Turn on floating subtitles",
      "overlay.toggle": "Overlay",
      "panel.aria": "Bilibili subtitle list",
      "panel.collapse": "Collapse subtitle panel",
      "panel.controls": "Subtitle controls",
      "panel.expand": "Expand subtitle panel",
      "panel.resizer": "Drag to resize subtitle list",
      "panel.title": "Subtitles",
      "panel.videoPending": "Waiting for video",
      "search.aria": "Search subtitle text",
      "search.placeholder": "Search subtitles",
      "select.aria": "Subtitle language",
      "select.none": "No subtitles",
      "settings.baseUrlExample": "Example: https://api.siliconflow.cn/v1/chat/completions",
      "settings.cacheCleared": "Translation cache cleared",
      "settings.cancel": "Cancel",
      "settings.clearCache": "Clear subtitle cache",
      "settings.close": "Close settings",
      "settings.compat": "OpenAI Chat Completions compatible",
      "settings.getApiKey": "(Get API Key)",
      "settings.modelPlaceholder": "for example: deepseek-ai/DeepSeek-V3.2",
      "settings.open": "Settings",
      "settings.save": "Save",
      "settings.title": "Model Settings",
      "settings.uiLanguage": "Interface language",
      "settings.uiLanguageAuto": "Follow browser",
      "status.contentEmpty": "Subtitle content is empty",
      "status.cacheCleared": "Translation cache cleared",
      "status.detecting": "Detecting",
      "status.detectingCurrentVideo": "Detecting current video",
      "status.downloadStarted": "{format} download started",
      "status.downloading": "Downloading {format}",
      "status.fetchingList": "Fetching subtitle list",
      "status.foundSubtitleTracks": "Found {count} subtitle tracks",
      "status.loadedSubtitleLines": "Loaded {count} subtitle lines",
      "status.loadingTrack": "Loading {label}",
      "status.noBv": "Bilibili BV id not detected",
      "status.noSubtitlesFound": "No subtitles found",
      "status.refreshingList": "Refreshing subtitle list",
      "status.seeked": "Jumped to {time}",
      "status.settingsSaved": "Settings saved",
      "status.subtitlesCopied": "Copied {count} subtitle lines",
      "status.translating": "Translating to {language}",
      "status.translationDone": "Translated {count} subtitle lines",
      "status.translationLoadedFromCache": "Loaded cached translation: {count} lines",
      "status.translationLoadedPartial": "Loaded {count} lines, {failed} kept as source text",
      "status.translationNeedsConfig": "Configure the translation model first",
      "status.translationPartial": "Translated {count} lines, {failed} kept as source text",
      "status.translationProgress": "Translating to {language}: batch {current}/{total}",
      "status.translationRetry": "Retrying batch {batch}/{total} (attempt {attempt}/{maxRetries})",
      "status.translationRepairProgress": "Repairing untranslated lines: {current}/{total}",
      "status.translationRepairRetry": "Retrying untranslated line {current}/{total} (attempt {attempt}/{maxRetries})",
      "status.translationRepairStarted": "Repairing {total} untranslated subtitle lines",
      "status.translationSplitting": "Batch {batch}/{total} was unstable, splitting and retrying",
      "track.fallback": "Subtitle {number}",
      "translation.targetLanguage": "Target language",
      "translation.tools": "Translation tools",
      "translation.translateTo": "Translate to",
      "translation.translating": "Translating",
    },
    zh: {
      "action.aiAnalysis": "AI分析",
      "action.copySubtitles": "复制字幕",
      "action.downloadSrt": "下载 SRT",
      "action.downloadTxt": "下载 TXT",
      "button.refresh": "刷新",
      "button.refreshing": "刷新中",
      "cue.jumpTitle": "双击跳转到 {time}",
      "empty.initial": "打开 B 站视频页后自动读取字幕。",
      "empty.loadingSubtitle": "正在读取字幕...",
      "empty.noCues": "选择字幕语言后将在这里显示内容。",
      "empty.noMatches": "没有匹配“{query}”的字幕。",
      "empty.noSubtitles": "没有可查看的字幕。登录 B 站后可点击刷新再试。",
      "empty.notVideoPage": "当前页面不是 B 站视频页。",
      "error.clipboardDenied": "浏览器未允许复制",
      "error.copyFailed": "复制字幕失败",
      "error.downloadFailed": "{format} 下载失败",
      "error.fetchContentFailed": "字幕内容获取失败",
      "error.fetchListFailed": "字幕列表获取失败",
      "error.fetchSubtitlesFailed": "字幕获取失败",
      "error.noPlayer": "未找到播放器",
      "error.runtimeNoResponse": "扩展后台无响应",
      "error.runtimeUnavailable": "扩展通信不可用，请重新加载扩展",
      "error.seekFailed": "跳转失败",
      "error.storageUnavailable": "扩展本地存储不可用",
      "error.translationFailed": "翻译失败",
      "meta.noBv": "未检测到 BV 号",
      "overlay.disable": "关闭浮窗字幕",
      "overlay.enable": "开启浮窗字幕",
      "overlay.toggle": "浮窗",
      "panel.aria": "B站字幕列表",
      "panel.collapse": "折叠字幕面板",
      "panel.controls": "字幕控制",
      "panel.expand": "展开字幕面板",
      "panel.resizer": "拖动调整字幕列表高度",
      "panel.title": "字幕列表",
      "panel.videoPending": "等待识别视频",
      "search.aria": "搜索字幕关键词",
      "search.placeholder": "搜索字幕",
      "select.aria": "字幕语言",
      "select.none": "暂无字幕",
      "settings.baseUrlExample": "示例：https://api.siliconflow.cn/v1/chat/completions",
      "settings.cacheCleared": "字幕缓存已清理",
      "settings.cancel": "取消",
      "settings.clearCache": "清理字幕缓存",
      "settings.close": "关闭设置",
      "settings.compat": "兼容 OpenAI Chat Completions 格式",
      "settings.getApiKey": "（获取 API Key）",
      "settings.modelPlaceholder": "例如：deepseek-ai/DeepSeek-V3.2",
      "settings.open": "设置",
      "settings.save": "保存",
      "settings.title": "模型配置",
      "settings.uiLanguage": "Interface language",
      "settings.uiLanguageAuto": "跟随浏览器",
      "status.contentEmpty": "字幕内容为空",
      "status.cacheCleared": "字幕缓存已清理",
      "status.detecting": "识别中",
      "status.detectingCurrentVideo": "正在识别当前视频",
      "status.downloadStarted": "{format} 已开始下载",
      "status.downloading": "正在下载 {format}",
      "status.fetchingList": "正在获取字幕列表",
      "status.foundSubtitleTracks": "已找到 {count} 条字幕",
      "status.loadedSubtitleLines": "已载入 {count} 行字幕",
      "status.loadingTrack": "正在读取{label}",
      "status.noBv": "未检测到 B 站视频 BV 号",
      "status.noSubtitlesFound": "没有找到可用字幕",
      "status.refreshingList": "正在刷新字幕列表",
      "status.seeked": "已跳转 {time}",
      "status.settingsSaved": "设置已保存",
      "status.subtitlesCopied": "已复制 {count} 行字幕",
      "status.translating": "正在翻译为{language}",
      "status.translationDone": "已翻译 {count} 行字幕",
      "status.translationLoadedFromCache": "已读取缓存译文：{count} 行",
      "status.translationLoadedPartial": "已载入 {count} 行，{failed} 行保留原文",
      "status.translationNeedsConfig": "请先配置翻译模型",
      "status.translationPartial": "已翻译 {count} 行，{failed} 行保留原文",
      "status.translationProgress": "翻译为{language}：第 {current}/{total} 批",
      "status.translationRetry": "正在重试第 {batch}/{total} 批（第 {attempt}/{maxRetries} 次）",
      "status.translationRepairProgress": "正在补翻未完成字幕：{current}/{total}",
      "status.translationRepairRetry": "正在重试补翻第 {current}/{total} 行（第 {attempt}/{maxRetries} 次）",
      "status.translationRepairStarted": "正在补翻 {total} 行未完成字幕",
      "status.translationSplitting": "第 {batch}/{total} 批返回不稳定，正在拆分重试",
      "track.fallback": "字幕 {number}",
      "translation.targetLanguage": "目标语言",
      "translation.tools": "翻译工具",
      "translation.translateTo": "翻译为",
      "translation.translating": "翻译中",
    },
  };

  function normalizeLocale(language) {
    const value = String(language || "").trim().toLowerCase();
    return value.startsWith("zh") ? ZH_LOCALE : DEFAULT_LOCALE;
  }

  function pickLocale(languages = getNavigatorLanguages()) {
    const list = Array.isArray(languages) ? languages : [languages];
    for (const language of list) {
      if (language) {
        return normalizeLocale(language);
      }
    }
    return DEFAULT_LOCALE;
  }

  function translate(key, params = {}, locale = pickLocale()) {
    const dictionary = messages[normalizeLocale(locale)] || messages[DEFAULT_LOCALE];
    const template = dictionary[key] || messages[DEFAULT_LOCALE][key] || key;
    return formatMessage(template, params);
  }

  function formatMessage(template, params) {
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    ));
  }

  function getNavigatorLanguages() {
    const navigatorRef = global.navigator || {};
    if (Array.isArray(navigatorRef.languages) && navigatorRef.languages.length) {
      return navigatorRef.languages;
    }
    return [navigatorRef.language || DEFAULT_LOCALE];
  }

  global.BiliSubtitleI18n = {
    messages,
    normalizeLocale,
    pickLocale,
    translate,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.BiliSubtitleI18n;
  }
})(globalThis);
