//! `viola-deno-runtime` — viola plugin that embeds a `deno_core`
//! JsRuntime and exposes the v1 runner / grammar / lint capabilities.
//!
//! The deno runtime IS viola's TypeScript plugin loader. The cdylib
//! ships one self-contained dynamic library: V8 isolate, transpiler,
//! and the v1 capability vtables that route into it. When a host
//! invokes a capability, the call funnels into a single embedded
//! `JsRuntime` which executes user TS that, in production, drives the
//! `@hiisi/viola` builder API and emits results back through registered
//! ops.
//!
//! ## Why embedded, not subprocess
//!
//! The plugin compiles once. The V8 isolate is created on plugin init
//! and reused across every capability invocation within a host run.
//! Per-invocation cost is the TS execution itself, not process startup.
//! The plugin distributes as one .dylib/.so/.dll; no external `deno`
//! binary is required at runtime.
//!
//! ## MVP scope (PR-A of #196)
//!
//! This cut establishes the structural shape of the runtime cdylib:
//!
//! - All three v1 capabilities (Runner, Grammar, Lint) are exported.
//! - The cdylib name and descriptor identify it as the deno runtime,
//!   not a "bridge". The host loads it once and dispatches every TS-
//!   backed role through it.
//! - Lint preserves the prior smoke-test behaviour: it runs the
//!   embedded `runtime.ts` (transpiled on init) which calls
//!   `op_emit_diagnostic` with one hardcoded diagnostic. This proves
//!   the V8 -> op -> Rust collector -> v1 wire path end-to-end.
//! - Runner emits an empty NAM v1.0.0 payload.
//! - Grammar emits an empty NAM v1.0.0 contribution.
//!
//! Real ES module loading (so the user's `viola.config.ts` becomes the
//! input rather than an embedded literal) lands in PR-B. Full
//! `@hiisi/viola` builder integration lands in PR-C. Parity testing
//! against the existing TS stack lands in PR-D.

use core::ffi::c_void;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Mutex;

use deno_core::{JsRuntime, OpState, RuntimeOptions, extension, op2};
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

const RUNTIME_TS: &str = include_str!("runtime.ts");

/// Transpile a TypeScript source string into JavaScript suitable for
/// `JsRuntime::execute_script`.
fn transpile_ts(specifier: &str, source: &str) -> Result<String, ()> {
    use deno_ast::{MediaType, ModuleSpecifier, ParseParams, SourceMapOption};

    let url = ModuleSpecifier::parse(&format!("file:///{}", specifier))
        .map_err(|e| eprintln!("viola-deno-runtime: bad specifier: {e}"))?;
    let parsed = deno_ast::parse_module(ParseParams {
        specifier: url,
        text: source.to_string().into(),
        media_type: MediaType::TypeScript,
        capture_tokens: false,
        scope_analysis: false,
        maybe_syntax: None,
    })
    .map_err(|e| eprintln!("viola-deno-runtime: TS parse error: {e}"))?;
    let transpile_opts = deno_ast::TranspileOptions::default();
    let emit_opts = deno_ast::EmitOptions {
        source_map: SourceMapOption::None,
        ..Default::default()
    };
    let transpile_mod_opts = deno_ast::TranspileModuleOptions::default();
    let res = parsed
        .transpile(&transpile_opts, &transpile_mod_opts, &emit_opts)
        .map_err(|e| eprintln!("viola-deno-runtime: TS transpile error: {e}"))?;
    let src = res.into_source();
    Ok(src.text)
}

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

extension!(
    runtime_ext,
    ops = [op_emit_diagnostic],
    options = { collector: Rc<RefCell<Collector>> },
    state = |state, options| {
        state.put(options.collector);
    },
);

/// Plugin-global state. Lazily initialised in `init`, reused across
/// every capability invocation. V8 isolates are thread-bound; the host
/// that drives any capability MUST always do so from the same thread
/// that invoked `init`.
struct RuntimeState {
    runtime: JsRuntime,
    collector: Rc<RefCell<Collector>>,
    arena: Arena,
    tokio: tokio::runtime::Runtime,
    runtime_js: String,
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
    let collector: Rc<RefCell<Collector>> = Rc::new(RefCell::new(Collector::default()));
    let runtime = JsRuntime::new(RuntimeOptions {
        extensions: vec![runtime_ext::init(collector.clone())],
        ..Default::default()
    });
    let runtime_js = transpile_ts("runtime.ts", RUNTIME_TS)?;
    Ok(RuntimeState {
        runtime,
        collector,
        arena: Arena::default(),
        tokio,
        runtime_js,
    })
}

// ---------------------------------------------------------------------
// Runner capability
// ---------------------------------------------------------------------

/// Runner role entrypoint. MVP: emits an empty NAM v1.0.0 payload.
/// PR-B + PR-C of #196 will load the user's viola.config.ts and run
/// the configured runner via the @hiisi/viola builder API.
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

/// Grammar role entrypoint. MVP: emits an empty NAM v1.0.0
/// contribution. PR-B + PR-C will dispatch into the configured
/// per-language grammar via @hiisi/viola.
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
///   bytes it intends to retain past that point. (viola-cli's
///   `CaptureSink` deep-copies on push, satisfying the contract.)
unsafe extern "C" fn lint_evaluate(
    _host_ctx: *mut c_void,
    _nam: *const NamPayload,
    _lint_config_bytes: *const u8,
    _lint_config_len: arvo::USize,
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

    let runtime_js = state.runtime_js.clone();
    state.tokio.block_on(async {
        match state.runtime.execute_script("runtime.ts", runtime_js) {
            Ok(_) => {}
            Err(e) => {
                eprintln!("viola-deno-runtime: script error: {e}");
            }
        }
    });

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
