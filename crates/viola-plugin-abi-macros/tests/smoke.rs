//! End-to-end smoke test for `#[export_plugin]`.
//!
//! Exercises the macro on a minimal plugin shape: confirms the
//! emitted descriptor static and the exported `__viola_plugin_descriptor`
//! function compose correctly with `viola-plugin-abi`'s contract types
//! and that the descriptor's static fields read back as expected.

use core::ffi::c_void;
use viola_plugin_abi::{
    AbiStatus, CapabilityExport, CapabilityId, HOST_ABI_MAJOR, InitHandler,
    Role, ShutdownHandler,
};
use viola_plugin_abi_macros::export_plugin;

struct LintEvalVtable {
    _evaluate: unsafe extern "C" fn() -> AbiStatus,
}

unsafe extern "C" fn dummy_evaluate() -> AbiStatus {
    AbiStatus::Ok
}

static LINT_EVAL_VTABLE: LintEvalVtable = LintEvalVtable {
    _evaluate: dummy_evaluate,
};

struct LintEvalCap;

impl CapabilityExport for LintEvalCap {
    const ID: CapabilityId =
        CapabilityId::from_name("viola.lint.evaluate.v1");
    const VTABLE_PTR: *const c_void =
        &LINT_EVAL_VTABLE as *const _ as *const c_void;
}

struct InitImpl;

impl InitHandler for InitImpl {
    unsafe extern "C" fn init(_host_ctx: *mut c_void) -> AbiStatus {
        AbiStatus::Ok
    }
}

struct ShutdownImpl;

impl ShutdownHandler for ShutdownImpl {
    unsafe extern "C" fn shutdown(_host_ctx: *mut c_void) -> AbiStatus {
        AbiStatus::Ok
    }
}

#[export_plugin(
    id = "org.viola.lint.smoke",
    name = "Smoke Lint",
    version = "0.1.0",
    manifest_version = "1.0.0",
    roles = [Lint],
    capabilities = [LintEvalCap],
    nam_consumes = "1.0.0",
    config_schema = "schemas/smoke.schema.json",
    init = InitImpl,
    shutdown = ShutdownImpl,
)]
#[allow(dead_code)]
struct SmokePlugin;

#[test]
fn descriptor_round_trip() {
    let ptr = __viola_plugin_descriptor();
    assert!(!ptr.is_null());
    let d = unsafe { &*ptr };

    assert_eq!(d.abi_version, HOST_ABI_MAJOR);
    assert_eq!(d.manifest_version.0.major, 1);
    assert_eq!(d.identity.plugin_version.0.major, 0);
    assert_eq!(d.identity.plugin_version.0.minor, 1);

    // Identity strings.
    let id_bytes = unsafe {
        core::slice::from_raw_parts(
            d.identity.plugin_id.data,
            d.identity.plugin_id.len,
        )
    };
    assert_eq!(id_bytes, b"org.viola.lint.smoke");

    let name_bytes = unsafe {
        core::slice::from_raw_parts(
            d.identity.display_name.data,
            d.identity.display_name.len,
        )
    };
    assert_eq!(name_bytes, b"Smoke Lint");

    // Roles: Lint only.
    assert!(d.roles.contains(Role::Lint));
    assert!(!d.roles.contains(Role::Runner));
    assert!(!d.roles.contains(Role::Grammar));

    // Single capability with the right id.
    assert_eq!(d.capabilities_len, 1);
    let caps = unsafe {
        core::slice::from_raw_parts(d.capabilities_ptr, d.capabilities_len)
    };
    assert_eq!(caps[0].id.0, LintEvalCap::ID.0);

    // NAM consumes 1.0.0; produces 0.0.0.
    assert_eq!(d.nam_consumes.0.major, 1);
    assert_eq!(d.nam_produces.0.major, 0);

    // Config schema string.
    let cfg = unsafe {
        core::slice::from_raw_parts(
            d.config_schema.data,
            d.config_schema.len,
        )
    };
    assert_eq!(cfg, b"schemas/smoke.schema.json");

    // Lifecycle slots populated.
    assert!(d.init_fn.is_some());
    assert!(d.shutdown_fn.is_some());

    // Required host caps empty.
    assert_eq!(d.required_host_caps_len, 0);
}
