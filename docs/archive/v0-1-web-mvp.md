# V0.1 Web MVP 技术架构说明

> 历史存档：本文记录 2026-05 的初版设计，包含已移除的组件与旧行为。当前实现请从 [文档导航](../README.md) 和 [代码地图](../code-map.md) 进入。

> **文档目的**：帮助后续 Agent 或开发者快速理解 V0.1 Web MVP 的结构、红线、改动入口和当前状态。
>
> **最后更新**：2026-05-10
>
> **当前补充**：项目已进入 V0.2，本文件保留 V0.1 主干说明；V0.2 本地内容库详见 `docs/architecture/v0-2-local-library.md`。

---

## 一、整体概览

### 1.1 功能目标

- V0.1 先完成 localhost 可演示闭环：打开首页、输入 URL 或点击 Demo、查看解析后工作台。
- 当前已接入 `POST /api/parse` 的真实解析第一阶段：URL 校验、yt-dlp 元数据解析、格式列表标准化、VTT/SRT 字幕预览。
- 当前已接入 `POST /api/summarize` 的 DeepSeek 结构化总结骨架：基于现有 `transcript.plain_text` 生成 `summary` 与 `mindmap_markdown`；未配置 Key 或调用失败时返回本地 fallback。
- 首页未解析态和解析后工作台是两个不同阶段，不应混在首屏。

### 1.2 文件地图

```text
frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── Header.tsx
│   ├── LandingHero.tsx
│   ├── UrlInput.tsx
│   ├── DemoButtons.tsx
│   ├── VideoPreviewCard.tsx
│   ├── FormatSelector.tsx
│   ├── AiTabs.tsx
│   ├── SummaryTab.tsx
│   ├── MindmapTab.tsx
│   ├── QaTab.tsx
│   └── TranscriptTab.tsx
└── lib/
    ├── api.ts
    ├── mock-data.ts
    └── types.ts

backend/
├── app/
│   ├── main.py
│   ├── schemas.py
│   ├── demo_data.py
│   └── services/
│       ├── ytdlp_service.py
│       ├── transcript_service.py
│       ├── summarize_service.py
│       └── library_service.py
└── data/
    └── demo_seed.json

scripts/
├── launch-site.ps1
└── wait-for-url.ps1
```

### 1.3 核心入口

- `frontend/app/page.tsx`：状态中枢。
- `frontend/components/LandingHero.tsx`：未解析首页。
- `frontend/components/Header.tsx`：品牌导航与回首页动作。
- `backend/app/main.py`：后端 API，包含 health、demo、parse。
- `backend/app/services/ytdlp_service.py`：真实 URL 元数据解析、格式标准化和 parse 响应组装。
- `backend/app/services/transcript_service.py`：字幕候选选择、字幕下载、VTT/SRT 解析和纯文本生成。
- `backend/app/services/summarize_service.py`：DeepSeek 总结调用、本地 fallback、JSON 结果解析。
- `backend/app/services/library_service.py`：V0.2 SQLite 本地内容库，保存真实解析记录和总结结果。

---

## 二、核心结构

### 2.1 主要组件 / 模块

- `Header`：显示固定 logo、品牌名“知录”、导航与本地状态。左上品牌区点击触发回首页。
- `LandingHero`：首屏入口包含横向 slogan、URL 输入框和三条随项目提供的精选内容。
- `UrlInput`：解析后工作台顶部 URL 输入区。
- `DemoButtons`：解析后工作台的 Demo 切换入口。
- `VideoPreviewCard`：左侧视频元数据卡。
- `FormatSelector`：格式展示区，下载动作仍是占位。
- `AiTabs`：右侧 Tab 容器，当前有 AI 总结、思维导图、内容问答、字幕原文。
- `SummaryTab`：显示总结内容，并提供“生成总结”按钮调用 `POST /api/summarize`。
- `QaTab`：当前仍是 V0.3 问答占位，但已预留“快速 / 思考”模式入口，分别对应 `deepseek-v4-flash` 与 `deepseek-v4-pro`。
- `apiClient`：封装后端 health/demo 请求，后端不可用时前端使用 `mock-data.ts` 兜底。
- `ytdlp_service`：使用 yt-dlp `download=False` 获取公开 URL 元数据和格式候选，不下载视频文件。
- `transcript_service`：优先选择 `zh-Hans / zh-CN / zh / zh-Hant / en` 字幕，当前支持 VTT/SRT 解析，失败时返回可展示的占位字幕提示。
- `summarize_service`：优先读取 `DEEPSEEK_API_KEY` 调用 DeepSeek OpenAI-compatible `/chat/completions`；未配置 Key 或 AI 调用失败时返回本地结构化 fallback，保证 localhost 演示可继续。
- `library_service`：使用 `backend/data/local_library.sqlite3` 保存真实 URL 解析结果，并支持最近解析列表和历史详情打开。

### 2.2 数据流 / 状态流 / 调用链

