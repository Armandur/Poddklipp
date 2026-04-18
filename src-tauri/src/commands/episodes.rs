use crate::AppState;
use chrono::Utc;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, State};

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

#[derive(Debug, Serialize)]
pub struct Episode {
    pub id: i64,
    pub source_path: String,
    pub display_name: String,
    pub duration_ms: i64,
    pub sample_rate: i64,
    pub waveform_peaks_path: Option<String>,
    pub analyzed_at: Option<String>,
    pub created_at: String,
    pub file_missing: bool,
}

#[derive(Debug, Deserialize)]
pub struct AddEpisodeInput {
    pub source_path: String,
    pub display_name: Option<String>,
}

fn probe_metadata(path: &Path) -> (i64, i64) {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=sample_rate:format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=0",
            path.to_string_lossy().as_ref(),
        ])
        .output();

    let Ok(output) = output else { return (0, 0) };
    if !output.status.success() {
        return (0, 0);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut duration_ms = 0i64;
    let mut sample_rate = 0i64;
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("duration=") {
            if let Ok(s) = v.trim().parse::<f64>() {
                duration_ms = (s * 1000.0) as i64;
            }
        } else if let Some(v) = line.strip_prefix("sample_rate=") {
            sample_rate = v.trim().parse().unwrap_or(0);
        }
    }
    (duration_ms, sample_rate)
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
pub fn add_episode(
    app: AppHandle,
    state: State<AppState>,
    input: AddEpisodeInput,
) -> Result<Episode, String> {
    let path = Path::new(&input.source_path);
    if !path.exists() {
        return Err(format!("filen finns inte: {}", input.source_path));
    }

    let display_name = input.display_name.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Okänt avsnitt")
            .to_string()
    });

    let (duration_ms, sample_rate) = probe_metadata(path);
    let created_at = Utc::now().to_rfc3339();
    let source_str = path.to_string_lossy().to_string();

    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;

    // Om avsnittet redan finns, returnera det befintliga utan att starta nytt jobb.
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM episodes WHERE source_path = ?1",
            params![source_str],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing {
        let ep = conn
            .query_row(
                "SELECT id, source_path, display_name, duration_ms, sample_rate,
                         waveform_peaks_path, analyzed_at, created_at, file_missing
                 FROM episodes WHERE id = ?1",
                params![id],
                row_to_episode,
            )
            .map_err(|e| e.to_string())?;
        return Ok(ep);
    }

    conn.execute(
        "INSERT INTO episodes
             (source_path, display_name, duration_ms, sample_rate, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![source_str, display_name, duration_ms, sample_rate, created_at],
    )
    .map_err(|e| format!("DB-insert: {e}"))?;

    let id = conn.last_insert_rowid();

    // Starta vågformsberäkning i bakgrunden direkt — låset måste släppas först.
    drop(conn);
    super::analysis::spawn_waveform_job(app, id);

    Ok(Episode {
        id,
        source_path: source_str,
        display_name,
        duration_ms,
        sample_rate,
        waveform_peaks_path: None,
        analyzed_at: None,
        created_at,
        file_missing: false,
    })
}

/// Skanna en mapp och returnera sökvägar till alla ljudfiler i den (ej rekursivt).
#[tauri::command]
pub fn scan_folder(folder_path: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&folder_path);
    if !dir.is_dir() {
        return Err(format!("inte en mapp: {folder_path}"));
    }

    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut paths: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_audio_file(p))
        .filter_map(|p| p.to_str().map(|s| s.to_string()))
        .collect();
    paths.sort();
    Ok(paths)
}

#[tauri::command]
pub fn list_episodes(state: State<AppState>) -> Result<Vec<Episode>, String> {
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, source_path, display_name, duration_ms, sample_rate,
                    waveform_peaks_path, analyzed_at, created_at, file_missing
             FROM episodes ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_map([], row_to_episode)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}

/// Kontrollera vid uppstart om episodfiler fortfarande finns på disk.
pub fn scan_missing_files(conn: std::sync::MutexGuard<Connection>) {
    let paths: Vec<(i64, String)> = {
        let mut stmt = match conn.prepare("SELECT id, source_path FROM episodes") {
            Ok(s) => s,
            Err(_) => return,
        };
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)));
        match rows {
            Ok(r) => r.filter_map(|x| x.ok()).collect(),
            Err(_) => return,
        }
    };

    for (id, path) in paths {
        let missing = !Path::new(&path).exists();
        let _ = conn.execute(
            "UPDATE episodes SET file_missing = ?1 WHERE id = ?2",
            params![missing as i64, id],
        );
    }
}

#[tauri::command]
pub fn relink_episode(
    app: AppHandle,
    state: State<AppState>,
    id: i64,
    new_path: String,
) -> Result<Episode, String> {
    let path = Path::new(&new_path);
    if !path.exists() {
        return Err(format!("filen finns inte: {new_path}"));
    }

    let (duration_ms, sample_rate) = probe_metadata(path);
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;

    conn.execute(
        "UPDATE episodes
         SET source_path = ?1, duration_ms = ?2, sample_rate = ?3,
             file_missing = 0, waveform_peaks_path = NULL
         WHERE id = ?4",
        params![new_path, duration_ms, sample_rate, id],
    )
    .map_err(|e| e.to_string())?;

    let ep = conn.query_row(
        "SELECT id, source_path, display_name, duration_ms, sample_rate,
                waveform_peaks_path, analyzed_at, created_at, file_missing
         FROM episodes WHERE id = ?1",
        params![id],
        row_to_episode,
    )
    .map_err(|e| e.to_string())?;

    drop(conn);
    super::analysis::spawn_waveform_job(app, id);

    Ok(ep)
}

#[tauri::command]
pub fn delete_episode(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
    conn.execute("DELETE FROM episodes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_episode(row: &rusqlite::Row) -> rusqlite::Result<Episode> {
    Ok(Episode {
        id: row.get(0)?,
        source_path: row.get(1)?,
        display_name: row.get(2)?,
        duration_ms: row.get(3)?,
        sample_rate: row.get(4)?,
        waveform_peaks_path: row.get(5)?,
        analyzed_at: row.get(6)?,
        created_at: row.get(7)?,
        file_missing: row.get::<_, i64>(8)? != 0,
    })
}
