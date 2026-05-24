//! Worker state, spawning, and lint invocation. Wraps the long-lived
//! deno subprocess and the per-call IPC roundtrip. The std imports
//! below are the irreducible subprocess boundary (no `core::process`,
//! no `core::io`, no `core::fs` exists); each carries an inline
//! `lint:allow` per the workspace allow discipline.

use crate::arena::Arena;
use crate::encoder::{build_lint_request, build_shutdown_request, FrameWriter};
use crate::error::DenoRuntimeError;
use crate::parser::{parse_message, read_line_into, trim_ws, ParsedMessage};
use crate::path::PathBuf64;
use crate::{BRIDGE_TS, LINE_CAP, PATH_CAP, SHUTDOWN_DEADLINE_MS, TEMP_NAME_CAP};
use core::ffi::c_void;
use core::ptr;
use hilavitkutin_extensions::{ExtensionAbiStatus, ProviderId};
use notko::Outcome;
use std::env;                                                        // lint:allow(forbidden-imports, no-std) -- subprocess host: temp dir lookup. tracked: #197
use std::fs;                                                         // lint:allow(forbidden-imports, no-std) -- subprocess host: bridge.ts write, config canonicalize. tracked: #197
use std::io::{BufReader, Write};                                     // lint:allow(forbidden-imports, no-std) -- subprocess host: stdin/stdout pipes. tracked: #197
use std::path::Path;                                                 // lint:allow(forbidden-imports, no-std) -- subprocess host: Command::arg, fs ops. tracked: #197
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};  // lint:allow(forbidden-imports, no-std) -- subprocess host: the deno worker itself. tracked: #197
use std::sync::Mutex;                                                // lint:allow(forbidden-imports, no-std) -- one global worker handle gated by mutex. tracked: #197
use std::thread;                                                     // lint:allow(forbidden-imports, no-std) -- subprocess shutdown poll loop. tracked: #197
use std::time::{Duration, Instant};                                  // lint:allow(forbidden-imports, no-std) -- subprocess shutdown deadline. tracked: #197
use viola_plugin_abi::{
    AbiStatus, BytesRef, Diagnostic, DiagnosticBatch, DiagnosticSeverity, NamPayload,
    RunScope, RunSurface, SourceLocation, SourceRange,
};

/// Live worker handle. Holds the pipes plus the cleanup paths.
pub(crate) struct WorkerState {
    child: Child,
    /// `Option` is the std-side typed slot for `take()` in `Drop`. The
    /// surrounding `Mutex` is the std boundary; the bare-option lint
    /// is irreducible here.
    stdin: Option<ChildStdin>,                                       // lint:allow(no-bare-option) -- needed for std::mem::take pattern inside std::sync::Mutex boundary. tracked: #197
    stdout: BufReader<ChildStdout>,
    bridge_path: PathBuf64,
    arena: Arena,
    encode_buf: FrameWriter,
    line_buf: [u8; LINE_CAP],
}

impl Drop for WorkerState {
    fn drop(&mut self) {
        // Graceful shutdown with deadline. The worker can hang (slow
        // npm import, infinite loop in user config, slow shutdown
        // handler), and a bare `wait()` would block the host process
        // forever.
        if let Some(mut stdin) = self.stdin.take() {
            self.encode_buf.reset();
            if let Outcome::Ok(()) = build_shutdown_request(&mut self.encode_buf) {
                let _ = stdin.write_all(self.encode_buf.as_slice());
                let _ = stdin.write_all(b"\n");
                let _ = stdin.flush();
            }
            // stdin drops here, closing the pipe and signalling EOF to
            // the worker even if the JSON op never reached the read
            // loop.
        }

        let deadline = Instant::now() + Duration::from_millis(SHUTDOWN_DEADLINE_MS);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = self.child.kill();
                        let _ = self.child.wait();
                        break;
                    }
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
            }
        }
        let _ = fs::remove_file(self.bridge_path.as_path());
    }
}

pub(crate) static WORKER_STATE: Mutex<Option<WorkerState>> = Mutex::new(None);    // lint:allow(no-bare-option, forbidden-imports, no-std) -- Mutex<Option<_>> is the std-side singleton slot pattern. tracked: #197

fn write_u32_dec(buf: &mut [u8], mut n: u32) -> usize {
    if n == 0 {
        if buf.is_empty() {
            return 0;
        }
        buf[0] = b'0';
        return 1;
    }
    let mut tmp = [0u8; 10];
    let mut i = 0;
    while n > 0 {
        tmp[i] = b'0' + (n % 10) as u8;
        n /= 10;
        i += 1;
    }
    if buf.len() < i {
        return 0;
    }
    let len = i;
    for j in 0..len {
        buf[j] = tmp[len - 1 - j];
    }
    len
}

