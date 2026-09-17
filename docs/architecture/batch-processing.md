# 多视频批量处理架构

## 目标与边界

批量处理接受手动提供的 1～49 条公开视频链接，支持“仅提取”和“提取并分析”。它不负责主页采集、搜索采集、登录受限内容、批量导出或自动保存全部原视频。

## 持久化模型

批次、执行任务和批次关联保存在内容库同一 SQLite 文件：

- `processing_batches` 保存幂等提交、目标和设置快照；
- `processing_tasks` 是执行状态、阶段、错误、身份和检查点的唯一来源；
- `processing_batch_items` 保存批次与任务的关联及单批次取消状态。

相同规范化链接、目标和处理设置会复用活跃任务。不同链接解析到同一平台内容身份时，进程内内容锁会串行下游生成；后到任务重新读取内容库结果，避免重复转写和总结。最终内容继续只保存在 `library_items`。

## 状态与阶段

执行状态为 `queued / running / waiting_retry / succeeded / failed / cancelled`，处理阶段为 `parse / download / recognize / correct / summarize / done`。批次统计由关联和任务状态实时派生，前端不自行累计。

取消只取消当前批次关联。最后一个有效关联取消时，尚未执行的任务进入取消终态；正在执行的步骤允许安全结束并保存结果，但不以取消删除已经生成的内容。重试保留成功检查点。

## 调度与资源

`task_runner.py` 在 FastAPI 启动时创建单个调度器，SQLite 是任务事实来源。执行池固定为 4 个工作线程，只领取有工作名额的任务。

全应用资源上限：

| 资源 | 上限 |
| --- | ---: |
| 抖音浏览器 Helper | 1 |
| 普通解析 | 2 |
| 媒体下载 | 2 |
| Whisper / SenseVoice 识别 | 1 |
| AI 阶段工作 | 2 |
| DeepSeek HTTP | 2 |

转写拆成下载、识别、校对三个阶段。识别原始稿进入任务检查点后立即释放识别名额，校对在 AI 名额中继续，所以视频 A 校对时，视频 B 可以识别、视频 C 可以下载。任务媒体只写入 `backend/data/tasks/<task_id>/`。

## 恢复与付费边界

重启后普通运行中任务回到队列并复用内容库和任务检查点。AI 请求开始前写入 `ai_inflight`；若服务在响应保存前中断，任务以 `AI_RESULT_UNCERTAIN` 失败，等待用户主动重试，避免自动重复付费请求。

启动器不使用 Uvicorn 自动 reload。`processing-runner.lock` 保证同一工作区只有一个后端进程可以执行队列。

## API

- `POST /api/task-batches`：幂等创建批次，立即返回 202；
- `GET /api/task-batches`：最近批次和全局活跃任务数；
- `GET /api/task-batches/{id}`：批次、任务行和统计快照；
- `GET /api/tasks/{id}`：单项快照；
- `POST /api/tasks/{id}/cancel`：取消当前批次关联；
- `POST /api/tasks/{id}/retry`：保留检查点重试。

旧 `/api/parse`、`/api/transcribe`、`/api/summarize` 和下载接口继续兼容，并与批量任务共用下载、识别、AI、DeepSeek 和抖音浏览器资源限制。
