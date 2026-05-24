//! `LoadConfig` reads run context plus raw config bytes, writes the
//! parsed owned config.
//!
//! Slice 2a updates the AccessSet to the post-DOC-CL shape: three
//! Reads (`Workspace`, `RunSurface`, `ConfigBytes`) and two Writes
//! (`ViolaCfg`, `Column<Diagnostic>`). Slice 2b implements the body
//! that parses `Resource<ConfigBytes>` into `Resource<ViolaCfg>` and
//! writes a `Diagnostic` to `Column<Diagnostic>` on parse failure.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::hint::{Atomic, Immediate, Important};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use viola_config::{ConfigBytes, ViolaCfg};
use viola_plugin_abi::RunSurface;

use super::stub::WuCtxStub;
use super::Diagnostic;
use crate::resources::Workspace;

/// Reads run context plus raw config bytes, writes the parsed owned config.
pub struct LoadConfig;

impl BuilderInput for LoadConfig {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for LoadConfig {
    type Read = Cons<Resource<Workspace>,
                Cons<Resource<RunSurface>,
                Cons<Resource<ConfigBytes>, Empty>>>;
    type Write = Cons<Resource<ViolaCfg>,
                 Cons<Column<Diagnostic>, Empty>>;
    type Hint = (Immediate, Atomic, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, _ctx: &Self::Ctx<'frame>) {
        unimplemented!("Slice 2b implements LoadConfig")
    }
}
