import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('./fixtures/sample-subtitle.json', import.meta.url);
const sampleSubtitle = JSON.parse(await readFile(fixtureUrl, 'utf8'));

const moduleCandidates = [
  '../src/subtitle-format.js',
  '../src/subtitle-format.mjs',
  '../src/subtitleFormat.js',
  '../src/subtitle-utils.js'
];

const moduleUrl = await findSubtitleFormatModule();
const subtitleFormatModule = await import(moduleUrl);
const subtitleFormat = {
  ...(globalThis.BiliSubtitleFormat ?? {}),
  ...(subtitleFormatModule.default ?? {}),
  ...subtitleFormatModule
};

const normalizeCues = pickExport([
  'normalizeCues',
  'normalizeSubtitleCues',
  'normalizeSubtitleBody'
]);
const formatTxt = pickExport([
  'formatTxt',
  'formatSubtitleTxt',
  'toTxt',
  'cuesToPlainText',
  'subtitleJsonToPlainText'
]);
const formatSrt = pickExport([
  'formatSrt',
  'formatSubtitleSrt',
  'toSrt',
  'cuesToSrt',
  'subtitleJsonToSrt'
]);

test('normalizes Bilibili subtitle cues and filters empty content', () => {
  const cues = normalizeCues(sampleSubtitle.body);

  assert.equal(cues.length, 2);
  assert.equal(cueText(cues[0]), '第一行字幕');
  assert.equal(cueText(cues[1]), '第二行字幕');
  assert.equal(cueStart(cues[0]), 0.04);
  assert.equal(cueEnd(cues[0]), 2.3);
  assert.equal(cueStart(cues[1]), 62.125);
  assert.equal(cueEnd(cues[1]), 64.5);
});

test('formats normalized cues as clean TXT', () => {
  const cues = normalizeCues(sampleSubtitle.body);
  const txt = formatTxt(cues);

  assert.match(txt, /第一行字幕/);
  assert.match(txt, /第二行字幕/);
  assert.doesNotMatch(txt, /undefined|NaN/);
  assert.equal(txt.includes('   \n'), false);
});

test('formats normalized cues with SRT indices and millisecond timestamps', () => {
  const cues = normalizeCues(sampleSubtitle.body);
  const srt = formatSrt(cues);

  assert.match(srt, /^1\n00:00:00,040 --> 00:00:02,300\n第一行字幕/m);
  assert.match(srt, /\n2\n00:01:02,125 --> 00:01:04,500\n第二行字幕/m);
  assert.doesNotMatch(srt, /undefined|NaN/);
  assert.doesNotMatch(srt, /\n3\n/);
});

async function findSubtitleFormatModule() {
  const failures = [];

  for (const candidate of moduleCandidates) {
    const url = new URL(candidate, import.meta.url);
    try {
      await readFile(url);
      return url.href;
    } catch (error) {
      failures.push(`${candidate}: ${error.code || error.message}`);
    }
  }

  throw new Error(`Subtitle format module not found. Tried:\n${failures.join('\n')}`);
}

function pickExport(names) {
  for (const name of names) {
    if (typeof subtitleFormat[name] === 'function') {
      return subtitleFormat[name];
    }
  }

  throw new TypeError(`Missing subtitle formatter export. Expected one of: ${names.join(', ')}`);
}

function cueText(cue) {
  return cue.text ?? cue.content;
}

function cueStart(cue) {
  return cue.start ?? cue.from;
}

function cueEnd(cue) {
  return cue.end ?? cue.to;
}
