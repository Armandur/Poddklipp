# Podklipp

Desktop-app för att klippa podcastavsnitt. Identifierar kända jinglar (intro,
kapitel-stinger, reklam-jingel, outro) via FFT cross-correlation, visar
avsnittet som en interaktiv timeline och exporterar en ren version utan reklam.

## Vad det gör

1. Du bygger ett jingel-bibliotek — ladda in korta WAV/MP3-klipp och märk
   dem som `intro`, `kapitel`, `reklam` eller `outro`.
2. Importera ett eller flera avsnitt (drag-and-drop eller mapp-scan).
3. Appen kör varje jingel mot hela avsnittet och markerar alla träffar som
   kandidat-punkter i en vågforms-timeline.
4. Du justerar segment-gränserna manuellt, namnger kapitel och markerar
   reklam-block som exkluderade.
5. Exportera — ren MP3, separata kapitel-filer, MP3 med inbyggda
   ID3-kapitelmarkeringar, eller bara ett JSON-manifest.

## Dev-setup (Windows native)

### Förutsättningar

Installera en gång, i valfri ordning:

```powershell
# Rust (inkluderar cargo)
winget install Rustlang.Rustup
# Starta om terminalen, sedan:
rustup default stable

# Node.js (v20+)
winget install OpenJS.NodeJS

# ffmpeg (används för MP3-dekodning och export)
winget install Gyan.FFmpeg
# Eller ladda ner manuellt från https://www.gyan.dev/ffmpeg/builds/

# Python (3.12+, för sidecar-development och tester)
winget install Python.Python.3.12

# Tauri CLI (installeras som del av npm-deps, men kan installeras globalt)
cargo install tauri-cli
```

Kontrollera installationerna:

```powershell
cargo --version
node --version
npm --version
ffmpeg -version
python --version
```

### Sätt upp projektet

```powershell
git clone <repo-url>
cd podklipp

# Frontend-deps
npm install

# Python-sidecar (i ett venv — måste vara Windows-venv, inte WSL!)
cd sidecar
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
deactivate
cd ..
```

### Köra i dev-läge

```powershell
npm run tauri dev
```

### Köra sidecar-tester

```powershell
cd sidecar
.venv\Scripts\activate      # eller `source .venv/bin/activate` på WSL/Mac
ruff check .
ruff format --check .
pytest
```

## Tangentbordsgenvägar

### Uppspelning (fungerar alltid)

| Tangent | Funktion |
|---|---|
| `Mellanslag` | Spela / Pausa |
| `←` / `→` | Hoppa 5 sekunder |
| `Shift+←` / `Shift+→` | Hoppa 30 sekunder |
| `+` / `=` | Zooma in i timeline |
| `-` | Zooma ut i timeline |
| `0` | Återställ zoom (fit-to-window) |

### Segment-redigering (kräver ett aktivt segment)

Klicka på en rad i segment-tabellen för att aktivera den (den markeras blå).
Alternativt väljs segmentet automatiskt medan avsnittet spelas upp.

| Tangent | Funktion |
|---|---|
| `E` | Exkludera / inkludera aktivt segment |
| `N` | Börja namnge aktivt segment |

## Arkitektur

```
Tauri webview (React + TypeScript + Vite)
    │ invoke() / emit()
    ▼
Tauri core (Rust) — filpicker, SQLite, sidecar-spawn, ffmpeg-export
    │ stdio JSON-RPC        │ subprocess
    ▼                       ▼
Python sidecar         ffmpeg (bundled)
(FFT matching,         (MP3-avkodning,
 waveform-peaks)        export + ID3)
```

Se [`docs/plan.md`](docs/plan.md) för fullständig arkitektur, datamodell och
milstolpe-plan.

## Bibliotek och beroenden

| Komponent | Teknologi |
|---|---|
| Desktop-wrapper | Tauri v2 (Rust) |
| Frontend | React 18 + TypeScript + Vite |
| Waveform + timeline | WaveSurfer.js v7 + regions-plugin |
| Persistens | SQLite via rusqlite |
| Audio-matchning | scipy.signal.fftconvolve (Python sidecar) |
| Ljud-dekodning | soundfile + ffmpeg-fallback |
| Export | ffmpeg (bundlad binary) |

## Framtida möjligheter

- **Chromaprint/fpcalc** — akustiskt fingeravtryck som fallback när jingeln har
  remastrats till annan bitrate/EQ. `match.py` är tänkt att vara pluggbart med
  en `MatchStrategy`-abstraktion för att stödja detta utan att skriva om kärnan.
  Se [Chromaprint-dokumentationen](https://acoustid.org/chromaprint) för detaljer.
- **RSS-feed-import** — klistra in feed-URL, välj avsnitt, appen laddar ner dem.
- **Jingel-lärande** — klicka i timeline för att markera en jingel; appen
  extraherar klippet och lägger till biblioteket automatiskt.
- **Batch-export** — applicera samma segment-mall på alla avsnitt av en podd.
- **Loudness-normalisering** — `ffmpeg -af loudnorm` jämnar ut övergångarna
  där reklam klippts bort.
