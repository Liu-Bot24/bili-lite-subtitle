import assert from 'node:assert/strict';
import test from 'node:test';

await import('../src/bilibili-page-shell.js');

const Shell = globalThis.BiliSubtitlePageShell;

test('waits while the Bilibili main header placeholder is still empty', () => {
  const document = makeDocument({
    '#biliMainHeader': makeElement({ id: 'biliMainHeader', text: '', childCount: 0 }),
    '#mirror-vdcon, .video-container-v1': makeElement({ text: '拿错剧本' }),
    '#danmukuBox': makeElement({ id: 'danmukuBox', text: '弹幕列表' }),
  });

  assert.equal(Shell.isBilibiliVideoShellReady(document), false);
});

test('allows mounting after the Bilibili main header has rendered navigation content', () => {
  const document = makeDocument({
    '#biliMainHeader': makeElement({
      id: 'biliMainHeader',
      text: '首页\n番剧\n直播\n游戏中心\n会员购\n投稿',
      childCount: 1,
    }),
    '#mirror-vdcon, .video-container-v1': makeElement({ text: '拿错剧本' }),
    '#danmukuBox': makeElement({ id: 'danmukuBox', text: '弹幕列表' }),
  });

  assert.equal(Shell.isBilibiliVideoShellReady(document), true);
});

function makeDocument(matches) {
  return {
    body: {},
    querySelector(selector) {
      return matches[selector] || null;
    },
  };
}

function makeElement({ id = '', text = '', childCount = 0 } = {}) {
  return {
    id,
    textContent: text,
    innerText: text,
    children: Array.from({ length: childCount }, () => ({})),
  };
}