/// Write the embedded `bridge.ts` to a temp file so deno can run it
/// from disk. We could pipe it via `deno run -` but stdin is reserved
/// for the IPC channel; a temp file is the simplest non-conflicting
/// path. Cleaned up on shutdown.
fn write_bridge_to_temp() -> Outcome<PathBuf64, DenoRuntimeError> {
    let dir = env::temp_dir();
    let pid = std::process::id();                                    // lint:allow(no-std) -- pid for unique temp file name. tracked: #197

    let prefix = b"viola-deno-bridge-";
    let suffix = b".ts";
    let dir_str = match dir.to_str() {
        Some(s) => s,
        None => return Outcome::Err(DenoRuntimeError::TempDirNotUtf8),
    };

    let mut path = match PathBuf64::from_str(dir_str) {
        Outcome::Ok(p) => p,
        Outcome::Err(e) => return Outcome::Err(e),
    };

    let mut name_buf = [0u8; TEMP_NAME_CAP];
    let mut idx = 0;
    if prefix.len() > TEMP_NAME_CAP {
        return Outcome::Err(DenoRuntimeError::TempNameOverflow);
    }
    name_buf[..prefix.len()].copy_from_slice(prefix);
    idx += prefix.len();
    let pid_len = write_u32_dec(&mut name_buf[idx..], pid);
    if pid_len == 0 {
        return Outcome::Err(DenoRuntimeError::TempNameOverflow);
    }
    idx += pid_len;
    if idx + suffix.len() > TEMP_NAME_CAP {
        return Outcome::Err(DenoRuntimeError::TempNameOverflow);
    }
    name_buf[idx..idx + suffix.len()].copy_from_slice(suffix);
    idx += suffix.len();

    // Append `/` + name (subprocess host is unix-shaped via the deno
    // CLI; Windows support tracked #197). Trim a trailing separator
    // first so `env::temp_dir()` returning `/var/folders/.../T/` does
    // not produce a double-slash in the resulting path.
    if path.len.0 > 0 && path.bytes[path.len.0 - 1] == b'/' {
        path.len.0 -= 1;
    }
    if path.len.0 + 1 + idx > PATH_CAP {
        return Outcome::Err(DenoRuntimeError::ConfigPathTooLong);
    }
    path.bytes[path.len.0] = b'/';
    path.len.0 += 1;
    path.bytes[path.len.0..path.len.0 + idx].copy_from_slice(&name_buf[..idx]);
    path.len.0 += idx;

    if fs::write(path.as_path(), BRIDGE_TS).is_err() {
        return Outcome::Err(DenoRuntimeError::BridgeWriteFailed);
    }
    Outcome::Ok(path)
}

fn spawn_worker(user_config: &PathBuf64) -> Outcome<WorkerState, DenoRuntimeError> {
    let bridge_path = match write_bridge_to_temp() {
        Outcome::Ok(p) => p,
        Outcome::Err(e) => return Outcome::Err(e),
    };
    let child_res = Command::new("deno")
        .arg("run")
        .arg("--allow-all")
        .arg(bridge_path.as_path())
        .arg(user_config.as_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn();
    let mut child = match child_res {
        Ok(c) => c,
        Err(_) => return Outcome::Err(DenoRuntimeError::SpawnDenoFailed),
    };
    let stdin = match child.stdin.take() {
        Some(s) => s,
        None => return Outcome::Err(DenoRuntimeError::NoStdin),
    };
    let stdout_raw = match child.stdout.take() {
        Some(s) => s,
        None => return Outcome::Err(DenoRuntimeError::NoStdout),
    };
    Outcome::Ok(WorkerState {
        child,
        stdin: Some(stdin),
        stdout: BufReader::new(stdout_raw),
        bridge_path,
        arena: Arena::new(),
        encode_buf: FrameWriter::new(),
        line_buf: [0; LINE_CAP],
    })
}

fn config_path_from_bytes(bytes: &[u8]) -> Outcome<PathBuf64, DenoRuntimeError> {
    if bytes.is_empty() {
        return Outcome::Err(DenoRuntimeError::ConfigBytesEmpty);
    }
    let s = match core::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return Outcome::Err(DenoRuntimeError::ConfigNotUtf8),
    };
    let abs = match fs::canonicalize(Path::new(s)) {
        Ok(p) => p,
        Err(_) => return Outcome::Err(DenoRuntimeError::ConfigCanonicalizeFailed),
    };
    let abs_str = match abs.to_str() {
        Some(s) => s,
        None => return Outcome::Err(DenoRuntimeError::ConfigNotUtf8),
    };
    PathBuf64::from_str(abs_str)
}

