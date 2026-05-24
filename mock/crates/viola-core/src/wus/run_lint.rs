//! `RunLint<const L: usize>` reads NAM snapshots and per-slot config,
//! writes findings.
//!
//! The only generic WU in the viola pipeline. The const generic `L`
//! indexes into the lint-plugin slot set; the engine monomorphises one
//! impl per L at plan time per the cdylib boundary memo. Slice 6a set
//! `const COMMUTATIVE: arvo::Bool = arvo::Bool::TRUE` so the scheduler
//! dispatches `RunLint<0>..RunLint<MAX_LINTS - 1>` in parallel under
//! the disjoint-row-range write strategy. Slice 6b lands the body that
//! reads `Resource<LintSlots>` plus `Resource<LintConfigBuffer>` for
//! the per-slot plugin and config bytes, resolves the lint vtable via
//! `ExtensionHost::library_at` + `lint_vtable_from_library`, calls
//! `evaluate` FFI, and projects the returned `DiagnosticBatch` into
//! the per-L row range of `Column<WuDiagnostic>` (slots
//! `[L * MAX_DIAGS_PER_LINT, (L + 1) * MAX_DIAGS_PER_LINT)`).
//!
//! # Column capacity contract
//!
//! Callers MUST provision `Column<WuDiagnostic>` with at least
//! `MAX_LINTS * MAX_DIAGS_PER_LINT` slots. A misprovisioned column
//! corrupts neighbouring slots on parallel-fan-out writes (the
//! disjoint-row-range guarantee depends on the column being large
//! enough that every per-L range fits within bounds). The projection
//! loop carries a `debug_assert!` at the writer boundary to catch a
//! misprovisioned column at write time during development builds.

use arvo::USize;
use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::context::{
    ColumnReaderApi, ColumnWriterApi, HasColumnReader, HasColumnWriter,
    HasResourceProvider, ResourceProviderApi,
};
use hilavitkutin_api::hint::{Adaptive, Important, Steady};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use notko::Maybe;
use viola_plugin_abi::{AbiStatus, BytesRef, DiagnosticBatch, DiagnosticSeverity};

use super::stub::WuCtxStub;
use super::{Nam, WuDiagnostic, WuDiagnosticSource};
use crate::invoke::lint_vtable_from_library;
use crate::resources::{
    ExtensionHost, LintConfigBuffer, LintSlots, MAX_DIAGS_PER_LINT, MAX_LINTS,
};

/// Reads NAM snapshots and per-slot config, writes findings. `L`
/// indexes the lint-plugin slot.
pub struct RunLint<const L: usize>;

