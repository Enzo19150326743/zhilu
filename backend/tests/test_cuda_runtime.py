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

    def test_discover_cuda_dll_directories_returns_only_existing_component_bins(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            site_packages = Path(temporary_directory)
            cublas_bin = site_packages / "nvidia" / "cublas" / "bin"
            cudnn_bin = site_packages / "nvidia" / "cudnn" / "bin"
            nvrtc_bin = site_packages / "nvidia" / "cuda_nvrtc" / "bin"
            cublas_bin.mkdir(parents=True)
            cudnn_bin.mkdir(parents=True)
            nvrtc_bin.mkdir(parents=True)
            expected_directories = [
                cublas_bin.resolve(),
                cudnn_bin.resolve(),
                nvrtc_bin.resolve(),
            ]

            directories = cuda_runtime.discover_cuda_dll_directories([site_packages])

        self.assertEqual(directories, expected_directories)

    @unittest.skipUnless(os.name == "nt", "Windows DLL search behavior")
    def test_activate_cuda_dll_directories_registers_each_directory_once(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            site_packages = Path(temporary_directory)
            cublas_bin = site_packages / "nvidia" / "cublas" / "bin"
            cudnn_bin = site_packages / "nvidia" / "cudnn" / "bin"
            cublas_bin.mkdir(parents=True)
            cudnn_bin.mkdir(parents=True)
            resolved_cublas_bin = cublas_bin.resolve()
            resolved_cudnn_bin = cudnn_bin.resolve()

            with patch.dict(os.environ, {"PATH": "existing-path"}, clear=False):
                with patch(
                    "app.services.cuda_runtime.os.add_dll_directory"
                ) as add_dll_directory:
                    first = cuda_runtime.activate_cuda_dll_directories([site_packages])
                    second = cuda_runtime.activate_cuda_dll_directories([site_packages])
                    process_path = os.environ["PATH"]

        self.assertEqual(first, [resolved_cublas_bin, resolved_cudnn_bin])
        self.assertEqual(second, [resolved_cublas_bin, resolved_cudnn_bin])
        self.assertEqual(add_dll_directory.call_count, 2)
        add_dll_directory.assert_any_call(str(resolved_cublas_bin))
        add_dll_directory.assert_any_call(str(resolved_cudnn_bin))
        self.assertEqual(
            process_path,
            os.pathsep.join(
                [str(resolved_cublas_bin), str(resolved_cudnn_bin), "existing-path"]
            ),
        )

    @unittest.skipUnless(os.name == "nt", "Windows DLL search behavior")
    def test_activate_cuda_dll_directories_ignores_missing_packages(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            site_packages = Path(temporary_directory)

            with patch(
                "app.services.cuda_runtime.os.add_dll_directory"
            ) as add_dll_directory:
                directories = cuda_runtime.activate_cuda_dll_directories(
                    [site_packages]
                )

        self.assertEqual(directories, [])
        add_dll_directory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
