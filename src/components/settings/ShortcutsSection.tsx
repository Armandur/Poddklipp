import { useState } from "react";
import { AppConfigHook } from "../../hooks/useAppConfig";
import {
  SHORTCUT_ACTIONS,
  eventToShortcutString,
  formatShortcutDisplay,
  resolveShortcuts,
} from "../../lib/shortcuts";

interface Props {
  appConfig: AppConfigHook;
}

export default function ShortcutsSection({ appConfig }: Props) {
  const { config, update } = appConfig;
  const [recording, setRecording] = useState<string | null>(null); // action id being recorded

  const resolved = resolveShortcuts(config.shortcuts);

  function startRecording(actionId: string) {
    setRecording(actionId);
  }

  function handleKey(e: React.KeyboardEvent, actionId: string) {
    if (e.key === "Escape") {
      setRecording(null);
      return;
    }
    const combo = eventToShortcutString(e.nativeEvent);
    if (!combo) return;
    e.preventDefault();
    e.stopPropagation();
    const next = { ...config.shortcuts, [actionId]: combo };
    update({ shortcuts: next });
    setRecording(null);
  }

  function resetAction(actionId: string) {
    const next = { ...config.shortcuts };
    delete next[actionId];
    update({ shortcuts: next });
  }

  return (
    <div>
      <p className="settings-description">
        Klicka på ett snabbkommando för att ändra det. Tryck Escape för att avbryta.
      </p>

      <table style={{ fontSize: "0.85rem" }}>
        <thead>
          <tr>
            <th>Åtgärd</th>
            <th style={{ width: "11rem" }}>Tangent</th>
            <th style={{ width: "3rem" }}></th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUT_ACTIONS.map((action) => {
            const isRecording = recording === action.id;
            const current = resolved[action.id as keyof typeof resolved];
            const isCustom = action.id in config.shortcuts;
            return (
              <tr key={action.id}>
                <td>{action.label}</td>
                <td>
                  {isRecording ? (
                    <input
                      autoFocus
                      readOnly
                      placeholder="Tryck en tangent…"
                      style={{ width: "100%", cursor: "default" }}
                      onKeyDown={(e) => handleKey(e, action.id)}
                      onBlur={() => setRecording(null)}
                    />
                  ) : (
                    <button
                      className="secondary"
                      style={{ width: "100%", fontVariantNumeric: "tabular-nums" }}
                      onClick={() => startRecording(action.id)}
                    >
                      {formatShortcutDisplay(current)}
                      {isCustom && (
                        <span style={{ marginLeft: "0.4rem", fontSize: "0.7rem", color: "var(--accent)" }}>
                          ✎
                        </span>
                      )}
                    </button>
                  )}
                </td>
                <td>
                  {isCustom && (
                    <button
                      className="secondary"
                      style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem" }}
                      title="Återställ standard"
                      onClick={() => resetAction(action.id)}
                    >
                      ↺
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
