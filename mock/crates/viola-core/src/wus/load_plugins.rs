//! `LoadPlugins` reads parsed config, writes the discovered plugin set.
//!
//! Slice 1 ships the stub. Slice 3 implements the body: resolves the
//! config's plugin manifest entries, dlopens each through
//! `hilavitkutin-extensions`, verifies ABI, and pushes one
//! `PluginEntry` per loaded plugin.

use arvo::USize;
use hilavitkutin_api::access::{Cons, Empty};
use hilavitkutin_api::builder_input::{BuilderInput, UnitDispatch};
use hilavitkutin_api::context::{
    ColumnWriterApi, HasColumnWriter, HasResourceProvider, ResourceProviderApi,
};
use hilavitkutin_api::hint::{Atomic, Immediate, Important};
use hilavitkutin_api::store::{Column, Resource};
use hilavitkutin_api::work_unit::WorkUnit;
use hilavitkutin_extensions::{
    AbiVersion, DESCRIPTOR_SYMBOL, ExtensionDescriptor, ExtensionError,
};
use hilavitkutin_linking::Library;
use notko::{Maybe, Outcome};
use viola_plugin_abi::{
    DiagnosticSeverity, PROVIDER_GRAMMAR_EXTRACT, PROVIDER_LINT_EVALUATE,
    PROVIDER_RUNNER_EXECUTE_SCOPE,
};

use super::stub::WuCtxStub;
use super::{PluginEntry, WuDiagnostic, WuDiagnosticSource};
use crate::resources::ExtensionHost;
use crate::role::Mask64;
use viola_config::ViolaCfg;

/// Maximum byte length the null-termination helper can stage on the
/// stack for one plugin path. Paths longer than this fail to load
/// with a `PluginLoad` diagnostic rather than overflow the buffer.
const PATH_MAX_BYTES: usize = 4096; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: fixed-cap stack buffer size for null-term path; tracked: #72

/// Reads config, writes the discovered plugin set.
pub struct LoadPlugins;

impl BuilderInput for LoadPlugins {
    type Init = Self;
    type Dispatch = UnitDispatch<Self>;
}

impl WorkUnit for LoadPlugins {
    type Read = Cons<Resource<ViolaCfg>, Empty>;
    type Write = Cons<Resource<ExtensionHost>,
                 Cons<Column<PluginEntry>,
                 Cons<Column<WuDiagnostic>, Empty>>>;
    type Hint = (Immediate, Atomic, Important);
    type Ctx<'frame> = WuCtxStub<'frame>;

    fn execute<'frame>(&self, ctx: &Self::Ctx<'frame>) {
        type R = <LoadPlugins as WorkUnit>::Read;
        type W = <LoadPlugins as WorkUnit>::Write;
        // `Provider` is the inner stub type held by the WuCtxStub. The
        // associated type is lifetime-invariant in the current Slice 1
        // shape, so projecting through `WuCtxStub<'static>` gives the
        // same type as `WuCtxStub<'frame>`. If `Provider` ever becomes
        // lifetime-dependent, this projection needs the `'frame` form.
        type Stub = <WuCtxStub<'static> as HasResourceProvider<R>>::Provider;

        let cfg: &ViolaCfg = <Stub as ResourceProviderApi<R>>::resource::<ViolaCfg>(
            <WuCtxStub<'frame> as HasResourceProvider<R>>::resources(ctx),
        );
        let host: &ExtensionHost =
            <Stub as ResourceProviderApi<W>>::resource::<ExtensionHost>(
                <WuCtxStub<'frame> as HasResourceProvider<W>>::resources(ctx),
            );
        let writer = <WuCtxStub<'frame> as HasColumnWriter<W>>::writer(ctx);

        let n: usize = *cfg.plugins_len().0; // lint:allow(no-bare-numeric) reason: bridges arvo::Cap to slot count; tracked: #72
        let mut loaded_count: usize = 0; // lint:allow(no-bare-numeric) reason: local column-length counter; tracked: #72
        let mut failure_count: usize = 0; // lint:allow(no-bare-numeric) reason: local diag-column index counter; tracked: #72
        let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
        while i < n {
            let path: &str = match cfg.plugin_path(arvo::Cap(USize(i))) {
                Maybe::Is(s) => s,
                Maybe::Isnt => {
                    i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
                    continue;
                }
            };

            let bytes = path.as_bytes();
            let path_len = bytes.len(); // lint:allow(no-bare-numeric) reason: slice len projects to usize at the std boundary; tracked: #72
            if path_len >= PATH_MAX_BYTES { // lint:allow(no-bare-numeric) reason: PATH_MAX_BYTES is the stack-buffer cap; the >= form avoids usize::MAX overflow on path_len + 1; tracked: #72
                emit_diag(writer, &mut failure_count);
                i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
                continue;
            }
            let mut buf: [u8; PATH_MAX_BYTES] = [0u8; PATH_MAX_BYTES]; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: stack-fixed-cap byte buffer for null-term path; tracked: #72
            buf[..path_len].copy_from_slice(bytes);
            // buf[path_len] is already 0u8 from the zero-init, giving
            // the trailing NUL byte that Library::load expects.

            let lib = match Library::load(&buf[..path_len + 1]) { // lint:allow(no-bare-numeric) reason: slice-end index includes the trailing NUL; tracked: #72
                Outcome::Ok(l) => l,
                Outcome::Err(_e) => {
                    emit_diag(writer, &mut failure_count);
                    i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
                    continue;
                }
            };

            let (roles, abi_version) = match resolve_descriptor(&lib) {
                Outcome::Ok(t) => t,
                Outcome::Err(_e) => {
                    // Lib drops at scope-end; no manual cleanup needed.
                    emit_diag(writer, &mut failure_count);
                    i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
                    continue;
                }
            };

            // SAFETY: `host.push` requires `loaded_len < MAX_PLUGINS`.
            // Invariant chain at this call site:
            //   - every loop iteration increments `i` (including
            //     failure-arm `continue` paths above);
            //   - only the success arm increments `loaded_count`;
            //   - therefore `loaded_count <= i` always holds.
            // The loop guard `i < n` plus `populate_from_borrowed`'s
            // clamp `n <= MAX_PLUGINS_CAP` (= workspace `MAX_PLUGINS`)
            // gives the full chain `loaded_count <= i < n <=
            // MAX_PLUGINS`. `host.push` also asserts at runtime; this
            // SAFETY note is double-protected.
            let host_idx = unsafe { host.push(lib) };
            let entry = PluginEntry {
                name: hilavitkutin_str::Str::default(),
                roles,
                abi_version,
                host_idx,
            };
            // SAFETY: scheduler-plan analysis proves single-writer
            // access to `Column<PluginEntry>`. The local-counter
            // `loaded_count` tracks the column length by construction
            // (column starts empty per run; LoadPlugins is the only
            // writer; counter increments on each successful push).
            unsafe {
                <Stub as ColumnWriterApi<W>>::write::<PluginEntry>(
                    writer,
                    USize(loaded_count),
                    entry,
                );
            }
            loaded_count += 1; // lint:allow(no-bare-numeric) reason: column-length counter; tracked: #72
            i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
        }
    }
}

