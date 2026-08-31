# 代码定位地图

> 目的：给后续 Codex 或开发者快速定位代码。先读本文件，再按任务读取具体模块。

## 代码根目录

本项目业务代码都在：

```text
ai-video-insight-workspace/
```

上级目录里的 `private/` 不是业务代码入口；通常不要搜索它。

## 先读顺序

1. `docs/code-map.md`：当前这份快速定位地图。
2. `docs/project-context.md`（本地存在时）：项目级稳定事实、技术栈、红线和文档索引；公开仓库不依赖该文件。
3. 相关 `docs/architecture/*.md`：模块架构。
4. 相关 `docs/handoffs/*.md`（本地存在时）：近期开发收口和下一步。
5. 最后再读前后端具体代码。

## 常用快速搜索命令

PowerShell 里涉及中文输出时，先设置当前会话 UTF-8：

```powershell
[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
chcp 65001 | Out-Null
```

列出业务文件：

```powershell
rg --files ai-video-insight-workspace `
  -g '!**/node_modules/**' `
  -g '!**/data/**' `
  -g '!**/__pycache__/**' `
  -g '!*.log' `
  -g '!*.tsbuildinfo'
```

搜索代码关键词：

```powershell
rg "关键词" ai-video-insight-workspace `
  -g '!**/node_modules/**' `
  -g '!**/data/**' `
  -g '!**/__pycache__/**' `
  -g '!*.log' `
  -g '!*.tsbuildinfo'
```

只搜前端：

```powershell
rg "关键词" ai-video-insight-workspace/frontend `
  -g '!**/node_modules/**' `
  -g '!*.tsbuildinfo'
```

只搜后端：

```powershell
rg "关键词" ai-video-insight-workspace/backend `
  -g '!**/data/**' `
  -g '!**/__pycache__/**' `
  -g '!*.log'
