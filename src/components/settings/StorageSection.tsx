import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { getDataDir, setDataDir } from "../../lib/tauri";

export default function StorageSection() {
  const [currentDir, setCurrentDir] = useState<string>("");
  const [copyFiles, setCopyFiles] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDataDir().then(setCurrentDir).catch(() => {});
  }, []);

  async function pickDir() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") return;
    await applyDir(selected);
  }

  async function applyDir(newPath: string) {
    if (newPath === currentDir) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await setDataDir(newPath, copyFiles);
      setCurrentDir(newPath);
      setSuccess(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p className="settings-description">
        Välj var Podklipp sparar sin databas, jinglar och vågformscacher.
        Ändringen träder i kraft omedelbart.
      </p>

      <div className="export-field">
        <label>Aktuell datamapp</label>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            readOnly
            value={currentDir}
            style={{ flex: 1, opacity: 0.8 }}
          />
          <button className="secondary" onClick={pickDir} disabled={saving}>
            Ändra…
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          id="copy-files"
          type="checkbox"
          checked={copyFiles}
          onChange={(e) => setCopyFiles(e.target.checked)}
          disabled={saving}
        />
        <label htmlFor="copy-files" style={{ fontSize: "0.85rem", cursor: "pointer" }}>
          Kopiera befintliga filer (databas, jinglar, vågformscacher) till ny mapp
        </label>
      </div>

      {saving && <div className="progress-stage">Flyttar filer…</div>}
      {error && <div className="error">{error}</div>}
      {success && (
        <div className="export-done">
          Datamapp ändrad till <code>{currentDir}</code>
        </div>
      )}
    </>
  );
}
