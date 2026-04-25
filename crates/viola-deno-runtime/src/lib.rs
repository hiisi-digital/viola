//! `viola-deno-runtime`. Viola plugin that embeds a `deno_core`
//! JsRuntime and exposes the v1 runner / grammar / lint capabilities.
//!
//! The deno runtime IS viola's TypeScript plugin loader. The cdylib
//! ships one self-contained dynamic library: V8 isolate, transpiler,
//! ES module loader, and the v1 capability vtables that route into it.
//! When a host invokes a capability, the call funnels into a single
//! embedded `JsRuntime` which loads and evaluates the user's
//! `viola.config.ts` as an ES module.
//!
//! ## Why embedded, not subprocess
//!
//! The plugin compiles once. The V8 isolate is created on plugin init
//! and reused across every capability invocation within a host run.
//! Per-invocation cost is the TS execution itself, not process startup.
//! The plugin distributes as one .dylib/.so/.dll; no external `deno`
//! binary is required at runtime.
//!
//! ## Scope after PR-B of #196
//!
//! - All three v1 capabilities (Runner, Grammar, Lint) are exported.
//!   Runner + Grammar are MVP empty-NAM stubs; the Lint role drives
//!   the embedded JsRuntime end-to-end.
//! - Lint reads the user's config path from `lint_config_bytes` (set
//!   by viola-cli from `viola.toml`'s `[ts].config` field), publishes
//!   it through the `op_get_config_path` op, and loads an embedded
//!   wrapper module (`runtime.ts`) as the ES main. The wrapper
//!   dynamically imports the user's config; the custom
//!   [`module::TsFsModuleLoader`] reads the file from disk and
//!   transpiles `.ts` / `.tsx` / `.mts` / `.cts` via `deno_ast`.
//! - Diagnostics are still emitted via `op_emit_diagnostic`. The user
//!   config is responsible for emitting its own diagnostics in this
//!   PR-B MVP; PR-C wires `@hiisi/viola`'s builder API so the user
//!   config exports a builder result instead.
//!
//! ## Still pending
//!
//! Bare-specifier imports (`import "@hiisi/viola"`) do not resolve in
//! PR-B; the loader recognises only `file://` URLs and the embedded
//! `viola-internal:runtime.ts` specifier. PR-C adds bare-specifier
//! resolution and `@hiisi/viola` integration. PR-D ships the
//! conformance harness.

use core::ffi::c_void;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Mutex;

use deno_core::{
    JsRuntime, ModuleSpecifier, OpState, PollEventLoopOptions,
    RuntimeOptions, extension, op2,
};
use hilavitkutin_extensions::{
    CapabilityExport, CapabilityId, ExtensionAbiStatus, InitHandler,
    ShutdownHandler,
};
use hilavitkutin_extensions_macros::export_extension;
use serde::Deserialize;
use viola_plugin_abi::{
    AbiStatus, BytesRef, CAP_GRAMMAR_EXTRACT, CAP_LINT_EVALUATE,
    CAP_RUNNER_EXECUTE_SCOPE, Diagnostic, DiagnosticBatch, DiagnosticSeverity,
    FileEntry, GrammarExtractVtable, LintEvaluateVtable, NamPayload,
    NamVersion, RunScope, RunnerExecuteScopeVtable, SourceLocation,
    SourceRange,
};

mod module;
mod transpile;

use module::{RUNTIME_INTERNAL_SPECIFIER, TsFsModuleLoader};

const RUNTIME_TS: &str = include_str!("runtime.ts");

/// Wire shape for diagnostics emitted by the runtime's TS layer.
#[derive(Deserialize)]
struct RuntimeDiagnostic {
    plugin_id: String,
    rule_id: String,
    severity: String,
    message: String,
    path: String,
    line: u32,
    column: u32,
}

#[derive(Default)]
struct Collector {
    pending: Vec<RuntimeDiagnostic>,
}

/// Per-call slot the host writes before evaluating the wrapper module.
/// The TS side reads it via `op_get_config_path` to learn which user
/// config to dynamically import.
#[derive(Default)]
struct ConfigPath {
    path: String,
}

/// Plugin-side arena holding the owned bytes a [`Diagnostic`]
/// references via [`BytesRef`]. Rebuilt on each lint invocation; the
/// previous batch's pointers are valid only until the next call,
/// matching the v1 contract: "Buffer ownership is plugin-side; the
/// host copies before the next invocation."
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

#[op2(fast)]
fn op_emit_diagnostic(state: &mut OpState, #[string] json: &str) {
    let collector = state.borrow_mut::<Rc<RefCell<Collector>>>();
    if let Ok(d) = serde_json::from_str::<RuntimeDiagnostic>(json) {
        collector.borrow_mut().pending.push(d);
    }
}

