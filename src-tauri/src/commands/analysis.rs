//! Analyserar ett avsnitt i bakgrunden: commandot returnerar direkt efter
//! preflight-check, och det riktiga jobbet kör i `spawn_blocking`. Statusen
//! rapporteras via Tauri-event:
//!   - `sidecar-progress`    { episode_id, progress, stage }
//!   - `analysis-complete`   { episode_id, result: AnalysisResult }
//!   - `analysis-error`      { episode_id, error: string }
//!
//! UI:t kan alltså navigera mellan avsnitt medan analysen rullar.

use crate::{AppState, sidecar::Sidecar};
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize)]
pub struct Detection {
    pub id: i64,
    pub episode_id: i64,
    pub jingle_id: i64,
    pub jingle_kind: String,
    pub jingle_name: String,
    pub offset_ms: i64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalysisResult {
    pub detections: Vec<Detection>,
    pub waveform_peaks_path: String,
    pub analyzed_at: String,
}

#[derive(Debug, Deserialize)]
pub struct JingleForSidecar {
    pub id: i64,
    pub kind: String,
    pub file_path: String,
}

/// Beräkna bara vågform (lo + hi) utan jingel-analys. Returnerar direkt.
/// Emittar `waveform-ready` / `waveform-error` med `episode_id`.
/// Spawna ett bakgrundsjobb som beräknar vågform för ett avsnitt.
/// Kallas både från `compute_waveform`-kommandot och automatiskt från `add_episode`.
pub fn spawn_waveform_job(app: AppHandle, episode_id: i64) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_clone.state::<AppState>();

        let episode_path: String = {
            let conn = state.db.lock().unwrap();
            conn.query_row(
                "SELECT source_path FROM episodes WHERE id = ?1",
                params![episode_id],
                |r| r.get(0),
            )
            .unwrap_or_default()
        };
        let (peaks_path_str, hi_peaks_path_str) = {
            let dir = state.app_data_dir.lock().unwrap();
            let p = dir.join("waveforms").join(format!("{episode_id}.json"));
            let h = dir.join("waveforms").join(format!("{episode_id}_hi.json"));
            (p.to_string_lossy().into_owned(), h.to_string_lossy().into_owned())
        };

        if episode_path.is_empty() {
            return;
        }

        let on_progress = |progress: f64, stage: &str| {
            let _ = app_clone.emit(
                "sidecar-progress",
                json!({ "episode_id": episode_id, "progress": progress, "stage": stage }),
            );
        };

        let result = (|| -> Result<(), String> {
            let mut guard = state.sidecar.lock().map_err(|_| "sidecar-lås".to_string())?;
            if guard.is_none() {
                *guard = Some(Sidecar::spawn().map_err(|e| e.to_string())?);
            }
            let sidecar = guard.as_mut().unwrap();

            let wf = sidecar
                .call("waveform", json!({ "path": episode_path, "output_path": peaks_path_str }), &on_progress)
                .map_err(|e| e.to_string())?;

            let duration_ms = wf.get("duration_ms").and_then(|v| v.as_i64()).unwrap_or(0);
            let num_hi = ((duration_ms / 1000) * 200).min(1_000_000).max(4_000);
            sidecar
                .call("waveform", json!({ "path": episode_path, "output_path": hi_peaks_path_str, "num_points": num_hi }), &on_progress)
                .map_err(|e| e.to_string())?;

            Ok(())
        })();

        match result {
            Ok(()) => {
                {
                    let conn = state.db.lock().unwrap();
                    let _ = conn.execute(
                        "UPDATE episodes SET waveform_peaks_path = ?1 WHERE id = ?2",
                        params![peaks_path_str, episode_id],
                    );
                }
                let _ = app_clone.emit(
                    "waveform-ready",
                    json!({ "episode_id": episode_id, "waveform_peaks_path": peaks_path_str }),
                );
            }
            Err(e) => {
                let _ = app_clone.emit(
                    "waveform-error",
                    json!({ "episode_id": episode_id, "error": e }),
                );
            }
        }
    });
}

#[tauri::command]
pub fn compute_waveform(
    app: AppHandle,
    state: State<AppState>,
    episode_id: i64,
) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
        let _: i64 = conn
            .query_row(
                "SELECT id FROM episodes WHERE id = ?1",
                params![episode_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("avsnitt hittades inte: {e}"))?;
    }
    spawn_waveform_job(app, episode_id);
    Ok(())
}

