//! Conformance harness: viola-cli's passthrough mode produces
//! byte-identical stdout / stderr / exit code to invoking the
//! underlying TS CLI directly via `deno run -A jsr:@hiisi/viola-cli`.
//!
//! The passthrough is implemented through `libc::execvp` in
//! `viola-cli/src/main.rs`, so byte-equality is structural by
//! construction. These tests lock the guarantee in: any future
//! refactor that injects extra prints, reorders args, or mutates the
//! environment before exec breaks the test.
//!
//! ## Running
//!
//! Marked `#[ignore]` because the test requires `deno` on PATH and
//! network access on first invocation to fetch
//! `jsr:@hiisi/viola-cli`. Run on demand with:
//!
//! ```bash
//! cargo test -p viola-cli --test passthrough_conformance \
//!     -- --ignored --test-threads=1
//! ```
//!
//! `--test-threads=1` matters: deno's JSR cache is process-global, so
//! parallel tests can race over cache populate / hit and produce
//! different stderr (cache-fetch banner) within one run. A warmup
//! call inside each test cushions this, but serialised execution is
//! the safe default.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::{Mutex, Once};

const VIOLA_BIN: &str = env!("CARGO_BIN_EXE_viola-cli");
const JSR_COORD: &str = "jsr:@hiisi/viola-cli";

/// Process-level mutex that serialises every test in this module.
/// Cargo's default test harness runs tests in parallel threads; the
/// `--test-threads=1` advisory in the module doc is best-effort. This
/// mutex enforces serialisation regardless. Without it, parallel
/// deno spawns can race on Deno's global JSR cache state and produce
/// stderr that differs only in ordering of cache-status lines.
static SERIALISE: Mutex<()> = Mutex::new(());

fn ensure_jsr_cached() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // Run in temp_dir to avoid mutating any deno.lock in the test
        // harness's cwd (the viola repo root). `--no-lock` belt-and-
        // suspenders the same intent in case temp_dir contains a
        // deno.json from an unrelated tool.
        let _ = Command::new("deno")
            .args(["cache", "--no-lock", JSR_COORD])
            .current_dir(std::env::temp_dir())
            .output();
    });
}

/// RAII tempdir: removes the directory on drop, so test panics do not
/// leave debris in `/tmp`.
struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        Self(unique_tempdir(tag))
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn run_viola(args: &[&str], cwd: &Path) -> Output {
    Command::new(VIOLA_BIN)
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn viola-cli")
}

fn run_deno_jsr(args: &[&str], cwd: &Path) -> Output {
    let mut full: Vec<&str> = vec!["run", "-A", JSR_COORD];
    full.extend_from_slice(args);
    Command::new("deno")
        .args(&full)
        .current_dir(cwd)
        .output()
        .expect("spawn deno (is `deno` on PATH?)")
}

fn assert_byte_equal(viola: &Output, deno: &Output, label: &str) {
    if viola.stdout != deno.stdout {
        panic!(
            "{label}: stdout differs\n--- viola stdout ---\n{}\n--- deno stdout ---\n{}",
            String::from_utf8_lossy(&viola.stdout),
            String::from_utf8_lossy(&deno.stdout),
        );
    }
    if viola.stderr != deno.stderr {
        panic!(
            "{label}: stderr differs\n--- viola stderr ---\n{}\n--- deno stderr ---\n{}",
            String::from_utf8_lossy(&viola.stderr),
            String::from_utf8_lossy(&deno.stderr),
        );
    }
    let v_code = viola.status.code();
    let d_code = deno.status.code();
    assert_eq!(
        v_code, d_code,
        "{label}: exit code differs (viola={v_code:?} deno={d_code:?})"
    );
}

fn unique_tempdir(tag: &str) -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let pid = std::process::id();
    let path = std::env::temp_dir()
        .join(format!("viola-conformance-{tag}-{pid}-{nanos}"));
    std::fs::create_dir_all(&path).expect("create tempdir");
    path
}

#[test]
#[ignore]
fn passthrough_help_matches_deno() {
    let _guard = SERIALISE.lock().unwrap_or_else(|e| e.into_inner());
    ensure_jsr_cached();
    let tmp = TempDir::new("help");
    let v = run_viola(&["--help"], tmp.path());
    let d = run_deno_jsr(&["--help"], tmp.path());
    assert_byte_equal(&v, &d, "--help");
}

#[test]
#[ignore]
fn passthrough_version_matches_deno() {
    let _guard = SERIALISE.lock().unwrap_or_else(|e| e.into_inner());
    ensure_jsr_cached();
    let tmp = TempDir::new("version");
    let v = run_viola(&["--version"], tmp.path());
    let d = run_deno_jsr(&["--version"], tmp.path());
    assert_byte_equal(&v, &d, "--version");
}

#[test]
#[ignore]
fn passthrough_no_args_matches_deno() {
    // Empty cwd without viola.toml or viola.config.ts. The Rust
    // binary's read of ./viola.toml fails, triggering passthrough.
    // The deno-direct invocation, run in the same cwd, exhibits the
    // same "no config" path. Both outputs must match byte-for-byte.
    let _guard = SERIALISE.lock().unwrap_or_else(|e| e.into_inner());
    ensure_jsr_cached();
    let tmp = TempDir::new("no-args");
    let v = run_viola(&[], tmp.path());
    let d = run_deno_jsr(&[], tmp.path());
    assert_byte_equal(&v, &d, "no-args (empty cwd)");
}
