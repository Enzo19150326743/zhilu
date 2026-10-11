import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import cuda_runtime


class CudaRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        cuda_runtime._ACTIVATED_DLL_DIRECTORIES.clear()
        cuda_runtime._DLL_DIRECTORY_HANDLES.clear()

    def tearDown(self) -> None:
        cuda_runtime._ACTIVATED_DLL_DIRECTORIES.clear()
        cuda_runtime._DLL_DIRECTORY_HANDLES.clear()

    def test_discovers_only_existing_pytorch_library(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            torch_lib = root / "torch" / "lib"
            torch_lib.mkdir(parents=True)
            (root / "nvidia" / "cublas" / "bin").mkdir(parents=True)
            self.assertEqual(cuda_runtime.discover_cuda_dll_directories([root, root]), [torch_lib.resolve()])

    @unittest.skipUnless(os.name == "nt", "Windows DLL search behavior")
    def test_registers_pytorch_directory_once_without_modifying_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            torch_lib = root / "torch" / "lib"
            torch_lib.mkdir(parents=True)
            with (
                patch.dict(os.environ, {"PATH": "existing-path"}),
                patch("app.services.cuda_runtime.os.add_dll_directory") as register,
            ):
                first = cuda_runtime.activate_cuda_dll_directories([root])
                second = cuda_runtime.activate_cuda_dll_directories([root])
                self.assertEqual(os.environ["PATH"], "existing-path")
            self.assertEqual(first, [torch_lib.resolve()])
            self.assertEqual(second, first)
            register.assert_called_once_with(str(torch_lib.resolve()))

    @unittest.skipUnless(os.name == "nt", "Windows DLL search behavior")
    def test_missing_pytorch_directory_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with patch("app.services.cuda_runtime.os.add_dll_directory") as register:
                self.assertEqual(cuda_runtime.activate_cuda_dll_directories([Path(directory)]), [])
            register.assert_not_called()


if __name__ == "__main__":
    unittest.main()