#[op2]
#[string]
fn op_get_config_path(state: &mut OpState) -> String {
    let cp = state.borrow::<Rc<RefCell<ConfigPath>>>();
    cp.borrow().path.clone()
}

extension!(
    runtime_ext,
    ops = [op_emit_diagnostic, op_get_config_path],
    options = {
        collector: Rc<RefCell<Collector>>,
        config_path: Rc<RefCell<ConfigPath>>,
    },
    state = |state, options| {
        state.put(options.collector);
        state.put(options.config_path);
    },
);

/// Plugin-global state. Lazily initialised in `init`, reused across
/// every capability invocation. V8 isolates are thread-bound; the host
/// that drives any capability MUST always do so from the same thread
/// that invoked `init`.
struct RuntimeState {
    runtime: JsRuntime,
    collector: Rc<RefCell<Collector>>,
    config_path: Rc<RefCell<ConfigPath>>,
    arena: Arena,
    tokio: tokio::runtime::Runtime,
    /// Pre-parsed specifier for the embedded wrapper module. Reused on
    /// every lint invocation; load_main_es_module fetches it through
    /// the custom module loader, which serves the embedded TS source.
    runtime_specifier: ModuleSpecifier,
}

// SAFETY: thread-pinning contract documented at the capability
// entrypoints. We never share RUNTIME_STATE across threads in
// viola-cli's single-threaded host.
unsafe impl Send for RuntimeState {}

static RUNTIME_STATE: Mutex<Option<RuntimeState>> = Mutex::new(None);

fn build_state() -> Result<RuntimeState, ()> {
    let tokio = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| ())?;
    let collector: Rc<RefCell<Collector>> =
        Rc::new(RefCell::new(Collector::default()));
    let config_path: Rc<RefCell<ConfigPath>> =
        Rc::new(RefCell::new(ConfigPath::default()));
    let module_loader = Rc::new(TsFsModuleLoader {
        embedded_runtime_ts: RUNTIME_TS.to_string(),
    });
    let runtime = JsRuntime::new(RuntimeOptions {
        module_loader: Some(module_loader),
        extensions: vec![runtime_ext::init(collector.clone(), config_path.clone())],
        ..Default::default()
    });
    let runtime_specifier = ModuleSpecifier::parse(RUNTIME_INTERNAL_SPECIFIER)
        .map_err(|e| {
            eprintln!("viola-deno-runtime: bad embedded specifier: {e}");
        })?;
    Ok(RuntimeState {
        runtime,
        collector,
        config_path,
        arena: Arena::default(),
        tokio,
        runtime_specifier,
    })
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

impl CapabilityExport for RunnerCap {
    const ID: CapabilityId = CAP_RUNNER_EXECUTE_SCOPE;
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

impl CapabilityExport for GrammarCap {
    const ID: CapabilityId = CAP_GRAMMAR_EXTRACT;
    const VTABLE_PTR: *const c_void =
        &GRAMMAR_VTABLE as *const _ as *const c_void;
}

// ---------------------------------------------------------------------
// Lint capability
// ---------------------------------------------------------------------

/// Resolve `lint_config_bytes` (a UTF-8 path supplied by viola-cli
/// from `viola.toml`'s `[ts].config`) into a `file://` URL string.
/// Returns an empty string when no config was supplied so the
/// embedded wrapper short-circuits gracefully.
///
/// Note: `canonicalize` resolves relative paths against the process
/// cwd at call time, not against the directory containing the
/// `viola.toml` that produced the bytes. In viola-cli's typical use
/// (run from the project root, where `viola.toml` also lives) this
/// matches user expectations. Tracked as a viola-cli-side follow-up:
/// the host should pre-resolve relative paths against the
/// `viola.toml` parent before passing them in.
fn config_path_to_file_url(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    let s = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => {
            eprintln!(
                "viola-deno-runtime: lint_config bytes are not UTF-8; ignoring",
            );
            return String::new();
        }
    };
    let path = std::path::Path::new(s);
    let abs = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(e) => {
            eprintln!(
                "viola-deno-runtime: cannot canonicalize {s:?}: {e}",
            );
            return String::new();
        }
    };
    match ModuleSpecifier::from_file_path(&abs) {
        Ok(url) => url.to_string(),
        Err(_) => {
            eprintln!(
                "viola-deno-runtime: cannot build file URL from {}",
                abs.display(),
            );
            String::new()
        }
    }
}

