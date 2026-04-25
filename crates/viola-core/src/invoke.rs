//! Typed vtable resolvers for the three v1 viola capabilities.
//!
//! Bridges the raw `*const c_void` returned by
//! `hilavitkutin_extensions::Extension::capability` into the
//! `#[repr(C)]` vtable shapes pinned in
//! [`viola_plugin_abi::vtable`]. Resolution is a thin pointer cast plus
//! a non-null check.

use core::ffi::c_void;

use hilavitkutin_extensions::Extension;
use notko::Maybe;
use viola_plugin_abi::{
    CAP_GRAMMAR_EXTRACT, CAP_LINT_EVALUATE, CAP_RUNNER_EXECUTE_SCOPE,
    GrammarExtractVtable, LintEvaluateVtable, RunnerExecuteScopeVtable,
};

/// Resolve the runner role's vtable. Absent or null pointer -> `Isnt`.
pub fn runner_vtable<'a>(
    ext: &'a Extension,
) -> Maybe<&'a RunnerExecuteScopeVtable> {
    cast(ext.capability(CAP_RUNNER_EXECUTE_SCOPE))
}

/// Resolve the grammar role's vtable.
pub fn grammar_vtable<'a>(
    ext: &'a Extension,
) -> Maybe<&'a GrammarExtractVtable> {
    cast(ext.capability(CAP_GRAMMAR_EXTRACT))
}

/// Resolve the lint role's vtable.
pub fn lint_vtable<'a>(ext: &'a Extension) -> Maybe<&'a LintEvaluateVtable> {
    cast(ext.capability(CAP_LINT_EVALUATE))
}

fn cast<'a, T>(raw: Maybe<*const c_void>) -> Maybe<&'a T> {
    match raw {
        Maybe::Is(ptr) if !ptr.is_null() => {
            // SAFETY: the extension's CapabilityExport pins the pointee
            // at a `&'static T` cast inside the loaded library. The
            // returned borrow is tied to the Extension reference's
            // lifetime, so the OS handle and descriptor memory remain
            // resident for the duration of any read.
            Maybe::Is(unsafe { &*(ptr as *const T) })
        }
        _ => Maybe::Isnt,
    }
}