```

## 顶层目录职责

```text
ai-video-insight-workspace/
├── frontend/   Next.js + React + TypeScript + Tailwind 前端
├── backend/    FastAPI + Pydantic 后端
├── docs/       项目上下文、架构、计划、交接文档
├── .github/    GitHub Actions、Issue 与 PR 模板
├── scripts/    Windows 本地启动脚本
└── 启动网站.bat
```

## 前端入口

- `frontend/app/page.tsx`：前端主状态入口；控制首页、解析任务、历史记录、总结、转写、工作台状态。
- `frontend/app/layout.tsx`：Next.js 根布局。
- `frontend/app/globals.css`：全局样式。
- `frontend/lib/api.ts`：前端请求后端 API 的封装。
- `frontend/lib/types.ts`：前端核心类型。
- `frontend/lib/media.ts`：媒体类型和文本来源判断。
- `frontend/lib/platform-display.ts`：平台稳定键到面向用户名称的统一转换，最近档案和详情卡片共用。
- `frontend/lib/media-image.ts`：媒体源封面地址规范化与后端图片代理地址生成。
- `frontend/lib/transcribe-settings.ts`：转写设置选项、平台默认值和说话人模板。
- `frontend/lib/mock-data.ts`：前端兜底推荐内容数据。

## 前端组件地图

- `frontend/components/LandingHero.tsx`：未解析首页和 URL 输入入口。
- `frontend/components/UrlInput.tsx`：工作台顶部 URL 输入。
- `frontend/components/RecentLibrary.tsx`：最近解析列表、本地历史打开、删除、清空、加载更多。
- `frontend/components/VideoPreviewCard.tsx`：媒体预览卡片。
- `frontend/components/FormatSelector.tsx`：格式列表和下载入口。
- `frontend/components/AiTabs.tsx`：总结、导图、问答、原文 Tab 容器。
- `frontend/components/SummaryTab.tsx`：结构化总结展示。
- `frontend/components/SafeMarkdown.tsx`：结构化分析使用的安全轻量 Markdown 渲染。
- `frontend/components/MindmapTab.tsx`：markmap 树状导图展示。
- `frontend/components/QaTab.tsx`：内容问答。
- `frontend/components/TranscriptTab.tsx`：内容文本、平台字幕、Shownotes、AI 转写稿和导出。
- `frontend/components/TranscribeRequiredState.tsx`：总结、导图、问答和内容文本缺少真实转写稿时共用的生成入口。
- `frontend/components/TranscribeSettingsPanel.tsx`：生成转写稿前的节目结构、内容标签和说话人辅助设置。
- `frontend/components/TranscribeSettingsDialog.tsx`：所有生成 AI 转写稿入口共用的转写设置确认弹窗。
- `frontend/components/TranscribeTaskToasts.tsx`：解析、总结、转写后台任务提示。
- `frontend/components/Header.tsx`：顶部导航和品牌区。
- `frontend/hooks/use-library-processing-workflows.ts`：转写与自动总结期间的统一“处理中”标记、当前标签页刷新恢复和会话清理。

## 后端入口

- `backend/app/main.py`：FastAPI 应用入口；注册所有 API 路由、错误处理、CORS、URL 规范化和接口编排。
- `backend/app/schemas.py`：Pydantic 请求 / 响应模型。
- `backend/app/demo_data.py`：Demo 数据读取。
- `backend/requirements.txt`：Python 依赖。
- `backend/tests/`：后端单测。
- `scripts/prepare-local-asr.ps1`：一次安装本地转写依赖并预下载 Whisper、SenseVoiceSmall 和 FSMN-VAD。
- `scripts/prefetch-asr-models.py`：固定模型目标和预下载实现，可用 `--plan-only` 只查看清单。

## 后端服务地图

- `backend/app/services/media_source_service.py`：媒体源 Adapter 分发入口；当前按抖音、小宇宙、B 站、小红书、默认 yt-dlp 的顺序分派。
- `backend/app/services/ytdlp_service.py`：默认视频源元数据解析、格式标准化、下载。
- `backend/app/services/bilibili_service.py`：B 站专用认证状态、播放流、转写源和下载链路。
- `backend/app/services/douyin_service.py`：抖音公开链接实验解析和专用下载。
- `backend/app/services/xiaohongshu_service.py`：小红书公开视频 URL 识别、yt-dlp 元数据复用、公开作者、清晰封面和转写媒体源补齐。
- `backend/app/services/demo_cover_service.py`：推荐内容封面解析；稳定封面直接复用，临时签名封面按需刷新。
- `backend/app/services/xiaoyuzhou_service.py`：小宇宙公开单集 RSS / 网页解析。
- `backend/app/services/transcript_service.py`：平台字幕和 VTT/SRT 字幕解析。
- `backend/app/services/asr_service.py`：本地 Whisper 与 SenseVoiceSmall 分流、模型 fallback、耗时元数据和双稿串联。
- `backend/app/services/sensevoice_service.py`：本地 SenseVoiceSmall、ffmpeg 规范化、FSMN-VAD 长音频识别和时间戳映射。
- `backend/app/services/transcript_segment_service.py`：按停顿、标点、时长和字符数规范化 ASR 相邻碎片；当前用于 Whisper 校对前整理。
- `backend/app/services/transcribe_context_service.py`：转写上下文规范化与 DeepSeek 校对上下文生成；生产 Whisper 目前保持中性解码。
- `backend/app/services/correction_term_service.py`：本地 AI 校对术语库、文件夹、一次性旧词迁移和使用统计。
- `backend/app/services/transcript_correction_service.py`：DeepSeek ASR 转写稿自动校对，失败时回退原始稿。
- `backend/app/services/summarize_service.py`：DeepSeek 结构化总结和本地 fallback。
- `backend/app/services/qa_service.py`：内容文本问答和本地 fallback。
- `backend/app/services/deepseek_client.py`：DeepSeek OpenAI-compatible 客户端。
- `backend/app/services/library_service.py`：SQLite 本地内容库。
- `backend/app/services/rate_limit_service.py`：本地请求频控。
- `backend/app/services/http_fetch_service.py`：统一公开 HTTP(S) 抓取。
- `backend/app/services/obsidian_export_service.py`：Obsidian Markdown 导出。
- `backend/app/services/text_normalization_service.py`：文本清理和规范化。

## 常见任务定位

- 改首页 UI：先读 `frontend/app/page.tsx`、`frontend/components/LandingHero.tsx`、`frontend/components/RecentLibrary.tsx`。
- 改解析流程：先读 `backend/app/main.py` 的 `POST /api/parse`，再读 `backend/app/services/media_source_service.py`。
- 改 B 站：先读 `docs/architecture/bilibili-service.md`，再读 `backend/app/services/bilibili_service.py`、`backend/app/services/transcript_service.py`。
- 改抖音：先读 `docs/architecture/v0-4-douyin-adapter.md`，再读 `backend/app/services/douyin_service.py`。
- 改小红书：先读 `docs/architecture/xiaohongshu-public-video.md`，再读 `backend/app/services/xiaohongshu_service.py`、`backend/app/services/media_source_service.py`、`frontend/components/TranscribeRequiredState.tsx` 和 `frontend/lib/platform-display.ts`。
- 改小宇宙：先读 `docs/plans/2026-05-10-xiaoyuzhou-podcast-source.md`，再读 `backend/app/services/xiaoyuzhou_service.py`。
- 改总结 / 导图：先读 `frontend/components/SummaryTab.tsx`、`frontend/components/MindmapTab.tsx`、`backend/app/services/summarize_service.py`。
- 改 QA：先读 `frontend/components/QaTab.tsx`、`backend/app/services/qa_service.py`。
- 改 AI 转写稿：先读 `frontend/components/TranscriptTab.tsx`、`frontend/components/TranscribeSettingsPanel.tsx`、`frontend/components/TranscribeTaskToasts.tsx`、`frontend/lib/transcribe-settings.ts`、`backend/app/services/asr_service.py`、`backend/app/services/sensevoice_service.py`、`backend/app/services/transcribe_context_service.py`、`backend/app/services/transcript_correction_service.py`。
- 改 AI 校对术语：先读 `frontend/components/CorrectionTermSelector.tsx` 和 `backend/app/services/correction_term_service.py`；`docs/asr-glossary.md` 只负责首次初始化种子。
- 改本地历史：先读 `frontend/components/RecentLibrary.tsx`、`backend/app/services/library_service.py`。
- 改 Obsidian 导出：先读 `docs/plans/2026-06-12-obsidian-note-workflow-prd.md`、`backend/app/services/obsidian_export_service.py`。
- 改启动器：先读 `启动网站.bat`、`scripts/launch-site.ps1`、`scripts/wait-for-url.ps1`。
- 改公开安装说明：先读 `README.md`、`docs/installation.md`、`docs/configuration.md`、`docs/troubleshooting.md`。
- 改 Obsidian 兼容说明：先读 `docs/obsidian-export.md`、`backend/app/services/obsidian_export_service.py`。
- 改开源发布检查：先读 `SECURITY.md`、`CONTRIBUTING.md`、`.github/workflows/ci.yml`、`scripts/check-public-release.ps1`。

## 不要优先搜索的内容

- `frontend/node_modules/`：前端依赖。
- `backend/data/`：本地 SQLite、下载文件、调试音视频等运行数据。
- `backend/**/__pycache__/`：Python 缓存。
- `*.log`：运行日志。
- `*.tsbuildinfo`：TypeScript 增量编译缓存。
- 上级目录 `private/`：本地工具、Cookie、缓存，不是业务代码。
