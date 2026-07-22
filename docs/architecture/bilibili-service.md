# Bilibili Service 技术架构说明

> 文档目的：记录 B 站专用取流链路的稳定目标、入口、分阶段路线和改动边界。
> 最后更新：2026-06-12

## 一、模块概览

- 功能目标：在通用 yt-dlp 被 B 站播放流接口拒绝时，补一条 B 站专用取流链路，优先拿到公开视频 DASH audio，供本地 Whisper 转写使用。
- 当前定位：不是万能下载器，不处理 DRM、付费、私密、会员专属或无授权内容。
- 核心入口：计划新增 `backend/app/services/bilibili_service.py`，并通过 `media_source_service.py` 的专用 Adapter 接入 `/api/parse`。

## 二、文件地图

- `backend/app/services/bilibili_service.py`：新增 B 站专用元数据、签名、播放流和格式整理逻辑。
- `backend/app/services/media_source_service.py`：新增 `BilibiliVideoSourceAdapter`，顺序放在 `YtdlpVideoSourceAdapter` 之前。
- `backend/app/services/ytdlp_service.py`：继续保留通用 yt-dlp 兜底和公开元数据降级，不承载完整 B 站专用链路。
- `backend/app/services/asr_service.py`：继续负责下载音频和 Whisper 转写；后续应能接收 B 站专用链路提供的音频 URL 与请求头。
- `backend/app/main.py`：`/api/transcribe` 当前通过 `_resolve_transcription_source_url()` 解析转写源；后续需要让 B 站结果能稳定传入 ASR。
- `frontend/components/FormatSelector.tsx`：继续展示格式列表和平台拒绝提示，不承担取流逻辑。

## 三、当前链路

```text
URL
→ normalize_public_video_url 清理 B 站跟踪参数
→ media_source_service 落到 YtdlpVideoSourceAdapter
→ ytdlp_service 调 yt-dlp
→ B 站 playurl / metadata 请求返回 412
→ ytdlp_service 降级读取 x/web-interface/view
→ 页面得到标题、作者、时长、封面，但 formats=[]
→ /api/transcribe 再次尝试下载音频
→ 平台拒绝音频流
→ 返回 ASR_AUDIO_PLATFORM_REJECTED
```

## 四、目标链路

第一阶段只补公开视频音频取流：

```text
URL
→ BilibiliVideoSourceAdapter
→ 提取 BVID
→ x/web-interface/view 获取 aid/cid/title/owner/duration/pic
→ 获取 buvid3/buvid4
→ 获取或计算 WBI 签名参数
→ x/player/wbi/playurl 请求 DASH 流
→ 选择可用 audio stream
→ 返回 ParseResponse + transcription_source_url 或 B 站音频候选
→ /api/transcribe 下载该音频并交给 Whisper
```

完整 DownKyi 式路线可分阶段补齐：

- 阶段 1：公开视频音频取流，目标是解决“能解析元数据但不能转写”。
- 阶段 2：显式本地 Cookie / 浏览器态导入，只有用户主动配置时启用；不接收账号密码。参考 DownKyi 的核心模式：本地保存 Cookie，所有非登录 B 站 API 请求自动携带 Cookie，并通过 `x/web-interface/nav` 判断登录态和 WBI 参数。
- 阶段 3：公开视频格式列表，整理 DASH video / audio，复用现有下载接口和 ffmpeg 合并。当前先做单文件流下载与本地 ffmpeg 合并，不接 aria2、断点续传或批量下载。
- 阶段 4：断点续传、aria2、多 P、字幕、封面等下载器增强；这些不是转写阻断项。

## 五、关键设计说明

- DownKyi 的核心不是“直接套 yt-dlp”，而是 B 站专用 API 客户端：登录态 / Cookie、buvid、WBI 签名、referer / origin 请求头、playurl、下载和合并分别处理。
- 本项目不需要一开始全复刻 DownKyi；先复刻“取到公开视频 audio URL”这条最短路径。
- 二阶段只实现显式本地 Cookie 能力：通过 `BILIBILI_ENABLE_COOKIE_OPTIONS=1` 与 `BILIBILI_COOKIE_FILE` 读取本机 Cookie 文件，并提供 `GET /api/bilibili/auth/status` 做登录态诊断；不在前端接收或展示 Cookie。
- 三阶段沿用 DownKyi 的 DASH 数据结构：读取 `dash.video`、`dash.audio`、`dash.dolby.audio`、`dash.flac.audio` 与 `support_formats`，前端仍走现有 `formats` 列表和 `/api/download`；B 站下载分支在后端按格式 ID 重新解析新鲜播放流 URL，再下载视频流和最佳音频流并调用 ffmpeg `copy` 合并。
- `bilibili_service.py` 不应打印 Cookie、签名原始敏感输入或完整播放流 URL；日志只记录 BVID、错误码、HTTP 状态和是否命中降级。
- 公开元数据降级仍保留在 `ytdlp_service.py`，用于 B 站专用链路失败时给页面留基础信息。
- 如果 `x/player/wbi/playurl` 明确返回权限、会员、风控或地区限制，应返回清晰业务错误，不要自动切换到账号登录或绕过限制方案。

## 六、改动边界

- 允许改动：新增 `bilibili_service.py`、新增 B 站 Adapter、扩展 ASR 下载输入以携带 B 站请求头、补最小单元测试。
- 不要破坏：现有抖音、小宇宙、yt-dlp 通用视频 Adapter 顺序和返回结构；`ParseResponse`、`TranscribeResponse` 对前端的兼容字段；Cookie 默认关闭策略。
- 待确认：无 Cookie 的 buvid + WBI 链路在当前本机网络下是否足够稳定；B 站是否仍对部分公开视频返回 412 / 403；如果需要 Cookie，应采用环境变量还是浏览器态导入作为显式本地配置入口。
