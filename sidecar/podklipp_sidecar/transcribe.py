"""Transkribera ett ljudklipp med Whisper."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import soundfile as sf

# Whispers förväntade samplingsfrekvens
_WHISPER_SR = 16000

# Cache av laddade modeller — laddning tar ~2s, så vi cachar per modellnamn.
_model_cache: dict[str, object] = {}


def transcribe_clip(
    episode_path: str,
    offset_ms: int,
    duration_ms: int,
    model_name: str = "base",
    language: str | None = "sv",
) -> str:
    """
    Extrahera [offset_ms, offset_ms+duration_ms] ur episode_path och
    transkribera med Whisper. Returnerar transkriberad text.

    Klipper via ffmpeg till temporär 16 kHz WAV, passar sedan numpy-arrayen
    direkt till Whisper (undviker andra dekodningssteget).
    """
    start_sec = offset_ms / 1000.0
    clip_sec = min(duration_ms, 30_000) / 1000.0

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = Path(f.name)

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss", f"{start_sec:.3f}",
                "-t", f"{clip_sec:.3f}",
                "-i", episode_path,
                "-ar", str(_WHISPER_SR),
                "-ac", "1",
                "-f", "wav",
                str(tmp),
            ],
            check=True,
            capture_output=True,
        )

        audio, _ = sf.read(str(tmp), dtype="float32", always_2d=False)
        model = _get_model(model_name)
        result = model.transcribe(audio, language=language, fp16=False)  # type: ignore[union-attr]
        return result["text"].strip()
    finally:
        tmp.unlink(missing_ok=True)


def model_needs_download(name: str) -> bool:
    """Returnera True om modellen inte är cachad och inte finns lokalt."""
    if name in _model_cache:
        return False
    import os
    cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "whisper")
    return not os.path.exists(os.path.join(cache_dir, f"{name}.pt"))


def _get_model(name: str) -> object:
    if name not in _model_cache:
        import whisper  # lazy import — inte alla miljöer har whisper installerat
        _model_cache[name] = whisper.load_model(name)
    return _model_cache[name]
