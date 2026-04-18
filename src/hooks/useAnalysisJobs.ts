import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export interface AnalysisJob {
  state: "running" | "error";
  progress: number;
  stage: string;
  error?: string;
}

interface ProgressPayload {
  episode_id: number;
  progress: number;
  stage: string;
}

interface StartedPayload {
  episode_id: number;
}

interface CompletePayload {
  episode_id: number;
}

interface ErrorPayload {
  episode_id: number;
  error: string;
}

// Antal slutförda analyser per avsnitt används som useEffect-dep så konsumenter
// kan trigga omladdning av detektioner/segment när deras jobb blir klart.
export function useAnalysisJobs() {
  const [jobs, setJobs] = useState<Map<number, AnalysisJob>>(new Map());
  const [completionTicks, setCompletionTicks] = useState<Map<number, number>>(
    new Map(),
  );

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    listen<StartedPayload>("analysis-started", (e) => {
      setJobs((prev) => {
        const next = new Map(prev);
        next.set(e.payload.episode_id, {
          state: "running",
          progress: 0,
          stage: "startar…",
        });
        return next;
      });
    }).then((u) => unlisteners.push(u));

    listen<ProgressPayload>("sidecar-progress", (e) => {
      setJobs((prev) => {
        const cur = prev.get(e.payload.episode_id);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(e.payload.episode_id, {
          ...cur,
          progress: e.payload.progress,
          stage: e.payload.stage,
        });
        return next;
      });
    }).then((u) => unlisteners.push(u));

    listen<CompletePayload>("analysis-complete", (e) => {
      setJobs((prev) => {
        const next = new Map(prev);
        next.delete(e.payload.episode_id);
        return next;
      });
      setCompletionTicks((prev) => {
        const next = new Map(prev);
        next.set(e.payload.episode_id, (prev.get(e.payload.episode_id) ?? 0) + 1);
        return next;
      });
    }).then((u) => unlisteners.push(u));

    listen<ErrorPayload>("analysis-error", (e) => {
      setJobs((prev) => {
        const next = new Map(prev);
        next.set(e.payload.episode_id, {
          state: "error",
          progress: 0,
          stage: "",
          error: e.payload.error,
        });
        return next;
      });
    }).then((u) => unlisteners.push(u));

    return () => {
      for (const u of unlisteners) u();
    };
  }, []);

  return { jobs, completionTicks };
}
