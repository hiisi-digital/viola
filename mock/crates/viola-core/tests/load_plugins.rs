//! Compile-time AccessSet-shape assertion for `LoadPlugins`.
//!
//! Same sealed `IsSame<X>` witness pattern as `tests/load_config.rs`.
//! Asserts `<LoadPlugins as WorkUnit>::Read` and `Write` are the
//! cons-list shapes the Slice 3 SRC CL committed. Runtime parse-and-
//! load tests defer to the follow-up that ships a real test-Ctx
//! fixture backing every Resource and Column with concrete storage
//! (inherits the Slice 2b deferral).

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use viola_config::ViolaCfg;
use viola_core::resources::ExtensionHost;
use viola_core::wus::{LoadPlugins, PluginEntry, WuDiagnostic};

trait IsSame<X: ?Sized> {}
impl<X: ?Sized> IsSame<X> for X {}

fn _assert_eq<T, X>()
where
    T: IsSame<X>,
{
}

#[test]
fn access_set_shape_compiles() {
    type ExpectedRead = Cons<Resource<ViolaCfg>, Empty>;
    type ExpectedWrite = Cons<
        Resource<ExtensionHost>,
        Cons<Column<PluginEntry>, Cons<Column<WuDiagnostic>, Empty>>,
    >;

    _assert_eq::<<LoadPlugins as WorkUnit>::Read, ExpectedRead>();
    _assert_eq::<<LoadPlugins as WorkUnit>::Write, ExpectedWrite>();
}
