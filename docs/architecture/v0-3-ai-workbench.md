# V0.3 AI 工作台架构说明

> **最后更新**：2026-10-10

## 一、版本定位

V0.3 的主线是把“知录”从可解析、可总结的媒体工作台推进到可问答、可沉淀结构的 AI 工作台。当前已接入这些能力：

- 内容问答：基于当前工作台已有内容文本、摘要和时间轴调用 `/api/qa`。
- 智能导图：基于 `mindmap_markdown` 和可选 `mindmap_meta` 在前端渲染树状 markmap。
- AI 转写稿生成：默认“提炼内容”通过持久任务按需使用 SenseVoiceSmall 转写并继续生成总结；术语、节目结构、内容标签和说话人属于可选“处理设置”。已有完整稿时页面不再提供重新转写按钮；`/api/transcribe` 保留为兼容接口。原始语音识别不接收用户术语，识别完成后才由 DeepSeek 使用本期上下文校对错别字、英文缩写和断句。
- 后台总结任务：AI 总结按 `source_url` 创建前端后台任务；解析结果已有完整逐字稿时自动继续总结，转写完成后也自动继续总结；用户切换到其他媒体后，原总结请求继续执行，完成后只回写同一个 `source_url` 的当前工作台。
- 后台处理任务：默认单条和批量都使用服务端持久任务。提交与后台阶段变化不会打开详情或替换正在阅读的内容；刷新、切换或返回后仍可恢复。旧浏览器侧解析／转写／总结接口只保留给高级和兼容操作。
- 总结未生成态：前端按 `SummaryDisplayState` 区分 `empty / demo / generated`；真实解析未生成总结时不展示后端兼容占位 summary / mindmap，示例数据和已生成总结仍展示完整内容。

这些能力优先使用当前已有的平台字幕或完整逐字稿；shownotes 只作为公开笔记阅读，不作为总结、导图和问答的完整内容依据。抖音实验 Adapter 已接入第一版公开视频解析和 ASR 直链输入，但仍不引入手动稿件、向量检索或浏览器插件。

## 二、核心入口

```text
backend/app/
├── main.py
├── schemas.py
└── services/
    ├── qa_service.py
    ├── asr_service.py
    ├── transcript_correction_service.py
    ├── deepseek_client.py
    ├── http_fetch_service.py
    ├── summarize_service.py
    ├── xiaoyuzhou_service.py
    ├── library_service.py
    ├── rate_limit_service.py
    └── douyin_service.py

frontend/
├── app/page.tsx
├── components/
│   ├── AiTabs.tsx
│   ├── QaTab.tsx
│   ├── MindmapTab.tsx
│   ├── TranscriptTab.tsx
│   ├── VideoPreviewCard.tsx
│   └── TranscribeTaskToasts.tsx
└── lib/
    ├── api.ts
    └── types.ts
```

## 三、数据流

内容问答：

```text
QaTab
→ apiClient.askQuestion()
→ POST /api/qa
→ qa_service.answer_question()
→ DeepSeek JSON / 本地 fallback
→ 返回 answer、references、is_ai_generated、model
```

智能导图：

```text
解析得到完整逐字稿 / 转写完成 / SummaryTab 手动重新生成
→ page.tsx 创建按 source_url 隔离的 summaryTasks
→ POST /api/summarize
→ summarize_service
→ deepseek_client 通过 http.client + Connection: close 调用 DeepSeek
→ 生成 summary、mindmap_markdown、mindmap_meta
→ library_service 写回 payload_json
→ 前端只更新当前同 source_url 的工作台
→ MindmapTab 动态加载 markmap-lib / markmap-view
→ 渲染 SVG 树状导图；不向用户展示底层 Markdown 原文
→ TranscribeTaskToasts 同时提示解析、总结和 AI 转写稿任务结果
```

远端封面图：

```text
VideoPreviewCard
→ /api/image-proxy?url=<远端封面>
→ http_fetch_service 拉取公网 image/*
→ 返回图片二进制给前端 img
```

AI 转写稿生成：

```text
TranscriptTab / SummaryTab / QaTab 点击生成 AI 转写稿
→ page.tsx 打开 TranscribeSettingsDialog，让用户确认节目结构、内容标签和说话人辅助信息
→ 用户点击开始生成后，page.tsx 创建按 source_url 隔离的 transcribeTasks
→ POST /api/transcribe，传入用户确认后的 context_settings
→ 小宇宙 / 抖音页面先解析 transcription_source_url，普通视频直接交给 yt-dlp
→ asr_service 下载 bestaudio/best 临时音频，临时文件名固定为 transcribe-audio.<ext>
→ 转写设置提交本期选择的 correction_terms；首次打开术语库时将 docs/asr-glossary.md 一次性迁入可见默认文件夹
→ transcribe_context_service 规范化节目结构、内容标签和说话人辅助信息
→ sensevoice_service 用 ffmpeg 规范化音频，由 SenseVoiceSmall 和 FSMN-VAD 生成带时间戳的原始 TranscriptPayload
→ transcript_correction_service 将节目结构、说话人辅助信息和术语表作为校对语境，按片段分块调用 DeepSeek；失败时回退原始稿
→ TranscriptPayload 同时保存最终稿 plain_text / segments 和原始稿 raw_plain_text / raw_segments，并写入 asr_meta
→ library_service 写回 payload_json，并设置 video.text_source_type = "asr_transcript"
→ library_service 同步重置旧 summary、mindmap_markdown、mindmap_meta 和 summary_status
→ 前端只更新当前同 source_url 的工作台，并重置当前总结 / 导图占位
→ TranscriptTab 统一展示当前有效稿，支持搜索、复制和文本导出；原始识别稿继续保存在后端字段中，页面不提供稿件切换或模型对照；最终稿有 speaker 时显示轻量标签
→ page.tsx 自动继续创建 summaryTasks，基于新逐字稿生成总结和导图
→ TranscribeTaskToasts 提示转写和总结任务结果
```

