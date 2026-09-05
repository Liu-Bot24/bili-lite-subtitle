import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function background(config, options = {}) {
  let listener, opened = 0;
  const context = {
    URL, console,
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { listener = fn; } },
        async openOptionsPage() { if (options.failOpen) throw new Error('Cannot open settings'); opened++; },
      },
      storage: { local: { get(key, callback) {
        if (options.failStorage) context.chrome.runtime.lastError = { message: 'Storage unavailable' };
        callback({ 'bdsp.llmConfig.v1': config });
        delete context.chrome.runtime.lastError;
      } } },
    },
  };
  vm.createContext(context);
  for (const file of ['src/bilibili-api.js', 'src/translation-core.js', 'src/translation-cache.js', 'src/background.js']) {
    vm.runInContext(read(file).replace(/^import .*;\r?\n/gm, ''), context, { filename: file });
  }
  return {
    send: message => new Promise(resolve => listener(message, { tab: { id: 7 } }, resolve)),
    get opened() { return opened; },
  };
}

test('old configuration key works and status exposes only readiness', async () => {
  const config = { baseUrl: 'https://example.com/v1', model: 'test-model', apiKey: 'synthetic-test-key' };
  const b = background(config);
  const reply = await b.send({ type: 'GET_SETTINGS_STATUS' });
  assert.deepEqual(JSON.parse(JSON.stringify(reply)), { ok: true, type: 'GET_SETTINGS_STATUS_RESULT', configured: true });
  assert.equal(b.opened, 0);
});

test('missing and invalid settings are not configured', async () => {
  for (const config of [undefined, {}, { baseUrl: 'file:///tmp', model: 'x', apiKey: 'synthetic-test-key' }]) {
    const reply = await background(config).send({ type: 'GET_SETTINGS_STATUS' });
    assert.equal(reply.ok, true);
    assert.equal(reply.configured, false);
  }
});

test('OPEN_SETTINGS has its own dispatch and preserves failure', async () => {
  const b = background({});
  const reply = await b.send({ type: 'OPEN_SETTINGS' });
  assert.equal(reply.ok, true);
  assert.equal(reply.type, 'OPEN_SETTINGS_RESULT');
  assert.equal(b.opened, 1);
  const failure = await background({}, { failOpen: true }).send({ type: 'OPEN_SETTINGS' });
  assert.equal(failure.ok, false);
});

test('storage failures are errors, not reported as missing configuration', async () => {
  const reply = await background({}, { failStorage: true }).send({ type: 'GET_SETTINGS_STATUS' });
  assert.equal(reply.ok, false);
});

test('video content no longer contains credential UI or reads model configuration', () => {
  const content = read('src/content.js');
  assert.doesNotMatch(content, /llmConfig|llm-api-key|type="password"|new-password|openSettingsModal/);
  assert.match(content, /type="search"[^>]*autocomplete="off"/);
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.options_ui.page, 'options.html');
  assert.equal(manifest.options_ui.open_in_tab, true);
  assert.match(read(manifest.options_ui.page), /type="password"/);
});
