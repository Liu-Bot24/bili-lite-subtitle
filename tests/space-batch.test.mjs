import test from "node:test";
import assert from "node:assert/strict";
import "../src/space-batch-core.js";

const Core = globalThis.BiliSpaceBatchCore;

function card(href, title, alt) {
  return {
    getAttribute(name) { return name === "href" ? href : null; },
    closest() {
      return { querySelector() { return title ? { textContent: title } : null; } };
    },
    querySelector() {
      return alt ? { getAttribute() { return alt; } } : null;
    }
  };
}

test("extracts only Bilibili video BV links", () => {
  assert.equal(Core.extractBvid("//www.bilibili.com/video/BV1Ag411S78v?spm_id_from=1"), "BV1Ag411S78v");
  assert.equal(Core.extractBvid("https://evil.example/video/BV1Ag411S78v"), "");
  assert.equal(Core.extractBvid("https://www.bilibili.com/read/cv123"), "");
  assert.equal(Core.extractBvid("javascript:alert(1)"), "");
});

test("extracts cards only from the selected list and removes duplicate BV numbers", () => {
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, Core.VIDEO_CARD_SELECTOR);
      return [
        card("//www.bilibili.com/video/BV1Ag411S78v", "二极管", "alt"),
        card("//www.bilibili.com/video/BV1Ag411S78v?foo=1", "重复", "alt"),
        card("//www.bilibili.com/video/BV1Re411g7Lr", "", "三极管"),
        card("//example.org/video/BV1Ag411S78v", "其他站", "alt")
      ];
    }
  };
  assert.deepEqual(Core.collectVideos(root), [
    { bvid: "BV1Ag411S78v", title: "二极管", url: "https://www.bilibili.com/video/BV1Ag411S78v" },
    { bvid: "BV1Re411g7Lr", title: "三极管", url: "https://www.bilibili.com/video/BV1Re411g7Lr" }
  ]);
});

test("selects a Chinese subtitle when available, otherwise the first track", () => {
  const tracks = [
    { lan: "en", subtitleUrl: "https://x/en.json" },
    { lan: "zh-CN", subtitleUrl: "https://x/zh.json" },
    { lan: "bad", subtitleUrl: "" }
  ];
  assert.equal(Core.selectTracks(tracks, "auto")[0].lan, "zh-CN");
  assert.equal(Core.selectTracks(tracks, "all").length, 2);
  assert.equal(Core.selectTracks(tracks.slice(0, 1), "auto")[0].lan, "en");
  assert.deepEqual(Core.selectTracks([], "auto"), []);
});

test("enumerates multi-P pages exactly once in numerical order", () => {
  const video = { pages: [{ page: 3 }, { page: 1 }, { page: 2 }, { page: 2 }, { page: -1 }] };
  assert.deepEqual(Core.listPageNumbers(video, true), [1, 2, 3]);
  assert.deepEqual(Core.listPageNumbers(video, false), [1]);
  assert.deepEqual(Core.listPageNumbers({}, true), [1]);
});

test("filename is safe and disambiguates page/language", () => {
  const video = { bvid: "BV1Ag411S78v", title: "A/B:测试" };
  const filename = Core.subtitleFilename(video, 0, 2, { lan: "zh-CN" }, "srt");
  assert.equal(filename, "001_BV1Ag411S78v_P2_A_B_测试_zh-CN.srt");
  assert.equal(Core.mergedFilename("系列:模电"), "系列_模电_合集字幕.txt");
});

test("merges subtitle content in video order and reports missing tracks", () => {
  const video = { bvid: "BV1Ag411S78v", title: "模拟电子", url: "https://www.bilibili.com/video/BV1Ag411S78v" };
  const result = Core.mergeText("模电系列", [
    { index: 0, video, page: 1, track: { lanDoc: "中文" }, text: "[00:00] 第一节\n" },
    { index: 0, video, page: 2, track: { lanDoc: "中文" }, text: "[00:01] 第二节\n" }
  ], ["另一视频：无可用字幕"]);
  assert.ok(result.indexOf("第一节") < result.indexOf("第二节"));
  assert.match(result, /P2/);
  assert.match(result, /另一视频：无可用字幕/);
});
