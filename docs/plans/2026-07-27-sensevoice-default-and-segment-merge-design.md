# SenseVoice 默认优先与短句合并设计

## 目标

- SenseVoiceSmall 可用时成为转写弹窗的默认选择；未安装可选依赖时自动使用 Whisper。
- 模型选择卡片直接说明适用场景，普通用户只需选择一次，不把双模型对比塑造成必经步骤。
- SenseVoice 的短句在 DeepSeek 校对前合并到更稳定的 4–8 秒粒度，减少编号和 JSON 开销。
- 原始 SenseVoice 词时间戳和句段完整保存在 `raw_segments`，不降低回看能力。

## 优先级与兼容策略

后端能力状态增加 `recommended_engine`。SenseVoice 依赖可用时返回
`sensevoice_small`，否则返回 `local_whisper`。前端每次打开转写弹窗时读取该值，默认选择推荐模型。

后端 `TranscribeRequest.asr_engine` 的缺省值继续保持 `local_whisper`，确保旧客户端和未安装 SenseVoice 的开源环境不会因为升级而失败。正式优先级由能力状态和前端交互表达，不用破坏 API 兼容性。

弹窗卡片按以下顺序和语义展示：

1. SenseVoice：标记“推荐”，突出中文长视频、速度、内容完整性和本地免费。
2. Whisper：突出英文术语、数字和技术内容的相对稳定性，作为手动备选。
3. Fun-ASR-Flash：继续说明上传、计费和配置状态。

“重新转写”和“并排对比”继续保留为已有稿件异常时的兜底能力，但不在首次选择卡片中强调，也不要求用户运行两个模型。

## SenseVoice 短句合并

沿用公共 `transcript_segment_service`，增加“句末标点最小时长”参数：

- 当前累积不足 4 秒时，即使遇到句末标点也继续合并。
- 累积达到 4 秒且遇到句末标点时结束。
- 达到 8 秒或 120 字符时强制结束。
- 相邻片段静音达到 2 秒时立即结束。
- 若未来存在说话人标签，不跨说话人合并。

处理链路：

```text
SenseVoice 原始句段
→ 保存 raw_segments / raw_plain_text
→ 4–8 秒短句合并
→ DeepSeek 校对
→ 最终展示稿
```

Whisper 继续使用当前规则：句末标点可直接结束、8 秒和 120 字符硬上限。两种模型共用实现，但使用独立配置，避免强行套用同一参数。

## 错误与回退

- SenseVoice 不可用时，弹窗默认 Whisper，SenseVoice 卡片禁用并展示原因。
- 用户明确选择 SenseVoice 后如果运行失败，不静默改成 Whisper；保留当前错误提示和已有稿件。
- 云端失败后的“改用本地识别”优先使用当前推荐本地模型；SenseVoice 不可用时才使用 Whisper。
- 关闭 SenseVoice 片段规范化后恢复当前句段行为。

## 验收

- SenseVoice 可用时首次打开弹窗默认选中且排在首位；不可用时默认 Whisper。
- 两张本地模型卡片说明适用内容，不再使用“对比”作为 SenseVoice 主文案。
- SenseVoice 短句能按 4秒最小句末、8秒最大时长、120字符和2秒静音正确合并。
- 校对输入使用合并片段，最终 `raw_segments` 仍保存原始句段。
- Whisper 的现有规范化行为不变。
- 后端全量测试、前端类型检查和生产构建通过。
