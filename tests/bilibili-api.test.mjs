import assert from 'node:assert/strict';
import test from 'node:test';

await import('../src/bilibili-api.js');

const Api = globalThis.BilibiliSubtitleApi;

test('names downloads with BV id, video title, uploader, and requested extension', () => {
  const filename = Api.makeSubtitleFilename({
    bvid: 'BV1r1dZBnEA8',
    title: '我/已:急哭',
    ownerName: '无名之辈209',
    format: 'srt',
  });

  assert.equal(filename, 'BV1r1dZBnEA8_我_已_急哭_无名之辈209.srt');
});

test('keeps SRT extension even when an old TXT filename is supplied', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      body: [
        {
          from: 1,
          to: 2,
          content: '第一行字幕',
        },
      ],
    }),
  });

  try {
    const result = await Api.fetchAndFormatSubtitle({
      subtitleUrl: 'https://example.com/subtitle.json',
      format: 'srt',
      filename: 'BV1r1dZBnEA8_旧文件名.txt',
    });

    assert.equal(result.filename, 'BV1r1dZBnEA8_旧文件名.srt');
    assert.equal(result.mimeType, 'application/x-subrip;charset=utf-8');
    assert.match(result.text, /00:00:01,000 --> 00:00:02,000/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps extension after truncating long filenames', () => {
  const filename = Api.makeSubtitleFilename({
    bvid: 'BV1r1dZBnEA8',
    title: '很长'.repeat(120),
    format: 'srt',
  });

  assert.ok(filename.length <= 180);
  assert.ok(filename.endsWith('.srt'));
});

test('builds site result url with requested analysis tab', () => {
  const url = Api.buildSiteResultUrl({
    bvid: 'BV1r1dZBnEA8',
    cid: 123,
    page: 2,
    analysisTab: 'deep',
  });

  assert.match(url, /[?&]bvid=BV1r1dZBnEA8/);
  assert.match(url, /[?&]cid=123/);
  assert.match(url, /[?&]p=2/);
  assert.match(url, /[?&]analysis=deep/);
});
