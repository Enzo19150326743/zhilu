# 知录文档导航

首次使用先看安装与配置；了解当前实现从代码地图进入。README 的产品截图与插图统一放在 [`assets/readme/`](../assets/readme/README.md)。

## 使用指南

| 你要做什么 | 文档 |
|---|---|
| 启动网站、准备本地转写与 GPU | [安装与启动](./installation.md) |
| 配置 AI、下载、转写与术语 | [配置指南](./configuration.md) |
| 下载 Markdown 或写入 Vault | [Obsidian 导出](./obsidian-export.md) |
| 处理启动、平台解析与转写错误 | [常见问题](./troubleshooting.md) |
| 查看导出结构 | [公开合成知识稿](./examples/knowledge-draft.md) |

## 开发与架构

- [产品说明](./product.md)：当前目标、功能规则、数据边界和非目标。
- [代码地图](./code-map.md)：目录职责、模块入口与按任务定位。
- [批量处理](./architecture/batch-processing.md)：持久任务、资源限制、恢复与取消。
- [本地内容库](./architecture/local-library.md)：SQLite 历史与保存合同。
- [AI 工作台](./architecture/ai-workbench.md)：总结、问答、导图与本地转写。
- [通用知识稿](./architecture/universal-knowledge-draft.md)与[我的整理工作流](./architecture/obsidian-note-workflow.md)：内容结构、原文依据和导出一致性。
- 平台适配：[B 站](./architecture/bilibili-service.md)、[抖音](./architecture/douyin-adapter.md)、[小红书](./architecture/xiaohongshu-public-video.md)。
- [AI 校对术语种子](./asr-glossary.md)：只用于术语库首次初始化。

当前架构按业务职责命名；历史版本资料只用于追溯，不作为当前实现依据。

## 维护资料

- [贡献与验证](../CONTRIBUTING.md)、[安全与数据边界](../SECURITY.md)、[致谢与来源](../CREDITS.md)。
- [用户研究材料](./research/README.md)：问卷、访谈和观察记录模板。
- [2026-10-05 体验升级记录](./archive/2026-10-05-experience-upgrade.md)：阶段实现与当时的验证结果。
- [初版 Web MVP 架构存档](./archive/v0-1-web-mvp.md)：仅用于了解项目早期设计。

本地计划、交接、运行数据与模型缓存不属于公开文档入口，也不随仓库分发。
