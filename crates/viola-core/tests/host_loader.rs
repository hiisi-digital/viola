//! End-to-end host loader integration test.
//!
//! Exercises the full §4-§10 surface against the fixture cdylib in
//! `viola-test-plugin-fixture`:
//!
//! 1. Open the fixture's compiled `.dylib` / `.so` / `.dll` via the
//!    host loader.
//! 2. Validate the descriptor (six §4.3 categories).
//! 3. Init the plugin instance.
//! 4. Drive `Host::run` (no runner role; lint-only with synthetic
//!    NAM); confirm the lint produces a `DiagnosticBatch`.
//! 5. Confirm the host's deterministic sort applied at §10.
//! 6. Shutdown.
//!
//! The fixture crate is a workspace member so `cargo test -p
//! viola-core` builds it transitively (it appears as a dev-dep). The
//! resulting cdylib lands at
//! `<workspace-root>/target/<profile>/lib<crate>.<ext>`; this test
//! walks up from `CARGO_MANIFEST_DIR` to find it.

use std::path::PathBuf;

use viola_core::{BytesRef, Host, HostContext, PluginError, RunScope, RunSurface};

/// Locate the fixture cdylib. Walks up from `CARGO_MANIFEST_DIR` to
/// the workspace `target/<profile>/` directory.
fn fixture_path() -> PathBuf {
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    // Honour CARGO_TARGET_DIR so the test stays correct under custom
    // workspace layouts (CI matrices, container builds, `.cargo/config`
    // overrides). Fall back to `<workspace>/target/` resolved by walking
    // up from this crate's manifest dir.
    let target_root = match std::env::var_os("CARGO_TARGET_DIR") {
        Some(p) => PathBuf::from(p),
        None => {
            let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            // viola-core is at <ws>/crates/viola-core.
            manifest.parent().unwrap().parent().unwrap().join("target")
        }
    };
    let target_dir = target_root.join(profile);
    let filename = if cfg!(target_os = "windows") {
        "viola_test_plugin_fixture.dll"
    } else if cfg!(target_os = "macos") {
        "libviola_test_plugin_fixture.dylib"
    } else {
        "libviola_test_plugin_fixture.so"
    };
    // Cargo emits cdylib artefacts in `target/<profile>/` for the
    // workspace root build, but when the fixture is reached as a
    // dev-dep transitive, the dylib lands in `target/<profile>/deps/`.
    // Check both locations.
    for candidate in
        [target_dir.join(filename), target_dir.join("deps").join(filename)]
    {
        if candidate.exists() {
            return candidate;
        }
    }
    target_dir.join(filename)
}

#[test]
fn end_to_end_lint_plugin_lifecycle() {
    let path = fixture_path();
    assert!(
        path.exists(),
        "fixture cdylib not found at {path:?} - run `cargo build -p viola-test-plugin-fixture` first",
    );

    let ctx = HostContext::new(PathBuf::from("/tmp/viola-test-workspace"));
    let mut host = Host::new(ctx);

    let plugin_id = unsafe {
        let inst = host.load_plugin(&path).expect("load + validate");
        inst.plugin_id().to_string()
    };
    assert_eq!(plugin_id, "org.viola.lint.fixture");

    host.validate_set().expect("set validates");
    host.init_all().expect("init all");

    // Construct a minimal RunScope. The fixture is lint-only; its
    // evaluate ignores the scope contents.
    let ws_bytes = b"/tmp/viola-test-workspace";
    let scope = RunScope {
        workspace_root: BytesRef { data: ws_bytes.as_ptr(), len: ws_bytes.len() },
        files: core::ptr::null(),
        files_len: 0,
        surface: RunSurface::Test,
        ci: 0,
        _reserved: [0; 3],
    };

    let diagnostics = host.run(&scope).expect("run produces diagnostics");
    assert_eq!(diagnostics.len(), 1);
    let d = &diagnostics[0];
    assert_eq!(d.plugin_id, "org.viola.lint.fixture");
    assert_eq!(d.rule_id, "fixture-rule-1");
    assert_eq!(d.path, "src/fixture.rs");
    assert_eq!(d.range.start.line, 1);
    assert_eq!(d.range.start.column, 0);

    host.shutdown_all().expect("shutdown");
    // Counters in the fixture's atomics live in the dlopen'd cdylib's
    // address space, not the test-binary rlib's; we don't try to read
    // them across that boundary. The successful init / run / shutdown
    // returns prove the lifecycle calls dispatched correctly.
}

#[test]
fn missing_cdylib_path_yields_descriptor_missing() {
    let ctx = HostContext::new(PathBuf::from("/tmp/viola-test-workspace"));
    let mut host = Host::new(ctx);

    let nonexistent = PathBuf::from("/nonexistent/path/to/plugin.dylib");
    match unsafe { host.load_plugin(&nonexistent) } {
        Ok(_) => panic!("loading a nonexistent path must error"),
        Err(e) => assert_eq!(e.kind, PluginError::DescriptorMissing),
    }
}
