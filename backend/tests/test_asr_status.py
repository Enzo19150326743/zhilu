import os
import unittest
from unittest.mock import patch

from app import main


class AsrStatusTests(unittest.TestCase):
    def test_sensevoice_is_recommended_when_available(self) -> None:
        with patch(
            "app.main.get_sensevoice_status",
            return_value=(True, None),
        ):
            with patch.dict(
                os.environ,
                {"ASR_WHISPER_MODEL": "large-v3-turbo"},
                clear=False,
            ):
                response = main.get_asr_status()

        self.assertEqual(response.recommended_engine, "sensevoice_small")
        self.assertEqual(response.whisper_model, "large-v3-turbo")

    def test_whisper_is_recommended_when_sensevoice_is_unavailable(self) -> None:
        with patch(
            "app.main.get_sensevoice_status",
            return_value=(False, "依赖未安装"),
        ):
            response = main.get_asr_status()

        self.assertEqual(response.recommended_engine, "local_whisper")
        self.assertFalse(response.sensevoice_available)


if __name__ == "__main__":
    unittest.main()
