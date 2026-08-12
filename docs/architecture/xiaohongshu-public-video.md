# 小红书公开视频基础支持架构说明

> **最后更新**：2026-08-11  
> **能力状态**：正式基础支持

## 一、能力定位

小红书已进入知录正式支持的公开媒体平台范围。当前目标是让公开的视频笔记进入现有知识工作台：解析标题、作者昵称、清晰封面、时长和视频格式；没有平台字幕时，由用户手动触发现有 AI 转写，再继续总结、导图、问答和 Markdown 沉淀。

该能力只处理用户有权访问和分析的公开内容，不处理登录受限、私密、付费、删除或无授权内容。

## 二、核心入口

```text
backend/app/services/
├── media_source_service.py
├── xiaohongshu_service.py
├── ytdlp_service.py
├── asr_service.py
└── library_service.py

frontend/
├── components/
│   ├── LandingHero.tsx
│   ├── TranscribeRequiredState.tsx
│   ├── UrlInput.tsx
│   ├── RecentLibrary.tsx
│   └── VideoPreviewCard.tsx
└── lib/platform-display.ts
```

## 三、数据流

```text
用户粘贴公开小红书视频页面 URL
→ POST /api/parse
→ media_source_service 命中 XiaohongshuVideoSourceAdapter
→ ytdlp_service 获取标题、封面、时长和视频格式
→ xiaohongshu_service 读取公开页面 INITIAL_STATE
→ 从 note.noteDetailMap[note_id].note 取得作者昵称、WB_DFT 清晰封面和带音轨 H.264 视频流
→ 返回 ParseResponse：platform = "xiaohongshu"、author = 公开昵称、thumbnail = 清晰封面、transcription_source_url = 视频流
→ library_service 按原始 source_url 写入 SQLite
→ platform-display 在列表和详情统一显示“小红书”
```

yt-dlp 继续负责已经成熟的视频和格式解析。当前上游 `XiaoHongShuIE` 只导出 `uploader_id`，没有导出公开昵称，而且返回的预览封面可能是色块化的 `WB_PRV` 版本。因此知录通过公开页面补取 `nickname`、`WB_DFT` 清晰封面和转写媒体源，不复制整套视频解析器。

转写前，后端会重新解析一次小红书公开页面以刷新可能带短期签名的媒体流地址，再交给现有 ASR 流程。前端不再把占位字幕“未检测到可用 VTT/SRT 字幕。”误判为真实转写稿。

## 四、稳定合同

- 支持的直接页面路径为 `xiaohongshu.com/explore/<note_id>` 和 `xiaohongshu.com/discovery/item/<note_id>`。
- 小红书 Adapter 必须注册在通用 yt-dlp Adapter 之前，避免跳过作者补齐和平台键规范化。
- 后端稳定平台键为 `xiaohongshu`；面向用户的名称由共享 `getPlatformLabel()` 显示为“小红书”。
- 作者昵称来自公开页面；补取失败时保留“未知作者”，不能阻断视频元数据、格式、AI 转写和总结主流程。
- 封面只允许 `urlDefault` 或 `WB_DFT` 清晰图覆盖 yt-dlp 结果；`urlPre` / `WB_PRV` 不能作为前景封面。
- 工作台视频封面统一使用 4:3 固定画布：前景保持原图比例完整显示，背景仅用同一张图模糊填充留白，禁止裁切或拉伸前景。
- 小红书转写源必须使用页面公开媒体流，不能把笔记分享页 URL 直接交给 ASR；正式转写前应刷新该媒体流地址。
- 本地档案仍以用户提交的原始 `source_url` 为主键。旧档案不会静默联网回填，需要重新解析后更新作者和平台展示。
- 当前没有专用平台字幕链路；页面出现“需转写”是正常状态，用户可手动生成 AI 转写稿。
- 总结、思维导图、内容问答和内容文本在缺少真实转写稿时统一显示一个“生成转写稿”入口，并打开同一套全局转写设置弹窗；内容文本页不再内嵌第二套“转写设置”。

## 五、能力边界

当前不做：

- 登录态、Cookie 自动获取、验证码处理或平台风控绕过；
- 私密、付费、删除或受限内容；
- 图文笔记图片批量提取；
- 账号主页、收藏、评论、搜索和批量采集；
- 无水印承诺或完整小红书下载器；
- 对历史档案自动联网回填。

平台公开页面结构发生变化时，优先修复作者补齐和公开元数据等阻断问题。只有现有 yt-dlp 视频解析长期无法满足主流程时，才评估完整专用解析器。

## 六、验证入口

- `backend/tests/test_xiaohongshu_service.py`：URL 范围、作者提取、清晰封面、转写媒体源、失败降级和 Adapter 顺序。
- `frontend/lib/library-display.test.ts`：面向用户的平台名称映射。
- `frontend/e2e/desktop.spec.ts`：固定 4:3 双层封面、占位字幕与统一转写入口。
- `frontend` 生产构建：列表和详情共同使用 `platform-display.ts`。

产品决策与方案比较见 `docs/plans/2026-08-11-xiaohongshu-public-video-support-design.md`。
