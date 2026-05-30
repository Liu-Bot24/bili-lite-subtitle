(function initBiliSubtitleTranslationCore(global) {
  "use strict";

  const DEFAULT_TARGET_LANGUAGE = "en";
  const DEFAULT_BATCH_SIZE = 40;
  const DEFAULT_BATCH_WORKERS = 16;
  const DEFAULT_MAX_RETRIES = 2;
  const DEFAULT_MAX_SPLIT_DEPTH = 4;
  const TRANSLATION_FAILURES = Symbol("biliSubtitleTranslationFailures");

  const TARGET_LANGUAGES = Object.freeze([
    { code: "en", zh: "英语", en: "English", native: "English" },
    { code: "zh-CN", zh: "简体中文", en: "Simplified Chinese", native: "简体中文" },
    { code: "zh-TW", zh: "繁体中文", en: "Traditional Chinese", native: "繁體中文" },
    { code: "ja", zh: "日语", en: "Japanese", native: "日本語" },
    { code: "ko", zh: "韩语", en: "Korean", native: "한국어" },
    { code: "vi", zh: "越南语", en: "Vietnamese", native: "Tiếng Việt" },
    { code: "id", zh: "印尼语", en: "Indonesian", native: "Bahasa Indonesia" },
    { code: "ms", zh: "马来语", en: "Malay", native: "Bahasa Melayu" },
    { code: "th", zh: "泰语", en: "Thai", native: "ไทย" },
    { code: "hi", zh: "印地语", en: "Hindi", native: "हिन्दी" },
  ]);

  function getTargetLanguages(uiLocale = "zh") {
    const locale = String(uiLocale || "").startsWith("zh") ? "zh" : "en";
    return TARGET_LANGUAGES.map((language) => ({
      code: language.code,
      label: locale === "zh" ? language.zh : language.en,
      nativeLabel: language.native,
    }));
  }

  function normalizeTargetLanguage(value) {
    const text = String(value || "").trim();
    if (!text) {
      return DEFAULT_TARGET_LANGUAGE;
    }
    const lower = text.toLowerCase().replace("_", "-");
    const match = TARGET_LANGUAGES.find((language) => language.code.toLowerCase() === lower);
    if (match) {
      return match.code;
    }
    if (lower.startsWith("zh-hant") || lower === "zh-tw" || lower === "zh-hk") {
      return "zh-TW";
    }
    if (lower.startsWith("zh")) {
      return "zh-CN";
    }
    return TARGET_LANGUAGES.find((language) => language.code.toLowerCase().split("-")[0] === lower.split("-")[0])?.code ||
      DEFAULT_TARGET_LANGUAGE;
  }

  function targetLanguageName(code, uiLocale = "zh") {
    const target = normalizeTargetLanguage(code);
    const language = TARGET_LANGUAGES.find((item) => item.code === target) || TARGET_LANGUAGES[0];
    return String(uiLocale || "").startsWith("zh") ? language.zh : language.en;
  }

  function targetLanguageNativeName(code) {
    const target = normalizeTargetLanguage(code);
    return TARGET_LANGUAGES.find((item) => item.code === target)?.native || target;
  }

  function normalizeChatCompletionsUrl(value) {
    const text = String(value || "").trim().replace(/\/+$/g, "");
    if (!text) {
      return "";
    }
    if (/\/chat\/completions$/i.test(text)) {
      return text;
    }
    return `${text}/chat/completions`;
  }

  function normalizeLlmConfig(config = {}) {
    return {
      baseUrl: normalizeChatCompletionsUrl(config.baseUrl),
      model: String(config.model || "").trim(),
      apiKey: String(config.apiKey || "").trim(),
    };
  }

  function validateLlmConfig(config = {}) {
    const normalized = normalizeLlmConfig(config);
    if (!normalized.baseUrl || !normalized.model || !normalized.apiKey) {
      throw new Error("LLM configuration is incomplete.");
    }
    try {
      const url = new URL(normalized.baseUrl);
      if (!/^https?:$/i.test(url.protocol)) {
        throw new Error("Invalid Base URL.");
      }
    } catch {
      throw new Error("Invalid Base URL.");
    }
    return normalized;
  }

  function buildTranslationMessages(cues, targetLanguage, metadata = {}) {
    const targetCode = normalizeTargetLanguage(targetLanguage);
    const targetName = targetLanguageNativeName(targetCode);
    const segments = normalizeSourceCues(cues).map((cue, index) => ({
      i: index,
      start: roundTime(cue.from),
      end: roundTime(cue.to),
      text: cue.content,
    }));
    return [
      {
        role: "system",
        content: [
          `You are a professional subtitle translator. Translate every subtitle line into natural ${targetName}.`,
          "Return only valid JSON. Do not use Markdown. Do not add explanations.",
          "The response must be exactly shaped like {\"items\":[{\"i\":0,\"text\":\"translated subtitle\"}]}.",
          "The number of items must match the input segments. Keep each i value and order unchanged.",
          "Do not merge, split, omit, summarize, or leave source-language text unless it is a name, brand, URL, code token, or proper noun.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          targetLanguage: {
            code: targetCode,
            name: targetName,
          },
          context: {
            title: metadata.title || "",
            bvid: metadata.bvid || "",
            pageUrl: metadata.pageUrl || "",
          },
          segments,
        }),
      },
    ];
  }

  async function translateCuesWithRetry(cues, options = {}) {
    const sourceCues = normalizeSourceCues(cues);
    if (!sourceCues.length) {
      return attachTranslationFailures([], []);
    }
    if (typeof options.requestItems !== "function") {
      throw new Error("Translation request function is required.");
    }

    const batches = splitArray(sourceCues, normalizePositiveInteger(options.batchSize, DEFAULT_BATCH_SIZE));
    const progress = createProgressEmitter(options.onProgress);
    const translated = [];
    const failures = [];
    const batchResults = new Array(batches.length);
    const batchWorkers = normalizeWorkerCount(options.batchWorkers, DEFAULT_BATCH_WORKERS, batches.length);
    let nextBatchIndex = 0;
    let doneBatches = 0;
    await progress({ stage: "started", done: 0, total: batches.length });
    async function worker() {
      while (nextBatchIndex < batches.length) {
        const batchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        await translateBatchAtIndex(batchIndex);
      }
    }
    async function translateBatchAtIndex(batchIndex) {
      const batch = batches[batchIndex];
      await progress({
        stage: "batch-start",
        batchIndex: batchIndex + 1,
        batchTotal: batches.length,
        done: doneBatches,
        total: batches.length,
        segmentCount: batch.length,
      });
      const result = await translateBatchWithFallback(batch, {
        ...options,
        maxRetries: normalizePositiveInteger(options.maxRetries, DEFAULT_MAX_RETRIES),
        maxSplitDepth: normalizePositiveInteger(options.maxSplitDepth, DEFAULT_MAX_SPLIT_DEPTH),
        depth: 0,
        batchIndex: batchIndex + 1,
        batchTotal: batches.length,
        onProgress: progress,
      });
      batchResults[batchIndex] = result;
      await progress({
        stage: "batch-result",
        batchIndex: batchIndex + 1,
        batchTotal: batches.length,
        done: doneBatches,
        total: batches.length,
        cues: progressCues(result.cues, result.failures),
        failures: result.failures,
      });
      doneBatches += 1;
      await progress({
        stage: "batch-done",
        batchIndex: batchIndex + 1,
        batchTotal: batches.length,
        done: doneBatches,
        total: batches.length,
        failures: failures.length,
      });
    }
    await Promise.all(Array.from({ length: batchWorkers }, () => worker()));
    for (const result of batchResults) {
      translated.push(...(result?.cues || []));
      failures.push(...(result?.failures || []));
    }
    const remainingFailures = await repairFailedCues(sourceCues, translated, failures, options, progress);
    translated.sort((left, right) => left.__sourceIndex - right.__sourceIndex);
    const cleaned = translated.map(stripInternalCueFields);
    await progress({ stage: "done", done: batches.length, total: batches.length });
    return attachTranslationFailures(cleaned, remainingFailures.sort((left, right) => left.index - right.index));
  }

  async function translateBatchWithFallback(batch, options) {
    let lastError = null;
    for (let attempt = 0; attempt < options.maxRetries; attempt += 1) {
      try {
        const items = await options.requestItems(batch.map(stripInternalCueFields), {
          targetLanguage: normalizeTargetLanguage(options.targetLanguage),
          metadata: options.metadata || {},
          attempt: attempt + 1,
          depth: options.depth,
        });
        return {
          cues: alignTranslatedCues(batch, items),
          failures: [],
        };
      } catch (error) {
        lastError = error;
        if (attempt < options.maxRetries - 1) {
          await options.onProgress?.({
            stage: "batch-retry",
            batchIndex: options.batchIndex,
            batchTotal: options.batchTotal,
            attempt: attempt + 2,
            maxRetries: options.maxRetries,
            error: errorMessage(error),
          });
        }
      }
    }

    if (batch.length > 1 && options.depth < options.maxSplitDepth) {
      await options.onProgress?.({
        stage: "batch-splitting",
        batchIndex: options.batchIndex,
        batchTotal: options.batchTotal,
        depth: options.depth + 1,
        segmentCount: batch.length,
        error: errorMessage(lastError),
      });
      const midpoint = Math.ceil(batch.length / 2);
      const left = await translateBatchWithFallback(batch.slice(0, midpoint), {
        ...options,
        depth: options.depth + 1,
      });
      const right = await translateBatchWithFallback(batch.slice(midpoint), {
        ...options,
        depth: options.depth + 1,
      });
      return {
        cues: [...left.cues, ...right.cues],
        failures: [...left.failures, ...right.failures],
      };
    }

    return {
      cues: batch.map((cue) => ({ ...cue })),
      failures: batch.map((cue) => ({
        index: cue.__sourceIndex,
        sourceText: cue.content,
        error: errorMessage(lastError),
      })),
    };
  }

  function alignTranslatedCues(sourceCues, items) {
    const itemList = parseTranslationItems(items);
    const byIndex = new Map();
    itemList.forEach((item, position) => {
      const hasIndex = Object.prototype.hasOwnProperty.call(item || {}, "i") && item.i !== "";
      const index = hasIndex ? Number(item.i) : position;
      if (!Number.isInteger(index) || index < 0 || index >= sourceCues.length || byIndex.has(index)) {
        throw new Error("Translation response indexes do not match the source subtitles.");
      }
      const text = cleanTranslatedText(item.text ?? item.translation ?? item.translated);
      if (!text) {
        throw new Error("Translation response contains an empty subtitle.");
      }
      byIndex.set(index, text);
    });
    if (byIndex.size !== sourceCues.length) {
      throw new Error("Translation response is missing subtitle items.");
    }
    return sourceCues.map((cue, index) => ({
      ...cue,
      content: byIndex.get(index),
    }));
  }

  function parseTranslationItems(value) {
    if (Array.isArray(value)) {
      return value;
    }
    const payload = typeof value === "string" ? parseModelJson(value) : value;
    if (Array.isArray(payload?.items)) {
      return payload.items;
    }
    if (Array.isArray(payload?.translated_transcript)) {
      return payload.translated_transcript;
    }
    return [];
  }

  function parseModelJson(content) {
    const text = String(content || "").trim().replace(/^```(?:json)?|```$/g, "").trim();
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error("Translation model did not return valid JSON.");
      }
      return JSON.parse(match[0]);
    }
  }

  function normalizeSourceCues(cues) {
    return (Array.isArray(cues) ? cues : [])
      .map((cue, index) => ({
        __sourceIndex: index,
        from: normalizeCueTime(cue.from ?? cue.start),
        to: normalizeCueTime(cue.to ?? cue.end),
        content: String(cue.content ?? cue.text ?? "").trim(),
      }))
      .filter((cue) => cue.content);
  }

  function stripInternalCueFields(cue) {
    return {
      from: cue.from,
      to: cue.to,
      content: cue.content,
    };
  }

  function attachTranslationFailures(cues, failures) {
    Object.defineProperty(cues, TRANSLATION_FAILURES, {
      value: Array.isArray(failures) ? failures : [],
      enumerable: false,
      configurable: true,
    });
    return cues;
  }

  function translationFailures(cues) {
    return Array.isArray(cues?.[TRANSLATION_FAILURES]) ? cues[TRANSLATION_FAILURES] : [];
  }

  async function repairFailedCues(sourceCues, translated, failures, options, progress) {
    const failedIndexes = [...new Set((Array.isArray(failures) ? failures : [])
      .map((failure) => Number(failure.index))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < sourceCues.length))]
      .sort((left, right) => left - right);
    if (!failedIndexes.length) {
      return [];
    }

    await progress({ stage: "repair-start", total: failedIndexes.length });
    const remainingFailures = [];
    const maxRetries = normalizePositiveInteger(options.maxRetries, DEFAULT_MAX_RETRIES);
    for (const [position, sourceIndex] of failedIndexes.entries()) {
      const sourceCue = sourceCues[sourceIndex];
      let repairedCue = null;
      let lastError = null;
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        try {
          const items = await options.requestItems([stripInternalCueFields(sourceCue)], {
            targetLanguage: normalizeTargetLanguage(options.targetLanguage),
            metadata: options.metadata || {},
            attempt: attempt + 1,
            depth: "repair",
            repair: true,
          });
          repairedCue = alignTranslatedCues([sourceCue], items)[0] || null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries - 1) {
            await progress({
              stage: "repair-retry",
              current: position + 1,
              total: failedIndexes.length,
              attempt: attempt + 2,
              maxRetries,
              index: sourceIndex,
              error: errorMessage(error),
            });
          }
        }
      }

      if (repairedCue) {
        replaceTranslatedCue(translated, repairedCue);
        await progress({
          stage: "repair-result",
          current: position + 1,
          total: failedIndexes.length,
          cues: [progressCue(repairedCue)],
        });
      } else {
        remainingFailures.push({
          index: sourceIndex,
          sourceText: sourceCue.content,
          error: errorMessage(lastError),
        });
      }
    }
    return remainingFailures;
  }

  function replaceTranslatedCue(translated, cue) {
    const index = translated.findIndex((item) => item.__sourceIndex === cue.__sourceIndex);
    if (index >= 0) {
      translated[index] = cue;
      return;
    }
    translated.push(cue);
  }

  function progressCues(cues, failures = []) {
    const failedIndexes = new Set((Array.isArray(failures) ? failures : []).map((failure) => failure.index));
    return (Array.isArray(cues) ? cues : [])
      .filter((cue) => !failedIndexes.has(cue.__sourceIndex))
      .map(progressCue);
  }

  function progressCue(cue) {
    return {
      index: cue.__sourceIndex,
      from: cue.from,
      to: cue.to,
      content: cue.content,
    };
  }

  function cleanTranslatedText(value) {
    return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  function normalizeCueTime(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function normalizeWorkerCount(value, fallback, itemCount) {
    const requested = normalizePositiveInteger(value, fallback);
    return Math.max(1, Math.min(requested, Math.max(1, Number(itemCount) || 1)));
  }

  function splitArray(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  function createProgressEmitter(onProgress) {
    if (typeof onProgress !== "function") {
      return async () => {};
    }
    return async (event) => {
      try {
        await onProgress({ ...event });
      } catch {
        // Progress reporting must never break the translation itself.
      }
    };
  }

  function roundTime(value) {
    return Math.round((Number(value) || 0) * 1000) / 1000;
  }

  function errorMessage(error) {
    return String(error?.message || error || "translation failed");
  }

  global.BiliSubtitleTranslationCore = {
    TARGET_LANGUAGES,
    getTargetLanguages,
    normalizeTargetLanguage,
    targetLanguageName,
    targetLanguageNativeName,
    normalizeChatCompletionsUrl,
    normalizeLlmConfig,
    validateLlmConfig,
    buildTranslationMessages,
    translateCuesWithRetry,
    alignTranslatedCues,
    parseTranslationItems,
    parseModelJson,
    translationFailures,
  };
})(globalThis);
