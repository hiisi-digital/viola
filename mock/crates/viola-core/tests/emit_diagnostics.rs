//! Compile-time AccessSet-shape assertion for `EmitDiagnostics<W>`.
//!
//! Same sealed `IsSame<X>` witness pattern as the sibling
//! `tests/run_lint.rs`. Asserts the Slice 7b SRC CL Read and Write
//! cons-list shapes. Picks `W = EmitFlat` (no-op default impl) so the
//! witness compiles without pulling viola-cli's concrete egress
//! writer into the test build.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use viola_core::resources::DiagnosticCounts;
use viola_core::wus::{DiagnosticSink, EmitDiagnostics, EmitFlat, WuDiagnostic};

trait IsSame<X: ?Sized> {}
impl<X: ?Sized> IsSame<X> for X {}

fn _assert_eq<T, X>()
where
    T: IsSame<X>,
{
}

#[test]
fn access_set_shape_compiles() {
    type ExpectedRead = Cons<Resource<DiagnosticCounts>, Cons<Column<WuDiagnostic>, Empty>>;
    type ExpectedWrite = Cons<Resource<DiagnosticSink<EmitFlat>>, Empty>;

    _assert_eq::<<EmitDiagnostics<EmitFlat> as WorkUnit>::Read, ExpectedRead>();
    _assert_eq::<<EmitDiagnostics<EmitFlat> as WorkUnit>::Write, ExpectedWrite>();
}
