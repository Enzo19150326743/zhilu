# 配置指南

所有本地配置都放在 `backend/.env`。该文件已经被 Git 忽略，不要把真实值复制到 README、Issue、截图或提交记录。

## 创建配置文件

推荐直接双击根目录的 `配置 AI.bat`。也可以手动复制：

```powershell
Copy-Item backend\.env.example backend\.env
```

修改 `.env` 后必须重启后端。

## 本机文件分区

- `backend/data/`：SQLite、下载和任务检查点。
- `.local/tools/`：本机安装的辅助工具，例如 FFmpeg。
- `.local/cookies/`：显式配置的本机凭据文件。
- `.local/browser/douyin/`：抖音取流脚本默认使用的独立浏览器资料。

这些目录均不随 Git 分发。工具和凭据路径仍通过下面的环境变量明确配置，不依赖仓库上级的目录名。需要自定义抖音浏览器资料位置时可设置已有的 `DOUYIN_BROWSER_PROFILE_DIR`；迁移前关闭使用该资料的浏览器实例。

抖音取流脚本使用 `frontend/package.json` 显式声明的 Playwright 运行依赖，以及本机 Edge 或 Chrome；浏览器测试另外使用 `@playwright/test`。`.playwright-cli/` 和 `output/` 仅保存调试产物，不是安装目录或业务数据。

## AI 接口

知录支持 DeepSeek 和其他 OpenAI-compatible Chat Completions 服务。

```dotenv
AI_PROVIDER=deepseek
AI_API_KEY=your-api-key
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=your-model-name
AI_FAST_MODEL=your-fast-model-name
AI_MAX_TOKENS=8192
AI_THINKING_TYPE=disabled
```

- `AI_API_KEY` 是秘密，只能保存在本机。
- Base URL 和模型名是公开配置，不是密钥，但仍应以服务商当前文档为准。
- 未配置 Key 时，解析、本地历史和 Markdown 工作流仍可使用；AI 总结、问答与校对会使用本地降级结果。

## B 站登录态与 yt-dlp Cookie

默认匿名解析。只有在你确认需要读取当前账号有权访问的公开内容时，才显式开启本地 Cookie 选项：

```dotenv
BILIBILI_ENABLE_COOKIE_OPTIONS=1
BILIBILI_COOKIE_FILE=D:\path\to\cookies.txt

YTDLP_ENABLE_COOKIE_OPTIONS=1
YTDLP_COOKIE_FILE=D:\path\to\cookies.txt
# 或：YTDLP_COOKIES_FROM_BROWSER=edge
```

Cookie 是登录凭据：

- 不要提交 Cookie 文件。
- 不要粘贴到 Issue 或聊天记录。
- 浏览器 Cookie 数据库可能被正在运行的浏览器锁定。
- 登录态不保证固定清晰度，最终仍以平台和账号实际权限为准。

## 本地下载

```dotenv
YTDLP_DOWNLOAD_DIR=D:\path\to\downloads
YTDLP_MERGE_OUTPUT_FORMAT=mp4
FFMPEG_LOCATION=D:\path\to\ffmpeg\bin
```

默认下载目录是 `backend/data/downloads`。选择仅视频格式时，后端会尝试用 ffmpeg 合并音频。

## 小宇宙

```dotenv
XIAOYUZHOU_RSSHUB_BASE_URL=https://rsshub.app
```

只支持公开单集页面。系统优先读取公开 RSS，失败时回退公开网页结构化数据，不处理付费或私密节目。

## 本地 SenseVoiceSmall

本地识别只使用 SenseVoiceSmall，前端不提供引擎选择。默认提炼任务自动补齐转写稿并生成总结；依赖未安装时会明确提示，不会切换到其他语音模型。

在 `backend/` 目录运行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-sensevoice-windows.txt
```

可选配置：

```env
SENSEVOICE_MODEL=iic/SenseVoiceSmall
SENSEVOICE_DEVICE=auto
SENSEVOICE_GPU_BATCH_SIZE_SECONDS=60
SENSEVOICE_CPU_BATCH_SIZE_SECONDS=300
SENSEVOICE_SEGMENT_NORMALIZATION_ENABLED=1
SENSEVOICE_SEGMENT_MIN_SENTENCE_SECONDS=4
SENSEVOICE_SEGMENT_MAX_SECONDS=8
SENSEVOICE_SEGMENT_MAX_CHARACTERS=120
SENSEVOICE_SEGMENT_SILENCE_GAP_SECONDS=2
```

`auto` 会优先尝试 CUDA，失败后在同一个 SenseVoice 引擎内回退 CPU，并记录实际设备。
RTX 3050 Laptop 等 4GB 级显卡默认使用更保守的 60 秒 GPU 批量；CPU 默认保持
300 秒。需要 NVIDIA GPU 时，请先运行项目根目录的
`scripts/install-sensevoice-cuda.ps1` 安装官方 CUDA 版 PyTorch，然后重启后端。
新任务失败不会覆盖旧稿。短于 4 秒的 SenseVoice 句段会在校对前继续合并，优先形成 4–8 秒的校对单元；该处理不会重新切割音频或删除原始时间戳。模型原始片段保存在 `raw_segments`，校对和默认阅读使用整理后的句段。`SENSEVOICE_SEGMENT_NORMALIZATION_ENABLED=0` 可关闭句段合并。

## AI 转写校对

```dotenv
ASR_CORRECTION_ENABLED=1
AI_CORRECTION_MODEL=your-fast-model-name
ASR_CORRECTION_MAX_TOKENS=8192
ASR_CORRECTION_CHUNK_CHARS=3500
ASR_CORRECTION_TIMEOUT_SECONDS=120
```

`ASR_CORRECTION_CHUNK_CHARS=3500` 是单次校对请求的大致批量，不是全文读取上限；
系统会依次处理完整转写的所有批次。节目结构、内容标签、说话人信息和本期选择的 AI 校对术语用于
AI 校对，不会直接注入本地 SenseVoice 声学识别。未配置 AI Key 或校对失败时，系统保留原始稿。

## Obsidian

```dotenv
OBSIDIAN_ENABLE_VAULT_WRITE=0
OBSIDIAN_VAULT_DIR=
OBSIDIAN_EXPORT_SUBDIR=知录知识稿
```

默认只下载 `.md`。直接写入 Vault 需要显式开启，并填写本机目录。详见 [Obsidian 导出说明](./obsidian-export.md)。
