//! `DiscoverFiles` reads workspace + config, writes the per-file set.
//!
//! Slice 1 ships the stub. Slice 4 implements the body: walks the
//! workspace filesystem honouring the config's include / exclude
//! patterns and writes one `FileInfo` per file under lint coverage.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::hint::{Adaptive, Immediate, Important};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;

use super::stub::WuCtxStub;
use super::{FileInfo, ViolaConfigOpaque};
use crate::resources::Workspace;

/// Reads workspace + config, writes the per-file set.
pub struct DiscoverFiles;

impl BuilderInput for DiscoverFiles {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for DiscoverFiles {
    type Read = Cons<Resource<Workspace>, Cons<Resource<ViolaConfigOpaque>, Empty>>;
    type Write = Cons<Column<FileInfo>, Empty>;
    type Hint = (Immediate, Adaptive, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, _ctx: &Self::Ctx<'frame>) {
        unimplemented!("Slice 4 implements DiscoverFiles")
    }
}
