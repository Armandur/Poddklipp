import { useCallback, useEffect, useState } from "react";
import {
  addJingle,
  AddJingleInput,
  deleteJingle,
  Jingle,
  listJingles,
} from "../lib/tauri";

export function useJingles() {
  const [jingles, setJingles] = useState<Jingle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setJingles(await listJingles());
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
    async (input: AddJingleInput) => {
      await addJingle(input);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: number) => {
      await deleteJingle(id);
      await refresh();
    },
    [refresh],
  );

  return { jingles, loading, error, refresh, add, remove };
}
