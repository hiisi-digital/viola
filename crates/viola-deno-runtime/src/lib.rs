//! `viola-deno-runtime`. Viola plugin that bridges TS lint projects
//! into the v1 plugin ABI by driving a long-lived sibling `deno`
//! worker process.
//!
//! ## Why subprocess and not embedded
//!
//! Embedding `deno_core` directly gets you V8 + ops, but to *actually
//! run a real Deno project* (with `import "npm:..."`, `import "jsr:..."`,
//! node compat, deno cache reuse, byonm) you need the same wiring
//! Deno's CLI does, which is on the order of tens of thousands of
//! lines of deno-internal Rust. Reimplementing or vendoring it is a
//! multi-week project that turns into ongoing breakage every deno_lib
//! release. The simpler path that preserves full Deno semantics is to
//! invoke deno itself.
//!
//! Subprocess-per-call is too slow for a lint runner (deno startup +
//! module load is 50-200ms, paid on every diagnostic pass). Instead
//! the cdylib spawns one long-lived deno worker at init, communicates
//! with it via line-delimited JSON over stdin/stdout, and reaps it on
//! shutdown. Module cache stays hot across all lint invocations
//! within one viola-cli run; per-call overhead is the IPC roundtrip
//! plus the user's own work.
//!
//! ## What the user authors
//!
//! A normal Deno project. `viola.config.ts` exports a default async
//! function `(req) => void` that uses the bridge-installed global
//! `viola.diag({plugin_id, rule_id, severity, message, path, line,
//! column})` to emit diagnostics. byonm and deno's standard resolvers
//! handle every `import`. The bridge worker imports the config once
//! at startup, then dispatches each viola-cli lint pass to it.
//!
//! ## v1 ABI surface
//!
//! All three caps (Runner, Grammar, Lint) are exported. Runner +
//! Grammar emit empty NAM v1.0.0 payloads in this MVP cut; the lint
//! cap drives the worker. PR-D adds the `@hiisi/viola` builder API
//! integration and conformance harness.

use core::ffi::c_void;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

use hilavitkutin_extensions::{
    ProviderExport, ProviderId, ExtensionAbiStatus, InitHandler,
    ShutdownHandler,
};
use hilavitkutin_extensions_macros::export_extension;
use serde::{Deserialize, Serialize};
use viola_plugin_abi::{
    AbiStatus, BytesRef, PROVIDER_GRAMMAR_EXTRACT, PROVIDER_LINT_EVALUATE,
    PROVIDER_RUNNER_EXECUTE_SCOPE, Diagnostic, DiagnosticBatch, DiagnosticSeverity,
    FileEntry, GrammarExtractVtable, LintEvaluateVtable, NamPayload,
    NamVersion, RunScope, RunnerExecuteScopeVtable, SourceLocation,
    SourceRange,
};

const BRIDGE_TS: &str = include_str!("bridge.ts");

/// Wire shape emitted by bridge.ts on stdout.
#[derive(Deserialize)]
struct BridgeMessage {
    diag: Option<BridgeDiag>,
    done: Option<bool>,
    err: Option<String>,
}

#[derive(Deserialize)]
struct BridgeDiag {
    plugin_id: String,
    rule_id: String,
    severity: String,
    message: String,
    path: String,
    line: u32,
    column: u32,
}

/// Wire shape sent to bridge.ts on stdin. Kept Serialize-able and
/// flat so future ops slot in without breaking the schema.
#[derive(Serialize)]
struct LintRequest<'a> {
    op: &'static str,
    scope: ScopePayload<'a>,
}

#[derive(Serialize)]
struct ScopePayload<'a> {
    workspace_root: &'a str,
    files: Vec<FilePayload<'a>>,
}

#[derive(Serialize)]
struct FilePayload<'a> {
    path: &'a str,
    language: &'a str,
}

#[derive(Serialize)]
struct ShutdownRequest {
    op: &'static str,
}

/// Plugin-side arena holding the owned bytes a [`Diagnostic`]
/// references via [`BytesRef`]. Rebuilt on each lint invocation so
/// each call's pointers stay valid only until the next one (matching
/// the v1 contract: "host copies before next invocation").
#[derive(Default)]
struct Arena {
    blobs: Vec<Vec<u8>>,
    diagnostics: Vec<Diagnostic>,
}

impl Arena {
    fn clear(&mut self) {
        self.blobs.clear();
        self.diagnostics.clear();
    }

    fn intern(&mut self, s: &str) -> BytesRef {
        if s.is_empty() {
            return BytesRef::EMPTY;
        }
        let mut bytes = Vec::with_capacity(s.len());
        bytes.extend_from_slice(s.as_bytes());
        let ptr = bytes.as_ptr();
        let len = bytes.len();
        self.blobs.push(bytes);
        BytesRef {
            data: ptr,
            len: arvo::USize(len),
        }
    }
}

