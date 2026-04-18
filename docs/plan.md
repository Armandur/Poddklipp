# Plan: Podklipp — desktop-app för att klippa podcastavsnitt via jingel-detektion

## Context

Rasmus vill ha ett verktyg som automatiskt identifierar strukturen i podcastavsnitt
genom att leta efter kända ljudsignaturer och därefter låta användaren klippa
bort reklam, namnge kapitel och exportera en ren version. Dagens flöde (manuellt
i Audacity) tar 30+ minuter per avsnitt. Målet är att få ner det till någon
minut interaktiv tid plus automatisk analys i bakgrunden.

**Viktigt om jinglar:** ett enskilt avsnitt innehåller typiskt **flera olika
typer av jinglar, var och en i flera instanser**. En typisk körning kan se ut så här:

```
00:00  Intro-jingel                ← 1 st intro
00:32  Kapitel-stinger             ← kapitel-stinger förekommer N gånger
18:42  Reklam-in-jingel            ← reklam-marker förekommer M gånger
21:15  Reklam-ut-jingel
21:15  Kapitel-stinger
45:01  Reklam-in-jingel
47:30  Reklam-ut-jingel
47:30  Kapitel-stinger
...
01:58:10  Outro-jingel             ← 1 st outro
```

Matchningen måste därför köra **varje jingel i biblioteket mot hela avsnittet
och returnera alla träffar per jingel**, inte bara en bästa-match. Segment
genereras sedan från den sammanslagna, tidssorterade listan av detektioner
oavsett typ.

Verktyget ska köras lokalt på en maskin (single-user), klara en-eller-flera
avsnitt åt gången och stödja fyra exportformat.

## Modellval under implementationen

Det här projektet är stort men till stora delar rutinmässigt — bara vissa bitar
kräver Opus 4.7. **Innan varje milstolpe ska Claude stanna och fråga Rasmus
om modell-byte är lämpligt.** Tumregel:

| Arbete | Rekommenderad modell | Varför |
|---|---|---|
| Arkitektur-design, UX-beslut, debug av matchning | **Opus 4.7** | Kräver nyanserat resonemang. |
| M4 (initial design av `match.py` + test-rigg) | **Opus 4.7** | Algoritmisk kärna — värt precision. |
| M5 (timeline-interaktion, WaveSurfer-state) | **Opus 4.7** | Tricky state-management. |
| M1 (scaffold, boilerplate, configs) | **Sonnet 4.6** | Rutin. |
| M2, M3, M6 (CRUD, ffmpeg-orkestrering) | **Sonnet 4.6** | Rutin. |
| M7 (polish, README, genvägar) | **Sonnet 4.6** eller **Haiku 4.5** | Mestadels text och kosmetik. |
| Stora refactors, ful-felsökning som Sonnet kört fast på | **Opus 4.7** | Återgå till Opus när något knivigt dyker upp. |

**Checkpoints där Claude ska pausa och fråga:** vid början av varje milstolpe
(M1→M2→M3→…→M7), samt alltid när ett nytt problem visar sig vara enklare
eller svårare än förväntat.

## Valda designbeslut (baserat på dialog)

| Beslut | Val | Motivering |
|---|---|---|
| Distribution | Desktop-app via **Tauri** (Rust-core) + **React/TS** frontend | Native-känsla, bra timeline-prestanda, enkel distribution. |
| Audio-backend | **Python-sidecar** som spawnar från Tauri-core, kommunicerar via stdio-JSON | Rasmus vill jobba i scipy-ekosystemet; sidecar-mönstret är väldokumenterat i Tauri. |
| Matchning | `scipy.signal.fftconvolve` (normerad cross-correlation) | Jinglar i studio-producerade poddar är bit-identiska → FFT-correlation ger zero-falsk-positiv i princip. |
| Framtidsmöjlighet | Chromaprint/`fpcalc`-fallback för remastrade jinglar | Dokumenteras i README men bygg inte in förrän det behövs. |
| Timeline-UI | **WaveSurfer.js v7** + regions-plugin | De-facto-standard, regions + markers + scrub ur boxen. |
| Persistens | **SQLite** via `rusqlite` i Tauri-core | Jingel-bibliotek, avsnitts-analyser, segment-redigeringar. |
| Avsnittskälla | Filuppladdning (drag-and-drop) + peka på lokal mapp för batch | Svar på klargörande-fråga. |
| Reklam-logik | Automatiken markerar **kandidat-punkter**, användaren drar klippen manuellt | Svar på klargörande-fråga — säkrast. |
| Export | Alla fyra format: ren MP3, separata kapitel, ID3-kapitel-MP3, JSON-metadata | Svar på klargörande-fråga. |
| Ljudkodning | `ffmpeg` som bundlad binary (sidecar) | Industri-standard, hanterar MP3/M4A/WAV/OGG utan smärta. |

