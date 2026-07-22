# V0.4 抖音实验 Adapter 架构说明

> **最后更新**：2026-06-04

## 一、版本定位

抖音能力仍是实验性 Adapter，不是核心稳定承诺。当前目标是让公开视频分享链接能进入同一个媒体工作台：解析标题、作者、封面、公开视频直链和下载候选；如果用户需要内容文本，再由 `/api/transcribe` 使用本地 ASR 从公开视频直链生成全文本。

该模块只处理用户有权访问和处理的公开内容，不处理 DRM、私密、付费、登录受限或无授权内容。

## 二、核心入口

```text
backend/app/
├── main.py
└── services/
    ├── media_source_service.py
    ├── douyin_service.py
    ├── asr_service.py
    └── library_service.py

frontend/
├── app/page.tsx
├── components/
│   ├── FormatSelector.tsx
│   └── TranscribeTaskToasts.tsx
└── lib/types.ts
```

## 三、数据流

解析：

```text
用户粘贴抖音分享口令或公开视频 URL
→ main.extract_public_url() 从整段文案中提取第一个 http(s) 链接
→ POST /api/parse
→ media_source_service 优先命中 DouyinVideoSourceAdapter
→ douyin_service 解析短链跳转、视频 ID、公开接口或移动端分享页结构化数据
→ 返回 ParseResponse：metadata、封面、douyin_nowatermark 格式、transcription_source_url
→ library_service 按原始 source_url 写入 SQLite 历史
```

下载：

```text
FormatSelector 点击下载
→ POST /api/download
→ main.py 判断 is_douyin_url()
→ douyin_service 重新解析公开视频直链
→ 下载到受控本地目录
```

AI 转写稿生成：

```text
用户点击生成 AI 转写稿
→ POST /api/transcribe
→ main._resolve_transcription_source_url() 对抖音先解析 transcription_source_url
→ asr_service 下载公开直链音频 / 视频输入
→ faster-whisper 生成 TranscriptPayload
→ library_service 仍按原始抖音 source_url 写回历史
```

## 四、稳定边界

- 抖音 Adapter 必须注册在 yt-dlp 默认适配器之前，避免抖音链接落入通用解析兜底。
- 抖音分享口令不是标准 URL 输入，后端必须先从整段文案里提取公开 URL。
- `transcription_source_url` 只作为 ASR 输入，不应替代原始抖音链接成为历史主键。
- 下载时需要重新解析公开视频直链，避免直链过期。
- 当前没有平台字幕；页面显示“无可用内容文本”是正常状态，用户可手动触发 ASR 生成 AI 转写稿。ASR 依赖后端本机 ffmpeg 与 faster-whisper 模型，`.env` 变更后必须重启后端。
- 抖音直链有时是可由 yt-dlp 识别的 mp4 视频输入，不一定是纯音频；`asr_service` 负责下载临时媒体并交给 Whisper 读取音轨。
- WAF challenge、公开接口和分享页结构随平台变化可能失效；失败时要返回明确错误，不要用文案掩盖解析失败。
- 不为抖音加入自动登录、自动拿 Cookie、破解风控或批量抓取能力。

## 五、下一步边界

下一轮如果继续处理抖音，只修阻断链路：公开视频解析失败、ASR 未读到 `transcription_source_url`、下载直链不可用、AI 转写稿写回错误、任务提示丢失。不要把小红书、批量短视频采集、账号登录或浏览器插件混入同一轮。