平台字幕与内容文本导出：

```text
POST /api/parse
→ main.normalize_public_video_url 清理公开 URL；B 站视频链接去除 spm_id_from / vd_source 等跟踪参数
→ ytdlp_service 获取媒体元数据；B 站解析带浏览器 User-Agent / Referer / Accept-Language 请求头
→ transcript_service 对 B 站优先读取平台公开字幕接口，失败后回落 yt-dlp VTT/SRT
→ 普通视频平台字幕写入 video.text_source_type = "subtitle"
→ TranscriptTab 按 subtitle / shownotes / asr_transcript 展示来源标签
→ 用户点击“导出全文”时，前端本地生成 .txt 文件，不调用后端
```

后台解析任务：

```text
UrlInput / LandingHero 点击提炼内容
→ useTaskWorkspace 提交 POST /api/task-batches，创建服务端持久任务
→ 接口接受后即可继续输入下一条链接，后台执行解析、按需转写和总结
→ 轮询更新任务统计和最近档案，只有当前正在查看同一内容时才刷新详情
→ 用户切换文章、标签页或继续输入时，后台结果不改变这些状态
```

总结未生成态：

```text
POST /api/parse 返回的 placeholder summary / mindmap 只作为兼容数据
→ page.tsx 根据 activeDetail 和 summaryGenerationMeta 推导 SummaryDisplayState
→ empty：SummaryTab 显示“未生成总结”空态，MindmapTab 显示“未生成导图”空态
→ empty：AiTabs 传给 QaTab 的 summary 为 null，避免占位摘要进入问答上下文
→ demo / generated：继续展示示例总结或真实 / 本地生成总结
```

## 四、稳定边界

