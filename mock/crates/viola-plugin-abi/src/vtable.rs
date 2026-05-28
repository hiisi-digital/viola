//! `#[repr(C)]` vtable shapes behind each well-known provider id.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §7.3, role invocations are direct
//! in-process calls via the v1 function table. A
//! [`hilavitkutin_extensions::ProviderEntry::vtable_ptr`] is a thin
//! extension-owned pointer; the layout behind that pointer is specific
//! to the provider id. This module pins the layout for the well-known
//! provider ids (runner and grammar at v1, lint at v2):
//!
//! - [`crate::PROVIDER_RUNNER_EXECUTE_SCOPE`] -> [`RunnerExecuteScopeVtable`]
//! - [`crate::PROVIDER_GRAMMAR_EXTRACT`] -> [`GrammarExtractVtable`]
//! - [`crate::PROVIDER_LINT_EVALUATE`] -> [`LintEvaluateVtable`]
//!
//! Vtable shapes are append-only within an ABI major. Adding a new
//! function pointer to a vtable would silently change the layout for
//! existing plugins; instead, register a NEW provider id (e.g.
//! `viola.lint.evaluate.v3`) and ship a parallel vtable. The lint
//! vtable already took this path once: v2 replaced the v1 plugin-owned
//! batch return with a host-owned output buffer.

use core::ffi::c_void;

use crate::diagnostic::Diagnostic;
use crate::nam::NamPayload;
use crate::{AbiStatus, BytesRef, RunSurface};

/// Workspace-relative file entry the host hands to runners and grammars.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct FileEntry {
    pub path: BytesRef,
    pub language: BytesRef,
    /// SHA-256 of the file contents, hex-encoded UTF-8 with `sha256:`
    /// prefix per NAM §9.3 example. Empty when the host has not
    /// hashed the file.
    pub hash: BytesRef,
    /// lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub size_bytes: u64,
}

// SAFETY: pointers reference host-owned memory stable for the
// invocation's duration. Plugin reads only.
unsafe impl Send for FileEntry {}
unsafe impl Sync for FileEntry {}

/// Run-scope input the host passes to the runner.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RunScope {
    pub workspace_root: BytesRef,
    pub files: *const FileEntry,
    pub files_len: arvo::USize,
    pub surface: RunSurface,
    /// Non-zero when the run is a CI invocation. Maps to NAM
    /// `run_context.ci`. lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub ci: u8,
    /// lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub _reserved: [u8; 3],
}

// SAFETY: host owns memory; runner reads only.
unsafe impl Send for RunScope {}
unsafe impl Sync for RunScope {}

/// Vtable behind `viola.runner.execute_scope.v1`.
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
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GrammarExtractVtable {
    pub extract: unsafe extern "C" fn(
        host_ctx: *mut c_void,
        file: *const FileEntry,
        source_bytes: *const u8,
        source_len: arvo::USize,
        out_contribution: *mut NamPayload,
    ) -> AbiStatus,
}

// SAFETY: see RunnerExecuteScopeVtable.
unsafe impl Send for GrammarExtractVtable {}
unsafe impl Sync for GrammarExtractVtable {}

/// Vtable behind `viola.lint.evaluate.v2`.
///
/// The host owns the output buffer. `out_entries` points at a host
/// allocation of `out_capacity` [`Diagnostic`] slots; the plugin
/// writes its findings through it and reports the count via `out_len`.
/// The plugin retains no state across calls, so the host may run many
/// invocations in parallel with separate buffers.
///
/// Overflow contract: the plugin MUST NOT write past `out_capacity`.
/// On success it writes `n <= out_capacity` entries, sets `*out_len`
/// to `n`, and returns [`AbiStatus::Ok`]. When the lint would emit more
/// than `out_capacity` entries it writes the first `out_capacity`, sets
/// `*out_len` to the count it would have emitted, and returns
/// [`AbiStatus::Internal`]; the host reads `*out_len > out_capacity` as
/// the truncation signal.
///
/// Determinism is per `docs/PLUGIN-ABI-V1-DESIGN.md` §10: the host
/// sorts entries by `(path, start_line, start_col, plugin_id, rule_id)`
/// after the call, so lints MAY emit in any order.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct LintEvaluateVtable {
    pub evaluate: unsafe extern "C" fn(
        host_ctx: *mut c_void,
        nam: *const NamPayload,
        lint_config_bytes: *const u8,
        lint_config_len: arvo::USize,
        out_entries: *mut Diagnostic,
        out_capacity: arvo::USize,
        out_len: *mut arvo::USize,
    ) -> AbiStatus,
}

// SAFETY: see RunnerExecuteScopeVtable.
unsafe impl Send for LintEvaluateVtable {}
unsafe impl Sync for LintEvaluateVtable {}
