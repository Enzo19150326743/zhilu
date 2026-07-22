# 安装与启动

知录当前以 Windows 本地使用为第一优先级。第一次启动需要联网安装 Python、npm 依赖；第一次生成 AI 转写稿时还可能下载 Whisper 模型。

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

CPU 模式始终可用。Windows + NVIDIA 用户可以把 CUDA 运行库只安装到项目虚拟环境：

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-gpu-windows.txt
```

项目只修改当前 Python 进程的 DLL 搜索目录，不写入 Windows 全局 `PATH`。GPU 加载、推理或显存不足时，会按配置回退到 CPU。

## 构建生产前端

```powershell
cd frontend
npm ci
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

生产启动仍然需要 FastAPI 后端运行在 `127.0.0.1:8000`。
