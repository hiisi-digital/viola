//! Compile-time AccessSet-shape assertion for `LoadConfig`.
//!
//! The witness-trait pattern: a sealed `IsSame<X>` trait whose only impl
//! is `X: IsSame<X>`. Calling `_assert::<T, X>()` typechecks iff `T == X`.
//! No body, no runtime fixture, no host-shim interner: this test is the
//! type system proving the AccessSet shape stayed put after Slice 2b's
//! ResourceProviderApi rewiring.
//!
//! Runtime tests for the parse-success and parse-failure paths live behind
//! the host-shim interner and a real Ctx fixture that backs every
//! `Resource<...>` and `Column<...>` with concrete storage. Both are
//! out of scope for the partial body PR; the
//! `mock/crates/viola-core/SHAME.md.tmpl` entry tracks the gap.

use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use viola_config::{ConfigBytes, ViolaCfg};
use viola_core::resources::Workspace;
use viola_core::wus::{LoadConfig, WuDiagnostic};
use viola_plugin_abi::RunSurface;

/// Sealed witness: `T: IsSame<X>` holds only when `T == X`.
trait IsSame<X: ?Sized> {}
impl<X: ?Sized> IsSame<X> for X {}

/// Free fn that compiles only when `T` and `X` are the same type.
fn _assert_eq<T, X>()
where
    T: IsSame<X>,
{
}

#[test]
fn access_set_shape_compiles() {
    type ExpectedRead = Cons<
        Resource<Workspace>,
        Cons<Resource<RunSurface>, Cons<Resource<ConfigBytes>, Empty>>,
    >;
    type ExpectedWrite = Cons<Resource<ViolaCfg>, Cons<Column<WuDiagnostic>, Empty>>;

    _assert_eq::<<LoadConfig as WorkUnit>::Read, ExpectedRead>();
    _assert_eq::<<LoadConfig as WorkUnit>::Write, ExpectedWrite>();
}
