//! Shared `Ctx<'frame>` placeholder for the Slice 1 WU stubs.
//!
//! The WorkUnit trait requires `Ctx<'frame>` to satisfy seven `Has*`
//! accessor bounds. Until each body slice wires the engine's real Ctx
//! into dispatch, the placeholder + `Stub` form a trivially satisfied
//! type that lets each WU stub impl typecheck. Each body slice
//! replaces this placeholder with the engine-generated Ctx for its own
//! WU; nothing in `Stub` ever runs in production.

use core::marker::PhantomData;

use arvo::USize;
use hilavitkutin_api::access::AccessSet;
use hilavitkutin_api::column_value::ColumnValue;
use hilavitkutin_api::context::{
    BatchApi, ColumnReaderApi, ColumnWriterApi, EachApi, HasBatch, HasColumnReader,
    HasColumnWriter, HasEach, HasReduce, HasResourceProvider, HasVirtualFirer, ReduceApi,
    ResourceProviderApi, VirtualFirerApi,
};
use hilavitkutin_api::store::{Column, Resource, Virtual};
use hilavitkutin_api::Contains;

/// Slice 1 placeholder Ctx. One type, shared across every WU stub.
pub struct WuCtxStub<'frame> {
    _phantom: PhantomData<&'frame ()>,
    stub: Stub,
}

impl Default for WuCtxStub<'_> {
    fn default() -> Self {
        Self {
            _phantom: PhantomData,
            stub: Stub,
        }
    }
}

/// Provider stub satisfying every accessor `*Api` with `unimplemented!()`.
///
/// Implementation detail of `WuCtxStub`. Must be `pub` because it appears
/// as `type Provider = Stub` in the trait impls for `WuCtxStub`, which
/// makes it part of `WuCtxStub`'s public interface (`E0446` otherwise).
/// Not re-exported at the `wus::` path. The `*Api` impls all panic
/// before touching any memory; the `unsafe` on the read/write signatures
/// is inherited from the trait, not load-bearing on these stubs.
pub struct Stub;

impl<R: AccessSet> ColumnReaderApi<R> for Stub {
    // SAFETY: stub body panics before reading; no memory is dereferenced.
    unsafe fn read<T: ColumnValue>(&self, _i: USize) -> T
    where
        R: Contains<Column<T>>,
    {
        unimplemented!("viola Slice 1 stub Ctx; engine Ctx supersedes it")
    }
}

impl<W: AccessSet> ColumnWriterApi<W> for Stub {
    // SAFETY: stub body panics before writing; no memory is dereferenced.
    unsafe fn write<T: ColumnValue>(&self, _i: USize, _v: T)
    where
        W: Contains<Column<T>>,
    {
        unimplemented!("viola Slice 1 stub Ctx; engine Ctx supersedes it")
    }
}

impl<R: AccessSet> ResourceProviderApi<R> for Stub {
    fn resource<T: 'static>(&self) -> &T
    where
        R: Contains<Resource<T>>,
    {
        unimplemented!("viola Slice 1 stub Ctx; engine Ctx supersedes it")
    }
}

impl<W: AccessSet> VirtualFirerApi<W> for Stub {
    fn fire<V: 'static>(&self)
    where
        W: Contains<Virtual<V>>,
    {
        unimplemented!("viola Slice 1 stub Ctx; engine Ctx supersedes it")
    }
}

impl<R: AccessSet, W: AccessSet> EachApi<R, W> for Stub {
    fn run<F>(&self, _f: F)
    where
        F: FnMut(USize),
    {
        unimplemented!("viola Slice 1 stub Ctx; engine Ctx supersedes it")
    }
}

impl<R: AccessSet, W: AccessSet> BatchApi<R, W> for Stub {
    fn run<F>(&self, _f: F)
    where
        F: FnMut(USize, USize),
    {
        unimplemented!("viola Slice 1 stub Ctx; engine Ctx supersedes it")
    }
}

impl<R: AccessSet, W: AccessSet> ReduceApi<R, W> for Stub {
    fn run<A, F>(&self, init: A, _f: F) -> A
    where
        A: 'static,
        F: FnMut(A, USize) -> A,
    {
        let _ = init;
        unimplemented!("viola Slice 1 stub Ctx; engine Ctx supersedes it")
    }
}

impl<'frame, R: AccessSet> HasColumnReader<R> for WuCtxStub<'frame> {
    type Provider = Stub;
    fn reader(&self) -> &Stub {
        &self.stub
    }
}

impl<'frame, W: AccessSet> HasColumnWriter<W> for WuCtxStub<'frame> {
    type Provider = Stub;
    fn writer(&self) -> &Stub {
        &self.stub
    }
}

impl<'frame, R: AccessSet> HasResourceProvider<R> for WuCtxStub<'frame> {
    type Provider = Stub;
    fn resources(&self) -> &Stub {
        &self.stub
    }
}

impl<'frame, W: AccessSet> HasVirtualFirer<W> for WuCtxStub<'frame> {
    type Provider = Stub;
    fn virtuals(&self) -> &Stub {
        &self.stub
    }
}

impl<'frame, R: AccessSet, W: AccessSet> HasEach<R, W> for WuCtxStub<'frame> {
    type Provider = Stub;
    fn each(&self) -> &Stub {
        &self.stub
    }
}

impl<'frame, R: AccessSet, W: AccessSet> HasBatch<R, W> for WuCtxStub<'frame> {
    type Provider = Stub;
    fn batch(&self) -> &Stub {
        &self.stub
    }
}

impl<'frame, R: AccessSet, W: AccessSet> HasReduce<R, W> for WuCtxStub<'frame> {
    type Provider = Stub;
    fn reduce(&self) -> &Stub {
        &self.stub
    }
}
