# B 站轻量字幕助手

![B 站轻量字幕助手预览](assets/github-preview.jpg)

Languages: [简体中文](./README.md) · [English](./README.en.md)

这是一款用于 B 站视频页的轻量字幕浏览器扩展，也可以配合弹幕分析网站 [danmu.liu-qi.cn](https://danmu.liu-qi.cn/) 进行字幕深度 AI 分析。它可在 B 站视频页查看、搜索、复制和下载字幕，并可一键把当前视频带到 AI 深度分析页。

## 这是一个什么插件

B 站轻量字幕助手会在 B 站视频页的右侧区域增加一个轻量字幕面板，让你不用离开当前页面，就能直接查看、搜索、复制和下载字幕。

它可以单独作为字幕下载工具使用；如果你正在配合 [danmu.liu-qi.cn](https://danmu.liu-qi.cn/) 做弹幕分析，也可以把当前视频一键带到网站结果页，并默认切换到“字幕深度分析”。

## 你可以用它做什么

- 直接读取当前视频的可用字幕
- 按关键词搜索字幕内容
- 双击字幕跳转到对应播放时间
- 复制带时间码的字幕文本
- 下载 TXT 或 SRT 字幕文件
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
4. 点击 `复制字幕`、`下载 TXT` 或 `下载 SRT`。
5. 点击 `AI分析` 打开 [danmu.liu-qi.cn](https://danmu.liu-qi.cn/) 并进入“字幕深度分析”。

## 适用范围

- 主要支持哔哩哔哩普通视频页
- 需要视频本身存在可用字幕

## 权限与隐私

扩展只申请实现字幕功能所需的最小权限：

- `downloads`：把字幕文件保存到本机下载目录
- `https://www.bilibili.com/video/*`：仅在 B 站视频页显示字幕面板
- `https://api.bilibili.com/*`：读取字幕轨道和视频信息
- `https://*.hdslb.com/*`：获取字幕文件正文

扩展不会读取或上传你的哔哩哔哩 Cookie。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 常见问题

更多使用说明见 [SUPPORT.md](SUPPORT.md)。
