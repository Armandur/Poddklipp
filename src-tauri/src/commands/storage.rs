use crate::{config, db, AppState};
use rusqlite::params;
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn get_data_dir(state: State<AppState>) -> String {
    state.app_data_dir.lock().unwrap().to_string_lossy().into_owned()
}

/// Byt datamapp. Om `copy_files` är sant kopieras databas, jinglar och
/// vågformsfiler till den nya mappen och sökvägarna i databasen uppdateras.
#[tauri::command]
pub fn set_data_dir(
    app: AppHandle,
    state: State<AppState>,
    new_path: String,
    copy_files: bool,
) -> Result<(), String> {
    let new_dir = PathBuf::from(&new_path);

    if new_dir == *state.app_data_dir.lock().unwrap() {
        return Ok(());
    }

    std::fs::create_dir_all(&new_dir).map_err(|e| format!("kunde inte skapa mapp: {e}"))?;
    std::fs::create_dir_all(new_dir.join("jingles")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(new_dir.join("waveforms")).map_err(|e| e.to_string())?;

    let old_dir = state.app_data_dir.lock().unwrap().clone();

    if copy_files {
        // Flush WAL så filen är konsistent innan kopiering.
        {
            let db = state.db.lock().map_err(|_| "DB-lås".to_string())?;
            let _ = db.execute_batch("PRAGMA wal_checkpoint(FULL)");
        }

        let old_db = old_dir.join("podklipp.db");
        if old_db.exists() {
            std::fs::copy(&old_db, new_dir.join("podklipp.db"))
                .map_err(|e| format!("kunde inte kopiera databas: {e}"))?;
        }
        copy_dir(&old_dir.join("jingles"), &new_dir.join("jingles"))?;
        copy_dir(&old_dir.join("waveforms"), &new_dir.join("waveforms"))?;
    }

    // Öppna (eller skapa) databas på ny plats och ersätt anslutningen.
    {
        let mut db_guard = state.db.lock().map_err(|_| "DB-lås".to_string())?;
        let new_conn = db::init_db(&new_dir.join("podklipp.db"))
            .map_err(|e| e.to_string())?;

        if copy_files {
            // Uppdatera absoluta sökvägar som pekar på den gamla mappen.
            let old_prefix = old_dir.to_string_lossy().into_owned();
            let new_prefix = new_dir.to_string_lossy().into_owned();
            new_conn
                .execute(
                    "UPDATE jingles SET file_path = REPLACE(file_path, ?1, ?2)",
                    params![old_prefix, new_prefix],
                )
                .map_err(|e| e.to_string())?;
            new_conn
                .execute(
                    "UPDATE episodes SET waveform_peaks_path = REPLACE(waveform_peaks_path, ?1, ?2)
                     WHERE waveform_peaks_path IS NOT NULL",
                    params![old_prefix, new_prefix],
                )
                .map_err(|e| e.to_string())?;
        }

        *db_guard = new_conn;
    }

    *state.app_data_dir.lock().unwrap() = new_dir.clone();
    {
        let mut cfg = state.config.lock().map_err(|_| "config-lås".to_string())?;
        cfg.data_dir = Some(new_dir.to_string_lossy().into_owned());
        config::write_config(&app, &cfg)?;
    }

    let _ = app.emit("data-dir-changed", json!({ "path": new_path }));
    Ok(())
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_file() {
            std::fs::copy(entry.path(), dst.join(entry.file_name()))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
