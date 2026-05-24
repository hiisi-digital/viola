//! Compile-time AccessSet-shape assertion for `RunLint<L>`.
//!
//! Same sealed `IsSame<X>` witness pattern as `tests/load_plugins.rs`,
//! `tests/load_config.rs`, `tests/discover_files.rs`, and
//! `tests/run_runner.rs`. Asserts the Slice 6b SRC CL Read and Write
//! cons-list shapes. Picks `L = 0` for the witness; the AccessSet
//! shape is identical across `L`.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use viola_core::resources::{DiagnosticCounts, ExtensionHost, LintConfigBuffer, LintSlots};
use viola_core::wus::{Nam, RunLint, WuDiagnostic};

trait IsSame<X: ?Sized> {}
impl<X: ?Sized> IsSame<X> for X {}

fn _assert_eq<T, X>()
where
    T: IsSame<X>,
{
}

#[test]
fn access_set_shape_compiles() {
    type ExpectedRead = Cons<
        Resource<ExtensionHost>,
        Cons<
            Resource<LintSlots>,
            Cons<Resource<LintConfigBuffer>, Cons<Column<Nam>, Empty>>,
        >,
    >;
    type ExpectedWrite = Cons<Column<WuDiagnostic>, Cons<Resource<DiagnosticCounts>, Empty>>;

    _assert_eq::<<RunLint<0> as WorkUnit>::Read, ExpectedRead>();
    _assert_eq::<<RunLint<0> as WorkUnit>::Write, ExpectedWrite>();
}
