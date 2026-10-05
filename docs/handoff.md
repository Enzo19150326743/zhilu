# 当前交接：知录产品体验升级已实施

项目根目录：本文所在 `docs/` 的上一级 `ai-video-insight-workspace/`。当前功能合同见 `docs/architecture/`；本地实施计划作为可选补充，不随公开仓库发布。

## 1. 当前状态

- 2026-09-18 已完成产品体验升级的本地实现、合成浏览器验收和文档同步；提交与同步状态以 Git 当前记录和远端分支为准。
- 2026-10-04 修复单条任务保存转写稿时的 SQLite 锁冲突；长稿转换移到事务外，转写、总结和“我的整理”保存提前取得写入权限。
- 默认主路径现在是“提炼内容”：单条复用服务端持久任务并在解析出 `video_id` 后直接进入详情，多条进入现有批量视图；旧解析、转写、总结 API 继续兼容。
- 总结草稿升级为 `1.2`。关键观点可保存经后端校验的当前转写片段标识、原文摘录和转写指纹；文本变化后旧证据不会继续显示。
- 总结默认优先一句话结论、关键观点、理由、方法与条件；内容脉络和辅助分析按需出现。本地 fallback 明确标为基础摘要。
- “我的整理”使用单一前端状态，保留历史 `note_draft` 数据结构。导出入口在所有详情 Tab 可见，立即导出会等待／补做最新保存；未确认 AI 候选不导出。
- 观点可查看原文依据并固定到桌面侧栏；390px 窄屏使用底部面板。点击“追问这条”会把观点语境带入现有问答，并区分作者表达与 AI 推导。
- 首页、详情、批量页、字体、边框、阴影、焦点与按压反馈已统一；大封面和下载信息收进“来源与下载”，总结／问答居中，原文／导图保持宽幅。

## 2. 主要实现入口

- 总结与证据：`backend/app/services/summarize_service.py`、`transcript_identity_service.py`、`backend/app/schemas.py`、`frontend/components/SummaryTab.tsx`。
- 我的整理与导出：`frontend/hooks/use-transcript-note-workflow.ts`、`frontend/components/AiTabs.tsx`、`TranscriptNoteWorkflow.tsx`、`backend/app/services/obsidian_export_service.py`。
- 单条／批量任务：`frontend/hooks/use-task-workspace.ts`、`use-workbench-controller.ts`、`frontend/components/BatchAddDialog.tsx`、`BatchWorkspace.tsx`。
- 页面与视觉：`frontend/components/WorkspaceViews.tsx`、`LandingHero.tsx`、`UrlInput.tsx`、`frontend/app/globals.css`。
- 架构现状：`docs/architecture/universal-knowledge-draft.md`、`obsidian-note-workflow.md`、`batch-processing.md`、`v0-3-ai-workbench.md`、`docs/code-map.md`。

## 3. 已执行检查

- 2026-10-05 后端：`174` 个 unittest 全部通过，包含单条长稿与真实调度器、数据库并发保存的回归验证；识别和 AI 请求使用测试替身。
- 2026-10-05 前端 helper：`27` 个全部通过。
- 2026-10-05 Next.js 生产构建：通过。
- 2026-09-18 Playwright desktop Chromium：`14` 个 E2E 全部通过，包含单条持久任务、观点依据与就地追问、编辑后立即导出；本次同步未重跑浏览器验收。
- 2026-09-18 合成浏览器检查：1440px 首页、1280px 总结／依据侧栏、390px 原文／我的整理和依据底部面板；390px `scrollWidth === innerWidth`，控制台 `0` error。
- `git diff --check`：通过。
- 2026-10-05 `scripts/check-public-release.ps1`：通过。9 份内部计划取消 Git 跟踪并保留本地文件，沿用已有忽略规则；合成测试任务 ID 不再误触发密钥扫描。

合成截图位于 `output/playwright/experience-upgrade-*.png`；README 的首页、总结和原文截图已替换为不含私人数据的合成资料。

## 4. 未验证边界

- 未调用真实付费 AI，因此只能确认提示词、解析、证据校验和展示链路已实现，不能声称真实生成质量已完成新旧对比。
- 未重新调用真实平台下载／转写，也未写入真实 Obsidian Vault；现有平台稳定性、ASR 质量和付费服务可用性不由 mock 与构建证明。
- 代码同步不代表真实付费流程或新增模型质量已验证，也不代表已经部署网站。
