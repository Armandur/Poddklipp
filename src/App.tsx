import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import BatchExportDialog from "./components/BatchExportDialog";
import TranscriptionToast from "./components/TranscriptionToast";
import EpisodeDetail from "./components/EpisodeDetail";
import EpisodeList from "./components/EpisodeList";
import JingleLibrary from "./components/JingleLibrary";
import SegmentKindSettings from "./components/SegmentKindSettings";
import { useAnalysisJobs } from "./hooks/useAnalysisJobs";
import { useAppConfig } from "./hooks/useAppConfig";
import { useEpisodes } from "./hooks/useEpisodes";
import { useSegmentKinds } from "./hooks/useSegmentKinds";
import type { Episode } from "./lib/tauri";

export default function App() {
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showBatchExport, setShowBatchExport] = useState(false);
  const { jobs, completionTicks } = useAnalysisJobs();
  const episodesState = useEpisodes();
  const { episodes, refresh } = episodesState;
  const segmentKinds = useSegmentKinds();
  const appConfig = useAppConfig();

  // När ett jobb blir klart: refresha avsnittslistan.
  useEffect(() => {
    if (completionTicks.size === 0) return;
    refresh();
  }, [completionTicks, refresh]);

  // När vågform räknats klart: refresha så episode.waveform_peaks_path uppdateras.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("waveform-ready", () => refresh()).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [refresh]);

  // När datamappen byts: nollställ valt avsnitt och refresha allt.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("data-dir-changed", () => {
      setSelectedEpisode(null);
      refresh();
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [refresh]);

  // Om det valda avsnittet har uppdaterats i listan (t.ex. analyzed_at fylld i),
  // speglar vi den färska versionen in i selectedEpisode.
  useEffect(() => {
    if (!selectedEpisode) return;
    const fresh = episodes.find((e) => e.id === selectedEpisode.id);
    if (fresh && fresh !== selectedEpisode) {
      setSelectedEpisode(fresh);
    }
  }, [episodes, selectedEpisode]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Podklipp</h1>
          <p className="tagline">Klipp podcastavsnitt via jingel-detektion</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignSelf: "center" }}>
          <button className="secondary" onClick={() => setShowBatchExport(true)}>
            Batch-exportera
          </button>
          <button className="secondary" onClick={() => setShowSettings(true)}>
            Inställningar
          </button>
        </div>
      </header>
      <main className="app-main">
        <div className="two-col">
          <JingleLibrary />
          <EpisodeList
            episodes={episodesState}
            jobs={jobs}
            onSelect={setSelectedEpisode}
            selectedId={selectedEpisode?.id ?? null}
          />
        </div>
        {selectedEpisode && (
          <EpisodeDetail
            episode={selectedEpisode}
            job={jobs.get(selectedEpisode.id) ?? null}
            completionTick={completionTicks.get(selectedEpisode.id) ?? 0}
            segmentKinds={segmentKinds}
            appConfig={appConfig}
          />
        )}
      </main>
      {showBatchExport && (
        <BatchExportDialog
          episodes={episodes}
          onClose={() => setShowBatchExport(false)}
        />
      )}
      {showSettings && (
        <SegmentKindSettings
          kinds={segmentKinds}
          appConfig={appConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
      <TranscriptionToast />
    </div>
  );
}
