import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useRef, useState } from "react";
import { useJingles } from "../hooks/useJingles";
import { JINGLE_KIND_LABELS, formatDuration } from "../lib/format";
import type { Jingle } from "../lib/tauri";

type JingleKind = Jingle["kind"];

const KIND_OPTIONS: { value: JingleKind; label: string }[] = [
  { value: "intro", label: JINGLE_KIND_LABELS.intro },
  { value: "chapter", label: JINGLE_KIND_LABELS.chapter },
  { value: "ad_marker", label: JINGLE_KIND_LABELS.ad_marker },
  { value: "outro", label: JINGLE_KIND_LABELS.outro },
  { value: "custom", label: JINGLE_KIND_LABELS.custom },
];

export default function JingleLibrary() {
  const { jingles, loading, error, add, remove } = useJingles();
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<JingleKind>("intro");
  const [saving, setSaving] = useState(false);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function pickFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Ljudfil", extensions: ["wav", "mp3", "m4a", "flac", "ogg"] }],
    });
    if (typeof selected === "string") {
      setDraftPath(selected);
      // Förifyll namn från filnamn utan extension
      const base = selected.split(/[/\\]/).pop() ?? "";
      setDraftName(base.replace(/\.[^.]+$/, ""));
    }
  }

  async function save() {
    if (!draftPath || !draftName.trim()) return;
    try {
      setSaving(true);
      await add({ source_path: draftPath, name: draftName.trim(), kind: draftKind });
      setDraftPath(null);
      setDraftName("");
      setDraftKind("intro");
    } finally {
      setSaving(false);
    }
  }

  function cancelDraft() {
    setDraftPath(null);
    setDraftName("");
    setDraftKind("intro");
  }

  function togglePlay(jingle: Jingle) {
    if (playingId === jingle.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.src = convertFileSrc(jingle.file_path);
      audioRef.current.play();
      setPlayingId(jingle.id);
    }
  }

  async function handleDelete(jingle: Jingle) {
    const ok = window.confirm(`Ta bort "${jingle.name}"?`);
    if (!ok) return;
    if (playingId === jingle.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
    await remove(jingle.id);
  }

  return (
    <section className="card">
      <header className="card-header">
        <h2>Jingel-bibliotek</h2>
        {!draftPath && (
          <button onClick={pickFile}>+ Lägg till jingel</button>
        )}
      </header>

      {draftPath && (
        <div className="draft-row">
          <div className="draft-path">{draftPath}</div>
          <div className="draft-form">
            <input
              type="text"
              placeholder="Namn"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              autoFocus
            />
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as JingleKind)}
            >
              {KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button onClick={save} disabled={saving || !draftName.trim()}>
              {saving ? "Sparar…" : "Spara"}
            </button>
            <button className="secondary" onClick={cancelDraft} disabled={saving}>
              Avbryt
            </button>
          </div>
        </div>
      )}

      {error && <div className="error">Fel: {error}</div>}

      <div className="card-scroll">
      {loading ? (
        <div className="empty-state">Laddar…</div>
      ) : jingles.length === 0 ? (
        <div className="empty-state">
          Inga jinglar än. Lägg till en genom att klicka <strong>+ Lägg till jingel</strong>.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Namn</th>
              <th>Typ</th>
              <th>Längd</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jingles.map((j) => (
              <tr key={j.id}>
                <td>{j.name}</td>
                <td>
                  <span className="kind-badge">{JINGLE_KIND_LABELS[j.kind] ?? j.kind}</span>
                </td>
                <td>{j.duration_ms > 0 ? formatDuration(j.duration_ms) : "—"}</td>
                <td>
                  <div className="row-actions">
                    <button className="secondary" onClick={() => togglePlay(j)}>
                      {playingId === j.id ? "⏸" : "▶"}
                    </button>
                    <button className="danger" onClick={() => handleDelete(j)}>
                      Ta bort
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </div>

      <audio ref={audioRef} onEnded={() => setPlayingId(null)} />
    </section>
  );
}
