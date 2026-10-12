# 代码定位地图

> 目的：给后续 Codex 或开发者快速定位代码。先读本文件，再按任务读取具体模块。

## 代码根目录

本文件以 Git 仓库根目录为起点，所有命令也从仓库根目录执行。本机的仓库文件夹名是 `ai-video-insight-workspace`，从 GitHub 克隆后可以叫 `zhilu`，不依赖固定文件夹名。

```text
<仓库根目录>/
```

日常开发直接打开 Git 仓库根目录。本机工具、凭据和浏览器资料集中在被忽略的 `.local/`，源码与默认运行路径不依赖仓库上级目录。

## 先读顺序

1. `docs/code-map.md`：当前这份快速定位地图。
2. `docs/README.md` 与相关 `docs/architecture/*.md`：公开文档导航和模块架构；留意文档中标明的历史设计。
3. 前后端具体代码与相关测试：核实当前实现。
4. `docs/project-context.md`、`docs/handoffs/*.md`（本地存在时）：本机说明与历史阶段交接，仅按需补充；公开仓库不依赖这些文件。

## 常用快速搜索命令

PowerShell 里涉及中文输出时，先设置当前会话 UTF-8：

```powershell
[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
chcp 65001 | Out-Null
```

列出业务文件：

```powershell
rg --files . `
  -g '!**/node_modules/**' `
  -g '!**/data/**' `
  -g '!**/__pycache__/**' `
  -g '!*.log' `
  -g '!*.tsbuildinfo'
```

搜索代码关键词：

```powershell
rg "关键词" . `
  -g '!**/node_modules/**' `
  -g '!**/data/**' `
  -g '!**/__pycache__/**' `
  -g '!*.log' `
  -g '!*.tsbuildinfo'
```

只搜前端：

```powershell
rg "关键词" frontend `
  -g '!**/node_modules/**' `
  -g '!*.tsbuildinfo'
```

只搜后端：

```powershell
rg "关键词" backend `
  -g '!**/data/**' `
  -g '!**/__pycache__/**' `
  -g '!*.log'
