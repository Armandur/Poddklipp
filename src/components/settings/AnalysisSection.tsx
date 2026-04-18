import { AppConfigHook } from "../../hooks/useAppConfig";

interface Props {
  appConfig: AppConfigHook;
}

export default function AnalysisSection({ appConfig }: Props) {
  const { config, update } = appConfig;
  const t = config.analysis_threshold;

  return (
    <div>
      <p className="settings-description">
        Inställningar som påverkar jingel-matchningen.
      </p>

      <div className="export-field">
        <label>
          Matchningströskel
          <span style={{ float: "right", fontWeight: 400, color: "var(--text)" }}>
            {t.toFixed(2)}
          </span>
        </label>
        <input
          type="range"
          min={0.3}
          max={0.99}
          step={0.01}
          value={t}
          style={{ width: "100%", accentColor: "var(--accent)" }}
          onChange={(e) => update({ analysis_threshold: parseFloat(e.target.value) })}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
          <span>0.30 — lös (fler träffar, risk för falskt positiva)</span>
          <span>0.99 — strikt</span>
        </div>
      </div>

      <p className="settings-description" style={{ marginTop: "0.5rem" }}>
        Standard är 0.70. Sänk om välkända jinglar missas; höj om du får falska träffar.
        Ändringen gäller nästa analys-körning.
      </p>

      <div className="export-field" style={{ marginTop: "1rem" }}>
        <label>Whisper-modell (transkribering)</label>
        <select
          value={config.whisper_model}
          onChange={(e) => update({ whisper_model: e.target.value })}
          style={{ width: "100%" }}
        >
          <option value="tiny">tiny — snabbast, lägst kvalitet (~39 MB)</option>
          <option value="base">base — bra balans (~74 MB)</option>
          <option value="small">small — bättre svenska (~244 MB)</option>
          <option value="medium">medium — hög kvalitet (~769 MB)</option>
          <option value="large">large — bäst, långsammast (~1.5 GB)</option>
        </select>
        <p className="settings-description" style={{ marginTop: "0.4rem" }}>
          Modellen laddas ned vid första transkriberingen och cachas lokalt.
        </p>
      </div>

      <div className="export-field" style={{ marginTop: "1rem" }}>
        <label>Whisper-språk</label>
        <select
          value={config.whisper_language}
          onChange={(e) => update({ whisper_language: e.target.value })}
          style={{ width: "100%" }}
        >
          <option value="sv">Svenska (sv)</option>
          <option value="en">Engelska (en)</option>
          <option value="no">Norska (no)</option>
          <option value="da">Danska (da)</option>
          <option value="fi">Finska (fi)</option>
          <option value="de">Tyska (de)</option>
          <option value="fr">Franska (fr)</option>
          <option value="es">Spanska (es)</option>
        </select>
      </div>

    </div>
  );
}
