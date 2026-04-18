//! Segment-hantering: auto-generera från detektioner + CRUD för manuell
//! redigering (namnge, toggla excluderad, dra-justera gränser i timeline).

use crate::AppState;
use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct Segment {
    pub id: i64,
    pub episode_id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub label: Option<String>,
    pub kind: String,
    pub excluded: bool,
    pub sort_order: i64,
}

/// Regenerera segment för ett avsnitt från dess detektioner.
/// Raderar befintliga segment — manuella justeringar går alltså förlorade.
pub fn regenerate_segments_in_db(conn: &mut Connection, episode_id: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let duration_ms: i64 = tx
        .query_row(
            "SELECT duration_ms FROM episodes WHERE id = ?1",
            params![episode_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("avsnitt hittades inte: {e}"))?;

    let detections: Vec<(String, i64)> = {
        let mut stmt = tx
            .prepare(
                "SELECT j.kind, d.offset_ms FROM detections d
                 JOIN jingles j ON j.id = d.jingle_id
                 WHERE d.episode_id = ?1
                 ORDER BY d.offset_ms",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![episode_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let result: Result<Vec<_>, _> = rows.collect();
        result.map_err(|e| e.to_string())?
    };

    tx.execute(
        "DELETE FROM segments WHERE episode_id = ?1",
        params![episode_id],
    )
    .map_err(|e| e.to_string())?;

    let plan = build_segment_plan(&detections, duration_ms);

    {
        let mut insert = tx
            .prepare(
                "INSERT INTO segments
                 (episode_id, start_ms, end_ms, label, kind, excluded, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;

        for (i, s) in plan.iter().enumerate() {
            insert
                .execute(params![
                    episode_id,
                    s.start_ms,
                    s.end_ms,
                    s.label,
                    s.kind,
                    s.excluded as i64,
                    i as i64,
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn generate_segments(
    state: State<AppState>,
    episode_id: i64,
) -> Result<Vec<Segment>, String> {
    {
        let mut conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
        regenerate_segments_in_db(&mut conn, episode_id)?;
    }
    list_segments(state, episode_id)
}

struct PlannedSegment {
    start_ms: i64,
    end_ms: i64,
    label: Option<String>,
    kind: String,
    excluded: bool,
}

fn build_segment_plan(detections: &[(String, i64)], duration_ms: i64) -> Vec<PlannedSegment> {
    // Samla gränser: 0, varje detektion, duration.
    let mut boundaries: Vec<(i64, Option<&str>)> = Vec::with_capacity(detections.len() + 2);
    boundaries.push((0, None));
    for (kind, offset) in detections {
        boundaries.push((*offset, Some(kind.as_str())));
    }
    boundaries.push((duration_ms, None));
    boundaries.dedup_by_key(|(t, _)| *t);

    let mut plan = Vec::new();
    let mut chapter_no = 0;
    let mut ad_open = false; // alternering för ad_marker-par

    for window in boundaries.windows(2) {
        let (start, start_kind) = window[0];
        let (end, _) = window[1];
        if end <= start {
            continue;
        }

        let (kind, label, excluded) = match start_kind {
            None => {
                // Före första detektionen eller efter sista.
                if plan.is_empty() {
                    ("pre".to_string(), Some("Pre-roll".to_string()), false)
                } else {
                    ("post".to_string(), Some("Post-roll".to_string()), false)
                }
            }
            Some("intro") => ("intro".to_string(), Some("Introduktion".to_string()), false),
            Some("outro") => ("outro".to_string(), Some("Outro".to_string()), false),
            Some("chapter") => {
                chapter_no += 1;
                (
                    "chapter".to_string(),
                    Some(format!("Kapitel {chapter_no}")),
                    false,
                )
            }
            Some("ad_marker") => {
                ad_open = !ad_open;
                if ad_open {
                    ("ad".to_string(), Some("Reklam".to_string()), true)
                } else {
                    // Reklam-ut → tillbaka till kapitel-innehåll
                    chapter_no += 1;
                    (
                        "chapter".to_string(),
                        Some(format!("Kapitel {chapter_no}")),
                        false,
                    )
                }
            }
            Some("custom") | Some(_) => ("content".to_string(), None, false),
        };

        plan.push(PlannedSegment {
            start_ms: start,
            end_ms: end,
            label,
            kind,
            excluded,
        });
    }

    plan
}

#[tauri::command]
pub fn list_segments(
    state: State<AppState>,
    episode_id: i64,
) -> Result<Vec<Segment>, String> {
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, episode_id, start_ms, end_ms, label, kind, excluded, sort_order
             FROM segments WHERE episode_id = ?1 ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![episode_id], |r| {
            Ok(Segment {
                id: r.get(0)?,
                episode_id: r.get(1)?,
                start_ms: r.get(2)?,
                end_ms: r.get(3)?,
                label: r.get(4)?,
                kind: r.get(5)?,
                excluded: r.get::<_, i64>(6)? != 0,
                sort_order: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let result: Result<Vec<_>, _> = rows.collect();
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_segment(
    state: State<AppState>,
    id: i64,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    label: Option<String>,
    kind: Option<String>,
    excluded: Option<bool>,
) -> Result<Segment, String> {
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;

    // Bygg dynamisk SET-klausul så vi bara skriver de fält som skickades in.
    let mut sets: Vec<&str> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(v) = start_ms {
        sets.push("start_ms = ?");
        values.push(v.into());
    }
    if let Some(v) = end_ms {
        sets.push("end_ms = ?");
        values.push(v.into());
    }
    if let Some(v) = label {
        sets.push("label = ?");
        values.push(v.into());
    }
    if let Some(v) = kind {
        sets.push("kind = ?");
        values.push(v.into());
    }
    if let Some(v) = excluded {
        sets.push("excluded = ?");
        values.push((v as i64).into());
    }

    if sets.is_empty() {
        return Err("inga fält att uppdatera".into());
    }

    let sql = format!("UPDATE segments SET {} WHERE id = ?", sets.join(", "));
    values.push(id.into());
    let params_ref = rusqlite::params_from_iter(values.iter());
    conn.execute(&sql, params_ref).map_err(|e| e.to_string())?;

    let seg = conn
        .query_row(
            "SELECT id, episode_id, start_ms, end_ms, label, kind, excluded, sort_order
             FROM segments WHERE id = ?1",
            params![id],
            |r| {
                Ok(Segment {
                    id: r.get(0)?,
                    episode_id: r.get(1)?,
                    start_ms: r.get(2)?,
                    end_ms: r.get(3)?,
                    label: r.get(4)?,
                    kind: r.get(5)?,
                    excluded: r.get::<_, i64>(6)? != 0,
                    sort_order: r.get(7)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(seg)
}

#[tauri::command]
pub fn delete_segment(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;
    conn.execute("DELETE FROM segments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
