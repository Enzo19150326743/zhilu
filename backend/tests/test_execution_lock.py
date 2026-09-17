import tempfile
import unittest
from pathlib import Path

from app.services.execution_lock import ExecutionLock, ExecutionLockError


class ExecutionLockTests(unittest.TestCase):
    def test_only_one_process_lock_holder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runner.lock"
            first = ExecutionLock(path)
            second = ExecutionLock(path)
            first.acquire()
            try:
                with self.assertRaises(ExecutionLockError):
                    second.acquire()
            finally:
                first.release()
            second.acquire()
            second.release()


if __name__ == "__main__":
    unittest.main()
