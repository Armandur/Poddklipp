"""Beräkna downsampled peak-data för waveform-rendering i UI:t."""

from __future__ import annotations

import json
from pathlib import Path

from .decode import load_mono


def compute_peaks(
    audio_path: str | Path,
    output_path: str | Path,
    num_points: int | None = None,
    sample_rate: int = 22050,
) -> dict:
    """
    Läs in ljud, beräkna `num_points` (min, max)-par och skriv till JSON-fil.

    Returnerar {"peaks_path": str, "duration_ms": int, "sample_rate": int}.
    """
    pcm, sr = load_mono(audio_path, sample_rate)
    duration_ms = int(len(pcm) * 1000 / sr)

    # ~10 peaks/sekund ger god upplösning vid typiska zoom-nivåer;
    # minst 4 000 för att korta klipp inte ska bli för grova.
    if num_points is None:
        num_points = max(4000, int(len(pcm) / sr * 10))

    # Dela upp i num_points block och ta min/max per block
    chunk_size = max(1, len(pcm) // num_points)
    mins, maxs = [], []
    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i : i + chunk_size]
        mins.append(float(chunk.min()))
        maxs.append(float(chunk.max()))

    output_path = Path(output_path)
    output_path.write_text(
        json.dumps({"mins": mins, "maxs": maxs, "duration_ms": duration_ms}),
        encoding="utf-8",
    )

    return {
        "peaks_path": str(output_path),
        "duration_ms": duration_ms,
        "sample_rate": sr,
    }
