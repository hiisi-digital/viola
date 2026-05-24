//! `LoadConfig` reads run context plus raw config bytes, writes the
//! parsed owned config.
//!
//! Slice 2a updates the AccessSet to the post-DOC-CL shape: three
//! Reads (`Workspace`, `RunSurface`, `ConfigBytes`) and two Writes
//! (`ViolaCfg`, `Column<WuDiagnostic>`). Slice 2b implements the body
//! that parses `Resource<ConfigBytes>` into `Resource<ViolaCfg>` and
//! writes a `Diagnostic` to `Column<WuDiagnostic>` on parse failure.

use arvo::USize;
use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::context::{
    ColumnWriterApi, HasColumnWriter, HasResourceProvider, ResourceProviderApi,
};
use hilavitkutin_api::hint::{Atomic, Immediate, Important};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use notko::{Maybe, Outcome};
use viola_config::{ConfigBytes, MAX_PLUGINS, ViolaCfg};
use viola_plugin_abi::{DiagnosticSeverity, RunSurface};

use super::stub::WuCtxStub;
use super::{WuDiagnostic, WuDiagnosticSource};
use crate::resources::Workspace;

/// Reads run context plus raw config bytes, writes the parsed owned config.
pub struct LoadConfig;

impl BuilderInput for LoadConfig {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for LoadConfig {
    type Read = Cons<Resource<Workspace>,
                Cons<Resource<RunSurface>,
                Cons<Resource<ConfigBytes>, Empty>>>;
    type Write = Cons<Resource<ViolaCfg>,
                 Cons<Column<WuDiagnostic>, Empty>>;
    type Hint = (Immediate, Atomic, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, ctx: &Self::Ctx<'frame>) {
        type R = <LoadConfig as WorkUnit>::Read;
        type W = <LoadConfig as WorkUnit>::Write;
        type Stub = <WuCtxStub<'static> as HasResourceProvider<R>>::Provider;

        // Read the raw config bytes from the Read set. The host shim populates
        // `Resource<ConfigBytes>` at scheduler-builder time; `len` tracks the
        // populated prefix of the fixed-cap buffer.
        let provider_r = <WuCtxStub<'frame> as HasResourceProvider<R>>::resources(ctx);
        let bytes_res: &ConfigBytes =
            <Stub as ResourceProviderApi<R>>::resource::<ConfigBytes>(provider_r);
        // `arvo::USize: Deref<Target = usize>` so `*bytes_res.len.0` walks
        // the documented unwrap door for the inner `USize` (`Cap` ships no
        // Deref impl today; `.0` projects to the inner `USize`). The std
        // slice index API consumes `usize`; the lint:allow names the
        // boundary.
        let populated: usize = *bytes_res.len.0; // lint:allow(no-bare-numeric) reason: std slice-index API consumes usize; tracked: #72
        let bytes = &bytes_res.bytes[..populated];

        match viola_config::parse::<MAX_PLUGINS>(bytes) {
            Outcome::Ok(borrowed) => {
                // Project the borrowed parser result into the owned form.
                // `Resource<ViolaCfg>` is in the Write set. `HasResourceProvider<R>`
                // is generic over R, so the Write set's accessor returns the
                // same provider type. The `&ViolaCfg` borrow carries interior
                // mutability via the bundled `ConfigArena` (Cell cursor plus
                // UnsafeCell buffer plus offsets table); the scheduler's
                // AccessSet contract serialises this producer slot.
                let provider_w = <WuCtxStub<'frame> as HasResourceProvider<W>>::resources(ctx);
                let owned: &ViolaCfg =
                    <Stub as ResourceProviderApi<W>>::resource::<ViolaCfg>(provider_w);
                owned.populate_from_borrowed(&borrowed);
            }
            Outcome::Err(_err) => {
                // Emit one diagnostic at index 0 of `Column<WuDiagnostic>`.
                // The column is sized for the parse-failure case by the host
                // shim. The parser's `ConfigError` carries no span data today;
                // future producers fill `range` per their surface.
                // TODO(viola #254 follow-up): the host-shim long-lived
                // interner is what populates the message string on the real
                // run path. The public `Str` surface ships only `__make` /
                // `__runtime` constructors gated by `Bits<28, Hot>` ids. The
                // default (id 0) handle is the placeholder until the
                // interner is registered at scheduler-builder time.
                let diag = WuDiagnostic {
                    severity: DiagnosticSeverity::Error,
                    source: WuDiagnosticSource::ConfigParse,
                    message: hilavitkutin_str::Str::default(),
                    range: Maybe::Isnt,
                };
                let writer = <WuCtxStub<'frame> as HasColumnWriter<W>>::writer(ctx);
                // SAFETY: the host shim is contracted to size
                // `Column<WuDiagnostic>` for at least one parse-failure
                // record, so index 0 is in-bounds. The scheduler's
                // AccessSet analysis serialises this Write slot; no fused
                // writer races with us. Index 0 is the convention for the
                // one-shot parse-failure path; producer slices with many
                // diagnostics will use a per-fiber length counter when
                // hilavitkutin-api exposes a `Column::len` accessor on the
                // writer side.
                unsafe {
                    <Stub as ColumnWriterApi<W>>::write::<WuDiagnostic>(writer, USize(0), diag); // lint:allow(no-bare-numeric) reason: append-at-zero in the single-producer one-shot column; tracked: #72
                }
            }
        }
    }
}
