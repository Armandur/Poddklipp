import { open } from "@tauri-apps/plugin-dialog";
import { Episode, relinkEpisode, scanFolder } from "../lib/tauri";
import { AnalysisJob } from "../hooks/useAnalysisJobs";
import { useEpisodes } from "../hooks/useEpisodes";
import { formatDuration } from "../lib/format";

interface EpisodeListProps {
  episodes: ReturnType<typeof useEpisodes>;
  jobs: Map<number, AnalysisJob>;
  onSelect: (episode: Episode) => void;
  selectedId: number | null;
}

export default function EpisodeList({
  episodes: store,
  jobs,
  onSelect,
  selectedId,
}: EpisodeListProps) {
  const { episodes, loading, error, add, remove, refresh } = store;

  async function pickFile() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Ljudfil", extensions: ["mp3", "m4a", "aac", "wav", "flac", "ogg"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) {
      await add({ source_path: p });
    }
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;

    const paths = await scanFolder(selected);
    for (const p of paths) {
      await add({ source_path: p });
    }
  }

  async function handleDelete(ep: Episode) {
    const ok = window.confirm(`Ta bort "${ep.display_name}" ur listan?\n(Originalfilen berörs inte.)`);
    if (!ok) return;
    await remove(ep.id);
  }

  async function handleRelink(ep: Episode) {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Ljudfil", extensions: ["mp3", "m4a", "aac", "wav", "flac", "ogg"] }],
      title: `Välj ny fil för "${ep.display_name}"`,
    });
    if (typeof selected !== "string") return;
    try {
      await relinkEpisode(ep.id, selected);
      await refresh();
    } catch (e) {
      alert(String(e));
    }
  }

  return (
    <section className="card">
      <header className="card-header">
        <h2>Avsnitt</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={pickFile}>+ Lägg till fil</button>
          <button className="secondary" onClick={pickFolder}>
            + Skanna mapp
          </button>
        </div>
      </header>

      {error && <div className="error">Fel: {error}</div>}

      <div className="card-scroll">
      {loading ? (
        <div className="empty-state">Laddar…</div>
      ) : episodes.length === 0 ? (
        <div className="empty-state">
          Inga avsnitt ännu. Lägg till en fil eller skanna en mapp.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Namn</th>
              <th>Längd</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {episodes.map((ep) => {
              const job = jobs.get(ep.id);
              return (
                <tr
                  key={ep.id}
                  className={selectedId === ep.id ? "selected-row" : ""}
                  style={{ cursor: "pointer", opacity: ep.file_missing ? 0.65 : 1 }}
                  onClick={() => onSelect(ep)}
                >
                  <td>{ep.display_name}</td>
                  <td>{ep.duration_ms > 0 ? formatDuration(ep.duration_ms) : "—"}</td>
                  <td>
                    {ep.file_missing ? (
                      <span className="kind-badge" style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>
                        Fil saknas
                      </span>
                    ) : job?.state === "running" ? (
                      <span className="kind-badge" style={{ color: "var(--accent)" }}>
                        Analyserar… {Math.round(job.progress * 100)}%
                      </span>
                    ) : job?.state === "error" ? (
                      <span className="kind-badge" style={{ color: "var(--danger)" }}>
                        Fel
                      </span>
                    ) : (
                      <span className="kind-badge">
                        {ep.analyzed_at ? "Analyserad" : "Ej analyserad"}
                      </span>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                      {ep.file_missing && (
                        <button className="secondary" onClick={() => handleRelink(ep)}>
                          Byt fil…
                        </button>
                      )}
                      <button className="danger" onClick={() => handleDelete(ep)}>
                        Ta bort
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </div>
    </section>
  );
}
