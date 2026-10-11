import tempfile
import unittest
import json
from pathlib import Path

from app.services.task_store import TaskStore, TaskStoreError


class TaskStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.store = TaskStore(Path(self.temporary_directory.name) / "tasks.sqlite3")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def create_batch(self, count: int = 3, key: str = "request-key-0001") -> str:
        return self.store.create_batch(
            client_request_id=key,
            urls=[f"https://example.com/video/{index}" for index in range(count)],
            settings={"context_settings": None},
        )

    def test_legacy_migration_preserves_history_checkpoints_and_idempotency(self) -> None:
        batch_id = self.create_batch(2)
        task_id = self.store.get_batch(batch_id)["items"][0]["task_id"]
        legacy_settings = json.dumps({
            "asr_engine": "removed-engine", "context_settings": None, "client_key": "local",
        })
        checkpoint = json.dumps({"recognition": {"raw_text": "已有原始稿"}, "audio_download_seconds": 8})
        with self.store.connect(immediate=True) as connection:
            connection.execute("ALTER TABLE processing_batches ADD COLUMN target TEXT NOT NULL DEFAULT 'parse_only'")
            connection.execute("ALTER TABLE processing_tasks ADD COLUMN target TEXT NOT NULL DEFAULT 'parse_only'")
            connection.execute("DROP INDEX idx_processing_tasks_identity")
            connection.execute("CREATE INDEX idx_processing_tasks_identity ON processing_tasks(normalized_url, target, settings_hash)")
            connection.execute("UPDATE processing_batches SET settings_json=?, request_hash='old-request-hash'", (legacy_settings,))
            connection.execute("UPDATE processing_tasks SET settings_json=?, settings_hash='old-settings-hash'", (legacy_settings,))
            connection.execute("UPDATE processing_tasks SET checkpoint_json=?, status='failed', stage='correct', video_id='existing-video' WHERE id=?", (checkpoint, task_id))
            connection.execute("CREATE TABLE saved_content (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
            connection.execute("INSERT INTO saved_content VALUES ('article', '保留用户内容')")

        migrated = TaskStore(self.store.database_path)
        self.assertEqual(migrated.create_batch(
            client_request_id="request-key-0001",
            urls=[f"https://example.com/video/{index}" for index in range(2)],
            settings={"context_settings": None},
        ), batch_id)
        self.assertNotIn("target", migrated.get_batch(batch_id))
        with migrated.connect() as connection:
            for table in ("processing_batches", "processing_tasks"):
                self.assertNotIn("target", {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")})
            row = connection.execute("SELECT * FROM processing_tasks WHERE id=?", (task_id,)).fetchone()
            self.assertEqual(row["checkpoint_json"], checkpoint)
            self.assertEqual(row["video_id"], "existing-video")
            self.assertEqual(row["status"], "failed")
            self.assertEqual(json.loads(row["settings_json"]), {"context_settings": None, "client_key": "local"})
            self.assertEqual(connection.execute("SELECT body FROM saved_content").fetchone()[0], "保留用户内容")
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
        migrated.retry(task_id, batch_id)
        self.assertEqual(migrated.get_task(task_id)["status"], "queued")
        restarted = TaskStore(migrated.database_path)
        self.assertEqual(restarted.get_batch(batch_id), migrated.get_batch(batch_id))

    def test_failed_migration_rolls_back_schema_and_keeps_task_data(self) -> None:
        batch_id = self.create_batch(1)
        with self.store.connect(immediate=True) as connection:
            connection.execute("ALTER TABLE processing_batches ADD COLUMN target TEXT NOT NULL DEFAULT 'analyze'")
            connection.execute("ALTER TABLE processing_tasks ADD COLUMN target TEXT NOT NULL DEFAULT 'analyze'")
            connection.execute("UPDATE processing_tasks SET settings_json='invalid-json'")
        with self.assertRaises(json.JSONDecodeError):
            TaskStore(self.store.database_path)
        with self.store.connect() as connection:
            self.assertIn("target", {row["name"] for row in connection.execute("PRAGMA table_info(processing_tasks)")})
            self.assertEqual(connection.execute("SELECT settings_json FROM processing_tasks").fetchone()[0], "invalid-json")
            self.assertEqual(connection.execute("SELECT id FROM processing_batches").fetchone()[0], batch_id)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM processing_batch_items").fetchone()[0], 1)

    def test_creates_49_atomically_and_rejects_capacity_overflow(self) -> None:
        batch_id = self.create_batch(49)
        self.assertEqual(self.store.get_batch(batch_id)["stats"]["total"], 49)
        with self.assertRaises(TaskStoreError) as context:
            self.store.create_batch(
                client_request_id="request-key-0002",
                urls=["https://example.com/extra"],
                settings={"context_settings": None},
            )
        self.assertEqual(context.exception.error_code, "ACTIVE_TASK_CAPACITY_EXCEEDED")
        self.assertEqual(len(self.store.list_batches()["batches"]), 1)

    def test_idempotency_key_returns_same_batch_and_rejects_other_payload(self) -> None:
        first_id = self.create_batch()
        self.assertEqual(first_id, self.create_batch())
        with self.assertRaises(TaskStoreError) as context:
            self.store.create_batch(
                client_request_id="request-key-0001",
                urls=["https://example.com/different"],
                settings={"context_settings": None},
            )
        self.assertEqual(context.exception.status_code, 409)

    def test_two_batches_reuse_active_tasks_and_cancel_only_one_link(self) -> None:
        first_id = self.create_batch(1, "request-key-first")
        second_id = self.create_batch(1, "request-key-second")
        first = self.store.get_batch(first_id)
        second = self.store.get_batch(second_id)
        self.assertEqual(first["items"][0]["task_id"], second["items"][0]["task_id"])
        task_id = first["items"][0]["task_id"]
        self.store.cancel(task_id, first_id)
        self.assertEqual(self.store.get_batch(first_id)["items"][0]["status"], "cancelled")
        self.assertEqual(self.store.get_batch(second_id)["items"][0]["status"], "queued")

    def test_claim_token_prevents_late_worker_write(self) -> None:
        batch_id = self.create_batch(1)
        claimed = self.store.claim_next()
        self.assertIsNotNone(claimed)
        task_id = claimed["id"]
        self.assertFalse(self.store.finish(task_id, "wrong-token"))
        self.assertTrue(self.store.finish(task_id, claimed["execution_token"]))
        snapshot = self.store.get_batch(batch_id)
        self.assertEqual(snapshot["items"][0]["status"], "succeeded")

    def test_retry_keeps_checkpoint(self) -> None:
        batch_id = self.create_batch(1)
        claimed = self.store.claim_next()
        self.store.update_running(
            claimed["id"], claimed["execution_token"], checkpoint_json={"parsed": True}
        )
        self.store.fail(claimed["id"], claimed["execution_token"], "BROKEN", "failed")
        self.store.retry(claimed["id"], batch_id)
        reclaimed = self.store.claim_next()
        self.assertEqual(reclaimed["checkpoint"], {"parsed": True})

    def test_recovery_does_not_repeat_uncertain_ai_request(self) -> None:
        batch_id = self.create_batch(1)
        claimed = self.store.claim_next()
        self.store.update_running(
            claimed["id"],
            claimed["execution_token"],
            stage="summarize",
            checkpoint_json={"ai_inflight": "summarize"},
        )
        self.store.recover_interrupted()
        item = self.store.get_batch(batch_id)["items"][0]
        self.assertEqual(item["status"], "failed")
        self.assertEqual(item["error_code"], "AI_RESULT_UNCERTAIN")


if __name__ == "__main__":
    unittest.main()
