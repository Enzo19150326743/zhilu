# V0.2 本地内容库与请求频控架构说明

> **最后更新**：2026-06-04

## 一、版本目标

V0.2 的目标是把知录从一次性 localhost 解析入口，推进为可反复打开的本地内容工作台。真实 URL 解析成功后，后端将完整工作台数据保存到 SQLite；用户可从前端“最近解析”重新打开历史记录。

## 二、核心边界

- V0.2.2 已完成：SQLite 本地内容库、最近解析列表、最近解析空状态、状态筛选、加载更多、复制源链接、当前历史记录高亮、手动刷新最近解析、历史详情打开、总结结果写回历史记录、删除单条历史记录、清空本地历史、本地 parse/summarize 请求频控。
- V0.2.x 已扩展：真实下载闭环、最佳可用格式下载入口、B 站公开格式候选和 ffmpeg 合并下载、输入源 Adapter 分发、小宇宙公开单集解析、抖音公开视频实验 Adapter。
- V0.2.3 已补齐媒体内容语境：最近解析列表从历史 `payload_json` 安全透传 `media_type` / `text_source_type`，前端可按平台字幕、播客 shownotes 和 AI 转写稿区分展示语境。当前常用取值为 `subtitle`、`shownotes`、`asr_transcript`；旧历史中的 `transcript` 仍兼容。
- B 站历史复用已增加 BVID 兜底：精确 `source_url` 未命中时，如果输入 URL 中能提取 `BV...`，详情读取、总结写回和全文本写回都会按 `video_id` 找最近历史记录，避免同一 B 站视频因 `spm_id_from` 等 query 变化被误判为无文本或写回失败。
- 当前仍不做：手动稿件入口、浏览器插件、复杂全文搜索、云同步。真实 QA、音频 ASR 和抖音实验 Adapter 已在后续版本线提前接入 MVP，但仍以 bug 收敛和稳定边界为主。
- 小宇宙播客解析已经完成公开单集 MVP，只读取公开元数据和 shownotes；不做 App 逆向、登录态、付费私密内容、整档批量导入或音频 ASR。
- 真实 DeepSeek Key 仍只允许放在 `backend/.env`。
- 品牌名后续已升级为“知录”，保留当前 logo 结构。

## 二点一、V0.2.x 下载增强现状

- `POST /api/download` 已接入同步下载 MVP：前端传入公开媒体 URL、`format_id` 和是否需要合并音频，后端使用 yt-dlp 下载到本地受控目录。
- 前端格式区提供“最佳可用格式”入口，传 `format_id="best"`；后端有 ffmpeg 时使用 `bestvideo+bestaudio/best`，无 ffmpeg 时退回 `best`，用于避免用户在复杂格式列表里误选低清或无音频格式。
- 默认下载目录是 `backend/data/downloads`，可通过 `YTDLP_DOWNLOAD_DIR` 改到其他本地目录；下载产物不进入仓库。
- 对“仅视频”格式，后端使用 `format_id+bestaudio/best` 并要求本机 ffmpeg 可用；可通过 `FFMPEG_LOCATION` 指向本地 ffmpeg。
- B 站清晰度不把 Cookie 作为用户路径：默认忽略旧 `.env` 中的 `YTDLP_COOKIE_FILE` / `YTDLP_COOKIES_FROM_BROWSER`，只按平台本次公开 formats 展示和下载；如需本地调试登录态，必须显式设置 `YTDLP_ENABLE_COOKIE_OPTIONS=1`。
- 抖音链接不走 yt-dlp 下载选择器，而是在 `backend/app/services/douyin_service.py` 里重新解析公开视频直链并保存到同一个受控下载目录。
- 下载能力仍遵守合规边界：只处理用户有权访问和处理的公开媒体内容，不处理 DRM、付费、私密或无授权内容。

## 二点二、V0.2.x 输入源抽象现状

- `backend/app/services/media_source_service.py` 已作为统一输入源分发层接入。
- `POST /api/parse` 不再直接调用 yt-dlp，而是调用 `parse_media_source(source_url)`，由 Adapter 判断是否支持该输入源。
- 当前已注册 `DouyinVideoSourceAdapter`、`XiaoyuzhouEpisodeSourceAdapter` 和 `YtdlpVideoSourceAdapter`；专用适配器放在默认 yt-dlp 适配器之前，避免 `main.py` 堆平台判断。
- 小宇宙当前只支持公开单集链接，优先通过 `XIAOYUZHOU_RSSHUB_BASE_URL` 指向的 RSSHub 实例读取公开 RSS 元数据和 shownotes；RSSHub 不可用时回退解析公开网页中的 `__NEXT_DATA__` / JSON-LD；不做登录态、付费内容、App 逆向、整档批量导入或音频 ASR。
- 抖音当前只支持公开短视频链接和分享口令中提取出的公开 URL；解析优先走公开接口，失败后回退移动端分享页结构化数据和 WAF cookie challenge；不承诺所有链接稳定可用，不做登录态、私密、付费或受限内容。

## 三、文件入口

