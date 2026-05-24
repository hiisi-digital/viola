#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Internal fixture cdylib exposing PROVIDER_RUNNER_EXECUTE_SCOPE.
//!
//! Produces an empty NAM with `model_version = 1.0.0`. Pairs with
//! `viola-test-plugin-fixture` (Lint role) under
//! `viola-core::tests::pipeline_e2e` to exercise the runner-once +
//! lint-fan-out path end-to-end.

use core::ffi::c_void;
use core::panic::PanicInfo;
use core::sync::atomic::{AtomicU32, Ordering};

use hilavitkutin_extensions::{
    ProviderExport, ProviderId, ExtensionAbiStatus, InitHandler,
    ShutdownHandler,
};
use hilavitkutin_extensions_macros::export_extension;
use viola_plugin_abi::{
    AbiStatus, PROVIDER_RUNNER_EXECUTE_SCOPE, NamPayload, NamVersion, RunScope,
    RunnerExecuteScopeVtable,
};

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[cfg(not(test))]
#[unsafe(no_mangle)]
pub extern "C" fn rust_eh_personality() {}                          // lint:allow(no-duplicate-fn) -- linker contract; rust_eh_personality must exist in every no_std cdylib that does not unwind; reason: the symbol name is fixed by the Rust ABI; tracked: #197

pub static INIT_CALLS: AtomicU32 = AtomicU32::new(0);
pub static SHUTDOWN_CALLS: AtomicU32 = AtomicU32::new(0);
pub static EXECUTE_CALLS: AtomicU32 = AtomicU32::new(0);

unsafe extern "C" fn execute_scope(
    _host_ctx: *mut c_void,
    _scope: *const RunScope,
    out_nam: *mut NamPayload,
) -> AbiStatus {
    EXECUTE_CALLS.fetch_add(1, Ordering::SeqCst);
    if out_nam.is_null() {
        return ExtensionAbiStatus::InvalidArg;
    }
    // SAFETY: out_nam is a host-owned out-parameter the contract
    // requires the runner to populate exactly once per call.
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
    RunnerExecuteScopeVtable { execute_scope };

pub struct TestRunnerProvider;

impl ProviderExport for TestRunnerProvider {
    const ID: ProviderId = PROVIDER_RUNNER_EXECUTE_SCOPE;
    const VTABLE_PTR: *const c_void =
        &RUNNER_VTABLE as *const _ as *const c_void;
}

pub struct TestRunnerInitImpl;

impl InitHandler for TestRunnerInitImpl {
    unsafe fn init(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        INIT_CALLS.fetch_add(1, Ordering::SeqCst);
        ExtensionAbiStatus::Ok
    }
}

pub struct TestRunnerShutdownImpl;

impl ShutdownHandler for TestRunnerShutdownImpl {
    unsafe fn shutdown(_host_ctx: *mut c_void) -> ExtensionAbiStatus {
        SHUTDOWN_CALLS.fetch_add(1, Ordering::SeqCst);
        ExtensionAbiStatus::Ok
    }
}

#[export_extension(
    name = "org.viola.runner.fixture",
    version = "0.1.0",
    providers = [TestRunnerProvider],
    init = TestRunnerInitImpl,
    shutdown = TestRunnerShutdownImpl,
)]
#[allow(dead_code)]
pub struct RunnerFixture;
