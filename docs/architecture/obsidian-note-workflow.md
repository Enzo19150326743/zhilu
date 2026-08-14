# Obsidian 摘录工作流架构说明

> 最后更新：2026-07-14

## 一、模块目标

Obsidian 摘录工作流把“知录”的内容理解结果导出为可继续加工的通用 Markdown 知识稿。现有工作台仍负责 AI 候选摘录、正文框选摘录、可编辑摘录草稿、持久化和 Markdown 导出；导出层不再绑定特定用户的数字分身模板。

该模块不是下载器增强，不接 MCP，不做 Obsidian 插件、双链管理、复杂标签系统或向量检索。

## 二、文件地图

```text
backend/app/
├── main.py
├── schemas.py
└── services/
    ├── summarize_service.py
    ├── library_service.py
    └── obsidian_export_service.py

frontend/
├── app/page.tsx
├── components/
│   ├── AiTabs.tsx
│   └── TranscriptTab.tsx
└── lib/
    ├── api.ts
    └── types.ts
```

## 三、数据结构

- `SummaryHighlight`：摘录结构，包含 `id`、`text`、`start`、`end`、`reason`、`tags`、`source`、`source_type`、`created_at`。
- `VideoSummary.highlights`：AI 总结结果里的候选摘录；旧记录缺失该字段时默认为空数组。
- `VideoSummary.draft_version`：新通用草稿固定为 `1.1`；旧记录缺失时解析为 `legacy`。
- `VideoSummary.content_keywords`、`methods`、`content_boundaries`：通用关键词、原内容中有依据的可借鉴方法、来源 / 证据边界。
- `NoteDraft`：当前媒体摘录草稿，包含 `highlights` 和 `updated_at`。
- `ParseResponse.note_draft`：本地历史详情返回时携带摘录草稿。
- SQLite 仍只使用 `library_items.payload_json` 保存完整工作台数据；摘录草稿存放在 `payload_json.note_draft`，不新增独立表。

## 四、核心调用链

AI 候选摘录：

```text
page.tsx / SummaryTab 触发总结
→ POST /api/summarize
→ summarize_service 提示词要求返回 highlights
→ 后端校验候选尽量来自 transcript_plain_text
→ library_service.update_summary_for_source_url 写回 payload_json.summary.highlights
→ TranscriptTab 展示 AI 摘录候选
```

摘录草稿：

```text
TranscriptTab 点击 AI 候选“加入笔记”
或在正文中框选文字后点击浮动“加入摘录”
→ page.tsx.handleSaveNoteDraft
→ PUT /api/library/note-draft
→ library_service.update_note_draft_for_source_url
→ 写回 payload_json.note_draft
→ 前端只更新同 source_url 的当前工作台
```

前端交互约定：

- 手动摘录只从正文框选产生；时间戳、说话人标签和操作按钮不进入摘录正文。
- 平台字幕、AI 转写稿和 shownotes 原文片段不保留右侧整段“加入摘录”按钮，避免误导用户整段沉淀。
- 框选后显示浮动“已选 N 字 · 加入摘录”操作条；选区滚出正文可视区域时操作条隐藏。
- 摘录草稿卡片内的文字可直接编辑，编辑后仍通过 `PUT /api/library/note-draft` 覆盖保存完整 `highlights` 数组。

Obsidian 导出：

```text
TranscriptTab 点击“导出 Obsidian”
→ POST /api/exports/obsidian-note
→ obsidian_export_service 读取本地库 ParseResponse
→ 分开展示 summary.highlights AI 候选摘录与 note_draft.highlights 用户确认摘录
→ 生成通用模板：版本化 YAML + 一句话摘要 + 内容结构 + 核心观点 + 可靠摘录 + 通用应用线索 + 内容边界
→ 不导出模型猜测的发布时间或不可靠时间点
→ 不在主 Markdown 附完整 ASR 逐字稿
→ 未启用 vault 写入时返回 markdown 给前端下载 .md
→ 启用 vault 写入时写入 vault 内部目录
```

## 五、接口

- `PUT /api/library/note-draft`
  - 请求：`source_url`、`highlights`
  - 响应：`note_draft`
  - 行为：按 `source_url` 写回本地历史；B 站 URL 仍复用现有 BVID 兜底查找。

- `POST /api/exports/obsidian-note`
  - 请求：`source_url`、`include_full_text`
  - 响应：`filename`、`written_to_vault`、`file_path`、`markdown`、`message`
  - 行为：默认返回 Markdown；启用 vault 写入时写入本地文件。

## 六、环境变量

```env
OBSIDIAN_ENABLE_VAULT_WRITE=0
OBSIDIAN_VAULT_DIR=
OBSIDIAN_EXPORT_SUBDIR=知录知识稿
```

- `OBSIDIAN_ENABLE_VAULT_WRITE` 默认关闭。
- `OBSIDIAN_VAULT_DIR` 为空或未启用写入时，不写本地文件，只返回 Markdown。
- `OBSIDIAN_EXPORT_SUBDIR` 是 vault 内相对子目录，不允许绝对路径或 `..` 越界；默认写入通用的“知录知识稿”目录。

## 七、边界与红线

- `SummaryHighlight.text` 应尽量来自逐字稿 / 字幕原文，不把 AI 概括伪装成原文引用。
- 手动摘录是用户确认加入草稿的内容，导出时放入“可靠原文摘录”。
- 未加入摘录草稿的 AI 候选只能放入“AI 候选摘录（未确认）”，并与用户确认内容去重。
- 外部作者观点不自动等于用户观点；第一阶段不生成任何个人化判断。
- YAML 只输出稳定的通用元数据，不生成固定双链或个人知识库用途字段。
- 手动摘录入口保持“正文框选 + 浮动按钮”，不要恢复每段右侧整段加入按钮。
- Markdown 文件名必须清洗；同名文件自动追加序号。
- 后端写入前必须确认目标路径位于 vault 目录内部。
- 该模块不改变下载、转写、平台 Adapter 或 B 站取流链路。
- 后续数字分身项目可以消费通用草稿做二次个人化加工，但不得把个人判断反写成来源事实。
- 不继续扩展 Obsidian 插件、MCP、复杂标签、双链或 RAG。
