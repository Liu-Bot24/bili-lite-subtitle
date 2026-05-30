(function initBiliSubtitleTranslationCache(global) {
  "use strict";

  const CACHE_STORAGE_KEY = "bdsp.translationCache.v1";
  const CACHE_MAX_ENTRIES = 20;
  const CACHE_MAX_AGE_DAYS = 7;
  const CACHE_MAX_BYTES = 3 * 1024 * 1024;

  async function getCachedTranslation(id) {
    if (!id) {
      return null;
    }
    const store = await readCacheStore();
    const entry = store.entries.find((item) => item.id === id) || null;
    if (entry) {
      entry.accessedAt = new Date().toISOString();
      await writeCacheStore(pruneTranslationCacheEntries(store.entries, { protectedId: id }).kept);
    }
    return entry;
  }

  async function getCachedTranslationsForSource(parts = {}) {
    const store = await readCacheStore();
    const matched = store.entries
      .filter((entry) => matchesSource(entry, parts))
      .sort((left, right) => entryTime(right) - entryTime(left));
    if (!matched.length) {
      return [];
    }

    const now = new Date().toISOString();
    const matchedIds = new Set(matched.map((entry) => entry.id));
    const touched = store.entries.map((entry) => (
      matchedIds.has(entry.id) ? { ...entry, accessedAt: now } : entry
    ));
    await writeCacheStore(pruneTranslationCacheEntries(touched).kept);
    return matched.map((entry) => ({ ...entry, accessedAt: now }));
  }

  async function putCachedTranslation(entry) {
    if (!entry?.id) {
      return null;
    }
    const now = new Date().toISOString();
    const normalized = {
      ...entry,
      createdAt: entry.createdAt || now,
      updatedAt: now,
      accessedAt: now,
      approxBytes: entry.approxBytes || estimateEntryBytes(entry),
    };
    const store = await readCacheStore();
    const next = [normalized, ...store.entries.filter((item) => item.id !== normalized.id)];
    const pruned = pruneTranslationCacheEntries(next, { protectedId: normalized.id });
    await writeCacheStore(pruned.kept);
    return normalized;
  }

  async function pruneStoredTranslationCache(options = {}) {
    const store = await readCacheStore();
    const pruned = pruneTranslationCacheEntries(store.entries, options);
    if (pruned.deletedIds.length) {
      await writeCacheStore(pruned.kept);
    }
    return pruned.deletedIds.length;
  }

  async function clearTranslationCache() {
    await writeCacheStore([]);
  }

  async function createTranslationCacheKey(parts = {}) {
    const text = [
      parts.bvid || "",
      parts.cid || "",
      parts.page || "",
      parts.sourceTrackId || "",
      parts.targetLanguage || "",
      parts.sourceHash || "",
    ].join("\n");
    return `translation:${await sha256Text(text)}`;
  }

  async function hashCues(cues) {
    const text = (Array.isArray(cues) ? cues : [])
      .map((cue) => [
        roundTime(cue.from ?? cue.start),
        roundTime(cue.to ?? cue.end),
        String(cue.content ?? cue.text ?? "").trim(),
      ].join("|"))
      .join("\n");
    return sha256Text(text);
  }

  function pruneTranslationCacheEntries(entries, options = {}) {
    const now = Number(options.now) || Date.now();
    const maxAgeDays = positiveNumber(options.maxAgeDays, CACHE_MAX_AGE_DAYS);
    const maxEntries = positiveNumber(options.maxEntries, CACHE_MAX_ENTRIES);
    const maxBytes = positiveNumber(options.maxBytes, CACHE_MAX_BYTES);
    const protectedId = String(options.protectedId || "");
    const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
    const sorted = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry?.id)
      .map((entry) => ({
        ...entry,
        approxBytes: estimateEntryBytes(entry),
      }))
      .sort((left, right) => entryTime(right) - entryTime(left));
    const deletedIds = new Set();

    for (const entry of sorted) {
      if (entry.id !== protectedId && entryTime(entry) && entryTime(entry) < cutoff) {
        deletedIds.add(entry.id);
      }
    }

    const keptAfterAge = sorted.filter((entry) => !deletedIds.has(entry.id));
    for (const entry of keptAfterAge.slice(maxEntries)) {
      if (entry.id !== protectedId) {
        deletedIds.add(entry.id);
      }
    }

    let kept = sorted.filter((entry) => !deletedIds.has(entry.id));
    let totalBytes = kept.reduce((sum, entry) => sum + entry.approxBytes, 0);
    for (const entry of [...kept].reverse()) {
      if (totalBytes <= maxBytes) {
        break;
      }
      if (entry.id === protectedId) {
        continue;
      }
      deletedIds.add(entry.id);
      totalBytes -= entry.approxBytes;
    }

    kept = sorted.filter((entry) => !deletedIds.has(entry.id));
    return {
      kept,
      deletedIds: [...deletedIds],
    };
  }

  async function readCacheStore() {
    const payload = await chromeStorageGet(CACHE_STORAGE_KEY);
    const store = payload?.[CACHE_STORAGE_KEY];
    return {
      entries: Array.isArray(store?.entries) ? store.entries : [],
    };
  }

  async function writeCacheStore(entries) {
    await chromeStorageSet({
      [CACHE_STORAGE_KEY]: {
        version: 1,
        entries: Array.isArray(entries) ? entries : [],
      },
    });
  }

  function chromeStorageGet(key) {
    return new Promise((resolve) => {
      const storage = global.chrome?.storage?.local;
      if (!storage?.get) {
        resolve({});
        return;
      }
      storage.get(key, (result) => resolve(result || {}));
    });
  }

  function chromeStorageSet(value) {
    return new Promise((resolve, reject) => {
      const storage = global.chrome?.storage?.local;
      if (!storage?.set) {
        resolve();
        return;
      }
      storage.set(value, () => {
        const error = global.chrome?.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || "Unable to write translation cache."));
          return;
        }
        resolve();
      });
    });
  }

  async function sha256Text(text) {
    const cryptoRef = global.crypto;
    if (cryptoRef?.subtle && global.TextEncoder) {
      const bytes = new TextEncoder().encode(String(text || ""));
      const digest = await cryptoRef.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return fallbackHash(text);
  }

  function fallbackHash(text) {
    let hash = 2166136261;
    const value = String(text || "");
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function entryTime(entry) {
    return Date.parse(entry?.accessedAt || entry?.updatedAt || entry?.createdAt || "") || 0;
  }

  function matchesSource(entry, parts) {
    if (!entry?.id || !Array.isArray(entry.cues) || !entry.cues.length) {
      return false;
    }
    return (
      stringKey(entry.bvid) === stringKey(parts.bvid) &&
      stringKey(entry.cid) === stringKey(parts.cid) &&
      stringKey(entry.page) === stringKey(parts.page) &&
      stringKey(entry.sourceTrackId) === stringKey(parts.sourceTrackId) &&
      stringKey(entry.sourceHash) === stringKey(parts.sourceHash) &&
      (!parts.targetLanguage || stringKey(entry.targetLanguage) === stringKey(parts.targetLanguage))
    );
  }

  function stringKey(value) {
    return String(value ?? "");
  }

  function estimateEntryBytes(entry) {
    const explicit = Number(entry?.approxBytes);
    if (Number.isFinite(explicit) && explicit > 0) {
      return explicit;
    }
    try {
      return JSON.stringify(entry || {}).length;
    } catch {
      return 0;
    }
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function roundTime(value) {
    return Math.round((Number(value) || 0) * 1000) / 1000;
  }

  global.BiliSubtitleTranslationCache = {
    CACHE_STORAGE_KEY,
    CACHE_MAX_ENTRIES,
    CACHE_MAX_AGE_DAYS,
    CACHE_MAX_BYTES,
    getCachedTranslation,
    getCachedTranslationsForSource,
    putCachedTranslation,
    pruneStoredTranslationCache,
    clearTranslationCache,
    createTranslationCacheKey,
    hashCues,
    pruneTranslationCacheEntries,
  };
})(globalThis);
