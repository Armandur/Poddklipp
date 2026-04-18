"""
Enhetstester för matchningsalgoritmen.

Syntetiska signaler används för att undvika beroende av riktiga ljudfiler.
Kända jingel-offsets bäddas in i ett längre "avsnitt" och vi verifierar
att find_jingle hittar dem inom ±50 ms.
"""

import numpy as np

from podklipp_sidecar.match import analyze_episode, find_jingle

SR = 22050
TOLERANCE_MS = 50


def _sine(freq: float, duration_s: float, sr: int = SR) -> np.ndarray:
    t = np.linspace(0, duration_s, int(duration_s * sr), endpoint=False)
    return np.sin(2 * np.pi * freq * t).astype(np.float32)


def _embed(episode: np.ndarray, jingle: np.ndarray, offset_ms: int) -> np.ndarray:
    result = episode.copy()
    start = int(offset_ms / 1000 * SR)
    end = start + len(jingle)
    result[start:end] += jingle
    return result


class TestFindJingle:
    def test_finds_single_occurrence(self):
        jingle = _sine(440, 0.5)
        episode = np.random.default_rng(0).uniform(-0.1, 0.1, SR * 60).astype(np.float32)
        offset_ms = 15_000
        episode = _embed(episode, jingle, offset_ms)

        hits = find_jingle(episode, jingle, SR)

        assert len(hits) == 1
        assert abs(hits[0]["offset_ms"] - offset_ms) <= TOLERANCE_MS
        assert hits[0]["confidence"] > 0.7

    def test_finds_multiple_occurrences(self):
        jingle = _sine(880, 0.3)
        episode = np.random.default_rng(1).uniform(-0.05, 0.05, SR * 120).astype(np.float32)
        expected_offsets = [5_000, 45_000, 90_000]
        for off in expected_offsets:
            episode = _embed(episode, jingle, off)

        hits = find_jingle(episode, jingle, SR)
        found_offsets = [h["offset_ms"] for h in hits]

        assert len(hits) == len(expected_offsets)
        for expected in expected_offsets:
            assert any(abs(f - expected) <= TOLERANCE_MS for f in found_offsets), (
                f"Ingen träff inom {TOLERANCE_MS}ms av {expected}ms. Hittade: {found_offsets}"
            )

    def test_returns_empty_when_no_match(self):
        jingle = _sine(440, 0.5)
        episode = np.random.default_rng(2).uniform(-0.05, 0.05, SR * 30).astype(np.float32)
        hits = find_jingle(episode, jingle, SR, threshold=0.9)
        assert hits == []

    def test_returns_empty_for_empty_jingle(self):
        episode = _sine(440, 1.0)
        hits = find_jingle(episode, np.array([], dtype=np.float32), SR)
        assert hits == []

    def test_returns_empty_when_episode_shorter_than_jingle(self):
        jingle = _sine(440, 2.0)
        episode = _sine(440, 0.5)
        hits = find_jingle(episode, jingle, SR)
        assert hits == []

    def test_perfect_match_has_confidence_near_one(self):
        jingle = _sine(440, 1.0)
        episode = np.zeros(SR * 10, dtype=np.float32)
        episode[SR * 3 : SR * 4] = jingle
        hits = find_jingle(episode, jingle, SR, threshold=0.5)
        assert len(hits) >= 1
        assert hits[0]["confidence"] > 0.99

    def test_matches_across_volume_difference(self):
        # Avsnittet och jingeln har olika mastrings-nivå (0.3× vs 1×).
        # NCC ska vara skal-invariant → peak-normaliseringen måste behålla det.
        jingle = _sine(440, 0.5)
        episode = np.random.default_rng(42).uniform(-0.05, 0.05, SR * 30).astype(np.float32)
        episode = _embed(episode, jingle * 0.3, 10_000)

        hits = find_jingle(episode, jingle, SR)
        assert len(hits) == 1
        assert abs(hits[0]["offset_ms"] - 10_000) <= TOLERANCE_MS

    def test_results_sorted_by_offset(self):
        jingle = _sine(440, 0.2)
        episode = np.random.default_rng(3).uniform(-0.05, 0.05, SR * 60).astype(np.float32)
        for off in [40_000, 10_000, 25_000]:
            episode = _embed(episode, jingle, off)

        hits = find_jingle(episode, jingle, SR)
        offsets = [h["offset_ms"] for h in hits]
        assert offsets == sorted(offsets)


class TestAnalyzeEpisode:
    def test_multiple_jingle_types(self):
        intro = _sine(220, 0.5)
        chapter = _sine(660, 0.3)
        ad = _sine(1100, 0.4)

        episode = np.random.default_rng(4).uniform(-0.05, 0.05, SR * 120).astype(np.float32)
        placements = {
            "intro": [2_000],
            "chapter": [30_000, 60_000, 90_000],
            "ad_marker": [32_000, 62_000],
        }
        jingles_pcm = {"intro": intro, "chapter": chapter, "ad_marker": ad}
        for kind, offsets in placements.items():
            for off in offsets:
                episode = _embed(episode, jingles_pcm[kind], off)

        jingles = [
            {"id": 1, "kind": "intro", "pcm": intro},
            {"id": 2, "kind": "chapter", "pcm": chapter},
            {"id": 3, "kind": "ad_marker", "pcm": ad},
        ]
        detections = analyze_episode(episode, SR, jingles)

        # Ska hitta alla inbäddade jinglar
        by_kind: dict[str, list[int]] = {}
        for d in detections:
            by_kind.setdefault(d["jingle_kind"], []).append(d["offset_ms"])

        for kind, expected_offsets in placements.items():
            found = by_kind.get(kind, [])
            assert len(found) == len(expected_offsets), (
                f"{kind}: förväntade {len(expected_offsets)} träffar, fick {len(found)}"
            )

        # Resultatet ska vara tidssorterat
        offsets = [d["offset_ms"] for d in detections]
        assert offsets == sorted(offsets)

    def test_returns_empty_for_no_jingles(self):
        episode = _sine(440, 10.0)
        assert analyze_episode(episode, SR, []) == []
