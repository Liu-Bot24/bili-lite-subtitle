(() => {
  "use strict";

  const CONFIG_KEY = "bdsp.llmConfig.v1";
  const LOCALE_KEY = "bdsp.uiLocale.v1";
  const form = document.getElementById("settings-form");
  const fields = document.getElementById("settings-fields");
  const baseUrl = document.getElementById("base-url");
  const model = document.getElementById("model");
  const apiKey = document.getElementById("api-key");
  const uiLocale = document.getElementById("ui-locale");
  const status = document.getElementById("status");
  const I18n = globalThis.BiliSubtitleI18n;

  function locale() {
    return ["zh", "en"].includes(uiLocale.value) ? uiLocale.value : I18n.pickLocale();
  }

  function t(key) {
    return I18n.translate(key, {}, locale());
  }

  function localize() {
    document.documentElement.lang = locale();
    document.title = `Bili Lite Subtitle — ${t("settings.title")}`;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    model.placeholder = t("settings.modelPlaceholder");
    document.getElementById("api-key-link").href = locale() === "zh"
      ? "https://cloud.siliconflow.cn/i/My0p5Jgs"
      : "https://openrouter.ai/keys";
  }

  function showStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  async function load() {
    localize();
    try {
      const stored = await chrome.storage.local.get([CONFIG_KEY, LOCALE_KEY]);
      const config = stored[CONFIG_KEY] || {};
      baseUrl.value = String(config.baseUrl || "");
      model.value = String(config.model || "");
      apiKey.value = String(config.apiKey || "");
      uiLocale.value = ["zh", "en"].includes(stored[LOCALE_KEY]) ? stored[LOCALE_KEY] : "auto";
      localize();
      fields.disabled = false;
    } catch {
      showStatus(t("error.storageUnavailable"), true);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (fields.disabled) return;
    const values = {
      [CONFIG_KEY]: { baseUrl: baseUrl.value.trim(), model: model.value.trim(), apiKey: apiKey.value.trim() },
      [LOCALE_KEY]: uiLocale.value,
    };
    fields.disabled = true;
    try {
      await chrome.storage.local.set(values);
      showStatus(t("status.settingsSaved"));
    } catch {
      showStatus(t("error.storageUnavailable"), true);
    } finally {
      fields.disabled = false;
    }
  });

  document.getElementById("clear-cache").addEventListener("click", async () => {
    fields.disabled = true;
    try {
      await globalThis.BiliSubtitleTranslationCache.clearTranslationCache();
      showStatus(t("settings.cacheCleared"));
    } catch {
      showStatus(t("error.storageUnavailable"), true);
    } finally {
      fields.disabled = false;
    }
  });
  uiLocale.addEventListener("change", () => { localize(); showStatus(""); });
  window.addEventListener("languagechange", localize);
  load();
})();
