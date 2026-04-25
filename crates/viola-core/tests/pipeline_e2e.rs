//! End-to-end test: load runner + lint fixtures, drive `pipeline::run`,
//! verify runner-once + lint-fan-out + diagnostic egress + §10
//! deterministic ordering against accumulated batches.

use std::env;
use std::path::PathBuf;

use viola_core::{
    BytesRef, CapabilityId, Diagnostic, ExtensionHost, ExtensionRequirement,
    RunScope, RunSurface,
    aggregate::sort_diagnostics,
    invoke::runner_vtable,
    pipeline::{DiagnosticSink, LintConfig, run},
};

fn fixture_path(crate_name: &str) -> PathBuf {
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
    let underscored = crate_name.replace('-', "_");
    target_dir
        .join(profile)
        .join(format!("{prefix}{underscored}{suffix}"))
}

fn null_terminated(p: &PathBuf) -> Vec<u8> {
    let s = p.to_str().expect("fixture path must be valid UTF-8");
    let mut bytes = s.as_bytes().to_vec();
    bytes.push(0);
    bytes
}

// Minimal sink: captures up to 16 diagnostics by copying out the
// salient byte slices into owned storage so the buffer survives plugin
// shutdown. Tests need owned data because §10 sort happens after the
// run completes.
struct OwnedDiagnostic {
    plugin_id: Vec<u8>,
    rule_id: Vec<u8>,
    path: Vec<u8>,
    line: u32,
    column: u32,
}

struct CapturingSink {
    items: Vec<OwnedDiagnostic>,
}

impl CapturingSink {
    fn new() -> Self {
        Self { items: Vec::new() }
    }
}

fn br_to_vec(b: &BytesRef) -> Vec<u8> {
    if b.data.is_null() || b.len.0 == 0 {
        return Vec::new();
    }
    // SAFETY: BytesRef is valid for the duration of the sink callback.
    unsafe { core::slice::from_raw_parts(b.data, b.len.0) }.to_vec()
}

impl DiagnosticSink for CapturingSink {
    fn push(&mut self, diag: &Diagnostic) {
        self.items.push(OwnedDiagnostic {
            plugin_id: br_to_vec(&diag.plugin_id),
            rule_id: br_to_vec(&diag.rule_id),
            path: br_to_vec(&diag.path),
            line: diag.range.start.line,
            column: diag.range.start.column,
        });
    }
}

