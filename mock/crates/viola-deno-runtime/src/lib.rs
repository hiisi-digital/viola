//! `viola-deno-runtime`. Viola plugin that bridges TS lint projects
//! into the v1 plugin ABI by driving a long-lived sibling `deno`
//! worker process. `lint:allow(no-std) -- subprocess host crate; std is
//! the irreducible OS boundary; reason: std::process has no core
//! equivalent; tracked: #197`.
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
//! cap drives the worker.
//!
//! ## Module layout
//!
//! - `error`: typed error enum
//! - `path`: stack-allocated path buffer
//! - `arena`: fixed-cap bump arena for diagnostic payloads
//! - `encoder`: hand-rolled JSON emitter (host -> worker)
//! - `parser`: hand-rolled JSON parser (worker -> host) plus line reader
//! - `worker`: worker state, spawning, and lint invocation
//!
//! The std imports are concentrated in `worker` (subprocess host) and
//! `path` (`&Path` boundary). Each carries a documented `lint:allow`
//! marker tracked under #197.

mod arena;
mod encoder;
mod error;
mod parser;
mod path;
mod worker;

use core::ffi::c_void;
use core::ptr;
use hilavitkutin_extensions::{
    ExtensionAbiStatus, InitHandler, ProviderExport, ProviderId, ShutdownHandler,
};
use hilavitkutin_extensions_macros::export_extension;
use viola_plugin_abi::{
    AbiStatus, FileEntry, GrammarExtractVtable, LintEvaluateVtable, NamPayload, NamVersion,
    PROVIDER_GRAMMAR_EXTRACT, PROVIDER_LINT_EVALUATE, PROVIDER_RUNNER_EXECUTE_SCOPE,
    RunScope, RunnerExecuteScopeVtable,
};
use worker::{lint_evaluate, WORKER_STATE};

pub(crate) const BRIDGE_TS: &str = include_str!("bridge.ts");        // lint:allow(no-bare-static-str) -- include_str! is the only way to embed bridge.ts at compile time. tracked: #197

// ---------------------------------------------------------------------
// Capacities
// ---------------------------------------------------------------------

pub(crate) const ARENA_BYTES: usize = 128 * 1024;
pub(crate) const MAX_DIAGS: usize = 512;
pub(crate) const FRAME_CAP: usize = 64 * 1024;
pub(crate) const LINE_CAP: usize = 8 * 1024;
pub(crate) const PATH_CAP: usize = 4096;
pub(crate) const TEMP_NAME_CAP: usize = 64;
pub(crate) const PLUGIN_ID_CAP: usize = 128;
pub(crate) const RULE_ID_CAP: usize = 128;
pub(crate) const SEVERITY_CAP: usize = 32;
pub(crate) const MESSAGE_CAP: usize = 512;
pub(crate) const SHUTDOWN_DEADLINE_MS: u64 = 2000;

// ---------------------------------------------------------------------
// Runner provider (empty NAM payload at v1)
// ---------------------------------------------------------------------

unsafe extern "C" fn run_execute_scope(
    _host_ctx: *mut c_void,
    _scope: *const RunScope,
    out_nam: *mut NamPayload,
) -> AbiStatus {
    if out_nam.is_null() {
        return ExtensionAbiStatus::InvalidArg;
    }
    // SAFETY: out_nam is a host-owned out parameter the runner contract
    // requires us to populate exactly once per call.
    unsafe {
        *out_nam = NamPayload {
            version: NamVersion::new(1, 0, 0),
            data: ptr::null(),
            len: arvo::USize(0),
        };
    }
    ExtensionAbiStatus::Ok
}

static RUNNER_VTABLE: RunnerExecuteScopeVtable =
    RunnerExecuteScopeVtable { execute_scope: run_execute_scope };

pub struct RunnerProvider;

impl ProviderExport for RunnerProvider {
    const ID: ProviderId = PROVIDER_RUNNER_EXECUTE_SCOPE;
    const VTABLE_PTR: *const c_void = &RUNNER_VTABLE as *const _ as *const c_void;
}

// ---------------------------------------------------------------------
// Grammar provider (empty NAM contribution at v1)
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
    // SAFETY: out_contribution is a host-owned out parameter the grammar
    // contract requires us to populate exactly once per call.
    unsafe {
        *out_contribution = NamPayload {
            version: NamVersion::new(1, 0, 0),
            data: ptr::null(),
            len: arvo::USize(0),
        };
    }
    ExtensionAbiStatus::Ok
}

static GRAMMAR_VTABLE: GrammarExtractVtable =
    GrammarExtractVtable { extract: grammar_extract };

pub struct GrammarProvider;

impl ProviderExport for GrammarProvider {
    const ID: ProviderId = PROVIDER_GRAMMAR_EXTRACT;
    const VTABLE_PTR: *const c_void = &GRAMMAR_VTABLE as *const _ as *const c_void;
}

// ---------------------------------------------------------------------
// Lint provider
// ---------------------------------------------------------------------

static LINT_EVAL_VTABLE: LintEvaluateVtable =
    LintEvaluateVtable { evaluate: lint_evaluate };

pub struct LintEvalProvider;

impl ProviderExport for LintEvalProvider {
    const ID: ProviderId = PROVIDER_LINT_EVALUATE;
    const VTABLE_PTR: *const c_void = &LINT_EVAL_VTABLE as *const _ as *const c_void;
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
    providers = [RunnerProvider, GrammarProvider, LintEvalProvider],
    init = InitImpl,
    shutdown = ShutdownImpl,
)]
#[allow(dead_code)]
pub struct DenoRuntimeExtension;
