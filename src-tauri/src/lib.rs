mod commands;
mod config;
mod db;
mod sidecar;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub sidecar: Mutex<Option<sidecar::Sidecar>>,
    pub app_data_dir: Mutex<std::path::PathBuf>,
    pub config: Mutex<config::AppConfig>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Använd konfigurerad datamapp om sådan finns, annars standard.
            let default_dir = app
                .path()
                .app_data_dir()
                .expect("kunde inte lösa app-data-mappen");
            let mut app_config = config::read_config(app.handle());
            let app_data_dir = app_config.data_dir.as_ref()
                .map(std::path::PathBuf::from)
                .unwrap_or(default_dir.clone());
            app_config.data_dir = Some(app_data_dir.to_string_lossy().into_owned());

            std::fs::create_dir_all(&app_data_dir)?;
            std::fs::create_dir_all(app_data_dir.join("jingles"))?;
            std::fs::create_dir_all(app_data_dir.join("waveforms"))?;

            let db_path = app_data_dir.join("podklipp.db");
            let conn = db::init_db(&db_path)?;

            app.manage(AppState {
                db: Mutex::new(conn),
                sidecar: Mutex::new(None),
                app_data_dir: Mutex::new(app_data_dir),
                config: Mutex::new(app_config),
            });

            // Kontrollera vid start vilka avsnittsfiler som saknas.
            commands::episodes::scan_missing_files(
                app.state::<AppState>().db.lock().unwrap(),
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::jingles::add_jingle,
            commands::jingles::list_jingles,
            commands::jingles::delete_jingle,
            commands::jingles::get_jingle_path,
            commands::jingles::create_jingle_from_clip,
            commands::episodes::add_episode,
            commands::episodes::scan_folder,
            commands::episodes::list_episodes,
            commands::episodes::delete_episode,
            commands::episodes::relink_episode,
            commands::analysis::compute_waveform,
            commands::analysis::analyze_episode,
            commands::analysis::list_detections,
            commands::analysis::get_waveform_peaks,
            commands::analysis::get_waveform_peaks_hi,
            commands::storage::get_data_dir,
            commands::storage::set_data_dir,
            commands::app_config::get_app_config,
            commands::app_config::set_app_config,
            commands::segments::generate_segments,
            commands::segments::list_segments,
            commands::segments::update_segment,
            commands::segments::split_segment_at,
            commands::segments::delete_segment,
            commands::export::export_episode,
            commands::settings::list_segment_kinds,
            commands::settings::update_segment_kind,
        ])
        .run(tauri::generate_context!())
        .expect("fel vid start av Tauri-appen");
}
