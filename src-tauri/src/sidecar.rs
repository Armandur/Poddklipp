//! Spawn och kommunikation med Python-sidecaren via stdio JSON-RPC.
//!
//! Protokoll:
//!   Request:  {"id": <int>, "method": <str>, "params": <obj>}
//!   Response: {"id": <int>, "result": <obj>}  eller  {"id": <int>, "error": <str>}
//!   Progress: {"progress": <float 0-1>, "stage": <str>}  (ingen id)
//!
//! Progress rapporteras via en callback som anroparen skickar med till `call`.
//! Det låter analysens command-kontext (t.ex. episode_id) följa med i det
//! Tauri-event som slutligen emits till frontend.

use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub struct Sidecar {
    process: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl Sidecar {
    pub fn spawn() -> Result<Self> {
        let python = python_executable();
        let sidecar_dir = sidecar_dir();

        if !python.exists() {
            return Err(anyhow!(
                "Python-sidecar saknas. Förväntade sökväg: {}\n\
                 Skapa venv och installera: cd sidecar && python -m venv .venv && \
                 .venv\\Scripts\\activate && pip install -e \".[dev]\"",
                python.display()
            ));
        }

        let mut process = Command::new(&python)
            .args(["-m", "podklipp_sidecar"])
            .current_dir(&sidecar_dir)
            // Tvinga UTF-8 på stdio så att svenska tecken i sökvägar överlever
            // Windows default cp1252-dekodning.
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| anyhow!("kunde inte spawna sidecar ({}): {e}", python.display()))?;

        let stdin = process.stdin.take().ok_or_else(|| anyhow!("ingen stdin"))?;
        let stdout = process.stdout.take().ok_or_else(|| anyhow!("ingen stdout"))?;

        Ok(Sidecar {
            process,
            stdin: BufWriter::new(stdin),
            stdout: BufReader::new(stdout),
            next_id: 1,
        })
    }

    /// Skicka en request och läs svar. Progress-linjer rapporteras via `on_progress`
    /// så att anroparen själv kan välja vilket event de emits under (t.ex. med
    /// episode_id i payloaden).
    pub fn call(
        &mut self,
        method: &str,
        params: Value,
        on_progress: &dyn Fn(f64, &str),
    ) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;

        let req = json!({ "id": id, "method": method, "params": params });
        writeln!(self.stdin, "{req}")?;
        self.stdin.flush()?;

        loop {
            let mut line = String::new();
            let n = self.stdout.read_line(&mut line)?;
            if n == 0 {
                return Err(anyhow!("sidecar stängde stdout oväntat"));
            }

            let msg: Value = serde_json::from_str(line.trim())
                .map_err(|e| anyhow!("ogiltig JSON från sidecar: {e} | {line}"))?;

            if let Some(progress) = msg.get("progress").and_then(|v| v.as_f64()) {
                let stage = msg.get("stage").and_then(|v| v.as_str()).unwrap_or("");
                on_progress(progress, stage);
                continue;
            }

            if msg.get("id").and_then(|v| v.as_u64()) == Some(id) {
                if let Some(err) = msg.get("error").and_then(|v| v.as_str()) {
                    return Err(anyhow!("sidecar-fel: {err}"));
                }
                return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
            }

            eprintln!("sidecar: okänd rad: {line}");
        }
    }

    pub fn shutdown(mut self) {
        let _ = self.process.kill();
    }
}

/// Sökväg till Python-executable.
/// - Production: bundlad PyInstaller-binär i resources/sidecar/
/// - Dev: venv-python i sidecar/.venv/
fn python_executable() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("resources/sidecar").join(bundled_bin_name());
            if bundled.exists() {
                return bundled;
            }
        }
    }

    let manifest = env!("CARGO_MANIFEST_DIR");
    if cfg!(windows) {
        PathBuf::from(manifest).join("../sidecar/.venv/Scripts/python.exe")
    } else {
        PathBuf::from(manifest).join("../sidecar/.venv/bin/python")
    }
}

fn sidecar_dir() -> PathBuf {
    let manifest = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest).join("../sidecar")
}

fn bundled_bin_name() -> &'static str {
    if cfg!(windows) {
        "podklipp-sidecar.exe"
    } else {
        "podklipp-sidecar"
    }
}
