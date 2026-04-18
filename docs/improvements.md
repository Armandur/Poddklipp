# Podklipp — förbättringsförslag

Genererat 2026-04-18 via statisk kodgranskning. Prioritet baseras på risk för
datatapps/säkerhet > vardagligt skav > underhållbarhet > nice-to-have.

---

## P0 — Kritiska (säkerhet / datatapp / krasch)

### S-1 · FS-scope är obegränsad
**Fil:** `src-tauri/capabilities/default.json`, `tauri.conf.json` rad 28  
`"path": "**"` och `"assetProtocol.scope": ["**"]` gör att webview-sidan kan
läsa godtycklig fil på disk (inkl. `~/.ssh/id_rsa`, Windows Credential Store
m.fl.). CSP är satt till `null` — ingen barriär mot injicerad JS.  
**Åtgärd:** Begränsa scope till `$APPDATA/**`, `$AUDIO/**` och enskilda
filvägar som skapats via native file-picker; sätt en rimlig CSP.

### S-2 · `unwrap()` på mutex-lås crashar appen vid panik i bakgrundstråd
**Fil:** `src-tauri/src/commands/analysis.rs` m.fl. (~20 ställen)  
En panik i `spawn_blocking` poisonar mutex; alla efterföljande `.lock().unwrap()`
panikar appen i tyst bakgrundstråd. Appen verkar "stå still" men är kvar.  
**Åtgärd:** Ersätt med `.lock().map_err(|_| "DB-lås")` konsekvent.

### S-3 · Re-analys och "Regenerera segment" raderar manuella justeringar utan bekräftelse
**Fil:** `src-tauri/src/commands/analysis.rs` rad 377, `segments.rs` rad 73  
Varje `analyzeEpisode`-körning nollar alla manuellt justerade segment-gränser,
labels och excluded-flaggor. Knappen "Regenerera segment" gör detsamma.  
**Åtgärd:** Lägg till `window.confirm()` (eller en modal) med tydlig varning
innan segmenten raderas. Alternativt: bevara manuellt justerade segment.

### S-4 · Analysen uppdaterar databasen utan transaktion
**Fil:** `src-tauri/src/commands/analysis.rs` rad 316–375  
Detections DELETE:as, sedan INSERT:as nya, sedan UPDATE:as `episodes`. Om
UPDATE:en failar är de gamla detectionerna borta men waveform-pathen inte
uppdaterad → inkonsistent DB-state.  
**Åtgärd:** Omslut hela blocket i `BEGIN`/`COMMIT`.

### S-5 · Sidecar-minne växer obegränsat (OOM vid fler avsnitt)
**Fil:** `sidecar/podklipp_sidecar/__main__.py` rad 23, `transcribe.py` rad 15  
`_pcm_cache` och `_model_cache` är obegränsade dict:ar. En 2h-pod tar ~630 MB
RAM; Whisper `large` tar ~1,5 GB. Analyserar man 10 avsnitt i rad → OOM.  
**Åtgärd:** Sätt en cap (t.ex. 3 avsnitt i PCM-cachen, 1 Whisper-modell) med
LRU-eviction. `functools.lru_cache` eller en enkel ordnad dict.

### S-6 · Config-fil skrivs icke-atomärt — kan bli korrupt
**Fil:** `src-tauri/src/config.rs` rad 87  
`std::fs::write` kan lämna filen tom vid strömavbrott; nästa start
tystsildig-nollar alla inställningar (serde-default).  
**Åtgärd:** Skriv till `.tmp`-fil och `std::fs::rename`.

### S-7 · Respawn saknas för kraschad sidecar
**Fil:** `src-tauri/src/commands/segments.rs` rad 408  
`if guard.is_none()` täcker bara första start — om sidecaren kraschar under
transkribering blir mutex poisoned och alla efterföljande anrop misslyckas.  
**Åtgärd:** Fånga `SidecarError` och respawna, liknande logiken i
`analysis.rs`.

### S-8 · Waveform-filer rensas inte vid episod-borttagning
**Fil:** `src-tauri/src/commands/episodes.rs` rad 246–251  
DB-cascade tar hand om detections/segments men `{id}.json` och `{id}_hi.json`
i data-mappen blir kvar som orphans för evigt.  
**Åtgärd:** Läs `waveform_peaks_path` innan DELETE och ta bort filerna efter.

---

## P1 — Höga (vardagliga skav / viktiga UX-buggar)

