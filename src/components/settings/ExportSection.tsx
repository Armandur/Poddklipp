import { open } from "@tauri-apps/plugin-dialog";
import { AppConfigHook } from "../../hooks/useAppConfig";
import { ExportFormat } from "../../lib/tauri";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  clean_mp3: "Ren MP3 (utan exkluderade segment)",
  chapters: "Separata filer per kapitel",
  m4b_chapters: "M4B med kapitelmarkeringar",
  json: "JSON-metadata",
};

interface Props {
  appConfig: AppConfigHook;
}

export default function ExportSection({ appConfig }: Props) {
  const { config, update } = appConfig;

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false, title: "Välj standardmapp" });
    if (typeof dir === "string") update({ export_default_folder: dir });
  }

  return (
    <div>
      <p className="settings-description">
        Standardinställningar för export-dialogen.
      </p>

      <div className="export-field">
        <label>Standardformat</label>
        <select
          value={config.export_default_format}
          onChange={(e) => update({ export_default_format: e.target.value })}
        >
          {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
            <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
          ))}
        </select>
      </div>

      <div className="export-field">
        <label>Standardexportmapp</label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            readOnly
            value={config.export_default_folder ?? ""}
            placeholder="Ingen standardmapp vald…"
            style={{ flex: 1 }}
          />
          <button className="secondary" onClick={pickFolder}>Bläddra</button>
          {config.export_default_folder && (
            <button className="secondary" onClick={() => update({ export_default_folder: null })}>
              Rensa
            </button>
          )}
        </div>
      </div>

      <p className="settings-description" style={{ marginTop: "1.25rem", marginBottom: "0.5rem" }}>
        Filnamnsmallar — tillgängliga variabler: <code>{"{title}"}</code> = avsnittsnamn,{" "}
        <code>{"{label}"}</code> = segmentnamn, <code>{"{n}"}</code> = tvåsiffrigt löpnummer (kapitelfiler).
      </p>

      <div className="export-field">
        <label>Ren MP3 — filnamn</label>
        <input
          type="text"
          value={config.export_filename_clean_mp3}
          onChange={(e) => update({ export_filename_clean_mp3: e.target.value })}
          placeholder="{title}-clean"
        />
      </div>

      <div className="export-field">
        <label>Separata kapitelfiler — filnamn</label>
        <input
          type="text"
          value={config.export_filename_chapters}
          onChange={(e) => update({ export_filename_chapters: e.target.value })}
          placeholder="{n} {label}"
        />
      </div>

      <div className="export-field">
        <label>M4B med kapitelmarkeringar — filnamn</label>
        <input
          type="text"
          value={config.export_filename_m4b_chapters}
          onChange={(e) => update({ export_filename_m4b_chapters: e.target.value })}
          placeholder="{title}"
        />
      </div>

      <div className="export-field">
        <label>JSON-metadata — filnamn</label>
        <input
          type="text"
          value={config.export_filename_json}
          onChange={(e) => update({ export_filename_json: e.target.value })}
          placeholder="{title}"
        />
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={config.export_loudness_normalize}
          onChange={(e) => update({ export_loudness_normalize: e.target.checked })}
        />
        Loudness-normalisering vid export
      </label>
      <p className="settings-description">
        Lägger till <code>-af loudnorm</code> i ffmpeg-körningen. Jämnar ut
        volymen vid övergångarna där reklam klippts bort.
      </p>
    </div>
  );
}
