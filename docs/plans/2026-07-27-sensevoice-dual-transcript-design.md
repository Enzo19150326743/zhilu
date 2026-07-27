# SenseVoiceSmall 双模型转写与稿件对比设计

## 目标

在不替换现有生产 ASR 的前提下，把 SenseVoiceSmall 作为第二条本地转写路径接入视界。
同一媒体可以分别使用 Whisper、SenseVoiceSmall 或现有 Fun-ASR-Flash 重转写，成功结果按引擎独立保存，供用户通过版本切换和并排阅读直接判断质量与速度。

## Git 与回滚

- 实施前基线提交：`265d633`。
- 固定备份分支：`backup/pre-sensevoice-small-20260727`。
- 实验分支：`experiment/sensevoice-small-eval`。
- SenseVoice 实验失败时切回备份分支即可恢复代码；模型缓存和 Python 包不进入 Git，按需另行清理。

## 后端设计

转写请求的 `asr_engine` 扩展为 `local_whisper`、`sensevoice_small` 和
`fun_asr_flash`。SenseVoiceSmall 复用现有媒体解析与下载链路，ffmpeg 将实际媒体统一转换为适合本地识别的 16 kHz 单声道音频，再通过 `SenseVoiceSmall + FSMN-VAD` 生成文本和片段级时间戳。

三条 ASR 路径都继续进入现有 DeepSeek 分批校对，保留原始稿、校对稿和失败回退。转写元数据增加声学识别、校对和总耗时，供前端比较。SenseVoice 失败不得覆盖已有稿件，也不得静默回退 Whisper。

历史数据继续把当前激活稿写在原有 `transcript` 字段中，同时在媒体
`payload_json.transcript_variants` 中按引擎保存独立版本。旧历史没有该字段时保持兼容；新版本成功后才写入对应引擎并切换当前激活稿。

## 前端设计

转写设置弹窗展示三个选项：本地 Whisper、本地 SenseVoiceSmall 和云端 Fun-ASR-Flash。已有转写稿时仍可重新打开弹窗选择其他引擎。

内容文本页在存在多个版本时显示稿件版本选择器。Whisper 与 SenseVoiceSmall 都存在时提供并排对比视图，两列分别显示完整稿件、引擎、模型、识别耗时、校对耗时和总耗时。两边独立滚动，不强行按句对齐，避免不同 VAD 分段被错误配对。

## 依赖与资源

SenseVoice 作为可选本地能力管理，增加独立依赖清单和可用状态接口。未安装依赖或模型不可用时，前端禁用该选项并给出明确说明，不影响 Whisper。模型仅在用户选择 SenseVoice 时加载；优先使用 CUDA，显存不足时允许明确回退 CPU并记录实际设备。

本期不接入 CAM++，避免把说话人分离开销混入模型体感比较；现有 DeepSeek 说话人辅助逻辑保持不变。

## 验证

- 三种引擎的请求参数与旧请求默认 Whisper 兼容。
- SenseVoice 输出能映射为现有 `TranscriptPayload`，时间戳单调且全文不为空。
- 同一媒体的不同引擎结果可以同时保存、切换和并排查看。
- 新转写失败不覆盖任何已有版本。
- UI 清楚展示实际设备与三个阶段耗时。
- 后端单元测试、前端类型检查、生产构建和至少一条本地 SenseVoice 真实音频冒烟通过。
