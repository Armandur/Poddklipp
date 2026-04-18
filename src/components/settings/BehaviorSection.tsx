import { AppConfigHook } from "../../hooks/useAppConfig";

interface Props {
  appConfig: AppConfigHook;
}

export default function BehaviorSection({ appConfig }: Props) {
  const { config, update } = appConfig;

  return (
    <div>
      <p className="settings-description">
        Allmänt beteende i gränssnittet.
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          checked={config.confirm_delete_segment}
          onChange={(e) => update({ confirm_delete_segment: e.target.checked })}
        />
        Bekräftelsedialog vid borttagning av segment
      </label>
      <p className="settings-description">
        Visa en bekräftelseprompt innan ett segment raderas. Avmarkera för
        snabbare arbetsflöde.
      </p>
    </div>
  );
}