/// Resolves the descriptor symbol from `lib`, delegates contract
/// validation to `hilavitkutin_extensions::validate_descriptor`, and
/// derives the role `Mask64` from the descriptor's provider table.
///
/// Per `use-the-stack-not-reinvent.md`, the tag / size / abi / name /
/// bounds checks live in `hilavitkutin-extensions`; viola only adds
/// the role-mask derivation on top.
fn resolve_descriptor(lib: &Library) -> Outcome<(Mask64, AbiVersion), ExtensionError> {
    type DescriptorFn = extern "C" fn() -> *const ExtensionDescriptor;
    let sym = match lib.resolve::<DescriptorFn>(DESCRIPTOR_SYMBOL.to_bytes_with_nul()) {
        Outcome::Ok(s) => s,
        Outcome::Err(_) => return Outcome::Err(ExtensionError::DescriptorMissing),
    };
    let ptr = (sym.get())();
    if ptr.is_null() {
        return Outcome::Err(ExtensionError::DescriptorInvalid);
    }
    // SAFETY: per the canonical pattern in
    // `hilavitkutin_extensions::Host::load_inner` (the loader's
    // descriptor read path). The descriptor points at extension-static
    // memory valid for the loaded library's lifetime; the host keeps
    // the `Library` alive inside `Resource<ExtensionHost>` for the
    // duration of the scheduler run, so the `&'static` tightening is
    // sound.
    let descriptor: &'static ExtensionDescriptor = unsafe { &*ptr };

    if let Outcome::Err(err) = hilavitkutin_extensions::validate_descriptor(descriptor) {
        return Outcome::Err(err);
    }

    let mut roles: Mask64 = arvo_bitmask::Mask::empty();
    let n: usize = descriptor.providers_len as usize; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: u32 ABI field projects to usize for slice iteration; tracked: #72
    let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
    // Unknown `ProviderId` entries are silently dropped from the
    // role mask. The host advertises only the role bits it understands;
    // future viola roles add new bit positions here. Extension-side
    // additions outside this match are valid extension content but
    // do not contribute to the viola role classification.
    while i < n {
        // SAFETY: providers_ptr and providers_len validated by
        // `validate_descriptor` above; the slice is initialised by
        // the extension before the descriptor function returns it.
        let entry = unsafe { *descriptor.providers_ptr.add(i) };
        if entry.id == PROVIDER_RUNNER_EXECUTE_SCOPE {
            roles.insert(USize(0)); // lint:allow(no-bare-numeric) reason: runner role bit position; tracked: #72
        } else if entry.id == PROVIDER_GRAMMAR_EXTRACT {
            roles.insert(USize(1)); // lint:allow(no-bare-numeric) reason: grammar role bit position; tracked: #72
        } else if entry.id == PROVIDER_LINT_EVALUATE {
            roles.insert(USize(2)); // lint:allow(no-bare-numeric) reason: lint role bit position; tracked: #72
        }
        i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
    }

    Outcome::Ok((roles, descriptor.abi_version))
}

fn emit_diag(
    writer: &<WuCtxStub<'static> as HasColumnWriter<<LoadPlugins as WorkUnit>::Write>>::Provider,
    failure_count: &mut usize,
) {
    type W = <LoadPlugins as WorkUnit>::Write;
    type Stub = <WuCtxStub<'static> as HasColumnWriter<W>>::Provider;
    let diag = WuDiagnostic {
        severity: DiagnosticSeverity::Error,
        source: WuDiagnosticSource::PluginLoad,
        message: hilavitkutin_str::Str::default(),
        range: Maybe::Isnt,
    };
    // SAFETY: scheduler-plan analysis proves single-writer access to
    // `Column<WuDiagnostic>`. The failure-counter tracks the column
    // length by construction for the same reasons as the PluginEntry-
    // side loaded_count counter.
    unsafe {
        <Stub as ColumnWriterApi<W>>::write::<WuDiagnostic>(
            writer,
            USize(*failure_count),
            diag,
        );
    }
    *failure_count += 1; // lint:allow(no-bare-numeric) reason: failure counter increment; tracked: #72
}
