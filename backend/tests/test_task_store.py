import tempfile
import unittest
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
            target="analyze",
            settings={"asr_engine": "local_whisper", "context_settings": None},
        )

    def test_creates_49_atomically_and_rejects_capacity_overflow(self) -> None:
        batch_id = self.create_batch(49)
        self.assertEqual(self.store.get_batch(batch_id)["stats"]["total"], 49)
        with self.assertRaises(TaskStoreError) as context:
            self.store.create_batch(
                client_request_id="request-key-0002",
                urls=["https://example.com/extra"],
                target="analyze",
                settings={"asr_engine": "local_whisper"},
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
                target="analyze",
                settings={"asr_engine": "local_whisper", "context_settings": None},
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
