use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SegmentKind {
    pub slug: String,
    pub label: String,
    pub default_excluded: bool,
    pub sort_order: i64,
}

#[tauri::command]
pub fn list_segment_kinds(state: State<AppState>) -> Result<Vec<SegmentKind>, String> {
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT slug, label, default_excluded, sort_order
             FROM segment_kinds ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| {
            Ok(SegmentKind {
                slug: r.get(0)?,
                label: r.get(1)?,
                default_excluded: r.get::<_, i64>(2)? != 0,
                sort_order: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let result: Result<Vec<_>, _> = rows.collect();
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_segment_kind(
    state: State<AppState>,
    slug: String,
    label: String,
    default_excluded: bool,
) -> Result<SegmentKind, String> {
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
    conn.execute(
        "UPDATE segment_kinds SET label = ?1, default_excluded = ?2 WHERE slug = ?3",
        params![label, default_excluded as i64, slug],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT slug, label, default_excluded, sort_order FROM segment_kinds WHERE slug = ?1",
        params![slug],
        |r| {
            Ok(SegmentKind {
                slug: r.get(0)?,
                label: r.get(1)?,
                default_excluded: r.get::<_, i64>(2)? != 0,
                sort_order: r.get(3)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}
