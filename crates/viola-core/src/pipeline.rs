//! Runner-once + lint-fan-out orchestration over a single NAM snapshot.
//!
//! Per `docs/PLUGIN-ABI-V1-DESIGN.md` §7.1 and §8.3, the host runs the
//! configured runner exactly once per scope, captures one NAM snapshot,
//! then fans the snapshot out to every configured lint. Diagnostics
//! from each lint feed a consumer-provided [`DiagnosticSink`]; the
//! consumer is responsible for storage shape (fixed-cap array, ring,
//! persistence column) and ultimately for the §10 deterministic sort,
//! for which this crate ships [`crate::aggregate::sort_diagnostics`]
//! and [`crate::aggregate::cmp_diag`].
//!
//! The pipeline never allocates and never holds plugin pointers past
//! the call that produced them: each `LintEvaluateVtable::evaluate`
//! result is consumed before the next plugin is invoked. Consumers that
//! need to retain diagnostics across plugin invocations copy the bytes
//! out inside the sink's `push`.
//!
//! The diagnostic-egress contract is the substrate's:
//! `hilavitkutin_api::DiagnosticSink<E>` is the named alias for
//! `Push<E> + Len`. Consumer sinks impl those two atoms and pick up
//! the named alias for free via the substrate's blanket. The pipeline
//! pushes [`Diagnostic`] by value (the type is `Copy`); deep-copy of
//! plugin-owned `BytesRef` payload still happens inside the sink, per
//! the v1 ABI contract.

use core::ffi::c_void;

use hilavitkutin_api::{Len, Push};
use hilavitkutin_extensions::Extension;
use notko::{Maybe, Outcome};
use viola_plugin_abi::{
    AbiStatus, BytesRef, Diagnostic, DiagnosticBatch, NamPayload, PluginError,
    RunScope,
};

use crate::invoke::{lint_vtable, runner_vtable};

/// Re-export so downstream consumers (`viola-cli`, plugin authors)
/// can name the substrate trait without depending on
/// `hilavitkutin-api` directly.
pub use hilavitkutin_api::DiagnosticSink;

/// Run the runner once, then fan out to every lint.
///
/// `runner` MUST hold the runner role (cap [`viola_plugin_abi::CAP_RUNNER_EXECUTE_SCOPE`]).
/// Each entry of `lints` MUST hold the lint role; entries that do not
/// surface as [`PluginError::RoleCapabilityMissing`].
///
/// `host_ctx` is the opaque per-load context pointer the host threaded
/// through `ExtensionHost::load`. The runner and each lint receive it
/// verbatim. Consumers that scope per-extension state (workspace
/// handle, persistence cursor, telemetry sink) wire it through that
/// pointer.
///
/// `lint_configs` parallels `lints` and supplies each lint's config
/// bytes. An empty `BytesRef` (`data` null or `len` zero) signals
/// absent config, which lints MUST tolerate per §8.
///
/// On runner failure the call returns immediately; lints are not
/// invoked. On per-lint failure the call records the first failing
/// plugin index and continues invoking subsequent lints (§4.4 partial
/// failure tolerance: one bad lint does not silence the rest). The
/// returned [`PipelineReport`] carries the first-failure marker.
pub fn run<S>(
    runner: &Extension,
    lints: &[&Extension],
    lint_configs: &[BytesRef],
    scope: &RunScope,
    host_ctx: *mut c_void,
    sink: &mut S,
) -> Outcome<PipelineReport, PluginError>
where
    S: Push<Diagnostic> + Len,
{
    let runner_vt = match runner_vtable(runner) {
        Maybe::Is(vt) => vt,
        Maybe::Isnt => return Outcome::Err(PluginError::RoleCapabilityMissing),
    };

    let mut nam = empty_nam();
    // SAFETY: runner_vt.execute_scope is a plugin-supplied function
    // pointer with the v1 contract; scope outlives the call by borrow;
    // out_nam writes through the host-owned `&mut nam` for the
    // invocation's duration only.
    let status = unsafe {
        (runner_vt.execute_scope)(host_ctx, scope as *const _, &mut nam as *mut _)
    };
    if status != AbiStatus::Ok {
        return Outcome::Err(PluginError::InvocationFailed);
    }

    let mut report = PipelineReport::OK;
    let nam_ptr: *const NamPayload = &nam;

    let mut i = 0;
    while i < lints.len() {
        let lint = lints[i];
        let cfg = lint_configs.get(i).copied().unwrap_or(BytesRef::EMPTY);

        let lint_vt = match lint_vtable(lint) {
            Maybe::Is(vt) => vt,
            Maybe::Isnt => {
                report.note_failure(i, PluginError::RoleCapabilityMissing);
                i += 1;
                continue;
            }
        };

        let mut batch = DiagnosticBatch {
            entries: core::ptr::null(),
            len: arvo::USize(0),
        };
        // SAFETY: lint_vt.evaluate is plugin-supplied with the v1
        // contract; nam_ptr addresses host-owned memory live for this
        // call; cfg.data + cfg.len address host-owned config bytes
        // (or are null/zero); out_batch writes through host-owned
        // storage for the call.
        let status = unsafe {
            (lint_vt.evaluate)(
                host_ctx,
                nam_ptr,
                cfg.data,
                cfg.len,
                &mut batch as *mut _,
            )
        };
        if status != AbiStatus::Ok {
            report.note_failure(i, PluginError::InvocationFailed);
            i += 1;
            continue;
        }

        if !batch.entries.is_null() && batch.len.0 > 0 {
            // SAFETY: contract pins entries+len at a plugin-static
            // slice valid for this call. We consume it before the next
            // plugin call, so no aliasing or lifetime extension occurs.
            let entries = unsafe {
                core::slice::from_raw_parts(batch.entries, batch.len.0)
            };
            let mut k = 0;
            while k < entries.len() {
                // `Diagnostic` is `Copy`; pushing by value is the
                // substrate's `Push<T>` shape. The sink deep-copies
                // `BytesRef` payload internally per the v1 ABI
                // contract before this slice goes out of scope.
                sink.push(entries[k]);
                k += 1;
            }
        }

        i += 1;
    }

    Outcome::Ok(report)
}

/// Per-lint configuration carrier alias.
///
/// `LintConfig` was historically a viola-private duplicate of
/// [`viola_plugin_abi::BytesRef`]; both are `(ptr, len)` over
/// host-owned bytes. The alias preserves the historical name at the
/// callsite while routing every use through the canonical type. New
/// code should reach for `BytesRef` directly.
pub type LintConfig = BytesRef;

/// Aggregate report for a single pipeline run.
///
/// Tracks first-failure markers without growing with plugin count.
/// Consumers that need richer per-lint state implement their own sink.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct PipelineReport {
    pub first_failure: Maybe<FailureRecord>,
}

impl PipelineReport {
    pub const OK: Self = Self { first_failure: Maybe::Isnt };

    fn note_failure(&mut self, lint_index: usize, error: PluginError) {
        if matches!(self.first_failure, Maybe::Isnt) {
            self.first_failure = Maybe::Is(FailureRecord {
                lint_index: arvo::USize(lint_index),
                error,
            });
        }
    }
}

/// Per-failure record carried by [`PipelineReport`].
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct FailureRecord {
    pub lint_index: arvo::USize,
    pub error: PluginError,
}

fn empty_nam() -> NamPayload {
    NamPayload {
        version: viola_plugin_abi::NamVersion::new(0, 0, 0),
        data: core::ptr::null(),
        len: arvo::USize(0),
    }
}