/// Lint role entrypoint.
///
/// # Safety / contract
///
/// - The host MUST invoke this from the same OS thread that called
///   `init_fn`. V8 isolates are thread-bound and the embedded
///   `JsRuntime` is `!Send`; the `unsafe impl Send` on `RuntimeState`
///   is justified solely by this thread-pinning contract. A
///   multi-threaded host that violates the contract will silently
///   corrupt V8 state.
/// - Per the v1 plugin ABI: bytes referenced by [`BytesRef`] in the
///   returned [`DiagnosticBatch`] are plugin-owned and remain valid
///   until the next call to this function. The host MUST copy any
///   bytes it intends to retain past that point.
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
    let mut guard = match RUNTIME_STATE.lock() {
        Ok(g) => g,
        Err(_) => return ExtensionAbiStatus::InitFailed,
    };
    let state = match guard.as_mut() {
        Some(s) => s,
        None => return ExtensionAbiStatus::InitFailed,
    };

    state.collector.borrow_mut().pending.clear();
    state.arena.clear();

    // Resolve the user's config path from the lint_config payload and
    // publish it for op_get_config_path before driving the wrapper.
    let cfg_url = if !lint_config_bytes.is_null() && lint_config_len.0 > 0 {
        // SAFETY: caller-provided slice valid for this invocation.
        let slice = unsafe {
            core::slice::from_raw_parts(lint_config_bytes, lint_config_len.0)
        };
        config_path_to_file_url(slice)
    } else {
        String::new()
    };
    state.config_path.borrow_mut().path = cfg_url;

    let specifier = state.runtime_specifier.clone();
    // ES module semantics: each `(specifier, isolate)` pair evaluates
    // exactly once. The first lint_evaluate registers + runs the
    // wrapper plus the user config, drives op_emit_diagnostic, and the
    // module-graph state caches the user module by its file:// URL.
    // Subsequent lint_evaluate calls in the same process would short-
    // circuit at the cached module without re-running the user's
    // side-effecting top level. viola-cli's current pipeline calls
    // lint_evaluate once per process, so this does not bite today.
    // PR-C replaces this side-effect-driven shape with the
    // @hiisi/viola builder API, which exports a callable that runs on
    // demand without needing module re-evaluation.
    let result: Result<(), String> = state.tokio.block_on(async {
        let mod_id = state
            .runtime
            .load_main_es_module(&specifier)
            .await
            .map_err(|e| format!("load: {e}"))?;
        let eval_fut = state.runtime.mod_evaluate(mod_id);
        state
            .runtime
            .run_event_loop(PollEventLoopOptions::default())
            .await
            .map_err(|e| format!("event loop: {e}"))?;
        eval_fut.await.map_err(|e| format!("evaluate: {e}"))?;
        Ok(())
    });
    if let Err(e) = result {
        eprintln!("viola-deno-runtime: {e}");
    }

    let pending: Vec<RuntimeDiagnostic> =
        std::mem::take(&mut state.collector.borrow_mut().pending);
    for d in pending {
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
            metadata_schema: CapabilityId(0),
            metadata_ptr: core::ptr::null(),
            metadata_len: arvo::USize(0),
        });
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

impl CapabilityExport for LintEvalCap {
    const ID: CapabilityId = CAP_LINT_EVALUATE;
    const VTABLE_PTR: *const c_void =
        &LINT_EVAL_VTABLE as *const _ as *const c_void;
}

// ---------------------------------------------------------------------
// Init / shutdown
// ---------------------------------------------------------------------

pub struct InitImpl;

impl InitHandler for InitImpl {
    unsafe fn init(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        // Idempotent. The host may load the same cdylib more than once
        // per process (e.g. viola-cli auto-load registers the runtime
        // as both runner and lint). Re-initialising would rebuild a
        // fresh V8 isolate and drop the previous one; instead, treat
        // the second call as a no-op so all Extension handles share
        // one isolate via the global RUNTIME_STATE.
        {
            let guard = match RUNTIME_STATE.lock() {
                Ok(g) => g,
                Err(_) => return ExtensionAbiStatus::InitFailed,
            };
            if guard.is_some() {
                return ExtensionAbiStatus::Ok;
            }
        }
        match build_state() {
            Ok(s) => {
                let mut guard = match RUNTIME_STATE.lock() {
                    Ok(g) => g,
                    Err(_) => return ExtensionAbiStatus::InitFailed,
                };
                if guard.is_none() {
                    *guard = Some(s);
                }
                ExtensionAbiStatus::Ok
            }
            Err(()) => ExtensionAbiStatus::InitFailed,
        }
    }
}

pub struct ShutdownImpl;

impl ShutdownHandler for ShutdownImpl {
    unsafe fn shutdown(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        if let Ok(mut guard) = RUNTIME_STATE.lock() {
            *guard = None;
        }
        ExtensionAbiStatus::Ok
    }
}

#[export_extension(
    name = "org.viola.deno.runtime",
    version = "0.1.0",
    capabilities = [RunnerCap, GrammarCap, LintEvalCap],
    init = InitImpl,
    shutdown = ShutdownImpl,
)]
#[allow(dead_code)]
pub struct DenoRuntimeExtension;
