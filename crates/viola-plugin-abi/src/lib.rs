#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Viola Plugin ABI.
//!
//! Viola plugins are `hilavitkutin_extensions::Extension` instances
//! specialized for the lint-runtime domain. The descriptor surface,
//! lifecycle, capability dispatch, and version gating all come from
//! `hilavitkutin-extensions`. This crate adds the viola-specific
//! layer on top:
//!
//! - the three v1 capability ids
//!   ([`CAP_RUNNER_EXECUTE_SCOPE`], [`CAP_GRAMMAR_EXTRACT`],
//!   [`CAP_LINT_EVALUATE`]) and their `#[repr(C)]` vtable shapes;
//! - the [`NamPayload`] / [`NamVersion`] carriers for the normalized
//!   analysis model produced once per run;
//! - the [`Diagnostic`] / [`DiagnosticBatch`] wire shapes the lint
//!   role emits;
//! - viola-specific helpers ([`BytesRef`], [`RunSurface`],
//!   [`PluginError`]) used only inside the viola domain layering.
//!
//! Plugin authors compile against `hilavitkutin-extensions` for the
//! descriptor + lifecycle and against this crate for the role-specific
//! shapes, then declare the export with
//! `#[hilavitkutin_extensions_macros::export_extension]`.
//!
//! # No std, no alloc
//!
//! `#![no_std]` and zero allocations across the FFI boundary. All
//! variable-length data crosses as `(ptr, len)` carriers into
//! plugin-owned static memory whose lifetime equals the loaded library.

pub use hilavitkutin_extensions::{
    CapabilityEntry, CapabilityExport, CapabilityId, DESCRIPTOR_SYMBOL,
    ExtensionAbiStatus, ExtensionDescriptor, ExtensionMeta, ExtensionVersion,
    HOST_ABI_VERSION, InitHandler, ShutdownHandler,
};

/// Historical alias for [`ExtensionAbiStatus`]. Plugin authors used
/// to import `AbiStatus` from this crate before the substrate
/// rebase; the alias preserves that callsite without forcing a
/// rename. New code should prefer the canonical `ExtensionAbiStatus`
/// name (and import it directly from `hilavitkutin_extensions` or
/// via `viola_core`).
pub type AbiStatus = ExtensionAbiStatus;

mod diagnostic;
mod nam;
mod vtable;

pub use diagnostic::{
    Diagnostic, DiagnosticBatch, DiagnosticSeverity, SourceLocation,
    SourceRange,
};
pub use nam::{NamPayload, NamVersion};
pub use vtable::{
    FileEntry, GrammarExtractVtable, LintEvaluateVtable, RunScope,
    RunnerExecuteScopeVtable,
};

/// Two-word `(ptr, len)` carrier for byte slices crossing the boundary.
///
/// Identical pattern to hilavitkutin's name slice convention. Pointer
/// references plugin-owned static memory stable for the loaded
/// library's lifetime.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BytesRef {
    pub data: *const u8,
    pub len: arvo::USize,
}

// SAFETY: BytesRef references plugin-owned static memory; host reads.
unsafe impl Send for BytesRef {}
unsafe impl Sync for BytesRef {}

impl BytesRef {
    pub const EMPTY: Self = Self {
        data: core::ptr::null(),
        len: arvo::USize(0),
    };

    pub const fn is_empty(&self) -> bool {
        self.len.0 == 0
    }
}

/// Capability id for the runner role's scope-execution entrypoint.
pub const CAP_RUNNER_EXECUTE_SCOPE: CapabilityId =
    CapabilityId::from_name("viola.runner.execute_scope.v1");

/// Capability id for the grammar role's extraction entrypoint.
pub const CAP_GRAMMAR_EXTRACT: CapabilityId =
    CapabilityId::from_name("viola.grammar.extract.v1");

/// Capability id for the lint role's evaluation entrypoint.
pub const CAP_LINT_EVALUATE: CapabilityId =
    CapabilityId::from_name("viola.lint.evaluate.v1");

