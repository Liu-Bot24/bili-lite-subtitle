import assert from 'node:assert/strict';
import test from 'node:test';

await import('../src/i18n.js');

const I18n = globalThis.BiliSubtitleI18n;

test('uses Chinese for Chinese browser languages', () => {
  assert.equal(I18n.pickLocale(['zh-CN', 'en-US']), 'zh');
  assert.equal(I18n.pickLocale(['zh-Hant-TW', 'en-US']), 'zh');
});

test('falls back to English for non-Chinese browser languages', () => {
  assert.equal(I18n.pickLocale(['en-US', 'zh-CN']), 'en');
  assert.equal(I18n.pickLocale(['fr-FR', 'en-US']), 'en');
});

test('translates panel text with parameters', () => {
  assert.equal(I18n.translate('status.loadedSubtitleLines', { count: 58 }, 'en'), 'Loaded 58 subtitle lines');
  assert.equal(I18n.translate('status.loadedSubtitleLines', { count: 58 }, 'zh'), '已载入 58 行字幕');
});

test('keeps missing keys readable', () => {
  assert.equal(I18n.translate('missing.key', {}, 'en'), 'missing.key');
});
