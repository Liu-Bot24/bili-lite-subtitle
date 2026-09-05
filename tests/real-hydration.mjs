// Live integration check. Uses an isolated profile and real Bilibili scripts.
// BDSP_VIDEO_DELAY_MS widens the observed async page-startup window.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const extension = path.resolve(process.argv[2] || '.');
mkdirSync('work', { recursive: true });
const profile = mkdtempSync(path.resolve('work/real-hydration-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BDSP_CHROMIUM, headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--mute-audio'],
  viewport: { width: 1500, height: 1000 },
});
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const delay = Number(process.env.BDSP_VIDEO_DELAY_MS || 1800);
  await context.route(/\/bfs\/static\/jinkela\/video\/video\.[^/]+\.js/, async route => {
    await new Promise(resolve => setTimeout(resolve, delay));
    await route.continue();
  });
  await page.addInitScript(() => {
    window.hydrationTrace = { mounts: [], hydrationFinished: null };
    let sawSSR = false;
    new MutationObserver(records => {
      const app = document.getElementById('app');
      if (app?.hasAttribute('data-server-rendered')) sawSSR = true;
      if (sawSSR && app && !app.hasAttribute('data-server-rendered') && window.hydrationTrace.hydrationFinished === null) {
        window.hydrationTrace.hydrationFinished = performance.now();
      }
      for (const record of records) for (const node of record.addedNodes) {
        if (node.id === 'bili-subtitle-lite-panel') {
          window.hydrationTrace.mounts.push({
            time: performance.now(), ssr: app?.hasAttribute('data-server-rendered'), readyState: document.readyState,
          });
        }
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-server-rendered'] });
  });
  const response = await page.goto('https://www.bilibili.com/video/BV11jhV6oExG/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('app') && !document.getElementById('app').hasAttribute('data-server-rendered'), null, { timeout: 25000 });
  // Let the real async header initialization settle before inspecting the symptom.
  await page.waitForTimeout(4000);
  const result = await page.evaluate(() => ({
    ...window.hydrationTrace,
    headerChildren: document.getElementById('biliMainHeader')?.children.length ?? 0,
    headerText: document.getElementById('biliMainHeader')?.textContent.trim().slice(0, 50),
    headerScripts: [...document.scripts].filter(s => s.src.includes('/laputa-header/bili-header.umd.js')).length,
    panels: document.querySelectorAll('#bili-subtitle-lite-panel').length,
  }));
  await page.screenshot({ path: path.join(profile, 'page.png') });
  console.log(JSON.stringify({ status: response.status(), delay, ...result, errors, profile }, null, 2));
  assert.ok(result.headerChildren > 0, 'Real Bilibili header must survive hydration');
  assert.equal(result.panels, 1, 'Exactly one subtitle panel must survive hydration');
  assert.notEqual(result.hydrationFinished, null, 'Test must observe the real SSR handoff');
  assert.ok(result.mounts.length > 0 && result.mounts.every(m => m.ssr === false), 'No extension insertion into the SSR tree');
  assert.equal(result.headerScripts, 1, 'Header should initialize once');
  assert.ok(!errors.some(e => e.includes('nextSibling')), 'No header initialization crash');
} finally {
  await context.close();
}