/// Preflight + starta bakgrundjobb. Returnerar direkt.
#[tauri::command]
pub fn analyze_episode(
    app: AppHandle,
    state: State<AppState>,
    episode_id: i64,
    threshold: Option<f64>,
) -> Result<(), String> {
    // Snabb validering medan vi har låset — avsnitt finns, minst en jingel.
    {
        let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
        let _: i64 = conn
            .query_row(
                "SELECT id FROM episodes WHERE id = ?1",
                params![episode_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("avsnitt hittades inte: {e}"))?;
        let jingle_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM jingles", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if jingle_count == 0 {
            return Err("Inga jinglar i biblioteket — lägg till minst en först.".into());
        }
    }

    let _ = app.emit("analysis-started", json!({ "episode_id": episode_id }));

    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match run_analysis(&app_clone, episode_id, threshold) {
            Ok(result) => {
                let _ = app_clone.emit(
                    "analysis-complete",
                    json!({ "episode_id": episode_id, "result": result }),
                );
            }
            Err(e) => {
                let _ = app_clone.emit(
                    "analysis-error",
                    json!({ "episode_id": episode_id, "error": e }),
                );
            }
        }
    });

    Ok(())
}

fn run_analysis(
    app: &AppHandle,
    episode_id: i64,
    threshold: Option<f64>,
) -> Result<AnalysisResult, String> {
    let state = app.state::<AppState>();

    let (episode_path, jingles) = {
        let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;

        let episode_path: String = conn
            .query_row(
                "SELECT source_path FROM episodes WHERE id = ?1",
                params![episode_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("avsnitt hittades inte: {e}"))?;

        let mut stmt = conn
            .prepare("SELECT id, kind, file_path FROM jingles")
            .map_err(|e| e.to_string())?;
        let jingles: Vec<JingleForSidecar> = {
            let rows = stmt
                .query_map([], |r| {
                    Ok(JingleForSidecar {
                        id: r.get(0)?,
                        kind: r.get(1)?,
                        file_path: r.get(2)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            let result: Result<Vec<_>, _> = rows.collect();
            result.map_err(|e| e.to_string())?
        };
        (episode_path, jingles)
    };

    let (peaks_path_str, hi_peaks_path_str) = {
        let dir = state.app_data_dir.lock().unwrap();
        let p = dir.join("waveforms").join(format!("{episode_id}.json"));
        let h = dir.join("waveforms").join(format!("{episode_id}_hi.json"));
        (p.to_string_lossy().into_owned(), h.to_string_lossy().into_owned())
    };

    // Progress-emit med episode_id så frontend kan filtrera.
    let on_progress = |progress: f64, stage: &str| {
        let _ = app.emit(
            "sidecar-progress",
            json!({
                "episode_id": episode_id,
                "progress": progress,
                "stage": stage,
            }),
        );
    };

    // Sidecaren är serialiserad via state.sidecar-mutex; om annat jobb kör
    // väntar vi här. UI:t blockeras inte eftersom vi är i spawn_blocking.
    let detections_json = {
        let mut guard = state.sidecar.lock().map_err(|_| "sidecar-lås".to_string())?;
        if guard.is_none() {
            *guard = Some(Sidecar::spawn().map_err(|e| e.to_string())?);
        }
        let sidecar = guard.as_mut().unwrap();

        let waveform_result = sidecar
            .call(
                "waveform",
                json!({
                    "path": episode_path,
                    "output_path": peaks_path_str,
                }),
                &on_progress,
            )
            .map_err(|e| e.to_string())?;

        // Hi-res peaks: 200 samples/sek, max 1 000 000 datapunkter.
        let duration_ms = waveform_result
            .get("duration_ms")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let num_hi = ((duration_ms / 1000) * 200).min(1_000_000).max(4_000);
        sidecar
            .call(
                "waveform",
                json!({
                    "path": episode_path,
                    "output_path": hi_peaks_path_str,
                    "num_points": num_hi,
                }),
                &on_progress,
            )
            .map_err(|e| e.to_string())?;

        let jingles_json: Vec<Value> = jingles
            .iter()
            .map(|j| {
                json!({
                    "id": j.id,
                    "kind": j.kind,
                    "file_path": j.file_path,
                })
            })
            .collect();

        sidecar
            .call(
                "analyze",
                json!({
                    "episode_path": episode_path,
                    "jingles": jingles_json,
                    "threshold": threshold.unwrap_or_else(|| {
                        state.config.lock().map(|c| c.analysis_threshold).unwrap_or(0.7)
                    }),
                }),
                &on_progress,
            )
            .map_err(|e| e.to_string())?
    };

    let detections_array = detections_json
        .get("detections")
        .and_then(|v| v.as_array())
        .ok_or("sidecar returnerade inga detektioner")?;

    let now = Utc::now().to_rfc3339();
    let inserted = {
        let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
        conn.execute(
            "DELETE FROM detections WHERE episode_id = ?1",
            params![episode_id],
        )
        .map_err(|e| e.to_string())?;

        let mut inserted: Vec<Detection> = Vec::with_capacity(detections_array.len());
        {
            let mut stmt = conn
                .prepare(
                    "INSERT INTO detections (episode_id, jingle_id, offset_ms, confidence)
                     VALUES (?1, ?2, ?3, ?4)",
                )
                .map_err(|e| e.to_string())?;

            let mut name_stmt = conn
                .prepare("SELECT name FROM jingles WHERE id = ?1")
                .map_err(|e| e.to_string())?;

            for det in detections_array {
                let jingle_id = det.get("jingle_id").and_then(|v| v.as_i64()).unwrap_or(0);
                let jingle_kind = det
                    .get("jingle_kind")
                    .and_then(|v| v.as_str())
                    .unwrap_or("custom")
                    .to_string();
                let offset_ms = det.get("offset_ms").and_then(|v| v.as_i64()).unwrap_or(0);
                let confidence = det.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.0);

                stmt.execute(params![episode_id, jingle_id, offset_ms, confidence])
                    .map_err(|e| e.to_string())?;
                let id = conn.last_insert_rowid();

                let jingle_name: String = name_stmt
                    .query_row(params![jingle_id], |r| r.get(0))
                    .unwrap_or_else(|_| "?".into());

                inserted.push(Detection {
                    id,
                    episode_id,
                    jingle_id,
                    jingle_kind,
                    jingle_name,
                    offset_ms,
                    confidence,
                });
            }
        }

        conn.execute(
            "UPDATE episodes SET waveform_peaks_path = ?1, analyzed_at = ?2 WHERE id = ?3",
            params![peaks_path_str, now, episode_id],
        )
        .map_err(|e| e.to_string())?;

        inserted
    };

    {
        let mut conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
        crate::commands::segments::regenerate_segments_in_db(&mut conn, episode_id)?;
    }

    Ok(AnalysisResult {
        detections: inserted,
        waveform_peaks_path: peaks_path_str,
        analyzed_at: now,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WaveformPeaks {
    pub mins: Vec<f32>,
    pub maxs: Vec<f32>,
    pub duration_ms: i64,
}

#[tauri::command]
pub fn get_waveform_peaks(
    state: State<AppState>,
    episode_id: i64,
) -> Result<WaveformPeaks, String> {
    let path: String = {
        let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
        conn.query_row(
            "SELECT waveform_peaks_path FROM episodes WHERE id = ?1",
            params![episode_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(|e| format!("avsnitt hittades inte: {e}"))?
        .ok_or_else(|| "avsnittet har inte analyserats än".to_string())?
    };

    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("kunde inte läsa peaks-filen: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("ogiltig peaks-JSON: {e}"))
}

#[tauri::command]
pub fn get_waveform_peaks_hi(
    state: State<AppState>,
    episode_id: i64,
) -> Result<WaveformPeaks, String> {
    let path = state
        .app_data_dir
        .lock()
        .unwrap()
        .join("waveforms")
        .join(format!("{episode_id}_hi.json"));
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| "hi-res peaks saknas — kör om analysen".to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("ogiltig peaks-JSON: {e}"))
}

#[tauri::command]
pub fn list_detections(
    state: State<AppState>,
    episode_id: i64,
) -> Result<Vec<Detection>, String> {
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT d.id, d.episode_id, d.jingle_id, j.kind, j.name, d.offset_ms, d.confidence
             FROM detections d
             JOIN jingles j ON j.id = d.jingle_id
             WHERE d.episode_id = ?1
             ORDER BY d.offset_ms",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![episode_id], |r| {
            Ok(Detection {
                id: r.get(0)?,
                episode_id: r.get(1)?,
                jingle_id: r.get(2)?,
                jingle_kind: r.get(3)?,
                jingle_name: r.get(4)?,
                offset_ms: r.get(5)?,
                confidence: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let result: Result<Vec<_>, _> = rows.collect();
    result.map_err(|e| e.to_string())
}
