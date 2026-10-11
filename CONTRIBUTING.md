# 参与贡献

感谢你愿意帮助知录变得更好。这个项目优先解决一件事：把公开视频与播客整理为留在本地、可继续编辑的 Markdown 知识稿。

## 适合贡献的内容

- 新的公开媒体源适配与解析稳定性修复；
- 转写、总结、摘录、导图、问答和 Markdown 导出体验；
- Windows 本地安装、错误提示、无障碍与响应式体验；
- 单元测试、文档、公开安全检查与性能改进。

涉及绕过平台权限、批量抓取私人内容、凭据共享或规避版权限制的改动不在项目范围内。

## 开发环境

建议使用 Windows 10/11、Python 3.10+、Node.js 20+ 和 FFmpeg。完整步骤见 [安装说明](./docs/installation.md)，环境变量见 [配置说明](./docs/configuration.md)。

```powershell
git clone https://github.com/Enzo19150326743/zhilu.git
cd zhilu
Copy-Item backend/.env.example backend/.env
```

首次体验可双击 `启动网站.bat`。开发时分别启动后端和前端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

```powershell
cd frontend
npm ci
npm run dev
```

## 提交前检查

后端测试需要 `requirements-dev.txt` 中的接口测试客户端。运行依赖固定了已验证的 FastAPI 与 Starlette 配对；升级它们时应同时验证接口测试依赖与干净环境安装。

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"

cd ..\frontend
npm run test:helpers
npm run build

cd ..
.\scripts\check-public-release.ps1
```

## 数据与隐私要求

提交内容必须使用合成或明确可公开的示例。不要提交：

- `.env`、真实 API Key、Cookie、Token 或账号信息；
- `backend/data/` 中的数据库、下载文件和本地运行数据；
- 个人 Obsidian 仓库、私人链接、完整第三方转写稿或知识稿；
- 包含用户名、手机号、邮箱或本机绝对路径的截图与日志。

推荐内容只保留必要的标题、作者、公开来源链接和展示封面；第三方内容归原作者所有。详见 [CREDITS.md](./CREDITS.md)。

## Issue 与 Pull Request

提交 Issue 前请先搜索是否已有同类问题，并提供版本、来源平台、复现步骤和已脱敏日志。Pull Request 请保持范围单一，说明用户可见变化、验证结果与隐私影响；涉及 UI 时附上不含私人数据的截图。

代码应沿用现有 React + TypeScript 与 FastAPI 结构。注释解释设计原因和边界，不复述代码。新增行为应带最小、相关的测试。