/// Live worker handle. Holds the pipes plus the cleanup paths.
struct WorkerState {
    child: Child,
    /// `Option` so `Drop` can `take()` and close it independently of
    /// the rest of the state. Always `Some` during normal operation.
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    bridge_path: PathBuf,
    arena: Arena,
}

impl Drop for WorkerState {
    fn drop(&mut self) {
        // Graceful shutdown with deadline. The worker can be hung
        // (slow npm import, infinite loop in user config, slow
        // shutdown handler), and a bare `wait()` would block the
        // host process forever.
        //
        // Sequence: send the shutdown op, then close stdin (the EOF
        // is also a shutdown signal), then poll try_wait() with a
        // short deadline, finally kill() if still alive.
        if let Some(mut stdin) = self.stdin.take() {
            let _ = serde_json::to_writer(
                &mut stdin,
                &ShutdownRequest { op: "shutdown" },
            );
            let _ = stdin.write_all(b"\n");
            let _ = stdin.flush();
            // stdin drops here, closing the pipe and signalling EOF
            // to the worker even if the JSON op never reached the
            // read loop.
        }

        let deadline = std::time::Instant::now()
            + std::time::Duration::from_millis(SHUTDOWN_DEADLINE_MS);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        let _ = self.child.kill();
                        let _ = self.child.wait();
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                Err(_) => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
            }
        }
        let _ = std::fs::remove_file(&self.bridge_path);
    }
}

/// Time the host waits for the deno worker to exit on its own after
/// receiving the shutdown op + stdin EOF before we send SIGKILL. Two
/// seconds is generous for a normal shutdown (worker only needs to
/// flush stdout and return from its loop) and short enough that a
/// hung worker does not stall viola-cli's exit perceptibly.
const SHUTDOWN_DEADLINE_MS: u64 = 2000;

static WORKER_STATE: Mutex<Option<WorkerState>> = Mutex::new(None);

/// Write the embedded `bridge.ts` to a temp file so deno can run it
/// from disk. We could pipe it via `deno run -` but stdin is reserved
/// for the IPC channel; a temp file is the simplest non-conflicting
/// path. Cleaned up on shutdown.
fn write_bridge_to_temp() -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    let pid = std::process::id();
    path.push(format!("viola-deno-bridge-{pid}.ts"));
    std::fs::write(&path, BRIDGE_TS)
        .map_err(|e| format!("write bridge: {e}"))?;
    Ok(path)
}

fn spawn_worker(user_config: &str) -> Result<WorkerState, String> {
    let bridge_path = write_bridge_to_temp()?;
    let mut child = Command::new("deno")
        .arg("run")
        .arg("--allow-all")
        .arg(&bridge_path)
        .arg(user_config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn deno: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "no stdin pipe".to_string())?;
    let stdout = BufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| "no stdout pipe".to_string())?,
    );
    Ok(WorkerState {
        child,
        stdin: Some(stdin),
        stdout,
        bridge_path,
        arena: Arena::default(),
    })
}

fn config_path_from_bytes(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("lint_config bytes empty (no [ts].config provided)".into());
    }
    let s = std::str::from_utf8(bytes)
        .map_err(|e| format!("config path not UTF-8: {e}"))?;
    let abs = std::fs::canonicalize(std::path::Path::new(s))
        .map_err(|e| format!("canonicalize {s:?}: {e}"))?;
    abs.into_os_string()
        .into_string()
        .map_err(|_| "config path not UTF-8 after canonicalize".to_string())
}

// ---------------------------------------------------------------------
// Runner capability
// ---------------------------------------------------------------------

unsafe extern "C" fn run_execute_scope(
    _host_ctx: *mut c_void,
    _scope: *const RunScope,
    out_nam: *mut NamPayload,
) -> AbiStatus {
    if out_nam.is_null() {
        return ExtensionAbiStatus::InvalidArg;
    }
    // SAFETY: out_nam is a host-owned out parameter the runner
    // contract requires us to populate exactly once per call.
    unsafe {
        *out_nam = NamPayload {
            version: NamVersion::new(1, 0, 0),
            data: core::ptr::null(),
            len: arvo::USize(0),
        };
    }
    ExtensionAbiStatus::Ok
}

static RUNNER_VTABLE: RunnerExecuteScopeVtable =
    RunnerExecuteScopeVtable { execute_scope: run_execute_scope };

pub struct RunnerCap;

