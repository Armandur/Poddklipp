use crate::AppState;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct Jingle {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub duration_ms: i64,
    pub sample_rate: i64,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddJingleInput {
    pub source_path: String,
    pub name: String,
    pub kind: String,
}

/// Läs duration + sample_rate via ffprobe. Returnerar (0, 0) om det inte går
/// (t.ex. ffprobe inte installerat) — låter jingeln läggas till ändå.
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

    let Ok(output) = output else {
        return (0, 0);
    };
    if !output.status.success() {
        return (0, 0);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut duration_ms: i64 = 0;
    let mut sample_rate: i64 = 0;
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("duration=") {
            if let Ok(secs) = v.trim().parse::<f64>() {
                duration_ms = (secs * 1000.0) as i64;
            }
        } else if let Some(v) = line.strip_prefix("sample_rate=") {
            sample_rate = v.trim().parse().unwrap_or(0);
        }
    }
    (duration_ms, sample_rate)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

#[tauri::command]
pub fn add_jingle(
    state: State<AppState>,
    input: AddJingleInput,
) -> Result<Jingle, String> {
    let source = Path::new(&input.source_path);
    if !source.exists() {
        return Err(format!("filen finns inte: {}", input.source_path));
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("wav");
    let timestamp = Utc::now().format("%Y%m%d%H%M%S%f");
    let safe_name = sanitize_filename(&input.name);
    let dest_name = format!("{timestamp}_{safe_name}.{ext}");
    let dest: PathBuf = state.app_data_dir.join("jingles").join(&dest_name);

    std::fs::copy(source, &dest).map_err(|e| format!("kunde inte kopiera filen: {e}"))?;

    let (duration_ms, sample_rate) = probe_metadata(&dest);
    let created_at = Utc::now().to_rfc3339();
    let dest_str = dest.to_string_lossy().to_string();

    let conn = state.db.lock().map_err(|_| "DB-lås kunde inte tas".to_string())?;
    conn.execute(
        "INSERT INTO jingles (name, kind, file_path, duration_ms, sample_rate, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.name,
            input.kind,
            dest_str,
            duration_ms,
            sample_rate,
            created_at
        ],
    )
    .map_err(|e| format!("DB-insert misslyckades: {e}"))?;

    let id = conn.last_insert_rowid();

    Ok(Jingle {
        id,
        name: input.name,
        kind: input.kind,
        file_path: dest_str,
        duration_ms,
        sample_rate,
        created_at,
    })
}

#[tauri::command]
pub fn list_jingles(state: State<AppState>) -> Result<Vec<Jingle>, String> {
    let conn = state.db.lock().map_err(|_| "DB-lås kunde inte tas".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, kind, file_path, duration_ms, sample_rate, created_at
             FROM jingles ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Jingle {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                file_path: row.get(3)?,
                duration_ms: row.get(4)?,
                sample_rate: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let result = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn delete_jingle(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB-lås kunde inte tas".to_string())?;
    let path: String = conn
        .query_row(
            "SELECT file_path FROM jingles WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("jingel hittades inte: {e}"))?;

    conn.execute("DELETE FROM jingles WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&path);
    Ok(())
}

#[tauri::command]
pub fn get_jingle_path(state: State<AppState>, id: i64) -> Result<String, String> {
    let conn = state.db.lock().map_err(|_| "DB-lås kunde inte tas".to_string())?;
    conn.query_row(
        "SELECT file_path FROM jingles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )
    .map_err(|e| format!("jingel hittades inte: {e}"))
}
