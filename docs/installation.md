# 安装与启动

知录当前以 Windows 本地使用为第一优先级。第一次启动需要联网安装 Python、npm 依赖；如果没有提前准备完整本地转写环境，第一次生成 AI 转写稿时还可能下载 SenseVoiceSmall 和 FSMN-VAD。

## 环境要求

- Windows 10 或 Windows 11
- Python 3.10 或更高版本
- Node.js 20 或更高版本
- Git，可选；不使用 Git 时可以下载仓库 ZIP
- ffmpeg，可选；音视频合并、辅助下载和部分转写链路需要

当前开发环境已验证 Python 3.13、Node.js 24 和 ffmpeg 8。其他版本需要以 CI 与实际构建结果为准。

## Windows 一键启动

```powershell
git clone https://github.com/Enzo19150326743/zhilu.git
cd zhilu
.\启动网站.bat
```

也可以下载源码 ZIP，解压后双击 `启动网站.bat`。

启动器会：

1. 检查项目目录。
2. 首次启动时打开可选 AI 配置窗口。
3. 创建 `backend/.venv`。
4. 安装 `backend/requirements.txt`。
5. 在缺少 `frontend/node_modules` 时执行 `npm install`。
6. 启动 FastAPI 和 Next.js。
7. 等待服务就绪并打开浏览器。

启动后访问：

- 前端：`http://127.0.0.1:3000`
- 后端健康检查：`http://127.0.0.1:8000/api/health`
- FastAPI 文档：`http://127.0.0.1:8000/docs`

运行期间需要保留后端与前端命令窗口。关闭这两个窗口即可停止服务。

## 推荐：一次准备全部本地转写依赖与模型

为了避免第一次使用 SenseVoiceSmall 时再次等待，在项目根目录运行：

```powershell
.\准备完整本地转写环境.bat
```

脚本会在下载前展示计划并等待确认。自动模式会检测 Windows NVIDIA 显卡；有 NVIDIA 显卡时安装官方 CUDA 版 PyTorch，否则使用 CPU 环境。随后提前缓存：

- SenseVoiceSmall，约 0.94 GB；
- SenseVoice 使用的 FSMN-VAD 辅助模型。

依赖与模型的下载规划范围：CPU 约 1.5～3.5 GB、建议预留 4～7 GB；NVIDIA 约 3～6 GB、建议预留 8～12 GB。这是按模型与 PyTorch 等依赖估算的范围，并非一次安装的实测总量；不包含前端 npm 依赖、媒体下载或用户历史数据。上游包版本、安装时的缓存和临时解压会影响实际体积。

只查看计划、不执行安装：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prepare-local-asr.ps1 -Mode Auto -PlanOnly
```

自动准备只修改 `backend/.venv` 和当前用户的模型缓存，不安装显卡驱动、不修改系统全局 `PATH` 或注册表。Fork 或静态 Web 部署不会包含这些本地文件；必须在实际运行 FastAPI 后端的 Windows 机器上执行。

## 手动启动后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## 手动启动前端

另开一个 PowerShell 窗口：

```powershell
cd frontend
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

## 可选：Windows NVIDIA GPU 加速

完整环境准备脚本会自动安装 SenseVoiceSmall 依赖。需要手动维护 CPU 环境时，在项目根目录运行：

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-sensevoice-windows.txt
```

上面的命令可直接使用 CPU。Windows + NVIDIA 用户希望 SenseVoiceSmall 使用 CUDA 时，
改为在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-sensevoice-cuda.ps1
```

脚本只修改项目的 `backend/.venv`，从 PyTorch 官方 CUDA wheel 源安装依赖，不修改
Windows 全局 Python 或系统 `PATH`。CUDA wheel 体积较大，脚本已启用断点续传重试；
安装结束会打印 `cuda_available` 和实际显卡名称。Windows CUDA 版 PyTorch 自带所需运行库，无需另外安装独立的 NVIDIA 运行库包。设备配置为 `auto` 时优先使用可用 GPU，也可使用同一 SenseVoice 模型的 CPU 设备；不会切换到另一种语音模型。

## 构建生产前端

```powershell
cd frontend
npm ci
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

生产启动仍然需要 FastAPI 后端运行在 `127.0.0.1:8000`。
