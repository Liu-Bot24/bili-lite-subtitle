import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../src/bilibili-page-shell.js', import.meta.url), 'utf8');
function productionFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, name);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n  }') + 4);
}
function fixture({ readyState = 'complete', existingRoot = false, ssr = false, header = 'ready' } = {}) {
  const stats = { creates: 0, inserts: 0, removes: 0 };
  const html = { parentElement: null };
  const app = { parentElement: html, ssr };
  const video = { parentElement: app, closest() { return app.ssr ? app : null; } };
  const mainHeader = header === 'missing' ? null : {
    parentElement: app, textContent: header === 'empty' ? '' : '首页 投稿', children: header === 'empty' ? [] : [{}],
  };
  const context = {
    URL, refs: {}, routeTimer: 0, placementObserver: null,
    ROUTE_POLL_MS: Number(source.match(/const ROUTE_POLL_MS = (\d+);/)[1]),
    document: { readyState, body: html, documentElement: html, querySelector(selector) {
      if (selector.startsWith('#biliMainHeader') || selector.startsWith('.bili-header')) return mainHeader;
      if (selector === '#danmukuBox') return context.target?.before;
      if (selector === '#mirror-vdcon, .video-container-v1') return video;
      return null;
    } },
    state: { loadTracksTimer: 0 },
    findDanmakuEmbedTarget: () => context.target,
    refreshVideoContext() {}, renderAll() {},
    MutationObserver: class {
      targets = [];
      constructor(callback) { this.callback = callback; }
      observe(node, options) { this.targets.push({ node, options }); }
      disconnect() { this.targets = []; }
    },
    window: {
      location: { href: 'https://www.bilibili.com/video/BV1234567890/' },
      clearTimeout() {},
      setTimeout() { assert.fail('Mounting must not schedule a fixed wait'); },
      setInterval(fn) { context.poll = fn; return 1; },
    },
  };
  function target() {
    const container = { isConnected: true, parentElement: video, insertBefore(root, before) {
      stats.inserts++;
      root.isConnected = true; root.parentElement = container; root.nextElementSibling = before;
    } };
    return { container, before: { isConnected: true, parentElement: container, closest: video.closest } };
  }
  function root() {
    return { isConnected: false, remove() { stats.removes++; this.isConnected = false; this.parentElement = null; } };
  }
  context.target = target();
  context.createPanel = () => {
    if (!context.getPanelMountTarget()) return false;
    stats.creates++; context.refs.root = root();
    context.target.container.insertBefore(context.refs.root, context.target.before);
    return true;
  };
  if (existingRoot) context.refs.root = root();
  const names = ['isBilibiliVideoShellReady', 'ensurePanelPlacement', 'mountPanelIfReady', 'startOrRefresh', 'startRouteWatcher', 'watchPanelPlacement', 'getPanelMountTarget', 'isSupportedVideoRoute', 'isPanelAtTarget'];
  vm.createContext(context);
  vm.runInContext(shellSource + '\n' + names.map(productionFunction).join('\n'), context);
  return { context, stats, target, app, mainHeader };
}
for (const header of ['missing', 'empty', 'ready']) {
  test(`page shell: ${header} header`, () => {
    const f = fixture({ header });
    assert.equal(f.context.isBilibiliVideoShellReady(), header === 'ready');
  });
}
test('SSR markup never mounts after load, including polling and direct placement', () => {
  for (const existingRoot of [false, true]) {
    const f = fixture({ ssr: true, existingRoot });
    f.context.startRouteWatcher(); f.context.startOrRefresh(); f.context.ensurePanelPlacement();
    for (let i = 0; i < 20; i++) f.context.poll();
    assert.equal(f.stats.inserts, 0);
    f.app.ssr = false; f.context.placementObserver.callback();
    assert.equal(f.stats.inserts, 1, 'Hydration notification must mount immediately');
    f.context.poll(); assert.equal(f.stats.inserts, 1);
  }
});
test('hydrated host mounts immediately without waiting for images or window.load', () => {
  for (const readyState of ['interactive', 'complete']) for (const existingRoot of [false, true]) {
    const f = fixture({ readyState, existingRoot });
    const original = f.context.refs.root;
    f.context.startOrRefresh(); assert.equal(f.stats.inserts, 1);
    if (existingRoot) assert.equal(f.context.refs.root, original);
  }
});
test('async header readiness triggers mounting; an empty header does not', () => {
  const f = fixture({ header: 'empty' }); f.context.startOrRefresh();
  assert.equal(f.stats.inserts, 0);
  assert.ok(f.context.placementObserver.targets.some(t => t.node === f.mainHeader && t.options.subtree));
  f.mainHeader.children = [{}]; f.mainHeader.textContent = '首页 投稿';
  f.context.placementObserver.callback(); assert.equal(f.stats.inserts, 1);
});
test('host replacement uses current parent and preserves panel node', () => {
  const f = fixture(); f.context.startOrRefresh();
  const original = f.context.refs.root; original.isConnected = false;
  const old = f.context.target;
  f.context.target = f.target(); f.context.target.before = old.before;
  old.before.parentElement = f.context.target.container;
  f.context.placementObserver.callback();
  assert.equal(f.stats.inserts, 2); assert.equal(f.context.refs.root, original);
  assert.equal(original.parentElement, f.context.target.container);
});
test('mounted observer watches ancestors, not panel/player descendants', () => {
  const f = fixture(); f.context.startOrRefresh();
  const targets = f.context.placementObserver.targets;
  assert.ok(targets.some(t => t.node === f.app && t.options.attributeFilter.includes('data-server-rendered')));
  assert.ok(targets.some(t => t.node === f.context.target.container));
  assert.ok(targets.every(t => !t.options.subtree));
});
test('temporary header loss leaves a mounted panel intact', () => {
  const f = fixture(); f.context.startOrRefresh();
  f.mainHeader.children = []; f.mainHeader.textContent = ''; f.context.startOrRefresh();
  assert.equal(f.stats.removes, 0); assert.equal(f.stats.inserts, 1);
});
test('SPA exit removes panel and disconnects observers; return mounts once', () => {
  const f = fixture(); f.context.startOrRefresh();
  f.context.window.location.href = 'https://www.bilibili.com/'; f.context.startOrRefresh();
  assert.equal(f.stats.removes, 1); assert.equal(f.context.placementObserver.targets.length, 0);
  f.context.window.location.href = 'https://www.bilibili.com/video/BV1234567890/?p=2';
  f.context.startOrRefresh(); f.context.startOrRefresh(); assert.equal(f.stats.inserts, 2);
});
test('direct creation also rejects SSR and disconnected anchors', () => {
  const f = fixture({ ssr: true });
  vm.runInContext(productionFunction('createPanel'), f.context);
  assert.equal(f.context.createPanel(), false);
  f.app.ssr = false; f.context.target.before.isConnected = false;
  assert.equal(f.context.createPanel(), false);
});
test('video route guard accepts video routes and rejects unrelated URLs', () => {
  const f = fixture();
  for (const route of ['/video/BV1234567890/', '/video/av123/?bvid=BV1234567890']) {
    f.context.window.location.href = `https://www.bilibili.com${route}`;
    assert.equal(f.context.isSupportedVideoRoute(), true);
  }
  for (const href of ['https://www.bilibili.com/?bvid=BV1234567890', 'https://www.bilibili.com/read/cv123', 'https://example.com/video/BV1234567890/']) {
    f.context.window.location.href = href; assert.equal(f.context.isSupportedVideoRoute(), false);
  }
});
