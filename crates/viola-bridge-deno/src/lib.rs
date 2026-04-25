//! `viola-bridge-deno` — viola lint plugin that embeds a `deno_core`
//! JsRuntime in-process.
//!
//! The bridge is a self-contained cdylib: a single dynamic library
//! that, when loaded by the viola host, brings up a V8 isolate and
//! executes a TS bridge runtime that calls back into the host via a
//! registered op. Diagnostics emitted from TS land in a Rust-side
//! collector and are returned as a v1 [`DiagnosticBatch`] to the
//! viola pipeline.
//!
//! ## Why embedded, not subprocess
//!
//! The plugin compiles once. The V8 isolate is created on plugin
//! init and reused across every `evaluate()` call within a host run.
//! Per-invocation cost is the TS execution itself, not process
//! startup. The plugin distributes as one .dylib/.so/.dll; no
//! external `deno` binary is required at runtime.
//!
//! ## MVP scope
//!
//! This first cut wires the embedding pattern end-to-end:
//!
//! - cdylib loads under `viola_core::ExtensionHost`
//! - init creates a `JsRuntime` with the bridge extension
//! - `evaluate()` executes the embedded `bridge_runtime.ts`
//! - the TS calls `op_emit_diagnostic(json)` once with a hardcoded
//!   diagnostic
//! - the bridge collector serialises that into a v1 [`Diagnostic`]
//!   with `BytesRef` slots backed by plugin-owned `Vec<u8>` arenas
//! - the host receives the batch through the standard
//!   `viola_core::pipeline::run` path
//!
//! Loading the user's `viola.config.ts` and running the full
//! `@hiisi/viola` TS pipeline through the bridge is the immediate
//! follow-up.

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
    AbiStatus, BytesRef, CAP_LINT_EVALUATE, Diagnostic, DiagnosticBatch,
    DiagnosticSeverity, LintEvaluateVtable, NamPayload, SourceLocation,
    SourceRange,
};

const BRIDGE_RUNTIME_TS: &str = include_str!("bridge_runtime.ts");

/// Transpile a TypeScript source string into JavaScript suitable for
/// `JsRuntime::execute_script`.
///
/// Uses `deno_ast::parse_module` + `transpile` with default options
/// that strip type annotations, lower TS syntax (enums, decorators,
/// type-only imports), and emit ES module JS. Returns `Err(())` on
/// parse / transpile failure with the message printed to stderr; the
/// caller maps this to `ExtensionAbiStatus::InternalError`.
fn transpile_ts(specifier: &str, source: &str) -> Result<String, ()> {
    use deno_ast::{MediaType, ModuleSpecifier, ParseParams, SourceMapOption};

    let url = ModuleSpecifier::parse(&format!("file:///{}", specifier))
        .map_err(|e| eprintln!("viola-bridge-deno: bad specifier: {e}"))?;
    let parsed = deno_ast::parse_module(ParseParams {
        specifier: url,
        text: source.to_string().into(),
        media_type: MediaType::TypeScript,
        capture_tokens: false,
        scope_analysis: false,
        maybe_syntax: None,
    })
    .map_err(|e| eprintln!("viola-bridge-deno: TS parse error: {e}"))?;
    let transpile_opts = deno_ast::TranspileOptions::default();
    let emit_opts = deno_ast::EmitOptions {
        source_map: SourceMapOption::None,
        ..Default::default()
    };
    let transpile_mod_opts = deno_ast::TranspileModuleOptions::default();
    let res = parsed
        .transpile(&transpile_opts, &transpile_mod_opts, &emit_opts)
        .map_err(|e| eprintln!("viola-bridge-deno: TS transpile error: {e}"))?;
    let src = res.into_source();
    Ok(src.text)
}

/// Wire shape for diagnostics emitted by the bridge runtime.
///
/// The TS side serialises one of these as JSON and passes it to
/// `op_emit_diagnostic`. The Rust side deserialises and copies bytes
/// into the plugin's owned arenas before returning a v1 [`Diagnostic`].
#[derive(Deserialize)]
struct BridgeDiagnostic {
    plugin_id: String,
    rule_id: String,
    severity: String,
    message: String,
    path: String,
    line: u32,
    column: u32,
}

/// Per-host-invocation collector used to ferry diagnostics from the
/// JS side into the bridge cdylib's plugin-static return path.
#[derive(Default)]
struct Collector {
    pending: Vec<BridgeDiagnostic>,
}

/// Plugin-side arena holding the owned bytes a [`Diagnostic`]
/// references via [`BytesRef`]. The arena is rebuilt on each call to
/// `evaluate()`; the previous batch's pointers are valid only until
/// the next invocation, matching the v1 contract: "Buffer ownership
/// is plugin-side; the host copies before the next invocation."
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

/// Op the bridge TS runtime calls to deliver one diagnostic to the
/// Rust side. Receives a JSON string that deserialises into
/// [`BridgeDiagnostic`].
#[op2(fast)]
fn op_emit_diagnostic(state: &mut OpState, #[string] json: &str) {
    let collector = state.borrow_mut::<Rc<RefCell<Collector>>>();
    if let Ok(d) = serde_json::from_str::<BridgeDiagnostic>(json) {
        collector.borrow_mut().pending.push(d);
    }
}

extension!(
    bridge_ext,
    ops = [op_emit_diagnostic],
    options = { collector: Rc<RefCell<Collector>> },
    state = |state, options| {
        state.put(options.collector);
    },
);

