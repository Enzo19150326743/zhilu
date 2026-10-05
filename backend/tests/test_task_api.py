import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.tasks import router
from app.services.task_store import TaskStore


class TaskApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.store = TaskStore(Path(self.temporary_directory.name) / "api.sqlite3")
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.store_patch = patch("app.routers.tasks.get_task_store", return_value=self.store)
        self.store_patch.start()

    def tearDown(self) -> None:
        self.store_patch.stop()
        self.temporary_directory.cleanup()

    def test_submit_query_cancel_and_retry(self) -> None:
        response = self.client.post(
            "/api/task-batches",
            json={
                "client_request_id": "api-request-0001",
                "urls": ["https://www.bilibili.com/video/BV123?p=2&spm_id_from=tracker"],
                "target": "analyze",
                "asr_engine": "local_whisper",
            },
        )
        self.assertEqual(response.status_code, 202)
        payload = response.json()
        self.assertIn("p=2", payload["items"][0]["source_url"])
        self.assertNotIn("spm_id_from", payload["items"][0]["source_url"])
        batch_id = payload["batch_id"]
        task_id = payload["items"][0]["task_id"]

        self.assertEqual(self.client.get(f"/api/task-batches/{batch_id}").status_code, 200)
        self.assertEqual(self.client.get(f"/api/tasks/{task_id}").status_code, 200)
        cancelled = self.client.post(
            f"/api/tasks/{task_id}/cancel", json={"batch_id": batch_id}
        )
        self.assertEqual(cancelled.json()["task"]["status"], "cancelled")
        retried = self.client.post(
            f"/api/tasks/{task_id}/retry", json={"batch_id": batch_id}
        )
        self.assertEqual(retried.json()["task"]["status"], "queued")

    def test_50_unique_urls_are_rejected_without_partial_batch(self) -> None:
        response = self.client.post(
            "/api/task-batches",
            json={
                "client_request_id": "api-request-0050",
                "urls": [f"https://example.com/{index}" for index in range(50)],
                "target": "parse_only",
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.store.list_batches()["batches"], [])

    def test_omitted_engine_persists_sensevoice_for_auto_transcription(self) -> None:
        response = self.client.post(
            "/api/task-batches",
            json={
                "client_request_id": "default-asr-engine",
                "urls": ["https://example.com/video"],
                "target": "analyze",
            },
        )

        self.assertEqual(response.status_code, 202)
        task_id = response.json()["items"][0]["task_id"]
        with self.store.connect() as connection:
            row = connection.execute(
                "SELECT settings_json FROM processing_tasks WHERE id=?", (task_id,)
            ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(json.loads(row["settings_json"])["asr_engine"], "sensevoice_small")


if __name__ == "__main__":
    unittest.main()
