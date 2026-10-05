# Obsidian Markdown 导出

知录的目标不是把摘要锁在网页或数据库里，而是生成可以继续编辑、迁移和长期保存的普通 Markdown 知识稿。

## 两种导出方式

1. 默认下载 `.md` 文件，再移动到任意 Obsidian Vault 或其他笔记目录。
2. 显式配置 Vault 后，直接写入 Vault 内的指定子目录。

```dotenv
OBSIDIAN_ENABLE_VAULT_WRITE=1
OBSIDIAN_VAULT_DIR=D:\Notes\MyVault
OBSIDIAN_EXPORT_SUBDIR=知录知识稿
```

`OBSIDIAN_EXPORT_SUBDIR` 必须是 Vault 内部的相对目录。后端会解析目标路径并拒绝绝对路径、`..` 越界和 Vault 外写入。

## 输出结构

每份知识稿包含：

- YAML Properties
- 一句话结论
- 关键观点／信息／方法
- 原内容中明确给出的作者建议与方法
- 有新增信息时才出现的内容脉络与辅助分析
- 用户确认并可继续编辑的“我的整理”
- 内容边界与待核实信息

未确认的 AI 候选不导出，默认也不附完整逐字稿，避免把未经整理的大段第三方内容复制进知识库。网页中的折叠状态不会删减已有的有效总结内容。

## YAML 示例

```yaml
---
草稿版本: "1.2"
标题: "示例知识稿"
内容类型: "视频"
平台: "example"
原始作者: "示例作者"
源链接: "https://example.com/public-media"
处理日期: "2026-07-22"
内容关键词:
  - "示例主题"
时长: "10:00"
---
```

Obsidian 支持文件顶部的 YAML Properties，属性名可以自定义；日期、数字和列表会保留为结构化值。知录当前使用稳定的通用元数据，不生成固定个人标签、双链或数字分身字段。

## 我的整理

“我的整理”只包含用户主动加入并确认过的内容。它采用中性笔记标题，不保证每一条仍是逐字引用；AI 候选即使在网页中可见，也不会进入文件：

```markdown
## 我的整理

### 整理 1

这是用户确认后继续编辑过的整理内容。
```

## 兼容性边界

- `.md`、标题、列表和引用属于普通 Markdown，可由常见编辑器读取。
- YAML Properties 和 Callout 在 Obsidian 中会获得增强显示。
- 当前不提供 Obsidian 插件、Dataview 查询、自动双链、复杂标签系统或 Vault 全文索引。
- 中文属性名是合法 YAML；如果你的其他工具要求固定英文字段，可以在导出后继续编辑。

官方语法参考：[Properties](https://obsidian.md/help/properties)、[Callouts](https://obsidian.md/help/callouts)、[Markdown syntax](https://obsidian.md/help/syntax)。
