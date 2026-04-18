import { save, open } from "@tauri-apps/plugin-dialog";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { exportEpisode, ExportFormat, getAppConfig } from "../lib/tauri";

interface ExportDialogProps {
  episodeId: number;
  episodeName: string;
  onClose: () => void;
}

interface ProgressPayload {
  episode_id: number;
  progress: number;
  stage: string;
}

interface CompletePayload {
  episode_id: number;
  output_path: string;
}

interface ErrorPayload {
  episode_id: number;
  error: string;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  clean_mp3: "Ren MP3 (utan exkluderade segment)",
  chapters: "Separata filer per kapitel",
  m4b_chapters: "M4B med kapitelmarkeringar (poddappar)",
  json: "JSON-metadata",
};

const FORMAT_EXTENSIONS: Record<ExportFormat, string[]> = {
  clean_mp3: ["mp3"],
  chapters: [],
  m4b_chapters: ["m4b"],
  json: ["json"],
};

export default function ExportDialog({
  episodeId,
  episodeName,
  onClose,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("clean_mp3");
  const [outputPath, setOutputPath] = useState<string>("");

  useEffect(() => {
    getAppConfig().then((cfg) => {
      setFormat(cfg.export_default_format as ExportFormat);
    }).catch(() => {});
  }, []);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{ value: number; stage: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlisteners = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    const promises = [
      listen<ProgressPayload>("export-progress", (e) => {
        if (e.payload.episode_id !== episodeId) return;
        setProgress({ value: e.payload.progress, stage: e.payload.stage });
      }),
      listen<CompletePayload>("export-complete", (e) => {
        if (e.payload.episode_id !== episodeId) return;
        setExporting(false);
        setProgress(null);
        setDone(e.payload.output_path);
      }),
      listen<ErrorPayload>("export-error", (e) => {
        if (e.payload.episode_id !== episodeId) return;
        setExporting(false);
        setProgress(null);
        setError(e.payload.error);
      }),
    ];

    Promise.all(promises).then((fns) => {
      unlisteners.current = fns;
    });

    return () => {
      unlisteners.current.forEach((u) => u());
    };
  }, [episodeId]);

  async function pickOutput() {
    if (format === "chapters") {
      const dir = await open({ directory: true, multiple: false, title: "Välj exportmapp" });
      if (typeof dir === "string") setOutputPath(dir);
    } else {
      const ext = FORMAT_EXTENSIONS[format][0];
      const defaultName = `${episodeName.replace(/[<>:"/\\|?*]/g, "_")}.${ext}`;
      const path = await save({
        title: "Spara som",
        defaultPath: defaultName,
        filters:
          ext === "mp3" ? [{ name: "MP3", extensions: ["mp3"] }]
          : ext === "m4b" ? [{ name: "M4B-ljudbok", extensions: ["m4b"] }]
          : ext === "json" ? [{ name: "JSON", extensions: ["json"] }]
          : [],
      });
      if (path) setOutputPath(path);
    }
  }

  async function startExport() {
    if (!outputPath) return;
    setError(null);
    setDone(null);
    setExporting(true);
    setProgress({ value: 0, stage: "startar…" });
    try {
      await exportEpisode(episodeId, format, outputPath);
    } catch (e) {
      setExporting(false);
      setProgress(null);
      setError(String(e));
    }
  }

  return (
    <div className="export-dialog-overlay" onClick={onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="card-header">
          <h2>Exportera</h2>
          <button className="secondary" onClick={onClose} disabled={exporting}>
            Stäng
          </button>
        </header>

        <p className="text-muted" style={{ margin: "0 0 1rem" }}>
          {episodeName}
        </p>

        <div className="export-field">
          <label>Format</label>
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as ExportFormat);
              setOutputPath("");
              setDone(null);
            }}
            disabled={exporting}
          >
            {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </div>

        <div className="export-field">
          <label>{format === "chapters" ? "Exportmapp" : "Spara som"}</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              readOnly
              value={outputPath}
              placeholder={format === "chapters" ? "Välj mapp…" : "Välj fil…"}
              style={{ flex: 1 }}
            />
            <button className="secondary" onClick={pickOutput} disabled={exporting}>
              Bläddra
            </button>
          </div>
        </div>

        {exporting && progress && (
          <div className="progress" style={{ marginTop: "1rem" }}>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.round(progress.value * 100)}%` }}
              />
            </div>
            <div className="progress-stage">{progress.stage}</div>
          </div>
        )}

        {error && <div className="error" style={{ marginTop: "0.75rem" }}>{error}</div>}

        {done && (
          <div
            className="export-done"
            style={{ marginTop: "0.75rem" }}
          >
            Exporterad till: <code>{done}</code>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button onClick={startExport} disabled={exporting || !outputPath}>
            {exporting ? "Exporterar…" : "Exportera"}
          </button>
        </div>
      </div>
    </div>
  );
}
