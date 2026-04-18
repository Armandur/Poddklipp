import { useCallback, useEffect, useState } from "react";
import {
  addEpisode,
  AddEpisodeInput,
  deleteEpisode,
  Episode,
  listEpisodes,
} from "../lib/tauri";

export function useEpisodes() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setEpisodes(await listEpisodes());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (input: AddEpisodeInput) => {
      const ep = await addEpisode(input);
      await refresh();
      return ep;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      await deleteEpisode(id);
      await refresh();
    },
    [refresh],
  );

  return { episodes, loading, error, refresh, add, remove };
}
