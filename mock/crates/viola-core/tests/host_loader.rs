//! Integration test: load the viola-test-plugin-fixture cdylib through
//! the viola-core host surface and verify role classification + typed
//! vtable resolution + direct lint evaluation drive the fixture's
//! atomic counters.
//!
//! End-to-end pipeline orchestration with a runner fixture lands with
//! #220 (rust-native plugin) once a PROVIDER_RUNNER_EXECUTE_SCOPE-exporting
//! cdylib exists.

use std::env;
use std::path::PathBuf;

use hilavitkutin_extensions::ExtensionHost;
use viola_core::{
    PROVIDER_LINT_EVALUATE, Diagnostic, ExtensionAbiStatus,
    ExtensionRequirement, NamPayload, NamVersion, default_policy,
    invoke::lint_vtable,
    role::{is_lint, is_runner, roles_of, Role},
};

fn fixture_path() -> PathBuf {
    let target_dir = env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("target"))
                .expect("CARGO_MANIFEST_DIR has parent/parent")
        });

    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    let prefix = if cfg!(target_os = "windows") { "" } else { "lib" };
    let suffix = if cfg!(target_os = "macos") {
        ".dylib"
    } else if cfg!(target_os = "windows") {
        ".dll"
    } else {
        ".so"
    };
    target_dir
        .join(profile)
        .join(format!("{prefix}viola_test_plugin_fixture{suffix}"))
}

#[test]
fn fixture_loads_classifies_and_evaluates() {
    let path = fixture_path();
    assert!(
        path.exists(),
        "fixture cdylib missing at {}; run `cargo build -p viola-test-plugin-fixture` first",
        path.display(),
    );

    let host_caps: &'static [viola_core::ProviderId] = &[];
    let host = ExtensionHost::new(host_caps).with_policy(default_policy);

    let path_str = path
        .to_str()
        .expect("test fixture path must be valid UTF-8");
    let mut path_bytes: Vec<u8> = path_str.as_bytes().to_vec();
    path_bytes.push(0); // null-terminate; hilavitkutin-linking expects c-string
    let outcome = host.load(
        &path_bytes,
        ExtensionRequirement::Required,
        std::ptr::null_mut(),
    );

    let ext = match outcome {
        notko::Outcome::Ok(notko::Maybe::Is(ext)) => ext,
        notko::Outcome::Ok(notko::Maybe::Isnt) => panic!("optional load returned no extension"),
        notko::Outcome::Err(_) => panic!("load failed"),
    };

    assert!(is_lint(&ext), "fixture must classify as Lint");
    assert!(!is_runner(&ext), "fixture must not classify as Runner");
    let roles = roles_of(&ext);
    assert!(roles.contains(Role::Lint));
    assert!(!roles.contains(Role::Runner));
    assert!(!roles.contains(Role::Grammar));
    assert_eq!(
        ext.providers().len(),
        1,
        "fixture exports exactly one provider",
    );
    assert!(ext.providers()[0].id == PROVIDER_LINT_EVALUATE);

    let vt = match lint_vtable(&ext) {
        notko::Maybe::Is(vt) => vt,
        notko::Maybe::Isnt => panic!("lint vtable resolution failed"),
    };

    let nam = NamPayload {
        version: NamVersion::new(1, 0, 0),
        data: std::ptr::null(),
        len: arvo::USize(0),
    };
    let mut out_buf = [core::mem::MaybeUninit::<Diagnostic>::uninit(); 8];
    let mut out_len = arvo::USize(0);

    // SAFETY: vt.evaluate honours the v2 contract; nam + out_buf live
    // for the call's duration through host-owned stack storage.
    let status = unsafe {
        (vt.evaluate)(
            std::ptr::null_mut(),
            &nam as *const _,
            std::ptr::null(),
            arvo::USize(0),
            out_buf.as_mut_ptr() as *mut Diagnostic,
            arvo::USize(8),
            &mut out_len as *mut _,
        )
    };
    assert!(status == ExtensionAbiStatus::Ok);
    assert_eq!(out_len.0, 1, "fixture emits exactly one diagnostic");

    // SAFETY: the fixture wrote out_len entries into out_buf, so slot 0
    // is initialised. Its path BytesRef points at fixture-static memory
    // while ext is alive; we read those bytes for sanity.
    let first = unsafe { out_buf[0].assume_init() };
    let path_slice = unsafe {
        core::slice::from_raw_parts(first.path.data, first.path.len.0)
    };
    assert_eq!(path_slice, b"src/fixture.rs");

    // Drop drives shutdown_fn; library unloads.
    drop(ext);
}

#[test]
fn fixture_overflow_reports_internal() {
    let path = fixture_path();
    assert!(
        path.exists(),
        "fixture cdylib missing at {}; run `cargo build -p viola-test-plugin-fixture` first",
        path.display(),
    );

    let host_caps: &'static [viola_core::ProviderId] = &[];
    let host = ExtensionHost::new(host_caps).with_policy(default_policy);

    let path_str = path
        .to_str()
        .expect("test fixture path must be valid UTF-8");
    let mut path_bytes: Vec<u8> = path_str.as_bytes().to_vec();
    path_bytes.push(0); // null-terminate; hilavitkutin-linking expects c-string
    let outcome = host.load(
        &path_bytes,
        ExtensionRequirement::Required,
        std::ptr::null_mut(),
    );

    let ext = match outcome {
        notko::Outcome::Ok(notko::Maybe::Is(ext)) => ext,
        notko::Outcome::Ok(notko::Maybe::Isnt) => panic!("optional load returned no extension"),
        notko::Outcome::Err(_) => panic!("load failed"),
    };

    let vt = match lint_vtable(&ext) {
        notko::Maybe::Is(vt) => vt,
        notko::Maybe::Isnt => panic!("lint vtable resolution failed"),
    };

    let nam = NamPayload {
        version: NamVersion::new(1, 0, 0),
        data: std::ptr::null(),
        len: arvo::USize(0),
    };
    // out_capacity of zero forces the v2 overflow path: the fixture emits
    // one diagnostic, which exceeds capacity, so it must write nothing,
    // set out_len to the would-have-emitted count, and return Internal.
    let mut out_buf = [core::mem::MaybeUninit::<Diagnostic>::uninit(); 1];
    let mut out_len = arvo::USize(0);

    // SAFETY: vt.evaluate honours the v2 contract; with out_capacity 0 it
    // writes nothing and only sets out_len. nam + out_buf live for the
    // call's duration through host-owned stack storage.
    let status = unsafe {
        (vt.evaluate)(
            std::ptr::null_mut(),
            &nam as *const _,
            std::ptr::null(),
            arvo::USize(0),
            out_buf.as_mut_ptr() as *mut Diagnostic,
            arvo::USize(0),
            &mut out_len as *mut _,
        )
    };
    assert!(
        status == ExtensionAbiStatus::Internal,
        "overflow must return Internal",
    );
    assert_eq!(
        out_len.0, 1,
        "overflow must report the would-have-emitted count",
    );

    drop(ext);
}
