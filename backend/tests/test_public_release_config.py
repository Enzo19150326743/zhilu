import unittest
from pathlib import Path

from app.config import APP_VERSION


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_EXAMPLE_PATH = PROJECT_ROOT / "backend" / ".env.example"


def _read_env_example() -> dict[str, str]:
    entries: dict[str, str] = {}
    for raw_line in ENV_EXAMPLE_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        entries[name.strip()] = value.strip()
    return entries


class PublicReleaseConfigTests(unittest.TestCase):
    def test_public_version_matches_first_open_source_release(self) -> None:
        self.assertEqual(APP_VERSION, "0.1.0")

    def test_env_example_keeps_secrets_empty_and_cookie_options_disabled(self) -> None:
        entries = _read_env_example()

        self.assertEqual(entries["AI_API_KEY"], "")
        self.assertEqual(entries["BILIBILI_ENABLE_COOKIE_OPTIONS"], "0")
        self.assertEqual(entries["YTDLP_ENABLE_COOKIE_OPTIONS"], "0")
        self.assertEqual(entries["BILIBILI_COOKIE_FILE"], "")
        self.assertEqual(entries["YTDLP_COOKIE_FILE"], "")
        self.assertEqual(entries["YTDLP_COOKIES_FROM_BROWSER"], "")
        self.assertEqual(entries["OBSIDIAN_ENABLE_VAULT_WRITE"], "0")
        self.assertEqual(entries["OBSIDIAN_VAULT_DIR"], "")


if __name__ == "__main__":
    unittest.main()
