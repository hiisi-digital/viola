//! `RunLint<const L: usize>` reads NAM snapshots, writes findings.
//!
//! The only generic WU in Slice 1. The const generic `L` indexes into
//! the lint plugin set; the engine monomorphises one impl per lint at
//! plan time per the cdylib boundary memo at
//! `mock/research/202605232100_workunit-cdylib-boundary.md`. Slice 1
//! ships the unbounded `const L: usize`. Slice 6 introduces an
//! `arvo::Cap<MAX_LINTS>`-bounded variant once `MAX_LINTS` is wired
//! through `viola_plugin_abi`.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::hint::{Adaptive, Important, Steady};
use hilavitkutin_api::store::Column;
use hilavitkutin_api::work_unit::WorkUnit;

use super::stub::WuCtxStub;
use super::{Nam, WuDiagnostic};

/// Reads NAM snapshots, writes findings. `L` indexes the lint plugin.
pub struct RunLint<const L: usize>;

impl<const L: usize> BuilderInput for RunLint<L> {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl<const L: usize> WorkUnit for RunLint<L> {
    type Read = Cons<Column<Nam>, Empty>;
    type Write = Cons<Column<WuDiagnostic>, Empty>;
    type Hint = (Steady, Adaptive, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    /// Parallel fan-out claim per Slice 6a: `RunLint<0>..RunLint<MAX_LINTS - 1>`
    /// write to disjoint per-L row ranges of `Column<WuDiagnostic>`, so the
    /// scheduler can dispatch them concurrently under the COMMUTATIVE flag.
    /// Slice 9 audits the landed hilavitkutin dispatch codegen to confirm
    /// the flag yields reduce-style parallel fan-out (vs serialising).
    const COMMUTATIVE: arvo::Bool = arvo::Bool::TRUE;

    fn execute<'frame>(&self, _ctx: &Self::Ctx<'frame>) {
        unimplemented!("Slice 6b implements RunLint")
    }
}
