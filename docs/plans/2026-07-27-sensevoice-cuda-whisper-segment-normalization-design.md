# SenseVoice CUDA 与 Whisper 片段规范化设计

## 目标

- 保留当前 `experiment/sensevoice-small-eval` 状态作为独立 Git 回滚点。
- SenseVoiceSmall 在 CUDA 版 PyTorch 可用时优先使用 NVIDIA GPU；GPU 运行失败时只在同一引擎内回退 CPU，并在元数据中记录实际设备。
- 不修改 Whisper 的底层音频解码和 VAD，只规范化其过碎的输出片段，减少 DeepSeek 校对的编号和 JSON 开销。
- 原始 Whisper 片段继续完整保存在 `raw_segments`，不牺牲可回看性和回滚能力。

## 方案取舍

### SenseVoice 运行环境

采用“基础可选依赖 + 独立 CUDA 安装脚本”，不把特定 CUDA wheel 地址写进通用 requirements。通用清单负责 FunASR 与 CPU 可运行依赖；Windows NVIDIA 用户通过脚本从 PyTorch 官方 CUDA wheel 源安装匹配版本。运行时 `SENSEVOICE_DEVICE=auto` 先检查 `torch.cuda.is_available()`，可用时尝试 `cuda:0`，失败后回退 CPU。

RTX 3050 Laptop 的 4GB 显存需要更保守的批量。SenseVoice 的 GPU 默认 `batch_size_s` 使用 60 秒，CPU 保持 300 秒；两者均允许环境变量覆盖。GPU 失败时释放模型缓存和 CUDA cache，再进行 CPU 重试。

### Whisper 输出片段规范化

不照搬 SenseVoice 的 20 秒规则。Whisper 原始结果通常缺少可靠标点，直接使用 20 秒上限会把最新样本从 944 段压缩到约 68 段，时间戳过粗。

规范化只合并相邻片段，遵循以下边界：

- 相邻静音间隔达到 2 秒时先结束当前片段。
- 遇到可靠句末标点时结束当前片段。
- 无标点时以 8 秒为默认硬上限。
- 以 120 字符作为额外硬上限，避免语速过快时形成过长 JSON 项。
- 环境变量允许关闭或微调，但默认值面向当前中文长视频场景。

规范化发生在 Whisper 声学识别之后、DeepSeek 校对之前。`raw_segments` 保存模型原始片段；校对输入和最终展示使用规范化片段。SenseVoice 和云端 ASR 暂不套用该规则，因为它们已有各自的句子级时间戳。

## 数据流

```text
Whisper 原始片段
→ 保存原始片段副本
→ 相邻片段规范化（停顿 / 标点 / 8 秒 / 120 字符）
→ DeepSeek 分批校对
→ 最终转写稿
```

```text
SenseVoice 媒体规范化
→ CUDA 可用：60 秒批量尝试 GPU
→ GPU 失败：释放缓存并回退 CPU 300 秒批量
→ SenseVoice 词时间戳恢复句段
→ DeepSeek 分批校对
```

## 错误处理

- CUDA 版 PyTorch 未安装时，状态信息明确说明当前仅能使用 CPU，而不是把“已安装依赖”误报为“GPU 可用”。
- 用户显式配置 `SENSEVOICE_DEVICE=cuda:0` 时不静默回退 CPU；只有 `auto` 才允许 GPU → CPU。
- SenseVoice GPU OOM 或运行错误保留现有日志和 CPU 回退；两个设备均失败时不覆盖已有稿件。
- Whisper 规范化无论是否启用都不改变全文字符顺序；空片段被忽略，非法倒序时间戳按现有模型校验处理。

## 验收

- 自动设备选择在 CUDA 可用时返回 `cuda:0, cpu`，不可用时返回 `cpu`。
- SenseVoice GPU 和 CPU 使用不同默认批量，环境变量可以覆盖。
- Whisper 规范化能在停顿、句末标点、时长和字符上限处稳定断开。
- Whisper 最终稿进入校对前已减少片段数量，同时 `raw_segments` 保留模型原始粒度。
- 关闭规范化后保持历史行为。
- 后端相关单元测试、Python 编译检查和 Git 工作区审计通过。
