<p align="center">
  <img src="./frontend/public/favicon.svg" width="88" alt="知录 Logo">
</p>

<h1 align="center">知录</h1>

<p align="center"><strong>看见的，听见的，都沉淀为本地知识。</strong></p>

<p align="center">
  将公开视频与播客转写、总结并整理为保存在本地、可继续编辑的 Markdown 知识稿。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.0-d14b31" alt="Version v0.1.0">
  <img src="https://img.shields.io/badge/platform-Windows-24211d" alt="Windows-first">
  <img src="https://img.shields.io/badge/data-local--first-2f7d67" alt="Local-first">
  <img src="https://img.shields.io/badge/license-MIT-7c7468" alt="MIT License">
</p>

![知录首页](./docs/images/readme/home.png)

知录把散落在视频和播客里的内容，变成你真正能带走的知识资产。粘贴公开链接后，它会优先读取平台字幕或 Shownotes；没有现成文本时，也可以调用本地 Whisper 生成 AI 转写稿。随后继续整理摘要、导图、问答和摘录，最终导出普通 `.md` 文件。

> [!IMPORTANT]
> 知录只处理你有权访问和分析的公开内容，不支持 DRM、付费、私密或受限媒体，也不提供绕过平台限制的能力。

## 能做什么

| 能力 | 得到什么 |
|---|---|
| 多媒体文本获取 | 从 B 站、抖音、小宇宙等公开来源取得字幕、Shownotes 或媒体信息 |
| 本地 AI 转写 | 没有现成文本时，用本地 Whisper 生成并可选校对转写稿 |
| 结构化理解 | 生成一句话摘要、核心观点、行动建议和思维导图 |
| 内容问答 | 围绕当前媒体文本继续追问，不脱离来源凭空扩写 |
| 摘录工作流 | 区分用户确认摘录与 AI 未确认候选，保留可靠原文 |
| Markdown 沉淀 | 下载 `.md`，或选择直接写入本地 Obsidian Vault |

![知录结构化总结工作台](./docs/images/readme/workbench-summary.png)

## 从链接到知识稿

```text
公开媒体链接
    ↓
平台字幕 / Shownotes / 本地 AI 转写
    ↓
摘要 / 导图 / 问答 / 摘录
    ↓
本地历史 + Markdown / Obsidian 知识稿
```

1. 粘贴公开媒体链接并生成底稿。
2. 检查文本来源；缺少字幕时按需生成 AI 转写稿。
3. 整理总结、导图和摘录，然后导出 Markdown。

## 支持范围

| 来源 | 当前支持 | 说明 |
|---|---|---|
| B 站公开视频 | 元数据、公开字幕、格式列表、本地 ASR、辅助下载 | 清晰度和字幕取决于平台公开结果与账号权限 |
| 抖音公开视频 | 元数据、实验解析、本地 ASR、辅助下载 | 平台页面变化可能影响解析稳定性 |
| 小宇宙公开单集 | 元数据、Shownotes、本地 ASR | Shownotes 不等于完整逐字稿 |
| 其他 yt-dlp 可识别来源 | 实验支持 | 不承诺所有站点长期可用 |

当前不包含整档批量导入、浏览器插件、跨媒体全文检索和向量 RAG。

## Windows 快速开始

### 环境准备

- Windows 10 / 11
- Python 3.10+
- Node.js 20+
- Git（也可以直接下载仓库 ZIP）
- ffmpeg（仅在合并音视频或部分转写场景需要）

### 三步启动

```powershell
git clone https://github.com/Enzo19150326743/zhilu.git
cd zhilu
.\启动网站.bat
```

也可以下载源码 ZIP、解压后双击 `启动网站.bat`。

首次运行会自动创建 Python 虚拟环境、安装前后端依赖、询问是否配置自己的 AI API，然后打开 `http://localhost:3000`。后续仍然双击同一个文件启动。

> [!NOTE]
> 这不是一个只靠 `npm install` 就能运行的纯前端项目。根目录启动器会同时管理 FastAPI 后端和 Next.js 前端；`frontend/npm run dev` 只启动前端。

完整安装、手动启动与 GPU 可选加速见 [安装指南](./docs/installation.md)。

## 使用 Tips

- 第一次建议用 3～10 分钟的公开视频跑通流程。
- 未配置 AI Key 仍能解析内容；总结、问答和校对会使用本地降级结果。
- Whisper 首次运行可能需要下载模型，耗时取决于网络和本机性能。
- 修改 AI、Cookie、ASR 或下载目录后，需要重启后端并点击“重新提取”。
- B 站只返回 480p 不一定是筛选错误，可能是平台本次公开格式上限。
- 小宇宙优先读取公开 Shownotes；需要完整文本时可以手动生成 AI 转写稿。
- 本地下载只是辅助保存能力，请确保你拥有相应内容的访问和处理权限。

## AI 与本地能力

AI 配置是可选的。你可以双击 `配置 AI.bat`，填写自己的 DeepSeek 或其他 OpenAI-compatible 接口；Key 只写入本机 `backend/.env`，不会进入前端。

本地 Whisper 不要求 NVIDIA 显卡。CPU 始终是可用回退；Windows + NVIDIA 用户可以选择安装项目内 CUDA 依赖，不修改系统全局环境。

配置项和安全边界见 [配置指南](./docs/configuration.md)。常见错误见 [排查指南](./docs/troubleshooting.md)。

## 本地优先与隐私

| 会进入公开仓库 | 只留在你的电脑 |
|---|---|
| 源代码、依赖清单、空白 `.env.example` | API Key、Cookie、浏览器登录态 |
| 原创界面资源、公开安全截图 | `backend/.env`、本地绝对路径 |
| 合成或经审查的推荐内容 | SQLite 历史、下载文件、日志 |
| 测试、使用文档、许可证 | Whisper 模型、CUDA 缓存、Obsidian Vault |

真实历史保存在 `backend/data/local_library.sqlite3`，默认不会进入 Git。发布前可以运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-public-release.ps1
```

该脚本会检查候选公开文件中的敏感值和禁止路径。更多安全报告方式见 [SECURITY.md](./SECURITY.md)。

## 开发与验证

手动开发启动：

```powershell
# 终端 1：后端
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 终端 2：前端
cd frontend
npm ci
npm run dev
```

主要验证命令：

```powershell
backend\.venv\Scripts\python.exe -m unittest discover -s backend\tests -v
cd frontend
npm run test:helpers
npm run build
cd ..
.\scripts\check-public-release.ps1
```

项目结构见 [代码地图](./docs/code-map.md)，贡献方式见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 不止是摘要，而是可带走的本地知识稿

![知录导出的 Obsidian Markdown](./docs/images/readme/obsidian-markdown.png)

知录导出的每份知识稿都是普通 `.md` 文件，不被数据库或某个云服务锁住。文件包含 Obsidian 可识别的 YAML Properties、层级标题、来源链接与原生 Callout 摘录；你可以下载到任意 Vault，也可以选择直接写入本地 Obsidian 目录。

即使未来不再使用知录或 Obsidian，这些知识仍然可以在任何 Markdown 编辑器中继续维护。你可以先查看 [公开合成知识稿](./docs/examples/knowledge-draft.md)，详细字段与兼容边界见 [Obsidian 导出说明](./docs/obsidian-export.md)。

---

[MIT License](./LICENSE) · [致谢与来源](./CREDITS.md) · [安全说明](./SECURITY.md) · [参与贡献](./CONTRIBUTING.md)
