//! Export-kommandon: fyra format via ffmpeg + JSON.
//! Commandot returnerar direkt; det riktiga arbetet körs i spawn_blocking.
//!
//! Events:
//!   export-progress  { episode_id, progress: f64, stage: String }
//!   export-complete  { episode_id, output_path: String }
//!   export-error     { episode_id, error: String }

use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use serde_json::json;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize)]
struct SegmentRow {
    start_ms: i64,
    end_ms: i64,
    label: Option<String>,
    kind: String,
    excluded: bool,
    sort_order: i64,
}

/// Starta export i bakgrunden. `format` är en av:
///   "clean_mp3" | "chapters" | "id3_chapters" | "json"
/// `output_path` är fil-sökväg för clean/id3/json, mapp-sökväg för chapters.
#[tauri::command]
pub fn export_episode(
    app: AppHandle,
    state: State<AppState>,
    episode_id: i64,
    format: String,
    output_path: String,
) -> Result<(), String> {
    let (episode_path, segments) = {
        let conn = state.db.lock().map_err(|_| "DB-lås".to_string())?;

        let episode_path: String = conn
            .query_row(
                "SELECT source_path FROM episodes WHERE id = ?1",
                params![episode_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("avsnitt hittades inte: {e}"))?;

        let mut stmt = conn
            .prepare(
                "SELECT start_ms, end_ms, label, kind, excluded, sort_order
                 FROM segments WHERE episode_id = ?1 ORDER BY sort_order",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![episode_id], |r| {
                Ok(SegmentRow {
                    start_ms: r.get(0)?,
                    end_ms: r.get(1)?,
                    label: r.get(2)?,
                    kind: r.get(3)?,
                    excluded: r.get::<_, i64>(4)? != 0,
                    sort_order: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let result: Result<Vec<_>, _> = rows.collect();
        (episode_path, result.map_err(|e| e.to_string())?)
    };

    let included: Vec<SegmentRow> = segments.into_iter().filter(|s| !s.excluded).collect();
    if included.is_empty() {
        return Err("Inga inkluderade segment att exportera.".into());
    }

    let loudness_normalize = state.config.lock().map(|c| c.export_loudness_normalize).unwrap_or(false);

    let app_clone = app.clone();
    let format_clone = format.clone();
    let output_clone = output_path.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let result = run_export(
            &app_clone,
            episode_id,
            &episode_path,
            &included,
            &format_clone,
            Path::new(&output_clone),
            loudness_normalize,
        );
        match result {
            Ok(out) => {
                let _ = app_clone.emit(
                    "export-complete",
                    json!({ "episode_id": episode_id, "output_path": out }),
                );
            }
            Err(e) => {
                let _ = app_clone
                    .emit("export-error", json!({ "episode_id": episode_id, "error": e }));
            }
        }
    });

    Ok(())
}

fn run_export(
    app: &AppHandle,
    episode_id: i64,
    episode_path: &str,
    included: &[SegmentRow],
    format: &str,
    output: &Path,
    loudness_normalize: bool,
) -> Result<String, String> {
    let emit_progress = |progress: f64, stage: &str| {
        let _ = app.emit(
            "export-progress",
            json!({ "episode_id": episode_id, "progress": progress, "stage": stage }),
        );
    };

    match format {
        "json" => export_json(included, output),
        "clean_mp3" => {
            let total_ms: i64 = included.iter().map(|s| s.end_ms - s.start_ms).sum();
            concat_segments(episode_path, included, output, total_ms, loudness_normalize, &emit_progress)
        }
        "m4b_chapters" => {
            let total_ms: i64 = included.iter().map(|s| s.end_ms - s.start_ms).sum();
            let meta = build_ffmetadata(included);
            let tmp_meta = write_temp_file("ffmeta", &meta)?;
            concat_m4b(
                episode_path,
                included,
                output,
                tmp_meta.as_path(),
                total_ms,
                loudness_normalize,
                &emit_progress,
            )
        }
        "chapters" => export_chapters(episode_path, included, output, loudness_normalize, &emit_progress),
        _ => Err(format!("okänt exportformat: {format}")),
    }
}

// ── JSON ────────────────────────────────────────────────────────────────────

fn export_json(included: &[SegmentRow], output: &Path) -> Result<String, String> {
    let data: Vec<_> = included
        .iter()
        .map(|s| {
            json!({
                "start_ms": s.start_ms,
                "end_ms": s.end_ms,
                "label": s.label,
                "kind": s.kind,
            })
        })
        .collect();

    std::fs::write(output, serde_json::to_string_pretty(&data).unwrap())
        .map_err(|e| format!("kunde inte skriva JSON: {e}"))?;
    Ok(output.to_string_lossy().into_owned())
}

// ── Concat MP3 (med valfri ffmetadata för ID3-kapitel) ───────────────────────

fn build_concat_list(episode_path: &str, included: &[SegmentRow]) -> String {
    included
        .iter()
        .map(|s| {
            format!(
                "file '{}'\ninpoint {:.3}\noutpoint {:.3}\n",
                escape_concat_path(episode_path),
                s.start_ms as f64 / 1000.0,
                s.end_ms as f64 / 1000.0,
            )
        })
        .collect()
}

fn concat_segments(
    episode_path: &str,
    included: &[SegmentRow],
    output: &Path,
    total_ms: i64,
    loudness_normalize: bool,
    on_progress: &dyn Fn(f64, &str),
) -> Result<String, String> {
    on_progress(0.0, "skriver segment-lista…");
    let list_file = write_temp_file("concat_list.txt", &build_concat_list(episode_path, included))?;
    on_progress(0.05, "kör ffmpeg…");

    let mut args = vec![
        "-y".into(),
        "-f".into(), "concat".into(),
        "-safe".into(), "0".into(),
        "-i".into(), list_file.to_string_lossy().into_owned(),
        "-c:a".into(), "libmp3lame".into(),
        "-q:a".into(), "2".into(),
    ];
    if loudness_normalize {
        args.push("-af".into());
        args.push("loudnorm".into());
    }
    args.push("-progress".into());
    args.push("pipe:1".into());
    args.push(output.to_string_lossy().into_owned());

    run_ffmpeg_with_progress(&args, total_ms, on_progress)?;
    Ok(output.to_string_lossy().into_owned())
}

fn concat_m4b(
    episode_path: &str,
    included: &[SegmentRow],
    output: &Path,
    meta_path: &Path,
    total_ms: i64,
    loudness_normalize: bool,
    on_progress: &dyn Fn(f64, &str),
) -> Result<String, String> {
    on_progress(0.0, "skriver segment-lista…");
    let list_file = write_temp_file("concat_list.txt", &build_concat_list(episode_path, included))?;
    on_progress(0.05, "kör ffmpeg…");

    let mut args = vec![
        "-y".into(),
        "-f".into(), "concat".into(),
        "-safe".into(), "0".into(),
        "-i".into(), list_file.to_string_lossy().into_owned(),
        "-i".into(), meta_path.to_string_lossy().into_owned(),
        "-map".into(), "0:a".into(),
        "-map_metadata".into(), "1".into(),
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "128k".into(),
        "-movflags".into(), "+faststart".into(),
    ];
    if loudness_normalize {
        args.push("-af".into());
        args.push("loudnorm".into());
    }
    args.push("-progress".into());
    args.push("pipe:1".into());
    args.push(output.to_string_lossy().into_owned());

    run_ffmpeg_with_progress(&args, total_ms, on_progress)?;
    Ok(output.to_string_lossy().into_owned())
}

// ── Separata kapitel ────────────────────────────────────────────────────────

fn export_chapters(
    episode_path: &str,
    included: &[SegmentRow],
    output_dir: &Path,
    loudness_normalize: bool,
    on_progress: &dyn Fn(f64, &str),
) -> Result<String, String> {
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("kunde inte skapa mapp: {e}"))?;

    let total = included.len();
    for (i, seg) in included.iter().enumerate() {
        let fallback = format!("segment_{}", i + 1);
        let label = seg.label.as_deref().unwrap_or(&fallback);
        let safe_label = label.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        let filename = format!("{:02}_{safe_label}.mp3", i + 1);
        let out_file = output_dir.join(&filename);

        on_progress(i as f64 / total as f64, &format!("exporterar {filename}…"));

        let duration_ms = seg.end_ms - seg.start_ms;
        let mut args = vec![
            "-y".into(),
            "-i".into(), episode_path.to_string(),
            "-ss".into(), format_secs(seg.start_ms),
            "-to".into(), format_secs(seg.end_ms),
            "-c:a".into(), "libmp3lame".into(),
            "-q:a".into(), "2".into(),
        ];
        if loudness_normalize {
            args.push("-af".into());
            args.push("loudnorm".into());
        }
        args.push("-progress".into());
        args.push("pipe:1".into());
        args.push(out_file.to_string_lossy().into_owned());

        // Per-segment progress skalas till hela exportens progress-intervall.
        let seg_start = i as f64 / total as f64;
        let seg_end = (i + 1) as f64 / total as f64;
        run_ffmpeg_with_progress(&args, duration_ms, &|p, s| {
            on_progress(seg_start + p * (seg_end - seg_start), s);
        })?;
    }

    on_progress(1.0, "klart");
    Ok(output_dir.to_string_lossy().into_owned())
}

// ── ffmetadata ──────────────────────────────────────────────────────────────

fn build_ffmetadata(included: &[SegmentRow]) -> String {
    let mut out = ";FFMETADATA1\n".to_string();
    // Beräkna exporterad tid (exkluderade redan borttagna).
    let mut cursor_ms: i64 = 0;
    for seg in included {
        let dur = seg.end_ms - seg.start_ms;
        let title = seg.label.as_deref().unwrap_or(&seg.kind);
        out.push_str(&format!(
            "\n[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle={}\n",
            cursor_ms,
            cursor_ms + dur,
            title,
        ));
        cursor_ms += dur;
    }
    out
}

// ── ffmpeg-runner ────────────────────────────────────────────────────────────

fn run_ffmpeg_with_progress(
    args: &[String],
    total_ms: i64,
    on_progress: &dyn Fn(f64, &str),
) -> Result<(), String> {
    let ffmpeg = ffmpeg_executable();

    let mut child = Command::new(&ffmpeg)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("kunde inte starta ffmpeg ({}): {e}", ffmpeg.display()))?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(val) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = val.trim().parse::<i64>() {
                    let ms = us / 1000;
                    let progress = if total_ms > 0 {
                        (ms as f64 / total_ms as f64).clamp(0.0, 1.0)
                    } else {
                        0.5
                    };
                    on_progress(progress, "kodar…");
                }
            }
        }
    }

    let status = child.wait().map_err(|e| format!("ffmpeg-fel: {e}"))?;
    if !status.success() {
        return Err(format!(
            "ffmpeg avslutades med felkod {}",
            status.code().unwrap_or(-1)
        ));
    }
    on_progress(1.0, "klart");
    Ok(())
}

// ── Hjälpfunktioner ──────────────────────────────────────────────────────────

fn ffmpeg_executable() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent
                .join("resources/ffmpeg")
                .join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
            if bundled.exists() {
                return bundled;
            }
        }
    }
    PathBuf::from(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" })
}

fn write_temp_file(suffix: &str, content: &str) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("podklipp_{suffix}"));
    std::fs::write(&path, content).map_err(|e| format!("kunde inte skriva tempfil: {e}"))?;
    Ok(path)
}

fn format_secs(ms: i64) -> String {
    let total = ms as f64 / 1000.0;
    let h = (total / 3600.0) as u64;
    let m = ((total % 3600.0) / 60.0) as u64;
    let s = total % 60.0;
    format!("{h:02}:{m:02}:{s:06.3}")
}

fn escape_concat_path(path: &str) -> String {
    // ffmpeg concat-demuxer kräver att enkla citat och backslash escapas.
    path.replace('\\', "/").replace('\'', "\\'")
}