/// Plugin-global state. Lazily initialised in `init`, reused across
/// `evaluate` calls. V8 isolates are thread-bound; the host that
/// drives `evaluate` MUST always do so from the same thread that
/// invoked `init`. The current viola-cli host honours this.
struct BridgeState {
    runtime: JsRuntime,
    collector: Rc<RefCell<Collector>>,
    arena: Arena,
    tokio: tokio::runtime::Runtime,
    /// Transpiled JS form of [`BRIDGE_RUNTIME_TS`]. Computed once on
    /// init; reused on every `evaluate()` call.
    bridge_js: String,
}

// SAFETY: BridgeState is accessed only from the thread that
// constructed it. The Mutex enforces interior aliasing rules; the
// thread-binding is a separate contract documented above. We never
// share BRIDGE_STATE across threads in viola-cli's single-threaded
// host. A multi-threaded host would need a worker-thread pinning
// pattern instead.
unsafe impl Send for BridgeState {}

static BRIDGE_STATE: Mutex<Option<BridgeState>> = Mutex::new(None);

fn build_state() -> Result<BridgeState, ()> {
    let tokio = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| ())?;
    let collector: Rc<RefCell<Collector>> = Rc::new(RefCell::new(Collector::default()));
    let runtime = JsRuntime::new(RuntimeOptions {
        extensions: vec![bridge_ext::init(collector.clone())],
        ..Default::default()
    });
    let bridge_js = transpile_ts("bridge_runtime.ts", BRIDGE_RUNTIME_TS)?;
    Ok(BridgeState {
        runtime,
        collector,
        arena: Arena::default(),
        tokio,
        bridge_js,
    })
}

/// Lint role entrypoint.
///
/// # Safety / contract
///
/// - The host MUST invoke this from the same OS thread that called
///   `init_fn`. V8 isolates are thread-bound and the embedded
///   `JsRuntime` is `!Send`; the `unsafe impl Send` on `BridgeState`
///   is justified solely by this thread-pinning contract. A
///   multi-threaded host that violates the contract will silently
///   corrupt V8 state. (viola-cli's current single-threaded loop
///   honours the contract.)
/// - Per the v1 plugin ABI: bytes referenced by [`BytesRef`] in the
///   returned [`DiagnosticBatch`] are plugin-owned and remain valid
///   until the next call to this function. The host MUST copy any
///   bytes it intends to retain past that point. The bridge clears
///   its arena at the start of each invocation, freeing the
///   previous batch's backing storage; hosts that hold raw `BytesRef`
///   pointers across an `evaluate` boundary without copying will read
///   freed memory. (viola-cli today calls each lint exactly once per
///   run and reads diagnostics before plugin shutdown, so the
///   constraint is satisfied; deep-copying in `CaptureSink` is a
///   tracked follow-up host hardening.)
unsafe extern "C" fn evaluate(
    _host_ctx: *mut c_void,
    _nam: *const NamPayload,
    _lint_config_bytes: *const u8,
    _lint_config_len: arvo::USize,
    out_batch: *mut DiagnosticBatch,
) -> AbiStatus {
    if out_batch.is_null() {
        return ExtensionAbiStatus::InvalidArg;
    }
    let mut guard = match BRIDGE_STATE.lock() {
        Ok(g) => g,
        Err(_) => return ExtensionAbiStatus::InitFailed,
    };
    let state = match guard.as_mut() {
        Some(s) => s,
        None => return ExtensionAbiStatus::InitFailed,
    };

    state.collector.borrow_mut().pending.clear();
    state.arena.clear();

    let bridge_js = state.bridge_js.clone();
    state.tokio.block_on(async {
        match state.runtime.execute_script("bridge_runtime.ts", bridge_js) {
            Ok(_) => {}
            Err(e) => {
                eprintln!("viola-bridge-deno: script error: {e}");
            }
        }
    });

    let pending: Vec<BridgeDiagnostic> =
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
    // contract requires us to populate exactly once per call. The
    // pointer plus length describe a slice of plugin-owned memory
    // that remains valid until the next `evaluate` invocation, per
    // the v1 contract.
    unsafe {
        *out_batch = DiagnosticBatch {
            entries: entries_ptr,
            len: arvo::USize(entries_len),
        };
    }
    ExtensionAbiStatus::Ok
}

static LINT_EVAL_VTABLE: LintEvaluateVtable = LintEvaluateVtable { evaluate };

pub struct LintEvalCap;

impl CapabilityExport for LintEvalCap {
    const ID: CapabilityId = CAP_LINT_EVALUATE;
    const VTABLE_PTR: *const c_void =
        &LINT_EVAL_VTABLE as *const _ as *const c_void;
}

pub struct InitImpl;

impl InitHandler for InitImpl {
    unsafe fn init(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        match build_state() {
            Ok(s) => {
                let mut guard = match BRIDGE_STATE.lock() {
                    Ok(g) => g,
                    Err(_) => return ExtensionAbiStatus::InitFailed,
                };
                *guard = Some(s);
                ExtensionAbiStatus::Ok
            }
            Err(()) => ExtensionAbiStatus::InitFailed,
        }
    }
}

pub struct ShutdownImpl;

impl ShutdownHandler for ShutdownImpl {
    unsafe fn shutdown(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        if let Ok(mut guard) = BRIDGE_STATE.lock() {
            *guard = None;
        }
        ExtensionAbiStatus::Ok
    }
}

#[export_extension(
    name = "org.viola.bridge.deno",
    version = "0.1.0",
    capabilities = [LintEvalCap],
    init = InitImpl,
    shutdown = ShutdownImpl,
)]
#[allow(dead_code)]
pub struct BridgeExtension;
