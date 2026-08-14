# 通用知识草稿技术架构说明

> 文档目的：记录知录最终 AI 总结与 Markdown 草稿的稳定合同、兼容策略和个人化边界。
> 最后更新：2026-07-14

## 一、模块概览

- 功能目标：把单个媒体来源转换为不依赖特定用户背景的通用知识草稿。
- 核心入口：`POST /api/summarize` 生成结构化总结，`POST /api/exports/obsidian-note` 生成通用 Markdown。
- 当前草稿版本：`1.1`。

第一阶段只负责提取来源中的事实、观点、结构、可靠摘录、通用应用线索和证据边界。个人价值观、创作风格、长期目标、选题判断和固定 Obsidian 页面由后续个人数字分身阶段处理。

## 二、文件地图

- `backend/app/services/summarize_service.py`：通用提示词、AI 响应解析、本地 fallback。
- `backend/app/services/obsidian_export_service.py`：版本化 YAML 与通用 Markdown 模板。
- `backend/app/schemas.py`：`VideoSummary` 通用合同及旧字段兼容层。
- `backend/app/main.py`：旧总结可读、新版缓存识别和重新生成入口。
- `backend/app/services/library_service.py`：沿用 SQLite `payload_json` 保存完整工作台数据。
- `frontend/lib/types.ts`：前端可选字段类型兼容，不改变现有 UI 行为。

## 三、核心结构

### 3.1 通用总结合同

- `draft_version`：新结果固定为 `1.1`；旧记录缺失时解析为 `legacy`。
- `summary_profile`：仅用于判断摘要的主表达形态，取值为 information、viewpoint、method、narrative 或 generic；无法可靠判断时回落为 generic。
- `key_points_title`、`content_outline`：让“关键信息 / 核心观点 / 关键方法”等标题和内容脉络随文本变化，而不是固定套用“核心观点”。
- `methods`、`deep_dive_sections`：只有文本中存在明确可复用做法或足够深入依据时才出现；不再生成面向用户的固定行动建议。
- `content_keywords`：只描述当前内容本身。
- `application_clues`、`takeaways`：仅保留为旧 JSON 兼容字段；新结果由 `methods` 表达有文本依据的可借鉴做法。
- `content_boundaries`：文本来源、证据范围、ASR 误差和待核实信息。
- `topics`、`takeaways`、`search_keywords` 继续保留，分别与通用主题、应用线索和关键词保持兼容。
- 旧个人化字段保留默认值以读取历史 JSON，但新提示词与新 Markdown 不消费它们。

### 3.2 数据流

```text
媒体元数据 + 当前内容文本
→ summarize_service 生成 draft_version=1.1 的通用 JSON
→ VideoSummary 校验并写回原有 payload_json.summary
→ 现有前端继续展示 summary / highlights / mindmap
→ obsidian_export_service 读取通用字段和摘录草稿
→ 版本化 YAML + 精简通用 Markdown
```

SQLite 表结构、原始字幕、Whisper 原始稿、校对稿、QA、导图和下载链路均不改变。

### 3.3 Markdown 合同

YAML 必备字段：草稿版本、标题、内容类型、平台、原始作者、源链接、处理日期、内容关键词。已有可靠时长时补充时长；没有稳定发布日期时不编造。

正文由内容动态决定：一句话摘要、关键信息 / 核心观点 / 关键方法、内容脉络、可借鉴的方法、深入解读、可靠原文摘录、内容边界与待核实信息。没有文本依据的模块不输出；默认不附完整逐字稿。

### 3.4 摘录边界

- `note_draft.highlights` 是用户主动加入并可编辑的摘录，进入“可靠原文摘录”。
- `summary.highlights` 是 AI 候选，只能进入“AI 候选摘录（未确认）”。
- 两组摘录按去空白后的正文去重；用户确认版本优先。

## 四、改动边界

- 允许改动：通用提示词、通用总结字段、Markdown 表达和版本升级策略。
- 不要破坏：旧 SQLite JSON 读取、现有 API 路径、前端展示、Raw 文本保存、摘录草稿、导图与 QA。
- 不要回填：用户背景、个人价值判断、固定双链或数字分身目录。
- 第二阶段入口：个人数字分身只读取本阶段的通用草稿和来源证据，再结合用户长期资料生成个人化判断；不得把个人化结果反写成通用事实。
