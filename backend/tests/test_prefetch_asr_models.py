import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "scripts" / "prefetch-asr-models.py"
)


def _load_prefetch_module():
    spec = importlib.util.spec_from_file_location("prefetch_asr_models", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载模型预下载脚本。")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class PrefetchAsrModelsTests(unittest.TestCase):
    def test_plan_contains_all_runtime_model_targets(self) -> None:
        module = _load_prefetch_module()

        targets = module.get_model_targets()

        self.assertEqual(
            [target.model_id for target in targets],
            [
                "large-v3-turbo",
                "iic/SenseVoiceSmall",
                "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
            ],
        )

    def test_prefetch_uses_injected_downloaders_without_network(self) -> None:
        module = _load_prefetch_module()
        whisper_calls: list[str] = []
        modelscope_calls: list[str] = []

        downloaded = module.prefetch_models(
            whisper_downloader=lambda model_id: whisper_calls.append(model_id)
            or f"whisper/{model_id}",
            modelscope_downloader=lambda model_id: modelscope_calls.append(model_id)
            or f"modelscope/{model_id}",
        )

        self.assertEqual(whisper_calls, ["large-v3-turbo"])
        self.assertEqual(
            modelscope_calls,
            [
                "iic/SenseVoiceSmall",
                "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
            ],
        )
        self.assertEqual(
            downloaded["iic/SenseVoiceSmall"],
            "modelscope/iic/SenseVoiceSmall",
        )


if __name__ == "__main__":
    unittest.main()