## Arkitektur

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri-webview (React + TS + Vite)                             │
│ ─────────────────────────────────────────────────────────────│
│  • Jingel-bibliotek (CRUD)                                    │
│  • Avsnittslista                                              │
│  • Timeline (WaveSurfer.js + regions)                         │
│  • Segment-editor (tabell + drag-in-timeline)                 │
│  • Export-dialog                                              │
└────────────────────────┬─────────────────────────────────────┘
                         │ invoke() / emit()
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Tauri-core (Rust)                                             │
│ ─────────────────────────────────────────────────────────────│
│  • File-pickers, folder-scan, drag-drop                       │
│  • SQLite via rusqlite (jingles, episodes, segments)          │
│  • Sidecar-mgmt: spawnar python-sidecar vid behov             │
│  • Sidecar-mgmt: spawnar ffmpeg för export                    │
│  • Filsystem-cache för waveform-peaks och avkodat PCM         │
└──────┬──────────────────────────────────┬───────────────────┘
       │ stdio JSON-RPC                   │ subprocess
       ▼                                  ▼
┌────────────────────────────┐   ┌────────────────────────────┐
│ python-sidecar             │   │ ffmpeg (bundled)           │
│ ───────────────────────────│   │ ───────────────────────────│
│  • Ladda PCM (soundfile)   │   │  • Dekoda till WAV/PCM     │
│  • FFT cross-correlation   │   │  • Koda MP3 vid export     │
│  • Peak-detektion          │   │  • ID3-chapters (-metadata)│
│  • Waveform-peaks          │   │                            │
│  • Returnerar JSON         │   │                            │
└────────────────────────────┘   └────────────────────────────┘
```

## Projektstruktur

```
/mnt/c/aikodning/podklipp/
├── README.md                    # Setup, bygga, arkitektur, framtidsidéer
├── docs/
│   └── plan.md                  # Denna plan speglad in i repot (M1)
├── .gitignore
├── package.json                 # Frontend + Tauri CLI
├── tsconfig.json
├── vite.config.ts
├── src/                         # React frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── JingleLibrary.tsx
│   │   ├── EpisodeList.tsx
│   │   ├── Timeline.tsx         # WaveSurfer.js-wrapper
│   │   ├── SegmentTable.tsx
│   │   └── ExportDialog.tsx
│   ├── hooks/
│   │   ├── useEpisode.ts
│   │   └── useJingles.ts
│   ├── lib/
│   │   ├── tauri.ts             # Tunt wrapper runt invoke()
│   │   └── format.ts            # tid-formatering etc.
│   └── styles.css
├── src-tauri/                   # Rust-core
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── src/
│   │   ├── main.rs
│   │   ├── db.rs                # rusqlite + schema
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── jingles.rs       # add/list/delete/play
│   │   │   ├── episodes.rs      # import/scan/list
│   │   │   ├── analysis.rs      # spawna sidecar, returnera detektioner
│   │   │   ├── segments.rs      # CRUD för segment + exclusion
│   │   │   └── export.rs        # kalla ffmpeg, progress-events
│   │   └── sidecar.rs           # python-sidecar-hantering
│   └── resources/
│       ├── sidecar/             # bundlad python + deps (PyInstaller-output)
│       └── ffmpeg/              # bundlad ffmpeg-binary per plattform
├── sidecar/                     # Python-källkod (byggs till sidecar/)
│   ├── pyproject.toml
│   ├── ruff.toml
│   ├── podklipp_sidecar/
│   │   ├── __main__.py          # JSON-RPC loop över stdio
│   │   ├── decode.py            # soundfile / ffmpeg-fallback
│   │   ├── match.py             # FFT-cross-correlation + peak-detection
│   │   └── waveform.py          # downsampla till peaks (för UI)
│   └── tests/
│       ├── test_match.py        # syntetiska signaler, kända offsets
│       └── test_decode.py
└── scripts/
    ├── build-sidecar.sh         # PyInstaller → src-tauri/resources/sidecar/
    └── fetch-ffmpeg.sh          # ladda ner ffmpeg-binaries per OS