```text
backend/
├── app/
│   ├── main.py
│   ├── schemas.py
│   └── services/
│       ├── library_service.py
│       ├── media_source_service.py
│       ├── summarize_service.py
│       ├── xiaoyuzhou_service.py
│       ├── douyin_service.py
│       └── ytdlp_service.py
└── data/
    ├── demo_seed.json
    └── local_library.sqlite3

frontend/
├── app/
│   └── page.tsx
├── components/
│   └── RecentLibrary.tsx
└── lib/
    ├── api.ts
    ├── media.ts
    └── types.ts
```

## 四、数据流

```text
首次解析 URL
→ POST /api/parse
→ 先按 source_url 查询 SQLite；B 站 URL 未精确命中时按 BVID 兜底查询最近历史
→ 命中则返回本地缓存
→ 未命中则调用 media_source_service 分派到抖音 / 小宇宙 / yt-dlp 适配器
→ 成功后 upsert 到 library_items
→ 前端刷新最近解析列表

生成总结
→ POST /api/summarize
→ DeepSeek 成功或 fallback 返回 SummarizeResponse
→ 按 source_url 更新 SQLite 中的 summary / mindmap_markdown / summary_status；B 站 URL 变体按实际命中的历史 source_url 写回
→ 前端刷新最近解析列表

打开历史记录
→ GET /api/library/{video_id}
→ 返回完整 ParseResponse
→ page.tsx 将 detail 切回 parsed 工作台

删除历史记录
→ DELETE /api/library/{video_id}
→ 按 video_id 删除 SQLite 中的单条记录
→ 前端从最近解析列表移除该记录

手动刷新最近解析
→ 用户点击最近解析区刷新按钮
→ GET /api/library/recent
→ 后端从 payload_json 透传 media_type / text_source_type
→ 前端用最新列表覆盖当前最近解析状态，并按媒体字段显示视频 / 播客语境

本地库统计接口
→ GET /api/library/stats
→ 返回总记录、有内容文本、无内容文本、已总结、AI 总结、本地摘要数量
→ 当前前端不展示统计概览，避免与筛选按钮形成重复信息

加载更多最近解析
→ 前端提升 GET /api/library/recent 的 limit 参数
→ 后端按 updated_at 返回更多历史记录
→ 前端继续用状态筛选展示当前已载入记录

删除当前打开的历史记录
→ DELETE /api/library/{video_id}
→ 前端从最近解析列表移除记录
→ 如果删除项正是当前工作台内容，则回到首页空闲态

清空本地历史
→ DELETE /api/library
→ 清空 SQLite 中 library_items 表
→ 前端清空最近解析列表和统计；如果当前工作台来自本地历史，则回到首页空闲态

本地请求频控
→ GET /api/rate-limit/status 读取当前客户端频控状态
→ POST /api/parse 未命中缓存时计入 parse 额度
→ POST /api/summarize 计入 summarize 额度
→ 达到上限时返回 RATE_LIMITED，前端显示统一错误提示
```

## 五、SQLite 设计

V0.2 采用单表 `library_items`：

- `source_url`：主键，避免同一 URL 重复解析。
- `video_id`：用于前端打开详情。
- `title`、`author`、`platform`、`thumbnail`、`duration`、`has_transcript`：列表展示字段。
- `summary_status`、`summary_model`：区分未总结、AI 生成和本地兜底。
- `payload_json`：完整 `ParseResponse` JSON；其中 `video.media_type` 和 `video.text_source_type` 是媒体语境判断来源。平台字幕通常写为 `subtitle`，小宇宙 shownotes 写为 `shownotes`，本地语音识别写回的 AI 转写稿写为 `asr_transcript`。
- `created_at`、`updated_at`：最近解析排序。

这个设计故意不拆内容文本段落表、总结表和媒体类型列，优先保证 V0.2 小步闭环。最近解析列表读取时会从 `payload_json` 中解析可选媒体字段；旧记录或异常 JSON 会回退为空字段，由前端按平台做兼容判断。后续做真实 QA 或搜索时，再引入更细的表结构。

`source_url` 仍是唯一主键；BVID 兜底只用于 B 站详情读取和写回定位，不改变表结构，也不把 query 变体扩展为新主键。写回时必须使用数据库实际命中的 `source_url`，避免把总结或 ASR 结果写到不存在的新 URL 上。

## 六、请求频控

V0.2.2 使用同一个 SQLite 文件增加 `rate_limits` 表：

- `client_key`：本地客户端标识，当前使用请求来源地址。
- `action`：动作名，当前包括 `parse` 和 `summarize`。
- `count`：当前窗口内已使用次数。
- `window_start`、`updated_at`：用于每小时窗口重置。

默认频控策略遵循工程技术文档：

- `parse`：每小时 20 次。
- `summarize`：每小时 10 次。

缓存命中的 `POST /api/parse` 不计入频控，因为它不触发 yt-dlp 外部解析；真实解析未命中缓存时才计入。真实 QA 仍归入 V0.3，不在当前版本接入。
