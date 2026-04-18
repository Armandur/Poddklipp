use anyhow::Result;
use rusqlite::{Connection, params};
use std::path::Path;

const SCHEMA_VERSION: i32 = 5;

pub fn init_db(db_path: &Path) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
        [],
    )?;

    let current_version: i32 = conn
        .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    let fresh = current_version == 0;
    if current_version < 1 {
        apply_migration_v1(&conn)?;
    }
    if current_version < 2 {
        apply_migration_v2(&conn)?;
    }
    if current_version < 3 {
        apply_migration_v3(&conn)?;
    }
    if current_version < 4 {
        apply_migration_v4(&conn)?;
    }
    if current_version < 5 {
        apply_migration_v5(&conn)?;
    }

    if fresh {
        conn.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            params![SCHEMA_VERSION],
        )?;
    } else if current_version < SCHEMA_VERSION {
        conn.execute(
            "UPDATE schema_version SET version = ?1",
            params![SCHEMA_VERSION],
        )?;
    }

    Ok(conn)
}

fn apply_migration_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS jingles (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('intro','outro','chapter','ad_marker','custom')),
            file_path TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            sample_rate INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS episodes (
            id INTEGER PRIMARY KEY,
            source_path TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            sample_rate INTEGER NOT NULL,
            waveform_peaks_path TEXT,
            analyzed_at TEXT,
            created_at TEXT NOT NULL
        );

        -- Ett avsnitt har många detektioner: varje jingel kan hittas flera
        -- gånger, och flera olika jinglar kan hittas i samma avsnitt.
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY,
            episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
            jingle_id INTEGER NOT NULL REFERENCES jingles(id) ON DELETE CASCADE,
            offset_ms INTEGER NOT NULL,
            confidence REAL NOT NULL,
            UNIQUE(episode_id, jingle_id, offset_ms)
        );

        CREATE INDEX IF NOT EXISTS idx_detections_episode_offset
            ON detections(episode_id, offset_ms);

        CREATE TABLE IF NOT EXISTS segments (
            id INTEGER PRIMARY KEY,
            episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            label TEXT,
            excluded INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_segments_episode_sort
            ON segments(episode_id, sort_order);
        "#,
    )?;
    Ok(())
}

fn apply_migration_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        -- kind styr default-label och färg i timeline-UI:t.
        ALTER TABLE segments ADD COLUMN kind TEXT NOT NULL DEFAULT 'content';
        "#,
    )?;
    Ok(())
}

fn apply_migration_v3(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        ALTER TABLE episodes ADD COLUMN file_missing INTEGER NOT NULL DEFAULT 0;
        "#,
    )?;
    Ok(())
}

fn apply_migration_v5(conn: &Connection) -> Result<()> {
    conn.execute_batch("ALTER TABLE segments ADD COLUMN transcription TEXT;")?;
    Ok(())
}

fn apply_migration_v4(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS segment_kinds (
            id INTEGER PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            default_excluded INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO segment_kinds (slug, label, default_excluded, sort_order) VALUES
            ('pre',     'Pre-roll', 0, 0),
            ('intro',   'Intro',    0, 1),
            ('chapter', 'Kapitel',  0, 2),
            ('ad',      'Reklam',   1, 3),
            ('content', 'Innehåll', 0, 4),
            ('outro',   'Outro',    0, 5),
            ('post',    'Post-roll',0, 6);
        "#,
    )?;
    Ok(())
}
