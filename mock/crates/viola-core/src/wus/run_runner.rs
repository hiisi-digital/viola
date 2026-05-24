//! `RunRunner` reads the runner plugin + scope inputs, writes the
//! scope-wide NAM snapshot.
//!
//! Slice 5b implements the body: resolves the runner plugin from
//! `Resource<ExtensionHost>` plus `Column<PluginEntry>` (finds the
//! entry with the runner-role bit set, gets its `&Library` via
//! `library_at`, extracts the runner vtable via
//! `runner_vtable_from_library`), marshals `RunScope` from Resources
//! on stack at the FFI call site, calls `execute_scope`, writes the
//! returned `NamPayload` into `Column<Nam>` at slot zero. Failures
//! emit `WuDiagnostic { source: WuDiagnosticSource::RunRunner }` to
//! `Column<WuDiagnostic>`. See the topic at
//! `mock/design_rounds/202605250400_topic.viola-254-slice-5b-runrunner-body.md`
//! for the design rationale and the four still-deferred placeholders
//! (workspace_root, surface, host_ctx, FileEntry enrichment fields).

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
use viola_plugin_abi::{
    AbiStatus, BytesRef, DiagnosticSeverity, NamPayload, NamVersion, RunScope,
    RunSurface,
};

use super::stub::WuCtxStub;
use super::{Nam, PluginEntry, WuDiagnostic, WuDiagnosticSource};
use crate::invoke::runner_vtable_from_library;
use crate::resources::{CiState, ExtensionHost, FileEntryBuffer};

/// Reads runner plugin + scope inputs, writes the scope-wide NAM.
pub struct RunRunner;

