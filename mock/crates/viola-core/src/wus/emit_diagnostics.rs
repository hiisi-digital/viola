//! `EmitDiagnostics` reads findings, writes them to the egress sink.
//!
//! Slice 1 ships the stub. Slice 7 implements the body: sorts the
//! `Column<WuDiagnostic>` deterministically per the aggregate comparator
//! and writes each finding through the sink to stderr / JSON / LSP.
//! Per `hilavitkutin-workunit-mental-model`, services accessed for
//! mutation live in the Write set, not as side effects.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::hint::{Atomic, Important, Relaxed};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;

use super::stub::WuCtxStub;
use super::{DiagnosticSink, WuDiagnostic};

/// Reads findings, writes them to the egress sink.
pub struct EmitDiagnostics;

impl BuilderInput for EmitDiagnostics {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for EmitDiagnostics {
    type Read = Cons<Column<WuDiagnostic>, Empty>;
    type Write = Cons<Resource<DiagnosticSink>, Empty>;
    type Hint = (Relaxed, Atomic, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, _ctx: &Self::Ctx<'frame>) {
        unimplemented!("Slice 7 implements EmitDiagnostics")
    }
}