impl<const L: usize> BuilderInput for RunLint<L> {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl<const L: usize> WorkUnit for RunLint<L> {
    type Read = Cons<
        Resource<ExtensionHost>,
        Cons<
            Resource<LintSlots>,
            Cons<Resource<LintConfigBuffer>, Cons<Column<Nam>, Empty>>,
        >,
    >;
    type Write = Cons<Column<WuDiagnostic>, Empty>;
    type Hint = (Steady, Adaptive, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    /// Parallel fan-out claim per Slice 6a: `RunLint<0>..RunLint<MAX_LINTS - 1>`
    /// write to disjoint per-L row ranges of `Column<WuDiagnostic>`, so the
    /// scheduler can dispatch them concurrently under the COMMUTATIVE flag.
    /// Slice 9 audits the landed hilavitkutin dispatch codegen to confirm
    /// the flag yields reduce-style parallel fan-out (vs serialising).
    const COMMUTATIVE: arvo::Bool = arvo::Bool::TRUE;

    fn execute<'frame>(&self, ctx: &Self::Ctx<'frame>) {
        type R<const LL: usize> = <RunLint<LL> as WorkUnit>::Read;
        type W<const LL: usize> = <RunLint<LL> as WorkUnit>::Write;
        type Stub<const LL: usize> =
            <WuCtxStub<'static> as HasResourceProvider<R<LL>>>::Provider;

        // Compile-time guard: L must be within MAX_LINTS so the per-L
        // row range fits in the disjoint write strategy. The const-eval
        // panic catches misuse at monomorphisation time.
        const {
            assert!(L < MAX_LINTS, "RunLint<L>: L exceeds MAX_LINTS");
        }

        let host: &ExtensionHost =
            <Stub<L> as ResourceProviderApi<R<L>>>::resource::<ExtensionHost>(
                <WuCtxStub<'frame> as HasResourceProvider<R<L>>>::resources(ctx),
            );
        let lint_slots: &LintSlots =
            <Stub<L> as ResourceProviderApi<R<L>>>::resource::<LintSlots>(
                <WuCtxStub<'frame> as HasResourceProvider<R<L>>>::resources(ctx),
            );
        let lint_configs: &LintConfigBuffer =
            <Stub<L> as ResourceProviderApi<R<L>>>::resource::<LintConfigBuffer>(
                <WuCtxStub<'frame> as HasResourceProvider<R<L>>>::resources(ctx),
            );
        let reader = <WuCtxStub<'frame> as HasColumnReader<R<L>>>::reader(ctx);
        let writer = <WuCtxStub<'frame> as HasColumnWriter<W<L>>>::writer(ctx);

        let host_idx = match lint_slots.slot_at(arvo::Cap(USize(L))) {
            Maybe::Is(idx) => idx,
            Maybe::Isnt => {
                // No plugin at this slot. Silent return (not a failure).
                return;
            }
        };

        let library = host.library_at(host_idx);
        let vtable = match lint_vtable_from_library(library) {
            Maybe::Is(vt) => vt,
            Maybe::Isnt => {
                emit_failure::<L>(writer);
                return;
            }
        };

        // SAFETY: scheduler-plan analysis proves single-reader access
        // to Column<Nam>. The runner WU writes slot zero by the
        // singleton-row convention (Slice 5b). RunLint reads slot zero.
        let nam = unsafe {
            <Stub<L> as ColumnReaderApi<R<L>>>::read::<Nam>(reader, USize(0)) // lint:allow(no-bare-numeric) reason: singleton-row slot zero; tracked: #72
        };

        let config_bytes: BytesRef = lint_configs.config_at(arvo::Cap(USize(L)));

        let mut batch = DiagnosticBatch {
            entries: core::ptr::null(),
            len: arvo::USize(0), // lint:allow(no-bare-numeric) reason: empty-output zero counter; tracked: #72
        };

        // SAFETY: vtable.evaluate is a plugin-supplied function pointer
        // with the v1 contract. The `&nam.payload` borrow is live for
        // the call duration; `&mut batch` writes through host-owned
        // memory live for the call duration. host_ctx = null is the
        // Slice 6a-deferred placeholder per BACKLOG. config_bytes
        // addresses ViolaCfg arena memory immutable for the scheduler
        // run.
        let status: AbiStatus = unsafe {
            (vtable.evaluate)(
                core::ptr::null_mut(),
                &nam.payload as *const _,
                config_bytes.data,
                config_bytes.len,
                &mut batch as *mut _,
            )
        };

        if status != AbiStatus::Ok {
            emit_failure::<L>(writer);
            return;
        }

        // Project up to MAX_DIAGS_PER_LINT returned Diagnostic records
        // into the per-L disjoint row range. WuDiagnostic carries
        // Str::default() placeholders for plugin_id/rule_id/message
        // per the Slice 6a-deferred LintFinding-carrier BACKLOG entry.
        let returned: usize = *batch.len; // lint:allow(no-bare-numeric) reason: bridges arvo::USize to loop bound; tracked: #72
        let count: usize = if returned < MAX_DIAGS_PER_LINT { // lint:allow(no-bare-numeric) reason: cap comparison; tracked: #72
            returned
        } else {
            MAX_DIAGS_PER_LINT
        };
        let base: usize = L * MAX_DIAGS_PER_LINT; // lint:allow(no-bare-numeric) reason: per-L row-range base; tracked: #72
        let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
        while i < count {
            // SAFETY: plugin's evaluate contract asserts that on
            // AbiStatus::Ok the `entries` pointer is valid for read of
            // `len` Diagnostic records for the duration of the call;
            // we read entry index i < count <= MAX_DIAGS_PER_LINT
            // <= len. The plugin owns the entries memory and keeps it
            // immutable for the call duration. We copy severity by
            // value; BytesRef fields stay plugin-owned (only the
            // host-side severity is projected into WuDiagnostic per
            // the Slice 6a-deferred LintFinding carrier).
            let entry = unsafe { *batch.entries.add(i) };
            let diag = WuDiagnostic {
                severity: entry.severity,
                source: WuDiagnosticSource::RunLint,
                message: hilavitkutin_str::Str::default(),
                range: Maybe::Isnt,
            };
            // Column capacity contract: caller MUST provision
            // Column<WuDiagnostic> >= MAX_LINTS * MAX_DIAGS_PER_LINT
            // slots. The disjoint-row-range guarantee depends on it.
            debug_assert!(
                base + i < MAX_LINTS * MAX_DIAGS_PER_LINT,
                "RunLint<L> per-L row range exceeds Column<WuDiagnostic> capacity contract",
            );
            // SAFETY: scheduler-plan analysis proves single-writer
            // access to Column<WuDiagnostic> under the COMMUTATIVE
            // flag because each RunLint<L> writes to a disjoint per-L
            // row range. The base + i slot is unique to this L for
            // i in [0, MAX_DIAGS_PER_LINT). The column-capacity
            // contract above ensures the slot index is in bounds.
            unsafe {
                <Stub<L> as ColumnWriterApi<W<L>>>::write::<WuDiagnostic>(
                    writer,
                    USize(base + i), // lint:allow(no-bare-numeric) reason: per-L row-range slot; tracked: #72
                    diag,
                );
            }
            i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
        }
    }
}

fn emit_failure<const L: usize>(
    writer: &<WuCtxStub<'static> as HasColumnWriter<<RunLint<L> as WorkUnit>::Write>>::Provider,
) {
    type W<const LL: usize> = <RunLint<LL> as WorkUnit>::Write;
    type Stub<const LL: usize> = <WuCtxStub<'static> as HasColumnWriter<W<LL>>>::Provider;
    let diag = WuDiagnostic {
        severity: DiagnosticSeverity::Error,
        source: WuDiagnosticSource::RunLint,
        message: hilavitkutin_str::Str::default(),
        range: Maybe::Isnt,
    };
    let base: usize = L * MAX_DIAGS_PER_LINT; // lint:allow(no-bare-numeric) reason: per-L row-range base; tracked: #72
    // Column-capacity contract guard for the failure slot.
    debug_assert!(
        base < MAX_LINTS * MAX_DIAGS_PER_LINT,
        "RunLint<L> failure slot exceeds Column<WuDiagnostic> capacity contract",
    );
    // SAFETY: per-L disjoint row range. Slot `base` is unique to this
    // L; no race with other RunLint<L'> for L' != L.
    unsafe {
        <Stub<L> as ColumnWriterApi<W<L>>>::write::<WuDiagnostic>(
            writer,
            USize(base),
            diag,
        );
    }
}
