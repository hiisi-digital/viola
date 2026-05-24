//! `LoadPlugins` reads parsed config, writes the discovered plugin set.
//!
//! Slice 1 ships the stub. Slice 3 implements the body: resolves the
//! config's plugin manifest entries, dlopens each through
//! `hilavitkutin-extensions`, verifies ABI, and pushes one
//! `PluginEntry` per loaded plugin.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::hint::{Atomic, Immediate, Important};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;

use super::stub::WuCtxStub;
use super::{PluginEntry, ViolaConfigOpaque};

/// Reads config, writes the discovered plugin set.
pub struct LoadPlugins;

impl BuilderInput for LoadPlugins {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for LoadPlugins {
    type Read = Cons<Resource<ViolaConfigOpaque>, Empty>;
    type Write = Cons<Column<PluginEntry>, Empty>;
    type Hint = (Immediate, Atomic, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, _ctx: &Self::Ctx<'frame>) {
        unimplemented!("Slice 3 implements LoadPlugins")
    }
}
