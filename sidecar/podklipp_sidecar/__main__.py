"""
JSON-RPC-loop över stdio. Tauri-core spawnar denna process och kommunicerar
via newline-separerade JSON-meddelanden.

Protokoll:
  Request:  {"id": <int>, "method": <str>, "params": <obj>}
  Response: {"id": <int>, "result": <obj>}  eller  {"id": <int>, "error": <str>}
  Progress: {"progress": <float 0-1>, "stage": <str>}  (ingen id)
"""

from __future__ import annotations

import json
import sys
import traceback

import numpy as np

from .decode import load_mono
from .match import analyze_episode
from .waveform import compute_peaks

# Cache avkodat PCM per fil så att flera jinglar inte kräver re-dekodning
_pcm_cache: dict[str, tuple[np.ndarray, int]] = {}


def _get_pcm(path: str, sample_rate: int = 22050) -> tuple[np.ndarray, int]:
    if path not in _pcm_cache:
        _pcm_cache[path] = load_mono(path, sample_rate)
    return _pcm_cache[path]


def handle(method: str, params: dict) -> dict:
    if method == "ping":
        return {"pong": True}

    if method == "decode":
        pcm, sr = _get_pcm(params["path"], params.get("sample_rate", 22050))
        duration_ms = int(len(pcm) * 1000 / sr)
        return {"duration_ms": duration_ms, "sample_rate": sr}

    if method == "waveform":
        return compute_peaks(
            audio_path=params["path"],
            output_path=params["output_path"],
            num_points=params.get("num_points", 4000),
            sample_rate=params.get("sample_rate", 22050),
        )

    if method == "analyze":
        episode_pcm, sr = _get_pcm(params["episode_path"], params.get("sample_rate", 22050))

        jingles_with_pcm = []
        total = len(params["jingles"])
        for i, jg in enumerate(params["jingles"]):
            _progress(i / total, f"laddar jingel {i + 1}/{total}")
            pcm, _ = _get_pcm(jg["file_path"], sr)
            jingles_with_pcm.append({"id": jg["id"], "kind": jg["kind"], "pcm": pcm})

        _progress(0.5, "korrelerar")
        detections = analyze_episode(
            episode_pcm,
            sr,
            jingles_with_pcm,
            threshold=params.get("threshold", 0.6),
        )
        # Ta bort pcm-arrayen ur resultatet (inte JSON-serialiserbart)
        _progress(1.0, "klar")
        return {"detections": detections}

    raise ValueError(f"okänd metod: {method!r}")


def _progress(value: float, stage: str) -> None:
    print(json.dumps({"progress": value, "stage": stage}), flush=True)


def main() -> None:
    # Tvinga UTF-8 på stdio — Rust skickar UTF-8, Windows default cp1252 ger
    # mojibake (ä → Ã¤) annars. Belt-and-suspenders: env-vars sätts också
    # från Rust-sidan, men reconfigure() här säkrar om något missas.
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
            result = handle(req["method"], req.get("params", {}))
            print(json.dumps({"id": req["id"], "result": result}), flush=True)
        except Exception as exc:
            req_id = json.loads(raw).get("id") if raw else None
            print(
                json.dumps({"id": req_id, "error": str(exc), "trace": traceback.format_exc()}),
                flush=True,
            )


if __name__ == "__main__":
    main()
