"""
Hitta alla förekomster av en känd jingel i ett långt avsnitt via normerad
FFT cross-correlation (NCC). Förutsätter att jingeln spelas bit-identiskt
varje gång — typiskt sant för studio-producerade poddar.

Framtida möjlighet: Chromaprint/fpcalc-baserad MatchStrategy för fall där
jingeln har remastrats till annan bitrate/EQ. Se README för detaljer.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import fftconvolve, find_peaks


def _peak_normalize(x: np.ndarray) -> np.ndarray:
    """Skala signalen så att |max| = 1. Skyddar numerisk stabilitet för NCC
    när episod och jingel kommer från olika mastrings-nivåer (stream vs wav)."""
    peak = float(np.max(np.abs(x)))
    if peak < 1e-9:
        return x
    return (x / peak).astype(np.float32)


def find_jingle(
    episode: np.ndarray,
    jingle: np.ndarray,
    sample_rate: int,
    threshold: float = 0.6,
) -> list[dict]:
    """
    Returnera alla positioner i `episode` där `jingle` förekommer.

    Båda arrayerna ska vara mono float32, redan laddade med samma sample_rate.

    Returnerar en lista av {"offset_ms": int, "confidence": float} sorterad
    på offset_ms. confidence är NCC-värdet ∈ (0, 1], där 1.0 = perfekt match.
    """
    if len(jingle) == 0 or len(episode) < len(jingle):
        return []

    # DC-offset bort + peak-normalisera innan korrelation. NCC är matematiskt
    # skal-invariant, men float32-aritmetiken blir mer robust när båda signaler
    # ligger i samma dynamiska intervall — vissa chapter-stingers faller annars
    # precis under tröskeln på en hårt limitad stream.
    ep = _peak_normalize((episode - episode.mean()).astype(np.float32))
    jg = _peak_normalize((jingle - jingle.mean()).astype(np.float32))

    # Cross-correlation via FFT: corr[n] = Σ ep[n+k] * jg[k]
    corr = fftconvolve(ep, jg[::-1], mode="valid")

    # Lokal energi i episoden för normering (sliding window = len(jg))
    ones = np.ones(len(jg), dtype=np.float32)
    local_energy = fftconvolve(ep**2, ones, mode="valid")
    jingle_energy = float(np.sum(jg**2))

    # Normerat ∈ [-1, 1]; epsilon skyddar mot division med noll vid tyst passage
    norm = np.sqrt(np.maximum(local_energy, 0) * jingle_energy + 1e-12)
    ncc = (corr / norm).astype(np.float32)

    # Peak-detektion: minst en jingel-längd isär för att undvika dubbel-träff
    peaks, props = find_peaks(ncc, height=threshold, distance=len(jg))

    return sorted(
        [
            {
                "offset_ms": int(p * 1000 / sample_rate),
                "confidence": float(props["peak_heights"][i]),
            }
            for i, p in enumerate(peaks)
        ],
        key=lambda d: d["offset_ms"],
    )


def analyze_episode(
    episode: np.ndarray,
    sample_rate: int,
    jingles: list[dict],
    threshold: float = 0.6,
) -> list[dict]:
    """
    Kör alla jinglar i biblioteket mot avsnittet och returnera en tidssorterad
    lista av alla träffar oavsett typ.

    `jingles` är en lista av:
        {"id": int, "kind": str, "pcm": np.ndarray}

    Returnerar en lista av:
        {"jingle_id": int, "jingle_kind": str, "offset_ms": int, "confidence": float}
    """
    all_detections: list[dict] = []
    for jg in jingles:
        for hit in find_jingle(episode, jg["pcm"], sample_rate, threshold):
            all_detections.append(
                {
                    "jingle_id": jg["id"],
                    "jingle_kind": jg["kind"],
                    "offset_ms": hit["offset_ms"],
                    "confidence": hit["confidence"],
                }
            )
    return sorted(all_detections, key=lambda d: d["offset_ms"])
