//! `LoadConfig` reads run context, writes parsed viola config.
//!
//! Slice 1 ships the stub. Slice 2 implements the body: parses the
//! TOML config under the workspace path, projects the surface-relevant
//! section, and writes the result into `Resource<ViolaConfigOpaque>`.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::hint::{Atomic, Immediate, Important};
use hilavitkutin_api::store::Resource;
use hilavitkutin_api::work_unit::WorkUnit;
use viola_plugin_abi::RunSurface;

use super::stub::WuCtxStub;
use super::ViolaConfigOpaque;
use crate::resources::Workspace;

/// Reads run context, writes parsed viola config.
pub struct LoadConfig;

impl BuilderInput for LoadConfig {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for LoadConfig {
    type Read = Cons<Resource<Workspace>, Cons<Resource<RunSurface>, Empty>>;
    type Write = Cons<Resource<ViolaConfigOpaque>, Empty>;
    type Hint = (Immediate, Atomic, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, _ctx: &Self::Ctx<'frame>) {
        unimplemented!("Slice 2 implements LoadConfig")
    }
}