fn lint_evaluate_inner(
    state: &mut WorkerState,
    scope: &RunScope,
) -> Outcome<(), DenoRuntimeError> {
    state.arena.clear();
    state.encode_buf.reset();
    if let Outcome::Err(e) = build_lint_request(&mut state.encode_buf, scope) {
        return Outcome::Err(e);
    }

    let stdin = match state.stdin.as_mut() {
        Some(s) => s,
        None => return Outcome::Err(DenoRuntimeError::WorkerStdinClosed),
    };
    if stdin.write_all(state.encode_buf.as_slice()).is_err() {
        return Outcome::Err(DenoRuntimeError::WriteWorkerFailed);
    }
    if stdin.write_all(b"\n").is_err() {
        return Outcome::Err(DenoRuntimeError::WriteWorkerFailed);
    }
    if stdin.flush().is_err() {
        return Outcome::Err(DenoRuntimeError::WriteWorkerFailed);
    }

    loop {
        let n = match read_line_into(&mut state.stdout, &mut state.line_buf) {
            Outcome::Ok(v) => v,
            Outcome::Err(e) => return Outcome::Err(e),
        };
        if n == 0 {
            return Outcome::Err(DenoRuntimeError::WorkerEofUnexpected);
        }
        let trimmed = trim_ws(&state.line_buf[..n]);
        if trimmed.is_empty() {
            continue;
        }
        let msg = match parse_message(trimmed) {
            Outcome::Ok(v) => v,
            Outcome::Err(e) => return Outcome::Err(e),
        };
        match msg {
            ParsedMessage::Err => {
                return Outcome::Err(DenoRuntimeError::WorkerReportedError);
            }
            ParsedMessage::Done => {
                return Outcome::Ok(());
            }
            ParsedMessage::Diag(d) => {
                let plugin_id = match state.arena.intern(&d.plugin_id[..d.plugin_id_len]) {
                    Outcome::Ok(b) => b,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                let rule_id = match state.arena.intern(&d.rule_id[..d.rule_id_len]) {
                    Outcome::Ok(b) => b,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                let message = match state.arena.intern(&d.message[..d.message_len]) {
                    Outcome::Ok(b) => b,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                let path = match state.arena.intern(&d.path[..d.path_len]) {
                    Outcome::Ok(b) => b,
                    Outcome::Err(e) => return Outcome::Err(e),
                };
                let severity = match &d.severity[..d.severity_len] {
                    b"info" => DiagnosticSeverity::Info,
                    b"error" => DiagnosticSeverity::Error,
                    b"warn" | b"warning" => DiagnosticSeverity::Warn,
                    _ => return Outcome::Err(DenoRuntimeError::BadSeverity),
                };
                let diag = Diagnostic {
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
                    metadata_ptr: ptr::null(),
                    metadata_len: arvo::USize(0),
                };
                if let Outcome::Err(e) = state.arena.push_diag(diag) {
                    return Outcome::Err(e);
                }
            }
        }
    }
}

pub(crate) unsafe extern "C" fn lint_evaluate(
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
            Outcome::Ok(p) => p,
            Outcome::Err(e) => {
                e.report();
                return ExtensionAbiStatus::InitFailed;
            }
        }
    } else {
        DenoRuntimeError::ConfigBytesEmpty.report();
        return ExtensionAbiStatus::InitFailed;
    };

    let mut guard = match WORKER_STATE.lock() {
        Ok(g) => g,
        Err(_) => return ExtensionAbiStatus::InitFailed,
    };
    if guard.is_none() {
        match spawn_worker(&config_path) {
            Outcome::Ok(w) => *guard = Some(w),
            Outcome::Err(e) => {
                e.report();
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
    // conformance).
    let empty_scope = RunScope {
        workspace_root: BytesRef::EMPTY,
        files: ptr::null(),
        files_len: arvo::USize(0),
        surface: RunSurface::Cli,
        ci: 0,
        _reserved: [0; 3],
    };
    if let Outcome::Err(e) = lint_evaluate_inner(state, &empty_scope) {
        e.report();
        return ExtensionAbiStatus::Internal;
    }

    let entries_ptr = state.arena.diagnostics_ptr();
    let entries_len = state.arena.diag_count.0;
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
