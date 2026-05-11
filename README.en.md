# Bilibili Lite Subtitle Helper

![Bilibili Lite Subtitle Helper preview](assets/github-preview.jpg)

Languages: [简体中文](./README.md) · [English](./README.en.md)

This is a companion browser extension for the danmaku analysis site [danmu.liu-qi.cn](https://danmu.liu-qi.cn/). It also works as a standalone subtitle tool for viewing, searching, copying, and downloading subtitles from Bilibili videos.

## What It Is

Bilibili Lite Subtitle Helper adds a lightweight subtitle panel to the right side of Bilibili video pages, so you can work with subtitles without leaving the current page.

You can use it on its own to download subtitles. If you also use [danmu.liu-qi.cn](https://danmu.liu-qi.cn/) for danmaku analysis, the `AI分析` button opens the matching result page and switches directly to the deep subtitle analysis tab.

## Features

- Read available subtitles from the current video
- Search subtitles by keyword
- Double-click a subtitle line to jump to that playback time
- Copy visible subtitle lines with timestamps
- Download subtitles as TXT or SRT
- Open the matching AI deep analysis page

## Installation

### Install From Chrome Web Store

The recommended installation method is the Chrome Web Store:

[Install B 站轻量字幕助手](https://chromewebstore.google.com/detail/b-%E7%AB%99%E8%BD%BB%E9%87%8F%E5%AD%97%E5%B9%95%E5%8A%A9%E6%89%8B/ifhokpfhemfpnmgoajodifgamfbhioga)

After installation, open a Bilibili video page and use the subtitle panel on the right side of the page.

### Load From Source

1. Open Chrome or Edge.
2. Go to `chrome://extensions/`.
3. Turn on Developer mode.
4. Click `Load unpacked`.
5. Select this project folder.

## Usage

1. Sign in to Bilibili and open a regular video page.
2. Find the `字幕列表` panel on the right side of the page.
3. Select a subtitle language, or search by keyword.
4. Click `复制字幕`, `下载 TXT`, or `下载 SRT`.
5. Click `AI分析` to open [danmu.liu-qi.cn](https://danmu.liu-qi.cn/) in the deep subtitle analysis view.

## Scope

- Mainly supports regular Bilibili video pages
- Requires the video to have available subtitles

## Permissions And Privacy

The extension only requests the permissions needed for subtitle features:

- `downloads`: save subtitle files to your local downloads folder
- `https://www.bilibili.com/video/*`: show the subtitle panel on Bilibili video pages
- `https://api.bilibili.com/*`: read subtitle tracks and video information
- `https://*.hdslb.com/*`: fetch subtitle file content

The extension does not read or upload your Bilibili cookies. See [PRIVACY.md](PRIVACY.md) for details.

## Help

See [SUPPORT.md](SUPPORT.md) for usage notes and common questions.