### P1-1 · Sidecar-mutex serialiserar analys, vågform OCH transkribering
**Fil:** `src-tauri/src/lib.rs` rad 11, `analysis.rs`, `segments.rs`  
En mutex → transkribering köar bakom en pågående 3-min-analys utan
progress-indikator. UI säger "Transkriberar…" men ingenting händer.  
**Åtgärd:** Separata mutexar (eller en `RwLock`) för sidecar-anrop som är
read-only vs write-only, eller en intern kö i sidecar-processen.

### P1-2 · Segment-boundary-drag spammar databasen
**Fil:** `src/components/Timeline.tsx` rad 180–188  
`region-updated` (inte `region-update-end`) triggar ett `updateSegment`-invoke
per bilduppdatering under drag. 60 fps × drag-duration = hundratals DB-writes.  
**Åtgärd:** Byt till `region-update-end`-event, eller debounce 100 ms.

### P1-3 · Zoom-tier-switch reloadar hela ljudfilen
**Fil:** `src/components/Timeline.tsx` rad 272–322  
När zoom passerar ~10 px/sek anropas `ws.load()` igen vilket tar 15–30 s för
ett 2h-avsnitt. Ingen hysteresis → skakig zoom runt tröskeln.  
**Åtgärd:** Lägg till hysteresis (`lo→hi vid 12 px/sek`, `hi→lo vid 8`) och
undersök om `ws.setOptions({peaks})` kan återanvända befintligt ljud.

### P1-4 · Transkriberingstoasten är obegriplig och stängbar
**Fil:** `src/components/TranscriptionToast.tsx`  
Visar bara generisk text; om flera transkriberar simultant skriver de över
varandra. Ingen close-knapp, ingen auto-dismiss efter klart.  
**Åtgärd:** Visa segment-label + stäng-knapp + auto-hide 4 s efter `done`.

### P1-5 · Ingen undo för segment-operationer
Raderat segment, felaktig kind-ändring eller oavsiktlig "Analysera" är
permanenta. Kritisk UX-brist i ett redigeringsflöde.  
**Åtgärd:** Enkel undo-stack (t.ex. 20 steg) i `EpisodeDetail`-state för
segment-mutationer; `Ctrl+Z`-genväg.

### P1-6 · `region-updated` listeners läcker vid StrictMode double-mount
**Fil:** `src/App.tsx` rad 33–45, `useAnalysisJobs.ts`, `EpisodeDetail.tsx`, m.fl.  
```ts
let unlisten = null;
listen("event", …).then((fn) => { unlisten = fn; });
return () => { unlisten?.(); };
```
Om cleanup körs innan `.then()` hinner lösa sig (StrictMode double-mount)
läcker listenern.  
**Åtgärd:** Använd ett `cancelled`-mönster:
```ts
let unlisten: (() => void) | null = null;
let cancelled = false;
listen("event", cb).then((fn) => { if (cancelled) fn(); else unlisten = fn; });
return () => { cancelled = true; unlisten?.(); };
```

### P1-7 · DB-migreringar saknar transaktion
**Fil:** `src-tauri/src/db.rs` rad 22–49  
`apply_migration_vN` kör flera SQL-satser utan `BEGIN`/`COMMIT`. Om en sats
failar halvvägs lämnar det schemat i ett inkonsistent state som aldrig kan
återhämtas.  
**Åtgärd:** Omslut varje migreringsversion i en transaktion.

### P1-8 · `useAppConfig.update` skriver till disk vid varje range-slider-händelse
**Fil:** `src/hooks/useAppConfig.ts` rad 39–46  
Drag i analyströskel-slider → `setAppConfig` invoke per pixel → disk write.  
**Åtgärd:** Debounce `update()`-anrop för slider-inputs med 200 ms.

---

## P2 — Medel (underhåll / prestandapolering / UX-förbättringar)

### P2-1 · ffmpeg-argument: sökvägar som börjar på `-` tolkas som flaggor
**Fil:** `src-tauri/src/commands/export.rs`, `jingles.rs`, `episodes.rs`  
`episode_path` skickas direkt till `Command::args` — ett filnamn som börjar
med `-` (eller en ffmpeg-flagga) tolkas som option.  
**Åtgärd:** Lägg till `"--"` före path-argumenten, eller verifiera att path
är absolut.

### P2-2 · `probe_metadata` finns kopierad i `jingles.rs` och `episodes.rs`
**Fil:** `src-tauri/src/commands/jingles.rs` rad 30, `episodes.rs` rad 30  
Identisk funktion kopierad — divergens-risk.  
**Åtgärd:** Flytta till ett delat `util.rs`-modul.