```text
页面初始加载
→ page.tsx 请求 /api/health 和 /api/demo
→ 失败则使用前端 mockDemos
→ 未解析态显示 LandingHero

点击 Demo
→ handleLoadDemo(demoId)
→ 优先请求 /api/demo/{demo_id}
→ 失败或超时则读取 mockDemoDetails
→ status = parsed
→ 显示 UrlInput + DemoButtons + VideoPreviewCard + FormatSelector + AiTabs

输入真实 URL
→ handleAnalyze()
→ apiClient.parseVideo(url)，前端最多等待 45 秒
→ POST /api/parse
→ 后端校验 URL
→ yt-dlp 提取 metadata / formats / subtitles
→ transcript_service 选择并解析 VTT/SRT 字幕
→ 返回 ParseResponse
→ status = parsed
→ 显示真实元数据、格式列表、字幕预览和 AI 总结占位

点击生成总结
→ handleSummarize()
→ apiClient.summarizeVideo({ transcript_plain_text, video_title, video_author, source_url })
→ POST /api/summarize
→ 后端读取 DEEPSEEK_API_KEY
→ 有 Key 时调用 DeepSeek 生成 JSON 结构化总结
→ 无 Key 或失败时返回本地 fallback
→ 前端只替换当前 detail.summary 和 detail.mindmap_markdown

点击左上品牌区
→ handleGoHome()
→ 清空 detail / activeDemoId / loadingDemoId / url / errorMessage
→ status = idle
→ 回到 LandingHero
```

### 2.3 关键设计说明

- 首页最大 slogan 当前为：`看视频前，先把重点拿到手`。
- 当前品牌名为：`知录`。
- logo 当前已被用户明确要求“定死不要动”。
- 首页流程区不是纯营销，要贴合当前能力边界：公开媒体入口、文本取得、结构化整理与本地 Markdown 沉淀。

---

## 三、绝对不能动的红线

| 区域 | 文件 / 模块 | 原因 |
|------|-------------|------|
| 品牌 logo | `Header.tsx` 中左上 logo 结构 | 用户已明确要求 logo 定死不要动 |
| 品牌名 | `Header.tsx`、`layout.tsx`、首页文案 | 已升级为“知录” |
| 首屏状态 | `page.tsx`、`LandingHero.tsx` | 用户要求用户刚进入时不应像已进入读取识别阶段 |
| AI Key | 后端 `.env.example` | 只能占位，不得写死真实密钥 |
| 真实 AI Key | `backend/.env` | 只能本地保存，禁止写入文档、前端或 `.env.example` |
| 合规边界 | 首页说明、README、后续解析逻辑 | 不处理 DRM、付费、私密或受限内容 |

---

## 四、允许改动的入口

- 首页视觉细节：`LandingHero.tsx`。
- 导航文案和非 logo 区域：`Header.tsx`。
- 解析后工作台布局：`VideoPreviewCard.tsx`、`FormatSelector.tsx`、`AiTabs.tsx` 及各 Tab。
- Demo 文案和数据：`frontend/lib/mock-data.ts` 与 `backend/data/demo_seed.json`，两边需保持一致。
- API 接入：先扩展 `backend/app/main.py` 和 `frontend/lib/api.ts`，再让 `page.tsx` 调用。
- AI 总结服务：优先在 `backend/app/services/summarize_service.py` 扩展，不要把 DeepSeek prompt、fallback 和 JSON 解析堆回 `main.py`。
- 解析服务：优先在 `backend/app/services/ytdlp_service.py` 和 `backend/app/services/transcript_service.py` 内扩展，不要把复杂解析逻辑堆回 `main.py`。

---

## 五、当前实现状态

### 5.1 已完成

- monorepo 结构：`frontend/` + `backend/`。
- 前端依赖与基础配置。
- 后端 FastAPI health/demo 接口。
- 前端 Demo fallback。
- 未解析首页和解析后工作台分离。
- 品牌区点击回首页。
- Windows 启动器 `启动网站.bat`。
- 首页 UI 已多轮调整为偏实用高级感。
- `POST /api/parse` 骨架和前端接入。
- yt-dlp 元数据解析和格式列表标准化。
- VTT/SRT 字幕候选选择、下载、解析和 Transcript Tab 展示。
- 前端 API 请求超时兜底，避免 Demo 或真实 URL 一直 loading。
- CORS 同时允许 `localhost:3000` 与 `127.0.0.1:3000`。
- 后端 yt-dlp 解析已加入子进程硬超时、平台拒绝错误分类和 `PLATFORM_REJECTED` 窄范围重试，避免 B 站 412 等波动拖死后端。
- `POST /api/summarize` 已接入：支持 DeepSeek 结构化总结、本地 fallback、前端“生成总结”按钮。
- DeepSeek 本地配置已支持 `DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_MAX_TOKENS`、`DEEPSEEK_THINKING_TYPE`、`DEEPSEEK_REASONING_EFFORT`。
- `QaTab` 已增加“快速 / 思考”模式入口，但真实 QA 请求仍未接入。
- V0.2 已新增 SQLite 本地内容库、最近解析列表、历史详情打开和总结结果写回。

### 5.2 待处理

- DeepSeek 总结真实效果验证与错误态优化。
- 基础频控。
- QA 真实问答。
- 真实下载任务。
- 抖音实验 Adapter。
- 浏览器插件捕获模式。

### 5.3 风险 / 注意事项

- 当前未运行自动测试或浏览器验证，后续如用户明确要求再做。
- 前端 `npm install` 曾提示 2 个中等级别依赖审计问题，尚未处理，避免破坏性升级。
- 后端当前只读本地 JSON，不要误认为已经有数据库。
- 真实解析依赖外部平台和 yt-dlp，可能慢、失败或返回无字幕；必须继续保持“失败不空白、无字幕有提示、外部服务不阻塞 Demo”的产品策略。
- B 站解析可能间歇性触发 `HTTP 412` 平台拒绝；当前只做有限重试和清晰错误提示，不承诺全平台稳定解析。
- DeepSeek 真实调用依赖本地 `backend/.env` 和后端重启；文档中不得出现真实 API Key。
- 用户最近反馈 Demo 或 URL 解析可能一直转圈，本轮已加前端请求超时与 CORS 双来源兜底，但尚未由用户完成手动验证。
