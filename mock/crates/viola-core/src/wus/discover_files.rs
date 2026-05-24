//! `DiscoverFiles` reads host-shim-populated paths, writes the per-file
//! set.
//!
//! Slice 4 implements the body: reads `Resource<DiscoveredFilePaths>`
//! and projects each entry into one `FileInfo` record on
//! `Column<FileInfo>`. Filesystem walking lives in the host shim at
//! scheduler-builder time; the WU stays pure no_std data-transformation
//! code per the hilavitkutin-workunit-mental-model.md framing. See the
//! topic at
//! `mock/design_rounds/202605250200_topic.viola-254-slice-4-discover-files-body.md`
//! for the design call.
//!
//! AccessSet matches body usage exactly: Read holds only
//! `Resource<DiscoveredFilePaths>`; Write holds only
//! `Column<FileInfo>`. Future refinements (include / exclude filtering,
//! workspace-relative diagnostic context, kind classification) extend
//! the AccessSet at the point of consumption per the BACKLOG entries.

use arvo::USize;
use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::context::{
    ColumnWriterApi, HasColumnWriter, HasResourceProvider, ResourceProviderApi,
};
use hilavitkutin_api::hint::{Adaptive, Immediate, Important};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use notko::Maybe;

use super::stub::WuCtxStub;
use super::{FileInfo, FileKind};
use crate::resources::DiscoveredFilePaths;

/// Reads host-shim-populated paths, writes the per-file set.
pub struct DiscoverFiles;

impl BuilderInput for DiscoverFiles {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for DiscoverFiles {
    type Read = Cons<Resource<DiscoveredFilePaths>, Empty>;
    type Write = Cons<Column<FileInfo>, Empty>;
    type Hint = (Immediate, Adaptive, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, ctx: &Self::Ctx<'frame>) {
        type R = <DiscoverFiles as WorkUnit>::Read;
        type W = <DiscoverFiles as WorkUnit>::Write;
        // `Provider` is the inner stub type held by the WuCtxStub. The
        // associated type is lifetime-invariant in the current Slice 1
        // shape, so projecting through `WuCtxStub<'static>` gives the
        // same type as `WuCtxStub<'frame>`. Mirrors the LoadPlugins
        // resolution pattern; if `Provider` ever becomes lifetime-
        // dependent, this projection needs the `'frame` form.
        type Stub = <WuCtxStub<'static> as HasResourceProvider<R>>::Provider;

        let paths: &DiscoveredFilePaths =
            <Stub as ResourceProviderApi<R>>::resource::<DiscoveredFilePaths>(
                <WuCtxStub<'frame> as HasResourceProvider<R>>::resources(ctx),
            );
        let writer = <WuCtxStub<'frame> as HasColumnWriter<W>>::writer(ctx);

        let n: usize = *paths.paths_len().0; // lint:allow(no-bare-numeric) reason: bridges arvo::Cap to slot count; tracked: #72
        let mut written_count: usize = 0; // lint:allow(no-bare-numeric) reason: local column-length counter; tracked: #72
        let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
        while i < n {
            let path = match paths.path_at(arvo::Cap(USize(i))) {
                Maybe::Is(p) => p,
                Maybe::Isnt => {
                    // Unreachable by construction: the loop guard is
                    // `paths_len()` and `path_at` only returns `Isnt`
                    // past `paths_len`. If this fires, it indicates a
                    // logic bug somewhere in the Cap / USize bridge or
                    // a corrupted Resource state. Surface immediately.
                    unreachable!(
                        "DiscoverFiles: path_at returned Isnt within paths_len bound"
                    );
                }
            };

            let entry = FileInfo {
                path,
                kind: FileKind::Regular,
            };
            // SAFETY: scheduler-plan analysis proves single-writer
            // access to `Column<FileInfo>`. The local-counter
            // `written_count` tracks the column length by construction
            // (column starts empty per run; DiscoverFiles is the only
            // writer; counter increments on each successful write).
            // Same pattern as LoadPlugins's loaded_count.
            unsafe {
                <Stub as ColumnWriterApi<W>>::write::<FileInfo>(
                    writer,
                    USize(written_count),
                    entry,
                );
            }
            written_count += 1; // lint:allow(no-bare-numeric) reason: column-length counter; tracked: #72
            i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
        }
    }
}
