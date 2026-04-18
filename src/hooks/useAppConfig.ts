import { useCallback, useEffect, useState } from "react";
import { AppConfig, getAppConfig, setAppConfig } from "../lib/tauri";
import { resolveShortcuts, ResolvedShortcuts } from "../lib/shortcuts";

export interface AppConfigHook {
  config: AppConfig;
  shortcuts: ResolvedShortcuts;
  loading: boolean;
  update: (patch: Partial<AppConfig>) => Promise<void>;
}

const DEFAULT_CONFIG: AppConfig = {
  analysis_threshold: 0.7,
  export_default_format: "clean_mp3",
  export_default_folder: null,
  export_loudness_normalize: false,
  export_filename_clean_mp3: "{title}-clean",
  export_filename_chapters: "{n} {label}",
  export_filename_m4b_chapters: "{title}",
  export_filename_json: "{title}",
  confirm_delete_segment: true,
  shortcuts: {},
  whisper_model: "base",
  whisper_language: "sv",
  transcribe_segment_kinds: ["chapter"],
};

export function useAppConfig(): AppConfigHook {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAppConfig()
      .then((c) => setConfig(c))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = useCallback(
    async (patch: Partial<AppConfig>) => {
      const next = { ...config, ...patch };
      setConfig(next);
      await setAppConfig(next);
    },
    [config],
  );

  const shortcuts = resolveShortcuts(config.shortcuts);

  return { config, shortcuts, loading, update };
}
