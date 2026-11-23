(function initBiliSpaceBatch() {
  "use strict";

  const Core = globalThis.BiliSpaceBatchCore;
  if (!Core || !globalThis.chrome?.runtime?.sendMessage) return;

  const REQUEST_GAP_MS = 700;
  const RETRY_DELAY_MS = 1700;
  let lastRequestAt = 0;
  let mountScheduled = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function message(type, payload, job) {
    if (job?.cancelled) throw new Error("用户已取消");
    const gap = Date.now() - lastRequestAt;
    if (gap < REQUEST_GAP_MS) await sleep(REQUEST_GAP_MS - gap);
    if (job?.cancelled) throw new Error("用户已取消");
    lastRequestAt = Date.now();
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, response => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response?.ok) {
          const error = new Error(response?.error?.message || response?.message || "请求失败");
          error.code = response?.error?.code || "";
          error.status = response?.error?.status || 0;
          reject(error);
          return;
        }
        resolve(response);
      });
    });
  }

  async function request(type, payload, job) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await message(type, payload, job);
      } catch (error) {
        if (job.cancelled || attempt === 1 || error.code === "NO_SUBTITLES"
            || [401, 403, 412, 429].includes(Number(error.status))
            || /(-352|-412|风控|验证码|账号未登录)/i.test(error.message)) {
          throw error;
        }
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  function titleOf(root) {
    return root.querySelector(".list-header .title .name")?.textContent?.trim()
      || "B站合集";
  }

  function attach(root) {
    if (root.querySelector(".blsb-trigger")) return;
    const header = root.querySelector(".list-header");
    const toolbar = header?.querySelector(".actions .left") || header;
    if (!toolbar) return;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "blsb-trigger";
    trigger.textContent = "批量获取字幕";
    toolbar.appendChild(trigger);

    const panel = document.createElement("section");
    panel.className = "blsb-panel";
    panel.hidden = true;
    panel.innerHTML = [
      '<div class="blsb-heading">当前合集的字幕批量下载</div>',
      '<div class="blsb-controls">',
        '<label>保存方式 <select data-role="mode">',
          '<option value="separate">逐个文件</option>',
          '<option value="merge">合并为一个 TXT</option>',
        '</select></label>',
        '<label>格式 <select data-role="format">',
          '<option value="txt">TXT</option>',
          '<option value="srt">SRT</option>',
        '</select></label>',
        '<label>字幕 <select data-role="language">',
          '<option value="auto">优先中文，否则首条</option>',
          '<option value="all">所有可用语言</option>',
        '</select></label>',
        '<label class="blsb-check"><input data-role="multipart" type="checkbox" checked> 包含多 P 视频的全部分 P</label>',
      '</div>',
      '<div class="blsb-actions">',
        '<button type="button" data-role="start">开始下载</button>',
        '<button type="button" data-role="cancel" disabled>取消</button>',
      '</div>',
      '<div class="blsb-status" data-role="status" role="status" aria-live="polite"></div>',
      '<pre class="blsb-errors" data-role="errors" hidden></pre>',
      '<p class="blsb-hint">仅处理当前页面已加载的视频卡片；没有字幕的视频会跳过。下载由扩展完成，不需要打开每个视频。</p>',
    ].join("");
    header.insertAdjacentElement("afterend", panel);

    const ref = name => panel.querySelector('[data-role="' + name + '"]');
    const mode = ref("mode");
    const format = ref("format");
    const language = ref("language");
    const multipart = ref("multipart");
    const start = ref("start");
    const cancel = ref("cancel");
    const status = ref("status");
    const errors = ref("errors");
    let job = null;

    trigger.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !job) {
        status.textContent = "已检测到 " + Core.collectVideos(root).length + " 个不同的视频。";
      }
    });
    mode.addEventListener("change", () => {
      format.disabled = mode.value === "merge";
      if (mode.value === "merge") format.value = "txt";
    });
    cancel.addEventListener("click", () => {
      if (job) {
        job.cancelled = true;
        cancel.disabled = true;
        status.textContent = "正在停止，已开始的下载不会撤销。";
      }
    });

    start.addEventListener("click", async () => {
      if (job) return;
      const videos = Core.collectVideos(root);
      if (!videos.length) {
        status.textContent = "当前列表未找到可下载的视频，请确认卡片已加载。";
        return;
      }
      job = { cancelled: false };
      const activeJob = job;
      const batchMode = mode.value;
      const outputFormat = batchMode === "merge" ? "txt" : format.value;
      const trackPreference = language.value;
      const allPages = multipart.checked;
      const collectionName = titleOf(root);
      const entries = [];
      const failures = [];
      let successful = 0;
      let processed = 0;
      let downloadId = null;

      start.disabled = true;
      cancel.disabled = false;
      for (const input of [mode, format, language, multipart]) input.disabled = true;
      errors.hidden = true;
      errors.textContent = "";

      function renderProgress(current) {
        status.textContent = "正在处理 " + (processed + 1) + "/" + videos.length
          + "：" + current + "。已获取 " + successful + " 条字幕。";
      }
      try {
        for (const [index, video] of videos.entries()) {
          if (activeJob.cancelled) break;
          renderProgress(video.title);
          let first;
          try {
            first = await request("GET_VIDEO_SUBTITLES", {
              bvid: video.bvid, page: 1
            }, activeJob);
          } catch (error) {
            if (activeJob.cancelled) break;
            failures.push(video.title + "：视频信息获取失败（" + error.message + "）");
            processed++;
            continue;
          }

          const pages = Core.listPageNumbers(first.video, allPages);
          for (const page of pages) {
            if (activeJob.cancelled) break;
            try {
              const info = page === Number(first.video?.page || 1) ? first
                : await request("GET_VIDEO_SUBTITLES", {
                  bvid: video.bvid, page
                }, activeJob);
              const tracks = Core.selectTracks(info.subtitles, trackPreference);
              if (!tracks.length) {
                failures.push(video.title + (page > 1 ? " P" + page : "") + "：无可用字幕");
                continue;
              }
              for (const track of tracks) {
                if (activeJob.cancelled) break;
                const filename = Core.subtitleFilename(video, index, page, track, outputFormat);
                const result = await request("DOWNLOAD_SUBTITLE", {
                  bvid: video.bvid,
                  page,
                  video: info.video,
                  subtitle: track,
                  subtitleUrl: track.subtitleUrl,
                  title: video.title,
                  ownerName: info.video?.owner?.name || "",
                  lan: track.lan,
                  format: outputFormat,
                  filename,
                  triggerDownload: batchMode === "separate"
                }, activeJob);
                if (batchMode === "merge") {
                  entries.push({ index, video, page, track, text: result.text });
                }
                successful++;
                renderProgress(video.title);
              }
            } catch (error) {
              if (activeJob.cancelled) break;
              failures.push(video.title + (page > 1 ? " P" + page : "")
                + "：获取失败（" + error.message + "）");
            }
          }
          processed++;
        }

        if (batchMode === "merge" && entries.length && !activeJob.cancelled) {
          status.textContent = "正在合并并保存 " + entries.length + " 条字幕……";
          const saved = await request("SAVE_BATCH_TEXT", {
            filename: Core.mergedFilename(collectionName),
            text: Core.mergeText(collectionName, entries, failures)
          }, activeJob);
          downloadId = saved.downloadId;
        }

        if (activeJob.cancelled) {
          status.textContent = "已取消。处理 " + processed + "/" + videos.length
            + " 个视频，已获取 " + successful + " 条字幕。";
        } else {
          status.textContent = "完成：处理 " + processed + "/" + videos.length
            + " 个视频，成功 " + successful + " 条字幕，跳过或失败 "
            + failures.length + " 项。"
            + (batchMode === "merge" && downloadId !== null ? " 已保存合并 TXT。" : "");
        }
      } catch (error) {
        status.textContent = "批量任务中断：" + error.message + "。此前成功 " + successful + " 条。";
      } finally {
        if (failures.length) {
          errors.hidden = false;
          errors.textContent = failures.slice(0, 40).join("\n")
            + (failures.length > 40 ? "\n……其余 " + (failures.length - 40) + " 项未显示" : "");
        }
        job = null;
        start.disabled = false;
        cancel.disabled = true;
        mode.disabled = false;
        language.disabled = false;
        multipart.disabled = false;
        format.disabled = mode.value === "merge";
      }
    });
  }

  function mount() {
    mountScheduled = false;
    document.querySelectorAll(".space-list-details").forEach(attach);
  }

  function scheduleMount() {
    if (mountScheduled) return;
    mountScheduled = true;
    setTimeout(mount, 200);
  }

  if (document.documentElement) {
    new MutationObserver(scheduleMount).observe(document.documentElement, {
      childList: true, subtree: true
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
