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
