//! Compile-time AccessSet-shape assertion for `RunRunner`.
//!
//! Same sealed `IsSame<X>` witness pattern as `tests/load_plugins.rs`,
//! `tests/load_config.rs`, and `tests/discover_files.rs`. Asserts the
//! Slice 5b SRC CL Read and Write cons-list shapes. Runtime tests
//! against `viola-test-runner-fixture` defer to the follow-up that
//! ships the shared runtime test-Ctx fixture (inherits the Slice 2b,
//! 3, 4 deferrals).

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use viola_core::resources::{CiState, ExtensionHost, FileEntryBuffer};
use viola_core::wus::{Nam, PluginEntry, RunRunner, WuDiagnostic};

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
        Resource<CiState>,
        Cons<
            Resource<ExtensionHost>,
            Cons<Column<PluginEntry>, Cons<Resource<FileEntryBuffer>, Empty>>,
        >,
    >;
    type ExpectedWrite = Cons<Column<Nam>, Cons<Column<WuDiagnostic>, Empty>>;

    _assert_eq::<<RunRunner as WorkUnit>::Read, ExpectedRead>();
    _assert_eq::<<RunRunner as WorkUnit>::Write, ExpectedWrite>();
}
