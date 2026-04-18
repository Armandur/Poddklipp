import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

interface ProgressPayload {
  segment_id: number;
  progress: number;
  stage: string;
}

export default function TranscriptionToast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      listen<ProgressPayload>("transcription-progress", (e) => {
        setMessage(e.payload.stage);
      }),
      listen("transcription-done", () => setMessage(null)),
      listen("transcription-error", () => setMessage(null)),
    ];
    return () => {
      unsubs.forEach((p) => p.then((u) => u()));
    };
  }, []);

  if (!message) return null;

  return (
    <div className="transcription-toast">
      <span className="transcription-toast-spinner" />
      {message}
    </div>
  );
}
