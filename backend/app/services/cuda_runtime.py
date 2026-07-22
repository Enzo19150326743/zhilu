import logging
import os
import site
import sysconfig
from collections.abc import Iterable
from pathlib import Path


logger = logging.getLogger(__name__)

_NVIDIA_COMPONENT_BIN_PATHS = (
    Path("nvidia") / "cublas" / "bin",
    Path("nvidia") / "cudnn" / "bin",
    Path("nvidia") / "cuda_nvrtc" / "bin",
    Path("nvidia") / "cuda_runtime" / "bin",
)

# Windows 只在句柄存活期间保留 DLL 搜索目录，因此必须由模块长期持有。
_DLL_DIRECTORY_HANDLES: list[object] = []
_ACTIVATED_DLL_DIRECTORIES: set[Path] = set()


def discover_cuda_dll_directories(
    search_roots: Iterable[Path] | None = None,
) -> list[Path]:
    """查找当前 Python 环境中由 NVIDIA wheel 安装的 DLL 目录。"""
    roots = list(search_roots) if search_roots is not None else _python_package_roots()
    directories: list[Path] = []

    for root in roots:
        for relative_path in _NVIDIA_COMPONENT_BIN_PATHS:
            candidate = (Path(root) / relative_path).resolve()
            if candidate.is_dir() and candidate not in directories:
                directories.append(candidate)

    return directories


def activate_cuda_dll_directories(
    search_roots: Iterable[Path] | None = None,
) -> list[Path]:
    """仅为当前 Windows Python 进程注册项目内 CUDA DLL 搜索目录。"""
    directories = discover_cuda_dll_directories(search_roots)
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return directories

    _prepend_to_process_path(directories)

    for directory in directories:
        if directory in _ACTIVATED_DLL_DIRECTORIES:
            continue

        try:
            handle = os.add_dll_directory(str(directory))
        except OSError as error:
            logger.warning(
                "cuda dll directory activation failed: directory=%s error=%s",
                directory,
                error.__class__.__name__,
            )
            continue

        _DLL_DIRECTORY_HANDLES.append(handle)
        _ACTIVATED_DLL_DIRECTORIES.add(directory)

    return directories


def _prepend_to_process_path(directories: Iterable[Path]) -> None:
    """让 CTranslate2 的运行时 LoadLibrary 也能发现项目内 CUDA DLL。"""
    current_path = os.environ.get("PATH", "")
    current_entries = [entry for entry in current_path.split(os.pathsep) if entry]
    normalized_entries = {os.path.normcase(entry) for entry in current_entries}
    new_entries = [
        str(directory)
        for directory in directories
        if os.path.normcase(str(directory)) not in normalized_entries
    ]
    if new_entries:
        os.environ["PATH"] = os.pathsep.join([*new_entries, *current_entries])


def _python_package_roots() -> list[Path]:
    roots = [Path(path) for path in site.getsitepackages()]
    purelib = sysconfig.get_paths().get("purelib")
    if purelib:
        roots.append(Path(purelib))

    unique_roots: list[Path] = []
    for root in roots:
        resolved = root.resolve()
        if resolved not in unique_roots:
            unique_roots.append(resolved)
    return unique_roots
