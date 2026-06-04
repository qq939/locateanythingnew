#!/usr/bin/env python3
"""Download LocateAnything model files and write progress for the web UI."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download


ROOT = Path(__file__).resolve().parent
PROGRESS_FILE = ROOT / "data" / "model_progress.json"
MODEL_NAME = os.environ.get("LOCATEANYTHING_MODEL", "nvidia/LocateAnything-3B")


def write_progress(**payload):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    current = {}
    if PROGRESS_FILE.exists():
        try:
            current = json.loads(PROGRESS_FILE.read_text("utf-8"))
        except Exception:
            current = {}
    current.update(payload)
    current["updatedAt"] = time.time()
    PROGRESS_FILE.write_text(json.dumps(current, ensure_ascii=False, indent=2), "utf-8")


def main() -> int:
    write_progress(
        ok=True,
        running=True,
        phase="querying",
        message=f"正在读取模型文件列表：{MODEL_NAME}",
        model=MODEL_NAME,
        percent=0,
        currentFile="",
        downloadedFiles=0,
        totalFiles=0,
    )

    api = HfApi()
    info = api.model_info(MODEL_NAME, files_metadata=True)
    siblings = [
        item for item in info.siblings
        if not item.rfilename.endswith((".md", ".gitattributes"))
    ]
    total_files = len(siblings)
    total_size = sum((getattr(item, "size", None) or 0) for item in siblings)
    downloaded_size = 0

    write_progress(
        phase="downloading",
        message=f"开始下载 {total_files} 个模型文件",
        totalFiles=total_files,
        totalBytes=total_size,
        percent=2,
    )

    for index, item in enumerate(siblings, start=1):
        name = item.rfilename
        size = getattr(item, "size", None) or 0
        write_progress(
            phase="downloading",
            message=f"正在下载 {name}",
            currentFile=name,
            downloadedFiles=index - 1,
            totalFiles=total_files,
            downloadedBytes=downloaded_size,
            totalBytes=total_size,
            percent=max(2, round(((index - 1) / max(1, total_files)) * 96)),
        )
        hf_hub_download(repo_id=MODEL_NAME, filename=name)
        downloaded_size += size
        write_progress(
            phase="downloading",
            message=f"已完成 {name}",
            currentFile=name,
            downloadedFiles=index,
            totalFiles=total_files,
            downloadedBytes=downloaded_size,
            totalBytes=total_size,
            percent=max(3, round((index / max(1, total_files)) * 96)),
        )

    write_progress(
        ok=True,
        running=False,
        phase="ready",
        message="模型文件已下载完成，首次推理会继续加载权重到内存",
        percent=100,
        downloadedFiles=total_files,
        totalFiles=total_files,
        downloadedBytes=downloaded_size,
        totalBytes=total_size,
        currentFile="",
        finishedAt=time.time(),
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        write_progress(
            ok=False,
            running=False,
            phase="error",
            message=str(exc),
            error=str(exc),
            percent=0,
        )
        raise
