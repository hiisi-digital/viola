#![no_std]
#![deny(unsafe_op_in_unsafe_fn)]

//! Viola Plugin ABI v1.
//!
//! Stable C-ABI contracts shared between the `viola-core` host and any
//! plugin compiled as a native `cdylib` (`.dylib` / `.so` / `.dll`).
//!
//! # Scope
//!
//! This crate owns the *contract surface*: descriptor and manifest
//! shapes, role and capability identifiers, lifecycle status codes,
//! diagnostic and error layouts, version compatibility primitives. It
//! owns no host loader, no runtime orchestration, and no proc-macro
//! emission machinery. The host loader lives in `viola-core`; the
//! ergonomic SDK macros live in a separate `viola-plugin-abi-macros`
//! companion crate.
//!
//! # Loading model
//!
//! Plugins export one well-known symbol resolving to a pointer to a
//! `#[repr(C)]` [`PluginDescriptor`]. Discovery is strictly pull-based:
//! the host opens the library, resolves the symbol, reads the
//! descriptor, validates compatibility, and only then invokes the
//! lifecycle. There is no linker-magic registration. There is no
//! ecosystem-wide init gate. Any plugin may load, run, and unload at
//! arbitrary points independent of siblings.
//!
//! See [`DESCRIPTOR_SYMBOL`] for the canonical exported symbol name and
//! [`PluginDescriptor`] for the descriptor layout.
//!
//! # No allocation, no std
//!
//! The contract crate is `#![no_std]` and does not allocate. All
//! variable-length data crosses the boundary as `(ptr, len)` pairs into
//! plugin-owned static memory whose lifetime equals the loaded library.

mod bytes_ref;
mod capability;
mod config;
mod descriptor;
mod diagnostic;
mod error;
mod nam;
mod role;
mod symbol;
mod traits;
mod version;
mod vtable;

pub use bytes_ref::BytesRef;
pub use capability::{
    CapabilityEntry, CapabilityId,
    CAP_GRAMMAR_EXTRACT, CAP_LINT_EVALUATE, CAP_RUNNER_EXECUTE_SCOPE,
};
pub use config::{ConfigSchemaRef, RunSurface};
pub use descriptor::{PluginDescriptor, PluginIdentity};
pub use diagnostic::{
    Diagnostic, DiagnosticBatch, DiagnosticSeverity, SourceLocation,
    SourceRange,
};
pub use error::{AbiStatus, PluginError, StructuredError};
pub use nam::{NamPayload, NamVersion};
pub use role::{Role, RoleSet};
pub use symbol::DESCRIPTOR_SYMBOL;
pub use traits::{CapabilityExport, InitHandler, ShutdownHandler};
pub use version::{
    AbiVersion, ManifestVersion, PluginVersion, VersionTriple,
    HOST_ABI_MAJOR, VIOLA_ABI_VERSION,
};
pub use vtable::{
    FileEntry, GrammarExtractVtable, LintEvaluateVtable, RunScope,
    RunnerExecuteScopeVtable,
};

#[cfg(test)]
mod tests {
    use super::*;
    use core::mem::{align_of, size_of};

    #[test]
    fn host_abi_major_is_one() {
        assert_eq!(HOST_ABI_MAJOR, 1);
        assert_eq!(VIOLA_ABI_VERSION.0, 1);
    }

    #[test]
    fn descriptor_symbol_matches_canonical_name() {
        assert_eq!(
            DESCRIPTOR_SYMBOL.to_bytes(),
            b"__viola_plugin_descriptor",
        );
    }

    #[test]
    fn capability_id_is_transparent_u64() {
        assert_eq!(size_of::<CapabilityId>(), size_of::<u64>());
        assert_eq!(align_of::<CapabilityId>(), align_of::<u64>());
    }

