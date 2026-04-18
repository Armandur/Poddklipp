import { useState } from "react";
import { SEGMENT_KIND_COLORS } from "../../lib/format";
import { SegmentKind } from "../../lib/tauri";
import { SegmentKindsHook } from "../../hooks/useSegmentKinds";
import { AppConfigHook } from "../../hooks/useAppConfig";

interface Props {
  kinds: SegmentKindsHook;
  appConfig: AppConfigHook;
}

export default function SegmentKindSection({ kinds, appConfig }: Props) {
  const { config, update } = appConfig;
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
    <>
      <p className="settings-description">
        Ange namn och om typen ska exkluderas som standard vid segmentgenerering.
        Ändrar du "standard exkludera" påverkas inte befintliga segment — bara nyligen genererade.
      </p>
      {error && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>Typ</th>
            <th>Namn</th>
            <th style={{ textAlign: "center", width: "9rem" }}>Exkl. standard</th>
            <th style={{ textAlign: "center", width: "7rem" }}>Transkribera</th>
          </tr>
        </thead>
        <tbody>
          {kinds.kinds.map((k) => {
            const color = SEGMENT_KIND_COLORS[k.slug] ?? "#9a9aa8";
            const isEditing = editingSlug === k.slug;
            return (
              <tr key={k.slug}>
                <td>
                  <span className="kind-pill" style={{ borderColor: color, color }}>
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
                    onChange={() =>
                      toggleExcluded(k.slug as SegmentKind, k.label, k.default_excluded)
                    }
                  />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.transcribe_segment_kinds.includes(k.slug)}
                    onChange={() => {
                      const included = config.transcribe_segment_kinds.includes(k.slug);
                      const next = included
                        ? config.transcribe_segment_kinds.filter((s) => s !== k.slug)
                        : [...config.transcribe_segment_kinds, k.slug];
                      update({ transcribe_segment_kinds: next });
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
