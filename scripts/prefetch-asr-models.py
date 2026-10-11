"""提前缓存知录使用的本地语音模型，避免首次转写临时下载。"""

from __future__ import annotations

import argparse
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


SENSEVOICE_MODEL = "iic/SenseVoiceSmall"
SENSEVOICE_VAD_MODEL = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"


@dataclass(frozen=True)
class ModelTarget:
    name: str
    model_id: str
    approximate_size: str
    source: str


def get_model_targets() -> tuple[ModelTarget, ...]:
    return (
        ModelTarget(
            name="SenseVoiceSmall",
            model_id=SENSEVOICE_MODEL,
            approximate_size="约 0.94 GB",
            source="ModelScope",
        ),
        ModelTarget(
            name="FSMN-VAD",
            model_id=SENSEVOICE_VAD_MODEL,
            approximate_size="较小的辅助模型",
            source="ModelScope",
        ),
    )


def prefetch_models(
    *,
    modelscope_downloader: Callable[[str], str] | None = None,
) -> dict[str, str]:
    """下载识别和 VAD 两个固定目标；测试可注入假下载器，避免访问网络。"""

    if modelscope_downloader is None:
        from modelscope import snapshot_download

        modelscope_downloader = snapshot_download

    downloaded_paths = {
        SENSEVOICE_MODEL: str(modelscope_downloader(SENSEVOICE_MODEL)),
        SENSEVOICE_VAD_MODEL: str(modelscope_downloader(SENSEVOICE_VAD_MODEL)),
    }
    return downloaded_paths


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--plan-only",
        action="store_true",
        help="只显示模型清单，不导入推理依赖或访问网络。",
    )
    return parser


def main() -> int:
    args = _build_argument_parser().parse_args()
    targets = get_model_targets()
    print("知录本地语音模型清单：")
    for target in targets:
        print(
            f"- {target.name}: {target.model_id}，{target.approximate_size}，"
            f"来源 {target.source}"
        )

    if args.plan_only:
        return 0

    print("\n开始下载或复用本地缓存……")
    downloaded_paths = prefetch_models()
    print("\n模型准备完成：")
    for target in targets:
        resolved_path = Path(downloaded_paths[target.model_id]).resolve()
        print(f"- {target.name}: {resolved_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