/// Run surface tag mirrored into NAM `run_context.surface`.
///
/// `#[repr(u32)]` so the wire shape is stable; values match the NAM v1
/// `run_context.surface` encoding.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RunSurface {
    Cli = 0,
    Hook = 1,
    Ci = 2,
    Lsp = 3,
    Test = 4,
    Other = 0xFFFF,
}

/// Viola host-side error categories.
///
/// Distinct from [`hilavitkutin_extensions::ExtensionError`]: that
/// covers descriptor-level failures (load / abi / required-host-cap),
/// while these are viola-domain failures the host raises after the
/// extension has loaded successfully.
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PluginError {
    /// Plugin claims a viola role but does not export the corresponding
    /// well-known capability id.
    RoleCapabilityMissing = 1,
    /// Lint produced a NAM-version-incompatible diagnostic batch.
    ModelVersionMismatch = 2,
    /// Capability invocation returned a non-`Ok` status.
    InvocationFailed = 3,
    /// Configuration could not be resolved or validated.
    ConfigInvalid = 4,
}

/// Wire shape of the normative error envelope per
/// `docs/PLUGIN-ABI-V1-DESIGN.md` §11.
///
/// `details_schema` is a [`CapabilityId`] (`#[repr(transparent)] u64`)
/// matching the same schema-tag convention as
/// [`Diagnostic::metadata_schema`]. A zero id signals absent details.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct StructuredError {
    pub code: PluginError,
    pub message: BytesRef,
    pub details_schema: CapabilityId,
    pub details_ptr: *const core::ffi::c_void,
    pub details_len: arvo::USize,
    /// `u8` (0 or 1) on the wire so the layout is stable across
    /// platforms; not Rust `bool`. lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub retryable: u8,
    /// Reserved for future flag bits. lint:allow(arvo-types-only, no-bare-numeric, no-public-raw-field) tracked: #207
    pub _reserved: [u8; 3],
}

// SAFETY: pointers reference plugin-owned static memory; host reads.
unsafe impl Send for StructuredError {}
unsafe impl Sync for StructuredError {}

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{align_of, size_of};

    #[test]
    fn well_known_capabilities_distinct() {
        assert_ne!(CAP_RUNNER_EXECUTE_SCOPE.0, CAP_GRAMMAR_EXTRACT.0);
        assert_ne!(CAP_GRAMMAR_EXTRACT.0, CAP_LINT_EVALUATE.0);
        assert_ne!(CAP_RUNNER_EXECUTE_SCOPE.0, CAP_LINT_EVALUATE.0);
    }

    #[test]
    fn capability_id_is_transparent_u64() {
        assert_eq!(size_of::<CapabilityId>(), size_of::<u64>());
        assert_eq!(align_of::<CapabilityId>(), align_of::<u64>());
    }

    #[test]
    fn run_surface_is_repr_u32() {
        assert_eq!(size_of::<RunSurface>(), 4);
        assert_eq!(RunSurface::Cli as u32, 0);
        assert_eq!(RunSurface::Other as u32, 0xFFFF);
    }

    #[test]
    fn vtable_function_pointers_are_one_word() {
        assert_eq!(
            size_of::<RunnerExecuteScopeVtable>(),
            size_of::<*const ()>(),
        );
        assert_eq!(
            size_of::<GrammarExtractVtable>(),
            size_of::<*const ()>(),
        );
        assert_eq!(
            size_of::<LintEvaluateVtable>(),
            size_of::<*const ()>(),
        );
    }

    #[test]
    fn bytes_ref_is_two_words() {
        assert_eq!(
            size_of::<BytesRef>(),
            size_of::<*const u8>() + size_of::<arvo::USize>(),
        );
    }

    #[test]
    fn structured_error_layout_pins_retryable_byte() {
        use core::mem::offset_of;
        let _ = offset_of!(StructuredError, code);
        let _ = offset_of!(StructuredError, message);
        let _ = offset_of!(StructuredError, retryable);
        let _ = offset_of!(StructuredError, _reserved);
    }
}
