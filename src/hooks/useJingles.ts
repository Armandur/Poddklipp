import { listen } from "@tauri-apps/api/event";
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

  useEffect(() => {
    let u1: (() => void) | null = null;
    let u2: (() => void) | null = null;
    listen("jingle-added", () => refresh()).then((fn) => { u1 = fn; });
    listen("data-dir-changed", () => refresh()).then((fn) => { u2 = fn; });
    return () => { u1?.(); u2?.(); };
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