```

## 顶层目录职责

```text
<仓库根目录>/
├── frontend/   Next.js + React + TypeScript + Tailwind 前端
├── backend/    FastAPI + Pydantic 后端
├── docs/       使用指南、架构、示例与历史存档（导航见 docs/README.md）
├── assets/     README 插图与当前版本截图
├── .github/    GitHub Actions、Issue 与 PR 模板
├── scripts/    Windows 启动、配置、模型准备与发布检查
├── evaluation/ 本地历史评测证据，不随 Git 分发
├── .local/     本机工具、凭据、浏览器资料，不随 Git 分发
├── output/     可再生成的调试输出，不随 Git 分发
└── 启动网站.bat
```

## 前端入口

- `frontend/app/page.tsx`：页面组装入口，按当前状态展示首页、任务页或工作台及弹窗。
- `frontend/hooks/use-workbench-controller.ts`：组合内容库、持久任务、总结和转写流程，管理当前详情、导航与结果同步。
- `frontend/components/WorkspaceViews.tsx`：首页与详情工作台的布局组合。
- `frontend/app/layout.tsx`：Next.js 根布局。
- `frontend/app/globals.css`：全局样式。
- `frontend/lib/api.ts`：前端请求后端 API 的封装。
- `frontend/lib/types.ts`：前端核心类型。
- `frontend/lib/media.ts`：媒体类型和文本来源判断。
- `frontend/lib/platform-display.ts`：平台稳定键到面向用户名称的统一转换，最近档案和详情卡片共用。
- `frontend/lib/media-image.ts`：媒体源封面地址规范化与后端图片代理地址生成。
- `frontend/lib/transcribe-settings.ts`：转写设置选项、平台默认值和说话人模板。
- `backend/data/demo_seed.json`：首页快速体验使用的公开推荐内容，前端通过 Demo API 读取。

## 前端组件地图

- `frontend/components/LandingHero.tsx`：未解析首页和 URL 输入入口。
- `frontend/components/UrlInput.tsx`：工作台顶部 URL 输入。
- `frontend/components/RecentLibrary.tsx`：最近解析列表、本地历史打开、删除、清空、加载更多。
- `frontend/components/VideoPreviewCard.tsx`：媒体预览卡片。
- `frontend/components/FormatSelector.tsx`：格式列表和下载入口。
- `frontend/components/AiTabs.tsx`：总结、导图、问答、原文 Tab 容器；持有共享的“我的整理”状态和稳定导出入口。
- `frontend/components/SummaryTab.tsx`：结构化总结、观点原文依据预览／固定面板和就地追问入口。
- `frontend/components/SafeMarkdown.tsx`：结构化分析使用的安全轻量 Markdown 渲染。
- `frontend/components/MindmapTab.tsx`：markmap 树状导图展示。
- `frontend/components/QaTab.tsx`：内容问答。
- `frontend/components/TranscriptTab.tsx`：内容文本、平台字幕、Shownotes、AI 转写稿和“我的整理”。
- `frontend/components/TranscriptNoteWorkflow.tsx`：我的整理、AI 候选、编辑与保存状态展示。
- `frontend/components/TranscribeRequiredState.tsx`：总结、导图、问答和内容文本缺少真实转写稿时共用的生成入口。
- `frontend/components/TranscribeSettingsPanel.tsx`：生成转写稿前的节目结构、内容标签和说话人辅助设置。
- `frontend/components/TranscribeSettingsDialog.tsx`：所有生成 AI 转写稿入口共用的转写设置确认弹窗。
- `frontend/components/TranscribeTaskToasts.tsx`：解析、总结、转写后台任务提示。
- `frontend/components/BatchAddDialog.tsx`：多链接提取、去重和可展开的处理设置，统一提交内容提炼任务。
- `frontend/components/BatchWorkspace.tsx`：批次统计、最近批次、任务筛选、单项取消/重试与结果回看。
- `frontend/components/Header.tsx`：顶部导航和品牌区。
- `frontend/hooks/use-library-processing-workflows.ts`：转写与自动总结期间的统一“处理中”标记、当前标签页刷新恢复和会话清理。
- `frontend/hooks/use-task-workspace.ts`：批次提交、任务状态、URL 恢复和单项操作。
- `frontend/hooks/use-batch-polling.ts`：单条与批量共用的快照轮询与退出清理。
- `frontend/hooks/use-task-result-sync.ts`：只同步当前正在阅读的任务结果，丢弃失效响应。
- `frontend/hooks/use-processing-recovery.ts`：刷新后恢复显式转写与总结工作流。
- `frontend/hooks/use-workbench-controller.ts`：首页、详情和任务的主控制器；单条提炼提交持久任务后在后台执行，仅同步用户当前查看的内容，不自动切换详情。
- `frontend/hooks/use-transcript-note-workflow.ts`：我的整理的单一前端状态、自动保存、立即导出一致性和 Markdown 下载。

## 后端入口

- `backend/app/main.py`：FastAPI 组装入口；仅负责生命周期、路由注册、统一错误处理与 CORS。
- `backend/app/routers/`：按媒体解析下载、分析、内容库、术语、服务状态与任务划分 HTTP 接口。
- `backend/app/config.py`：加载后端环境文件与应用配置。
- `backend/app/paths.py`：仓库、数据目录与数据库路径的唯一来源。
- `backend/app/database.py`：SQLite 连接与事务管理；各业务服务保留表结构。
- `backend/app/schemas.py`：Pydantic 请求 / 响应模型。
- `backend/app/demo_data.py`：Demo 数据读取。
- `backend/requirements.txt`：Python 依赖。
- `backend/requirements-dev.txt`：开发与 CI 依赖，包含运行依赖及接口测试客户端。
- `backend/tests/`：后端单测。
- `scripts/prepare-local-asr.ps1`：一次安装本地转写依赖并预下载 SenseVoiceSmall 和 FSMN-VAD。
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
- `backend/app/services/asr_service.py`：本地 SenseVoiceSmall 识别编排、耗时元数据和原始稿／校对稿串联。
- `backend/app/services/sensevoice_service.py`：本地 SenseVoiceSmall、ffmpeg 规范化、FSMN-VAD 长音频识别和时间戳映射。
- `backend/app/services/transcript_segment_service.py`：按停顿、标点、时长和字符数规范化 SenseVoice 相邻碎片，整理校对输入并保留原始句段。
- `backend/app/services/transcribe_context_service.py`：转写上下文规范化与 DeepSeek 校对上下文生成；不把人物或术语注入原始语音识别。
- `backend/app/services/correction_term_service.py`：本地 AI 校对术语库、文件夹、一次性旧词迁移和使用统计。
- `backend/app/services/transcript_correction_service.py`：DeepSeek ASR 转写稿自动校对，失败时回退原始稿。
- `backend/app/services/transcript_identity_service.py`：当前有效转写稿指纹、稳定片段标识和总结证据关联。
- `backend/app/services/summarize_service.py`：DeepSeek 结构化总结和本地 fallback。
- `backend/app/services/qa_service.py`：内容文本问答和本地 fallback。
- `backend/app/services/deepseek_client.py`：DeepSeek OpenAI-compatible 客户端。
- `backend/app/services/library_service.py`：SQLite 本地内容库。
- `backend/app/services/rate_limit_service.py`：本地请求频控。
- `backend/app/services/http_fetch_service.py`：统一公开 HTTP(S) 抓取。
- `backend/app/services/obsidian_export_service.py`：Obsidian Markdown 导出。
- `backend/app/services/text_normalization_service.py`：文本清理和规范化。
- `backend/app/services/task_store.py`：批次、任务、关联、幂等、容量和检查点的 SQLite 存储。
- `backend/app/services/task_runner.py`：单进程有界调度、阶段恢复、取消和资源编排。
- `backend/app/services/processing_service.py`：持久任务的处理阶段，以及与兼容 API 共用的元数据合并和转写源选择。
- `backend/app/routers/tasks.py`：批量任务 HTTP API。
- `docs/architecture/batch-processing.md`：多视频批量处理的状态、资源和恢复合同。

## 常见任务定位

- 改首页 UI：先读 `frontend/app/page.tsx`、`frontend/components/LandingHero.tsx`、`frontend/components/RecentLibrary.tsx`。
- 改解析流程：先读 `backend/app/routers/media.py` 的 `POST /api/parse`，再读 `backend/app/services/media_source_service.py`。
- 改 B 站：先读 `docs/architecture/bilibili-service.md`，再读 `backend/app/services/bilibili_service.py`、`backend/app/services/transcript_service.py`。
- 改抖音：先读 `docs/architecture/douyin-adapter.md`，再读 `backend/app/services/douyin_service.py`。
- 改小红书：先读 `docs/architecture/xiaohongshu-public-video.md`，再读 `backend/app/services/xiaohongshu_service.py`、`backend/app/services/media_source_service.py`、`frontend/components/TranscribeRequiredState.tsx` 和 `frontend/lib/platform-display.ts`。
- 改小宇宙：先读 `backend/app/services/xiaoyuzhou_service.py` 和 `backend/tests/test_xiaoyuzhou_service.py`；本地计划仅作补充。
- 改总结 / 导图：先读 `frontend/components/SummaryTab.tsx`、`frontend/components/MindmapTab.tsx`、`backend/app/services/summarize_service.py`。
- 改 QA：先读 `frontend/components/QaTab.tsx`、`backend/app/services/qa_service.py`。
- 改 AI 转写稿：先读 `frontend/components/TranscriptTab.tsx`、`frontend/components/TranscribeSettingsPanel.tsx`、`frontend/components/TranscribeTaskToasts.tsx`、`frontend/lib/transcribe-settings.ts`、`backend/app/services/asr_service.py`、`backend/app/services/sensevoice_service.py`、`backend/app/services/transcribe_context_service.py`、`backend/app/services/transcript_correction_service.py`。
- 改 AI 校对术语：先读 `frontend/components/CorrectionTermSelector.tsx` 和 `backend/app/services/correction_term_service.py`；`docs/asr-glossary.md` 只负责首次初始化种子。
- 改本地历史：先读 `frontend/components/RecentLibrary.tsx`、`backend/app/services/library_service.py`。
- 改批量处理：先读 `docs/architecture/batch-processing.md`，再读 `backend/app/services/task_store.py`、`task_runner.py`、`frontend/hooks/use-task-workspace.ts` 和 `frontend/components/BatchWorkspace.tsx`。
- 改 Obsidian 导出：先读 `docs/architecture/obsidian-note-workflow.md`、`backend/app/services/obsidian_export_service.py`。
- 改启动器：先读 `启动网站.bat`、`scripts/launch-site.ps1`。
- 改公开安装说明：先读 `README.md`、`docs/installation.md`、`docs/configuration.md`、`docs/troubleshooting.md`。
- 改 Obsidian 兼容说明：先读 `docs/obsidian-export.md`、`backend/app/services/obsidian_export_service.py`。
- 改开源发布检查：先读 `SECURITY.md`、`CONTRIBUTING.md`、`.github/workflows/ci.yml`、`scripts/check-public-release.ps1`。

## 测试地图

- `backend/tests/`：按业务服务和 API 行为组织的隔离回归测试。
- `frontend/lib/*.test.ts`：无副作用的转换、筛选和恢复辅助逻辑。
- `frontend/e2e/support.ts`：共享合成数据、API mock 和浏览器错误捕获。
- `frontend/e2e/{library,task-submission,task-workflows,transcription,workbench}.spec.ts`：内容库、任务提交、处理恢复、转写与阅读整理场景。

E2E 使用模拟 API，不证明真实平台或付费 AI 服务可用。

## 不要优先搜索的内容

- `frontend/node_modules/`：前端依赖。
- `backend/data/`：本地 SQLite、下载文件、调试音视频等运行数据。
- `backend/**/__pycache__/`：Python 缓存。
- `*.log`：运行日志。
- `*.tsbuildinfo`：TypeScript 增量编译缓存。
- `.local/`：本机工具、凭据与浏览器资料。
- `output/`、`.playwright-cli/`：调试产物。
- `evaluation/`：历史评测资料，只有评测任务需要读取。
