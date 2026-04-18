use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
    #[serde(default = "default_threshold")]
    pub analysis_threshold: f64,
    #[serde(default = "default_export_format")]
    pub export_default_format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub export_default_folder: Option<String>,
    #[serde(default)]
    pub export_loudness_normalize: bool,
    #[serde(default = "default_confirm_delete")]
    pub confirm_delete_segment: bool,
    #[serde(default)]
    pub shortcuts: HashMap<String, String>,
}

fn default_threshold() -> f64 { 0.7 }
fn default_export_format() -> String { "clean_mp3".to_string() }
fn default_confirm_delete() -> bool { true }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            data_dir: None,
            analysis_threshold: 0.7,
            export_default_format: "clean_mp3".to_string(),
            export_default_folder: None,
            export_loudness_normalize: false,
            confirm_delete_segment: true,
            shortcuts: HashMap::new(),
        }
    }
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("config.json"))
}

pub fn read_config(app: &AppHandle) -> AppConfig {
    let Some(path) = config_path(app) else { return AppConfig::default() };
    let Ok(text) = std::fs::read_to_string(&path) else { return AppConfig::default() };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn write_config(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let path = config_path(app).ok_or("kunde inte bestämma config-sökväg")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

pub fn read_data_dir(app: &AppHandle) -> Option<PathBuf> {
    read_config(app).data_dir.map(PathBuf::from)
}

pub fn write_data_dir(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let mut cfg = read_config(app);
    cfg.data_dir = Some(dir.to_string_lossy().into_owned());
    write_config(app, &cfg)
}
