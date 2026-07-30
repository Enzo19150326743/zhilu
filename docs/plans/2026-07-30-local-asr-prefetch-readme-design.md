# 完整本地转写环境预下载设计

## 背景

知录当前首次启动会在 `backend/.env` 不存在时打开可跳过的 AI API 配置窗口，但不会在用户开始转写前明确说明本地模型和 CUDA 依赖的下载成本。启动器只安装基础依赖；Whisper 模型在首次选择后下载，SenseVoiceSmall 和 CUDA 仍需额外安装，容易让 Fork、克隆或本地部署用户经历多次等待。

## 目标

- 在 README 前置说明本地转写的下载量、磁盘占用和可选 CUDA 成本。
- 提供一个明确、自愿执行的一键命令，一次安装本地转写依赖并预下载 Whisper、SenseVoiceSmall 和 FSMN-VAD。
- 自动区分 CPU 与 Windows NVIDIA 环境，不向无 NVIDIA 显卡的机器安装 CUDA 依赖。
- 保留现有轻量启动方式和首次 AI API 配置窗口。
- 同步补充 AI 校对术语注入、最近使用和常用术语管理说明。

## 方案

新增根目录批处理入口和 PowerShell 实现脚本。用户主动运行后，脚本先展示下载量与磁盘要求，再要求确认；支持显式 CPU、NVIDIA 和自动检测三种模式。自动模式仅在检测到 NVIDIA 显卡时选择 NVIDIA 路径，否则使用 CPU 路径。

脚本按顺序完成：

1. 检查项目结构、Python 与基础环境。
2. 创建或复用 `backend/.venv`，安装基础后端依赖。
3. 安装 SenseVoiceSmall 依赖。
4. NVIDIA 模式安装项目内 Whisper CUDA 运行库和 CUDA 版 PyTorch；CPU 模式不安装 CUDA 包。
5. 调用独立 Python 预下载脚本，缓存 Whisper `large-v3-turbo`、SenseVoiceSmall 和 FSMN-VAD。
6. 输出缓存位置、实际模式和完成状态。

任何步骤失败都返回非零退出码，并保留 pip 或模型下载的原始错误。脚本不修改 Windows 全局 Python、系统 `PATH`、驱动或注册表，也不写入 API Key。

## README 信息架构

README 的安装区分为：

- “快速启动”：保留现有启动器，适合先体验；明确模型可能在后续下载。
- “推荐：一次准备完整本地转写环境”：给出一条命令、CPU/NVIDIA 自动检测说明、模型体积和磁盘预留。
- “会下载什么”：列出 Whisper 约 1.62 GB、SenseVoiceSmall 约 0.94 GB、较小的 FSMN-VAD，以及依赖带来的区间估算；注明上游版本变化会导致体积波动。

功能列表增加 AI 校对术语库：术语只进入识别后的 AI 校对，不注入 Whisper、SenseVoice 或 Fun-ASR 原始识别；支持批量输入、文件夹、最近使用、常用术语和使用统计。

## 验证

- 对安装模式判断、参数解析和预下载目标编写不联网单元测试。
- 对 PowerShell 脚本执行语法检查和 `-WhatIf` / 计划预览验证，不在测试中重复下载数 GB 依赖。
- 执行后端相关单测、前端测试、类型检查、生产构建和公开发布扫描。
- 检查 README 中的命令与实际文件名一致，且不会把本地缓存、虚拟环境或密钥加入 Git。

## 边界

- 不在普通首次启动时强制下载全部模型。
- 不自动安装 NVIDIA 驱动、系统 CUDA Toolkit 或修改全局环境。
- 不把模型文件提交到 GitHub；模型仍下载到各上游工具的本地缓存。
- Web/Fork 用户仍需在实际运行后端的机器上执行准备脚本；静态前端托管无法运行本地 ASR。
