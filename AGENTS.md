# 知录 Agent 协作入口

> 本文件面向在仓库内工作的 AI Agent。目标是让修改范围可控、验证与改动匹配，并保护现有 API、平台适配和隐私边界。

## 开始前先读

1. 先读 `docs/code-map.md`，按“常见任务定位”找到模块入口。
2. 再读与任务相关的 `docs/architecture/*.md`，不要先遍历整个仓库。
3. 涉及提交、验证或公开数据时，同时读 `CONTRIBUTING.md` 和 `SECURITY.md`。
4. 当前产品与实现以已跟踪文档和代码为准，不依赖旧计划、会话记录或交接快照；本机路径配置见 `docs/configuration.md`。

## 快速搜索默认排除

```powershell
rg "关键词" . `
  -g '!**/node_modules/**' `
  -g '!**/data/**' `
  -g '!**/__pycache__/**' `
  -g '!*.log' `
  -g '!*.tsbuildinfo'
```

## 按改动范围验证

- 不默认运行全部检查。选择能覆盖本次风险的最小检查；用户明确限制测试或浏览器操作时，以用户要求为准。
- 后端逻辑或 API 改动，在仓库根目录执行：

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```

- 前端逻辑、类型或构建改动，在仓库根目录执行：

```powershell
cd frontend
npm run test:helpers
npm run build
```

- 只有修改用户交互、页面状态或 E2E 场景，并且允许启动浏览器时，才在 `frontend/` 执行 `npm run test:e2e`。该测试使用 API mock，不验证真实后端或真实平台。
- 准备提交或改动公开文档、配置、示例、日志处理时，在仓库根目录执行 `.\scripts\check-public-release.ps1`。
- 环境或权限导致检查无法执行时，交付时明确列出未验证项，不把未运行写成已通过。

## 稳定合同与修改要求

- `backend/app/schemas.py` 定义后端 API 模型，`frontend/lib/types.ts` 手动镜像前端使用的字段。修改公共字段时保持向后兼容，并同步两端及相关调用方；不要无意删除、改名或收窄已有字段。
- `backend/app/services/url_normalization_service.py` 的 URL 规范化和 `backend/app/main.py` 的统一错误响应是已有稳定行为。任务确有需要时可以修改，但必须保留公开 URL 校验、B 站播放定位参数以及前端可读取的 `error_code` / `message` 合同，并运行对应检查。
- `frontend/e2e/support.ts` 的 `installApiMocks` 和 `watchBrowserErrors` 是共享测试基础设施，场景按 `*.spec.ts` 分组。接口或页面流程变化时允许同步更新，但要保持 mock 可复现，并继续捕获浏览器控制台错误和页面异常。
- 密钥、Cookie、Token、数据库、下载文件、本地知识稿、私人链接和含本机用户名的绝对路径不得进入公开候选文件。不要处理 DRM、付费、私密、登录受限或无授权内容。

## 修改平台适配器时

- 先从 `docs/code-map.md` 找到对应服务，并读取该平台已有架构文档和测试。
- 专用 Adapter 必须注册在通用 `YtdlpVideoSourceAdapter` 之前；不要破坏其他平台的现有顺序、失败降级和默认兜底。
- 保持 `/api/parse` 的 `ParseResponse` 合同向后兼容。平台差异应封装在对应服务或 Adapter 中，不要把平台判断继续堆进 `backend/app/main.py`。
- 优先运行对应平台的后端测试；只有返回字段或前端流程发生变化时，才补前端构建或 E2E。
- 仅在新增平台、改变模块入口或调整文件职责时更新 `docs/code-map.md`；普通解析 bugfix 不需要制造文档改动。