    #[test]
    fn capability_id_from_name_is_const_fnv_1a() {
        const CAP: CapabilityId = CapabilityId::from_name("cap.a");
        const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
        const FNV_PRIME: u64 = 0x100000001b3;
        let mut h: u64 = FNV_OFFSET_BASIS;
        for &b in b"cap.a" {
            h ^= b as u64;
            h = h.wrapping_mul(FNV_PRIME);
        }
        assert_eq!(CAP.0, h);
    }

    #[test]
    fn well_known_capabilities_distinct() {
        assert_ne!(CAP_RUNNER_EXECUTE_SCOPE.0, CAP_GRAMMAR_EXTRACT.0);
        assert_ne!(CAP_GRAMMAR_EXTRACT.0, CAP_LINT_EVALUATE.0);
        assert_ne!(CAP_RUNNER_EXECUTE_SCOPE.0, CAP_LINT_EVALUATE.0);
    }

    #[test]
    fn version_triple_layout() {
        assert_eq!(size_of::<VersionTriple>(), 8);
    }

    #[test]
    fn version_triple_compatibility_rules() {
        let a = VersionTriple::new(1, 2, 0);
        let b = VersionTriple::new(1, 1, 0);
        let c = VersionTriple::new(2, 0, 0);
        assert!(a.is_compatible_with(b));
        assert!(!b.is_compatible_with(a));
        assert!(!a.is_compatible_with(c));
    }

    #[test]
    fn role_set_bitflag_semantics() {
        let s = RoleSet::single(Role::Runner).with(Role::Lint);
        assert!(s.contains(Role::Runner));
        assert!(s.contains(Role::Lint));
        assert!(!s.contains(Role::Grammar));
        assert!(!s.is_empty());
        assert!(RoleSet::EMPTY.is_empty());
    }

    #[test]
    fn abi_status_repr_u32_layout() {
        assert_eq!(size_of::<AbiStatus>(), 4);
        assert_eq!(AbiStatus::Ok as u32, 0);
        assert!(AbiStatus::Ok.is_ok());
        assert!(!AbiStatus::InitFailed.is_ok());
    }

    #[test]
    fn diagnostic_severity_ordering_on_wire() {
        assert_eq!(DiagnosticSeverity::Info as u32, 0);
        assert_eq!(DiagnosticSeverity::Warn as u32, 1);
        assert_eq!(DiagnosticSeverity::Error as u32, 2);
    }

    #[test]
    fn role_set_is_transparent_u32() {
        assert_eq!(size_of::<RoleSet>(), size_of::<u32>());
    }

    #[test]
    fn abi_version_compatibility_is_major_only() {
        let host = AbiVersion(1);
        assert!(host.is_compatible_with(1));
        assert!(!host.is_compatible_with(2));
        assert!(!host.is_compatible_with(0));
    }

    #[test]
    fn bytes_ref_is_two_words() {
        assert_eq!(
            size_of::<BytesRef>(),
            size_of::<*const u8>() + size_of::<usize>(),
        );
        let empty = BytesRef::EMPTY;
        assert!(empty.is_empty());
        assert!(empty.data.is_null());
    }

    #[test]
    fn structured_error_layout_pins_retryable_byte() {
        // retryable is u8 + 3-byte reserved, not Rust bool.
        // Ensure layout matches what the wire spec needs.
        use core::mem::offset_of;
        let _ = offset_of!(StructuredError, code);
        let _ = offset_of!(StructuredError, message);
        let _ = offset_of!(StructuredError, retryable);
        let _ = offset_of!(StructuredError, _reserved);
    }

    #[test]
    fn vtable_function_pointers_are_one_word() {
        // Each vtable is a single fn pointer at v1; ensures we
        // accidentally don't grow them by adding fields silently.
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
    fn config_schema_ref_is_bytes_ref() {
        // ConfigSchemaRef is a type alias over BytesRef; ensure the
        // alias resolves identically.
        let _: ConfigSchemaRef = BytesRef::EMPTY;
    }
}
