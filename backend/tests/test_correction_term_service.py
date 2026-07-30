import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from app.services import correction_term_service


class CorrectionTermServiceTests(unittest.TestCase):
    def test_first_open_seeds_visible_legacy_terms_only_once(self) -> None:
        with self._temporary_term_library("- DeepSeek\n- Codex\n- DeepSeek\n"):
            first_library = correction_term_service.get_term_library()
            folder_id = first_library.folders[0].id
            correction_term_service.delete_terms(
                [term.id for term in first_library.terms]
            )
            correction_term_service.delete_folder(folder_id)

            second_library = correction_term_service.get_term_library()

        self.assertEqual([folder.name for folder in first_library.folders], ["系统默认"])
        self.assertEqual([term.text for term in first_library.terms], ["Codex", "DeepSeek"])
        self.assertEqual(second_library.folders, [])
        self.assertEqual(second_library.terms, [])

    def test_folder_delete_moves_terms_to_unfiled(self) -> None:
        with self._temporary_term_library(""):
            correction_term_service.create_folder("AI / 科技")
            folder_id = correction_term_service.get_term_library().folders[0].id
            created_count, existing_count = correction_term_service.add_terms(
                ["Cursor", "cursor", "OpenAI"],
                folder_id,
            )
            correction_term_service.delete_folder(folder_id)
            library = correction_term_service.get_term_library()

        self.assertEqual((created_count, existing_count), (2, 0))
        self.assertEqual(library.folders, [])
        self.assertEqual({term.folder_id for term in library.terms}, {None})

    def test_move_rename_delete_and_usage_statistics(self) -> None:
        with self._temporary_term_library(""):
            correction_term_service.create_folder("播客")
            folder_id = correction_term_service.get_term_library().folders[0].id
            correction_term_service.add_terms(["小宇宙", "Shownotes"])
            terms = correction_term_service.get_term_library().terms
            term_by_text = {term.text: term for term in terms}
            correction_term_service.move_terms([term_by_text["小宇宙"].id], folder_id)
            correction_term_service.rename_term(
                term_by_text["Shownotes"].id,
                "Shownotes Pro",
            )
            correction_term_service.record_term_usage(["小宇宙", "新术语"])
            library = correction_term_service.get_term_library()
            new_term = next(term for term in library.terms if term.text == "新术语")
            used_term = next(term for term in library.terms if term.text == "小宇宙")
            correction_term_service.delete_terms([new_term.id])
            final_library = correction_term_service.get_term_library()

        self.assertEqual(used_term.usage_count, 1)
        self.assertIsNotNone(used_term.last_used_at)
        self.assertIsNone(new_term.folder_id)
        self.assertNotIn("新术语", {term.text for term in final_library.terms})
        self.assertIn("Shownotes Pro", {term.text for term in final_library.terms})

    @contextmanager
    def _temporary_term_library(self, glossary_text: str):
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            database_path = temporary_path / "library.sqlite3"
            glossary_path = temporary_path / "asr-glossary.md"
            glossary_path.write_text(glossary_text, encoding="utf-8")
            with patch.object(
                correction_term_service,
                "DATABASE_PATH",
                database_path,
            ):
                with patch.object(
                    correction_term_service,
                    "LEGACY_GLOSSARY_PATH",
                    glossary_path,
                ):
                    yield


if __name__ == "__main__":
    unittest.main()
