import { useEffect, useState } from "react";
import EpisodeDetail from "./components/EpisodeDetail";
import EpisodeList from "./components/EpisodeList";
import JingleLibrary from "./components/JingleLibrary";
import SegmentKindSettings from "./components/SegmentKindSettings";
import { useAnalysisJobs } from "./hooks/useAnalysisJobs";
import { useEpisodes } from "./hooks/useEpisodes";
import { useSegmentKinds } from "./hooks/useSegmentKinds";
import type { Episode } from "./lib/tauri";

export default function App() {
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const { jobs, completionTicks } = useAnalysisJobs();
  const episodesState = useEpisodes();
  const { episodes, refresh } = episodesState;
  const segmentKinds = useSegmentKinds();

  // När ett jobb blir klart: refresha avsnittslistan så "Analyserad"-märkningen
  // och eventuella nya duration/sample_rate-värden kommer in.
  useEffect(() => {
    if (completionTicks.size === 0) return;
    refresh();
  }, [completionTicks, refresh]);

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
        <button
          className="secondary"
          onClick={() => setShowSettings(true)}
          style={{ alignSelf: "center" }}
        >
          Inställningar
        </button>
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
          />
        )}
      </main>
      {showSettings && (
        <SegmentKindSettings
          kinds={segmentKinds}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
