// Run with Playwright available (npm install --no-save playwright), then:
// node tests/browser-smoke.mjs [extension-directory]
// Uses an isolated profile, synthetic credentials, and mocked subtitle APIs.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const extension = path.resolve(process.argv[2] || '.');
mkdirSync('work', { recursive: true });
const profile = mkdtempSync(path.resolve('work/browser-smoke-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  ...(process.env.BDSP_CHROMIUM ? { executablePath: process.env.BDSP_CHROMIUM } : {}),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1500, height: 1000 },
});
const checks = [];
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const panel = '#bili-subtitle-lite-panel';
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(async () => {
    for (let attempt = 0; !globalThis.BilibiliSubtitleApi && attempt < 100; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const cue = { from: 0, to: 5, content: 'Synthetic subtitle for regression testing' };
    const video = { bvid: 'BV1234567890', cid: 42, page: 1, title: 'Fixture video' };
    globalThis.BilibiliSubtitleApi.getVideoSubtitles = async () => ({
      video, body: [cue], subtitles: [{ id: 'test-track', lan: 'en', lan_doc: 'English', subtitleUrl: 'https://example.test/subtitles.json' }],
    });
    globalThis.BilibiliSubtitleApi.fetchViewInfo = async () => video;
    globalThis.BilibiliSubtitleApi.fetchAndFormatSubtitle = async () => ({ subtitleData: { body: [cue] }, text: cue.content });
    await chrome.storage.local.set({
      'bdsp.llmConfig.v1': { baseUrl: 'https://example.test/v1', model: 'test-model', apiKey: 'synthetic-test-key' },
      'bdsp.panelCollapsed.v1': false,
      'bdsp.uiLocale.v1': 'en',
    });
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture video</title><style>
    body{margin:0;font-family:Arial}#biliMainHeader{height:64px;background:#eee;padding:0 24px;display:flex;align-items:center}
    #mirror-vdcon{margin:30px 24px;display:flex;gap:24px}#player{width:940px;height:500px;background:#222}
    #right{width:350px}#danmukuBox{width:350px;min-height:180px;background:#eee}input{padding:8px}
    </style></head><body><div id="app" data-server-rendered="true"><header id="biliMainHeader"><nav>首页 番剧 投稿</nav></header>
    <div id="mirror-vdcon"><div><h1 class="video-title">Fixture video</h1><div id="player"><video></video></div>
    <input id="native-danmaku" placeholder="Danmaku"><textarea id="native-comment"></textarea></div>
    <aside id="right"><div id="danmukuBox"><h2>弹幕列表</h2></div></aside></div></div><img src="/slow-fixture.png"></body></html>`;
  let releaseImage;
  const imageGate = new Promise(resolve => { releaseImage = resolve; });
  await context.route('https://www.bilibili.com/**', async route => {
    if (route.request().url().includes('slow-fixture')) {
      await imageGate;
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    } else await route.fulfill({ contentType: 'text/html', body: html });
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.mountTiming = {};
    addEventListener('load', () => { window.mountTiming.loaded = performance.now(); }, { once: true });
    const observer = new MutationObserver(() => {
      if (document.getElementById('bili-subtitle-lite-panel')) {
        window.mountTiming.firstMount = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto('https://www.bilibili.com/video/BV1234567890/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4400);
  assert.equal(await page.locator(panel).count(), 0);
  checks.push('no insertion into SSR markup, even after 4.4 seconds');
  await page.evaluate(() => {
    window.mountTiming.ready = performance.now();
    document.querySelector('#app').removeAttribute('data-server-rendered');
  });
  await page.locator(`${panel} .bdsp-cue`).first().waitFor({ timeout: 6000 });
  assert.equal(await page.evaluate(() => document.readyState), 'interactive', 'Ready host does not wait for unrelated images');
  assert.ok(await page.evaluate(() => window.mountTiming.firstMount - window.mountTiming.ready < 200), 'No fixed 200ms mount delay');
  releaseImage();
  await page.waitForLoadState('load');
  assert.equal(await page.locator(`${panel} input[type="password"]`).count(), 0);
  assert.equal(await page.locator(`${panel} [data-role="cue-search"]`).getAttribute('autocomplete'), 'off');
  checks.push('full content script loads subtitles without password fields');
  await page.locator('#native-danmaku').fill('Human danmaku draft');
  await page.locator('#native-comment').fill('Human comment draft');
  await page.locator(`${panel} [data-role="cue-search"]`).fill('Synthetic');
  const settingsPromise = context.waitForEvent('page');
  await page.locator(`${panel} [data-action="settings"]`).click();
  const options = await settingsPromise;
  await options.waitForLoadState();
  assert.equal(options.url(), `chrome-extension://${extensionId}/options.html`);
  await options.locator('#api-key').waitFor();
  assert.equal(await options.locator('#api-key').inputValue(), 'synthetic-test-key');
  await options.locator('#model').fill('updated-test-model');
  await options.locator('#ui-locale').selectOption('zh');
  await options.locator('button[type="submit"]').click();
  await options.locator('#status').filter({ hasText: '已保存' }).waitFor();
  await options.reload();
  await options.locator('#settings-fields:not([disabled])').waitFor();
  assert.equal(await options.locator('#model').inputValue(), 'updated-test-model');
  assert.equal(await options.locator('#api-key').inputValue(), 'synthetic-test-key');
  assert.equal(await page.locator(`${panel} [data-action="settings"]`).getAttribute('title'), '设置');
  assert.equal(await page.locator('#native-danmaku').inputValue(), 'Human danmaku draft');
  assert.equal(await page.locator('#native-comment').inputValue(), 'Human comment draft');
  assert.equal(await page.locator(`${panel} [data-role="cue-search"]`).inputValue(), 'Synthetic');
  checks.push('gear opens extension origin; old config retained; save/reload and live locale work; native drafts preserved');
  await worker.evaluate(() => {
    globalThis.translationRequests = [];
    globalThis.fetch = async (url, init) => {
      if (url !== 'https://example.test/v1/chat/completions') throw new Error('Unexpected test endpoint');
      const request = JSON.parse(init.body);
      globalThis.translationRequests.push({ model: request.model, syntheticKeyMatches: init.headers.Authorization === 'Bearer synthetic-test-key' });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ i: 0, text: '模拟翻译正文' }] }) } }] }), { status: 200 });
    };
  });
  await page.locator(`${panel} [data-role="cue-search"]`).fill('');
  await page.locator(`${panel} [data-role="target-language"]`).selectOption('zh-CN');
  await page.locator(`${panel} [data-action="translate-current"]`).click();
  await page.locator(`${panel} .bdsp-cue-text`).filter({ hasText: '模拟翻译正文' }).waitFor();
  assert.deepEqual(await worker.evaluate(() => globalThis.translationRequests), [{ model: 'updated-test-model', syntheticKeyMatches: true }]);
  assert.equal(await page.locator(`${panel} input[type="password"]`).count(), 0);
  await options.locator('#clear-cache').click();
  await page.locator(`${panel} .bdsp-cue-text`).filter({ hasText: 'Synthetic subtitle' }).waitFor();
  await page.locator(`${panel} [data-role="cue-search"]`).fill('Synthetic');
  checks.push('translation uses saved model/key in background; clearing cache restores original track');
  const wasDetached = await page.evaluate(() => {
    window.originalPanel = document.getElementById('bili-subtitle-lite-panel');
    window.mountTiming.hostReplaced = performance.now();
    const observer = new MutationObserver(() => {
      if (window.originalPanel.isConnected) {
        window.mountTiming.remounted = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document.querySelector('#right'), { childList: true });
    document.querySelector('#right').innerHTML = '<div id="danmukuBox"><h2>弹幕列表</h2></div>';
    return !window.originalPanel.isConnected;
  });
  assert.equal(wasDetached, true);
  await page.locator(panel).waitFor({ timeout: 4000 });
  assert.equal(await page.evaluate(() => window.originalPanel === document.getElementById('bili-subtitle-lite-panel')), true);
  assert.equal(await page.locator(`${panel} [data-role="cue-search"]`).inputValue(), 'Synthetic');
  assert.ok(await page.evaluate(() => window.mountTiming.remounted - window.mountTiming.hostReplaced < 200));
  checks.push('host replacement immediately reuses panel with search draft intact');
  await page.evaluate(() => { document.querySelector('#biliMainHeader').replaceChildren(); });
  await page.waitForTimeout(1600);
  assert.equal(await page.locator(panel).count(), 1);
  await page.evaluate(() => {
    document.querySelector('#biliMainHeader').innerHTML = '<nav>首页 投稿</nav>';
    history.pushState({}, '', '/');
  });
  await page.locator(panel).waitFor({ state: 'detached' });
  await page.evaluate(() => history.pushState({}, '', '/video/BV1234567890/?p=2'));
  await page.locator(panel).waitFor({ timeout: 5000 });
  assert.equal(await page.locator(panel).count(), 1);
  assert.equal(await page.locator('#biliMainHeader').innerText(), '首页 投稿');
  checks.push('temporary header loss does not churn panel; SPA exit/return mounts once');
  await page.evaluate(() => {
    const oldApp = document.querySelector('#app');
    const nextApp = oldApp.cloneNode(true);
    nextApp.setAttribute('data-server-rendered', 'true');
    nextApp.querySelector('#bili-subtitle-lite-panel').remove();
    nextApp.querySelector('#danmukuBox').remove();
    oldApp.replaceWith(nextApp);
  });
  assert.equal(await page.locator(panel).count(), 0);
  await page.evaluate(() => { document.querySelector('#right').innerHTML = '<div id="danmukuBox"><h2>弹幕列表</h2></div>'; });
  assert.equal(await page.locator(panel).count(), 0, 'Rediscovered SSR host must still wait for hydration');
  await page.evaluate(() => document.querySelector('#app').removeAttribute('data-server-rendered'));
  await page.locator(panel).waitFor();
  assert.equal(await page.evaluate(() => window.originalPanel === document.getElementById('bili-subtitle-lite-panel')), true);
  checks.push('whole app replacement rediscovers missing anchor and waits for new hydration');
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    document.querySelector('#right').innerHTML = '<div id="danmukuBox"><h2>弹幕列表</h2></div>';
  });
  assert.equal(await page.locator(panel).count(), 0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.locator(panel).waitFor();
  assert.equal(await page.locator(panel).count(), 1);
  checks.push('page lifecycle suspends observation and resumes on cached-page restore');
  await options.screenshot({ path: path.join(profile, 'options.png'), fullPage: true });
  await options.setViewportSize({ width: 380, height: 800 });
  assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await options.locator('#clear-cache').click();
  await options.locator('#status').filter({ hasText: '字幕缓存已清理' }).waitFor();
  checks.push('settings fit narrow viewport and cache clearing works');
  assert.deepEqual(errors, []);
  const timingMs = await page.evaluate(() => ({
    readyToFirstMount: Math.round(window.mountTiming.firstMount - window.mountTiming.ready),
    hostReplacementToRemount: Math.round(window.mountTiming.remounted - window.mountTiming.hostReplaced),
  }));
  console.log(JSON.stringify({ checks, timingMs, pageErrors: errors, artifacts: profile }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ checks, pageErrors: errors, pages: await Promise.all(context.pages().map(async page => ({ url: page.url(), text: await page.locator('body').innerText().catch(() => '') }))) }, null, 2));
  throw error;
} finally {
  await context.close();
}
