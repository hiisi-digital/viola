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

// no_std cdylib without panic-unwind still references the EH personality
// fn through the link table; provide an empty stub so the linker resolves.
#[cfg(not(test))]
#[unsafe(no_mangle)]
pub extern "C" fn rust_eh_personality() {}                          // lint:allow(no-duplicate-fn) -- linker contract; rust_eh_personality must exist in every no_std cdylib that does not unwind; reason: the symbol name is fixed by the Rust ABI; tracked: #197

use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use hilavitkutin_extensions::{
    ProviderExport, ProviderId, ExtensionAbiStatus, InitHandler,
    ShutdownHandler,
};
use hilavitkutin_extensions_macros::export_extension;
use viola_plugin_abi::{
    BytesRef, PROVIDER_LINT_EVALUATE, Diagnostic,
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
    metadata_schema: ProviderId(0),
    metadata_ptr: core::ptr::null(),
    metadata_len: arvo::USize(0),
};

unsafe extern "C" fn evaluate(
    _host_ctx: *mut c_void,
    _nam: *const NamPayload,
    _lint_config_bytes: *const u8,
    _lint_config_len: arvo::USize,
    out_entries: *mut Diagnostic,
    out_capacity: arvo::USize,
    out_len: *mut arvo::USize,
) -> viola_plugin_abi::AbiStatus {
    EVALUATE_CALLS.fetch_add(1, Ordering::SeqCst);
    if out_entries.is_null() || out_len.is_null() {
        return ExtensionAbiStatus::InvalidArg;
    }
    // The fixture emits exactly one diagnostic.
    let emit = arvo::USize(1);
    if out_capacity.0 < emit.0 {
        // Overflow: report the would-have-emitted count, write nothing.
        // SAFETY: out_len is non-null (checked above), host-owned.
        unsafe {
            *out_len = emit;
        }
        return ExtensionAbiStatus::Internal;
    }
    // SAFETY: out_entries is non-null with capacity >= 1 (checked), so
    // slot 0 is writable; out_len is non-null. Both are host-owned for
    // the call's duration.
    unsafe {
        *out_entries = DIAGNOSTIC;
        *out_len = emit;
    }
    ExtensionAbiStatus::Ok
}

static LINT_EVAL_VTABLE: LintEvaluateVtable = LintEvaluateVtable { evaluate };

pub struct TestPluginLintEvalProvider;

impl ProviderExport for TestPluginLintEvalProvider {
    const ID: ProviderId = PROVIDER_LINT_EVALUATE;
    const VTABLE_PTR: *const c_void =
        &LINT_EVAL_VTABLE as *const _ as *const c_void;
}

pub struct TestPluginInitImpl;

impl InitHandler for TestPluginInitImpl {
    unsafe fn init(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        INIT_CALLS.fetch_add(1, Ordering::SeqCst);
        ExtensionAbiStatus::Ok
    }
}

pub struct TestPluginShutdownImpl;

impl ShutdownHandler for TestPluginShutdownImpl {
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
    providers = [TestPluginLintEvalProvider],
    init = TestPluginInitImpl,
    shutdown = TestPluginShutdownImpl,
)]
#[allow(dead_code)]
pub struct FixturePlugin;
