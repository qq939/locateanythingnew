#!/usr/bin/env python3
"""Line-delimited JSON service wrapper for LocateAnything video annotation."""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import traceback
from typing import Any


MODEL_NAME = os.environ.get("LOCATEANYTHING_MODEL", "nvidia/LocateAnything-3B")
MOCK = os.environ.get("LOCATEANYTHING_MOCK", "").lower() in {"1", "true", "yes"}


def write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def dependency_status() -> dict[str, Any]:
    modules = {}
    for name, module_name in {"torch": "torch", "transformers": "transformers", "Pillow": "PIL"}.items():
        try:
            module = __import__(module_name)
            modules[name] = {"ok": True, "version": getattr(module, "__version__", "unknown")}
        except Exception as exc:
            modules[name] = {"ok": False, "error": str(exc)}
    return {
        "ok": all(item["ok"] for item in modules.values()),
        "mock": MOCK,
        "model": MODEL_NAME,
        "python": sys.executable,
        "modules": modules,
    }


def image_from_payload(payload: dict[str, Any]):
    from PIL import Image

    image_data = payload.get("image", "")
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    raw = base64.b64decode(image_data)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def choose_device_and_dtype():
    import torch

    requested = os.environ.get("LOCATEANYTHING_DEVICE")
    if requested:
        device = requested
    elif torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    return device, dtype


def mock_result(payload: dict[str, Any]) -> dict[str, Any]:
    width = int(payload.get("width") or 1280)
    height = int(payload.get("height") or 720)
    query = payload.get("query") or payload.get("classes") or "LocateAnything"
    x1, y1 = round(width * 0.32), round(height * 0.27)
    x2, y2 = round(width * 0.64), round(height * 0.58)
    answer = f"<ref>{query}</ref><box><320><270><640><580></box>"
    return {
        "ok": True,
        "mock": True,
        "answer": answer,
        "boxes": [{"x1": x1, "y1": y1, "x2": x2, "y2": y2, "label": query, "confidence": None}],
        "points": [],
        "stats": {"note": "LOCATEANYTHING_MOCK=1 enabled; no model inference was run."},
    }


class LocateService:
    def __init__(self) -> None:
        self.worker = None

    def load(self):
        if self.worker is not None:
            return self.worker
        from locateanything_worker import LocateAnythingWorker

        device, dtype = choose_device_and_dtype()
        self.worker = LocateAnythingWorker(MODEL_NAME, device=device, dtype=dtype)
        return self.worker

    def locate(self, payload: dict[str, Any]) -> dict[str, Any]:
        if MOCK:
            return mock_result(payload)

        worker = self.load()
        image = image_from_payload(payload)
        mode = payload.get("mode", "detect")
        query = (payload.get("query") or "").strip()
        output_type = payload.get("outputType", "box")
        generation_kwargs = {
            "generation_mode": payload.get("generationMode", "hybrid"),
            "max_new_tokens": int(payload.get("maxNewTokens") or 2048),
            "temperature": float(payload.get("temperature") or 0.7),
            "verbose": True,
        }

        if mode == "detect":
            categories = [item.strip() for item in query.split(",") if item.strip()]
            result = worker.detect(image, categories or ["object"], **generation_kwargs)
        elif mode == "ground_single":
            result = worker.ground_single(image, query, **generation_kwargs)
        elif mode == "ground_multi":
            result = worker.ground_multi(image, query, **generation_kwargs)
        elif mode == "ground_text":
            result = worker.ground_text(image, query, **generation_kwargs)
        elif mode == "detect_text":
            result = worker.detect_text(image, **generation_kwargs)
        elif mode == "ground_gui":
            result = worker.ground_gui(image, query, output_type=output_type, **generation_kwargs)
        elif mode == "point":
            result = worker.point(image, query, **generation_kwargs)
        else:
            raise ValueError(f"Unsupported LocateAnything mode: {mode}")

        width, height = image.size
        answer = str(result.get("answer", ""))
        boxes = worker.parse_boxes(answer, width, height)
        points = worker.parse_points(answer, width, height)
        for box in boxes:
            box["label"] = query or mode
            box["confidence"] = None
        for point in points:
            point["label"] = query or mode

        return {
            "ok": True,
            "mock": False,
            "answer": answer,
            "boxes": boxes,
            "points": points,
            "stats": result.get("stats"),
            "history": result.get("history"),
        }


def serve() -> int:
    service = LocateService()
    write({"ok": True, "ready": True, "status": dependency_status()})
    for line in sys.stdin:
        try:
            payload = json.loads(line)
            request_id = payload.get("id")
            if payload.get("type") == "status":
                write({"id": request_id, "ok": True, "status": dependency_status()})
            elif payload.get("type") == "locate":
                write({"id": request_id, **service.locate(payload)})
            else:
                write({"id": request_id, "ok": False, "error": "unknown request type"})
        except Exception as exc:
            write({"id": payload.get("id") if "payload" in locals() else None, "ok": False, "error": str(exc), "traceback": traceback.format_exc()})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        write(dependency_status())
        return 0
    return serve()


if __name__ == "__main__":
    raise SystemExit(main())
