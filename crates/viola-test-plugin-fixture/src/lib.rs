//! Internal fixture cdylib for the viola host loader integration tests.
//!
//! This crate is **not published**. Its sole purpose is to give the host
//! loader a real `cdylib` to open via `libloading`, walk a v1
//! `PluginDescriptor` against, lifecycle-cycle, and invoke a capability
//! through the proper `LintEvaluateVtable` shape.
//!
//! It exposes a single role (`Lint`) with a single capability
//! (`viola.lint.evaluate.v1`) so the loader exercises:
//!
//! - descriptor symbol resolution
//! - all six load-time validation paths
//! - init / shutdown handler invocation
//! - vtable casting to `LintEvaluateVtable`
//! - reading a `DiagnosticBatch` back through the wire shape
//!
//! The lint synthesizes one diagnostic per call so the host's
//! deterministic-sort path has something to sort.

use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use viola_plugin_abi::{
    AbiStatus, BytesRef, CapabilityExport, CapabilityId, Diagnostic,
    DiagnosticBatch, DiagnosticSeverity, InitHandler, LintEvaluateVtable,
    NamPayload, ShutdownHandler, SourceLocation, SourceRange,
};
use viola_plugin_abi_macros::export_plugin;

/// Counter that init increments and shutdown decrements; tests assert
/// the host called both handlers exactly once.
pub static INIT_CALLS: AtomicU32 = AtomicU32::new(0);
pub static SHUTDOWN_CALLS: AtomicU32 = AtomicU32::new(0);
pub static EVALUATE_CALLS: AtomicU32 = AtomicU32::new(0);

const PLUGIN_ID: &[u8] = b"org.viola.lint.fixture";
const RULE_ID: &[u8] = b"fixture-rule-1";
const MESSAGE: &[u8] = b"fixture-emitted diagnostic";
const PATH: &[u8] = b"src/fixture.rs";

static DIAGNOSTIC: Diagnostic = Diagnostic {
    plugin_id: BytesRef { data: PLUGIN_ID.as_ptr(), len: PLUGIN_ID.len() },
    rule_id: BytesRef { data: RULE_ID.as_ptr(), len: RULE_ID.len() },
    severity: DiagnosticSeverity::Warn,
    message: BytesRef { data: MESSAGE.as_ptr(), len: MESSAGE.len() },
    path: BytesRef { data: PATH.as_ptr(), len: PATH.len() },
    range: SourceRange {
        start: SourceLocation { line: 1, column: 0 },
        end: SourceLocation { line: 1, column: 10 },
    },
    suggestion: BytesRef::EMPTY,
    metadata_schema: 0,
    metadata_ptr: core::ptr::null(),
    metadata_len: 0,
};

unsafe extern "C" fn evaluate(
    _host_ctx: *mut c_void,
    _nam: *const NamPayload,
    _lint_config_bytes: *const u8,
    _lint_config_len: usize,
    out_batch: *mut DiagnosticBatch,
) -> AbiStatus {
    EVALUATE_CALLS.fetch_add(1, Ordering::SeqCst);
    if out_batch.is_null() {
        return AbiStatus::InvalidArg;
    }
    unsafe {
        *out_batch = DiagnosticBatch {
            entries: &DIAGNOSTIC as *const Diagnostic,
            len: 1,
        };
    }
    AbiStatus::Ok
}

static LINT_EVAL_VTABLE: LintEvaluateVtable = LintEvaluateVtable { evaluate };

pub struct LintEvalCap;

impl CapabilityExport for LintEvalCap {
    const ID: CapabilityId =
        CapabilityId::from_name("viola.lint.evaluate.v1");
    const VTABLE_PTR: *const c_void =
        &LINT_EVAL_VTABLE as *const _ as *const c_void;
}

pub struct InitImpl;

impl InitHandler for InitImpl {
    unsafe extern "C" fn init(_host_ctx: *mut c_void) -> AbiStatus {
        INIT_CALLS.fetch_add(1, Ordering::SeqCst);
        AbiStatus::Ok
    }
}

pub struct ShutdownImpl;

impl ShutdownHandler for ShutdownImpl {
    unsafe extern "C" fn shutdown(_host_ctx: *mut c_void) -> AbiStatus {
        SHUTDOWN_CALLS.fetch_add(1, Ordering::SeqCst);
        AbiStatus::Ok
    }
}

#[export_plugin(
    id = "org.viola.lint.fixture",
    name = "Viola Test Fixture Lint",
    version = "0.1.0",
    manifest_version = "1.0.0",
    roles = [Lint],
    capabilities = [LintEvalCap],
    nam_consumes = "1.0.0",
    config_schema = "schemas/fixture.schema.json",
    init = InitImpl,
    shutdown = ShutdownImpl,
)]
#[allow(dead_code)]
pub struct FixturePlugin;