impl ProviderExport for RunnerCap {
    const ID: ProviderId = PROVIDER_RUNNER_EXECUTE_SCOPE;
    const VTABLE_PTR: *const c_void =
        &RUNNER_VTABLE as *const _ as *const c_void;
}

// ---------------------------------------------------------------------
// Grammar capability
// ---------------------------------------------------------------------

unsafe extern "C" fn grammar_extract(
    _host_ctx: *mut c_void,
    _file: *const FileEntry,
    _source_bytes: *const u8,
    _source_len: arvo::USize,
    out_contribution: *mut NamPayload,
) -> AbiStatus {
    if out_contribution.is_null() {
        return ExtensionAbiStatus::InvalidArg;
    }
    // SAFETY: out_contribution is a host-owned out parameter the
    // grammar contract requires us to populate exactly once per call.
    unsafe {
        *out_contribution = NamPayload {
            version: NamVersion::new(1, 0, 0),
            data: core::ptr::null(),
            len: arvo::USize(0),
        };
    }
    ExtensionAbiStatus::Ok
}

static GRAMMAR_VTABLE: GrammarExtractVtable =
    GrammarExtractVtable { extract: grammar_extract };

pub struct GrammarCap;

impl ProviderExport for GrammarCap {
    const ID: ProviderId = PROVIDER_GRAMMAR_EXTRACT;
    const VTABLE_PTR: *const c_void =
        &GRAMMAR_VTABLE as *const _ as *const c_void;
}

// ---------------------------------------------------------------------
// Lint capability
// ---------------------------------------------------------------------

/// Translate a v1 RunScope into the JSON payload the bridge expects.
fn scope_to_payload(scope: &RunScope) -> ScopePayload<'_> {
    // SAFETY of the BytesRef reads below: pointers reference host-
    // owned memory the v1 contract guarantees valid for the duration
    // of this call. The slices we build are immediately serialised
    // and no references escape this function.
    let workspace_root = bytes_ref_to_str(&scope.workspace_root);
    let mut files = Vec::with_capacity(scope.files_len.0);
    if !scope.files.is_null() && scope.files_len.0 > 0 {
        let slice = unsafe {
            core::slice::from_raw_parts(scope.files, scope.files_len.0)
        };
        for f in slice {
            files.push(FilePayload {
                path: bytes_ref_to_str(&f.path),
                language: bytes_ref_to_str(&f.language),
            });
        }
    }
    ScopePayload { workspace_root, files }
}

fn bytes_ref_to_str(b: &BytesRef) -> &str {
    if b.data.is_null() || b.len.0 == 0 {
        return "";
    }
    // SAFETY: caller guarantees the BytesRef is valid for the
    // duration of the host call. We use &str only ephemerally inside
    // serde_json::to_writer.
    let bytes = unsafe { core::slice::from_raw_parts(b.data, b.len.0) };
    core::str::from_utf8(bytes).unwrap_or("")
}

