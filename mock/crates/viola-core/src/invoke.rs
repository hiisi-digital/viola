//! Typed vtable resolvers for the three v1 viola providers.
//!
//! Bridges the raw `*const c_void` returned by
//! `hilavitkutin_extensions::Extension::provider` into the
//! `#[repr(C)]` vtable shapes pinned in
//! [`viola_plugin_abi::vtable`]. Resolution is a thin pointer cast plus
//! a non-null check.

use core::ffi::c_void;

use hilavitkutin_extensions::Extension;
use notko::Maybe;
use viola_plugin_abi::{
    PROVIDER_GRAMMAR_EXTRACT, PROVIDER_LINT_EVALUATE, PROVIDER_RUNNER_EXECUTE_SCOPE,
    GrammarExtractVtable, LintEvaluateVtable, RunnerExecuteScopeVtable,
};

/// Resolve the runner role's vtable. Absent or null pointer -> `Isnt`.
pub fn runner_vtable<'a>(
    ext: &'a Extension,
) -> Maybe<&'a RunnerExecuteScopeVtable> {
    cast(ext.provider(PROVIDER_RUNNER_EXECUTE_SCOPE))
}

/// Resolve the grammar role's vtable.
pub fn grammar_vtable<'a>(
    ext: &'a Extension,
) -> Maybe<&'a GrammarExtractVtable> {
    cast(ext.provider(PROVIDER_GRAMMAR_EXTRACT))
}

/// Resolve the lint role's vtable.
pub fn lint_vtable<'a>(ext: &'a Extension) -> Maybe<&'a LintEvaluateVtable> {
    cast(ext.provider(PROVIDER_LINT_EVALUATE))
}

fn cast<'a, T>(raw: Maybe<*const c_void>) -> Maybe<&'a T> {
    match raw {
        Maybe::Is(ptr) if !ptr.is_null() => {
            // SAFETY: the extension's ProviderExport pins the pointee
            // at a `&'static T` cast inside the loaded library. The
            // returned borrow is tied to the Extension reference's
            // lifetime, so the OS handle and descriptor memory remain
            // resident for the duration of any read.
            Maybe::Is(unsafe { &*(ptr as *const T) })
        }
        _ => Maybe::Isnt,
    }
}

/// Resolve the runner role's vtable directly from a loaded `Library`
/// without going through the pre-#254 `Extension` shape.
///
/// Walks the descriptor's provider table per the Slice 3
/// `resolve_descriptor` pattern. Delegates tag and version validation
/// to `hilavitkutin_extensions::validate_descriptor`.
///
/// Returns `Maybe::Isnt` when the descriptor symbol is missing, the
/// descriptor pointer is null, `validate_descriptor` rejects the
/// descriptor, the runner provider is not present in the descriptor's
/// provider table, or the vtable pointer is null.
pub fn runner_vtable_from_library(
    lib: &hilavitkutin_linking::Library,
) -> Maybe<&'static RunnerExecuteScopeVtable> {
    use hilavitkutin_extensions::{DESCRIPTOR_SYMBOL, ExtensionDescriptor};
    use notko::Outcome;

    type DescriptorFn = extern "C" fn() -> *const ExtensionDescriptor;
    let sym = match lib.resolve::<DescriptorFn>(DESCRIPTOR_SYMBOL.to_bytes_with_nul()) {
        Outcome::Ok(s) => s,
        Outcome::Err(_) => return Maybe::Isnt,
    };
    let ptr = (sym.get())();
    if ptr.is_null() {
        return Maybe::Isnt;
    }
    // SAFETY: the descriptor pointer addresses extension-static memory
    // valid for the loaded library's lifetime; the host keeps the
    // library alive inside `Resource<ExtensionHost>` for the duration
    // of the scheduler run.
    let descriptor: &'static ExtensionDescriptor = unsafe { &*ptr };

    if let Outcome::Err(_) = hilavitkutin_extensions::validate_descriptor(descriptor) {
        return Maybe::Isnt;
    }

    let n: usize = descriptor.providers_len as usize; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: u32 ABI field projects to usize for slice iteration; tracked: #72
    let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
    while i < n {
        // SAFETY: providers_ptr and providers_len validated by
        // `validate_descriptor` above; the slice is initialised by the
        // extension before the descriptor function returns it.
        let entry = unsafe { *descriptor.providers_ptr.add(i) };
        if entry.id == PROVIDER_RUNNER_EXECUTE_SCOPE {
            if entry.vtable_ptr.is_null() {
                return Maybe::Isnt;
            }
            // SAFETY: provider table guarantees the vtable_ptr targets
            // a `&'static RunnerExecuteScopeVtable` inside the loaded
            // library. The descriptor walk's null-check above the only
            // soundness gate.
            return Maybe::Is(unsafe {
                &*(entry.vtable_ptr as *const RunnerExecuteScopeVtable)
            });
        }
        i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
    }
    Maybe::Isnt
}

/// Resolve the lint role's vtable directly from a loaded `Library`
/// without going through the pre-#254 `Extension` shape.
///
/// Parallels `runner_vtable_from_library`. Walks the descriptor's
/// provider table looking for `PROVIDER_LINT_EVALUATE`.
///
/// Returns `Maybe::Isnt` when the descriptor symbol is missing, the
/// descriptor pointer is null, `validate_descriptor` rejects the
/// descriptor, the lint provider is not present in the descriptor's
/// provider table, or the vtable pointer is null.
pub fn lint_vtable_from_library(
    lib: &hilavitkutin_linking::Library,
) -> Maybe<&'static LintEvaluateVtable> {
    use hilavitkutin_extensions::{DESCRIPTOR_SYMBOL, ExtensionDescriptor};
    use notko::Outcome;

    type DescriptorFn = extern "C" fn() -> *const ExtensionDescriptor;
    let sym = match lib.resolve::<DescriptorFn>(DESCRIPTOR_SYMBOL.to_bytes_with_nul()) {
        Outcome::Ok(s) => s,
        Outcome::Err(_) => return Maybe::Isnt,
    };
    let ptr = (sym.get())();
    if ptr.is_null() {
        return Maybe::Isnt;
    }
    // SAFETY: descriptor memory valid for the loaded library's lifetime;
    // ExtensionHost keeps the library alive for the scheduler run.
    let descriptor: &'static ExtensionDescriptor = unsafe { &*ptr };

    if let Outcome::Err(_) = hilavitkutin_extensions::validate_descriptor(descriptor) {
        return Maybe::Isnt;
    }

    let n: usize = descriptor.providers_len as usize; // lint:allow(no-bare-numeric) lint:allow(arvo-types-only) reason: u32 ABI field projects to usize for slice iteration; tracked: #72
    let mut i: usize = 0; // lint:allow(no-bare-numeric) reason: loop counter; tracked: #72
    while i < n {
        // SAFETY: providers_ptr and providers_len validated by
        // `validate_descriptor` above; the slice is initialised by the
        // extension before the descriptor function returns it.
        let entry = unsafe { *descriptor.providers_ptr.add(i) };
        if entry.id == PROVIDER_LINT_EVALUATE {
            if entry.vtable_ptr.is_null() {
                return Maybe::Isnt;
            }
            // SAFETY: provider table guarantees vtable_ptr targets a
            // `&'static LintEvaluateVtable` inside the loaded library.
            return Maybe::Is(unsafe {
                &*(entry.vtable_ptr as *const LintEvaluateVtable)
            });
        }
        i += 1; // lint:allow(no-bare-numeric) reason: loop counter increment; tracked: #72
    }
    Maybe::Isnt
}
