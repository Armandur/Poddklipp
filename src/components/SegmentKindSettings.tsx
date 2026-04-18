import { useState } from "react";
import { SegmentKind } from "../lib/tauri";
import { SEGMENT_KIND_COLORS } from "../lib/format";
import { SegmentKindsHook } from "../hooks/useSegmentKinds";

interface SegmentKindSettingsProps {
  kinds: SegmentKindsHook;
  onClose: () => void;
}

export default function SegmentKindSettings({ kinds, onClose }: SegmentKindSettingsProps) {
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(slug: string, currentLabel: string) {
    setEditingSlug(slug);
    setEditLabel(currentLabel);
  }

  async function commitLabel(slug: SegmentKind, defaultExcluded: boolean) {
    setSaving(true);
    try {
      await kinds.update(slug, editLabel.trim() || slug, defaultExcluded);
      setEditingSlug(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleExcluded(slug: SegmentKind, label: string, current: boolean) {
    try {
      await kinds.update(slug, label, !current);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="export-dialog-overlay" onClick={onClose}>
      <div
        className="export-dialog"
        style={{ width: "min(520px, 92vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 1rem" }}>Segmenttyper</h3>
        <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Ange namn och om typen ska exkluderas som standard vid segmentgenerering.
          Ändrar du "standard exkludera" påverkas inte befintliga segment — bara
          nyligen genererade.
        </p>
        {error && <div className="error">{error}</div>}
        <table>
          <thead>
            <tr>
              <th>Typ</th>
              <th>Namn</th>
              <th style={{ textAlign: "center", width: "9rem" }}>Exkl. standard</th>
            </tr>
          </thead>
          <tbody>
            {kinds.kinds.map((k) => {
              const color = SEGMENT_KIND_COLORS[k.slug] ?? "#9a9aa8";
              const isEditing = editingSlug === k.slug;
              return (
                <tr key={k.slug}>
                  <td>
                    <span
                      className="kind-pill"
                      style={{ borderColor: color, color }}
                    >
                      {k.slug}
                    </span>
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onBlur={() => commitLabel(k.slug as SegmentKind, k.default_excluded)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitLabel(k.slug as SegmentKind, k.default_excluded);
                          if (e.key === "Escape") setEditingSlug(null);
                        }}
                        disabled={saving}
                        style={{ width: "100%" }}
                      />
                    ) : (
                      <button
                        className="linklike"
                        onClick={() => startEdit(k.slug, k.label)}
                        title="Klicka för att byta namn"
                      >
                        {k.label}
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={k.default_excluded}
                      onChange={() => toggleExcluded(k.slug as SegmentKind, k.label, k.default_excluded)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button onClick={onClose}>Stäng</button>
        </div>
      </div>
    </div>
  );
}
