# 本地内容库与数据库

## 数据归属

本项目使用同一 SQLite 文件 `backend/data/local_library.sqlite3`，路径唯一来源是 `backend/app/paths.py`。`backend/app/database.py` 负责连接、超时、提交、回滚与关闭；各业务服务维护自己的表结构和读写规则。

| 数据 | 所属模块 |
|---|---|
| 媒体元数据、转写、总结、我的整理 | `services/library_service.py` |
| 批次、任务、关联和检查点 | `services/task_store.py` |
| AI 校对术语、文件夹、使用统计 | `services/correction_term_service.py` |
| 本地请求频控 | `services/rate_limit_service.py` |

HTTP 接口位于 `routers/library.py`、`routers/tasks.py`、`routers/correction_terms.py` 和 `routers/status.py`。前端内容库行为由 `use-library-workspace.ts` 和 `RecentLibrary.tsx` 组合。

## 内容存储

`library_items` 以 `source_url` 为主键，另保存 `video_id`、标题、作者、平台、封面、时长、文本状态、总结状态和更新时间，供列表查询。完整工作台数据保存在 `payload_json`，包括转写变体、shownotes、总结、导图和 `note_draft`。

B 站查询会按 BVID 辅助定位，但分 P 必须一致。写回使用数据库中真实保存的源链接，不把带跟踪参数的新链接误当作新档案。

平台刷新只更新元数据，已经生成的转写、总结、导图和整理内容以事务内读到的最新记录为准。小红书页面补取失败时，已保存的有效作者和封面也应保留。

## 事务与并发

- 内容库读操作使用延迟事务，读后写使用 `BEGIN IMMEDIATE`；长文本转换和序列化准备在写事务外完成。
- 任务表启用外键，任务状态变化使用短写事务；细节见 [任务架构](./batch-processing.md)。
- 频控计数使用立即写事务，保持检查和递增的原子性。
- 术语服务沿用 SQLite 隐式写事务并启用外键。
- 所有连接沿用 5 秒等待与异常回滚；本次整理没有更换数据库或修改用户记录。

## 读取、删除与导出

内容库提供最近记录、筛选、统计和详情。读取旧 JSON 时保留已有兼容逻辑，并为转写补充指纹。仍存在活跃任务时，清空内容库或删除对应档案返回明确冲突，不删除正在处理的数据。

“我的整理”保存与 Markdown 导出分别由内容库和导出服务承担；用户编辑后立即导出时，前端先等待保存完成。

## 频控边界

持久任务按解析、转写和总结阶段消费本地额度，命中缓存时跳过不必要的处理。兼容的同步解析、总结、问答、转写接口沿用原有不计数行为；状态接口只报告现有计数。这次代码整理不改变额度策略。

## 验证

重点运行 `test_library_service.py`、`test_task_store.py`、`test_task_runner.py`、`test_correction_term_service.py` 和 `test_processing_service.py`，覆盖长稿写回、并发阶段保存、恢复、内容身份及刷新保留规则。测试使用隔离数据库。
