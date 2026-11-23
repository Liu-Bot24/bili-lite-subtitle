# B 站轻量字幕助手

![Stars](https://img.shields.io/github/stars/Liu-Bot24/bili-lite-subtitle?style=flat&label=Stars&cache=20260704) ![Forks](https://img.shields.io/github/forks/Liu-Bot24/bili-lite-subtitle?style=flat&label=Forks&cache=20260704) ![Views 14d](https://github-stats.liu-qi.cn/api/badge/Liu-Bot24/bili-lite-subtitle/views14d.svg?v=4) ![Clones 14d](https://github-stats.liu-qi.cn/api/badge/Liu-Bot24/bili-lite-subtitle/clones14d.svg?v=4) ![Downloads](https://img.shields.io/github/downloads/Liu-Bot24/bili-lite-subtitle/total?style=flat&label=Downloads&cache=20260704) ![Release](https://img.shields.io/github/v/release/Liu-Bot24/bili-lite-subtitle?style=flat&label=Release&cache=20260704)

![B 站轻量字幕助手预览](assets/github-preview.jpg)

Languages: [简体中文](./README.md) · [English](./README.en.md)

这是一款用于 B 站视频页的轻量字幕浏览器扩展，也可以配合弹幕分析网站 [danmu.liu-qi.cn](https://danmu.liu-qi.cn/) 进行字幕深度 AI 分析。它可在 B 站视频页查看、搜索、复制、下载和翻译字幕，并可一键把当前视频带到 AI 深度分析页。

## 这是一个什么插件

B 站轻量字幕助手会在 B 站视频页的右侧区域增加一个轻量字幕面板，让你不用离开当前页面，就能直接查看、搜索、复制、下载和翻译字幕。

它可以单独作为字幕下载工具使用；如果你正在配合 [danmu.liu-qi.cn](https://danmu.liu-qi.cn/) 做弹幕分析，也可以把当前视频一键带到网站结果页，并默认切换到“字幕深度分析”。

## 你可以用它做什么

- 直接读取当前视频的可用字幕
- 按关键词搜索字幕内容
- 双击字幕跳转到对应播放时间
- 复制带时间码的字幕文本
- 下载 TXT 或 SRT 字幕文件
- 配置 OpenAI 兼容模型后，将当前字幕翻译为目标语言
- 在字幕语言下拉菜单中切换原字幕和翻译字幕
- 一键跳到 AI 深度分析页

## 安装

### 从 Chrome Web Store 安装

推荐直接从 Chrome Web Store 安装：

[安装 B 站轻量字幕助手](https://chromewebstore.google.com/detail/b-%E7%AB%99%E8%BD%BB%E9%87%8F%E5%AD%97%E5%B9%95%E5%8A%A9%E6%89%8B/ifhokpfhemfpnmgoajodifgamfbhioga)

安装后打开 B 站视频页，即可在页面右侧使用字幕面板。

### 从源码加载

1. 打开 Chrome 或 Edge。
2. 进入 `chrome://extensions/`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目目录。

## 使用

1. 登录哔哩哔哩并打开一个普通视频页。
2. 在右侧找到“字幕列表”面板。
3. 选择字幕语言，或输入关键词搜索字幕。
4. 需要翻译时，点击齿轮打开独立的扩展设置页，填写 Base URL、Model 和 API Key 并保存，回到视频页，再选择目标语言并点击 `翻译为`。
5. 翻译完成后，可在字幕语言下拉菜单中选择生成的字幕。
6. 点击 `复制字幕`、`下载 TXT` 或 `下载 SRT`。
7. 点击 `AI分析` 打开 [danmu.liu-qi.cn](https://danmu.liu-qi.cn/) 并进入“字幕深度分析”。

## 适用范围

- 支持哔哩哔哩普通视频页，以及个人空间单个合集/系列详情页的批量字幕下载
- 需要视频本身存在可用字幕

## 个人空间合集/系列批量字幕

打开 UP 主个人空间的**某个合集/系列详情页**，在「播放全部」旁点击「批量获取字幕」：

1. 选择「逐个文件」（TXT/SRT），或「合并为一个 TXT」。
2. 字幕语言可选「优先中文，否则首条」或「所有可用语言」。
3. 默认包含多 P 视频的全部分 P。确认后点击「开始下载」，可随时取消后续任务。
4. 页面会显示已完成数量及无字幕/请求失败记录；合并 TXT 会保留视频顺序、视频链接和章节标题。

**范围和限制：**仅遍历**当前合集页面已加载的卡片**（最多 250 个不同 BV），不会自动翻页或爬取该 UP 主的全部投稿。无可用字幕的视频会跳过。请在已登录 B 站、能够正常访问字幕的浏览器环境中使用；如遇风控、验证码或接口限制，请停止批量请求并稍后重试。逐个下载很多文件时，浏览器可能要求确认允许多个下载。

## 权限与隐私

扩展只申请实现字幕功能所需的最小权限：

- `downloads`：把字幕文件保存到本机下载目录
- `storage`：保存模型配置、界面语言和翻译缓存
- `https://www.bilibili.com/video/*`：在 B 站视频页显示字幕面板
- `https://space.bilibili.com/*`：在合集/系列详情页显示批量字幕按钮
- `https://api.bilibili.com/*`：读取字幕轨道和视频信息
- `https://*.hdslb.com/*`：获取字幕文件正文
- `https://*/*`：在你翻译字幕时，请求你在设置中配置的 HTTPS OpenAI 兼容接口

扩展不会读取或上传你的哔哩哔哩 Cookie。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 常见问题

更多使用说明见 [SUPPORT.md](SUPPORT.md)。
