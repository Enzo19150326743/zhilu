# B 站媒体服务

## 职责与入口

B 站适配器负责公开页面元数据、可用 DASH 音视频流、格式选择及下载合并。它注册在通用 yt-dlp 适配器之前，输出统一的 `ParseResponse`，不在路由中实现平台 API 细节。

- `backend/app/services/bilibili_service.py`：页面、签名、Cookie、播放流和下载。
- `backend/app/services/media_source_service.py`：`BilibiliVideoSourceAdapter` 与受控 yt-dlp 降级。
- `backend/app/services/processing_service.py`：共用 `resolve_transcription_media()` 取得音频地址和请求头。
- `backend/app/routers/media.py`：公开解析与下载接口。
- `backend/app/routers/analysis.py`：兼容转写接口。
- `backend/app/routers/status.py`：显式本机凭据状态检查。

## 数据流

1. 规范化公开 URL，保留用于内容定位的分 P 参数。
2. 读取视频页面信息和 BVID、aid、cid，取得 buvid / WBI 所需信息。
3. 调用公开播放接口，整理可访问的视频与音频流及格式。
4. 转写选择音频并保留必要请求头；下载根据格式 ID 重新获取新鲜地址。
5. 需要合并时调用本机 FFmpeg，结果写入受控下载目录。

专用解析失败时按现有错误分类降级到 yt-dlp；明确受限的内容不能通过降级绕过限制。平台拒绝或只返回低清格式时，应呈现真实可用结果，不承诺固定清晰度。

## 稳定规则

- 默认匿名访问。只有显式开启 `BILIBILI_ENABLE_COOKIE_OPTIONS` 并配置本机文件时，才读取对应凭据。
- `GET /api/bilibili/auth/status` 不向前端返回 Cookie 内容。
- B 站分 P 属于内容身份，同一 BVID 的不同分 P 不能共用转写结果。
- 不记录凭据、完整签名媒体 URL 或其他敏感输入。
- 不接入账号登录、权限绕过、aria2 或完整下载器功能。
- 目录迁移只调整本机 `.env` 中的工具和凭据路径，保持 API 字段、格式 ID 与适配器顺序。

## 验证

运行 `backend/tests/test_bilibili_service.py`、`test_url_normalization.py` 和相关内容库测试。它们验证合成响应和边界；真实平台可用性仍需单独实测，不能由单元测试代替。
