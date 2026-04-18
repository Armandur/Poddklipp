import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeEpisode,
  Detection,
  Episode,
  Segment,
  generateSegments,
  listDetections,
  listSegments,
  updateSegment,
} from "../lib/tauri";
import { AnalysisJob } from "../hooks/useAnalysisJobs";
import { SegmentKindsHook } from "../hooks/useSegmentKinds";
import { JINGLE_KIND_LABELS } from "../lib/format";
import Timeline, { TimelineApi } from "./Timeline";
import SegmentTable from "./SegmentTable";
import ExportDialog from "./ExportDialog";
import JingleCaptureDialog from "./JingleCaptureDialog";

interface EpisodeDetailProps {
  episode: Episode;
  job: AnalysisJob | null;
  completionTick: number;
  segmentKinds: SegmentKindsHook;
}

const KIND_COLORS: Record<string, string> = {
  intro: "#6bd186",
  outro: "#d16bb5",
  chapter: "#6b9bd1",
  ad_marker: "#d1b66b",
  custom: "#9a9aa8",
};

export default function EpisodeDetail({
  episode,
  job,
  completionTick,
  segmentKinds,
}: EpisodeDetailProps) {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [captureRange, setCaptureRange] = useState<{ startMs: number; endMs: number } | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const timelineApi = useRef<TimelineApi | null>(null);
  const suppressTimeUpdateUntil = useRef<number>(0);

  const analyzing = job?.state === "running";
  const analyzedAt = episode.analyzed_at;
  const fileMissing = episode.file_missing;

  // Ladda om varje gång avsnittet byts eller när en analys blir klar för just
  // det här avsnittet (completionTick räknas upp).
  useEffect(() => {
    let cancelled = false;
    Promise.all([listDetections(episode.id), listSegments(episode.id)])
      .then(([d, s]) => {
        if (cancelled) return;
        setDetections(d);
        setSegments(s);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [episode.id, completionTick]);

  useEffect(() => {
    if (job?.state === "error" && job.error) setError(job.error);
  }, [job]);

  async function runAnalysis() {
    try {
      setError(null);
      await analyzeEpisode(episode.id);
      // Resultatet levereras via `analysis-complete`-event; useAnalysisJobs
      // håller progress-state och bumpar completionTick när det är klart.
    } catch (e) {
      setError(String(e));
    }
  }

  async function regenerate() {
    try {
      setError(null);
      const segs = await generateSegments(episode.id);
      setSegments(segs);
    } catch (e) {
      setError(String(e));
    }
  }

  async function renumberChapters() {
    try {
      setError(null);
      let n = 0;
      const updates = segments
        .filter((s) => s.kind === "chapter")
        .map((s) => {
          n += 1;
          return updateSegment({ id: s.id, label: `Kapitel ${n}` });
        });
      const updated = await Promise.all(updates);
      const updatedIds = new Set(updated.map((u) => u.id));
      setSegments((prev) =>
        prev.map((s) => {
          const u = updated.find((x) => x.id === s.id);
          return updatedIds.has(s.id) && u ? u : s;
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  }

  const handleBoundaryChange = useCallback(
    async (segmentId: number, startMs: number, endMs: number) => {
      try {
        const updated = await updateSegment({
          id: segmentId,
          start_ms: startMs,
          end_ms: endMs,
        });
        setSegments((prev) =>
          prev.map((s) => (s.id === segmentId ? updated : s)),
        );
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  function seek(ms: number, segmentId?: number) {
    const api = timelineApi.current;
    if (!api) return;
    api.seekMs(ms);
    if (!api.isPlaying()) api.play();
    if (segmentId != null) setActiveSegmentId(segmentId);
  }

  function handleTimeUpdate(ms: number) {
    if (Date.now() < suppressTimeUpdateUntil.current) return;
    const seg = segments.find((s) => ms >= s.start_ms && ms < s.end_ms);
    setActiveSegmentId(seg?.id ?? null);
  }

  // Tangentbordshantering för segment-redigering och navigering
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inText = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

      // ArrowUp/ArrowDown: byt aktivt segment (fungerar oavsett om ett är valt)
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !inText && segments.length > 0) {
        e.preventDefault();
        const idx = segments.findIndex((s) => s.id === activeSegmentId);
        let next: typeof segments[0] | undefined;
        if (e.key === "ArrowUp") {
          next = idx <= 0 ? segments[segments.length - 1] : segments[idx - 1];
        } else {
          next = idx < 0 || idx === segments.length - 1 ? segments[0] : segments[idx + 1];
        }
        if (next) {
          suppressTimeUpdateUntil.current = Date.now() + 300;
          setActiveSegmentId(next.id);
          timelineApi.current?.seekMs(next.start_ms);
        }
        return;
      }

      if (activeSegmentId == null) return;

      if (e.key === "Enter" && !inText) {
        e.preventDefault();
        const seg = segments.find((s) => s.id === activeSegmentId);
        if (seg) seek(seg.start_ms, seg.id);
        return;
      }

      if (e.key === "e" && !inText) {
        e.preventDefault();
        const seg = segments.find((s) => s.id === activeSegmentId);
        if (!seg) return;
        updateSegment({ id: activeSegmentId, excluded: !seg.excluded }).then((updated) => {
          setSegments((prev) => prev.map((s) => (s.id === activeSegmentId ? updated : s)));
        });
      } else if (e.key === "n" && !inText) {
        e.preventDefault();
        setEditingSegmentId(activeSegmentId);
      } else if (e.key === "a" && !inText) {
        e.preventDefault();
        const defaultExcluded = segmentKinds.defaultExcludedFor("ad");
        updateSegment({ id: activeSegmentId, kind: "ad", excluded: defaultExcluded }).then((updated) => {
          setSegments((prev) => prev.map((s) => (s.id === activeSegmentId ? updated : s)));
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSegmentId, segments, segmentKinds]);

  const detectionsByKind = detections.reduce<Record<string, number>>((acc, d) => {
    acc[d.jingle_kind] = (acc[d.jingle_kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="card">
      <header className="card-header">
        <h2>{episode.display_name}</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {segments.length > 0 && (
            <button
              className="secondary"
              onClick={() => setShowExport(true)}
              disabled={analyzing || fileMissing}
            >
              Exportera
            </button>
          )}
          {(analyzedAt || segments.length > 0) && (
            <button
              className={captureMode ? "danger" : "secondary"}
              onClick={() => setCaptureMode((v) => !v)}
              disabled={analyzing}
              title="Dra i tidslinjen för att markera ett ljud som ny jingel"
            >
              {captureMode ? "Avbryt markering" : "Lär in jingel…"}
            </button>
          )}
          {segments.some((s) => s.kind === "chapter") && (
            <button
              className="secondary"
              onClick={renumberChapters}
              disabled={analyzing}
              title="Numrera om alla kapitel i ordning (Kapitel 1, 2, 3…)"
            >
              Numrera om kapitel
            </button>
          )}
          {analyzedAt && (
            <button
              className="secondary"
              onClick={regenerate}
              disabled={analyzing}
              title="Bygg om segment från detektionerna (raderar manuella justeringar)"
            >
              Regenerera segment
            </button>
          )}
          <button onClick={runAnalysis} disabled={analyzing || fileMissing}>
            {analyzing ? "Analyserar…" : "Analysera"}
          </button>
        </div>
      </header>

      {analyzing && job && (
        <div className="progress">
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.round(job.progress * 100)}%` }}
            />
          </div>
          <div className="progress-stage">{job.stage}</div>
        </div>
      )}

      {fileMissing && (
        <div className="error">
          Filen saknas på disk: <code>{episode.source_path}</code>. Använd "Byt fil…" i avsnittslistan för att peka om den.
        </div>
      )}

      {error && <div className="error">Fel: {error}</div>}

      {(analyzedAt || segments.length > 0) && (
        <Timeline
          episode={episode}
          detections={detections}
          segments={segments}
          activeSegmentId={activeSegmentId}
          captureMode={captureMode}
          onCapture={(startMs, endMs) => {
            setCaptureMode(false);
            setCaptureRange({ startMs, endMs });
          }}
          onSegmentBoundaryChange={handleBoundaryChange}
          onReady={(api) => { timelineApi.current = api; }}
          onTimeUpdate={handleTimeUpdate}
        />
      )}

      <div className="detection-summary">
        {Object.keys(detectionsByKind).length === 0 ? (
          <span className="text-muted">
            Inga detektioner ännu — klicka <strong>Analysera</strong> för att köra.
          </span>
        ) : (
          Object.entries(detectionsByKind).map(([kind, count]) => (
            <span
              key={kind}
              className="kind-pill"
              style={{ borderColor: KIND_COLORS[kind], color: KIND_COLORS[kind] }}
            >
              {JINGLE_KIND_LABELS[kind] ?? kind}: {count}
            </span>
          ))
        )}
      </div>

      <SegmentTable
        segments={segments}
        onChange={setSegments}
        onSeek={seek}
        activeSegmentId={activeSegmentId}
        onActivate={setActiveSegmentId}
        editingSegmentId={editingSegmentId}
        onEditingDone={() => setEditingSegmentId(null)}
        segmentKinds={segmentKinds}
      />

      {showExport && (
        <ExportDialog
          episodeId={episode.id}
          episodeName={episode.display_name}
          onClose={() => setShowExport(false)}
        />
      )}
      {captureRange && (
        <JingleCaptureDialog
          episodeId={episode.id}
          startMs={captureRange.startMs}
          endMs={captureRange.endMs}
          onDone={() => setCaptureRange(null)}
          onCancel={() => setCaptureRange(null)}
        />
      )}
    </section>
  );
}