- QA 首版只基于 `transcript.plain_text`、摘要和时间轴，不做全文检索、RAG、问答历史或内容片段表。
- 默认提炼任务在没有完整字幕时自动补齐本地转写稿，转写后继续总结；普通 `/api/parse` 仍只解析媒体与平台已有文本。
- 文本来源通过 `video.text_source_type` 区分：`subtitle` 表示平台字幕，`shownotes` 表示公开 shownotes / 内容简介，`asr_transcript` 表示本地语音识别生成的 AI 转写稿；旧历史里的 `transcript` 仍兼容为字幕 / 逐字稿语境。
- 本地识别固定使用 SenseVoiceSmall，不提供其他引擎或模型兜底；未安装依赖时返回明确错误。`SENSEVOICE_DEVICE=auto` 选择可用 CUDA，必要时使用同一模型的 CPU 设备，实际设备记录在转写元数据中。
- `backend/.env` 必须在业务服务导入前加载；当前由 `main.py` 按绝对路径读取。修改 `FFMPEG_LOCATION`、`SENSEVOICE_MODEL`、`SENSEVOICE_DEVICE`、DeepSeek 等配置后要重启后端，否则运行中的进程仍可能使用旧环境。
- Windows NVIDIA 加速通过 `scripts/install-sensevoice-cuda.ps1` 安装官方 CUDA 版 PyTorch，其运行库包含在 wheel 内；`cuda_runtime.py` 只注册当前环境的 PyTorch DLL 目录，不修改 Windows 全局配置。不得把 NVIDIA DLL 或 `.venv` 提交到仓库。
- 模型或依赖不可用时，后端应返回对应的安全业务错误；前端请求层应区分后端不可达、请求中断和后端业务错误，不要把所有 `fetch` 异常都显示成后端未启动。
- AI 校对术语由独立 SQLite 术语库维护；`docs/asr-glossary.md` 只在术语表首次创建时作为一次性种子。每期只有用户明确选择的术语进入 DeepSeek 校对，默认不选择历史术语，也不存在运行时隐藏名单。
- 用户术语、节目结构和人物说明只进入后续校对，不注入原始语音识别。
- DeepSeek ASR 校对只修正错别字、同音词、专有名词、英文缩写、标点和明显断句，不允许总结、扩写、删减事实或改时间戳；未配置 Key、超时、HTTP 错误、JSON 异常或片段数量不匹配时，`/api/transcribe` 必须使用原始识别稿返回。
- `/api/transcribe` 请求体可选新增 `context_settings`，包含节目结构单选、内容标签多选和最多 6 位说话人辅助信息；旧前端不传该字段时必须继续可用。
- 首页默认“提炼内容”允许直接提交；需要人物、节目结构或术语时再展开“处理设置”。明确点击“生成／重做转写稿”的高级入口仍可使用 `TranscribeSettingsDialog` 让用户确认本次设置。
- `TranscriptSegment.speaker` 是可选字段，只代表 DeepSeek 基于文本和角色说明做出的辅助推断，不代表真实声纹或音色识别；不确定的片段不强行标注。
- DeepSeek ASR 校对返回 speaker 时，后端只接受用户提供的说话人名称 / 身份以及“说话人 1 / 说话人 2 / 未区分”等受控标签；未知 speaker 会置空，不回退整块文本。
- AI 转写稿 `TranscriptPayload.plain_text / segments` 始终是最终稿，优先为校对稿；如果最终稿有 speaker，`plain_text` 会包含 `说话人：正文` 前缀，让总结、QA 和导图默认获得说话人语境；`raw_plain_text / raw_segments` 保留原始识别稿；旧历史没有这些字段时前后端必须兼容。
- `TranscriptAsrMeta` 可记录 `program_structure`、`content_tags`、`speaker_profiles` 和 `speaker_label_status`，用于说明本次转写稿的整理依据；这些信息保存在 `payload_json`，不新增数据库表或列。
- TranscriptTab、总结、QA 和导图统一使用当前有效的最终稿；原始识别字段用于保留识别记录，不提供页面切换入口。
- 默认单条和批量任务以服务端 SQLite 状态为事实来源，刷新后可恢复；前端不自行累计阶段或伪造进度。旧浏览器侧并行流程只用于兼容接口，不参与默认单条续接。
- 总结和转写结果都必须按 `source_url` 回写；旧任务完成时不能覆盖用户后来打开的其他媒体。
- 解析、总结和转写任务提示都允许在运行中关闭；关闭仅隐藏前端通知，不应取消后台请求、移除任务状态或阻断完成后的历史写回。
- B 站 URL 可能携带 `spm_id_from` 等 query；进入解析前先清理跟踪参数，保留 `p` / `t` 等播放定位参数；本地库精确 URL 未命中时可按 BVID 兜底读取和写回历史，但仍使用数据库实际命中的 `source_url` 更新。
- B 站 yt-dlp 元数据解析必须带浏览器请求头；Cookie 文件只作为显式本地调试兜底，不作为面向用户的默认路径。
- 小宇宙 shownotes 只用于内容文本页阅读和复制导出，不允许直接进入总结、导图或问答链路；`/api/summarize` 和 `/api/qa` 收到 `text_source_type=shownotes` 时返回 `FULL_TRANSCRIPT_REQUIRED`。
- 小宇宙转写必须保留原始小宇宙 `source_url` 写回历史；音频直链只作为 ASR 输入，不应成为新的历史主键。
- AI 转写稿写回后，旧总结和旧导图必须失效；前端随后自动基于新的 `asr_transcript` 文本来源生成总结和导图，QA 也应基于新的逐字稿提问，避免 shownotes / 平台字幕 / AI 转写稿混用。
- `mindmap_meta` 是可选字段，旧历史记录没有该字段时前端必须兼容。
- 导图第一版只做树状图，不做 React Flow 可编辑画布、圆圈图、鱼骨图或多布局切换。
- `MindmapTab` 初次渲染后可以手动 `fit()`，但 markmap 配置必须保持 `autoFit: false`；用户展开 / 折叠节点时应保留当前缩放比例和视角位置，不要自动回缩到全图预览；页面不展示 Markdown 原文代码块。
- markmap 细节问题后置到 V1 跑通后再统一优化，不作为当前主线阻断。
- 本机环境中 `urllib/httpx` 对部分 HTTPS 站点会出现 TLS EOF；DeepSeek、小宇宙网页读取和封面代理统一使用 `http.client + Connection: close` 的公共抓取策略。
- 长文本总结默认允许 DeepSeek 180 秒响应；前端总结请求等待 240 秒，避免模型仍在生成时被本地短超时打断。
- 真实解析未生成总结时，不要把后端兼容占位 summary / mindmap 当成用户内容展示；示例数据和已生成总结例外。
- 界面文案优先使用中文产品表达，避免把服务名、库名、接口名或英文缩写作为常规可见文案。

## 五、下一步边界

下一轮不要继续扩功能。应先进入 V0.4 / V1 前发布收敛：手动跑通 Demo、B 站视频、小宇宙 shownotes / AI 转写稿、抖音公开短视频解析 / AI 转写稿、总结、QA、导图、下载、内容文本导出和最近解析重开链路；只修阻断主链路的 bug。手动稿件入口、浏览器插件、RAG / 向量检索和问答历史仍属于后续能力。
