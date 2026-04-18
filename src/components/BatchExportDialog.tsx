import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Episode, ExportFormat, exportEpisode, getAppConfig } from "../lib/tauri";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  clean_mp3: "Ren MP3 (utan exkluderade segment)",
  chapters: "Separata filer per kapitel",
  m4b_chapters: "M4B med kapitelmarkeringar",
  json: "JSON-metadata",
};

const FORMAT_EXT: Record<ExportFormat, string> = {
  clean_mp3: ".mp3",
  chapters: "",   // katalog per avsnitt
  m4b_chapters: ".m4b",
  json: ".json",
};

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

function buildOutputPath(folder: string, episodeName: string, format: ExportFormat): string {
  const sep = folder.includes("\\") ? "\\" : "/";
  const base = safeName(episodeName);
  return format === "chapters"
    ? `${folder}${sep}${base}`
    : `${folder}${sep}${base}${FORMAT_EXT[format]}`;
}

interface BatchExportDialogProps {
  episodes: Episode[];
  onClose: () => void;
}

type EpisodeResult = { name: string; path: string; error?: string };

export default function BatchExportDialog({ episodes, onClose }: BatchExportDialogProps) {
  const eligible = episodes.filter((e) => e.analyzed_at && !e.file_missing);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(eligible.map((e) => e.id)),
  );
  const [format, setFormat] = useState<ExportFormat>("clean_mp3");
  const [outputFolder, setOutputFolder] = useState("");

  useEffect(() => {
    getAppConfig().then((cfg) => {
      setFormat(cfg.export_default_format as ExportFormat);
      if (cfg.export_default_folder) setOutputFolder(cfg.export_default_folder);
    }).catch(() => {});
  }, []);
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<{ n: number; total: number; name: string } | null>(null);
  const [stepProgress, setStepProgress] = useState(0);
  const [results, setResults] = useState<EpisodeResult[]>([]);

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false, title: "Välj exportmapp" });
    if (typeof dir === "string") setOutputFolder(dir);
  }

  async function runBatch() {
    if (!outputFolder || selectedIds.size === 0) return;
    const toExport = eligible.filter((e) => selectedIds.has(e.id));

    setRunning(true);
    setResults([]);

    for (let i = 0; i < toExport.length; i++) {
      const ep = toExport[i];
      setCurrentStep({ n: i + 1, total: toExport.length, name: ep.display_name });
      setStepProgress(0);

      const outputPath = buildOutputPath(outputFolder, ep.display_name, format);

      const result = await new Promise<EpisodeResult>((resolve) => {
        const unlisteners: Array<() => void> = [];

        function cleanup() {
          unlisteners.forEach((u) => u());
        }

        listen<{ episode_id: number; progress: number }>("export-progress", (e) => {
          if (e.payload.episode_id === ep.id) setStepProgress(e.payload.progress);
        }).then((u) => unlisteners.push(u));

        listen<{ episode_id: number; output_path: string }>("export-complete", (e) => {
          if (e.payload.episode_id !== ep.id) return;
          cleanup();
          resolve({ name: ep.display_name, path: e.payload.output_path });
        }).then((u) => unlisteners.push(u));

        listen<{ episode_id: number; error: string }>("export-error", (e) => {
          if (e.payload.episode_id !== ep.id) return;
          cleanup();
          resolve({ name: ep.display_name, path: outputPath, error: e.payload.error });
        }).then((u) => unlisteners.push(u));

        exportEpisode(ep.id, format, outputPath).catch((err) => {
          cleanup();
          resolve({ name: ep.display_name, path: outputPath, error: String(err) });
        });
      });

      setResults((prev) => [...prev, result]);
    }

    setCurrentStep(null);
    setRunning(false);
  }

  const selected = eligible.filter((e) => selectedIds.has(e.id));
  const done = !running && results.length > 0;

  return (
    <div className="export-dialog-overlay" onClick={running ? undefined : onClose}>
      <div
        className="export-dialog"
        style={{ width: "min(560px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="card-header" style={{ marginBottom: "1rem" }}>
          <h2>Batch-exportera</h2>
          <button className="secondary" onClick={onClose} disabled={running}>
            Stäng
          </button>
        </header>

        {eligible.length === 0 ? (
          <p className="text-muted">Inga analyserade avsnitt att exportera.</p>
        ) : (
          <>
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Avsnitt ({selected.length}/{eligible.length} valda)
                </span>
                <span style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    className="secondary"
                    style={{ padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}
                    onClick={() => setSelectedIds(new Set(eligible.map((e) => e.id)))}
                    disabled={running}
                  >
                    Alla
                  </button>
                  <button
                    className="secondary"
                    style={{ padding: "0.1rem 0.5rem", fontSize: "0.75rem" }}
                    onClick={() => setSelectedIds(new Set())}
                    disabled={running}
                  >
                    Inga
                  </button>
                </span>
              </div>
              <div className="card-scroll" style={{ border: "1px solid var(--border)", borderRadius: 4 }}>
                {eligible.map((ep) => (
                  <div
                    key={ep.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.35rem 0.6rem",
                      cursor: running ? "default" : "pointer",
                      borderBottom: "1px solid var(--border)",
                      userSelect: "none",
                    }}
                    onClick={() => !running && toggle(ep.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(ep.id)}
                      onChange={() => toggle(ep.id)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={running}
                    />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ep.display_name}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="export-field">
              <label>Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                disabled={running}
              >
                {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
                  <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
                ))}
              </select>
            </div>

            <div className="export-field">
              <label>Exportmapp</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  readOnly
                  value={outputFolder}
                  placeholder="Välj mapp…"
                  style={{ flex: 1 }}
                />
                <button className="secondary" onClick={pickFolder} disabled={running}>
                  Bläddra
                </button>
              </div>
            </div>

            {currentStep && (
              <div className="progress">
                <div style={{ fontSize: "0.85rem", marginBottom: "0.3rem", color: "var(--text-muted)" }}>
                  Avsnitt {currentStep.n}/{currentStep.total}: {currentStep.name}
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.round(stepProgress * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {done && (
              <div className="card-scroll" style={{ marginTop: "0.75rem", maxHeight: 180 }}>
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={r.error ? "error" : "export-done"}
                    style={{ marginBottom: "0.35rem", fontSize: "0.82rem" }}
                  >
                    {r.error
                      ? <><strong>{r.name}</strong>: {r.error}</>
                      : <><strong>{r.name}</strong> → <code>{r.path}</code></>
                    }
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button
                onClick={runBatch}
                disabled={running || selected.length === 0 || !outputFolder}
              >
                {running
                  ? `Exporterar ${currentStep?.n ?? "…"}/${currentStep?.total ?? "…"}…`
                  : `Exportera ${selected.length} avsnitt`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