```

## Datamodell (SQLite)

```sql
CREATE TABLE jingles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('intro','outro','chapter','ad_marker','custom')),
  file_path TEXT NOT NULL,        -- kopierad till app-data-mappen
  duration_ms INTEGER NOT NULL,
  sample_rate INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  source_path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  sample_rate INTEGER NOT NULL,
  waveform_peaks_path TEXT,       -- JSON-fil med downsamplade peaks
  analyzed_at TEXT,
  created_at TEXT NOT NULL
);

-- Ett avsnitt har MÅNGA detektioner: varje jingel kan hittas flera gånger,
-- och flera olika jinglar kan hittas i samma avsnitt. (episode_id, jingle_id,
-- offset_ms) är unikt — samma jingel på samma position är samma träff.
CREATE TABLE detections (
  id INTEGER PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  jingle_id INTEGER NOT NULL REFERENCES jingles(id) ON DELETE CASCADE,
  offset_ms INTEGER NOT NULL,
  confidence REAL NOT NULL,        -- normerad cross-corr-peak ∈ [0,1]
  UNIQUE(episode_id, jingle_id, offset_ms)
);
CREATE INDEX idx_detections_episode_offset ON detections(episode_id, offset_ms);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  label TEXT,                      -- "Kapitel 1: Inledning" etc.
  excluded INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL
);
```

## Kritisk kod att skriva

### 1. Matchningsalgoritm (`sidecar/podklipp_sidecar/match.py`)

Normerad FFT cross-correlation. Nyckelresept:

```python
import numpy as np
from scipy.signal import fftconvolve, find_peaks

def find_jingle(episode: np.ndarray, jingle: np.ndarray,
                sample_rate: int, threshold: float = 0.7) -> list[dict]:
    # Båda ska vara mono float32 i [-1, 1]
    ep = episode - episode.mean()
    jg = jingle - jingle.mean()

    # Cross-correlation via FFT: correlate(ep, jg) = fftconvolve(ep, jg[::-1])
    corr = fftconvolve(ep, jg[::-1], mode='valid')

    # Normering: dela med sqrt(lokal_energi * jingel_energi)
    # lokal_energi = fftconvolve(ep**2, ones_len_jg, mode='valid')
    ones = np.ones(len(jg), dtype=np.float32)
    local_energy = fftconvolve(ep**2, ones, mode='valid')
    jingle_energy = np.sum(jg**2)
    norm = np.sqrt(local_energy * jingle_energy + 1e-12)
    ncc = corr / norm                         # ∈ [-1, 1]

    # Peaks ovanför threshold, minst en jingel-längd isär
    peaks, props = find_peaks(ncc, height=threshold, distance=len(jg))

    return [
        {"offset_ms": int(p * 1000 / sample_rate),
         "confidence": float(props['peak_heights'][i])}
        for i, p in enumerate(peaks)
    ]
```

Testas med syntetiska signaler (jingel inbäddad vid kända offsets med brus) i
`tests/test_match.py` — kör innan sidecar bundlas.

Ovanstående körs sedan i en **yttre loop över alla jinglar i biblioteket** så
analyssteget returnerar en sammanslagen lista av alla träffar av alla jingeltyper:

```python
def analyze_episode(episode_pcm, sample_rate, jingles):
    all_detections = []
    for jg in jingles:                        # N jinglar i biblioteket
        jg_pcm = load_mono(jg.file_path, sample_rate)
        for hit in find_jingle(episode_pcm, jg_pcm, sample_rate):
            all_detections.append({
                "jingle_id": jg.id,
                "jingle_kind": jg.kind,        # 'intro'/'chapter'/'ad_marker'/'outro'/'custom'
                "offset_ms": hit["offset_ms"],
                "confidence": hit["confidence"],
            })
    return sorted(all_detections, key=lambda d: d["offset_ms"])
