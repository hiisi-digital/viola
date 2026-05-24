//! `EmitDiagnostics<W>` reads findings, writes them to the egress sink.
//!
//! Slice 7b ships the body. Walks `Resource<DiagnosticCounts>` for the
//! per-L populated count, walks `Column<WuDiagnostic>` slots
//! `[L * MAX_DIAGS_PER_LINT, L * MAX_DIAGS_PER_LINT + count)` per L,
//! stages every populated record into a stack-cap working array,
//! sorts via the host-side approximation comparator (insertion sort,
//! stable; comparator is total via the `original_slot_index`
//! tiebreaker), and emits each formatted line through
//! `EmitWriter::write_str` held inside `Resource<DiagnosticSink<W>>`.
//! Calls `flush` at end-of-emit.
//!
//! The host-side sort is a documented approximation of ABI §10's
//! canonical sort: WuDiagnostic records carry `Str::default()`
//! placeholders for path / plugin_id / message until the LintFinding
//! carrier upgrade lands. Sort keys reduce to
//! `(source, severity, range.start_line, range.start_col,
//! original_slot_index)`; the `original_slot_index` tiebreaker pins
//! the comparator as total under placeholder collisions.

use core::marker::PhantomData;

use arvo::{AsBool, USize};
use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::context::{
    ColumnReaderApi, HasColumnReader, HasResourceProvider, ResourceProviderApi,
};
use hilavitkutin_api::hint::{Atomic, Important, Relaxed};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use notko::Maybe;
use viola_plugin_abi::DiagnosticSeverity;

use super::stub::WuCtxStub;
use super::{DiagnosticSink, EmitWriter, WuDiagnostic};
use crate::resources::{DiagnosticCounts, MAX_DIAGS_PER_LINT, MAX_LINTS};

/// Reads findings + per-L counts; writes through the egress sink.
///
/// Generic over the `EmitWriter` impl held inside the sink Resource;
/// viola-cli registers the concrete W at scheduler-builder time. The
/// `PhantomData<fn() -> W>` carrier makes the struct itself
/// `Send + Sync` regardless of W; the thread-safety bound lives on
/// the `impl WorkUnit` block where the Resource carrier actually
/// needs it.
pub struct EmitDiagnostics<W: EmitWriter> {
    _marker: PhantomData<fn() -> W>,
}

impl<W: EmitWriter> EmitDiagnostics<W> {
    /// Construct the WU. No fields; the generic `W` flows through to
    /// the AccessSet declaration only.
    pub const fn new() -> Self {
        Self { _marker: PhantomData }
    }
}

impl<W: EmitWriter> Default for EmitDiagnostics<W> {
    fn default() -> Self {
        Self::new()
    }
}

