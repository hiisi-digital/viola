#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Internal fixture cdylib for the viola host loader integration tests.
//!
//! Not published. Exercises the v1 viola plugin shape end-to-end on
//! the hilavitkutin-extensions substrate: a single Lint role exposing
//! `viola.lint.evaluate.v1` plus init / shutdown trampolines.

use core::panic::PanicInfo;

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use hilavitkutin_extensions::{
    CapabilityExport, CapabilityId, ExtensionAbiStatus, InitHandler,
    ShutdownHandler,
};
use hilavitkutin_extensions_macros::export_extension;
use viola_plugin_abi::{
    BytesRef, CAP_LINT_EVALUATE, Diagnostic, DiagnosticBatch,
    DiagnosticSeverity, LintEvaluateVtable, NamPayload, SourceLocation,
    SourceRange,
};

pub static INIT_CALLS: AtomicU32 = AtomicU32::new(0);
pub static SHUTDOWN_CALLS: AtomicU32 = AtomicU32::new(0);
pub static EVALUATE_CALLS: AtomicU32 = AtomicU32::new(0);

const PLUGIN_ID: &[u8] = b"org.viola.lint.fixture";
const RULE_ID: &[u8] = b"fixture-rule-1";
const MESSAGE: &[u8] = b"fixture-emitted diagnostic";
const PATH: &[u8] = b"src/fixture.rs";

static DIAGNOSTIC: Diagnostic = Diagnostic {
    plugin_id: BytesRef {
        data: PLUGIN_ID.as_ptr(),
        len: arvo::USize(PLUGIN_ID.len()),
    },
    rule_id: BytesRef {
        data: RULE_ID.as_ptr(),
        len: arvo::USize(RULE_ID.len()),
    },
    severity: DiagnosticSeverity::Warn,
    message: BytesRef {
        data: MESSAGE.as_ptr(),
        len: arvo::USize(MESSAGE.len()),
    },
    path: BytesRef {
        data: PATH.as_ptr(),
        len: arvo::USize(PATH.len()),
    },
    range: SourceRange {
        start: SourceLocation { line: 1, column: 0 },
        end: SourceLocation { line: 1, column: 10 },
    },
    suggestion: BytesRef::EMPTY,
    metadata_schema: CapabilityId(0),
    metadata_ptr: core::ptr::null(),
    metadata_len: arvo::USize(0),
};

unsafe extern "C" fn evaluate(
    _host_ctx: *mut c_void,
    _nam: *const NamPayload,
    _lint_config_bytes: *const u8,
    _lint_config_len: arvo::USize,
    out_batch: *mut DiagnosticBatch,
) -> viola_plugin_abi::AbiStatus {
    EVALUATE_CALLS.fetch_add(1, Ordering::SeqCst);
    if out_batch.is_null() {
        return ExtensionAbiStatus::InvalidArg;
    }
    // SAFETY: out_batch is a host-owned out-parameter the contract
    // requires the plugin to populate exactly once per call.
    unsafe {
        *out_batch = DiagnosticBatch {
            entries: &DIAGNOSTIC as *const Diagnostic,
            len: arvo::USize(1),
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
        INIT_CALLS.fetch_add(1, Ordering::SeqCst);
        ExtensionAbiStatus::Ok
    }
}

pub struct ShutdownImpl;

impl ShutdownHandler for ShutdownImpl {
    unsafe fn shutdown(
        _host_ctx: *mut c_void,
    ) -> ExtensionAbiStatus {
        SHUTDOWN_CALLS.fetch_add(1, Ordering::SeqCst);
        ExtensionAbiStatus::Ok
    }
}

#[export_extension(
    name = "org.viola.lint.fixture",
    version = "0.1.0",
    capabilities = [LintEvalCap],
    init = InitImpl,
    shutdown = ShutdownImpl,
)]
#[allow(dead_code)]
pub struct FixturePlugin;