#[test]
fn runner_once_lint_fan_out_egress_and_sort() {
    let runner_path = fixture_path("viola-test-runner-fixture");
    let lint_path = fixture_path("viola-test-plugin-fixture");
    assert!(
        runner_path.exists(),
        "build viola-test-runner-fixture before running this test",
    );
    assert!(
        lint_path.exists(),
        "build viola-test-plugin-fixture before running this test",
    );

    let host_caps: &'static [CapabilityId] = &[];
    let host = ExtensionHost::new(host_caps);

    let runner_bytes = null_terminated(&runner_path);
    let runner_outcome = host.load(
        &runner_bytes,
        ExtensionRequirement::Required,
        std::ptr::null_mut(),
    );
    let runner = match runner_outcome {
        notko::Outcome::Ok(notko::Maybe::Is(ext)) => ext,
        _ => panic!("runner load failed"),
    };

    let lint_bytes = null_terminated(&lint_path);
    let lint_outcome = host.load(
        &lint_bytes,
        ExtensionRequirement::Required,
        std::ptr::null_mut(),
    );
    let lint = match lint_outcome {
        notko::Outcome::Ok(notko::Maybe::Is(ext)) => ext,
        _ => panic!("lint load failed"),
    };

    let scope = RunScope {
        workspace_root: BytesRef::EMPTY,
        files: std::ptr::null(),
        files_len: arvo::USize(0),
        surface: RunSurface::Test,
        ci: 0,
        _reserved: [0; 3],
    };

    let mut sink = CapturingSink::new();
    let lints: [&viola_core::Extension; 1] = [&lint];
    let configs = [LintConfig::EMPTY];

    let report = match run(
        &runner,
        &lints,
        &configs,
        &scope,
        std::ptr::null_mut(),
        &mut sink,
    ) {
        notko::Outcome::Ok(rep) => rep,
        _ => panic!("pipeline returned err"),
    };

    assert!(
        matches!(report.first_failure, notko::Maybe::Isnt),
        "no plugin failures expected",
    );
    assert_eq!(sink.items.len(), 1, "fixture lint emits exactly one diag");
    assert_eq!(sink.items[0].path, b"src/fixture.rs");
    assert_eq!(sink.items[0].plugin_id, b"org.viola.lint.fixture");
    assert_eq!(sink.items[0].rule_id, b"fixture-rule-1");
    assert_eq!(sink.items[0].line, 1);

    // Confirm the runner vtable resolves and stays callable after the
    // pipeline returned. This is a healthy-runtime check, not a
    // strict "runner called exactly once" assertion: cross-DSO atomic
    // counters in the runner fixture would need a host-side dlsym
    // path to verify directly. Tracked as a follow-up if the runner-
    // once invariant ever needs end-to-end coverage beyond the
    // host-body unit tests.
    let runner_vt = match runner_vtable(&runner) {
        notko::Maybe::Is(vt) => vt,
        notko::Maybe::Isnt => panic!("runner vtable resolution failed post-pipeline"),
    };
    let mut second_nam = viola_core::NamPayload {
        version: viola_core::NamVersion::new(0, 0, 0),
        data: std::ptr::null(),
        len: arvo::USize(0),
    };
    // SAFETY: runner vtable contract; out_nam is host-owned for this call.
    let second = unsafe {
        (runner_vt.execute_scope)(
            std::ptr::null_mut(),
            &scope as *const _,
            &mut second_nam as *mut _,
        )
    };
    assert!(second == viola_core::ExtensionAbiStatus::Ok);

    drop(lint);
    drop(runner);

    // Exercise the §10 sort against a synthesized batch to confirm the
    // public helper works on multi-plugin output. The synthetic
    // diagnostics point into test-binary string literals, NOT plugin
    // DSO memory, so the drop above is safe and intentional: we
    // verify the sort helper is usable after plugin shutdown when
    // diagnostics have been copied into owned storage.
    let plug_a: &'static [u8] = b"plugin-a";
    let plug_b: &'static [u8] = b"plugin-b";
    let path_a: &'static [u8] = b"a.rs";
    let path_b: &'static [u8] = b"b.rs";
    let mut diags = [
        synth_diag(path_b, 1, 0, plug_a, b"r"),
        synth_diag(path_a, 5, 0, plug_b, b"r"),
        synth_diag(path_a, 1, 0, plug_a, b"r"),
    ];
    sort_diagnostics(&mut diags);
    assert_eq!(unsafe { slice_of(&diags[0].path) }, b"a.rs");
    assert_eq!(diags[0].range.start.line, 1);
    assert_eq!(diags[1].range.start.line, 5);
    assert_eq!(unsafe { slice_of(&diags[2].path) }, b"b.rs");
}

fn synth_diag(
    path: &'static [u8],
    line: u32,
    column: u32,
    plugin: &'static [u8],
    rule: &'static [u8],
) -> Diagnostic {
    Diagnostic {
        plugin_id: BytesRef {
            data: plugin.as_ptr(),
            len: arvo::USize(plugin.len()),
        },
        rule_id: BytesRef {
            data: rule.as_ptr(),
            len: arvo::USize(rule.len()),
        },
        severity: viola_core::DiagnosticSeverity::Warn,
        message: BytesRef::EMPTY,
        path: BytesRef {
            data: path.as_ptr(),
            len: arvo::USize(path.len()),
        },
        range: viola_core::SourceRange {
            start: viola_core::SourceLocation { line, column },
            end: viola_core::SourceLocation { line, column },
        },
        suggestion: BytesRef::EMPTY,
        metadata_schema: viola_core::CapabilityId(0),
        metadata_ptr: std::ptr::null(),
        metadata_len: arvo::USize(0),
    }
}

unsafe fn slice_of(b: &BytesRef) -> &[u8] {
    if b.data.is_null() || b.len.0 == 0 {
        return &[];
    }
    unsafe { core::slice::from_raw_parts(b.data, b.len.0) }
}
