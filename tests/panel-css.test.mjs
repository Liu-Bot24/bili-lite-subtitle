import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panelCss = await readFile(new URL('../src/panel.css', import.meta.url), 'utf8');

test('keeps the bottom resize handle from rendering stacked separator lines', () => {
  const resizerRule = getCssRule('#bili-subtitle-lite-panel .bdsp-resizer');
  const hoverRule = getCssRule('#bili-subtitle-lite-panel .bdsp-resizer:hover,');

  assert.match(resizerRule, /position:\s*absolute\b/);
  assert.doesNotMatch(resizerRule, /linear-gradient|border-top/);
  assert.doesNotMatch(hoverRule, /linear-gradient|border-top/);
});

function getCssRule(selector) {
  const start = panelCss.indexOf(selector);
  assert.notEqual(start, -1, `Missing CSS selector: ${selector}`);
  const open = panelCss.indexOf('{', start);
  const close = panelCss.indexOf('}', open);
  assert.notEqual(open, -1, `Missing opening brace for: ${selector}`);
  assert.notEqual(close, -1, `Missing closing brace for: ${selector}`);
  return panelCss.slice(open + 1, close);
}
