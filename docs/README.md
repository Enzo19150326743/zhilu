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

当前架构按业务职责命名；旧版本实现可通过 Git 历史追溯，不在文档目录另留阶段快照。

## 维护资料

- [贡献与验证](../CONTRIBUTING.md)、[安全与数据边界](../SECURITY.md)、[致谢与来源](../CREDITS.md)。
- [用户研究材料](./research/README.md)：问卷、访谈和观察记录模板。

过期计划、交接和工具会话可以清理；真实运行数据、模型缓存与评测证据保留在本机，不随仓库分发。