### P2-3 · Tre olika `sanitize_filename`-implementationer
**Fil:** `jingles.rs`, `export.rs`, `ExportDialog.tsx`, `BatchExportDialog.tsx`  
Olika regex/regler → filerna kan namnges inkonsekvent.  
**Åtgärd:** En delad funktion i `util.rs` (Rust) resp. `format.ts` (TS).

### P2-4 · `KIND_COLORS` / `SEGMENT_KIND_COLORS` duplicerade
**Fil:** `EpisodeDetail.tsx` rad 33, `Timeline.tsx` rad 36, `format.ts`  
Tre separata color-maps för samma koncept.  
**Åtgärd:** Konsolidera till `format.ts` och importera därifrån.

### P2-5 · `AppConfig`-typen definieras i Rust och TS separat
**Fil:** `src-tauri/src/config.rs`, `src/lib/tauri.ts`  
Lätt att missa fält vid ändring (t.ex. `data_dir` finns i Rust men ej TS).  
**Åtgärd:** Generera TS-typer från Rust med `ts-rs` eller `specta`.

### P2-6 · `scipy.signal.fftconvolve` är minneskrävande för långa avsnitt
**Fil:** `sidecar/podklipp_sidecar/match.py` rad 50–54  
158M-sample-avsnitt × complex128 kan allokera 2–3 GB. `oaconvolve` är
designat för just långa-signal × kort-kernel.  
**Åtgärd:** Byt till `scipy.signal.oaconvolve` (drop-in-kompatibel).

### P2-7 · Linjär resampling i `decode.py`
**Fil:** `sidecar/podklipp_sidecar/decode.py` rad 50–60  
Kommentaren medger att kvaliteten är sämre. `scipy.signal.resample_poly` är
snabbare och mer korrekt för lång-signal.

### P2-8 · Segment-tabell renderas om helt vid varje label-tangenttryckning
**Fil:** `src/components/SegmentTable.tsx`  
`onChange(segments.map(...))` skapar ny array → alla rader renderas. Med 100+
kapitel märks det.  
**Åtgärd:** `React.memo` på rad-komponenten + `useCallback` på handlers.

### P2-9 · `detectionsByKind` räknas om vid varje render
**Fil:** `src/components/EpisodeDetail.tsx` rad 262  
Wrap i `useMemo([detections])`.

### P2-10 · `TOCTOU`-race vid data-dir-byte
**Fil:** `src-tauri/src/commands/storage.rs` rad 22–86  
Bakgrundsjobb kan skriva till `old_dir` under kopieringen; skrivningarna
förloras.  
**Åtgärd:** Blockera/avbryt aktiva jobb innan byte och visa progress.

### P2-11 · `ExportDialog` och `BatchExportDialog` delar inte kod
**Fil:** `ExportDialog.tsx`, `BatchExportDialog.tsx`  
`FORMAT_LABELS`, `FORMAT_EXTENSIONS`, filnamnsgenerering m.m. duplicerade.  
**Åtgärd:** Extrahera till `lib/export.ts`.

### P2-12 · Loudness-normalisering är global, inte per export
**Fil:** `ExportSection.tsx`, `ExportDialog.tsx`  
Bör vara en toggle direkt i Export-dialogen för per-export-kontroll.

### P2-13 · "Visa i utforskaren" saknas efter lyckad export
**Fil:** `ExportDialog.tsx` rad 231  
Sökvägen visas som text men inga genvägar. Lägg till en "Öppna mapp"-knapp
via `tauri-plugin-opener` eller `shell::open`.

### P2-14 · Waveform-chunkning har avrundningsbugg
**Fil:** `sidecar/podklipp_sidecar/waveform.py` rad 31–36  
Sista chunken kan vara upp till `chunk_size` längre pga heltalsdivision —
ger en artefakt (extra hög peak) i slutet av vågformen.  
**Åtgärd:** `np.array_split(pcm, num_points)` delar jämnt.

---

## P3 — Låga (polering / nice-to-have)

### P3-1 · Sidecar startas lazy — 2 s extra latens första analys
**Fil:** `src-tauri/src/lib.rs`  
**Åtgärd:** Spawna sidecaren i `setup()`-hooken så den är varm vid första anrop.