impl<W: EmitWriter> BuilderInput for EmitDiagnostics<W> {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

/// Slot record staged for sorting. Carries the original slot index
/// for the comparator-totalising tiebreaker per the Slice 7b sort
/// approximation contract.
#[derive(Copy, Clone)]
struct StagedRecord {
    diag: WuDiagnostic,
    original_slot_index: arvo::USize,
}

/// Upper bound on the stack-cap working array sized to the worst-case
/// fully-populated `Column<WuDiagnostic>` row count. The compile-time
/// assert below pins this against the cap product so the array cannot
/// drift silently if MAX_LINTS or MAX_DIAGS_PER_LINT revise upward.
const STAGE_CAP: usize = MAX_LINTS * MAX_DIAGS_PER_LINT; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: const-array dim requires bare usize; tracked: #72

// Pin the stage cap against the per-L row-range cap product so the
// stack-buffer size cannot drift silently if either MAX_LINTS or
// MAX_DIAGS_PER_LINT revises upward without revisiting the body.
const _: () = {
    assert!(
        STAGE_CAP == MAX_LINTS * MAX_DIAGS_PER_LINT, // lint:allow(no-bare-numeric) reason: const guard arithmetic; tracked: #72
        "STAGE_CAP drift: must equal MAX_LINTS * MAX_DIAGS_PER_LINT",
    );
};

impl<W: EmitWriter + Send + Sync + 'static> WorkUnit for EmitDiagnostics<W> {
    type Read = Cons<Resource<DiagnosticCounts>, Cons<Column<WuDiagnostic>, Empty>>;
    type Write = Cons<Resource<DiagnosticSink<W>>, Empty>;
    type Hint = (Relaxed, Atomic, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, ctx: &Self::Ctx<'frame>) {
        type R<WW> = <EmitDiagnostics<WW> as WorkUnit>::Read;
        type Wr<WW> = <EmitDiagnostics<WW> as WorkUnit>::Write;
        type StubR<WW> = <WuCtxStub<'static> as HasResourceProvider<R<WW>>>::Provider;
        type StubW<WW> = <WuCtxStub<'static> as HasResourceProvider<Wr<WW>>>::Provider;

        let counts: &DiagnosticCounts =
            <StubR<W> as ResourceProviderApi<R<W>>>::resource::<DiagnosticCounts>(
                <WuCtxStub<'frame> as HasResourceProvider<R<W>>>::resources(ctx),
            );
        let sink: &DiagnosticSink<W> =
            <StubW<W> as ResourceProviderApi<Wr<W>>>::resource::<DiagnosticSink<W>>(
                <WuCtxStub<'frame> as HasResourceProvider<Wr<W>>>::resources(ctx),
            );
        let reader = <WuCtxStub<'frame> as HasColumnReader<R<W>>>::reader(ctx);

        // Short-circuit when no L has populated diagnostics. The
        // 32-entry scan replaces a shared counter that would have been
        // a Cell RMW race under the parallel RunLint cohort.
        if !counts.any_populated().as_bool() {
            // SAFETY: sole writer of DiagnosticSink<W> per the
            // AccessSet contract.
            unsafe { sink.flush(); }
            return;
        }

        // Stage populated records into a stack-cap working array.
        // The stage size is bounded by STAGE_CAP per the const-cap
        // construction; debug_assert guards the bound at runtime in
        // dev builds.
        let mut staged: [StagedRecord; STAGE_CAP] = [StagedRecord {
            diag: WuDiagnostic {
                severity: DiagnosticSeverity::Info,
                source: super::WuDiagnosticSource::Emit,
                message: hilavitkutin_str::Str::default(),
                range: Maybe::Isnt,
            },
            original_slot_index: arvo::USize(0), // lint:allow(no-bare-numeric) reason: zero-init array filler; tracked: #72
        }; STAGE_CAP];
        let mut staged_len: usize = 0; // lint:allow(no-bare-numeric) reason: staging counter; tracked: #72

        let mut l: usize = 0; // lint:allow(no-bare-numeric) reason: outer loop counter; tracked: #72
        while l < MAX_LINTS {
            let per_l: usize = *counts.count_at(arvo::Cap(USize(l))); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to loop bound; tracked: #72
            if per_l == 0 { // lint:allow(no-bare-numeric) reason: skip-empty-slot check; tracked: #72
                l += 1; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
                continue;
            }
            let base: usize = l * MAX_DIAGS_PER_LINT; // lint:allow(no-bare-numeric) reason: per-L row-range base; tracked: #72
            let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: inner loop counter; tracked: #72
            while i < per_l {
                debug_assert!(
                    staged_len < STAGE_CAP,
                    "EmitDiagnostics stage cap exceeded; counts inconsistent with MAX_LINTS * MAX_DIAGS_PER_LINT",
                );
                // SAFETY: scheduler-plan analysis proves single-reader
                // access to Column<WuDiagnostic> for EmitDiagnostics
                // (it declares Column<WuDiagnostic> in Read; RunLint
                // wrote to disjoint per-L row ranges in a prior
                // phase). Slot `base + i` is in bounds when
                // counts.count_at(l) reflects accurate per-L counts.
                let diag = unsafe {
                    <StubR<W> as ColumnReaderApi<R<W>>>::read::<WuDiagnostic>(
                        reader,
                        USize(base + i), // lint:allow(no-bare-numeric) reason: per-L row-range slot; tracked: #72
                    )
                };
                staged[staged_len] = StagedRecord {
                    diag,
                    original_slot_index: arvo::USize(base + i), // lint:allow(no-bare-numeric) reason: tiebreaker key; tracked: #72
                };
                staged_len += 1; // lint:allow(no-bare-numeric) reason: staging counter increment; tracked: #72
                i += 1; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
            }
            l += 1; // lint:allow(no-bare-numeric) reason: outer loop counter; tracked: #72
        }

        // Insertion sort over the staged prefix `[0..staged_len)`.
        // Stable; simple; no_std-friendly. The comparator is total
        // (the original_slot_index tiebreaker eliminates ties), so
        // stability is theoretically redundant; we ship stable + total
        // as the safer pair. Cost is dominated by per-record emit
        // syscall for typical staged_len.
        let mut a: usize = 1; // lint:allow(no-bare-numeric) reason: insertion sort index; tracked: #72
        while a < staged_len {
            let mut b: usize = a; // lint:allow(no-bare-numeric) reason: insertion sort scan index; tracked: #72
            while b > 0 && compare_staged(&staged[b], &staged[b - 1]) { // lint:allow(no-bare-numeric) reason: insertion-sort neighbour check; tracked: #72
                staged.swap(b, b - 1); // lint:allow(no-bare-numeric) reason: insertion-sort neighbour swap; tracked: #72
                b -= 1; // lint:allow(no-bare-numeric) reason: insertion sort step; tracked: #72
            }
            a += 1; // lint:allow(no-bare-numeric) reason: insertion sort outer index; tracked: #72
        }

        // Emit each diagnostic on its own line. The Slice 7b format is
        // hardcoded human-readable: "[severity] source: <no message>".
        // Message and range carry placeholders pending the
        // LintFinding-carrier upgrade.
        let mut e: usize = 0; // lint:allow(no-bare-numeric) reason: emit counter; tracked: #72
        while e < staged_len {
            let rec = &staged[e];
            let sev_str = severity_label(rec.diag.severity);
            let src_str = source_label(rec.diag.source);
            // SAFETY: sole writer of DiagnosticSink<W> per AccessSet.
            unsafe {
                sink.write_str("[");
                sink.write_str(sev_str);
                sink.write_str("] ");
                sink.write_str(src_str);
                sink.write_str(": <no message>\n");
            }
            e += 1; // lint:allow(no-bare-numeric) reason: emit counter; tracked: #72
        }

        // SAFETY: sole writer of DiagnosticSink<W> per AccessSet.
        unsafe { sink.flush(); }
    }
}

