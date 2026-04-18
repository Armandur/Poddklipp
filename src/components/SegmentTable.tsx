import { useEffect, useRef, useState } from "react";
import { Segment, SegmentKind, updateSegment, deleteSegment } from "../lib/tauri";
import {
  formatDuration,
  SEGMENT_KIND_COLORS,
} from "../lib/format";
import { SegmentKindsHook } from "../hooks/useSegmentKinds";

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
}: SegmentTableProps) {
  const [error, setError] = useState<string | null>(null);
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
        <span className="segment-table-hint">
          ↑↓ = byt segment · Enter = spela · E = exkludera · N = byt namn · A = reklam · S = dela här
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
            <th style={{ width: "3rem" }}></th>
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
