//! Capability vtable lookup and dispatch.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §7.3, role invocations are direct
//! in-process calls through the v1 function table. Each
//! [`viola_plugin_abi::CapabilityEntry`] in the descriptor pairs a
//! [`viola_plugin_abi::CapabilityId`] with an opaque
//! `vtable_ptr: *const c_void`. The host casts that pointer to the
//! correct `#[repr(C)]` vtable struct based on the id, then calls the
//! function pointer with `host_ctx` plus capability-specific arguments.
//!
//! v1 capability ids → vtable shapes:
//!
//! - [`CAP_RUNNER_EXECUTE_SCOPE`] → [`RunnerExecuteScopeVtable`]
//! - [`CAP_GRAMMAR_EXTRACT`] → [`GrammarExtractVtable`]
//! - [`CAP_LINT_EVALUATE`] → [`LintEvaluateVtable`]

use core::ffi::c_void;

use viola_plugin_abi::{
    AbiStatus, CAP_GRAMMAR_EXTRACT, CAP_LINT_EVALUATE,
    CAP_RUNNER_EXECUTE_SCOPE, CapabilityEntry, CapabilityId,
    DiagnosticBatch, FileEntry, GrammarExtractVtable, LintEvaluateVtable,
    NamPayload, PluginDescriptor, PluginError, RunScope,
    RunnerExecuteScopeVtable,
};

use crate::error::{HostError, Result};

/// Lookup a capability entry by id in a descriptor.
pub fn find_capability(
    desc: &PluginDescriptor,
    id: CapabilityId,
) -> Option<&CapabilityEntry> {
    if desc.capabilities_ptr.is_null() || desc.capabilities_len == 0 {
        return None;
    }
    // SAFETY: ptr verified non-null and len verified non-zero above.
    // The descriptor contract pins this slice to plugin-owned static
    // memory stable for the library's loaded lifetime; the host reads
    // only.
    let entries = unsafe {
        core::slice::from_raw_parts(
            desc.capabilities_ptr,
            desc.capabilities_len,
        )
    };
    entries.iter().find(|e| e.id.0 == id.0)
}

/// Invoke `viola.runner.execute_scope.v1` on a plugin that declares it.
///
/// # Safety
///
/// `host_ctx` MUST point at a [`crate::HostContext`] (or a future
/// host-context shape compatible with this ABI major). `scope`'s
/// embedded pointers MUST reference host-owned memory stable for the
/// call's duration. `out_nam` is populated by the plugin on `Ok`;
/// callers MUST treat its embedded pointers as plugin-owned, stable
/// only until the next call into the same plugin instance.
pub unsafe fn invoke_runner(
    desc: &PluginDescriptor,
    host_ctx: *mut c_void,
    scope: &RunScope,
    plugin_id: &str,
    path: &std::path::Path,
) -> Result<NamPayload> {
    let entry = find_capability(desc, CAP_RUNNER_EXECUTE_SCOPE).ok_or_else(
        || {
            HostError::from_descriptor(
                PluginError::RoleCapabilityMissing,
                plugin_id,
                path,
                "runner capability not found in capability table",
            )
        },
    )?;
    let vtable: &RunnerExecuteScopeVtable =
        unsafe { &*(entry.vtable_ptr as *const RunnerExecuteScopeVtable) };

    let mut out = NamPayload {
        version: viola_plugin_abi::NamVersion(
            viola_plugin_abi::VersionTriple::new(0, 0, 0),
        ),
        data: core::ptr::null(),
        len: 0,
    };
    let status = unsafe {
        (vtable.execute_scope)(host_ctx, scope as *const _, &mut out as *mut _)
    };
    status_to_result(status, plugin_id, path, "runner execute_scope failed")?;
    Ok(out)
}

/// Invoke `viola.grammar.extract.v1` on a plugin that declares it.
///
/// # Safety
///
/// See [`invoke_runner`]. `source_bytes` MUST be a valid `(ptr, len)`
/// pair into host-owned source memory.
pub unsafe fn invoke_grammar(
    desc: &PluginDescriptor,
    host_ctx: *mut c_void,
    file: &FileEntry,
    source: &[u8],
    plugin_id: &str,
    path: &std::path::Path,
) -> Result<NamPayload> {
    let entry = find_capability(desc, CAP_GRAMMAR_EXTRACT).ok_or_else(|| {
        HostError::from_descriptor(
            PluginError::RoleCapabilityMissing,
            plugin_id,
            path,
            "grammar capability not found in capability table",
        )
    })?;
    let vtable: &GrammarExtractVtable =
        unsafe { &*(entry.vtable_ptr as *const GrammarExtractVtable) };

    let mut out = NamPayload {
        version: viola_plugin_abi::NamVersion(
            viola_plugin_abi::VersionTriple::new(0, 0, 0),
        ),
        data: core::ptr::null(),
        len: 0,
    };
    let status = unsafe {
        (vtable.extract)(
            host_ctx,
            file as *const _,
            source.as_ptr(),
            source.len(),
            &mut out as *mut _,
        )
    };
    status_to_result(status, plugin_id, path, "grammar extract failed")?;
    Ok(out)
}

/// Invoke `viola.lint.evaluate.v1` on a plugin that declares it.
///
/// # Safety
///
/// See [`invoke_runner`]. `nam` MUST point at a NAM payload produced
/// by an earlier runner invocation in this run.
pub unsafe fn invoke_lint(
    desc: &PluginDescriptor,
    host_ctx: *mut c_void,
    nam: *const NamPayload,
    lint_config: &[u8],
    plugin_id: &str,
    path: &std::path::Path,
) -> Result<DiagnosticBatch> {
    let entry = find_capability(desc, CAP_LINT_EVALUATE).ok_or_else(|| {
        HostError::from_descriptor(
            PluginError::RoleCapabilityMissing,
            plugin_id,
            path,
            "lint capability not found in capability table",
        )
    })?;
    let vtable: &LintEvaluateVtable =
        unsafe { &*(entry.vtable_ptr as *const LintEvaluateVtable) };

    let mut out =
        DiagnosticBatch { entries: core::ptr::null(), len: 0 };
    let status = unsafe {
        (vtable.evaluate)(
            host_ctx,
            nam,
            lint_config.as_ptr(),
            lint_config.len(),
            &mut out as *mut _,
        )
    };
    status_to_result(status, plugin_id, path, "lint evaluate failed")?;
    Ok(out)
}

fn status_to_result(
    status: AbiStatus,
    plugin_id: &str,
    path: &std::path::Path,
    op: &str,
) -> Result<()> {
    if status.is_ok() {
        return Ok(());
    }
    let msg = format!("{op} (status: {})", abi_status_label(status));
    let mut err = HostError::from_descriptor(
        PluginError::InvocationFailed,
        plugin_id,
        path,
        msg,
    );
    if matches!(status, AbiStatus::Transient) {
        err = err.retryable();
    }
    Err(err)
}

fn abi_status_label(s: AbiStatus) -> &'static str {
    match s {
        AbiStatus::Ok => "Ok",
        AbiStatus::InitFailed => "InitFailed",
        AbiStatus::InvalidArg => "InvalidArg",
        AbiStatus::NotSupported => "NotSupported",
        AbiStatus::Internal => "Internal",
        AbiStatus::ResourceExhausted => "ResourceExhausted",
        AbiStatus::Transient => "Transient",
    }
}