/// Returns `true` when `lhs` sorts strictly before `rhs` under the
/// Slice 7b host-side approximation comparator. The
/// `original_slot_index` tiebreaker makes the comparator total: no
/// two distinct staged records compare equal.
fn compare_staged(lhs: &StagedRecord, rhs: &StagedRecord) -> bool {
    let ls = source_rank(lhs.diag.source);
    let rs = source_rank(rhs.diag.source);
    if ls != rs {
        return ls < rs;
    }
    let lv = severity_rank(lhs.diag.severity);
    let rv = severity_rank(rhs.diag.severity);
    if lv != rv {
        return lv < rv;
    }
    let (ll, lc) = range_keys(&lhs.diag.range);
    let (rl, rc) = range_keys(&rhs.diag.range);
    if ll != rl {
        return ll < rl;
    }
    if lc != rc {
        return lc < rc;
    }
    *lhs.original_slot_index < *rhs.original_slot_index
}

fn source_rank(source: super::WuDiagnosticSource) -> arvo::USize {
    use super::WuDiagnosticSource as S;
    let n: usize = match source { // lint:allow(no-bare-numeric) reason: rank-ordering integer; tracked: #72
        S::ConfigParse => 0,
        S::PluginLoad => 1,
        S::FileWalk => 2,
        S::RunRunner => 3,
        S::RunLint => 4,
        S::Emit => 5,
    };
    arvo::USize(n)
}

fn severity_rank(severity: DiagnosticSeverity) -> arvo::USize {
    let n: usize = match severity { // lint:allow(no-bare-numeric) reason: rank-ordering integer; tracked: #72
        DiagnosticSeverity::Error => 0,
        DiagnosticSeverity::Warn => 1,
        DiagnosticSeverity::Info => 2,
    };
    arvo::USize(n)
}

fn range_keys(range: &Maybe<viola_plugin_abi::SourceRange>) -> (arvo::USize, arvo::USize) {
    match range {
        Maybe::Is(r) => (arvo::USize(r.start.line as usize), arvo::USize(r.start.column as usize)), // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: bridges u32 FFI line/col to arvo::USize; tracked: #207
        // Records without a range sort after records with a range at
        // line 0 col 0 by using USize::MAX as the missing-range key.
        Maybe::Isnt => (arvo::USize(usize::MAX), arvo::USize(usize::MAX)), // lint:allow(no-bare-numeric) reason: missing-range sort sentinel; tracked: #72
    }
}

fn severity_label(severity: DiagnosticSeverity) -> &'static str {
    match severity {
        DiagnosticSeverity::Error => "error",
        DiagnosticSeverity::Warn => "warning",
        DiagnosticSeverity::Info => "info",
    }
}

fn source_label(source: super::WuDiagnosticSource) -> &'static str {
    use super::WuDiagnosticSource as S;
    match source {
        S::ConfigParse => "config",
        S::PluginLoad => "plugin",
        S::FileWalk => "files",
        S::RunRunner => "runner",
        S::RunLint => "lint",
        S::Emit => "emit",
    }
}