### P3-2 · Ingen sökning/sortering i avsnittslistan
Med 100+ avsnitt är listan ohanterbar.  
**Åtgärd:** Sök-input + sortering (namn, datum, status).

### P3-3 · Tröskel-preview client-side
Re-analys för att testa tröskel-justering tar minuter. Rå-konfidenser finns i
DB → filtrera visade detections live efter ett reglage i UI.

### P3-4 · Knappar "Dela här" / "Lär in jingel…" visas när ingen vågform finns
**Fil:** `src/components/EpisodeDetail.tsx`  
Dessa knappar är meningslösa tills waveform är beräknad; de visas redan inne i
`{hasWaveform && ...}` — men `!hasWaveform`-blocket visar bara Analysera.
Kontrollera att fallback-blocket inte saknar logik för waveform-ready-tillstånd.

### P3-5 · `readOnly`-inputfält ser redigerbara ut
**Fil:** `ExportDialog.tsx` rad 204, `BatchExportDialog.tsx` rad 213, `StorageSection.tsx` rad 48  
**Åtgärd:** `cursor: default; opacity: 0.7` eller en dedikerad `.readonly-input`-klass.

### P3-6 · `SegmentKindSettings.tsx` är en onödig pass-through
**Fil:** `src/components/SegmentKindSettings.tsx`  
Exporterar bara `SettingsDialog` under annat namn. `App.tsx` kan importera
`SettingsDialog` direkt.

### P3-7 · Ingen CI / inga tester för Rust eller frontend
Bara `sidecar/tests/test_match.py` finns. Fel som S-4 (transaktionslös analys)
hade fångats av integrationstester.  
**Åtgärd:** GitHub Actions med `cargo test`, `npx tsc --noEmit`, `pytest`.

### P3-8 · Magiska strängar istället för enums
`"clean_mp3"`, `"chapter"`, `"analysis-complete"` m.fl. hårdkodade i 5+
filer. Typo-risk som inte fångas av kompilatorn.  
**Åtgärd:** Rust-enums + `specta`/`ts-rs` för att generera TS-typer.

### P3-9 · Batch-analysfunktion saknas
Kan batch-exportera men inte batch-analysera — måste klicka "Analysera" för
varje avsnitt individuellt.

### P3-10 · OS-notis vid avslutad bakgrundsanalys
För långa jobb (>5 min) är det värdefullt att få en push-notis när appen är
bakgrundslagd. Tauri har `tauri-plugin-notification`.

### P3-11 · Export av jingel-biblioteket saknas
Byte av dator kräver manuell kopiering av alla jinglar.  
**Åtgärd:** "Exportera bibliotek"-knapp som zippar `jingles/`-mappen.

### P3-12 · "Använd som namn"-knappen visas bara när label är tom
**Fil:** `SegmentTable.tsx` rad 246  
Vill man ersätta ett befintligt namn med transkriptionen måste man radera
fältet manuellt.  
**Åtgärd:** Visa alltid om transkription finns (kanske som sekundär text/knapp).

---

## Prioritetsöversikt

| ID | Rubrik | Kategori |
|----|--------|----------|
| S-1 | Obegränsad FS-scope & ingen CSP | Säkerhet |
| S-2 | `unwrap()` på mutex → crash | Stabilitet |
| S-3 | Re-analys raderar manuellt arbete | Datatapp |
| S-4 | Analysen ej transaktionell | Datatapp |
| S-5 | Obunden RAM-cache i sidecar | OOM |
| S-6 | Config-skrivning ej atomär | Datatapp |
| S-7 | Sidecar respawnas inte | Stabilitet |
| S-8 | Orphan waveform-filer | Disk-läcka |
| P1-1 | Sidecar-mutex blockerar allt | Prestanda |
| P1-2 | Boundary-drag spammar DB | Prestanda |
| P1-3 | Zoom-switch reloadar ljudet | UX |
| P1-4 | Transkriberings-toast | UX |
| P1-5 | Ingen undo | UX |
| P1-6 | Listener-läcka i StrictMode | Bugg |
| P1-7 | Migrering ej transaktionell | Datatapp |
| P1-8 | Config-update debounce saknas | Prestanda |
| P2-1 | ffmpeg path-flaggor | Säkerhet |
| P2-2–5 | Kod-duplicering | Underhåll |
| P2-6–7 | Sidecar-prestanda | Prestanda |
| P2-8–9 | React-memoisering | Prestanda |
| P2-10–14 | UX-polering | UX |
| P3-1–12 | Features & polering | Nice-to-have |
