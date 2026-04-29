(function attachSubtitleFormat(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BiliSubtitleFormat = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSubtitleFormatApi() {
  "use strict";

  const HTML_ENTITIES = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  const DEFAULT_MIN_DURATION_SECONDS = 0.5;

  function decodeHtmlEntities(value) {
    if (value == null) {
      return "";
    }

    return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, function decodeEntity(match, entity) {
      if (entity[0] === "#") {
        const isHex = entity[1] === "x" || entity[1] === "X";
        const rawCodePoint = entity.slice(isHex ? 2 : 1);
        const codePoint = Number.parseInt(rawCodePoint, isHex ? 16 : 10);

        if (Number.isFinite(codePoint) && codePoint >= 0) {
          try {
            return String.fromCodePoint(codePoint);
          } catch (_error) {
            return match;
          }
        }

        return match;
      }

      return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, entity) ? HTML_ENTITIES[entity] : match;
    });
  }

  function stripHtmlTags(value) {
    return String(value).replace(/<[^>]*>/g, "");
  }

  function normalizeCueText(value) {
    return stripHtmlTags(decodeHtmlEntities(value))
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(function trimLine(line) {
        return line.replace(/[ \t\f\v\u00a0]+/g, " ").trim();
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function secondsFromValue(value) {
    if (value == null || value === "") {
      return null;
    }

    const numericValue = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(numericValue)) {
      return null;
    }

    return Math.max(0, numericValue);
  }

  function extractBody(input) {
    if (Array.isArray(input)) {
      return input;
    }

    if (!input || typeof input !== "object") {
      return [];
    }

    if (Array.isArray(input.body)) {
      return input.body;
    }

    if (input.data && Array.isArray(input.data.body)) {
      return input.data.body;
    }

    if (input.result && Array.isArray(input.result.body)) {
      return input.result.body;
    }

    return [];
  }

  function normalizeSubtitleCues(input, options) {
    const settings = options || {};
    const minDurationSeconds =
      typeof settings.minDurationSeconds === "number" && Number.isFinite(settings.minDurationSeconds)
        ? Math.max(0, settings.minDurationSeconds)
        : DEFAULT_MIN_DURATION_SECONDS;

    return extractBody(input)
      .map(function normalizeCue(cue, sourceIndex) {
        if (!cue || typeof cue !== "object") {
          return null;
        }

        const from = secondsFromValue(cue.from);
        if (from == null) {
          return null;
        }

        let to = secondsFromValue(cue.to);
        if (to == null || to <= from) {
          to = from + minDurationSeconds;
        }

        const text = normalizeCueText(cue.content != null ? cue.content : cue.text);
        if (!text) {
          return null;
        }

        return {
          index: sourceIndex + 1,
          from,
          to,
          text,
        };
      })
      .filter(Boolean)
      .sort(function sortByStartTime(a, b) {
        if (a.from !== b.from) {
          return a.from - b.from;
        }

        return a.to - b.to;
      })
      .map(function reindexCue(cue, sortedIndex) {
        return {
          index: sortedIndex + 1,
          from: cue.from,
          to: cue.to,
          text: cue.text,
        };
      });
  }

  function formatSrtTimestamp(seconds) {
    const totalMilliseconds = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    const milliseconds = totalMilliseconds % 1000;
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);

    return [padNumber(h, 2), padNumber(m, 2), padNumber(s, 2)].join(":") + "," + padNumber(milliseconds, 3);
  }

  function padNumber(value, size) {
    return String(value).padStart(size, "0");
  }

  function cuesToPlainText(cues, options) {
    const settings = options || {};
    const includeTimestamps = settings.includeTimestamps === true;

    return normalizeSubtitleCues(cues)
      .map(function formatTextCue(cue) {
        if (!includeTimestamps) {
          return cue.text;
        }

        return formatPlainTimestamp(cue.from) + " " + cue.text;
      })
      .join("\n");
  }

  function formatPlainTimestamp(seconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds || 0)));
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);

    if (h > 0) {
      return [padNumber(h, 2), padNumber(m, 2), padNumber(s, 2)].join(":");
    }

    return [padNumber(m, 2), padNumber(s, 2)].join(":");
  }

  function cuesToSrt(cues, options) {
    return normalizeSubtitleCues(cues, options)
      .map(function formatSrtCue(cue, outputIndex) {
        return [
          String(outputIndex + 1),
          formatSrtTimestamp(cue.from) + " --> " + formatSrtTimestamp(cue.to),
          cue.text,
        ].join("\n");
      })
      .join("\n\n");
  }

  function subtitleJsonToPlainText(subtitleJson, options) {
    return cuesToPlainText(normalizeSubtitleCues(subtitleJson, options), options);
  }

  function subtitleJsonToSrt(subtitleJson, options) {
    return cuesToSrt(normalizeSubtitleCues(subtitleJson, options), options);
  }

  return {
    cuesToPlainText,
    cuesToSrt,
    decodeHtmlEntities,
    formatPlainTimestamp,
    formatSrtTimestamp,
    normalizeCueText,
    normalizeSubtitleCues,
    subtitleJsonToPlainText,
    subtitleJsonToSrt,
  };
});
