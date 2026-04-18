import { useState } from "react";
import { Jingle, createJingleFromClip } from "../lib/tauri";
import { formatDuration } from "../lib/format";

const KIND_OPTIONS: Array<{ value: Jingle["kind"]; label: string }> = [
  { value: "intro", label: "Intro" },
  { value: "outro", label: "Outro" },
  { value: "chapter", label: "Kapitel-stinger" },
  { value: "ad_marker", label: "Reklam-jingel" },
  { value: "custom", label: "Egen" },
];

interface JingleCaptureDialogProps {
  episodeId: number;
  startMs: number;
  endMs: number;
  onDone: (jingle: Jingle) => void;
  onCancel: () => void;
}

export default function JingleCaptureDialog({
  episodeId,
  startMs,
  endMs,
  onDone,
  onCancel,
}: JingleCaptureDialogProps) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Jingle["kind"]>("custom");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Ange ett namn för jingeln.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const jingle = await createJingleFromClip(episodeId, startMs, endMs, trimmed, kind);
      onDone(jingle);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="export-dialog-overlay" onClick={onCancel}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 0.75rem" }}>Lägg till jingel från klipp</h3>
        <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
          {formatDuration(startMs)} – {formatDuration(endMs)}
          {" "}({formatDuration(endMs - startMs)})
        </p>
        {error && <div className="error">{error}</div>}
        <div className="export-field">
          <label>Namn</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
            placeholder="t.ex. Intro P3"
          />
        </div>
        <div className="export-field">
          <label>Typ</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as Jingle["kind"])}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button className="secondary" onClick={onCancel} disabled={saving}>Avbryt</button>
          <button onClick={handleSave} disabled={saving}>
            {saving ? "Extraherar…" : "Spara jingel"}
          </button>
        </div>
      </div>
    </div>
  );
}
