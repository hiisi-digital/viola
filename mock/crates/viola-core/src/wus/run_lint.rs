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
//! `evaluate` FFI with a host-owned output buffer, and projects the
//! written diagnostics into
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
use core::mem::MaybeUninit;
use viola_plugin_abi::{AbiStatus, BytesRef, Diagnostic, DiagnosticSeverity};

use super::stub::WuCtxStub;
use super::{Nam, WuDiagnostic, WuDiagnosticSource};
use crate::invoke::lint_vtable_from_library;
use crate::resources::{
    DiagnosticCounts, ExtensionHost, LintConfigBuffer, LintSlots, MAX_DIAGS_PER_LINT, MAX_LINTS,
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
    type Write = Cons<Column<WuDiagnostic>, Cons<Resource<DiagnosticCounts>, Empty>>;
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
        type StubW<const LL: usize> =
            <WuCtxStub<'static> as HasResourceProvider<W<LL>>>::Provider;

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
        let diag_counts: &DiagnosticCounts =
            <StubW<L> as ResourceProviderApi<W<L>>>::resource::<DiagnosticCounts>(
                <WuCtxStub<'frame> as HasResourceProvider<W<L>>>::resources(ctx),
            );

        let host_idx = match lint_slots.slot_at(arvo::Cap(USize(L))) {
            Maybe::Is(idx) => idx,
            Maybe::Isnt => {
                // No plugin at this slot. Silent return (not a failure).
                // Per-L count stays at zero; EmitDiagnostics skips this L.
                write_count::<L>(diag_counts, USize(0)); // lint:allow(no-bare-numeric) reason: empty-count marker; tracked: #72
                return;
            }
        };

        let library = host.library_at(host_idx);
        let vtable = match lint_vtable_from_library(library) {
            Maybe::Is(vt) => vt,
            Maybe::Isnt => {
                emit_failure::<L>(writer);
                write_count::<L>(diag_counts, USize(1)); // lint:allow(no-bare-numeric) reason: one-failure-record count; tracked: #72
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

        // Host-owned output buffer (ABI v2): the host provides a
        // fixed-capacity Diagnostic slice; the plugin writes findings
        // through it and reports the count via out_len. Diagnostic is
        // Copy plain-old-data with no Drop, so MaybeUninit needs no
        // explicit teardown; only the first out_len slots are read.
        let mut out_buf: [MaybeUninit<Diagnostic>; MAX_DIAGS_PER_LINT] =
            [MaybeUninit::uninit(); MAX_DIAGS_PER_LINT];
        let mut out_len = arvo::USize(0); // lint:allow(no-bare-numeric) reason: out-param zero init; tracked: #72

        // SAFETY: vtable.evaluate is a plugin-supplied function pointer
        // with the v2 contract. The `&nam.payload` borrow is live for
        // the call duration. `out_buf` is host-owned memory of
        // MAX_DIAGS_PER_LINT slots; the plugin must not write past the
        // out_capacity we pass. host_ctx = null is the Slice 6a-deferred
        // placeholder per BACKLOG. config_bytes addresses ViolaCfg arena
        // memory immutable for the scheduler run.
        let status: AbiStatus = unsafe {
            (vtable.evaluate)(
                core::ptr::null_mut(),
                &nam.payload as *const _,
                config_bytes.data,
                config_bytes.len,
                out_buf.as_mut_ptr() as *mut Diagnostic,
                USize(MAX_DIAGS_PER_LINT),
                &mut out_len as *mut _,
            )
        };

        // Ok = full result. Internal = overflow: the first out_capacity
        // entries are valid and out_len is the would-have-emitted count,
        // so the host projects what fits and continues (non-fatal
        // truncation). Any other status is a real invocation failure.
        if status != AbiStatus::Ok && status != AbiStatus::Internal {
            emit_failure::<L>(writer);
            write_count::<L>(diag_counts, USize(1)); // lint:allow(no-bare-numeric) reason: one-failure-record count; tracked: #72
            return;
        }

        // Project up to MAX_DIAGS_PER_LINT written Diagnostic records
        // into the per-L disjoint row range. WuDiagnostic carries
        // Str::default() placeholders for plugin_id/rule_id/message
        // per the Slice 6a-deferred LintFinding-carrier BACKLOG entry.
        let returned: usize = *out_len; // lint:allow(no-bare-numeric) reason: bridges arvo::USize to loop bound; tracked: #72
        let count: usize = if returned < MAX_DIAGS_PER_LINT { // lint:allow(no-bare-numeric) reason: cap comparison; tracked: #72
            returned
        } else {
            MAX_DIAGS_PER_LINT
        };
        let base: usize = L * MAX_DIAGS_PER_LINT; // lint:allow(no-bare-numeric) reason: per-L row-range base; tracked: #72
        let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
        while i < count {
            // SAFETY: the plugin wrote `out_len` entries into out_buf
            // and we bound i < count <= min(out_len, MAX_DIAGS_PER_LINT),
            // so slot i is initialised. MaybeUninit<Diagnostic> is Copy;
            // assume_init reads a value copy. We project severity by
            // value; BytesRef fields point at plugin-owned static memory
            // (only the host-side severity is carried into WuDiagnostic
            // per the Slice 6a-deferred LintFinding carrier).
            let entry = unsafe { out_buf[i].assume_init() };
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
        // Record the per-L populated count so EmitDiagnostics bounds
        // its iteration over this L's row range without sentinel
        // detection. The DiagnosticCounts write commutes with parallel
        // RunLint<L'> writes (distinct slot indexes) per the
        // COMMUTATIVE-flag contract.
        write_count::<L>(diag_counts, USize(count));
    }
}

/// Write the per-L populated count to `DiagnosticCounts`. The slot
/// index is `L`; concurrent RunLint<L'> writes for distinct L touch
/// disjoint slots, so the write commutes under the COMMUTATIVE flag.
fn write_count<const L: usize>(diag_counts: &DiagnosticCounts, count: arvo::USize) {
    // SAFETY: caller (this WU's execute body) holds a Write projection
    // of Resource<DiagnosticCounts>; the slot index L is unique to
    // this WU instance under the disjoint-slot strategy; no concurrent
    // writer touches slot L. The const-eval guard inside execute
    // ensures L < MAX_LINTS, satisfying the inner bounds check.
    unsafe {
        diag_counts.set_count(arvo::Cap(USize(L)), count);
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