fn lint_evaluate_inner(
    state: &mut WorkerState,
    scope: &RunScope,
) -> Result<(), String> {
    state.arena.clear();
    let req = LintRequest { op: "lint", scope: scope_to_payload(scope) };
    let line = serde_json::to_string(&req)
        .map_err(|e| format!("encode req: {e}"))?;
    let stdin = state
        .stdin
        .as_mut()
        .ok_or_else(|| "worker stdin closed".to_string())?;
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("write req: {e}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("write req nl: {e}"))?;
    stdin.flush().map_err(|e| format!("flush req: {e}"))?;

    loop {
        let mut line = String::new();
        let n = state
            .stdout
            .read_line(&mut line)
            .map_err(|e| format!("read worker: {e}"))?;
        if n == 0 {
            return Err("worker closed stdout unexpectedly".into());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: BridgeMessage = serde_json::from_str(trimmed)
            .map_err(|e| format!("decode worker: {e}: {trimmed}"))?;
        if let Some(err) = msg.err {
            return Err(format!("worker error: {err}"));
        }
        if let Some(d) = msg.diag {
            let plugin_id = state.arena.intern(&d.plugin_id);
            let rule_id = state.arena.intern(&d.rule_id);
            let message = state.arena.intern(&d.message);
            let path = state.arena.intern(&d.path);
            let severity = match d.severity.as_str() {
                "info" => DiagnosticSeverity::Info,
                "error" => DiagnosticSeverity::Error,
                _ => DiagnosticSeverity::Warn,
            };
            state.arena.diagnostics.push(Diagnostic {
                plugin_id,
                rule_id,
                severity,
                message,
                path,
                range: SourceRange {
                    start: SourceLocation { line: d.line, column: d.column },
                    end: SourceLocation { line: d.line, column: d.column },
                },
                suggestion: BytesRef::EMPTY,
                metadata_schema: ProviderId(0),
                metadata_ptr: core::ptr::null(),
                metadata_len: arvo::USize(0),
            });
            continue;
        }
        if msg.done.unwrap_or(false) {
            return Ok(());
        }
    }
}

unsafe extern "C" fn lint_evaluate(
    _host_ctx: *mut c_void,
    _nam: *const NamPayload,
    lint_config_bytes: *const u8,
    lint_config_len: arvo::USize,
    out_batch: *mut DiagnosticBatch,
) -> AbiStatus {
    if out_batch.is_null() {
        return ExtensionAbiStatus::InvalidArg;
    }

    // First-call lazy spawn: viola-cli passes the user's
    // viola.config.ts path through lint_config bytes. We canonicalize
    // it and start the worker now so init does not need the path.
    let config_path = if !lint_config_bytes.is_null() && lint_config_len.0 > 0 {
        // SAFETY: caller-provided slice valid for this invocation.
        let slice = unsafe {
            core::slice::from_raw_parts(lint_config_bytes, lint_config_len.0)
        };
        match config_path_from_bytes(slice) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("viola-deno-runtime: {e}");
                return ExtensionAbiStatus::InitFailed;
            }
        }
    } else {
        eprintln!(
            "viola-deno-runtime: no lint_config bytes; ts user config path required"
        );
        return ExtensionAbiStatus::InitFailed;
    };

    let mut guard = match WORKER_STATE.lock() {
        Ok(g) => g,
        Err(_) => return ExtensionAbiStatus::InitFailed,
    };
    if guard.is_none() {
        match spawn_worker(&config_path) {
            Ok(w) => *guard = Some(w),
            Err(e) => {
                eprintln!("viola-deno-runtime: spawn worker: {e}");
                return ExtensionAbiStatus::InitFailed;
            }
        }
    }
    let state = guard.as_mut().expect("just set above");

    // The v1 lint vtable does not pass RunScope directly. The host
    // has already populated NAM with run-derived data; the lint sees
    // only `nam` plus `lint_config`. PR-MVP sends an empty scope
    // payload to the bridge so user lint handlers receive an empty
    // file list. NAM translation is tracked under #197 (TS ecosystem
    // conformance) -- the conformance harness needs real file lists
    // to exercise the path, so the wiring lands there.
    let empty_scope = RunScope {
        workspace_root: BytesRef::EMPTY,
        files: core::ptr::null(),
        files_len: arvo::USize(0),
        surface: viola_plugin_abi::RunSurface::Cli,
        ci: 0,
        _reserved: [0; 3],
    };
    if let Err(e) = lint_evaluate_inner(state, &empty_scope) {
        eprintln!("viola-deno-runtime: lint: {e}");
        return ExtensionAbiStatus::Internal;
    }

    let entries_ptr = state.arena.diagnostics.as_ptr();
    let entries_len = state.arena.diagnostics.len();
    // SAFETY: out_batch is the host-owned out parameter the v1
    // contract requires us to populate exactly once per call.
    unsafe {
        *out_batch = DiagnosticBatch {
            entries: entries_ptr,
            len: arvo::USize(entries_len),
        };
    }
    ExtensionAbiStatus::Ok
}

static LINT_EVAL_VTABLE: LintEvaluateVtable =
    LintEvaluateVtable { evaluate: lint_evaluate };

pub struct LintEvalCap;

impl ProviderExport for LintEvalCap {
    const ID: ProviderId = PROVIDER_LINT_EVALUATE;
    const VTABLE_PTR: *const c_void =
        &LINT_EVAL_VTABLE as *const _ as *const c_void;
}

// ---------------------------------------------------------------------
// Init / shutdown
// ---------------------------------------------------------------------

pub struct InitImpl;

impl InitHandler for InitImpl {
    unsafe fn init(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        // The worker is spawned lazily on first lint_evaluate so init
        // does not need the user config path (which only arrives via
        // lint_config bytes). Init still succeeds idempotently.
        ExtensionAbiStatus::Ok
    }
}

pub struct ShutdownImpl;

impl ShutdownHandler for ShutdownImpl {
    unsafe fn shutdown(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        if let Ok(mut guard) = WORKER_STATE.lock() {
            // Drop runs the WorkerState destructor which sends a
            // shutdown op, waits for the child, and removes the temp
            // bridge.ts file.
            *guard = None;
        }
        ExtensionAbiStatus::Ok
    }
}

#[export_extension(
    name = "org.viola.deno.runtime",
    version = "0.1.0",
    providers = [RunnerCap, GrammarCap, LintEvalCap],
    init = InitImpl,
    shutdown = ShutdownImpl,
)]
#[allow(dead_code)]
pub struct DenoRuntimeExtension;
