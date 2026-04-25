//! `#[repr(C)]` vtable shapes behind each well-known capability id.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §7.3, role invocations are direct
//! in-process calls via the v1 function table. A
//! [`crate::CapabilityEntry::vtable_ptr`] is a thin extension-owned
//! pointer; the layout behind that pointer is specific to the
//! capability id. This module pins the layout for the three v1
//! capability ids:
//!
//! - [`crate::CAP_RUNNER_EXECUTE_SCOPE`] -> [`RunnerExecuteScopeVtable`]
//! - [`crate::CAP_GRAMMAR_EXTRACT`] -> [`GrammarExtractVtable`]
//! - [`crate::CAP_LINT_EVALUATE`] -> [`LintEvaluateVtable`]
//!
//! The vtable shapes are append-only within an ABI major. Adding a new
//! function pointer to a vtable would silently change the layout for
//! existing plugins; instead, register a NEW capability id (e.g.
//! `viola.lint.evaluate.v2`) and ship a parallel vtable.
//!
//! # Argument and result conventions
//!
//! All entry points are `unsafe extern "C"` and take a host context
//! pointer plus capability-specific arguments. Outputs are written
//! into out-parameters where lifetime requires plugin ownership; this
//! avoids forcing the caller to free pointers it did not allocate.
//!
//! - `host_ctx`: opaque host pointer. Same one threaded through
//!   `init_fn`. Plugin MUST NOT free.
//! - `out_*`: plugin populates an out-parameter pointing into
//!   plugin-owned static memory; the host reads, then drops the
//!   reference before the next call. The plugin MUST keep its buffer
//!   stable until the next call to the same vtable entry on the same
//!   plugin instance, after which it MAY recycle.
//! - Return value: [`crate::AbiStatus`]. Non-`Ok` means the
//!   out-parameters are unspecified; the host treats the call as
//!   failed and consults
//!   [`crate::PluginError::InvocationFailed`].

use core::ffi::c_void;

use crate::config::RunSurface;
use crate::diagnostic::DiagnosticBatch;
use crate::error::AbiStatus;
use crate::nam::NamPayload;

/// Workspace-relative file entry the host hands to runners and
/// grammars.
///
/// `path` is workspace-relative per NAM §9.3 invariants. `language` is
/// a host-assigned language tag (`"typescript"`, `"rust"`, ...);
/// plugins inspect it to dispatch language-specific code paths.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct FileEntry {
    pub path: crate::bytes_ref::BytesRef,
    pub language: crate::bytes_ref::BytesRef,
    /// SHA-256 of the file contents, hex-encoded UTF-8 with `sha256:`
    /// prefix per NAM §9.3 example. Empty when the host has not
    /// hashed the file.
    pub hash: crate::bytes_ref::BytesRef,
    pub size_bytes: u64,
}

// SAFETY: pointers reference host-owned memory stable for the
// invocation's duration. Plugin reads only.
unsafe impl Send for FileEntry {}
unsafe impl Sync for FileEntry {}

/// Run-scope input the host passes to the runner.
///
/// `files` is the resolved file list after include/exclude scope
/// filtering. `surface` mirrors NAM's `run_context.surface`.
/// `workspace_root` is the absolute path the runner uses to make
/// relative paths absolute when invoking grammars.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RunScope {
    pub workspace_root: crate::bytes_ref::BytesRef,
    pub files: *const FileEntry,
    pub files_len: usize,
    pub surface: RunSurface,
    /// Non-zero when the run is a CI invocation. Maps to NAM
    /// `run_context.ci`.
    pub ci: u8,
    pub _reserved: [u8; 3],
}

// SAFETY: host owns memory; runner reads only.
unsafe impl Send for RunScope {}
unsafe impl Sync for RunScope {}

/// Vtable behind `viola.runner.execute_scope.v1`.
///
/// Runner reads the scope, coordinates configured grammar plugins,
/// and produces a single NAM snapshot for the run. The output NAM
/// payload pointer is plugin-owned and stable until the next
/// invocation of `execute_scope` on the same plugin instance.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RunnerExecuteScopeVtable {
    pub execute_scope: unsafe extern "C" fn(
        host_ctx: *mut c_void,
        scope: *const RunScope,
        out_nam: *mut NamPayload,
    ) -> AbiStatus,
}

// SAFETY: function pointers are plugin-owned static.
unsafe impl Send for RunnerExecuteScopeVtable {}
unsafe impl Sync for RunnerExecuteScopeVtable {}

/// Vtable behind `viola.grammar.extract.v1`.
///
/// Grammar receives one document and emits a NAM-shape contribution
/// for it (typically the runner aggregates contributions from
/// multiple grammars into the final NAM). The contribution payload's
/// schema is the same NAM major the runner declares in its
/// descriptor; sub-shapes are documented in NAM §9.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GrammarExtractVtable {
    pub extract: unsafe extern "C" fn(
        host_ctx: *mut c_void,
        file: *const FileEntry,
        source_bytes: *const u8,
        source_len: usize,
        out_contribution: *mut NamPayload,
    ) -> AbiStatus,
}

// SAFETY: see RunnerExecuteScopeVtable.
unsafe impl Send for GrammarExtractVtable {}
unsafe impl Sync for GrammarExtractVtable {}

/// Vtable behind `viola.lint.evaluate.v1`.
///
/// Lint consumes a NAM snapshot plus its lint-specific config bytes
/// and emits a deterministic-keyed [`DiagnosticBatch`]. Determinism is
/// per `docs/PLUGIN-ABI-V1-DESIGN.md` §10: the host sorts entries by
/// `(path, start_line, start_col, plugin_id, rule_id)` after the call,
/// so lints MAY emit in any order.
///
/// `lint_config_bytes` carries the lint's resolved configuration
/// blob in the format declared by the plugin's
/// [`crate::PluginDescriptor::config_schema`]. Empty when the
/// lint has no config.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct LintEvaluateVtable {
    pub evaluate: unsafe extern "C" fn(
        host_ctx: *mut c_void,
        nam: *const NamPayload,
        lint_config_bytes: *const u8,
        lint_config_len: usize,
        out_batch: *mut DiagnosticBatch,
    ) -> AbiStatus,
}

// SAFETY: see RunnerExecuteScopeVtable.
unsafe impl Send for LintEvaluateVtable {}
unsafe impl Sync for LintEvaluateVtable {}
