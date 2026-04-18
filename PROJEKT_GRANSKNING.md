# Sammanställd Projektgranskning: Podklipp

Denna rapport förenar observationer från Gemini och Claude för att ge en heltäckande bild av projektets status, säkerhetsrisker och förbättringsområden.

---

## 🔴 P0 — Kritiska (Säkerhet, Datatapp & Stabilitet)

### 1. Säkerhet: Obegränsad Filåtkomst (FS-scope)
- **Problem:** Tauri-konfigurationen tillåter åtkomst till hela filsystemet (`"path": "**"`). Tillsammans med en saknad Content Security Policy (CSP) innebär detta att skadlig kod i webbvyen skulle kunna läsa känsliga filer (SSH-nycklar, lösenord) från användarens disk.
- **Åtgärd:** Begränsa scope till `$APPDATA/**` och `$AUDIO/**`. Inför en strikt CSP.

### 2. Datatapp: Re-analys raderar manuellt arbete
- **Problem:** Att köra en ny analys eller klicka på "Regenerera segment" raderar alla manuellt justerade segmentgränser, namn och exkluderingsinställningar utan varning.
- **Åtgärd:** Bevara manuella ändringar vid re-analys eller lägg till en bekräftelse-modal som varnar för datatapp.

### 3. Datatapp: Saknade Databastransaktioner
- **Problem:** Analysprocessen och databasmigrations körs utan SQL-transaktioner. Om appen kraschar mitt i en operation kan databasen lämnas i ett inkonsistent eller korrupt läge.
- **Åtgärd:** Omslut kritiska DB-operationer (särskilt analys-steget) i `BEGIN` / `COMMIT`.

### 4. Resurs: Obegränsad minnescache i Sidecar (OOM-risk)
- **Problem:** Sidecaren lagrar alla avkodade ljudfiler (`_pcm_cache`) och Whisper-modeller i RAM utan någon övre gräns. En 2-timmars podcast tar ~630 MB. Analys av flera avsnitt i rad leder snabbt till att minnet tar slut (Out of Memory).
- **Åtgärd:** Implementera LRU-cache (Least Recently Used) för att begränsa antalet filer och modeller i minnet.

### 5. Stabilitet: Mutex-poisoning & Kraschhantering
- **Problem:** Användning av `.unwrap()` på mutex-lås gör att hela appen panikar om en bakgrundstråd kraschar. Dessutom saknas logik för att starta om sidecar-processen om den dör.
- **Åtgärd:** Byt `.unwrap()` mot felhantering och lägg till automatisk "respawn" av sidecar-processen i `Sidecar::call`.

---

## 🟡 P1 — Höga (UX & Prestanda)

### 6. Flaskhals: Sidecar-mutex blockerar allt
- **Problem:** En central mutex låser sidecaren under hela analysen (som kan ta minuter). Detta gör att korta anrop som transkribering eller vågforms-generering blockeras helt utan att användaren ser vad som händer.
- **Åtgärd:** Tillåt parallella anrop till sidecaren eller separera låsen för läsning vs. analys.

### 7. Prestanda: Onödig DB- och disk-skrivning
- **Problem:** Justering av segmentgränser (drag i timeline) och ändring av inställningar (sliders) skriver till databas/disk vid varje enskild pixeländring (60 fps), vilket är extremt ineffektivt.
- **Åtgärd:** Använd `region-update-end` för timeline och "debounce" för inställnings-sliders.

### 8. UX: Zoom-växling reloadar ljudet
- **Problem:** När användaren zoomar in tillräckligt mycket för att byta till hi-res vågform laddas hela ljudfilen om i WaveSurfer, vilket orsakar ett märkbart avbrott (15-30s) för långa avsnitt.
- **Åtgärd:** Implementera hysteresis för att undvika skakigt byte vid tröskeln och undersök om peaks kan uppdateras utan full reload.

### 9. UX: Transkriberings-feedback
- **Problem:** Toast-meddelanden för transkribering är för generiska och skriver över varandra om flera segment transkriberas samtidigt. Det saknas också progress-indikator för nedladdning av Whisper-modeller.
- **Åtgärd:** Inkludera segmentets namn i toasten och rapportera modell-nedladdning mer tydligt.

---

## 🔵 P2 — Medel (Underhåll & Polering)

- **Orphan-filer:** Vågformsfiler raderas inte när ett avsnitt tas bort från biblioteket.
- **Kodduplicering:** Flera identiska funktioner för filnamns-sanitering och metadata-utvinning finns på olika ställen.
- **Typsäkerhet:** Typerna för `AppConfig` definieras separat i både Rust och TS, vilket ökar risken för buggar vid ändringar.
- **Optimering:** Byt till `scipy.signal.oaconvolve` i sidecaren för att drastiskt minska minnesförbrukningen vid korrelation av långa filer.

---

## 💎 Kvalitetsanalys (Styrkor)

- **Vågforms-teknik:** Smart "tier-system" med lo-res och hi-res peaks ger både snabbhet och precision.
- **Korrekt Matchning:** FFT-baserad NCC är ett tekniskt utmärkt val för uppgiften.
- **Robust UI:** WaveSurfer-integrationen är avancerad och hanterar komplexa interaktioner som zoom-center och keyboard-shortcuts väl.
