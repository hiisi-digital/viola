//! `RunRunner` reads files, writes per-file NAM snapshots.
//!
//! Slice 1 ships the stub. Slice 5 implements the body: invokes the
//! runner plugin once per `FileInfo` to produce a `Nam` snapshot. This
//! is the per-file parse pass that dominates wall-time.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::hint::{Adaptive, Important, Steady};
use hilavitkutin_api::store::Column;
use hilavitkutin_api::work_unit::WorkUnit;

use super::stub::WuCtxStub;
use super::{FileInfo, Nam};

/// Reads files, writes per-file NAM snapshots.
pub struct RunRunner;

impl BuilderInput for RunRunner {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for RunRunner {
    type Read = Cons<Column<FileInfo>, Empty>;
    type Write = Cons<Column<Nam>, Empty>;
    type Hint = (Steady, Adaptive, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, _ctx: &Self::Ctx<'frame>) {
        unimplemented!("Slice 5 implements RunRunner")
    }
}
