import logging
import os
import site
import sysconfig
from collections.abc import Iterable
from pathlib import Path


logger = logging.getLogger(__name__)



# Windows 只在句柄存活期间保留 DLL 搜索目录，因此必须由模块长期持有。
_DLL_DIRECTORY_HANDLES: list[object] = []
_ACTIVATED_DLL_DIRECTORIES: set[Path] = set()


def discover_cuda_dll_directories(
    search_roots: Iterable[Path] | None = None,
) -> list[Path]:
    """查找当前 Python 环境中由 PyTorch 安装的 DLL 目录。"""
    roots = list(search_roots) if search_roots is not None else _python_package_roots()
    directories: list[Path] = []

    for root in roots:
        candidate = (Path(root) / "torch" / "lib").resolve()
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
