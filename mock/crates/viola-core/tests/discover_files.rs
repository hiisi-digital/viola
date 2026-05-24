//! Compile-time AccessSet-shape assertion for `DiscoverFiles`.
//!
//! Same sealed `IsSame<X>` witness pattern as `tests/load_plugins.rs`
//! and `tests/load_config.rs`. Asserts the Slice 4 SRC CL Read and
//! Write cons-list shapes. The AccessSet matches body usage exactly:
//! Read holds only `Resource<DiscoveredFilePaths>`; Write holds only
//! `Column<FileInfo>`. Runtime projection tests defer to the follow-up
//! that ships a real test-Ctx fixture backing every Resource and Column
//! with concrete storage (inherits the Slice 2b and Slice 3 deferrals).

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use viola_core::resources::DiscoveredFilePaths;
use viola_core::wus::{DiscoverFiles, FileInfo};

trait IsSame<X: ?Sized> {}
impl<X: ?Sized> IsSame<X> for X {}

fn _assert_eq<T, X>()
where
    T: IsSame<X>,
{
}

#[test]
fn access_set_shape_compiles() {
    type ExpectedRead = Cons<Resource<DiscoveredFilePaths>, Empty>;
    type ExpectedWrite = Cons<Column<FileInfo>, Empty>;

    _assert_eq::<<DiscoverFiles as WorkUnit>::Read, ExpectedRead>();
    _assert_eq::<<DiscoverFiles as WorkUnit>::Write, ExpectedWrite>();
}
