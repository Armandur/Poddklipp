"""Beräkna downsampled peak-data för waveform-rendering i UI:t."""

from __future__ import annotations

import json
from pathlib import Path

from .decode import load_mono


def compute_peaks(
    audio_path: str | Path,
    output_path: str | Path,
    num_points: int = 4000,
    sample_rate: int = 22050,
) -> dict:
    """
    Läs in ljud, beräkna `num_points` (min, max)-par och skriv till JSON-fil.

    Returnerar {"peaks_path": str, "duration_ms": int, "sample_rate": int}.
    """
    pcm, sr = load_mono(audio_path, sample_rate)
    duration_ms = int(len(pcm) * 1000 / sr)

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
