use crate::{config, AppState};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_app_config(state: State<AppState>) -> config::AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_app_config(
    app: AppHandle,
    state: State<AppState>,
    mut new_config: config::AppConfig,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    // data_dir is managed by storage commands — preserve it
    new_config.data_dir = cfg.data_dir.clone();
    *cfg = new_config.clone();
    config::write_config(&app, &new_config)
}