```

Segment genereras sedan frontend-side från den tidssorterade listan: varje
detektion blir en segmentgräns, segmentets default-label hämtas från
föregående detektions `jingle_kind` (t.ex. ett segment som börjar vid en
`ad_marker` blir `"Reklam"` och default-exkluderat; segment som börjar vid
`chapter` blir `"Kapitel N"`).

### 2. Sidecar JSON-RPC-loop (`sidecar/podklipp_sidecar/__main__.py`)

Enkel request/response över stdio:

```python
# Request:  {"id": 1, "method": "analyze", "params": {"episode": "...", "jingles": [...]}}
# Response: {"id": 1, "result": {"detections": [...], "waveform_peaks_path": "..."}}
# Progress: {"progress": 0.45, "stage": "correlating"} (ingen id)
```

Metoder:
- `decode(path)` → returnerar väg till WAV-cache + duration + sample_rate
- `waveform(episode_id, path, width)` → skriver peaks-JSON, returnerar path
- `analyze(episode_id, jingles)` → returnerar detektionslista

**Bakgrundsexekvering (M4/M5):** `analyze_episode`-commandot i Rust validerar
bara preflight (avsnitt finns, minst en jingel) och startar sen det riktiga
jobbet i `tauri::async_runtime::spawn_blocking`. Statusen rapporteras via
tre Tauri-event: `analysis-started`, `sidecar-progress` (med `episode_id`),
`analysis-complete` respektive `analysis-error`. Då kan användaren navigera
mellan avsnitt och redigera segment medan en analys rullar, och vi har
grunden för parallell analys via sidecar-pool längre fram. Sidecarens
`call(method, params, &on_progress)` tar en callback istället för `AppHandle`
direkt — anroparen styr vilket event-payload som emits.

**Matchnings-robusthet (M4/M5):** NCC är matematiskt skal-invariant, men
float32-numeriken blir mer stabil om båda signaler peak-normaliseras innan
korrelationen. Default-threshold är `0.6` (inte `0.7` från ursprungsplanen)
— hårt limitade streams får ibland chapter-stingers precis under 0.7.
Om detta inte räcker finns fpcalc-fallbacken som sista spår.

### 3. Timeline-komponent (`src/components/Timeline.tsx`)

WaveSurfer.js v7 med regions-plugin. Laddar peaks från cache-fil (inte rå audio)
för snabb rendering av 2h+ avsnitt. Markers för detektioner, regioner för
segment. Click-to-seek, drag-to-adjust segment-gränser. Tangentbord:
`space`=spela/paus, `←/→`=hoppa 5s, `shift+←/→`=hoppa 30s, `e`=toggla exkluderad,
`n`=namnge aktivt segment.

**Zoom och navigering (M5):** WaveSurfer har `ws.zoom(pxPerSec)`. Bind till
slider/mushjul (`ctrl+wheel`) så man kan zooma in på en jingel-gräns vid manuell
justering — 2h-avsnitt är oanvändbara utan zoom så fort man ska dra i millisekunder.
Kortkommandon `+`/`-` för zoom, `0` för fit-to-window. Minimap-strip ovanför
(separat WaveSurfer-instans på låg zoom) gör det lätt att hoppa långt i avsnittet.

**Segment-färgning (M5):** varje segment ritas som en egen region med färg
baserad på segmentets `label`/ursprungs-jingel-kind (återanvänd `KIND_COLORS`):
kapitel-segment blå, reklam-segment (default-exkluderade) dämpad röd med
diagonal-stripes-overlay så det syns att de kommer klippas bort, intro/outro
grön/rosa. Exkluderade segment får ~30% opacitet så ögat direkt ser
"detta försvinner vid export".

### 4. Export (`src-tauri/src/commands/export.rs`)

Fyra varianter, alla via `ffmpeg`:

- **Ren MP3**: `ffmpeg -i in.mp3 -filter_complex "[0]atrim=S1:E1[a1];[0]atrim=S2:E2[a2];[a1][a2]concat=n=2:a=1[out]" -map "[out]" out.mp3`
- **Separata kapitel**: loop över segment, ett `-ss -to` per fil
- **ID3-chapters**: samma concat som ren MP3, men generera `ffmetadata`-fil med `[CHAPTER]`-block och `-i meta.txt -map_metadata 1`
- **JSON**: bara skriv ut segment-listan, ingen ffmpeg-körning

Progress via ffmpegs `-progress pipe:1` → Tauri-event → frontend progress-bar.

## Milstolpar

1. **M1 — Scaffold** Tauri+React+Vite-skelett, python-sidecar-bygge, ffmpeg-bundling, "hello world" round-trip frontend→core→sidecar. **Spegla även planen till `podklipp/docs/plan.md`** så den lever i repot bredvid koden (utöver kopian i `~/.claude/plans/`).
2. **M2 — Jingel-bibliotek** CRUD, kopiera uppladdade filer till app-data, spela upp i UI.
3. **M3 — Avsnittsimport** Uppladdning + mapp-scan, metadatautvinning, waveform-peaks-cache.
4. **M4 — Matchning** `match.py` med tester, kör analys, rita ut detektioner som markers i timeline.
5. **M5 — Segmentering** Automatisk segment-generering mellan markers, tabell-UI, drag-för-justera i timeline, namn+exkludering.
6. **M6 — Export** Alla fyra format, progress-events, felhantering vid ffmpeg-fel.
7. **M7 — Polish** Tangentbordsgenvägar, tema, README med screenshots, framtids-dokumentation (fpcalc, batch-mode, RSS-scraping).

Riktvärde: M1–M3 första sprinten, M4–M6 andra, M7 tredje.

## Filer som ska skapas (nya — hela projektet är grönfält)

Alla sökvägar relativt `/mnt/c/aikodning/podklipp/`. Ingen befintlig kod berörs.

Nyckelfiler i prioritetsordning:
1. `sidecar/podklipp_sidecar/match.py` + tester — verktygets hjärta
2. `src-tauri/src/sidecar.rs` — spawn + JSON-RPC-glue
3. `src-tauri/src/db.rs` — schema + migrations
4. `src/components/Timeline.tsx` — WaveSurfer-integration, svåraste UI-biten
5. `src-tauri/src/commands/export.rs` — ffmpeg-orkestrering
6. Övriga komponenter, commands, hooks — mer rutinmässigt

## Verifiering

**Enhetstester (Python-sidecar):**
```bash
cd sidecar && ruff check . && ruff format --check . && pytest
```
`test_match.py` genererar syntetiskt ljud med kända jingel-offsets + brus →
verifierar att `find_jingle` hittar dem inom ±50ms.

**Rust-tester:**
```bash
cd src-tauri && cargo test
```
Tester för DB-schema/migrations och JSON-RPC-parsing.

**Manuell end-to-end (obligatorisk efter M6):**
1. Starta app: `npm run tauri dev`
2. Lägg till jingel: dra in `intro.wav` i biblioteket, namnge "Intro P3"
3. Importera avsnitt: dra in MP3 eller välj mapp
4. Invänta analys (progress-bar) → timeline visar markers
5. Dra segment-gränser, namnge kapitel, markera reklam som exkluderad
6. Exportera som "MP3 utan reklam" → öppna resultatet i valfri spelare,
   verifiera att reklam-sektioner saknas och att övergångar låter rena
7. Exportera som "ID3-chapters" → öppna i poddspelare (t.ex. Overcast/Pocket
   Casts) och verifiera att kapitel-navigation fungerar

**Prestanda-baseline:**
- Analys av 2h MP3 mot 5 jinglar ska gå under 30 sekunder på M1/Ryzen-klass CPU
- Timeline-scrolling i 2h-avsnitt ska vara 60 fps (peaks cachade, inte rå audio)

## Framtida möjligheter (dokumenteras i README — bygg INTE nu)

- **Chromaprint/`fpcalc`-fallback** för avsnitt där jingeln har remastrats
  (annan bitrate/EQ). Gör `match.py` pluggbart så en `MatchStrategy`-abstraktion
  kan växla mellan FFT-NCC och fingerprint-Hamming-distance.
- **RSS-feed-import** — klistra in feed-URL, lista avsnitt, ladda ner valda.
- **Jingel-lärande** — klicka i timeline för att manuellt markera en jingel,
  appen extraherar klippet och lägger till biblioteket automatiskt.
- **Batch-export** — kör samma segment-template över flera avsnitt av samma podd.
- **Loudness-normalisering vid export** (`ffmpeg -af loudnorm`) — jämnar ut
  övergångarna där reklam klippts bort.
- **Multi-user/web-variant** — om behovet uppstår, återanvänd Python-matchningen
  bakom en FastAPI-backend (matchar svk-short-stacken).
