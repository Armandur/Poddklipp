"""Ladda ljudfil till mono float32 PCM med vald sample_rate."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf


def load_mono(path: str | Path, target_sr: int = 22050) -> tuple[np.ndarray, int]:
    """
    Returnera (pcm, sample_rate) som mono float32.

    Försöker först soundfile (WAV/FLAC/OGG). Om det misslyckas (t.ex. MP3/M4A)
    faller den tillbaka på ffmpeg för att konvertera till temporär WAV.
    """
    path = Path(path)
    try:
        pcm, sr = sf.read(str(path), dtype="float32", always_2d=False)
    except Exception:
        pcm, sr = _decode_via_ffmpeg(path)

    if pcm.ndim > 1:
        pcm = pcm.mean(axis=1)

    if sr != target_sr:
        pcm = _resample(pcm, sr, target_sr)
        sr = target_sr

    return pcm.astype(np.float32), sr


def _decode_via_ffmpeg(path: Path) -> tuple[np.ndarray, int]:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    subprocess.run(
        ["ffmpeg", "-y", "-i", str(path), "-ac", "1", "-ar", "22050", tmp_path],
        check=True,
        capture_output=True,
    )
    pcm, sr = sf.read(tmp_path, dtype="float32")
    Path(tmp_path).unlink(missing_ok=True)
    return pcm, sr


def _resample(pcm: np.ndarray, from_sr: int, to_sr: int) -> np.ndarray:
    # Enkel linjär resampling; tillräckligt för jingel-matching.
    # Byt till scipy.signal.resample_poly om precision krävs.
    if from_sr == to_sr:
        return pcm
    new_len = int(len(pcm) * to_sr / from_sr)
    return np.interp(
        np.linspace(0, len(pcm) - 1, new_len),
        np.arange(len(pcm)),
        pcm,
    ).astype(np.float32)
