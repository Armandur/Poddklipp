import { useEffect, useRef, useState } from "react";
import { Segment, SegmentKind, updateSegment, deleteSegment, transcribeSegment } from "../lib/tauri";
import {
  formatDuration,
  SEGMENT_KIND_COLORS,
} from "../lib/format";
import { SegmentKindsHook } from "../hooks/useSegmentKinds";
import { ResolvedShortcuts, formatShortcutDisplay } from "../lib/shortcuts";

interface SegmentTableProps {
  segments: Segment[];
  onChange: (segments: Segment[]) => void;
  onSeek: (ms: number, segmentId: number) => void;
  activeSegmentId: number | null;
  onActivate: (id: number) => void;
  editingSegmentId: number | null;
  onEditingDone: () => void;
  segmentKinds: SegmentKindsHook;
  confirmDelete?: boolean;
  shortcuts?: ResolvedShortcuts;
  transcribeKinds?: string[];
}

export default function SegmentTable({
  segments,
  onChange,
  onSeek,
  activeSegmentId,
  onActivate,
  editingSegmentId,
  onEditingDone,
  segmentKinds,
  confirmDelete = true,
  shortcuts,
  transcribeKinds = ["chapter"],
}: SegmentTableProps) {
  const [error, setError] = useState<string | null>(null);
  const [transcribingIds, setTranscribingIds] = useState<Set<number>>(new Set());
  const [transcribeSec, setTranscribeSec] = useState(15);
  const cancelBatchRef = useRef(false);
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (editingSegmentId == null) return;
    const input = inputRefs.current.get(editingSegmentId);
    if (input) {
      input.focus();
      input.select();
    }
  }, [editingSegmentId]);

  // Rensa spinner när transkribering landar (segment-prop uppdateras av EpisodeDetail)
  useEffect(() => {
    setTranscribingIds((prev) => {
      const toRemove = [...prev].filter((id) => {
        const seg = segments.find((s) => s.id === id);
        return seg && seg.transcription != null;
      });
      if (toRemove.length === 0) return prev;
      const next = new Set(prev);
      toRemove.forEach((id) => next.delete(id));
      return next;
    });
  }, [segments]);

  // Scrolla aktiv rad till vy när den byts via tangentbord
  useEffect(() => {
    if (activeSegmentId == null) return;
    rowRefs.current.get(activeSegmentId)?.scrollIntoView({ block: "nearest" });
  }, [activeSegmentId]);

  async function patch(id: number, patch: Partial<Segment>) {
    try {
      const { start_ms, end_ms, label, kind, excluded } = patch;
      const updated = await updateSegment({ id, start_ms, end_ms, label: label ?? undefined, kind, excluded });
      onChange(segments.map((s) => (s.id === id ? updated : s)));
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleTranscribe(id: number) {
    setTranscribingIds((prev) => new Set([...prev, id]));
    try {
      await transcribeSegment(id, transcribeSec * 1000);
    } catch (e) {
      setTranscribingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
      setError(String(e));
    }
  }

  async function handleTranscribeAll() {
    cancelBatchRef.current = false;
    const toRun = segments.filter(
      (s) => transcribeKinds.includes(s.kind) && !transcribingIds.has(s.id),
    );
    for (const s of toRun) {
      if (cancelBatchRef.current) break;
      await handleTranscribe(s.id);
    }
  }

  function cancelTranscribe(id: number) {
    setTranscribingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  function cancelAll() {
    cancelBatchRef.current = true;
    setTranscribingIds(new Set());
  }

  async function remove(id: number) {
    if (confirmDelete && !window.confirm("Ta bort segmentet?")) return;
    try {
      await deleteSegment(id);
      onChange(segments.filter((s) => s.id !== id));
    } catch (e) {
      setError(String(e));
    }
  }

  if (segments.length === 0) return null;

  return (
    <section className="segment-table">
      <h3>
        Segment
        {segments.some((s) => transcribeKinds.includes(s.kind)) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", marginLeft: "0.75rem", verticalAlign: "middle" }}>
            <input
              type="range"
              min={5}
              max={30}
              step={5}
              value={transcribeSec}
              onChange={(e) => setTranscribeSec(Number(e.target.value))}
              style={{ width: "5rem", accentColor: "var(--accent)" }}
              title={`Antal sekunder att transkribera per segment (${transcribeSec}s)`}
              onClick={(e) => e.stopPropagation()}
            />
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", minWidth: "2rem" }}>{transcribeSec}s</span>
            {transcribingIds.size > 0 ? (
              <button
                className="danger"
                onClick={cancelAll}
                style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem", fontWeight: 400 }}
                title="Avbryt alla pågående transkribering"
              >
                Avbryt alla
              </button>
            ) : (
              <button
                className="secondary"
                onClick={handleTranscribeAll}
                style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem", fontWeight: 400 }}
                title="Transkribera starten av alla segment"
              >
                Transkribera alla
              </button>
            )}
          </span>
        )}
        <span className="segment-table-hint">
          {shortcuts
            ? `↑↓ = byt segment · Enter = spela · ${formatShortcutDisplay(shortcuts.toggle_excluded)} = exkludera · ${formatShortcutDisplay(shortcuts.rename_segment)} = byt namn · ${formatShortcutDisplay(shortcuts.mark_as_ad)} = reklam · ${formatShortcutDisplay(shortcuts.split_here)} = dela`
            : "↑↓ = byt segment · Enter = spela · E = exkludera · N = byt namn · A = reklam · S = dela"}
        </span>
      </h3>
      {error && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th style={{ width: "6rem" }}>Start</th>
            <th style={{ width: "6rem" }}>Slut</th>
            <th style={{ width: "6rem" }}>Längd</th>
            <th>Namn</th>
            <th style={{ width: "9rem" }}>Typ</th>
            <th style={{ width: "5rem", textAlign: "center" }}>Exkl.</th>
            <th style={{ width: "5rem" }}></th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => (
            <tr
              key={s.id}
              ref={(el) => {
                if (el) rowRefs.current.set(s.id, el);
                else rowRefs.current.delete(s.id);
              }}
              className={[
                s.excluded ? "segment-row-excluded" : "",
                s.id === activeSegmentId ? "segment-row-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={(e) => {
                onActivate(s.id);
                const t = e.target as HTMLElement;
                if (t.tagName !== "INPUT" && t.tagName !== "SELECT" && t.tagName !== "BUTTON") {
                  (document.activeElement as HTMLElement | null)?.blur();
                }
              }}
            >
              <td>
                <button
                  className="linklike"
                  onClick={(e) => {
                    e.stopPropagation();
                    onActivate(s.id);
                    onSeek(s.start_ms, s.id);
                  }}
                  title="Hoppa till start"
                >
                  {formatDuration(s.start_ms)}
                </button>
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatDuration(s.end_ms)}
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatDuration(s.end_ms - s.start_ms)}
              </td>
              <td>
                <input
                  ref={(el) => {
                    if (el) inputRefs.current.set(s.id, el);
                    else inputRefs.current.delete(s.id);
                  }}
                  type="text"
                  value={s.label ?? ""}
                  placeholder={segmentKinds.labelFor(s.kind)}
                  onChange={(e) => {
                    const label = e.target.value;
                    onChange(segments.map((x) => (x.id === s.id ? { ...x, label } : x)));
                  }}
                  onBlur={(e) => {
                    patch(s.id, { label: e.target.value });
                    onEditingDone();
                  }}
                  style={{ width: "100%" }}
                />
                {s.transcription && (
                  <div className="segment-transcription">
                    <span className="segment-transcription-text">{s.transcription}</span>
                    {!s.label && (
                      <button
                        className="linklike"
                        style={{ fontSize: "0.7rem", marginLeft: "0.4rem" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          patch(s.id, { label: s.transcription! });
                        }}
                        title="Använd som namn"
                      >
                        Använd
                      </button>
                    )}
                  </div>
                )}
              </td>
              <td>
                <select
                  value={s.kind}
                  onChange={(e) => {
                    const kind = e.target.value as SegmentKind;
                    const excluded = segmentKinds.defaultExcludedFor(kind);
                    patch(s.id, { kind, excluded });
                  }}
                  style={{ width: "100%", borderColor: SEGMENT_KIND_COLORS[s.kind] }}
                >
                  {segmentKinds.kinds.map((k) => (
                    <option key={k.slug} value={k.slug}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={s.excluded}
                  onChange={(e) => patch(s.id, { excluded: e.target.checked })}
                />
              </td>
              <td>
                <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
                  {transcribeKinds.includes(s.kind) && (
                    transcribingIds.has(s.id) ? (
                      <button
                        className="danger"
                        onClick={(e) => { e.stopPropagation(); cancelTranscribe(s.id); }}
                        title="Avbryt transkribering"
                        style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }}
                      >
                        ✕
                      </button>
                    ) : (
                      <button
                        className="secondary"
                        onClick={(e) => { e.stopPropagation(); handleTranscribe(s.id); }}
                        title={s.transcription ? "Transkribera om" : "Transkribera"}
                        style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem", opacity: s.transcription ? 0.6 : 1 }}
                      >
                        {s.transcription ? "↺" : "T"}
                      </button>
                    )
                  )}
                  <button
                    className="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(s.id);
                    }}
                    title="Ta bort segment"
                    style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                  >
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
