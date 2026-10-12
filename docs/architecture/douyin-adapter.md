# 抖音公开媒体适配

## 职责与入口

抖音公开短视频由 `DouyinVideoSourceAdapter` 接管，注册在通用 yt-dlp 兜底之前。当前支持用户提供的公开链接与分享文案，不做主页采集、自动登录或风控绕过。

- `services/douyin_adapter.py`：页面结构和媒体字段解析。
- `services/douyin_service.py`：公开链接解析、重试、浏览器 Helper 调用与专用下载器。
- `services/processing_service.py`：持久任务与兼容 API 共用的转写源选择。
- `routers/media.py`：解析及下载接口；`routers/analysis.py`：兼容转写接口。
- `scripts/extract-douyin-media.mjs`：使用独立 Edge / Chrome 资料的取流 Helper。

## 链路

分享文案经 `url_normalization_service` 提取公开 URL，再交给抖音适配器。解析返回统一元数据、格式和文本状态。默认提炼任务在缺少完整逐字稿时下载媒体、使用 SenseVoiceSmall 识别，并生成总结。

抖音取流和媒体下载复用同一独立浏览器资料，避免短期签名流在另一会话中失效。转写保留原始分享链接作为内容库身份，交由专用下载器在浏览器上下文中取流，不把临时直链当作历史主键。

## 本机资料与依赖

Helper 的 Playwright 是 `frontend/package.json` 中显式声明的运行依赖，测试框架单独位于开发依赖。默认资料路径为仓库内 `.local/browser/douyin/`，可用已有环境变量 `DOUYIN_BROWSER_PROFILE_DIR` 覆盖。源码不再依赖上级 `private/`。

该资料独立于用户日常浏览器；`.local/` 不进入 Git。迁移资料时保留会话内容，关闭使用它的浏览器实例后再移动。

## 稳定边界

- 抖音解析和下载共享进程内互斥限制，不能因为单条和批量入口不同而并发使用同一浏览器资料。
- 下载时重新解析当前可用流，不复用已过期的签名地址。
- Helper 保留媒体大小、超时和重试上限；失败返回明确错误。
- 平台无字幕时的“需转写”是正常状态；完整识别依赖本机 FFmpeg 与 SenseVoice 环境。
- 不自动获取日常浏览器凭据，不处理私密、付费或无授权内容。

## 验证

`test_douyin_adapter.py` 与 `test_douyin_service.py` 覆盖合成页面、重试和下载错误；真实公开视频与平台环境需要独立验收。