impl BuilderInput for RunRunner {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for RunRunner {
    type Read = Cons<
        Resource<CiState>,
        Cons<
            Resource<ExtensionHost>,
            Cons<Column<PluginEntry>, Cons<Resource<FileEntryBuffer>, Empty>>,
        >,
    >;
    type Write = Cons<Column<Nam>, Cons<Column<WuDiagnostic>, Empty>>;
    type Hint = (Steady, Adaptive, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, ctx: &Self::Ctx<'frame>) {
        type R = <RunRunner as WorkUnit>::Read;
        type W = <RunRunner as WorkUnit>::Write;
        type Stub = <WuCtxStub<'static> as HasResourceProvider<R>>::Provider;

        let ci_state: &CiState = <Stub as ResourceProviderApi<R>>::resource::<CiState>(
            <WuCtxStub<'frame> as HasResourceProvider<R>>::resources(ctx),
        );
        let host: &ExtensionHost =
            <Stub as ResourceProviderApi<R>>::resource::<ExtensionHost>(
                <WuCtxStub<'frame> as HasResourceProvider<R>>::resources(ctx),
            );
        let file_entries: &FileEntryBuffer =
            <Stub as ResourceProviderApi<R>>::resource::<FileEntryBuffer>(
                <WuCtxStub<'frame> as HasResourceProvider<R>>::resources(ctx),
            );
        let reader = <WuCtxStub<'frame> as HasColumnReader<R>>::reader(ctx);
        let writer = <WuCtxStub<'frame> as HasColumnWriter<W>>::writer(ctx);

        // Walk Column<PluginEntry> finding the first entry whose roles
        // mask has bit 0 (runner) set. LoadPlugins writes one row per
        // loaded library, so the upper bound is ExtensionHost's
        // loaded_count.
        let plugin_count: usize = *host.loaded_count(); // lint:allow(no-bare-numeric) reason: bridges arvo::USize to loop bound; tracked: #72
        let mut runner_host_idx: Maybe<usize> = Maybe::Isnt; // lint:allow(no-bare-numeric) reason: usize slot index for the matched entry; tracked: #72
        let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
        while i < plugin_count {
            // SAFETY: scheduler-plan analysis proves single-reader
            // access to Column<PluginEntry>. The row at index i was
            // populated by LoadPlugins at the same i during its loop;
            // LoadPlugins's loaded_count counter tracks column length
            // by construction so the read is in bounds.
            let entry: PluginEntry = unsafe {
                <Stub as ColumnReaderApi<R>>::read::<PluginEntry>(reader, USize(i))
            };
            if entry.roles.contains(USize(0)).0 { // lint:allow(no-bare-numeric) reason: runner role bit position; tracked: #72
                runner_host_idx = Maybe::Is(*entry.host_idx.0); // lint:allow(no-bare-numeric) reason: bridge arvo::Cap to slot index; tracked: #72
                break;
            }
            i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
        }

        let host_idx: usize = match runner_host_idx {
            Maybe::Is(idx) => idx,
            Maybe::Isnt => {
                emit_diag(writer);
                return;
            }
        };

        let library = host.library_at(arvo::Cap(USize(host_idx)));
        let vtable = match runner_vtable_from_library(library) {
            Maybe::Is(vt) => vt,
            Maybe::Isnt => {
                emit_diag(writer);
                return;
            }
        };

        let ci_byte: u8 = if ci_state.is_ci == arvo::Bool::TRUE { 1 } else { 0 }; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: FFI-shape ABI field projects to u8; tracked: #207
        let scope = RunScope {
            workspace_root: BytesRef::EMPTY,
            files: file_entries.entries_ptr(),
            files_len: file_entries.entries_len(),
            surface: RunSurface::Cli,
            ci: ci_byte,
            _reserved: [0u8; 3], // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: FFI-shape ABI field zero-init; tracked: #207
        };

        let mut nam_out = NamPayload {
            version: NamVersion::new(0, 0, 0), // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: FFI-shape NamVersion zero-init; tracked: #207
            data: core::ptr::null(),
            len: arvo::USize(0), // lint:allow(no-bare-numeric) reason: empty-output zero counter; tracked: #72
        };

        // SAFETY: vtable.execute_scope is a plugin-supplied function
        // pointer with the v1 contract. The `&scope` borrow is live
        // for the call duration; `&mut nam_out` writes through host-
        // owned memory live for the call duration. host_ctx = null is
        // the documented Slice 5b placeholder per BACKLOG; plugins
        // must tolerate null per the ABI doc.
        let status: AbiStatus = unsafe {
            (vtable.execute_scope)(
                core::ptr::null_mut(),
                &scope as *const _,
                &mut nam_out as *mut _,
            )
        };

        if status != AbiStatus::Ok {
            emit_diag(writer);
            return;
        }

        let nam = Nam { payload: nam_out };
        // SAFETY: scheduler-plan analysis proves single-writer access
        // to Column<Nam>. The singleton-row convention writes slot
        // zero only for the scope-wide NAM.
        unsafe {
            <Stub as ColumnWriterApi<W>>::write::<Nam>(writer, USize(0), nam); // lint:allow(no-bare-numeric) reason: singleton-row slot zero; tracked: #72
        }
    }
}

fn emit_diag(
    writer: &<WuCtxStub<'static> as HasColumnWriter<<RunRunner as WorkUnit>::Write>>::Provider,
) {
    type W = <RunRunner as WorkUnit>::Write;
    type Stub = <WuCtxStub<'static> as HasColumnWriter<W>>::Provider;
    let diag = WuDiagnostic {
        severity: DiagnosticSeverity::Error,
        source: WuDiagnosticSource::RunRunner,
        message: hilavitkutin_str::Str::default(),
        range: Maybe::Isnt,
    };
    // SAFETY: scheduler-plan analysis proves single-writer access to
    // Column<WuDiagnostic>. Slot zero is the only failure slot
    // RunRunner ever writes (the runner is scope-shaped: either the
    // scope succeeds or it does not; no per-file failure granularity
    // at this level).
    unsafe {
        <Stub as ColumnWriterApi<W>>::write::<WuDiagnostic>(writer, USize(0), diag); // lint:allow(no-bare-numeric) reason: singleton failure slot; tracked: #72
    }
}
