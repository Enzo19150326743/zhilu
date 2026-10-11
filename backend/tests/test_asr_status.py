import unittest
from unittest.mock import patch

from app import main


class AsrStatusTests(unittest.TestCase):
    def test_available_status_contains_only_current_capabilities(self) -> None:
        with patch(
            "app.main.get_sensevoice_status",
            return_value=(True, None),
        ):
            response = main.get_asr_status()

        self.assertTrue(response.sensevoice_available)
        self.assertEqual(set(response.model_dump()), {
            "success", "sensevoice_available", "sensevoice_model", "sensevoice_message",
            "correction_available", "correction_message",
        })

    def test_sensevoice_stays_default_when_dependency_is_unavailable(self) -> None:
        with patch(
            "app.main.get_sensevoice_status",
            return_value=(False, "依赖未安装"),
        ):
            response = main.get_asr_status()

        self.assertFalse(response.sensevoice_available)
        self.assertEqual(response.sensevoice_message, "依赖未安装")


if __name__ == "__main__":
    unittest.main()
