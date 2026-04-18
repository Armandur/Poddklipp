import { useCallback, useEffect, useState } from "react";
import {
  listSegmentKinds,
  updateSegmentKind,
  SegmentKindSetting,
  SegmentKind,
} from "../lib/tauri";

export function useSegmentKinds() {
  const [kinds, setKinds] = useState<SegmentKindSetting[]>([]);

  useEffect(() => {
    listSegmentKinds().then(setKinds).catch(console.error);
  }, []);

  const update = useCallback(
    async (slug: SegmentKind, label: string, defaultExcluded: boolean) => {
      const updated = await updateSegmentKind(slug, label, defaultExcluded);
      setKinds((prev) => prev.map((k) => (k.slug === slug ? updated : k)));
    },
    [],
  );

  const defaultExcludedFor = useCallback(
    (slug: string): boolean => {
      return kinds.find((k) => k.slug === slug)?.default_excluded ?? false;
    },
    [kinds],
  );

  const labelFor = useCallback(
    (slug: string): string => {
      return kinds.find((k) => k.slug === slug)?.label ?? slug;
    },
    [kinds],
  );

  return { kinds, update, defaultExcludedFor, labelFor };
}

export type SegmentKindsHook = ReturnType<typeof useSegmentKinds>;
